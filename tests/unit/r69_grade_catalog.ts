/**
 * R69 — Suite de la utilidad de grados (`src/utils/gradeCatalog.ts`).
 * Determinista, sin red y sin DOM.
 *
 * Ejecutar: TZ=America/Bogota bun tests/unit/r69_grade_catalog.ts
 */
let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

const { canonicalGrade, gradesMatch, compareGrades, buildGradeCatalog, resolveGradeSelection, gradeOptionLabel } =
  await import('../../src/utils/gradeCatalog');

section('A — canonicalGrade: escrituras equivalentes del MISMO curso');
const vectors: Array<[string, string | null]> = [
  ['6°1', '6°1'],
  ['6º1', '6°1'],            // ordinal masculino U+00BA (Excel/Word ES)
  ['6ᵒ1', '6°1'],            // modificador supraíndice
  ['6 1', '6°1'],
  ['6-1', '6°1'],
  ['6.1', '6°1'],
  ['6/1', '6°1'],
  ['6°1 ', '6°1'],           // espacio final (CSV mal recortado)
  ['  6°1', '6°1'],          // espacio inicial
  ['6\u00A01', '6°1'],       // NBSP
  ['601', '6°1'],            // compacto SIMAT
  ['0601', '6°1'],
  ['10°4', '10°4'],
  ['10-4', '10°4'],
  ['1004', '10°4'],
  ['11°3', '11°3'],
  ['1103', '11°3'],
  ['GRADO 6-1', '6°1'],
  ['Curso 6°1', '6°1'],
  ['grupo 11 2', '11°2'],
  ['SEXTO 1', '6°1'],
  ['séptimo-2', '7°2'],
  ['DECIMO 3', '10°3'],
  ['once 1', '11°1'],
  ['JERONIMO,11°1', '11°1'], // celda contaminada con nombre: se rescata el curso embebido
  ['LOPEZ 10-2', '10°2'],    // mismo caso (planilla SIMAT real)
  ['2026-09-15', null],      // una fecha NO es un curso (no se inventa)
  ['1025883921', null],      // un documento NO es un curso (no se inventa)
  ['transición', 'TRANSICIÓN'],
  ['JARDIN', 'JARDÍN'],
  ['12°1', null],            // fuera de rango (el colegio va hasta 11)
  ['6°10', null],            // sección fuera de rango
  ['', null],
  ['   ', null],
  ['SIN DATO', null],
  ['A', null],
];
for (const [input, expected] of vectors) {
  const got = canonicalGrade(input);
  check(`canonicalGrade(${JSON.stringify(input)}) = ${JSON.stringify(expected)}`, got === expected, `obtenido ${JSON.stringify(got)}`);
}

section('B — canonicalGrade no inventa matrícula (contraste con normalizeGradeName)');
const { normalizeGradeName } = await import('../../src/utils/documentParser');
check('normalizeGradeName("BASURA") devuelve 6°1 (comportamiento histórico que INVENTA dato)', normalizeGradeName('BASURA') === '6°1');
check('canonicalGrade("BASURA") devuelve null (no inventa)', canonicalGrade('BASURA') === null);

section('C — gradesMatch: comparación en los DOS lados');
const matchVectors: Array<[string, string, boolean]> = [
  ['6°1', '6°1', true],
  ['6°1 ', '6º1', true],
  ['601', '6°1', true],
  ['10-4', '10°4', true],
  ['6°1', '6°2', false],
  ['6°1', '7°1', false],
  ['11°3', '11°2', false],
  ['6°1', '', false],
  ['', '', false],
  ['TRANSICIÓN', 'transicion', true],
  ['TRANSICIÓN', '6°1', false],
];
for (const [a, b, expected] of matchVectors) {
  check(`gradesMatch(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${expected}`, gradesMatch(a, b) === expected);
}

section('D — compareGrades: orden natural (no alfabético)');
const shuffled = ['11°3', '6°2', '10°1', '6°1', '7°4', '11°1', '9°3', '6°10', '10°3'];
const sorted = [...shuffled].sort(compareGrades);
check('ordena 6°1 < 6°2 < 6°10 < 7°4 < 9°3 < 10°1 < 10°3 < 11°1 < 11°3',
  sorted.join(',') === '6°1,6°2,6°10,7°4,9°3,10°1,10°3,11°1,11°3', sorted.join(','));
