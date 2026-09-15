/**
 * R69 — Generador DETERMINISTA de los fixtures de la simulación "Mini Colegio".
 *
 * Produce (en tests/fixtures/):
 *   1. matricula_mini_colegio_15_grupos.csv  → 150 estudiantes (15 cursos × 10)
 *   2. horarios_mini_colegio_15_grupos.csv   → 60 cátedras (Dirección de Grupo +
 *      Matemáticas + Lengua Castellana + Inglés por curso), sin choques de docente.
 *
 * DECISIÓN DE ALCANCE (el propietario delegó el criterio): la matrícula REAL que ya
 * está en la nube se RESPETA. Producción tiene 80 estudiantes en 6°4 (14), 7°4 (14),
 * 8°4 (14), 9°3 (13), 10°3 (13) y 11°3 (12) — AGENTS.md R37. Tres de esos cursos ya
 * cumplen "≥10 por sección" (9°3, 10°3, 11°3) y los otros tres son secciones 4 (extra).
 * Por tanto este fixture crea SÓLO los 15 cursos que faltan para cubrir de 6°1 a 11°3
 * con al menos 10 estudiantes por sección:
 *   6°1 6°2 6°3 · 7°1 7°2 7°3 · 8°1 8°2 8°3 · 9°1 9°2 · 10°1 10°2 · 11°1 11°2
 * Tras la importación el catálogo queda con 21 cursos, todos con ≥10 estudiantes
 * (230 en total), sin pisar una sola ficha existente.
 *
 * Ningún dato de este archivo se inyecta en el código de la app: la matrícula entra
 * por el flujo real de Rectoría (Directorio → Carga masiva por CSV), que es el camino
 * que el propietario pidió usar.
 *
 * Idempotencia: los documentos son deterministas (RNG con semilla fija), así que
 * re-importar el mismo CSV no duplica fichas — `addStudent` rechaza por código/
 * documento y el importador reporta los omitidos.
 *
 * Ejecutar: node tests/scripts/gen_fixtures_mini_colegio.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Modo --check (lo usa el CI): regenera en memoria y compara con los CSV versionados,
// SIN escribir. Garantiza que los fixtures committed coinciden con este generador
// determinista (si alguien edita un CSV a mano, el CI lo detecta).
const CHECK_ONLY = process.argv.includes('--check');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../fixtures');

// mulberry32 — RNG determinista (misma técnica que scripts/gen_horarios_csv.mjs)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Cursos que faltan para cubrir 6°1…11°3 con ≥10 estudiantes por sección ──
const GRUPOS_NUEVOS = [
  '6°1', '6°2', '6°3',
  '7°1', '7°2', '7°3',
  '8°1', '8°2', '8°3',
  '9°1', '9°2',
  '10°1', '10°2',
  '11°1', '11°2',
];
const POR_GRUPO = 10;

// Cursos que YA existen en producción (no se tocan; se listan para el informe).
const GRUPOS_EXISTENTES = [
  { grade: '6°4', count: 14 }, { grade: '7°4', count: 14 }, { grade: '8°4', count: 14 },
  { grade: '9°3', count: 13 }, { grade: '10°3', count: 13 }, { grade: '11°3', count: 12 },
];

// Nombres colombianos reales (los apellidos llevan tilde: el buscador de la app es
// insensible a tildes desde R69, y así la demo permite demostrarlo).
const NOMBRES_M = ['Santiago', 'Mateo', 'Juan David', 'Alejandro', 'Daniel', 'Sebastián', 'Felipe', 'Tomás', 'Samuel', 'Emiliano', 'Nicolás', 'Lucas', 'Martín', 'Joaquín', 'Simón', 'Camilo', 'Gabriel', 'Matías', 'Andrés', 'David', 'Diego', 'Esteban', 'Javier', 'Leonardo', 'Miguel', 'Emmanuel', 'Jerónimo', 'Isaac', 'Ángel', 'Cristian'];
const NOMBRES_F = ['Valentina', 'Mariana', 'Isabella', 'Camila', 'Salomé', 'Luciana', 'Gabriela', 'Sara', 'Juliana', 'Valeria', 'María José', 'Antonia', 'Emma', 'Manuela', 'Julieta', 'Elena', 'Alicia', 'Sofía', 'Catalina', 'Paula', 'Laura', 'Carolina', 'Daniela', 'Natalia', 'Valery', 'Renata', 'Emilia', 'Josefa', 'Victoria', 'Antonella'];
const APELLIDOS = ['Gómez', 'Martínez', 'Vargas', 'Zuluaga', 'Morales', 'Ríos', 'Mejía', 'Herrera', 'Quintero', 'Giraldo', 'Pérez', 'Arboleda', 'Montoya', 'Osorio', 'Echeverri', 'Villegas', 'Ceballos', 'Betancur', 'Gallego', 'Tamayo', 'Berrío', 'Correa', 'Guzmán', 'Rendón', 'Suárez', 'Ocampo', 'Espinosa', 'Álvarez', 'Restrepo', 'Botero', 'Castañeda', 'Saldarriaga', 'Trujillo', 'Valencia', 'Henao', 'Londoño', 'Cano', 'Castaño', 'Cardona', 'Jaramillo', 'Bedoya', 'Uribe', 'Tabares', 'Marín', 'Salazar', 'Cuartas', 'Duque', 'Posada', 'Sierra', 'Franco', 'Naranjo', 'Palacio', 'Rentería', 'Sepúlveda', 'Tobón', 'Usuga', 'Vélez', 'Zapata', 'Aristizábal', 'Blandón'];

// Docentes REALES del catálogo de producción (nombres exactos: el importador de
// horarios empareja por contención y la tarjeta de clase v2 valida que la asignatura
// esté en teacher.subjects — por eso cada materia usa sólo su pool autorizado,
// tomado de scripts/gen_horarios_csv.mjs).
const POOLS = {
  'Matemáticas': ['Juan Pablo Pérez Gómez', 'Germán Antonio Ospina Muñoz'],
  'Lengua Castellana': ['María Camila Restrepo Henao', 'Yenny Carolina Molina Giraldo'],
  'Inglés': ['Andrés Felipe Giraldo Duque', 'Natalia Andrea Gaviria Rivera'],
};
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function genMatricula() {
  const rnd = mulberry32(20260915); // semilla R69
  const rows = [['TIPO_DOC', 'DOCUMENTO', 'APELLIDOS', 'NOMBRES', 'CURSO']];
  const usados = new Set();
  let seq = 0;
  for (const grade of GRUPOS_NUEVOS) {
    for (let i = 0; i < POR_GRUPO; i++) {
      seq++;
      // Documentos TI de 10 dígitos en un rango propio (1 090 000 000+) — los
      // documentos reales de producción son de 8-9 dígitos, así que no hay colisión.
      let doc;
      do {
        doc = String(1090000000 + seq * 1013 + Math.floor(rnd() * 97));
      } while (usados.has(doc));
      usados.add(doc);

      const female = rnd() < 0.5;
      const nombre = female ? NOMBRES_F[Math.floor(rnd() * NOMBRES_F.length)] : NOMBRES_M[Math.floor(rnd() * NOMBRES_M.length)];
      const ap1 = APELLIDOS[Math.floor(rnd() * APELLIDOS.length)];
      let ap2 = APELLIDOS[Math.floor(rnd() * APELLIDOS.length)];
      if (ap2 === ap1) ap2 = APELLIDOS[(APELLIDOS.indexOf(ap1) + 7) % APELLIDOS.length];
      rows.push(['TI', doc, `${ap1} ${ap2}`, nombre, grade]);
    }
  }
  return rows.map(r => r.join(',')).join('\n') + '\n';
}

function genHorarios() {
  const rows = [['dia', 'grado', 'bloque', 'materia', 'docente', 'aula']];
  // Dirección de Grupo: lunes 1ª hora, sin docente concreto (igual que el horario
  // histórico del propietario: la dirige el titular del grupo).
  for (const grade of GRUPOS_NUEVOS) {
    rows.push(['Lunes', grade, '1', 'Dirección de Grupo', '', `Aula ${grade}`]);
  }
  // Materias del demo (Inglés, Matemáticas, Castellano): cada curso cae en una celda
  // (día, bloque) DISTINTA por materia → imposible que un docente quede doblemente
  // ocupado, aunque el pool sea de 2 profesores.
  Object.entries(POOLS).forEach(([subject, pool], subjectIdx) => {
    GRUPOS_NUEVOS.forEach((grade, g) => {
      // Celda (día, bloque) ÚNICA por curso y materia: el día se desfasa por materia
      // (mismo bloque, día distinto). Si las tres materias cayeran en la misma celda,
      // el upsert del importador (grado, día, bloque) las sobrescribiría y el horario
      // quedaría con un tercio de las cátedras. Los pools de docentes son disjuntos por
      // materia y cada (día, bloque) identifica un solo curso → cero choques de docente.
      const day = DAYS[(Math.floor(g / 3) + subjectIdx) % DAYS.length];
      const block = 2 + (g % 3);
      const teacher = pool[(g + subjectIdx) % pool.length];
      rows.push([day, grade, String(block), subject, teacher, `Aula ${grade}`]);
    });
  });
  return rows.map(r => r.join(',')).join('\n') + '\n';
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const matriculaPath = path.join(OUT_DIR, 'matricula_mini_colegio_15_grupos.csv');
const horariosPath = path.join(OUT_DIR, 'horarios_mini_colegio_15_grupos.csv');

if (CHECK_ONLY) {
  let drift = 0;
  for (const [file, esperado] of [[matriculaPath, genMatricula()], [horariosPath, genHorarios()]]) {
    if (!fs.existsSync(file)) { console.error(`✗ FALTA el fixture versionado: ${file}`); drift++; continue; }
    const actual = fs.readFileSync(file, 'utf8');
    if (actual !== esperado) { console.error(`✗ DRIFT: ${path.relative(process.cwd(), file)} no coincide con el generador`); drift++; }
    else console.log(`✓ ${path.relative(process.cwd(), file)} coincide con el generador determinista`);
  }
  if (drift > 0) {
    console.error('VERIFICACIÓN FALLÓ: ejecute `node tests/scripts/gen_fixtures_mini_colegio.mjs` y commitee los CSV.');
    process.exit(1);
  }
  console.log('✅ FIXTURES VERIFICADOS (--check)');
  process.exit(0);
}

fs.writeFileSync(matriculaPath, genMatricula(), 'utf8');
fs.writeFileSync(horariosPath, genHorarios(), 'utf8');

// ── Verificación de lo generado (el generador se auto-audita) ──
const mat = fs.readFileSync(matriculaPath, 'utf8').trim().split('\n').slice(1);
const porGrupo = new Map();
const docs = new Set();
for (const line of mat) {
  const [, doc, , , grade] = line.split(',');
  if (docs.has(doc)) throw new Error(`documento duplicado: ${doc}`);
  docs.add(doc);
  porGrupo.set(grade, (porGrupo.get(grade) || 0) + 1);
}
const horarios = fs.readFileSync(horariosPath, 'utf8').trim().split('\n').slice(1);
const celdas = new Map(); // `${dia}|${bloque}|${docente}` → grado (choques)
let choques = 0;
const celdasPorCurso = new Map(); // `${grado}|${dia}|${bloque}` → materia (upsert del importador)
let celdasPisadas = 0;
for (const line of horarios) {
  const [dia, grade, bloque, materia, docente] = line.split(',');
  const cellKey = `${grade}|${dia}|${bloque}`;
  if (celdasPorCurso.has(cellKey)) { celdasPisadas++; console.error(`  ✗ celda duplicada (se sobrescribiría): ${cellKey} (${celdasPorCurso.get(cellKey)} vs ${materia})`); }
  else celdasPorCurso.set(cellKey, materia);
  if (!docente) continue;
  const key = `${dia}|${bloque}|${docente}`;
  if (celdas.has(key)) { choques++; console.error(`  ✗ choque de docente: ${key} (${celdas.get(key)} vs ${grade})`); }
  else celdas.set(key, grade);
}

console.log('── Fixture de matrícula ──');
console.log(`  archivo          : ${path.relative(process.cwd(), matriculaPath)}`);
console.log(`  estudiantes      : ${mat.length} (documentos únicos: ${docs.size})`);
console.log(`  cursos           : ${porGrupo.size}`);
for (const g of GRUPOS_NUEVOS) console.log(`     · ${g.padEnd(5)} ${porGrupo.get(g) || 0} estudiantes`);
console.log(`  cursos existentes que NO se tocan: ${GRUPOS_EXISTENTES.map(g => `${g.grade} (${g.count})`).join(', ')}`);
console.log(`  total tras importar: ${mat.length + GRUPOS_EXISTENTES.reduce((a, b) => a + b.count, 0)} estudiantes en ${porGrupo.size + GRUPOS_EXISTENTES.length} cursos`);
console.log('── Fixture de horarios ──');
console.log(`  archivo          : ${path.relative(process.cwd(), horariosPath)}`);
console.log(`  cátedras         : ${horarios.length}`);
console.log(`  choques de docente: ${choques}`);
console.log(`  celdas (curso,día,bloque) únicas: ${celdasPorCurso.size} de ${horarios.length} filas`);
if (choques > 0) { console.error('GENERADOR FALLÓ: hay choques de horario'); process.exit(1); }
if (celdasPisadas > 0) { console.error('GENERADOR FALLÓ: hay celdas que se sobrescribirían al importar'); process.exit(1); }
for (const g of GRUPOS_NUEVOS) if ((porGrupo.get(g) || 0) < POR_GRUPO) { console.error(`GENERADOR FALLÓ: ${g} tiene menos de ${POR_GRUPO}`); process.exit(1); }
console.log('✅ FIXTURES GENERADOS Y AUTO-AUDITADOS');
