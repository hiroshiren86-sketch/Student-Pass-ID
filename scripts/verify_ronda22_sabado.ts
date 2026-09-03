/**
 * Ronda 22 — Suite LOCAL (determinista, sin red). Ejecutar: bun scripts/verify_ronda22_sabado.ts
 * Verifica la eliminación del sábado de la jornada escolar (petición del propietario):
 *   1. Guard protector: getSchoolDayWindow → null en sábado y domingo.
 *   2. Parser CSV horario personal: rechaza "Sábado"/"sabado"/"6" con mensaje explícito.
 *   3. Parser CSV importación masiva: rechaza sábado/día 6 con mensaje explícito.
 *   4. Validación de cátedras (upsertTeacherAssignment): día fuera de 1–5 → error ES.
 *   5. Limpieza de huérfanas: assignments y horarios personales día-6 legados se purgan
 *      en lectura/escritura (y un snapshot de sync no puede reintroducir el sábado).
 *   6. Aserciones de fuente: los arrays de días del builder y del aula ya no contienen id 6.
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
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE LOCAL'); process.exit(2); }, 90000);

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
function inRealCode(src: string, needle: string): boolean {
  return src.split('\n').some(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return t.includes(needle); });
}

const { AttendanceStorageService } = await import('../src/services/attendanceStorage');
const { readFileSync } = await import('fs');

const svc: any = AttendanceStorageService;
const SABADO = '2026-05-23'; // sábado real
const DOMINGO = '2026-05-24';
const LUNES = '2026-05-25';

// =====================================================================
await section('A. Guard protector de ventana lectiva', () => {
  check('sábado → null (sin jornada lectiva)', svc.getSchoolDayWindow(SABADO) === null);
  check('domingo → null', svc.getSchoolDayWindow(DOMINGO) === null);
  const lunes = svc.getSchoolDayWindow(LUNES);
  check('lunes → ventana válida', !!lunes && typeof lunes.startMin === 'number' && lunes.endMin > lunes.startMin);
});

await section('B. Parser CSV horario personal (portal estudiante)', () => {
  const r1 = svc.parsePersonalScheduleCSV('Sábado, Matemáticas, 07:00, 07:55');
  check('"Sábado" → rechazado', r1.entries.length === 0 && r1.errors.length === 1);
  check('mensaje específico de sábado', /sábado no es día lectivo/i.test(r1.errors[0] || ''), r1.errors[0]);
  const r2 = svc.parsePersonalScheduleCSV('sabado, Física, 08:00');
  check('"sabado" (sin tilde) → rechazado', r2.entries.length === 0 && /sábado no es día lectivo/i.test(r2.errors[0] || ''));
  const r3 = svc.parsePersonalScheduleCSV('6, Química, 09:00');
  check('dígito "6" → rechazado con mensaje específico', r3.entries.length === 0 && /sábado no es día lectivo/i.test(r3.errors[0] || ''), r3.errors[0]);
  const r4 = svc.parsePersonalScheduleCSV('Viernes, Ética, 10:00, 10:55\nLunes, Matemáticas, 07:00');
  check('Lunes–Viernes siguen aceptándose', r4.entries.length === 2 && r4.errors.length === 0);
  const r5 = svc.parsePersonalScheduleCSV('Domingo, X, 07:00');
  check('domingo → rechazado (día no reconocido)', r5.entries.length === 0 && r5.errors.length === 1);
});

await section('C. Parser CSV importación masiva (Rectoría)', () => {
  const r1 = svc.parseScheduleImport('día,grado,bloque,materia,docente\nSábado,10°1,1,Matemáticas,Juan Pérez');
  check('"Sábado" → rechazado', r1.rows.length === 0 && r1.errors.length === 1);
  check('mensaje específico de sábado', /sábado no es día lectivo/i.test(r1.errors[0] || ''), r1.errors[0]);
  const r2 = svc.parseScheduleImport('día,grado,bloque,materia,docente\n6,10°1,1,Matemáticas,Juan Pérez');
  check('dígito "6" → rechazado', r2.rows.length === 0 && /sábado no es día lectivo/i.test(r2.errors[0] || ''), r2.errors[0]);
  const r3 = svc.parseScheduleImport('día,grado,bloque,materia,docente\nViernes,10°1,1,Matemáticas,Juan Pérez');
  check('Viernes → aceptado', r3.rows.length === 1 && r3.errors.length === 0);
});

await section('D. Validación de cátedras (Mis Cátedras)', () => {
  svc.resetToDemo();
  const teacher = { id: 'prof-2', fullName: 'María Camila Restrepo Henao' };
  const slot = svc.getScheduleSlots().find((s: any) => s.type === 'CLASS');
  const r6 = svc.upsertTeacherOwnAssignment(teacher, { slotId: slot.id, dayOfWeek: 6, grade: '10°1', subject: 'X' });
  check('día 6 → rechazado', r6.ok === false && /no incluye el sábado/i.test(r6.error || ''), r6.error);
  const r0 = svc.upsertTeacherOwnAssignment(teacher, { slotId: slot.id, dayOfWeek: 0, grade: '10°1', subject: 'X' });
  check('día 0 → rechazado', r0.ok === false);
  const r5 = svc.upsertTeacherOwnAssignment(teacher, { slotId: slot.id, dayOfWeek: 5, grade: '10°1', subject: 'Prueba Ronda 22' });
  check('día 5 (Viernes) → aceptado', r5.ok === true, r5.error);
});

await section('E. Limpieza de huérfanas (datos legados día-6)', () => {
  // assignments legados con día 6
  const key1 = 'inas_schedule_assignments_v5';
  const demoAssignments = svc.getScheduleAssignments();
  localStorage.setItem(key1, JSON.stringify([...demoAssignments, { id: 'legacy-sab', dayOfWeek: 6, slotId: 'slot-1', grade: '10°1', subject: 'Legado', teacherId: 'prof-2' }]));
  const after = svc.getScheduleAssignments();
  check('assignment día-6 purgado en lectura', !after.some((a: any) => a.dayOfWeek === 6 || a.dayOfWeek < 1));
  const persisted = JSON.parse(localStorage.getItem(key1) || '[]');
  check('purga persistida (próxima sync nace limpia)', !persisted.some((a: any) => a.dayOfWeek === 6));

  // horarios personales legados con día 6
  const key2 = 'inas_student_schedules_v1';
  localStorage.setItem(key2, JSON.stringify({
    'EST-001': { studentCode: 'EST-001', updatedAt: new Date().toISOString(), entries: [
      { dayOfWeek: 1, subject: 'Mate', startTime: '07:00', endTime: '07:55' },
      { dayOfWeek: 6, subject: 'Sábado legado', startTime: '08:00', endTime: '08:55' }
    ] }
  }));
  const scheds = svc.getAllStudentSchedules();
  const entries = scheds['EST-001']?.entries || [];
  check('entrada personal día-6 purgada en lectura', entries.length === 1 && entries[0].dayOfWeek === 1);
  // barrera de escritura: un snapshot de sync no puede reintroducir el sábado
  svc.saveAllStudentSchedules({ 'EST-002': { studentCode: 'EST-002', updatedAt: new Date().toISOString(), entries: [
    { dayOfWeek: 6, subject: 'Intruso', startTime: '08:00', endTime: '08:55' }
  ] } as any });
  const stored2 = JSON.parse(localStorage.getItem(key2) || '{}');
  check('barrera de escritura: snapshot con día-6 se guarda limpio', (stored2['EST-002']?.entries || []).length === 0);
});

await section('F. Aserciones de fuente (sin sábado en UI)', () => {
  const builder = readFileSync('src/components/ScheduleBuilderView.tsx', 'utf-8');
  const aula = readFileSync('src/components/TeacherClassroomView.tsx', 'utf-8');
  const portal = readFileSync('src/components/StudentPortalView.tsx', 'utf-8');
  const storage = readFileSync('src/services/attendanceStorage.ts', 'utf-8');
  check('builder: sin id: 6 en DAYS_OF_WEEK', !inRealCode(builder, "id: 6,"));
  check('aula (Mis Cátedras): sin id: 6', !inRealCode(aula, "id: 6,"));
  check('portal: loop de días sin 6', !inRealCode(portal, '[1, 2, 3, 4, 5, 6]'));
  check('storage: parsers sin sabado: 6', !inRealCode(storage, 'sabado: 6') && !inRealCode(storage, "'sábado': 6"));
  check('storage: validación de cátedras limita a 5', inRealCode(storage, 'params.dayOfWeek > 5'));
  check('guard dom/sab intacto (defensa final)', inRealCode(storage, 'if (dow === 0 || dow === 6) return null;'));
});

// =====================================================================
console.log(`\n════════════════════════════════════════`);
console.log(`  RONDA 22 (SÁBADO FUERA): ${passed} OK · ${failed} FALLOS`);
console.log(`════════════════════════════════════════`);
if (failures.length) { failures.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0); // Ronda 22: salida explícita — el timer global (90s) no debe disparar process.exit(2)
