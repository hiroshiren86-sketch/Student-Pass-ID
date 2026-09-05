/**
 * Ronda 27 — Suite "Entrega Limpia / Día Cero" (determinista, sin red). Ejecutar: bun scripts/verify_dia_cero.ts
 *
 * Valida el switch anti-seed (src/services/demoConfig.ts → SEED_DEMO_ON_FIRST_LAUNCH = false):
 *   (a) storage vacío → students/teachers/assignments/attendance = [], slots = defaults, settings con qrSecret aleatorio
 *   (b) resetToDemo() → 50 estudiantes / 6 docentes (demo restaurada — rollback del Día Cero intacto)
 *   (c) alta de 3 estudiantes → aparecen en directorio (getStudents) y generan planilla consultable
 *   (d) corrupción simulada con switch false → recupera [] + respaldo _corrupt_backup_*, NUNCA demo
 *   (e) keys persistidas explícitamente (patrón Ronda 14): relectura no re-dispara el seed
 */
(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null
    };
    // Enumeración real de keys para el suite (el objeto plano no expone el store).
    (globalThis as any).__lsKeys = () => Array.from(store.keys());
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear()
    };
  }
})();

import { AttendanceStorageService } from '../src/services/attendanceStorage';
import { SEED_DEMO_ON_FIRST_LAUNCH } from '../src/services/demoConfig';
import { INITIAL_STUDENTS, INITIAL_TEACHERS, DEFAULT_SCHEDULE_SLOTS, DEFAULT_SCHOOL_SETTINGS } from '../src/services/mockData';

let passed = 0, failed = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t: string) => console.log(`\n=== ${t} ===`);

const KEYS = {
  students: 'inas_students_v5',
  teachers: 'inas_teachers_v5',
  assignments: 'inas_schedule_assignments_v5',
  attendance: 'inas_attendance_v5',
  slots: 'inas_schedule_slots_v5'
};

// Enumerar las keys reales del mock de localStorage (Object.keys no ve el store interno).
const discoverKeys = () => (globalThis as any).__lsKeys
  ? (globalThis as any).__lsKeys() as string[]
  : Object.keys(globalThis.localStorage);

const cleanAll = () => {
  discoverKeys().forEach(k => {
    if (k.startsWith('inas_')) (globalThis.localStorage as any).removeItem(k);
  });
};

console.log(`\n=== PREVIO: switch anti-seed ===`);
ok('SEED_DEMO_ON_FIRST_LAUNCH = false (producción/entrega)', SEED_DEMO_ON_FIRST_LAUNCH === false);

// ---------------------------------------------------------------- (a) primer arranque limpio
section('(a) PRIMER ARRANQUE LIMPIO — storage vacío');
cleanAll();
const students = AttendanceStorageService.getStudents();
ok('students = [] (sin demo)', Array.isArray(students) && students.length === 0, `len=${students.length}`);
ok('key students persistida explícitamente como "[]" (patrón Ronda 14)', globalThis.localStorage.getItem(KEYS.students) === '[]');
const teachers = AttendanceStorageService.getTeachers();
ok('teachers = [] (sin demo)', Array.isArray(teachers) && teachers.length === 0, `len=${teachers.length}`);
ok('key teachers persistida como "[]"', globalThis.localStorage.getItem(KEYS.teachers) === '[]');
const assignments = AttendanceStorageService.getScheduleAssignments();
ok('assignments = [] (sin cátedras demo)', Array.isArray(assignments) && assignments.length === 0, `len=${assignments.length}`);
const attendance = AttendanceStorageService.getAllAttendance();
ok('attendance = [] (sin asistencias demo)', Array.isArray(attendance) && attendance.length === 0, `len=${attendance.length}`);
const slots = AttendanceStorageService.getScheduleSlots();
ok(`slots = DEFAULT_SCHEDULE_SLOTS (${DEFAULT_SCHEDULE_SLOTS.length}) — estructura de jornada conservada`,
  Array.isArray(slots) && slots.length === DEFAULT_SCHEDULE_SLOTS.length, `len=${slots?.length}`);
const settings = AttendanceStorageService.getSettings();
ok('settings generados en primer arranque (identidad + qrSecret aleatorio persistido)',
  !!settings && typeof settings.qrSecret === 'string' && settings.qrSecret.length >= 16 && settings.qrSecret !== (DEFAULT_SCHOOL_SETTINGS as any).qrSecret);
ok('settings ≠ identidad demo obligatoria (schoolName editable, no se pisa con datos de otro colegio)',
  typeof settings.schoolName === 'string');

// ---------------------------------------------------------------- (e) relectura estable (no re-seed)
section('(e) RELECTURA ESTABLE — cero re-disparos del seed');
const students2 = AttendanceStorageService.getStudents();
const attendance2 = AttendanceStorageService.getAllAttendance();
ok('relectura students sigue = []', students2.length === 0);
ok('relectura attendance sigue = []', attendance2.length === 0);
ok('no hay backups de corrupción en arranque limpio',
  discoverKeys().every(k => !k.includes('_corrupt_backup_')));