check('localeCompare alfabético habría puesto 10°1 antes que 6°1 (prueba de que el orden natural importa)',
  ['10°1', '6°1'].sort((a, b) => a.localeCompare(b))[0] === '10°1');

section('E — buildGradeCatalog: derivado de datos reales, deduplicado y con conteos');
const catalog = buildGradeCatalog({
  students: [
    { grade: '6°4', active: true }, { grade: '6°4', active: true }, { grade: '6°4 ', active: false },
    { grade: '7º4', active: true }, { grade: '11°3', active: true },
    { grade: undefined, active: true }, { grade: 'SIN DATO', active: true },
  ],
  records: [{ studentGrade: '6°4' }, { studentGrade: '604' }],
  assignments: [{ grade: '6-4' }, { grade: '7°4' }],
  teachers: [{ assignedGrades: ['6°4', '11°3'], directorGrade: '6°4' }],
  institutional: ['6°1', '6°2', '7°1'],
});
check('agrupa las variantes en un solo curso canónico', catalog.length === 3, JSON.stringify(catalog.map(c => c.grade)));
check('6°4 cuenta 3 estudiantes (2 activos)', catalog[0].grade === '6°4' && catalog[0].students === 3 && catalog[0].activeStudents === 2, JSON.stringify(catalog[0]));
check('6°4 registra sus escrituras crudas distintas (espacio final, compacto, guion)',
  catalog[0].rawVariants.includes('6°4 ') && catalog[0].rawVariants.includes('604') && catalog[0].rawVariants.includes('6-4'),
  JSON.stringify(catalog[0].rawVariants));
check('la escritura idéntica al canónico no se lista como variante', !catalog[0].rawVariants.includes('6°4'));
check('7º4 → 7°4 con 1 estudiante y 1 cátedra', catalog[1].grade === '7°4' && catalog[1].students === 1 && catalog[1].assignments === 1, JSON.stringify(catalog[1]));
check('los grados institucionales SIN datos NO entran al catálogo de filtro', !catalog.some(c => c.grade === '6°1' || c.grade === '6°2' || c.grade === '7°1'));
check('registros de un curso sin matrícula siguen creando la entrada', buildGradeCatalog({ records: [{ studentGrade: '8°1' }] }).length === 1);

const withEmpty = buildGradeCatalog({
  students: [{ grade: '6°4', active: true }],
  institutional: ['6°1', '6°2'],
  includeEmptyInstitutional: true,
});
check('includeEmptyInstitutional añade los cursos de referencia al final (constructores)',
  withEmpty.map(c => c.grade).join(',') === '6°1,6°2,6°4' && withEmpty[0].students === 0, JSON.stringify(withEmpty.map(c => `${c.grade}:${c.students}`)));

section('F — resolveGradeSelection: nunca dejar un filtro huérfano');
check('selección vigente se conserva canonicalizada', resolveGradeSelection('6º4', catalog) === '6°4');
check('selección de un grado que ya no existe cae a "all"', resolveGradeSelection('9°9', catalog) === 'all');
check('"all" se conserva', resolveGradeSelection('all', catalog) === 'all');
check('vacío/null cae a "all"', resolveGradeSelection(undefined, catalog) === 'all');

section('G — gradeOptionLabel: el conteo hace visible la diferencia vacío/roto');
check('etiqueta larga con conteo', gradeOptionLabel(catalog[0]) === 'Grado 6°4 · 3 estudiantes', gradeOptionLabel(catalog[0]));
check('etiqueta corta con conteo', gradeOptionLabel(catalog[1], { short: true }) === '7°4 (1)', gradeOptionLabel(catalog[1], { short: true }));
check('singular correcto', gradeOptionLabel({ ...catalog[1], students: 1 }) === 'Grado 7°4 · 1 estudiante');

console.log('\n══════════════════════════════════════');
console.log(`  R69 GRADE CATALOG: ${passed} OK · ${failed} FALLO`);
if (failures.length) { console.log('  Fallos:'); failures.forEach(f => console.log(`   - ${f}`)); }
console.log('══════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
