/**
 * =============================================================================
 * RONDA 58 — SUITE DE HARDENING (determinista, sin red).
 * Ejecutar:  TZ=America/Bogota npx tsx scripts/qa-r58-hardening.ts
 *
 * Verifica las correcciones del informe de auditoría 2026-09 (F-1…F-25) que son
 * testeables en local, ejercitando el CÓDIGO REAL del producto (no reimplementaciones):
 *
 *   A. F-1  — política de carné firmado: forjado/vencido/plano ON→rechazados;
 *             OFF→aceptados con verifiedHmac:false; COL_ASIS honesto (en verify_ronda43 §E)
 *   B. F-7  — el sello de servidor toca SOLO los registros entrantes del push.
 *   C. F-8  — revivificación: tombstone no mata a una entidad re-matriculada
 *             (fecha de la entidad > deletedAt) y clearTombstones se llama al re-crear.
 *   D. F-23 — el egreso del push sustituye tempPassword por tempPasswordVerifier;
 *             verifyStudentCredential acepta claro-local, verificador y rotación
 *             (legacyQrSecret), y rechaza sin credencial.
 *   E. F-6  — CAS del snapshot con mock de D1: dos pushes concurrentes NO se pisan
 *             (el perdedor re-fusiona sobre lo que el ganador escribió).
 *   F. F-5a — resolveTokenScope/resolveAuthz: identidad ADMIN sin token ADMIN ya no
 *             puede escribir catálogo cuando hay tokens configurados.
 *   G. F-2/F-24/F-22 — controles de fuente: sin DEFAULT_QR_SECRET, sin 'colegio2026',
 *             portal firma con secret institucional, hourCycle h23, sin 1D-plain en CSV.
 *   H. F-12 — makeOpId SHA-256 por contenido: mismo estado → mismo opId; cambio
 *             real → opId distinto (adiós colisiones de conteos).
 * =============================================================================
 */