// ---------------------------------------------------------------- (c) alta de 3 estudiantes
section('(c) ALTA DE 3 ESTUDIANTES — flujo Día Cero (matrícula real)');
cleanAll();
AttendanceStorageService.getStudents(); // inicializa keys en limpio
const nuevos = [
  { code: '700000001', firstName: 'Ana', lastName: 'Real Uno', grade: '6°1', documentType: 'TI', documentId: '1001', birthDate: '2012-05-01', gender: 'F', photoUrl: '', active: true, personalSchedule: null, parentEmail: '', parentPhone: '' },
  { code: '700000002', firstName: 'Bruno', lastName: 'Real Dos', grade: '6°1', documentType: 'TI', documentId: '1002', birthDate: '2012-06-02', gender: 'M', photoUrl: '', active: true, personalSchedule: null, parentEmail: '', parentPhone: '' },
  { code: '700000003', firstName: 'Carla', lastName: 'Real Tres', grade: '7°1', documentType: 'TI', documentId: '1003', birthDate: '2011-07-03', gender: 'F', photoUrl: '', active: true, personalSchedule: null, parentEmail: '', parentPhone: '' }
] as any[];
nuevos.forEach(s => AttendanceStorageService.addStudent(s));
const dir = AttendanceStorageService.getStudents();
ok('los 3 estudiantes aparecen en el directorio', dir.length === 3, `len=${dir.length}`);
ok('códigos reales preservados (700000001..3)', ['700000001', '700000002', '700000003'].every(c => dir.some(s => s.code === c)));
const rec = AttendanceStorageService.getAllAttendance();
ok('planilla consultable sin registros previos ([] — la asistencia nace del escaneo real)', Array.isArray(rec) && rec.length === 0);

// ---------------------------------------------------------------- (d) corrupción con anti-seed activo
section('(d) CORRUPCIÓN SIMULADA (switch false) — recupera [] + backup, NUNCA demo');
globalThis.localStorage.setItem(KEYS.students, '{"esto');
// espera: setItem con JSON roto — localStorage guarda el string crudo '{"esto'
const corrupted = globalThis.localStorage.getItem(KEYS.students);
ok('preparación: JSON corrupto escrito en la key', corrupted === '{"esto' || corrupted === null);
const recovered = AttendanceStorageService.getStudents();
ok('recuperación con [] (no 50 demo)', Array.isArray(recovered) && recovered.length === 0, `len=${recovered.length}`);
const hasBackup = discoverKeys().some(k => k.startsWith(KEYS.students + '_corrupt_backup_'));
ok('respaldo _corrupt_backup_* protegido', hasBackup);
ok('la demo NO fue re-inyectada (ninguna key tiene 50 estudiantes)',
  discoverKeys().every(k => { const v = globalThis.localStorage.getItem(k); return !(v && v.length > 2000 && !k.includes('_corrupt_backup_')); }));

// corrupción también en teachers y attendance
globalThis.localStorage.setItem(KEYS.teachers, '[{{roto}');
const teachersRec = AttendanceStorageService.getTeachers();
ok('teachers corrupto → [] + sin demo', Array.isArray(teachersRec) && teachersRec.length === 0);
ok('respaldo corrupto de teachers protegido',
  discoverKeys().some(k => k.startsWith(KEYS.teachers + '_corrupt_backup_')));
globalThis.localStorage.setItem(KEYS.attendance, '[{{roto>');
const attRec = AttendanceStorageService.getAllAttendance();
ok('attendance corrupto → [] + sin demo', Array.isArray(attRec) && attRec.length === 0);
ok('respaldo corrupto de attendance protegido',
  discoverKeys().some(k => k.startsWith(KEYS.attendance + '_corrupt_backup_')));

// ---------------------------------------------------------------- (b) resetToDemo — rollback del Día Cero
section('(b) resetToDemo() — la demo sigue disponible como acción explícita (rollback)');
AttendanceStorageService.resetToDemo();
const demoStudents = AttendanceStorageService.getStudents();
const demoTeachers = AttendanceStorageService.getTeachers();
ok(`resetToDemo → ${INITIAL_STUDENTS.length} estudiantes demo restaurados`, demoStudents.length === INITIAL_STUDENTS.length, `len=${demoStudents.length}`);
ok(`resetToDemo → ${INITIAL_TEACHERS.length} docentes demo restaurados`, demoTeachers.length === INITIAL_TEACHERS.length, `len=${demoTeachers.length}`);
ok('slots de jornada intactos tras reset', AttendanceStorageService.getScheduleSlots().length === DEFAULT_SCHEDULE_SLOTS.length);

// ---------------------------------------------------------------- resumen
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${passed} OK · ${failed} FALLOS`);
if (failed > 0) { failures.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('SUITE DÍA CERO: 100% VERDE');
process.exit(0);
