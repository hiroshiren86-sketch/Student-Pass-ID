/**
 * ==============================================================================
 * MÓDULO DE EXCUSAS JUSTIFICADAS — Ronda 21 (P0 de spec-excusas-2026)
 * Contrato común: Escudo anticipado (fechas futuras) + Justificación post-hoc
 * (1 toque sobre el AUSENTE) en UNA entidad. Overlay: el registro conserva
 * status='AUSENTE' y gana excuse_id. "Falta injustificada" = AUSENTE sin excuse_id.
 *
 * Reglas de negocio validadas SIEMPRE aquí (OWASP: nunca confiar en el cliente):
 *  R1  Rango válido / anticipada ≥ hoy+1 / post-hoc exige AUSENTE en el rango
 *  R2  1 excusa por AUSENTE (índice único parcial uq_excuses_attendance)
 *  R3  Anti-spam: máx. 3 activas por estudiante; 'OTRA' exige notas;
 *      máx. días por término si SCHOOL_TERM_START/END están configurados
 *  R4  Inmutable para el radicante: NO existe endpoint de edición/retiro
 *  R5  Solo Rectoría decide (rol declarado verificado en servidor + AUTH_TOKEN
 *      cuando el propietario lo active — mismo gate que el resto de endpoints)
 *  R6  Rechazo exige motivo
 *  R7  Overlaps permitidos; el registro enlaza la excusa no-rechazada más antigua
 *  R8  Ventana 72 h con auto-aprobo auditable (EXCUSE_AUTO_APPROVED) — lazy sweep
 *      al listar; desactivable con EXCUSE_AUTO_APPROVE_HOURS=0
 *  R9  Solo ausencias: TARDANZA/PUNTUAL jamás reciben excuse_id
 *  R10 Fin de vigencia ≤ SCHOOL_TERM_END si está configurado
 *
 * Cadena de auditoría (§6.2): hash(n) = HMAC-SHA256(secret, prev|id|evento|estado|
 * revisor|ts). Secret = EXCUSE_CHAIN_SECRET || AUTH_TOKEN. Si no hay secret
 * configurado, la cadena se marca signed:false (NUNCA se simula seguridad).
 * ==============================================================================
 */
import type { Env } from './index';
import { sendPushTo } from './push';

const EXCUSE_REASONS = ['CITA_MEDICA', 'INCAPACIDAD', 'CALAMIDAD', 'DEPORTIVA', 'OTRA'] as const;
const EXCUSE_REASON_LABELS: Record<string, string> = {
  CITA_MEDICA: 'Cita médica', INCAPACIDAD: 'Incapacidad', CALAMIDAD: 'Calamidad doméstica',
  DEPORTIVA: 'Representación deportiva', OTRA: 'Otra'
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ExcuseRuleError { rule: string; message_es: string }

function jsonOk(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-School-Code, X-Requested-With',
    },
  });
}

function jsonErr(message: string, status = 400, errors?: ExcuseRuleError[]): Response {
  return new Response(JSON.stringify({ success: false, error: message, ...(errors ? { errors } : {}) }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-School-Code, X-Requested-With',
    },
  });
}

/** Fecha de HOY anclada a Colombia (America/Bogota), formato YYYY-MM-DD */
function bogotaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  // días entre a y b (b - a), ambos YYYY-MM-DD
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Obtiene el último eslabón de la cadena (hash del evento EXCUSE_* más reciente) */
async function getChainHead(env: Env): Promise<string> {
  if (!env.DB) return `GENESIS:${'SCHOOL'}`;
  const row = await env.DB.prepare(
    `SELECT details_json FROM audit_logs WHERE event_type LIKE 'EXCUSE_%' ORDER BY created_at DESC, id DESC LIMIT 1`
  ).first<{ details_json: string | null }>();
  if (row?.details_json) {
    try {
      const d = JSON.parse(row.details_json);
      if (typeof d.hash === 'string') return d.hash;
    } catch { /* evento corrupto: la cadena se reconstruye desde GENESIS y verify-chain lo marcará */ }
  }
  return 'GENESIS:INAS';
}

