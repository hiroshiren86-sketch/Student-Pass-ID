/**
 * Ronda 46 — Suite LOCAL de la PARTE A (sub-roles + auto-registro del representante).
 * Ejecutar: TZ=America/Bogota npx tsx scripts/qa-r46-rep.ts
 *
 * Cubre:
 *   A. Auto-registro del TITULAR al desbloquear CLASE:v2 (scannedBy=REPRESENTANTE_TITULAR,
 *      presenceCapture='CLASS_UNLOCK_AUTO', contextSource='QR_CLASE', classQrVerified=true,
 *      verifiedHmac=false, teacherId correcto) + idempotencia + unicidad estudiante+día+bloque.
 *   B. Rep SUP LENTE → scannedBy=REPRESENTANTE_SUPLENTE.
 *   C. Delegado EFÍMERO (delegación vigente) → scannedBy=DELEGADO_EFIMERO.
 *   D. No-representante autorizado → rechazo informativo SIN crear registro (clase queda activa).
 *   E. Escaneo de COMPAÑERO por el rep → scannedBy por cascada (getScannerAuthority), no genérico.
 *   F. Cierre 100% → CLOSED con el rep NO ausente y 0 ausentes.
 *   G. Regla del 30% (menos del 30% escaneado) → PENDIENTE_REVISION, 0 ausentes.
 *   H. Coexistencia v1: activación por CLASE:v1 + auto-registro del rep sigue funcionando.
 *
 * NOTA de reloj: la guarda L–V real de la jornada NO se toca (código de producción intacto,
 * REGLA #8). Se mockea getSchoolDayWindow a jornada completa igual que verify_ronda43, porque
 * la suite verifica la LÓGICA de auto-registro, no la guarda temporal. El reloj es real; los
 * bloques se crean alrededor del instante actual para que el escaneo sea determinista.
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
  // Ronda 46 — reloj CONGELADO determinista: la suite no depende de la hora/día reales
  // (evita falsos fallos cerca de medianoche y cumple la Regla #8: no se toca la lógica de
  // producción; solo se mockea la hora del test). Lunes 06:35 Bogotá = lectivo, dentro del
  // bloque 1 y dentro de la gracia (PUNTUAL).
  const RealDate = Date;
  const FIXED_MS = RealDate.parse('2026-09-08T06:35:00-05:00');
  class MockDate extends RealDate {
    constructor(...args: any[]) {
      super(args.length === 0 ? FIXED_MS : (args[0] as any));
    }
    static now() { return FIXED_MS; }
  }
  (globalThis as any).Date = MockDate;
})();
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE R46'); process.exit(2); }, 90000);

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

const crypto = await import('../src/utils/crypto');
const { AttendanceStorageService, getCurrentTimeString, scannedByRoleLabel } = await import('../src/services/attendanceStorage');
const svc = AttendanceStorageService;

// Mock de la guarda de jornada (producción intacta): ventana completa para que la suite
// corra en cualquier día/hora real, igual que verify_ronda43.
(svc as any).getSchoolDayWindow = () => ({ start: '00:00', end: '23:59', startMin: 0, endMin: 1439 });

// Ronda 60-c — bloque de prueba HORA-SEGURO: timePlus(±) generaba 23:58→00:38
// (cruce de medianoche) cuando la suite corre entre ~23:20-00:10 y el localizador
// de bloques del producto no soporta cruce → falsas fallas de precondición
// reproducidas idénticas en baseline (stash). Aserciones intactas.
function safeBlock(backMin: number, fwdMin: number): { start: string; end: string } {
  const [h, m] = getCurrentTimeString().split(':').map(Number);
  const nowMin = h * 60 + m;
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return { start: fmt(Math.max(0, nowMin - backMin)), end: fmt(Math.min(1439, nowMin + fwdMin)) };
}

// Ronda 58 (F-1): esta suite ejercita el flujo del representante con códigos 1D
// PLANOS (USB) → corre en modo legado explícito (requireSignedCards=false), igual
// que un colegio que opera con lectores 1D. La política ACTIVADA se prueba en la
// sección E de verify_ronda43.ts.
svc.saveSettings({ ...svc.getSettings(), requireSignedCards: false }, false);

const SECRET = svc.getSettings().qrSecret;
const EXP = Date.parse(`${new Date().getFullYear()}-12-19T23:59:59`);

// Slot único de prueba que cubre AHORA (para activar v2 y registrar PUNTUAL dentro de la gracia).
const SLOT = 'slot-r46';
function seedSlot() {
  const blk = safeBlock(2, 40); // hora-seguro: cubre AHORA, jamás cruza medianoche
  svc.saveScheduleSlots([
    { id: SLOT, order: 1, type: 'CLASS', name: '1ª Hora', startTime: blk.start, endTime: blk.end, durationMinutes: 42 }
  ] as any);
}

const cardMat = await crypto.generateTeacherCardPayload('prof-r46-1', crypto.slugifySubject('Matemáticas'), EXP, SECRET);

await section('A — Auto-registro del REPRESENTANTE TITULAR (CLASE:v2)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveTeachers([
    { id: 'prof-r46-1', documentId: 'T46', fullName: 'María Camila Restrepo Henao', email: 'mrestrepo@inas.edu.co', subjects: ['Matemáticas', 'Lengua Castellana'], assignedGrades: ['10°1'], username: 't46', active: true, createdAt: new Date().toISOString() }
  ] as any);
  seedSlot();
  svc.saveStudents([
    { code: '1000000001', documentId: '1000000001', firstName: 'Titular', lastName: 'Rep A', grade: '10°1', section: '1', active: true, createdAt: new Date().toISOString(), isRepresentative: true, representativeGrade: '10°1' },
    { code: '1000000002', documentId: '1000000002', firstName: 'Compa', lastName: 'Uno', grade: '10°1', section: '1', active: true, createdAt: new Date().toISOString() },
    { code: '1000000003', documentId: '1000000003', firstName: 'Compa', lastName: 'Dos', grade: '10°1', section: '1', active: true, createdAt: new Date().toISOString() },
    { code: '1000000004', documentId: '1000000004', firstName: 'Compa', lastName: 'Tres', grade: '10°1', section: '1', active: true, createdAt: new Date().toISOString() }
  ] as any);

  const act = await svc.setActiveTeacherCard(cardMat);
  check('A0 precondición: clase v2 activa', act.type === 'class_activated', JSON.stringify(act).slice(0, 200));

  const self = await svc.registerRepresentativeSelf('1000000001', 'CAMERA');
  check('A1 auto-registro del titular → success_punctual', self.type === 'success_punctual', JSON.stringify(self).slice(0, 200));
  check('A2 scannedBy = REPRESENTANTE_TITULAR (cascada real)', self.record?.scannedBy === 'REPRESENTANTE_TITULAR');
  check('A3 presenceCapture = CLASS_UNLOCK_AUTO', self.record?.presenceCapture === 'CLASS_UNLOCK_AUTO');
  check('A4 contexto QR_CLASE + classQrVerified (tarjeta firmada)', self.record?.contextSource === 'QR_CLASE' && self.record?.classQrVerified === true);
  check('A5 verifiedHmac = false (honesto, sin carné sintético)', self.record?.verifiedHmac === false);
  check('A6 atribución: subject/teacherId/teacherName del contexto v2', self.record?.subject === 'Matemáticas' && self.record?.teacherId === 'prof-r46-1' && self.record?.teacherName === 'María Camila Restrepo Henao');
  check('A7 grado DEL CARNÉ del rep + bloque del reloj', self.record?.studentGrade === '10°1' && self.record?.slotId === SLOT);
  check('A8 status PUNTUAL (dentro de la gracia)', self.record?.status === 'PUNTUAL');
  check('A9 scannedByCode del auto-registro = código del rep', self.record?.scannedByCode === '1000000001');

  const again = await svc.registerRepresentativeSelf('1000000001', 'CAMERA');
  check('A10 idempotencia → already_scanned (unicidad estudiante+día+bloque)', again.type === 'already_scanned');
});

await section('B — REPUESTO SUPLENTE (rol de cascada)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '2000000002', documentId: '2000000002', firstName: 'Suplente', lastName: 'Rep B', grade: '10°2', section: '2', active: true, createdAt: new Date().toISOString(), isSubstituteRepresentative: true, representativeGrade: '10°2' }
  ] as any);
  seedSlot();
  const act = await svc.setActiveTeacherCard(cardMat);
  check('B0 precondición: clase v2 activa', act.type === 'class_activated');

  const self = await svc.registerRepresentativeSelf('2000000002', 'USB');
  check('B1 suplente → scannedBy = REPRESENTANTE_SUPLENTE', self.record?.scannedBy === 'REPRESENTANTE_SUPLENTE');
  check('B2 suplente → presenceCapture CLASS_UNLOCK_AUTO + verifiedHmac false', self.record?.presenceCapture === 'CLASS_UNLOCK_AUTO' && self.record?.verifiedHmac === false);
});

await section('C — DELEGADO EFÍMERO (Nivel 2 de la cascada)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '3000000003', documentId: '3000000003', firstName: 'Efimero', lastName: 'Delegado', grade: '10°3', section: '3', active: true, createdAt: new Date().toISOString() }
  ] as any);
  seedSlot();
  svc.createEphemeralDelegation({ teacherId: 'prof-r46-1', teacherName: 'María Camila Restrepo Henao', studentCode: '3000000003', studentName: 'Efimero Delegado', grade: '10°3', slotId: SLOT });
  const act = await svc.setActiveTeacherCard(cardMat);
  check('C0 precondición: clase v2 activa', act.type === 'class_activated');

  const self = await svc.registerRepresentativeSelf('3000000003', 'MANUAL');
  check('C1 efímero con delegación vigente → scannedBy = DELEGADO_EFIMERO', self.record?.scannedBy === 'DELEGADO_EFIMERO', JSON.stringify(self).slice(0, 200));
  check('C2 efímero → presenceCapture CLASS_UNLOCK_AUTO', self.record?.presenceCapture === 'CLASS_UNLOCK_AUTO');
});

await section('D — SIN autoridad de escaneo (no-representante)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '4000000004', documentId: '4000000004', firstName: 'Comun', lastName: 'Estudiante', grade: '10°4', section: '4', active: true, createdAt: new Date().toISOString() }
  ] as any);
  seedSlot();
  const act = await svc.setActiveTeacherCard(cardMat);
  check('D0 precondición: clase v2 activa', act.type === 'class_activated');
  const before = svc.getAllAttendance().length;

  const res = await svc.registerRepresentativeSelf('4000000004', 'CAMERA');
  check('D1 no-representante → error "Sin autoridad de escaneo"', res.type === 'error' && res.title === 'Sin autoridad de escaneo');
  check('D2 NO se crea registro (la activación de la clase se conserva)', svc.getAllAttendance().length === before);
  check('D3 el contexto de clase sigue activo', svc.getActiveClass() !== null);
});

await section('E — Escaneo de COMPAÑERO: scannedBy por cascada (A6)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '1000000001', documentId: '1000000001', firstName: 'Titular', lastName: 'Rep A', grade: '10°6', section: '6', active: true, createdAt: new Date().toISOString(), isRepresentative: true, representativeGrade: '10°6' },
    { code: '6000000006', documentId: '6000000006', firstName: 'Companero', lastName: 'Escaneado', grade: '10°6', section: '6', active: true, createdAt: new Date().toISOString() }
  ] as any);
  seedSlot();
  const act = await svc.setActiveTeacherCard(cardMat);
  check('E0 precondición: clase v2 activa', act.type === 'class_activated');

  const authority = svc.getScannerAuthority('1000000001', '10°6', SLOT);
  check('E1 getScannerAuthority resuelve TITULAR (conectada, ya no muerta)', authority.authorized === true && authority.role === 'REPRESENTANTE_TITULAR');
  check('E2 scannedByRoleLabel(TITULAR) = "Representante Titular"', scannedByRoleLabel('REPRESENTANTE_TITULAR') === 'Representante Titular');
  check('E3 scannedByRoleLabel(EFÍMERO) = "Delegado Efímero"', scannedByRoleLabel('DELEGADO_EFIMERO') === 'Delegado Efímero');

  const res = await svc.registerClassScan({
    scanInput: '6000000006', method: 'USB', slotId: SLOT, grade: '10°6',
    scannedBy: authority.role,
    scannedByName: `${'Titular'} ${'Rep A'} (${scannedByRoleLabel(authority.role)})`,
    scannedByCode: '1000000001'
  });
  check('E4 escaneo de compañero con scannedBy por cascada', res.record?.scannedBy === 'REPRESENTANTE_TITULAR' && res.record?.studentCode === '6000000006');
});

await section('F — Cierre 100% con el rep NO ausente', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '1000000001', documentId: '1000000001', firstName: 'Titular', lastName: 'Rep A', grade: '10°7', section: '7', active: true, createdAt: new Date().toISOString(), isRepresentative: true, representativeGrade: '10°7' },
    { code: '1000000002', documentId: '1000000002', firstName: 'Compa', lastName: 'Uno', grade: '10°7', section: '7', active: true, createdAt: new Date().toISOString() },
    { code: '1000000003', documentId: '1000000003', firstName: 'Compa', lastName: 'Dos', grade: '10°7', section: '7', active: true, createdAt: new Date().toISOString() }
  ] as any);
  seedSlot();
  const act = await svc.setActiveTeacherCard(cardMat);
  check('F0 precondición: clase v2 activa', act.type === 'class_activated');

  await svc.registerRepresentativeSelf('1000000001', 'CAMERA');
  await svc.registerClassScan({ scanInput: '1000000002', method: 'USB', slotId: SLOT, grade: '10°7' });
  await svc.registerClassScan({ scanInput: '1000000003', method: 'USB', slotId: SLOT, grade: '10°7' });

  const close = svc.closeBlockAttendance({ grade: '10°7', slotId: SLOT });
  check('F1 cierre 100% → CLOSED', close.status === 'CLOSED', JSON.stringify(close));
  check('F2 0 ausentes (todos presentes, incluido el rep)', close.markedAbsentCount === 0);

  const all = svc.getAllAttendance();
  const repRec = all.find(r => r.studentCode === '1000000001' && r.slotId === SLOT);
  check('F3 el rep quedó REGISTRADO (no AUSENTE)', !!repRec && repRec.status !== 'AUSENTE');
});

await section('G — Regla del 30% (menos del 30% → PENDIENTE_REVISION)', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  // Grado con 10 estudiantes; solo el rep (auto) + 1 compañero = 2 escaneos → 20% < 30%
  const students: any[] = [];
  for (let i = 1; i <= 10; i++) {
    students.push({ code: `7000000${i}`, documentId: `7000000${i}`, firstName: 'Alumno', lastName: `N${i}`, grade: '10°8', section: '8', active: true, createdAt: new Date().toISOString(), ...(i === 1 ? { isRepresentative: true, representativeGrade: '10°8' } : {}) });
  }
  svc.saveStudents(students);
  seedSlot();
  const act = await svc.setActiveTeacherCard(cardMat);
  check('G0 precondición: clase v2 activa', act.type === 'class_activated');

  await svc.registerRepresentativeSelf('70000001', 'CAMERA');
  await svc.registerClassScan({ scanInput: '70000002', method: 'USB', slotId: SLOT, grade: '10°8' });

  const close = svc.closeBlockAttendance({ grade: '10°8', slotId: SLOT });
  check('G1 <30% escaneado → PENDIENTE_REVISION', close.status === 'PENDIENTE_REVISION', JSON.stringify(close));
  check('G2 0 ausentes automáticos (sin falsos ausentes)', close.markedAbsentCount === 0);
});

await section('H — Coexistencia v1: activación CLASE:v1 + auto-registro', async () => {
  svc.saveAttendance([]); // aislamiento de sección
  svc.saveStudents([
    { code: '1000000001', documentId: '1000000001', firstName: 'Titular', lastName: 'Rep A', grade: '10°1', section: '1', active: true, createdAt: new Date().toISOString(), isRepresentative: true, representativeGrade: '10°1' }
  ] as any);
  seedSlot();
  const dowToday = new Date().getDay() || 1;
  const v1Token = await crypto.generateClassQrPayload('10°1', SLOT, dowToday, Date.now() + 3600_000, SECRET);
  const act = await svc.setActiveClassFromToken(v1Token);
  check('H0 precondición: CLASE:v1 activada (coexistencia)', act.type === 'class_activated', JSON.stringify(act).slice(0, 200));

  const self = await svc.registerRepresentativeSelf('1000000001', 'CAMERA');
  check('H1 auto-registro del rep en v1 → success (PUNTUAL/TARDANZA)', self.type === 'success_punctual' || self.type === 'success_tardy');
  check('H2 scannedBy por cascada (TITULAR) en v1', self.record?.scannedBy === 'REPRESENTANTE_TITULAR');
  check('H3 presenceCapture CLASS_UNLOCK_AUTO en v1 + verifiedHmac false', self.record?.presenceCapture === 'CLASS_UNLOCK_AUTO' && self.record?.verifiedHmac === false);
});

await section('I — Coherencia de grado: CLASE:v1 de OTRO grado → rechazo', async () => {
  svc.saveAttendance([]);
  svc.saveStudents([
    { code: '1111111111', documentId: '1111111111', firstName: 'Rep', lastName: 'Once Uno', grade: '11°1', section: '1', active: true, createdAt: new Date().toISOString(), isRepresentative: true, representativeGrade: '11°1' }
  ] as any);
  seedSlot();
  const dowToday = new Date().getDay() || 1;
  const v1Token = await crypto.generateClassQrPayload('10°1', SLOT, dowToday, Date.now() + 3600_000, SECRET);
  const act = await svc.setActiveClassFromToken(v1Token);
  check('I0 precondición: CLASE:v1 activada para 10°1', act.type === 'class_activated');
  const self = await svc.registerRepresentativeSelf('1111111111', 'CAMERA');
  check('I1 rep de 11°1 con clase 10°1 → "Clase de otro grado" (no auto-registra)', self.type === 'error' && self.title === 'Clase de otro grado', JSON.stringify(self).slice(0, 200));
  check('I2 NO se crea registro del rep en el curso ajeno', svc.getAllAttendance().filter(r => r.studentCode === '1111111111').length === 0);
});

console.log(`\n══════════════════════════════════════`);
console.log(`  RONDA 46 — RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failures.length) {
  console.log('\n  FALLOS:');
  failures.forEach(f => console.log(`    ✗ ${f}`));
  process.exit(1);
}
process.exit(0);
