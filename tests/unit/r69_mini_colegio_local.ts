/**
 * R69 — ENSAYO LOCAL DE LA SIMULACIÓN "MINI COLEGIO" (Pasos A → B → C).
 *
 * Ejecuta la cadena operativa COMPLETA con el código real de la app y los fixtures
 * CSV versionados, sin nube (el sandbox no tiene egreso a workers.dev/Firebase):
 *
 *   A · Carga masiva por CSV  → parser real (`parseTextOrCsvContent`) + alta real
 *       (`addStudent`), el mismo camino que DocumentUploadModal. 150 estudiantes
 *       nuevos (15 cursos × 10) sobre los 80 reales → 230 en 21 cursos, todos ≥10.
 *   B · Sub-roles "Hacer Rep" → `setRepresentativeForGrade` (la llamada exacta del
 *       botón de la tabla del Directorio) + verificación del perfil de representante.
 *   C · Horarios + desbloqueo de clase + escaneo → importador CSV real, tarjeta de
 *       clase v2 (independiente del día) y QR de clase v1, `registerScan` de todo el
 *       grupo y lectura de la planilla con curso escrito de otra forma.
 *
 * Lo que este ensayo NO cubre (requiere la nube y se cubre con los scripts Playwright
 * de tests/e2e/simulation/ en el entorno del propietario): la persistencia real en
 * D1/KV, las cuentas de Firebase, las claves por defecto vía `/api/admin/credential`
 * y las excusas (cloud-authoritative).
 *
 * Ejecutar: TZ=America/Bogota bun tests/unit/r69_mini_colegio_local.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents, buildRealTeachers, PRODUCTION_GROUPS } from '../harness/fixtures';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

let passed = 0, failed = 0, skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function skip(name: string, why: string) { skipped++; console.log(`  ○ ${name} — SKIP: ${why}`); }
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

const { AttendanceStorageService: svc } = await import('../../src/services/attendanceStorage');
const { parseTextOrCsvContent } = await import('../../src/utils/documentParser');
const { normalizeGradeName } = await import('../../src/utils/documentParser');
const crypto = await import('../../src/utils/crypto');
const { canonicalGrade } = await import('../../src/utils/gradeCatalog');

const FIXTURES = resolvePath(process.cwd(), 'tests/fixtures');
const CSV_MATRICULA = readFileSync(resolvePath(FIXTURES, 'matricula_mini_colegio_15_grupos.csv'), 'utf8');
const CSV_HORARIOS = readFileSync(resolvePath(FIXTURES, 'horarios_mini_colegio_15_grupos.csv'), 'utf8');

// ── Contexto limpio + configuración de la jornada extendida de pruebas ──
resetBrowserStorage();
svc.saveStudents(buildProductionStudents(), 'cloud');      // los 80 reales de producción
svc.saveTeachers(buildRealTeachers(), 'cloud');            // los 20 docentes reales
svc.saveSettings({
  ...svc.getSettings(),
  requireSignedCards: false,        // camino clásico por código (R58 F-1 permite ambos)
  defaultAccessPassword: '000000',  // clave por defecto de la directiva
  dailyStartTime: '05:00',          // JORNADA EXTENDIDA de pruebas (nota del propietario)
  dailyEndTime: '22:00',
}, false);

// ══════════════════════════  PASO A — CARGA MASIVA POR CSV  ══════════════════════════
section('PASO A · Carga masiva por CSV (parser real + alta real)');
const drafts = parseTextOrCsvContent(CSV_MATRICULA, 'matricula_mini_colegio_15_grupos.csv');
check('el CSV produce 150 borradores', drafts.length === 150, `obtenidos=${drafts.length}`);
check('todos los borradores quedan válidos (documento 6-12 dígitos)', drafts.every(d => d.status === 'valid'),
  drafts.filter(d => d.status !== 'valid').slice(0, 3).map(d => `${d.documentId}:${d.errorMessage}`).join(' | '));
check('el parser separa apellidos y nombres correctamente', drafts[0].lastName.includes(' ') && !!drafts[0].firstName,
  `${drafts[0].firstName} / ${drafts[0].lastName}`);
check('el parser resuelve el curso del CSV', drafts.every(d => !!canonicalGrade(d.grade)), drafts.slice(0, 3).map(d => d.grade).join(','));

// Alta por el mismo camino de DocumentUploadModal.handleSave
let saved = 0, skippedRows = 0;
for (const draft of drafts) {
  const cleanDoc = draft.documentId.trim();
  const grade = normalizeGradeName(draft.grade || '6°1');
  const res = svc.addStudent({
    code: cleanDoc,
    documentId: cleanDoc,
    documentType: draft.documentType || 'TI',
    firstName: draft.firstName.trim().toUpperCase(),
    lastName: draft.lastName.trim().toUpperCase(),
    grade,
    section: grade.includes('°') ? grade.split('°')[1] : '1',
    active: true,
    createdAt: new Date().toISOString(),
  } as any);
  if (res.success) saved++; else skippedRows++;
}
check('150 altas exitosas, 0 rechazadas', saved === 150 && skippedRows === 0, `ok=${saved} omitidas=${skippedRows}`);

const total = svc.getStudents().length;
const esperado = 80 + 150;
check(`catálogo total = ${esperado} (80 reales + 150 nuevos)`, total === esperado, `total=${total}`);

const catalogo = svc.getGradeCatalog();
const gruposNuevos = ['6°1', '6°2', '6°3', '7°1', '7°2', '7°3', '8°1', '8°2', '8°3', '9°1', '9°2', '10°1', '10°2', '11°1', '11°2'];
check('el catálogo queda con 21 cursos (15 nuevos + 6 existentes)', catalogo.length === 21,
  `${catalogo.length}: ${catalogo.map(c => c.grade).join(',')}`);
check('todos los cursos de 6°1 a 11°3 tienen ≥10 estudiantes',
  catalogo.filter(c => /^[6-9]°[1-3]$|^1[01]°[1-3]$/.test(c.grade)).every(c => c.students >= 10),
  catalogo.filter(c => c.students < 10).map(c => `${c.grade}:${c.students}`).join(','));
check('los 15 cursos nuevos existen con 10 estudiantes cada uno',
  gruposNuevos.every(g => catalogo.find(c => c.grade === g)?.students === 10),
  gruposNuevos.filter(g => catalogo.find(c => c.grade === g)?.students !== 10).join(','));
check('los cursos existentes CONSERVAN su matrícula real (no se pisaron)',
  PRODUCTION_GROUPS.every(g => catalogo.find(c => c.grade === g.grade)?.students === g.count),
  PRODUCTION_GROUPS.map(g => `${g.grade}:${catalogo.find(c => c.grade === g.grade)?.students}`).join(','));

// Re-importación idempotente (mismo CSV dos veces no duplica fichas)
let dupSaved = 0, dupSkipped = 0;
for (const draft of drafts) {
  const cleanDoc = draft.documentId.trim();
  const grade = normalizeGradeName(draft.grade || '6°1');
  const res = svc.addStudent({
    code: cleanDoc, documentId: cleanDoc, documentType: 'TI',
    firstName: draft.firstName, lastName: draft.lastName, grade,
    section: grade.split('°')[1] || '1', active: true, createdAt: new Date().toISOString(),
  } as any);
  if (res.success) dupSaved++; else dupSkipped++;
}
check('re-importar el mismo CSV no duplica (0 altas, 150 omitidas)', dupSaved === 0 && dupSkipped === 150,
  `ok=${dupSaved} omitidas=${dupSkipped}`);
check('el catálogo sigue en 230 tras la re-importación', svc.getStudents().length === esperado, `${svc.getStudents().length}`);

// Filtro por curso sobre la matrícula importada (el bug reportado, ahora con datos reales)
const de61 = svc.getStudentsByGrade('6°1');
check('getStudentsByGrade("6°1") devuelve los 10 importados', de61.length === 10, `${de61.length}`);
check('getStudentsByGrade tolera otra escritura del curso ("6-1")', svc.getStudentsByGrade('6-1').length === 10,
  `${svc.getStudentsByGrade('6-1').length}`);
check('getStudentsByGrade tolera el compacto SIMAT ("601")', svc.getStudentsByGrade('601').length === 10,
  `${svc.getStudentsByGrade('601').length}`);

// ══════════════════════════  PASO B — SUB-ROLES ("HACER REP")  ══════════════════════════
section('PASO B · Asignación del sub-rol Representante (botón "Hacer Rep")');
const repsAsignados: Array<{ grade: string; code: string; name: string }> = [];
for (const entry of catalogo) {
  const primero = svc.getStudentsByGrade(entry.grade).find(s => s.active);
  if (!primero) { check(`${entry.grade}: hay un estudiante para hacer rep`, false); continue; }
  // La llamada EXACTA del botón "Hacer Rep" de la tabla del Directorio:
  const ok = svc.setRepresentativeForGrade(primero.grade, primero.code);
  repsAsignados.push({ grade: entry.grade, code: primero.code, name: `${primero.firstName} ${primero.lastName}` });
  if (!ok) check(`${entry.grade}: setRepresentativeForGrade devolvió ok`, false);
}
check('se asignó representante en los 21 cursos', repsAsignados.length === 21, `${repsAsignados.length}`);
check('cada curso tiene EXACTAMENTE un representante titular (invariante R46)',
  catalogo.every(c => svc.getStudentsByGrade(c.grade).filter(s => s.isRepresentative).length === 1),
  catalogo.filter(c => svc.getStudentsByGrade(c.grade).filter(s => s.isRepresentative).length !== 1).map(c => c.grade).join(','));
check('getRepresentativeForGrade resuelve los 21 representantes',
  catalogo.every(c => svc.getRepresentativeForGrade(c.grade)?.code === repsAsignados.find(r => r.grade === c.grade)?.code));
const repMuestra = repsAsignados[0];
const fichaRep = svc.getStudentByCodeOrDoc(repMuestra.code);
check('la ficha del representante queda con isRepresentative + representativeGrade',
  fichaRep?.isRepresentative === true && canonicalGrade(fichaRep?.representativeGrade) === repMuestra.grade,
  JSON.stringify({ rep: fichaRep?.isRepresentative, grade: fichaRep?.representativeGrade }));
check('el portal mostraría "Modo Representante de Salón" (mismo predicado de StudentPortalView)',
  !!fichaRep?.isRepresentative);

// Re-asignación: otro estudiante del mismo curso toma el rol y el anterior lo pierde
const segundo = svc.getStudentsByGrade(repMuestra.grade).filter(s => s.code !== repMuestra.code)[0];
svc.setRepresentativeForGrade(segundo.grade, segundo.code);
check('re-asignar el rol a otro estudiante mueve el rol (no lo duplica)',
  svc.getRepresentativeForGrade(repMuestra.grade)?.code === segundo.code
  && svc.getStudentByCodeOrDoc(repMuestra.code)?.isRepresentative !== true);
svc.setRepresentativeForGrade(segundo.grade, repMuestra.code); // se devuelve para el resto del ensayo

// Sub-rol con el curso escrito de otra forma (RC-7b): se toma una ficha de 7°1, se le
// pone la escritura variante "7-1" y se asigna el rol buscando por la forma canónica.
const repVariante = svc.getStudentsByGrade('7°1').filter(s => s.code !== repsAsignados.find(r => r.grade === '7°1')?.code)[0];
const gradoOriginalVariante = repVariante.grade;
svc.updateStudent(repVariante.code, { grade: '7-1' } as any);
check('la ficha quedó con la escritura variante "7-1"', svc.getStudentByCodeOrDoc(repVariante.code)?.grade === '7-1');
svc.setRepresentativeForGrade('7°1', repVariante.code);
check('asignar el sub-rol buscando por "7°1" alcanza una ficha guardada como "7-1"',
  svc.getRepresentativeForGrade('7-1')?.code === repVariante.code,
  `${svc.getRepresentativeForGrade('7-1')?.code} vs ${repVariante.code}`);
check('el suplente/lector canónico también lo resuelve ("7°1")',
  svc.getRepresentativeForGrade('7°1')?.code === repVariante.code);
svc.updateStudent(repVariante.code, { grade: gradoOriginalVariante } as any); // restaura
svc.setRepresentativeForGrade('7°1', repsAsignados.find(r => r.grade === '7°1')!.code); // y su rep original
check('tras restaurar, 7°1 vuelve a tener exactamente 10 estudiantes y 1 representante',
  svc.getStudentsByGrade('7°1').length === 10 && svc.getStudentsByGrade('7°1').filter(s => s.isRepresentative).length === 1,
  `${svc.getStudentsByGrade('7°1').length} estudiantes`);
check('ningún curso perdió matrícula durante el paso B',
  svc.getGradeCatalog().every(c => c.students >= 10), svc.getGradeCatalog().filter(c => c.students < 10).map(c => `${c.grade}:${c.students}`).join(','));

// ══════════════════════════  PASO C — HORARIOS, CLASE Y ESCANEO  ══════════════════════════
section('PASO C1 · Importación del horario por CSV (importador real)');
const preview = svc.parseScheduleImport(CSV_HORARIOS);
console.log(`  filas: ${preview.rows?.length ?? 0} válidas · ${preview.errors?.length ?? 0} con error`);
check('las 60 cátedras del CSV son válidas', (preview.rows?.length ?? 0) === 60,
  (preview.errors ?? []).slice(0, 4).map((e: any) => e.message ?? JSON.stringify(e)).join(' | '));
check('el CSV no produjo errores de importación', (preview.errors?.length ?? 0) === 0,
  (preview.errors ?? []).slice(0, 3).map((e: any) => e.message ?? JSON.stringify(e)).join(' | '));
check('el importador resolvió los docentes reales por nombre',
  (preview.rows ?? []).filter((r: any) => r.teacherId).length >= 45,
  `con teacherId=${(preview.rows ?? []).filter((r: any) => r.teacherId).length}`);
const applied = svc.applyScheduleImport(preview.rows as any);
check('aplicación del horario: 60 cátedras', applied.applied === 60, JSON.stringify(applied));
check('las cátedras quedan consultables por curso canónico', svc.getScheduleAssignments().length >= 60,
  `${svc.getScheduleAssignments().length}`);
check('getScheduleForGrade("6-1") encuentra la cátedra guardada como "6°1"',
  [1, 2, 3, 4, 5].some(dow => svc.getScheduleForGrade('6-1', dow).some(s => !!s.assignment)));

section('PASO C2 · Tarjeta de clase v2 (desbloqueo de la hora, independiente del día)');
// Bloque que cubre AHORA (misma técnica hora-segura de verify_ronda43): la jornada
// extendida de pruebas permite evaluar la clase a cualquier hora.
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const startMin = now.getHours() * 60 + now.getMinutes() - 10;
const endMin = startMin + 50;
const fmt = (m: number) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
const slots = svc.getScheduleSlots();
const classSlots = slots.filter(s => s.type === 'CLASS');
const extended = slots.map((s, idx) => (s.id === classSlots[1]?.id
  ? { ...s, startTime: fmt(startMin), endTime: fmt(endMin), durationMinutes: 50 }
  : s));
svc.saveScheduleSlots(extended as any, 'system');
const activeSlotInfo = svc.getCurrentActiveSlot();
check(`hay un bloque activo a esta hora (${fmt(startMin)}–${fmt(endMin)})`, !!activeSlotInfo?.isWithin,
  JSON.stringify(activeSlotInfo && { slot: activeSlotInfo.slot?.id, isWithin: activeSlotInfo.isWithin }));
check('la jornada extendida reconoce la hora como dentro del día escolar', svc.isWithinSchoolDay(),
  `ventana=${JSON.stringify((svc as any).getSchoolDayWindow?.())}`);

const teacherMat = svc.getTeachers().find(t => (t.subjects || []).includes('Matemáticas'))!;
const secret = svc.getSettings().qrSecret;
const cardToken = await crypto.generateTeacherCardPayload(
  teacherMat.id, crypto.slugifySubject('Matemáticas'), Date.now() + 3600_000, secret
);
const cardRes = await svc.setActiveTeacherCard(cardToken);
check(`tarjeta de ${teacherMat.fullName} (Matemáticas) → clase activa`, cardRes.type === 'class_activated',
  JSON.stringify(cardRes).slice(0, 200));

section('PASO C3 · Escaneo del grupo con la clase desbloqueada');
const grupo = '6°1';
const grupoStudents = svc.getStudentsByGrade(grupo).filter(s => s.active);
svc.saveAttendance([]);
const scanResults: any[] = [];
for (const st of grupoStudents) {
  scanResults.push(await svc.registerScan({ scanInput: st.code, method: 'USB' }));
}
const okScans = scanResults.filter(r => r.type === 'success_punctual' || r.type === 'success_tardy');
check(`los ${grupoStudents.length} estudiantes de ${grupo} quedan registrados`, okScans.length === grupoStudents.length,
  `ok=${okScans.length}/${scanResults.length} · tipos=${scanResults.map(r => r.type).join(',')}`);
check('los registros llevan la materia FIRMADA en la tarjeta (Matemáticas)',
  okScans.every(r => r.record?.subject === 'Matemáticas'), okScans[0]?.record?.subject);
check('los registros quedan vinculados al contexto de clase (QR_CLASE)',
  okScans.every(r => r.record?.contextSource === 'QR_CLASE'), okScans[0]?.record?.contextSource);
check('el docente de la tarjeta viaja en el registro',
  okScans.every(r => r.record?.teacherName === teacherMat.fullName), okScans[0]?.record?.teacherName);

// Planilla: lectura por curso con escritura variante (RC-7b)
check('la planilla del curso devuelve los 10 registros', svc.getAttendanceByGrade(grupo).length === grupoStudents.length,
  `${svc.getAttendanceByGrade(grupo).length}`);
check('la planilla se lee igual con el curso escrito "6-1"', svc.getAttendanceByGrade('6-1').length === grupoStudents.length,
  `${svc.getAttendanceByGrade('6-1').length}`);
check('la planilla se lee igual con el compacto "601"', svc.getAttendanceByGrade('601').length === grupoStudents.length);
check('un escaneo repetido no duplica el registro (unicidad estudiante+fecha+bloque)',
  (await svc.registerScan({ scanInput: grupoStudents[0].code, method: 'USB' })).type === 'error'
  || svc.getAttendanceByGrade(grupo).length === grupoStudents.length,
  `${svc.getAttendanceByGrade(grupo).length} registros tras repetir`);
check('un estudiante de OTRO curso no se contamina con la materia del grupo escaneado',
  !(svc.getAttendanceByGrade('11°2').length > 0));

section('PASO C4 · QR de clase v1 por curso/día (con el curso escrito distinto)');
const todayDow = new Date().getDay();
const dayNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const todayName = dayNames[todayDow];
const filaHoy = CSV_HORARIOS.trim().split('\n').slice(1)
  .map(l => l.split(','))
  .find(p => p[0] === todayName && p[3] !== 'Dirección de Grupo');
if (todayDow >= 1 && todayDow <= 5 && filaHoy) {
  const [, gradeCsv, bloque, materia, docente] = filaHoy;
  const slotId = svc.getScheduleSlots().filter(s => s.type === 'CLASS')[Number(bloque) - 1]?.id;
  svc.clearActiveClass?.();
  // El token se firma con el curso escrito como "7-1" (variante) para probar que la
  // cátedra guardada como "7°1" igual se resuelve (RC-7b en el flujo de clase).
  const variante = gradeCsv.replace('°', '-');
  const tokenV1 = await crypto.generateClassQrPayload(variante, slotId, todayDow, Date.now() + 3600_000, secret);
  const resV1 = await svc.setActiveClassFromToken(tokenV1);
  check(`QR v1 de ${variante} (${todayName} bloque ${bloque}) activa la clase`, resV1.type === 'class_activated',
    JSON.stringify(resV1).slice(0, 220));
  check(`la materia resuelta es la del horario (${materia})`, (resV1 as any).message?.includes(materia),
    (resV1 as any).message);
  const alumno = svc.getStudentsByGrade(gradeCsv).filter(s => s.active)[0];
  svc.saveAttendance([]);
  const scanV1 = await svc.registerScan({ scanInput: alumno.code, method: 'USB' });
  check('el escaneo del alumno queda vinculado al QR de clase v1',
    (scanV1.type === 'success_punctual' || scanV1.type === 'success_tardy') && scanV1.record?.contextSource === 'QR_CLASE',
    JSON.stringify({ t: scanV1.type, ctx: scanV1.record?.contextSource, subj: scanV1.record?.subject }));
  check(`el registro lleva la materia ${materia} del horario`, scanV1.record?.subject === materia, scanV1.record?.subject);
  if (docente) {
    check(`el registro lleva el docente del horario (${docente})`, scanV1.record?.teacherName === docente, scanV1.record?.teacherName);
  }
} else {
  skip('QR de clase v1 por día', `hoy es ${todayName || 'fin de semana'} y la jornada escolar es L–V`);
}

console.log('\n══════════════════════════════════════');
console.log(`  R69 ENSAYO MINI COLEGIO (A→B→C local): ${passed} OK · ${failed} FALLO · ${skipped} SKIP`);
if (failures.length) { console.log('  Fallos:'); failures.forEach(f => console.log(`   - ${f}`)); }
console.log('══════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