/** Escribe un evento EXCUSE_* en audit_logs encadenando el HMAC anterior */
async function writeExcuseAudit(env: Env, opts: {
  eventType: string; performedBy: string; excuseId: string; studentCode: string;
  status: string; extra?: Record<string, any>;
}): Promise<string | null> {
  if (!env.DB) return null;
  const secret = env.EXCUSE_CHAIN_SECRET || env.AUTH_TOKEN || '';
  const eventId = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const prevHash = await getChainHead(env);
  let hash: string | null = null;
  // El created_at se inserta EXPLÍCITO en ISO y es el MISMO que entra al hash:
  // verify-chain recomputa contra el valor de la fila, así que ambos deben ser idénticos.
  // El mensaje firmado incluye TAMBIÉN el payload (extra): alterar la razón/fechas/motivo
  // en audit_logs rompe la cadena (tamper-evidente de payload, no solo de eslabones).
  const ts = new Date().toISOString();
  const signedPayload = JSON.stringify({ excuseId: opts.excuseId, studentCode: opts.studentCode, status: opts.status, ...(opts.extra || {}) });
  if (secret) {
    hash = await hmacHex(secret, [prevHash, eventId, opts.eventType, opts.excuseId, opts.status, opts.performedBy, ts, signedPayload].join('|'));
  }
  const details = JSON.stringify({
    excuseId: opts.excuseId, studentCode: opts.studentCode, status: opts.status,
    prevHash, hash, ...(opts.extra || {})
  });
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, event_type, performed_by, details_json, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(eventId, opts.eventType, opts.performedBy, details, ts).run();
  return hash;
}

/** R8 lazy sweep: PENDIENTE vencida (72 h configurable) → APROBADA + audit */
async function sweepAutoApprovals(env: Env): Promise<number> {
  if (!env.DB) return 0;
  const hours = env.EXCUSE_AUTO_APPROVE_HOURS !== undefined ? Number(env.EXCUSE_AUTO_APPROVE_HOURS) : 72;
  if (!hours || hours <= 0) return 0; // colegio desactivó el auto-aprobo (R8)
  const cutoff = new Date(Date.now() - Math.floor(hours) * 3600_000).toISOString();
  const pendientes = await env.DB.prepare(
    `SELECT id, student_code, student_name FROM student_excuses
     WHERE status = 'PENDIENTE' AND created_at <= ?`
  ).bind(cutoff).all<{ id: string; student_code: string; student_name: string }>();
  let count = 0;
  for (const ex of (pendientes.results || [])) {
    await env.DB.prepare(
      `UPDATE student_excuses SET status='APROBADA', auto_approved=1, reviewed_by='AUTO_72H', reviewed_at=datetime('now') WHERE id=? AND status='PENDIENTE'`
    ).bind(ex.id).run();
    await writeExcuseAudit(env, {
      eventType: 'EXCUSE_AUTO_APPROVED', performedBy: 'AUTO_72H', excuseId: ex.id,
      studentCode: ex.student_code, status: 'APROBADA', extra: { windowHours: hours }
    });
    count++;
  }
  return count;
}

// ============================== RUTAS ========================================

// ====================== Ronda 22 — FASE P4: RETENCIÓN =========================
// Purga de minimización (Ley 1581 art. 9, principio de temporalidad): las excusas y
// sus soportes cifrados se eliminan EXCUSE_RETENTION_MONTHS (default 12, "término+1
// año") después de su end_date. El audit_log NO se purga (es la evidencia del
// tratamiento, no un dato especial). Lazy sweep como el R8. 0 = desactivado.
async function sweepRetention(env: Env): Promise<number> {
  if (!env.DB) return 0;
  const monthsRaw = (env.EXCUSE_RETENTION_MONTHS || '12').trim();
  const months = Number(monthsRaw);
  if (!Number.isFinite(months) || months <= 0) return 0; // colegio desactivó la purga
  try {
    // 1) Desvincular registros de asistencia (evita excuse_id huérfanos)
    const unlink = await env.DB.prepare(
      `UPDATE attendance_records SET excuse_id = NULL WHERE excuse_id IN
        (SELECT id FROM student_excuses WHERE end_date < date('now', '-${Math.floor(months)} months'))`
    ).run();
    // 2) Purgar las excusas expiradas (incluye attachment_path cifrado)
    const del = await env.DB.prepare(
      `DELETE FROM student_excuses WHERE end_date < date('now', '-${Math.floor(months)} months')`
    ).run();
    return (del as any)?.meta?.changes ?? 0;
  } catch {
    return 0; // la purga jamás rompe la operación principal
  }
}