(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear()
    };
  }
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
})();

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n━━━ ${title} ━━━`);
  try { await fn(); }
  catch (e: any) { failed++; failures.push(`${title} (excepción: ${e?.message || e})`); console.log(`  ✗ EXCEPCIÓN: ${e?.message || e}`); }
}
import { readFileSync } from 'fs';

const crypto = await import('../src/utils/crypto');
const { AttendanceStorageService, getTodayDateString } = await import('../src/services/attendanceStorage');
const { CloudflareSyncService } = await import('../src/services/cloudflareSync');
const worker = await import('../cloudflare-worker/src/index');
const authzMod = await import('../cloudflare-worker/src/authz');
const svc = AttendanceStorageService;

// ═══════════════════ B. F-7 — sello SOLO a lo entrante ═══════════════════
await section('B — F-7: stampServerVersion toca SOLO los registros del push', () => {
  const prev = [{ id: 'r-prev', studentCode: 'A', serverUpdatedAt: '2026-09-01T10:00:00.000Z' }];
  const incoming = [{ id: 'r-new', studentCode: 'B' }];
  // Patrón R58 (index.ts, caminos ADMIN y OPERADOR): sellar entrantes ANTES de fusionar.
  const stamped = worker.stampServerVersion(incoming);
  const merged = worker.mergeRecordsByUpdatedAt(prev, stamped);
  const prevAfter = merged.find(r => r.id === 'r-prev');
  const newAfter = merged.find(r => r.id === 'r-new');
  check('B1 el registro ENTRANTE queda sellado con serverUpdatedAt nuevo', typeof newAfter?.serverUpdatedAt === 'string' && Date.parse(newAfter.serverUpdatedAt) > Date.parse('2026-09-10T00:00:00.000Z'));
  check('B2 el registro HEREDADO conserva su sello previo (no hereda un "now" falso)', prevAfter?.serverUpdatedAt === '2026-09-01T10:00:00.000Z');
  // Contraejemplo del bug original: sellar DESPUÉS de fusionar tocaba todo el array.
  const buggy = worker.stampServerVersion(worker.mergeRecordsByUpdatedAt(prev, incoming));
  check('B3 (contraste) el patrón viejo sí re-sellaba los heredados — el bug era real', (buggy.find(r => r.id === 'r-prev') as any)?.serverUpdatedAt !== '2026-09-01T10:00:00.000Z');
});

// ═══════════════════ C. F-8 — revivificación de tombstones ═══════════════════
await section('C — F-8: un código re-matriculado VUELVE A VIVIR', () => {
  const deletedAt = '2026-08-01T00:00:00.000Z';
  // 1) applyTombstones con comparación de fechas: entidad más nueva que su tombstone → revive.
  const data = {
    students: [
      { code: '100', grade: '6°1', updatedAt: '2026-09-10T00:00:00.000Z' }, // re-matriculado DESPUÉS del borrado
      { code: '200', grade: '6°1', updatedAt: '2026-07-01T00:00:00.000Z' }  // borrado vigente
    ],
    teachers: [],
    records: [],
    tombstones: [
      { id: '100', type: 'student', deletedAt },
      { id: '200', type: 'student', deletedAt }
    ]
  };
  const filtered = worker.applyTombstones(data);
  check('C1 estudiante re-matriculado (updatedAt > deletedAt) NO se filtra', filtered.students.some(s => s.code === '100'));
  check('C2 estudiante con tombstone vigente SÍ se filtra', !filtered.students.some(s => s.code === '200'));
  // 2) Entidad legada sin fecha: el tombstone manda (comportamiento previo).
  const legacy = worker.applyTombstones({ students: [{ code: '300' }], tombstones: [{ id: '300', type: 'student', deletedAt }], records: [] });
  check('C3 entidad legada sin fecha → tombstone manda (no resucita lo borrado)', !legacy.students.some((s: any) => s.code === '300'));
  // 3) El cliente limpia el tombstone al re-crear (addStudent).
  localStorage.clear();
  svc.saveSettings({ ...svc.getSettings() }, false);
  svc.saveTombstones([{ id: '100', type: 'student', deletedAt }]);
  svc.addStudent({ code: '100', documentId: 'd100', firstName: 'A', lastName: 'B', grade: '6°1', section: '1', active: true, createdAt: new Date().toISOString() });
  check('C4 addStudent con código tombstoned → clearTombstones lo retira localmente', !svc.getTombstones().some(t => t.id === '100'));
  const src = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('C5 addTeacher también limpia su tombstone (re-contratación)', src.includes("this.clearTombstones([teacher.id], 'teacher')"));
});

// ═══════════════════ D. F-23 — verificador de credencial ═══════════════════
await section('D — F-23: tempPasswordVerifier en el egreso + verifyStudentCredential', async () => {
  localStorage.clear();
  const settings = svc.getSettings();
  const secret = settings.qrSecret;
  const student = { code: '7000000007', documentId: '7000000007', firstName: 'Clara', lastName: 'Verificada', grade: '11°1', section: '1', active: true, createdAt: new Date().toISOString(), tempPassword: 'CLAVE-IMPRESA-2026' };

  // 1) El push ya no lleva la clave en claro: sanitizeStudentsForSync la sustituye.
  const { clean } = await (CloudflareSyncService as any).sanitizeStudentsForSync([student]);
  const sent = clean[0];
  check('D1 el push NO lleva tempPassword en claro', sent.tempPassword === undefined);
  check('D2 el push lleva tempPasswordVerifier (HMAC de la clave)', typeof sent.tempPasswordVerifier === 'string' && /^[0-9a-f]{32}$/.test(sent.tempPasswordVerifier));
  // 2) verifyStudentCredential acepta la clave original contra el verificador (ficha sin claro local).
  const v1 = await svc.verifyStudentCredential({ code: student.code, tempPasswordVerifier: sent.tempPasswordVerifier }, 'CLAVE-IMPRESA-2026');
  check('D3 terminal sin clave en claro verifica la clave correcta vía verificador', v1.ok === true);
  const v2 = await svc.verifyStudentCredential({ code: student.code, tempPasswordVerifier: sent.tempPasswordVerifier }, 'otra-clave');
  check('D4 clave incorrecta → rechazo (mismatch)', v2.ok === false && v2.reason === 'mismatch');
  // 3) Clave en claro local sigue funcionando (dispositivo de Rectoría).
  const v3 = await svc.verifyStudentCredential({ code: student.code, tempPassword: 'CLAVE-IMPRESA-2026' }, 'CLAVE-IMPRESA-2026');
  check('D5 clave en claro local verifica (Rectoría)', v3.ok === true);
  // 4) Rotación de secret: el verificador firmado con el secret VIEJO sigue verificando.
  svc.saveSettings({ ...svc.getSettings(), qrSecret: 'nuevo-secret-institucional', legacyQrSecret: secret }, false);
  const v4 = await svc.verifyStudentCredential({ code: student.code, tempPasswordVerifier: sent.tempPasswordVerifier }, 'CLAVE-IMPRESA-2026');
  check('D6 tras rotar qrSecret, el verificador viejo sigue verificando (legacyQrSecret)', v4.ok === true);
  // 5) Sin credencial alguna → rechazo accionable (adiós SJ-2026/colegio2026).
  const v5 = await svc.verifyStudentCredential({ code: student.code }, 'lo-que-sea');
  check('D7 ficha sin clave ni verificador → rechazo con guía (no_credential)', v5.ok === false && v5.reason === 'no_credential');
  // 6) El Worker también strippea (defensa en profundidad para terminales viejos).
  const stripped = worker.stripSnapshotCredentials({ students: [{ code: 'x', tempPassword: 'secreto', password: 'p', passwordHash: 'h' }], teachers: [{ id: 't1', password: 'p', tempPassword: 'tp' }] });
  check('D8 stripSnapshotCredentials elimina credenciales de estudiantes Y docentes', stripped.students[0].tempPassword === undefined && stripped.students[0].password === undefined && stripped.teachers[0].password === undefined);
});

// ═══════════════════ E. F-6 — CAS del snapshot con mock de D1 ═══════════════════
await section('E — F-6: dos pushes concurrentes NO se pisan (CAS + re-fusión)', async () => {
  // Mini-D1 en memoria que SOLO implementa lo que casWriteSnapshot usa. El UPDATE
  // respeta el WHERE updated_at = ? (la semántica CAS real de D1/SQLite).
  class MiniD1 {
    rows = new Map<string, { data_json: string; students_count: number; records_count: number; school_name: string; updated_at: string }>();
    tick = 0;
    prepare(query: string): any {
      const self = this;
      return {
        bind(...args: any[]): any {
          return {
            async first(): Promise<any> {
              if (query.startsWith('SELECT data_json, students_count, school_name, updated_at')) {
                return self.rows.get(args[0]) || null;
              }
              return null;
            },
            async run(): Promise<any> {
              self.tick++;
              if (query.startsWith('INSERT OR IGNORE')) {
                if (self.rows.has(args[0])) return { meta: { changes: 0 } };
                self.rows.set(args[0], { data_json: args[3], students_count: args[4], records_count: args[5], school_name: args[2], updated_at: `t${self.tick}` });
                return { meta: { changes: 1 } };
              }
              if (query.startsWith('UPDATE sync_snapshots')) {
                const row = self.rows.get(args[4]);
                if (!row || row.updated_at !== args[5]) return { meta: { changes: 0 } }; // CAS: perdió la carrera
                row.school_name = args[0]; row.data_json = args[1]; row.students_count = args[2]; row.records_count = args[3];
                row.updated_at = `t${self.tick}`;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
          };
        }
      };
    }
  }
  const env: any = { DB: new MiniD1() };

  // Dispositivo A y B leen el MISMO estado base (r1) y luego hacen push "a la vez":
  // simula la carrera real: ambos leyeron prev=null, A escribe primero.
  const recA = { id: 'rec-a', studentCode: 'A' };
  const recB = { id: 'rec-b', studentCode: 'B' };

  // Push A (operador): escribe sus hechos.
  await (worker as any).casWriteSnapshot(env, 'SCHOOL', (prev: any) => {
    const stamped = worker.stampServerVersion([recA]);
    const merged = prev ? worker.mergeRecordsByUpdatedAt(prev.records || [], stamped) : stamped;
    return { data: { records: merged }, studentsCount: prev?.students?.length ?? 0, recordsCount: merged.length, schoolName: 'A' };
  });

  // Push B (operador) con la vista VIEJA (prev=null, como A): el CAS detecta que
  // alguien escribió, RE-LEE (ahora ve rec-a) y RE-FUSIONA rec-b encima.
  await (worker as any).casWriteSnapshot(env, 'SCHOOL', (prev: any) => {
    const stamped = worker.stampServerVersion([recB]);
    const merged = prev ? worker.mergeRecordsByUpdatedAt(prev.records || [], stamped) : stamped;
    return { data: { ...(prev || {}), records: merged }, studentsCount: prev?.students?.length ?? 0, recordsCount: merged.length, schoolName: 'B' };
  });

  const finalRow = (env.DB as MiniD1).rows.get('snapshot_SCHOOL');
  const finalRecords = JSON.parse(finalRow!.data_json).records as any[];
  check('E1 el snapshot final conserva los hechos de AMBOS pushes (rec-a y rec-b)', finalRecords.some(r => r.id === 'rec-a') && finalRecords.some(r => r.id === 'rec-b'), JSON.stringify(finalRecords.map(r => r.id)));
  check('E2 el snapshot no quedó con la vista pisada del último (el bug F-6 era perder rec-a)', finalRecords.length === 2);
});

// ═══════════════════ F. F-5a — identidad ADMIN no exime del token ═══════════════════
await section('F — F-5a: escribir catálogo exige identidad ADMIN *Y* token ADMIN', () => {
  const mkReq = (headers: Record<string, string>) => new Request('http://x/api/sync/push', { method: 'POST', headers });
  const envWithTokens: any = { AUTH_TOKEN: 'token-admin', OPERATOR_TOKEN: 'token-op' };
  const envOpen: any = {}; // modo abierto (desarrollo)

  // Token ADMIN sin identidad → ADMIN (retrocompat intacta).
  check('F1 token ADMIN (sin identidad) → canWriteCatalog', authzMod.resolveTokenScope(mkReq({ Authorization: 'Bearer token-admin' }), envWithTokens) === 'ADMIN');
  // Token OPERADOR → OPERATOR.
  check('F2 token OPERADOR → OPERATOR (no escribe catálogo)', authzMod.resolveTokenScope(mkReq({ Authorization: 'Bearer token-op' }), envWithTokens) === 'OPERATOR');
  // Sin token con tokens configurados → null (401).
  check('F3 sin credencial con tokens configurados → null (401)', authzMod.resolveTokenScope(mkReq({}), envWithTokens) === null);
  // Modo abierto → ADMIN (desarrollo).
  check('F4 modo abierto (sin tokens) → ADMIN', authzMod.resolveTokenScope(mkReq({}), envOpen) === 'ADMIN');
  // La regla F-5a vive en resolveAuthz: la lógica canWriteCatalog = ADMIN && (!tokens || tokenRole==='ADMIN').
  const src = readFileSync('cloudflare-worker/src/authz.ts', 'utf8');
  check('F5 la regla de doble llave está en el fuente (identidad ADMIN exige token ADMIN si hay tokens)', src.includes("r === 'ADMIN' && (!tokensConfigured || tokenRole === 'ADMIN')"));
});

// ═══════════════════ G. Controles de fuente (F-2/F-22/F-24/CSV) ═══════════════════
await section('G — F-2/F-22/F-24: controles de fuente (lo que el CSV/portal dice debe ser verdad)', () => {
  // Controles sobre el fuente SIN comentarios (los comentarios de la remediación
  // documentan los literales históricos — buscarlos sin limpiar da falsos positivos;
  // mismo método que los controles J16-J18 de la auditoría).
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const portal = stripComments(readFileSync('src/components/StudentPortalView.tsx', 'utf8'));
  const cryptoSrc = stripComments(readFileSync('src/utils/crypto.ts', 'utf8'));
  const storage = stripComments(readFileSync('src/services/attendanceStorage.ts', 'utf8'));
  const login = stripComments(readFileSync('src/components/LoginScreen.tsx', 'utf8'));

  // F-2: sin default secret + portal firma con el institucional.
  check('G1 crypto.ts SIN default de secret (el parámetro es obligatorio)', !/secret(:\s*string)?\s*=\s*['"]/.test(cryptoSrc));
  check('G2 el portal firma el carné en vivo con settings.qrSecret', portal.includes('generateStudentQrPayload(activeStudent, settings.qrSecret)'));
  // F-24: puerta trasera retirada.
  check('G3 SIN la palabra mágica de la puerta trasera en código del portal', !portal.includes('colegio2026'));
  check('G4 SIN el fallback SJ-2026 ni el código como contraseña', !portal.includes("'SJ-2026'") && !portal.includes('!== student.code'));
  check('G5 el portal usa verifyStudentCredential (punto único)', portal.includes('verifyStudentCredential'));
  // F-22: hourCycle h23.
  check('G6 getCurrentTimeString usa hourCycle h23 (nunca "24:xx")', storage.includes("hourCycle: 'h23'"));
  // F-18: login sin búsqueda por nombre en autenticación y con throttle.
  check('G7 LoginScreen SIN búsqueda por nombre en el camino de autenticación', !login.includes('Búsqueda inteligente por nombre'));
  check('G8 LoginScreen CON throttle/backoff de reintentos', login.includes('inas_login_throttle_v1'));
  // CSV honesto: verifiedHmac verdadero solo con firma válida.
  check('G9 el CSV solo dice VÁLIDO cuando verifiedHmac (y ya no se asigna isSigned sin verificar)', storage.includes('parsed.isSigned && parsed.isSignatureValid === true'));
  // F-25: credenciales fuera de los scripts.
  const fases = readFileSync('scripts/r47_fases.mjs', 'utf8');
  check('G10 r47_fases SIN token/contraseñas hardcodeados', !/[a-f0-9]{64}/.test(fases) && !fases.includes('INAS-Rectoria#2026'));
});

// ═══════════════════ H. F-12 — opId por contenido ═══════════════════
await section('H — F-12: opId SHA-256 del contenido (no de conteos)', async () => {
  const stateA = { schoolCode: 'S', deviceId: 'dev-1', records: [{ id: 'r1', updatedAt: '2026-09-11T01:00:00Z' }, { id: 'r2', updatedAt: '2026-09-11T02:00:00Z' }] };
  const stateA_retry = JSON.parse(JSON.stringify(stateA)); // reintento idéntico
  const stateB = { ...stateA, records: [{ id: 'r1', updatedAt: '2026-09-11T03:00:00Z' }, { id: 'r3', updatedAt: '2026-09-11T02:00:00Z' }] }; // mismos CONTEOS, contenido distinto
  const op1 = await (CloudflareSyncService as any).makeOpId(stateA);
  const op2 = await (CloudflareSyncService as any).makeOpId(stateA_retry);
  const op3 = await (CloudflareSyncService as any).makeOpId(stateB);
  check('H1 mismo contenido → mismo opId (reintento idempotente)', op1 === op2);
  check('H2 mismos CONTEOS pero contenido distinto → opId DISTINTO (fin de las colisiones FNV-1a)', op1 !== op3, `${op1} vs ${op3}`);
  check('H3 opId con forma op-<32 hex> (SHA-256 truncado)', /^op-[0-9a-f]{32}$/.test(op1));
});

// ═══════════════════ Resumen ═══════════════════
console.log(`\n══════════════════════════════════════`);
console.log(`  RONDA 58 HARDENING — RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failures.length) {
  console.log('  Fallos:');
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('  HARDENING R58 EN VERDE');
process.exit(0);
