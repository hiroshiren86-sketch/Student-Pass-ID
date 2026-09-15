/**
 * R69 — REPRODUCCIÓN + VERIFICACIÓN del bug reportado por el propietario:
 *
 *   "Al filtrar por un grado específico (ej. 6°1) la lista aparece vacía, pero al
 *    seleccionar 'Todos los grados' se muestran datos."
 *
 * Nivel 1 (lógica): qué devuelve `getUniqueGrades()` con el catálogo real.
 * Nivel 2 (DOM real): se monta `StudentsManagerView` en jsdom y se opera el
 *         <select> exactamente como lo hace el usuario; se cuentan las <tr>.
 *
 * Ejecutar: TZ=America/Bogota bun tests/unit/r69_filtro_grado_dom.ts
 *           TZ=America/Bogota npx tsx tests/unit/r69_filtro_grado_dom.ts
 *
 * Pre-fix: las comprobaciones del contrato FALLAN (esa es la evidencia del bug).
 * Post-fix: todo en verde.
 */
import '../harness/domEnv'; // ← SIEMPRE antes de tocar módulos de la app
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents, buildTeachers } from '../harness/fixtures';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');
const { SCHOOL_GRADES_LIST } = await import('../../src/services/mockData');

// ─────────────────────────────  CONTEXTO LIMPIO  ─────────────────────────────
resetBrowserStorage();
const students = buildProductionStudents();
AttendanceStorageService.saveStudents(students, 'cloud'); // origen 'cloud' = llegó del pull
AttendanceStorageService.saveTeachers(buildTeachers(), 'cloud');

section('NIVEL 1 — OBSERVACIÓN DEL CATÁLOGO DE GRADOS (getUniqueGrades)');
const unique = AttendanceStorageService.getUniqueGrades();
const realGrades = Array.from(new Set(students.map(s => s.grade)));
console.log(`  estudiantes sembrados : ${students.length}`);
console.log(`  grados CON estudiantes: ${realGrades.join(', ')}`);
console.log(`  opciones del <select> : ${unique.length} → ${unique.join(' | ')}`);
const staticOnly = unique.filter(g => !realGrades.some(rg => rg.trim() === g.trim()));
console.log(`  opciones SIN ningún estudiante: ${staticOnly.length} → ${staticOnly.join(', ')}`);
console.log(`  SCHOOL_GRADES_LIST (estático de mockData): ${SCHOOL_GRADES_LIST.join(', ')}`);

section('NIVEL 1 — CONTRATO: el selector no debe ofrecer grados vacíos como si tuvieran datos');
// Un grado del catálogo estático demo (6°1) NO tiene estudiantes en la nube real.
// El contrato corregido: el selector de FILTRO de matrícula sólo lista grados con
// estudiantes, y cada opción dice cuántos hay (transparencia: vacío ≠ roto).
const catalog = (AttendanceStorageService as any).getGradeCatalog?.() ?? null;
check('existe getGradeCatalog() derivado de datos reales', Array.isArray(catalog), 'método ausente en AttendanceStorageService');
if (Array.isArray(catalog)) {
  const empty = catalog.filter((c: any) => (c.students ?? 0) === 0);
  check('ninguna entrada del catálogo de filtro tiene 0 estudiantes', empty.length === 0, empty.map((c: any) => c.grade).join(','));
  check('el catálogo incluye todos los grados reales', realGrades.every(g => catalog.some((c: any) => c.grade === g)));
  check('cada entrada trae su conteo', catalog.every((c: any) => typeof c.students === 'number' && c.students > 0));
  check('6°1 (estático sin datos) NO aparece en el catálogo de filtro', !catalog.some((c: any) => c.grade === '6°1'));
}

section('NIVEL 2 — DOM REAL: StudentsManagerView (jsdom + react-dom/client)');
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { StudentsManagerView } = await import('../../src/components/StudentsManagerView');

const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
await React.act(async () => { root.render(React.createElement(StudentsManagerView, { currentRole: 'ADMIN' })); });

function rows(): number {
  // La tabla del directorio: <tbody> → <tr> por estudiante; el empty-state es 1 <tr> con colSpan.
  const tbody = host.querySelector('table tbody');
  if (!tbody) return -1;
  const trs = Array.from(tbody.querySelectorAll('tr'));
  const placeholders = trs.filter(tr => tr.querySelector('td[colSpan]'));
  return trs.length - placeholders.length;
}
function selectGrades(): HTMLSelectElement | null {
  return Array.from(host.querySelectorAll('select')).find(s =>
    Array.from(s.options).some(o => o.value === 'all')
  ) as HTMLSelectElement | null;
}
async function pickGrade(value: string) {
  const sel = selectGrades();
  if (!sel) throw new Error('no se encontró el <select> de grado');
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLSelectElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(sel, value);
    sel.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

const sel = selectGrades();
const options = sel ? Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent || '' })) : [];
console.log(`  <select> con ${options.length} opciones:`);
options.forEach(o => console.log(`     · value="${o.value}"  texto="${o.text}"`));

check('la tabla arranca mostrando TODA la matrícula real', rows() === students.length, `filas=${rows()} esperadas=${students.length}`);