// ====================== Ronda 22 — FASE P3: EVIDENCIA =========================
// Soporte fotográfico del documento físico (Ley 1581 art. 3(o): dato especial de salud).
// Cifrado AES-GCM-256 SERVER-SIDE (WebCrypto): la foto nunca se persiste en claro en D1.
// Formato almacenado en attachment_path: "AESGCM:v1:<ivB64>:<ctB64>" (texto, sin migración).
// La clave se deriva con SHA-256 del secret institucional (EXCUSE_ATTACHMENT_SECRET →
// EXCUSE_CHAIN_SECRET → AUTH_TOKEN). Sin secret → uploads 503 (jamás se guarda sin cifrar).
// Lectura SOLO para RECTORÍA o el estudiante dueño de la excusa (la planilla jamás llama aquí).
const ATTACHMENT_FORMAT = 'AESGCM:v1:';
const ATTACHMENT_MAX_B64 = 400_000; // ~300 KB binarios: foto comprimida del soporte (imagenCompressor)

function attachmentSecret(env: Env): string {
  return (env.EXCUSE_ATTACHMENT_SECRET || env.EXCUSE_CHAIN_SECRET || env.AUTH_TOKEN || '').trim();
}

async function importAttachmentKey(env: Env): Promise<CryptoKey | null> {
  const secret = attachmentSecret(env);
  if (!secret) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('INAS-ATTACH-V1|' + secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function handleExcusesRoutes(request: Request, env: Env, url: URL, path: string, ctx?: { waitUntil(promise: Promise<any>): void }): Promise<Response | null> {
  if (!path.startsWith('/api/excuses')) return null;
  if (!env.DB) return jsonErr('Base de datos D1 no configurada en el Worker.', 503);

  try {
    // ---------- GET /api/excuses/verify-chain (antes que :id) ----------
    if (path === '/api/excuses/verify-chain' && request.method === 'GET') {
      const secret = env.EXCUSE_CHAIN_SECRET || env.AUTH_TOKEN || '';
      if (!secret) {
        return jsonOk({ intact: true, signed: false, checked: 0, note: 'Sin secret configurado (EXCUSE_CHAIN_SECRET/AUTH_TOKEN): la cadena no se firma. Configura el secret para auditoría forense.' });
      }
      const rows = await env.DB.prepare(
        `SELECT id, event_type, performed_by, details_json, created_at FROM audit_logs
         WHERE event_type LIKE 'EXCUSE_%' ORDER BY created_at ASC, id ASC`
      ).all<{ id: string; event_type: string; performed_by: string; details_json: string; created_at: string }>();
      let prev = 'GENESIS:INAS';
      let firstBroken: string | null = null;
      let checked = 0;
      for (const r of (rows.results || [])) {
        let d: any;
        try { d = JSON.parse(r.details_json); } catch { firstBroken = r.id; break; }
        // Reconstruir el payload firmado (mismo orden de claves que al firmar):
        const { prevHash: _p, hash: _h, ...extra } = d;
        const signedPayload = JSON.stringify({ excuseId: d.excuseId, studentCode: d.studentCode, status: d.status, ...extra });
        const expected = await hmacHex(secret, [prev, r.id, r.event_type, d.excuseId, d.status, r.performed_by, r.created_at, signedPayload].join('|'));
        if (d.prevHash !== prev || d.hash !== expected) { firstBroken = r.id; break; }
        prev = d.hash;
        checked++;
      }
      // Segunda pasada (§10.10, endurecida Ronda 22): el estado ACTUAL de cada excusa debe
      // coincidir con sus eventos — alterar la fila en D1 fuera del API la caza aunque el
      // log quede intacto. Se compara: (a) status + audit_hash vs el ÚLTIMO evento de
      // decisión; (b) reviewed_by vs performed_by del último evento (APROBADA/RECHAZADA);
      // (c) reason/startDate/endDate/notes vs el evento EXCUSE_CREATED (la API jamás los
      // edita post-creación). Compatibilidad: los campos ausentes en eventos anteriores a
      // Ronda 22 se omiten (jamás se rompe la cadena por datos que no estaban firmados).
      let stateBroken: string | null = null;
      if (firstBroken === null) {
        const excuses = await env.DB.prepare(
          `SELECT e.id, e.status, e.reviewed_by, e.audit_hash, e.reason, e.start_date, e.end_date, e.notes, e.reject_reason,
             (SELECT a.details_json FROM audit_logs a WHERE a.event_type LIKE 'EXCUSE_%'
              AND a.details_json LIKE ('%"excuseId":"' || e.id || '"%')
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_event,
             (SELECT a.performed_by FROM audit_logs a WHERE a.event_type LIKE 'EXCUSE_%'
              AND a.details_json LIKE ('%"excuseId":"' || e.id || '"%')
              ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_performed_by,
             (SELECT a.details_json FROM audit_logs a WHERE a.event_type = 'EXCUSE_CREATED'
              AND a.details_json LIKE ('%"excuseId":"' || e.id || '"%')
              ORDER BY a.created_at ASC, a.id ASC LIMIT 1) AS created_event
           FROM student_excuses e`
        ).all<any>();
        for (const ex of (excuses.results || [])) {
          if (!ex.last_event) { stateBroken = ex.id; break; }
          try {
            const d = JSON.parse(ex.last_event);
            if (d.status !== ex.status || (d.hash || null) !== (ex.audit_hash || null)) { stateBroken = ex.id; break; }
            if ((ex.status === 'APROBADA' || ex.status === 'RECHAZADA') && ex.last_performed_by && ex.reviewed_by !== ex.last_performed_by) { stateBroken = ex.id; break; }
            if (ex.status === 'RECHAZADA' && 'rejectReason' in d && (d.rejectReason || null) !== (ex.reject_reason || null)) { stateBroken = ex.id; break; }
            if (ex.created_event) {
              const cd = JSON.parse(ex.created_event);
              if (('reason' in cd) && cd.reason !== ex.reason) { stateBroken = ex.id; break; }
              if (('startDate' in cd) && cd.startDate !== ex.start_date) { stateBroken = ex.id; break; }
              if (('endDate' in cd) && cd.endDate !== ex.end_date) { stateBroken = ex.id; break; }
              if (('notes' in cd) && (cd.notes || null) !== (ex.notes || null)) { stateBroken = ex.id; break; }
            }
          } catch { stateBroken = ex.id; break; }
        }
      }
      const broken = firstBroken || stateBroken;
      return jsonOk({ intact: broken === null, signed: true, checked, ...(broken ? { firstBroken: broken } : {}) });
    }

    // ---------- POST /api/excuses (radicar: portal anticipado o 1 toque post-hoc) ----------
    if (path === '/api/excuses' && request.method === 'POST') {
      let body: any;
      try { body = await request.json(); } catch { return jsonErr('JSON inválido en el cuerpo de la petición.'); }
      const errors: ExcuseRuleError[] = [];

      const studentCode = String(body.studentCode || '').trim();
      const startDate = String(body.startDate || '').trim();
      const endDate = String(body.endDate || '').trim();
      const reason = String(body.reason || '').trim();
      const notes = body.notes ? String(body.notes).trim() : '';
      const submittedBy = String(body.submittedBy || 'PORTAL_ESTUDIANTE').trim();
      const sourceAttendanceId = body.sourceAttendanceId ? String(body.sourceAttendanceId).trim() : '';
      const today = bogotaToday();

      if (!studentCode) errors.push({ rule: 'R1', message_es: 'El código del estudiante es obligatorio.' });
      if (!isValidDate(startDate) || !isValidDate(endDate)) errors.push({ rule: 'R1', message_es: 'Las fechas deben tener formato YYYY-MM-DD válido.' });
      if (isValidDate(startDate) && isValidDate(endDate) && endDate < startDate) errors.push({ rule: 'R1', message_es: 'La fecha final no puede ser anterior a la inicial.' });
      if (!(EXCUSE_REASONS as readonly string[]).includes(reason)) errors.push({ rule: 'R1', message_es: `La razón debe ser una de: ${EXCUSE_REASONS.join(', ')}.` });
      if (reason === 'OTRA' && !notes) errors.push({ rule: 'R3', message_es: 'La razón "Otra" requiere una nota explicativa.' });
      if (errors.length) return jsonErr('Datos de la excusa inválidos.', 400, errors);

      // R10: fin de vigencia (si el colegio configura el fin del término)
      if (env.SCHOOL_TERM_END && isValidDate(env.SCHOOL_TERM_END) && endDate > env.SCHOOL_TERM_END) {
        return jsonErr('Datos de la excusa inválidos.', 400, [{ rule: 'R10', message_es: `La excusa no puede extenderse más allá del fin del término escolar (${env.SCHOOL_TERM_END}).` }]);
      }

      // Estudiante existe y activo (la verdad sale de la BD, no del cliente)
      const student = await env.DB.prepare(`SELECT code, first_name, last_name, grade, status FROM students WHERE code = ?`).bind(studentCode).first<any>();
      if (!student) return jsonErr(`No existe ningún estudiante con el código ${studentCode} en la matrícula.`, 404);
      if (student.status !== 'ACTIVO') return jsonErr(`El estudiante ${student.first_name} ${student.last_name} no está activo en la matrícula.`, 400);

      // R3: máx. 3 excusas activas (no rechazadas y vigentes) por estudiante
      const activeCount = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM student_excuses WHERE student_code = ? AND status != 'RECHAZADA' AND end_date >= ?`
      ).bind(studentCode, today).first<{ n: number }>();
      if ((activeCount?.n || 0) >= 3) {
        return jsonErr('Datos de la excusa inválidos.', 400, [{ rule: 'R3', message_es: 'El estudiante ya tiene 3 excusas activas. Debe esperar a que Rectoría revise o que venzan.' }]);
      }

      // R3: máx. 10 días justificados por término (si SCHOOL_TERM_START/END configurados)
      if (env.SCHOOL_TERM_START && env.SCHOOL_TERM_END && isValidDate(env.SCHOOL_TERM_START) && isValidDate(env.SCHOOL_TERM_END)) {
        const used = await env.DB.prepare(
          `SELECT COALESCE(SUM(julianday(MIN(end_date, ?)) - julianday(MAX(start_date, ?)) + 1), 0) AS days
           FROM student_excuses WHERE student_code = ? AND status != 'RECHAZADA'
           AND end_date >= ? AND start_date <= ?`
        ).bind(env.SCHOOL_TERM_END, env.SCHOOL_TERM_START, studentCode, env.SCHOOL_TERM_START, env.SCHOOL_TERM_END).first<{ days: number }>();
        const requested = diffDays(startDate, endDate) + 1;
        if ((used?.days || 0) + requested > 10) {
          return jsonErr('Datos de la excusa inválidos.', 400, [{ rule: 'R3', message_es: 'Se supera el máximo de 10 días justificados por término.' }]);
        }
      }

      // R1 + R9: temporalidad y anclas
      let recordsToLink: Array<{ id: string; date: string }> = [];
      if (sourceAttendanceId) {
        // Post-hoc de 1 toque: el registro AUSENTE debe existir, ser del estudiante y no tener excusa
        const rec = await env.DB.prepare(
          `SELECT id, student_code, status, date, excuse_id FROM attendance_records WHERE id = ?`
        ).bind(sourceAttendanceId).first<any>();
        if (!rec) return jsonErr('El registro de asistencia indicado no existe.', 404);
        if (rec.student_code !== studentCode) return jsonErr('El registro indicado pertenece a otro estudiante.', 400);
        if (rec.status !== 'AUSENTE') return jsonErr('Solo se pueden justificar ausencias, no llegadas tarde (R9).', 400, [{ rule: 'R9', message_es: 'Una excusa justifica ausencias, no tardanzas.' }]);
        if (rec.excuse_id) return jsonErr('Esa ausencia ya tiene una excusa asociada.', 400, [{ rule: 'R2', message_es: '1 excusa por ausencia: esta ausencia ya está justificada.' }]);
        recordsToLink.push({ id: rec.id, date: rec.date });
      } else if (startDate <= today) {
        // Post-hoc por rango de fechas: debe existir al menos un AUSENTE sin excusa en el rango (R1)
        const ausentes = await env.DB.prepare(
          `SELECT id, date FROM attendance_records
           WHERE student_code = ? AND status = 'AUSENTE' AND excuse_id IS NULL AND date BETWEEN ? AND ?
           ORDER BY date ASC, id ASC`
        ).bind(studentCode, startDate, endDate).all<{ id: string; date: string }>();
        if (!ausentes.results || ausentes.results.length === 0) {
          return jsonErr('Datos de la excusa inválidos.', 400, [{ rule: 'R1', message_es: 'No hay ausencia que justificar en esa fecha: el estudiante no registra AUSENTE pendiente de justificar en el rango indicado.' }]);
        }
        recordsToLink = ausentes.results;
      } else {
        // Anticipada (Escudo): debe empezar mañana o después (R1)
        if (startDate < addDays(today, 1)) {
          return jsonErr('Datos de la excusa inválidos.', 400, [{ rule: 'R1', message_es: 'Una excusa anticipada debe empezar como mínimo mañana. Para justificar una ausencia ya existente usa la justificación sobre el registro.' }]);
        }
      }

      // R2 a nivel de ancla: el source_attendance_id no puede estar ya usado
      if (sourceAttendanceId) {
        const dup = await env.DB.prepare(`SELECT id FROM student_excuses WHERE source_attendance_id = ?`).bind(sourceAttendanceId).first<{ id: string }>();
        if (dup) return jsonErr('Esa ausencia ya tiene una excusa asociada.', 400, [{ rule: 'R2', message_es: '1 excusa por ausencia (índice único).' }]);
      }

      const excuseId = `exc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const status = 'PENDIENTE'; // Ronda 21: default real — siempre explícito (Regla 6)

      // Transacción: excusa + vinculación de registros AUSENTE del rango (overlay)
      const stmts = [
        env.DB.prepare(
          `INSERT INTO student_excuses (id, student_code, student_name, grade, start_date, end_date, reason, notes, status, submitted_by, source_attendance_id, attachment_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(excuseId, studentCode, `${student.first_name} ${student.last_name}`, student.grade, startDate, endDate, reason, notes || null, status, submittedBy, sourceAttendanceId || null, body.attachmentPath ? String(body.attachmentPath) : null)
      ];
      for (const r of recordsToLink) {
        stmts.push(env.DB.prepare(`UPDATE attendance_records SET excuse_id = ? WHERE id = ? AND status = 'AUSENTE' AND excuse_id IS NULL`).bind(excuseId, r.id));
      }
      await env.DB.batch(stmts);

      const hash = await writeExcuseAudit(env, {
        eventType: 'EXCUSE_CREATED', performedBy: submittedBy, excuseId,
        studentCode, status, extra: { reason, startDate, endDate, notes: notes || null, postHoc: !!sourceAttendanceId, recordsLinked: recordsToLink.length }
      });
      await env.DB.prepare(`UPDATE student_excuses SET audit_hash = ? WHERE id = ?`).bind(hash, excuseId).run();

      // Web Push (Ronda 23, best-effort): aviso a Rectoría de que hay una excusa por revisar.
      ctx?.waitUntil(sendPushTo(env, {
        role: 'RECTORIA',
        title: 'Nueva excusa por revisar',
        body: `${student.first_name} ${student.last_name} (${student.grade}) radicó ${EXCUSE_REASON_LABELS[reason as keyof typeof EXCUSE_REASON_LABELS] || reason} del ${startDate} al ${endDate}.`,
        tag: `excusa-${excuseId}`, url: '/'
      }));

      return jsonOk({
        success: true,
        excuse: { id: excuseId, studentCode, studentName: `${student.first_name} ${student.last_name}`, grade: student.grade, startDate, endDate, reason, notes: notes || null, status, submittedBy, sourceAttendanceId: sourceAttendanceId || null },
        recordsLinked: recordsToLink.length,
        message: 'Excusa radicada. Queda protegida provisionalmente mientras Rectoría la revisa (máx. 72 h).'
      }, 201);
    }

    // ---------- GET /api/excuses (listar con filtros) ----------
    if (path === '/api/excuses' && request.method === 'GET') {
      const autoApproved = await sweepAutoApprovals(env); // R8 lazy
      const purged = await sweepRetention(env); // P4 lazy (retención término+1 año)
      const studentCode = url.searchParams.get('studentCode');
      const status = url.searchParams.get('status');
      const grade = url.searchParams.get('grade');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const conds: string[] = []; const binds: any[] = [];
      if (studentCode) { conds.push('student_code = ?'); binds.push(studentCode); }
      if (status) { conds.push('status = ?'); binds.push(status); }
      if (grade) { conds.push('grade = ?'); binds.push(grade); }
      if (from) { conds.push('end_date >= ?'); binds.push(from); }
      if (to) { conds.push('start_date <= ?'); binds.push(to); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await env.DB.prepare(
        `SELECT * FROM student_excuses ${where} ORDER BY created_at DESC LIMIT 200`
      ).bind(...binds).all();
      return jsonOk({ success: true, excuses: rows.results || [], autoApprovedThisSweep: autoApproved, purgedThisSweep: purged });
    }

    // ---------- GET/PATCH /api/excuses/:id y attachment ----------
    const idMatch = path.match(/^\/api\/excuses\/([^\/]+)(\/attachment)?$/);
    if (idMatch) {
      const excuseId = decodeURIComponent(idMatch[1]);
      const isAttachment = !!idMatch[2];

      const excuse = await env.DB.prepare(`SELECT * FROM student_excuses WHERE id = ?`).bind(excuseId).first<any>();
      if (!excuse) return jsonErr(`No existe la excusa ${excuseId}.`, 404);

      if (isAttachment && request.method === 'POST') {
        // P3 upload: el estudiante (dueño) o Rectoría adjunta la foto del soporte.
        const secret = attachmentSecret(env);
        if (!secret) return jsonErr('El colegio no tiene configurado el secret de cifrado de soportes (EXCUSE_ATTACHMENT_SECRET). El sistema NO almacena soportes sin cifrar.', 503);
        let body: any;
        try { body = await request.json(); } catch { return jsonErr('JSON inválido en el cuerpo de la petición.'); }
        const dataBase64 = String(body.dataBase64 || '').trim();
        const requestBy = String(body.studentCode || '').trim();
        const mime = String(body.mime || 'image/jpeg').toLowerCase();
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) return jsonErr('El soporte debe ser una imagen JPEG, PNG o WebP.', 400);
        if (!dataBase64) return jsonErr('Falta el contenido del soporte (dataBase64).', 400);
        if (dataBase64.length > ATTACHMENT_MAX_B64) return jsonErr(`El soporte pesa demasiado (${Math.round(dataBase64.length / 1.37 / 1024)} KB). Comprime la foto e intenta de nuevo (máx. ~290 KB).`, 413);
        // Dueño o Rectoría: solo el estudiante de la excusa (o Rectoría) puede adjuntar su soporte
        if (requestBy !== excuse.student_code && String(body.role || '') !== 'RECTORIA') {
          return jsonErr('Solo el estudiante dueño de la excusa (o Rectoría) puede adjuntar el soporte.', 403);
        }
        const key = await importAttachmentKey(env);
        if (!key) return jsonErr('Secret de cifrado no disponible.', 503);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, b64decode(dataBase64)));
        const stored = `${ATTACHMENT_FORMAT}${b64encode(iv)}:${b64encode(ct)}`;
        await env.DB.prepare(`UPDATE student_excuses SET attachment_path = ? WHERE id = ?`).bind(stored, excuseId).run();
        return jsonOk({ success: true, message: 'Soporte guardado y cifrado (AES-GCM-256). Solo Rectoría y tú podrán verlo.' });
      }

      if (isAttachment && request.method === 'GET') {
        // P3 descarga: SOLO RECTORÍA o el estudiante dueño; la planilla jamás llama aquí (§5 minimización).
        if (!excuse.attachment_path) return jsonErr('Esta excusa no tiene soporte fotográfico adjunto.', 404);
        if (!excuse.attachment_path.startsWith(ATTACHMENT_FORMAT)) {
          return jsonErr('El soporte registrado no está cifrado en el formato interno (instalación legacy/R2).', 501);
        }
        const role = url.searchParams.get('role') || '';
        const requestBy = url.searchParams.get('requestBy') || '';
        if (role !== 'RECTORIA' && requestBy !== excuse.student_code) {
          return jsonErr('El soporte solo puede ser visto por Rectoría o el estudiante dueño de la excusa (Ley 1581, dato especial).', 403);
        }
        const key = await importAttachmentKey(env);
        if (!key) return jsonErr('Secret de cifrado no disponible: no se puede descifrar el soporte.', 503);
        try {
          const parts = excuse.attachment_path.slice(ATTACHMENT_FORMAT.length).split(':');
          const iv = b64decode(parts[0]);
          const ct = b64decode(parts[1]);
          const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
          const b64 = b64encode(new Uint8Array(plain));
          return jsonOk({ success: true, mime: 'image/jpeg', dataBase64: b64, sizeBytes: plain.byteLength });
        } catch {
          return jsonErr('El soporte no pudo descifrarse (clave cambiada o datos corruptos).', 500);
        }
      }

      if (!isAttachment && request.method === 'GET') {
        await sweepAutoApprovals(env);
        const fresh = await env.DB.prepare(`SELECT * FROM student_excuses WHERE id = ?`).bind(excuseId).first<any>();
        return jsonOk({ success: true, excuse: fresh });
      }

      if (!isAttachment && request.method === 'PATCH') {
        let body: any;
        try { body = await request.json(); } catch { return jsonErr('JSON inválido en el cuerpo de la petición.'); }
        const newStatus = String(body.status || '').trim();
        const reviewedBy = String(body.reviewedBy || '').trim();
        const reviewedByRole = String(body.reviewedByRole || '').trim();

        // R5: solo Rectoría decide (verificación en servidor del rol declarado;
        // el gate de transporte lo da AUTH_TOKEN cuando el propietario lo active)
        if (reviewedByRole !== 'RECTORIA') {
          return jsonErr('Solo el rol Rectoría puede aprobar o rechazar excusas (R5).', 403);
        }
        if (!reviewedBy) return jsonErr('Indica el usuario de Rectoría que decide (reviewedBy).', 400);
        if (newStatus !== 'APROBADA' && newStatus !== 'RECHAZADA') {
          return jsonErr('Estado inválido: solo APROBADA o RECHAZADA. Sin transiciones en reversa.', 400);
        }
        if (excuse.status !== 'PENDIENTE') {
          return jsonErr(`La excusa ya fue decidida (${excuse.status}). Sin reversas: si es un error, Rectoría debe eliminarla y re-radicar (quedará en auditoría).`, 409);
        }
        const rejectReason = body.rejectReason ? String(body.rejectReason).trim() : '';
        if (newStatus === 'RECHAZADA' && !rejectReason) {
          return jsonErr('Datos de la decisión inválidos.', 400, [{ rule: 'R6', message_es: 'El rechazo exige un motivo que se notificará al estudiante.' }]);
        }

        const physical = body.physicalDocumentVerified ? 1 : 0;
        await env.DB.prepare(
          `UPDATE student_excuses SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), reject_reason = ?, auto_approved = 0 WHERE id = ?`
        ).bind(newStatus, reviewedBy, newStatus === 'RECHAZADA' ? rejectReason : null, excuseId).run();

        // Efecto sobre attendance_records (mismo principio de overlay)
        let recordsAffected = 0;
        if (newStatus === 'APROBADA') {
          // Re-vincular AUSENTEs del rango que hayan quedado sin excusa (idempotente)
          const res = await env.DB.prepare(
            `UPDATE attendance_records SET excuse_id = ? WHERE student_code = ? AND status = 'AUSENTE' AND excuse_id IS NULL AND date BETWEEN ? AND ?`
          ).bind(excuseId, excuse.student_code, excuse.start_date, excuse.end_date).run();
          recordsAffected = (res as any)?.meta?.changes ?? 0;
          await writeExcuseAudit(env, { eventType: 'EXCUSE_APPROVED', performedBy: reviewedBy, excuseId, studentCode: excuse.student_code, status: newStatus, extra: { physicalDocumentVerified: !!body.physicalDocumentVerified } });
          // Web Push (Ronda 23): aviso al estudiante/acudiente de la decisión.
          ctx?.waitUntil(sendPushTo(env, {
            studentCode: excuse.student_code,
            title: 'Excusa verificada ✓',
            body: `Tu excusa del ${excuse.start_date} al ${excuse.end_date} fue VERIFICADA por Rectoría. La ausencia queda "Excusada (verificada)".`,
            tag: `excusa-${excuseId}`, url: '/'
          }));
        } else {
          // RECHAZADA: desvincular (vuelve a AUSENTE puro; % recalculado por el motor)
          const res = await env.DB.prepare(
            `UPDATE attendance_records SET excuse_id = NULL WHERE excuse_id = ?`
          ).bind(excuseId).run();
          recordsAffected = (res as any)?.meta?.changes ?? 0;
          await writeExcuseAudit(env, { eventType: 'EXCUSE_REJECTED', performedBy: reviewedBy, excuseId, studentCode: excuse.student_code, status: newStatus, extra: { rejectReason } });
          // Web Push (Ronda 23): aviso al estudiante/acudiente con el motivo (R6).
          ctx?.waitUntil(sendPushTo(env, {
            studentCode: excuse.student_code,
            title: 'Excusa rechazada',
            body: `Tu excusa del ${excuse.start_date} al ${excuse.end_date} fue rechazada. Motivo: ${rejectReason}. Los registros vuelven a Ausente.`,
            tag: `excusa-${excuseId}`, url: '/'
          }));
        }

        const hash = await getChainHead(env);
        await env.DB.prepare(`UPDATE student_excuses SET audit_hash = ? WHERE id = ?`).bind(hash, excuseId).run();

        const fresh = await env.DB.prepare(`SELECT * FROM student_excuses WHERE id = ?`).bind(excuseId).first<any>();
        return jsonOk({
          success: true, excuse: fresh, recordsAffected,
          message: newStatus === 'APROBADA'
            ? 'Excusa APROBADA: la ausencia queda "Excusada (verificada)".'
            : 'Excusa RECHAZADA: los registros vuelven a Ausente y el % se recalcula. El estudiante será notificado con el motivo.'
        });
      }
    }

    return jsonErr(`Método no permitido para ${path}.`, 405);
  } catch (err: any) {
    console.error('Excuses module error:', err);
    return jsonErr(err?.message || 'Error interno en el módulo de excusas.', 500);
  }
}
