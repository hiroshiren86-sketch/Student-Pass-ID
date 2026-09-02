/**
 * Ronda 19 — Suite LOCAL (determinista, sin red). Ejecutar: bun scripts/verify_ronda19.ts
 * Cubre los arreglos del informe de testing del 2-sep-2026:
 *   BUG-1: escaneo en recreo/transición ya NO se registra como "1ª Hora + TARDANZA".
 *   BUG-2: KPI sin el 95% hardcodeado + presentes = estudiantes únicos.
 *   BUG-3: rateLimitMaxPerMin implementado de verdad.
 *   Hallazgos: columna Asignatura en planilla, Escape en modales del aula.
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
  // crypto.ts usa window.crypto.subtle (WebCrypto, correcto en navegador/Worker).
  // En bun, window no existe: alias al propio globalThis (crypto.subtle sí está disponible).
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
})();
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE LOCAL'); process.exit(2); }, 90000);

let passed = 0, failed = 0, skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function skip(name: string, reason: string) { skipped++; console.log(`  ⊘ ${name} (SKIP: ${reason})`); }
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n━━━ ${title} ━━━`);
  try { await fn(); }
  catch (e: any) { failed++; failures.push(`${title} (excepción: ${e?.message || e})`); console.log(`  ✗ EXCEPCIÓN: ${e?.message || e}`); }
}
function midMinutes(slot: { startTime: string; endTime: string }): string {
  const [sh, sm] = slot.startTime.split(':').map(Number);
  const [eh, em] = slot.endTime.split(':').map(Number);
  const mid = Math.floor(((sh * 60 + sm) + (eh * 60 + em)) / 2);
  return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}
// Busca código real, ignorando líneas de comentario (los comentarios citan el código viejo a propósito)
function inRealCode(src: string, needle: string): boolean {
  return src.split('\n').some(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return t.includes(needle); });
}

const { AttendanceStorageService } = await import('../src/services/attendanceStorage');
const { readFileSync } = await import('fs');

const svc: any = AttendanceStorageService;

// =====================================================================
await section('A. Estado base (demo determinista)', () => {
  svc.resetToDemo();
  const slots = svc.getScheduleSlots();
  check('plantilla demo con bloques CLASE y recreo', slots.some((s: any) => s.type === 'CLASS') && slots.some((s: any) => s.type !== 'CLASS'));
  const students = svc.getStudents();
  check('matrícula demo sembrada', students.length >= 40, `len=${students.length}`);
});

// =====================================================================
await section('B. BUG-1 — getCurrentActiveSlot distingue dentro/fuera de bloque', () => {
  const slots = svc.getScheduleSlots();
  const classSlot: any = slots.find((s: any) => s.type === 'CLASS');
  const nonClass: any = slots.find((s: any) => s.type !== 'CLASS');

  const inside = svc.getCurrentActiveSlot(midMinutes(classSlot));
  check('mitad de un bloque CLASE → isWithin TRUE', inside?.isWithin === true && inside.slot.id === classSlot.id);

  if (nonClass) {
    const recess = svc.getCurrentActiveSlot(midMinutes(nonClass));
    check('mitad del recreo → isWithin FALSE', recess?.isWithin === false, `slot=${recess?.slot?.id} within=${recess?.isWithin}`);
  } else {
    skip('recreo no presente en la plantilla', 'sin bloque no-CLASE');
  }

  // Antes de la primera hora (start - 1 min)
  const [sh, sm] = classSlot.startTime.split(':').map(Number);
  const beforeMin = sh * 60 + sm - 1;
  const before = svc.getCurrentActiveSlot(`${String(Math.floor(beforeMin / 60)).padStart(2, '0')}:${String(((beforeMin % 60) + 60) % 60).padStart(2, '0')}`);
  check('antes de la primera hora → isWithin FALSE', before?.isWithin === false, `within=${before?.isWithin}`);

  // Después de la última clase → isWithin FALSE
  const lastClass = slots.filter((s: any) => s.type === 'CLASS').sort((a: any, b: any) => (a.startTime > b.startTime ? 1 : -1)).pop();
  const [eh, em] = lastClass.endTime.split(':').map(Number);
  const afterMin = eh * 60 + em + 1;
  const after = svc.getCurrentActiveSlot(`${String(Math.floor(afterMin / 60)).padStart(2, '0')}:${String(afterMin % 60).padStart(2, '0')}`);
  check('después de la última clase → isWithin FALSE', after?.isWithin === false, `within=${after?.isWithin}`);
});

// =====================================================================
await section('C. BUG-1 — registerScan rechaza en recreo (sin contaminar planilla)', async () => {
  const slots = svc.getScheduleSlots();
  const nonClass: any = slots.find((s: any) => s.type !== 'CLASS');
  const student = svc.getStudents()[0];
  const baseline = svc.getAllAttendance().length;

  // Parche determinista: reloj FUERA de bloque (recreo)
  const original = svc.getCurrentActiveSlot;
  svc.getCurrentActiveSlot = () => nonClass
    ? { slot: slots.find((s: any) => s.type === 'CLASS'), isWithin: false, dayOfWeek: 4 }
    : null;

  const res = await svc.registerScan({ scanInput: student.code, method: 'USB' });
  check('escaneo en recreo → type no_active_slot', res?.type === 'no_active_slot', JSON.stringify(res?.type));
  check('NO se creó ningún registro', svc.getAllAttendance().length === baseline, `delta=${svc.getAllAttendance().length - baseline}`);
  if (nonClass) {
    check('mensaje apunta al próximo bloque', typeof res?.message === 'string' && (res.message.includes('próximo bloque') || res.message.includes('no quedan más bloques')), res?.message);
  }

  // Parche determinista: reloj DENTRO de bloque → sí registra (con jornada abierta simulada)
  const classSlot: any = slots.find((s: any) => s.type === 'CLASS');
  svc.getCurrentActiveSlot = () => ({ slot: classSlot, isWithin: true, dayOfWeek: 4 });
  const origWindow = svc.isWithinSchoolDay;
  svc.isWithinSchoolDay = () => true;
  try { svc.saveAttendance([]); } catch {}
  const res2 = await svc.registerScan({ scanInput: student.code, method: 'USB' });
  const ok2 = (res2?.type === 'success_punctual' || res2?.type === 'success_tardy') && res2?.record?.slotId === classSlot.id;
  check('escaneo dentro de bloque → registra con el bloque CORRECTO', ok2, JSON.stringify({ t: res2?.type, slot: res2?.record?.slotId }));

  // Restaurar
  svc.getCurrentActiveSlot = original;
  svc.isWithinSchoolDay = origWindow;
  svc.resetToDemo();
});

// =====================================================================
await section('D. BUG-1 — buildNoActiveSlotMessage (una sola fuente de verdad)', () => {
  const slots = svc.getScheduleSlots();
  const nonClass: any = slots.find((s: any) => s.type !== 'CLASS');
  if (nonClass) {
    const msg = svc.buildNoActiveSlotMessage(midMinutes(nonClass));
    check('en recreo: menciona el próximo bloque', msg.includes('El próximo bloque es'), msg);
  } else {
    skip('recreo no presente', 'sin bloque no-CLASE');
  }
  const lastClass = slots.filter((s: any) => s.type === 'CLASS').sort((a: any, b: any) => (a.startTime > b.startTime ? 1 : -1)).pop();
  const [eh, em] = lastClass.endTime.split(':').map(Number);
  const afterMin = eh * 60 + em + 1;
  const msg2 = svc.buildNoActiveSlotMessage(`${String(Math.floor(afterMin / 60)).padStart(2, '0')}:${String(afterMin % 60).padStart(2, '0')}`);
  check('sin más bloques: mensaje honesto', msg2.includes('no quedan más bloques'), msg2);
});

// =====================================================================
await section('E. BUG-2 — getSummary honesto (95% y presentes únicos)', () => {
  const DATE = '2026-05-21'; // fecha fija sin registros
  svc.saveAttendance([]);
  const empty = svc.getSummary(DATE);
  check('día sin registros → attendanceRate NULL', empty.attendanceRate === null, `rate=${empty.attendanceRate}`);
  check('día sin registros → totalPresent 0', empty.totalPresent === 0);

  // 4 registros: A puntual (2 bloques), B tardanza, C ausente → presentes ÚNICOS = 2
  const mk = (code: string, name: string, slotId: string, status: string): any => ({
    id: `rec-test-${code}-${slotId}`,
    studentCode: code, studentDocument: `DOC-${code}`, studentName: name,
    studentGrade: '10°1', studentSection: '1',
    slotId, slotName: `Bloque ${slotId}`, slotStartTime: '06:30', slotEndTime: '07:25',
    subject: 'Matemáticas', teacherName: 'Prof. Prueba',
    timestamp: `${DATE}T11:50:00.000Z`, date: DATE, time: '06:40:00',
    type: 'CLASE', status, method: 'USB', scannedBy: 'DOCENTE',
    verifiedHmac: false, synced: true
  });
  svc.saveAttendance([
    mk('1000000001', 'Ana Uno', 'slot-1', 'PUNTUAL'),
    mk('1000000001', 'Ana Uno', 'slot-2', 'PUNTUAL'), // re-escaneo en otro bloque
    mk('1000000002', 'Benito Dos', 'slot-1', 'TARDANZA'),
    mk('1000000003', 'Carla Tres', 'slot-1', 'AUSENTE')
  ]);
  const s = svc.getSummary(DATE);
  check('presentes = estudiantes ÚNICOS (2, no 3)', s.totalPresent === 2, `present=${s.totalPresent}`);
  check('puntuales/tardanzas/ausentes por registros (2/1/1)', s.punctualCount === 2 && s.tardyCount === 1 && s.absentCount === 1);
  check('tasa = presentes únicos / matrícula activa', s.attendanceRate === Math.min(100, Math.round((2 / s.totalEnrolled) * 100)), `rate=${s.attendanceRate} (matrícula ${s.totalEnrolled})`);
  check('tasa es consistente con el KPI (2 presentes de ' + s.totalEnrolled + ')', s.attendanceRate !== null && s.attendanceRate <= 100);
  svc.resetToDemo();
});

// =====================================================================
await section('F. BUG-3 — rateLimitMaxPerMin implementado', () => {
  const settings = svc.getSettings();
  svc.saveSettings({ ...settings, rateLimitMaxPerMin: 3 }, false);
  svc.scanAttemptTimestamps = [];

  const r1 = svc.checkScanRateLimit();
  const r2 = svc.checkScanRateLimit();
  const r3 = svc.checkScanRateLimit();
  const r4 = svc.checkScanRateLimit();
  check('3 primeros intentos permitidos', !r1.limited && !r2.limited && !r3.limited);
  check('4to intento BLOQUEADO', r4.limited === true, JSON.stringify(r4));
  check('retryAfterSec >= 1', r4.retryAfterSec >= 1, `sec=${r4.retryAfterSec}`);

  const settings2 = svc.getSettings();
  svc.saveSettings({ ...settings2, rateLimitMaxPerMin: 30 }, false);
  svc.scanAttemptTimestamps = [];
  check('config restaurada a 30/min', svc.checkScanRateLimit().maxPerMin === 30);
});

// =====================================================================
await section('G. Hallazgos de UI (verificación de fuente, como suite R18)', () => {
  const tcv = readFileSync('src/components/TeacherClassroomView.tsx', 'utf8');
  check('aula: Escape cierra modal Delegación (E10)', tcv.includes('setShowDelegationModal(false)') && tcv.includes("e.key === 'Escape'"));
  check('aula: rate limit activo en handleRegisterScan', tcv.includes('checkScanRateLimit'));

  const spv = readFileSync('src/components/StudentPortalView.tsx', 'utf8');
  check('representante: guarda isWithin antes de registrar', spv.includes('!activeSlotInfo.isWithin'));
  check('representante: rate limit activo', spv.includes('checkScanRateLimit'));
  check('representante: expresión-bug eliminada del registro', !inRealCode(spv, "activeSlotInfo?.slot.id || 'slot-1'"));

  const storage = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('servicio: expresión-bug eliminada de registerScan', !inRealCode(storage, "activeSlotInfo?.slot.id || 'slot-1'"));
  check('servicio: devuelve no_active_slot', storage.includes("type: 'no_active_slot'"));

  const types = readFileSync('src/types/attendance.ts', 'utf8');
  check('tipos: no_active_slot en la unión de feedback', types.includes("'no_active_slot'"));
  check('tipos: attendanceRate nullable', types.includes('attendanceRate: number | null'));

  const arv = readFileSync('src/components/AttendanceReportsView.tsx', 'utf8');
  check('planilla: columna Asignatura en pantalla', arv.includes('>Asignatura</th>'));
  check('planilla: mensaje "Sin registros en esta fecha"', arv.includes('Sin registros en esta fecha'));

  const shv = readFileSync('src/components/ScanHubView.tsx', 'utf8');
  check('escáner central: rate limit + estilos de los 2 nuevos estados', shv.includes('checkScanRateLimit') && shv.includes("lastFeedback.type === 'no_active_slot'"));
});

// =====================================================================
await section('H. QR de Clase — token CLASE:v1 (cripto)', async () => {
  const crypto = await import('../src/utils/crypto');
  const settings = svc.getSettings();
  const secret = settings.qrSecret;

  const token = await crypto.generateClassQrPayload('10°1', 'slot-4', 4, Date.now() + 3600_000, secret);
  check('payload con prefijo CLASE:v1', token.startsWith('CLASE:v1:'), token);

  const ok = await crypto.parseAndVerifyClassScan(token, secret);
  check('token válido: formato + firma', ok.isClassToken && ok.isValidFormat && ok.isSignatureValid === true);
  check('campos redondean (grade/slot/day)', ok.grade === '10°1' && ok.slotId === 'slot-4' && ok.dayOfWeek === 4);

  const tampered = token.replace(/.$/, token.endsWith('a') ? 'b' : 'a');
  const bad = await crypto.parseAndVerifyClassScan(tampered, secret);
  check('token alterado → firma inválida', bad.isClassToken && bad.isSignatureValid === false);

  const expired = await crypto.generateClassQrPayload('10°1', 'slot-4', 4, Date.now() - 1000, secret);
  const ex = await crypto.parseAndVerifyClassScan(expired, secret);
  check('token expirado → rechazado', ex.isExpired === true && ex.isSignatureValid === false);

  const carné = 'IEDSJ:v1:SJ-0001:doc:10°1:1:9999999999999:abcdef';
  const notClass = await crypto.parseAndVerifyClassScan(carné, secret);
  check('carné IEDSJ NO se confunde con CLASE', notClass.isClassToken === false);
});

// =====================================================================
await section('I. QR de Clase — activación del contexto (servicio)', async () => {
  const crypto = await import('../src/utils/crypto');
  const settings = svc.getSettings();
  const todayDow = new Date().getDay();
  const slots = svc.getScheduleSlots();
  const classSlot: any = slots.filter((s: any) => s.type === 'CLASS')[0];
  const assignments = svc.getScheduleAssignments();
  const asg = assignments.find((a: any) => a.grade === '10°1' && a.slotId === classSlot.id && a.dayOfWeek === (todayDow || 1));

  // Token del DÍA de hoy (para pasar la validación de día) — si hoy es domingo (0), se espera rechazo por día
  if (todayDow >= 1 && todayDow <= 6) {
    const token = await crypto.generateClassQrPayload('10°1', classSlot.id, todayDow, Date.now() + 3600_000, settings.qrSecret);
    svc.resetToDemo();
    const res = await svc.setActiveClassFromToken(token);
    check('activación OK → class_activated', res.type === 'class_activated', JSON.stringify(res));
    const ctx = svc.getActiveClass();
    check('contexto activo con datos correctos', !!ctx && ctx.grade === '10°1' && ctx.slotId === classSlot.id && ctx.expiresAt > Date.now());
    check('materia resuelta de la asignación vigente', !!ctx && (asg ? ctx.subject === asg.subject : ctx.subject === 'Cátedra General'), ctx?.subject);
    check('activación registrada como QR_CLASE', ctx?.activatedBy === 'QR_CLASE');

    svc.clearActiveClass();
    check('clearActiveClass apaga el contexto', svc.getActiveClass() === null);

    // Token de OTRO día → rechazo por día incorrecto
    const otherDay = todayDow === 5 ? 1 : 5; // 1..5 (evita domingo 0 / sábado 6 imposibles en el par)
    const tokenOtherDay = await crypto.generateClassQrPayload('10°1', classSlot.id, otherDay === todayDow ? 1 : otherDay, Date.now() + 3600_000, settings.qrSecret);
    const resOtherDay = await svc.setActiveClassFromToken(tokenOtherDay);
    check('QR de otro día → rechazado con mensaje claro', resOtherDay.type === 'error' && resOtherDay.message.includes('hoy es'), resOtherDay.message);
  } else {
    skip('validación de día en vivo', 'hoy es domingo (0)');
  }

  // QR de otro día (fijo, sin depender de hoy): día 99 no existe; usar token con día distinto del actual
  const wrongDayToken = await crypto.generateClassQrPayload('10°1', 'slot-1', (todayDow + 1) % 7, Date.now() + 3600_000, settings.qrSecret);
  const resWrong = await svc.setActiveClassFromToken(wrongDayToken);
  check('QR de día ≠ hoy SIEMPRE rechazado', resWrong.type === 'error', resWrong.title);
});

// =====================================================================
await section('J. QR de Clase — vinculación de escaneos (contexto > reloj)', async () => {
  const crypto = await import('../src/utils/crypto');
  const settings = svc.getSettings();
  const todayDow = new Date().getDay();
  const student10 = svc.getStudents().find((s: any) => s.grade === '10°1');
  const student6 = svc.getStudents().find((s: any) => s.grade !== '10°1');
  const slots = svc.getScheduleSlots();
  const classSlot: any = slots.filter((s: any) => s.type === 'CLASS')[0];
  const assignments = svc.getScheduleAssignments();
  const asg = assignments.find((a: any) => a.grade === '10°1' && a.slotId === classSlot.id && a.dayOfWeek === (todayDow || 1));

  // Caso A: reloj FUERA de bloque (parche isWithin false) + clase activa del MISMO grado → registra con contexto del QR
  const original = svc.getCurrentActiveSlot;
  const origWindow = svc.isWithinSchoolDay;
  try {
    if (todayDow >= 1 && todayDow <= 6) {
      svc.resetToDemo();
      svc.saveAttendance([]);
      const token = await crypto.generateClassQrPayload('10°1', classSlot.id, todayDow, Date.now() + 3600_000, settings.qrSecret);
      await svc.setActiveClassFromToken(token);

      svc.getCurrentActiveSlot = () => ({ slot: classSlot, isWithin: false, dayOfWeek: todayDow });
      svc.isWithinSchoolDay = () => true;

      const res = await svc.registerScan({ scanInput: student10.code, method: 'USB' });
      const okA = (res.type === 'success_punctual' || res.type === 'success_tardy')
        && res.record?.slotId === classSlot.id
        && res.record?.contextSource === 'QR_CLASE'
        && res.record?.classQrVerified === true
        && (asg ? res.record?.subject === asg.subject : true);
      check('mismo grado + clase activa → registro con contextSource QR_CLASE', okA, JSON.stringify({ t: res.type, slot: res.record?.slotId, ctx: res.record?.contextSource, subj: res.record?.subject }));

      // Caso B: grado distinto → el contexto es una lente, no una puerta → ruta clásica (HORA)
      svc.getCurrentActiveSlot = () => ({ slot: classSlot, isWithin: true, dayOfWeek: todayDow });
      const resB = await svc.registerScan({ scanInput: student6.code, method: 'USB' });
      const okB = (resB.type === 'success_punctual' || resB.type === 'success_tardy') && resB.record?.contextSource === 'HORA';
      check('grado distinto → ruta clásica HORA (lente, no puerta)', okB, JSON.stringify({ t: resB.type, ctx: resB.record?.contextSource }));

      // Caso C: sin clase activa + reloj dentro → HORA (comportamiento clásico intacto)
      svc.clearActiveClass();
      const studentOther = svc.getStudents().find((s: any) => s.code !== student10.code && s.code !== student6.code);
      const resC = await svc.registerScan({ scanInput: studentOther.code, method: 'USB' });
      const okC = (resC.type === 'success_punctual' || resC.type === 'success_tardy') && resC.record?.contextSource === 'HORA';
      check('sin clase activa → fallback clásico intacto (HORA)', okC, JSON.stringify({ t: resC.type, ctx: resC.record?.contextSource }));
    } else {
      skip('vinculación en vivo', 'hoy es domingo (0)');
    }
  } finally {
    svc.getCurrentActiveSlot = original;
    svc.isWithinSchoolDay = origWindow;
    svc.resetToDemo();
  }
});

// =====================================================================
await section('K. QR de Clase — transparencia en planilla/CSV (fuente)', () => {
  const storage = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('CSV con columna Contexto de Vinculación', storage.includes('Contexto de Vinculación') && storage.includes("r.contextSource === 'QR_CLASE' ? 'QR de Clase (firmado)'"));
  check('registro persiste contextSource/classQrVerified', storage.includes("contextSource: params.contextSource || 'HORA'") && storage.includes('classQrVerified: params.classQrVerified'));
  check('registerScan aplica contexto de clase activa', storage.includes("student.grade === activeClass.grade") && storage.includes("contextSource: 'QR_CLASE'"));
  check('resetToDemo limpia la clase activa', storage.includes('localStorage.removeItem(ACTIVE_CLASS_KEY)'));

  const types = readFileSync('src/types/attendance.ts', 'utf8');
  check('AttendanceRecord con contextSource', types.includes("contextSource?: 'QR_CLASE' | 'HORA'"));
  check('ActiveClassContext tipado', types.includes('interface ActiveClassContext'));

  const arv = readFileSync('src/components/AttendanceReportsView.tsx', 'utf8');
  check('planilla: badge QR en Asignatura', arv.includes("r.contextSource === 'QR_CLASE'"));

  const shv = readFileSync('src/components/ScanHubView.tsx', 'utf8');
  check('terminal: ruta CLASE:v1 antes del límite de tasa', shv.includes("startsWith('CLASE:v1:')") && shv.includes('setActiveClassFromToken'));
  check('terminal: ActiveClassBanner montado', shv.includes('<ActiveClassBanner />'));

  const spv = readFileSync('src/components/StudentPortalView.tsx', 'utf8');
  check('representante: ruta CLASE:v1 + banner', spv.includes("startsWith('CLASE:v1:')") && spv.includes('<ActiveClassBanner />'));

  const tcv = readFileSync('src/components/TeacherClassroomView.tsx', 'utf8');
  check('aula: botón Activar en este dispositivo + banner', tcv.includes('activateClassDirect') && tcv.includes('<ActiveClassBanner />'));

  const sbv = readFileSync('src/components/ScheduleBuilderView.tsx', 'utf8');
  check('horarios: pestaña QR de Clase con tarjeta descargable', sbv.includes("'class-qr'") && sbv.includes('generateClassQrPayload') && sbv.includes('Descargar PNG'));
  check('horarios: tarjeta QR cierra con Escape', sbv.includes('setClassQrModal(null)') && sbv.includes("e.key === 'Escape'"));

  const crypto = readFileSync('src/utils/crypto.ts', 'utf8');
  check('crypto: protocolo CLASE:v1 completo', crypto.includes('generateClassQrPayload') && crypto.includes('parseAndVerifyClassScan') && crypto.includes('CLASE:v1:'));
});

// =====================================================================
await section('L. Importación masiva de horarios (CSV tolerante, sin fallbacks silenciosos)', () => {
  svc.resetToDemo();
  const baseAssignments = svc.getScheduleAssignments().length;

  // Con encabezado + coma + nombres de día con tilde + grado con guion + bloque por nombre
  const csvHeader = 'día,grado,bloque,materia,docente,aula\nLunes,10-1,1ª Hora de Clase,Álgebra,Juan Pablo Pérez Gómez,204\nMARTES,10°1,2,Ciencias,,,';
  const r1 = svc.parseScheduleImport(csvHeader);
  check('encabezado detectado + 2 filas válidas', r1.detectedHeader && r1.rows.length === 2, JSON.stringify(r1.errors));
  check('grado normalizado 10-1 → 10°1', r1.rows[0]?.grade === '10°1');
  check('bloque por nombre → slot-1', r1.rows[0]?.slotId === 'slot-1');
  check('bloque por ordinal 2 → slot-2', r1.rows[1]?.slotId === 'slot-2');
  check('docente emparejado por nombre (insensible a mayúsculas)', r1.rows[0]?.teacherId !== undefined, r1.rows[0]?.teacherName);
  check('docente vacío → Docente Titular', r1.rows[1]?.teacherName === 'Docente Titular');

  // Con punto y coma (Excel colombiano) y sin encabezado
  const r2 = svc.parseScheduleImport('miércoles;6-1;1;Lengua;María Camila Restrepo Henao');
  check('delimitador ";" sin encabezado', !r2.detectedHeader && r2.delimiter === ';' && r2.rows.length === 1, JSON.stringify(r2.errors));
  check('día "MIÉRCOLES" con tilde → 3', r2.rows[0]?.dayOfWeek === 3);

  // Errores de línea (nada se adivina): día malo, grado inexistente, bloque malo, materia vacía
  const r3 = svc.parseScheduleImport('domingo,10°1,1,X\nLunes,99-9,1,X\nLunes,10°1,99,X\nLunes,10°1,1,\nLunes,10°1,1,Química');
  check('4 errores y 1 fila válida', r3.errors.length === 4 && r3.rows.length === 1, JSON.stringify(r3.errors));
  check('errores con número de línea y mensaje concreto', r3.errors.every(e => e.startsWith('Línea ')) && r3.errors[0].includes('día no reconocido'));
  check('fila válida sobrevive entre errores (Química)', r3.rows[0]?.subject === 'Química');

  // Apply sin wipe: upsert, no duplica
  const before = svc.getScheduleAssignments().length;
  const app1 = svc.applyScheduleImport(r1.rows);
  const after = svc.getScheduleAssignments().length;
  check('aplica 2 cátedras', app1.applied === 2);
  check('upsert: sin duplicados para la misma celda', after - before <= 2, `delta=${after - before}`);

  // Apply con wipe escopado: SOLO borra los cursos incluidos
  const csvMore = 'día,grado,bloque,materia\nLunes,10°1,1,Álgebra\nLunes,6°1,1,Lectura';
  const r4 = svc.parseScheduleImport(csvMore);
  const app2 = svc.applyScheduleImport(r4.rows, { wipeIncludedGrades: true });
  const now10 = svc.getScheduleAssignments().filter(a => a.grade === '10°1');
  const now11 = svc.getScheduleAssignments().filter(a => a.grade === '11°1');
  check('wipe escopado: 10°1 solo tiene lo importado', app2.removed > 0 && now10.length === 1, `removed=${app2.removed} now10=${now10.length}`);
  check('wipe escopado NO toca cursos no incluidos (11°1)', now11.length > 0);
  check('cátedra importada con materia correcta', now10[0]?.subject === 'Álgebra');

  svc.resetToDemo();
  const restored = svc.getScheduleAssignments().length;
  check('resetToDemo restaura el estado (independencia de pruebas)', restored === baseAssignments, `base=${baseAssignments} now=${restored}`);
});

// =====================================================================
await section('M. Importación — integración UI (fuente, como suite R18)', () => {
  const sbv = readFileSync('src/components/ScheduleBuilderView.tsx', 'utf8');
  check('botón Importar CSV en la vista Por Día', sbv.includes('Importar CSV') && sbv.includes('parseScheduleImport'));
  check('flujo Validar → previsualización → Aplicar (con borrado escopado opcional)', sbv.includes('applyScheduleImport') && sbv.includes('wipeIncludedGrades'));
  check('modal de importación cierra con Escape', sbv.includes('setShowImportModal(false)') && sbv.includes("e.key === 'Escape'"));

  const storage = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('importador legado con fallback silencioso ELIMINADO', !storage.includes('importMasterScheduleCsvOrJson'));
  check('sin fallback a "primer bloque CLASE" en el importador', !storage.includes('matchedSlot = slots.find(s => s.type'));
});

// =====================================================================
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${passed} OK · ${failed} FALLOS · ${skipped} SKIP`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
