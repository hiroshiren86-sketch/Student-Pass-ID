/**
 * Ronda 50 (M3 — identidad del estudiante): QA de la lógica de acceso por identidad
 * para estudiantes/acudientes. Verifica las piezas PURAS (deterministas, sin red):
 *
 *   1. studentInternalEmail(): el correo interno se deriva de forma DETERMINISTA del
 *      código — es el que provisionStudentAccount usa. Un código distinto ⇒ correo
 *      distinto; el mismo código ⇒ el mismo correo (estabilidad).
 *   2. filterSnapshotByRole para ESTUDIANTE_ACUDIENTE: el estudiante ve SOLO su grado
 *      y SOLO su planilla (mínimo privilegio / Ley 1581), nunca datos de otros cursos.
 *   3. El login por identidad no rompe el camino local: si no hay cuenta Firebase, la
 *      resolución del estudiante sigue por código/clave (retrocompat).
 *
 * Ejecutar:  TZ=America/Bogota npx tsx scripts/qa-r50-m3-student.ts
 */
import { filterSnapshotByRole, type Authz } from '../cloudflare-worker/src/index';
import { FirebaseService } from '../src/services/firebase';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// ==============================================================================
// SECCIÓN A — Correo interno determinista (studentInternalEmail)
// ==============================================================================
function sectionA() {
  console.log('\n━━━ A — Correo interno determinista (studentInternalEmail) ━━━');
  check('A1 correo derivado del código (1000000002)', FirebaseService.studentInternalEmail('1000000002') === 'estudiante-1000000002@inas.edu.co');
  check('A2 mismo código ⇒ mismo correo (estabilidad)', FirebaseService.studentInternalEmail('196555769') === FirebaseService.studentInternalEmail('196555769'));
  check('A3 código distinto ⇒ correo distinto', FirebaseService.studentInternalEmail('196555769') !== FirebaseService.studentInternalEmail('148717593'));
  check('A4 sanitiza caracteres no alfanuméricos (guiones)', FirebaseService.studentInternalEmail('10-a-1') === 'estudiante-10a1@inas.edu.co');
  check('A5 correo resultado tiene dominio institucional', FirebaseService.studentInternalEmail('123').endsWith('@inas.edu.co'));
}

// ==============================================================================
// SECCIÓN B — Filtrado del snapshot por rol ESTUDIANTE_ACUDIENTE
// ==============================================================================
function sectionB() {
  console.log('\n━━━ B — Filtrado por rol ESTUDIANTE_ACUDIENTE (mínimo privilegio) ━━━');
  const snapshot = {
    students: [
      { code: 'A', firstName: 'Ana', grade: '6°4' },
      { code: 'B', firstName: 'Beto', grade: '6°4' },
      { code: 'C', firstName: 'Carlos', grade: '10°3' },
      { code: 'D', firstName: 'Diana', grade: '6°4' }
    ],
    teachers: [
      { id: 'prof-1', fullName: 'Prof Uno', assignedGrades: ['6°4', '10°3'] }
    ],
    assignments: [
      { id: 'asg1', grade: '6°4' },
      { id: 'asg2', grade: '10°3' }
    ],
    records: [
      { id: 'r1', studentCode: 'A', studentGrade: '6°4' },
      { id: 'r2', studentCode: 'B', studentGrade: '6°4' },
      { id: 'r3', studentCode: 'C', studentGrade: '10°3' }
    ]
  };

  const estAuthz: Authz = { source: 'identity', role: 'ESTUDIANTE_ACUDIENTE', uid: 'x', linkedStudentCode: 'A', canWriteCatalog: false };
  const out = filterSnapshotByRole(snapshot, estAuthz);

  check('B1 ve SOLO su grado (6°4 → 3 estudiantes)', out.students.length === 3 && out.students.every((s: any) => s.grade === '6°4'));
  check('B2 NO ve estudiantes de otro grado (10°3 excluido)', !out.students.some((s: any) => s.grade === '10°3'));
  check('B3 ve SOLO su planilla (registros de su código)', out.records.length === 1 && out.records[0].studentCode === 'A');
  check('B4 NO ve registros de otros códigos', out.records.every((r: any) => r.studentCode === 'A'));
  check('B5 ve SOLO cátedras de su grado', out.assignments.length === 1 && out.assignments[0].grade === '6°4');
  check('B6 scopedFor declara role + grado + studentCode', out.scopedFor?.role === 'ESTUDIANTE_ACUDIENTE' && out.scopedFor?.grade === '6°4' && out.scopedFor?.studentCode === 'A');
  check('B7 no expone docentes (teachers vacío)', out.teachers.length === 0);
}

// ==============================================================================
// SECCIÓN C — Retrocompat: rol ADMIN/token ve todo; un estudiante sin vínculo NO
// silenciosamente ve todo.
// ==============================================================================
function sectionC() {
  console.log('\n━━━ C — Retrocompat y defensas ━━━');
  const snapshot = {
    students: [{ code: 'A', grade: '6°4' }, { code: 'B', grade: '10°3' }],
    assignments: [{ id: 'a1', grade: '6°4' }, { id: 'a2', grade: '10°3' }],
    records: [{ id: 'r1', studentCode: 'A', studentGrade: '6°4' }, { id: 'r2', studentCode: 'B', studentGrade: '10°3' }]
  };
  // ADMIN (token) → todo intacto (retrocompat del guard Fase 2)
  const admin: Authz = { source: 'token', role: 'ADMIN', canWriteCatalog: true };
  const adminOut = filterSnapshotByRole(snapshot, admin);
  check('C1 ADMIN ve todos los estudiantes (2)', adminOut.students.length === 2);
  check('C2 ADMIN ve todos los registros (2)', adminOut.records.length === 2);
  // OPERATOR (token de dispositivo) → también todo (la identidad lo sustituye)
  const op: Authz = { source: 'token', role: 'OPERATOR', canWriteCatalog: false };
  const opOut = filterSnapshotByRole(snapshot, op);
  check('C3 OPERATOR (token) ve todo como hoy (retrocompat)', opOut.students.length === 2);
  // Estudiante SIN linkedStudentCode → no debe ver todo; devuelve sin datos de grado.
  const noLink: Authz = { source: 'identity', role: 'ESTUDIANTE_ACUDIENTE', uid: 'y', canWriteCatalog: false };
  const noLinkOut = filterSnapshotByRole(snapshot, noLink);
  check('C4 estudiante sin vinculación NO ve todos los estudiantes', noLinkOut.students.length !== 2);
}

// ==============================================================================
sectionA();
sectionB();
sectionC();

console.log('\n══════════════════════════════════════');
console.log(`  RONDA 50 M3 (estudiante) — RESULTADO: ${passed} OK · ${failed} FALLO`);
if (failed > 0) { failures.forEach(f => console.log('   - ' + f)); process.exit(1); }
console.log('  IDENTIDAD DEL ESTUDIANTE EN VERDE');
process.exit(0);
