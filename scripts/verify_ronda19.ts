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
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${passed} OK · ${failed} FALLOS · ${skipped} SKIP`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