const hasStaticEmpty = options.some(o => o.value === '6°1');
check('el selector NO ofrece el grado estático vacío 6°1', !hasStaticEmpty, 'sigue apareciendo la opción 6°1 (catálogo demo hardcodeado)');

const graded = options.filter(o => o.value !== 'all');
check('todas las opciones del selector corresponden a grados con estudiantes',
  graded.every(o => students.some(s => s.grade.trim() === o.value.trim())),
  graded.filter(o => !students.some(s => s.grade.trim() === o.value.trim())).map(o => o.value).join(','));

check('las opciones muestran el conteo de estudiantes (vacío ≠ roto)',
  graded.length > 0 && graded.every(o => /\d+\s+estudiantes?/.test(o.text) || /\(\d+\)/.test(o.text)),
  graded.slice(0, 3).map(o => o.text).join(' | '));
// El conteo debe ser el REAL de la matrícula, no un adorno.
for (const g of realGrades) {
  const opt = options.find(o => o.value === g);
  const n = students.filter(s => s.grade.trim() === g.trim()).length;
  check(`la opción ${g} declara ${n} estudiantes`, !!opt && opt.text.includes(String(n)), opt?.text ?? 'sin opción');
}

for (const g of realGrades) {
  const opt = options.find(o => o.value.trim() === g.trim());
  if (!opt) { check(`filtrar por ${g} → opción presente`, false, 'la opción no existe en el <select>'); continue; }
  await pickGrade(opt.value);
  const expected = students.filter(s => s.grade.trim() === g.trim()).length;
  check(`filtrar por ${g} → ${expected} filas (no vacío)`, rows() === expected, `filas=${rows()}`);
}

await pickGrade('all');
check('volver a "Todos" restaura la matrícula completa', rows() === students.length, `filas=${rows()}`);

section('NIVEL 2b — DOM REAL: búsqueda por nombre sobre la lista de la nube');
async function typeSearch(q: string) {
  const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
  if (!input) throw new Error('no se encontró el buscador');
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLInputElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(input, q);
    input.dispatchEvent(new (globalThis as any).window.Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
const target = students[5];
await typeSearch(target.firstName.toLowerCase());
check(`buscar "${target.firstName.toLowerCase()}" (minúsculas) encuentra a ${target.firstName}`, rows() >= 1, `filas=${rows()}`);
await typeSearch(`${target.lastName.split(' ')[0].toLowerCase()} ${target.firstName.toLowerCase()}`);
check('buscar apellido+nombre en otro orden también encuentra', rows() >= 1, `filas=${rows()}`);
await typeSearch(target.code.slice(0, 6));
check('buscar por prefijo del código encuentra', rows() >= 1, `filas=${rows()}`);
await typeSearch('zzzz-no-existe');
check('búsqueda sin coincidencias → 0 filas (empty state honesto)', rows() === 0, `filas=${rows()}`);
await typeSearch('');

section('NIVEL 2c — variantes de escritura del grado (robustez del filtro)');
await React.act(async () => { root.unmount(); }); // desmontar el primer árbol: si queda
// suscrito al storage, el re-siembro dispara setState fuera de act() (ruido de React).
resetBrowserStorage();
const withVariants = buildProductionStudents({ withVariants: true });
AttendanceStorageService.saveStudents(withVariants, 'cloud');
const host2 = document.createElement('div');
document.body.appendChild(host2);
const root2 = createRoot(host2);
await React.act(async () => { root2.render(React.createElement(StudentsManagerView, { currentRole: 'ADMIN' })); });
const rows2 = () => {
  const tbody = host2.querySelector('table tbody');
  if (!tbody) return -1;
  const trs = Array.from(tbody.querySelectorAll('tr'));
  return trs.length - trs.filter(tr => tr.querySelector('td[colSpan]')).length;
};
const sel2 = Array.from(host2.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'all')) as HTMLSelectElement;
const opts2 = sel2 ? Array.from(sel2.options).map(o => o.value) : [];
console.log(`  opciones con variantes: ${opts2.join(' | ')}`);
const dupes = opts2.filter((v, i) => opts2.findIndex(x => x.replace(/[\s\u00A0]/g, '').replace(/[ºᵒ]/g, '°') === v.replace(/[\s\u00A0]/g, '').replace(/[ºᵒ]/g, '°')) !== i);
check('no hay opciones duplicadas por variantes invisibles del mismo grado', dupes.length === 0, dupes.join(','));
for (const g of ['6°1', '6°2', '7°1', '8°2', '9°1']) {
  if (!opts2.includes(g)) { check(`variante canonicalizada presente: ${g}`, false, `opciones=${opts2.join(',')}`); continue; }
  const setter = Object.getOwnPropertyDescriptor((globalThis as any).window.HTMLSelectElement.prototype, 'value')?.set;
  await React.act(async () => {
    setter?.call(sel2, g);
    sel2.dispatchEvent(new (globalThis as any).window.Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  check(`filtrar ${g} encuentra la ficha escrita de otra forma`, rows2() >= 1, `filas=${rows2()}`);
}
await React.act(async () => { root2.unmount(); });

console.log('\n══════════════════════════════════════');
console.log(`  R69 FILTRO POR GRADO (DOM REAL): ${passed} OK · ${failed} FALLO`);
if (failures.length) { console.log('  Fallos:'); failures.forEach(f => console.log(`   - ${f}`)); }
console.log('══════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
