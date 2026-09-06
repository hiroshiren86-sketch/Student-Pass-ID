/**
 * Ronda 41 — Generador de horario de demostración INAS (coherente, sin choques).
 * - 6 grados reales con matrícula: 6°4, 7°4, 8°4, 9°3, 10°3, 11°3 (80 estudiantes).
 * - 5 días × 6 bloques (jornada mañana 06:30–12:30, slots del usuario).
 * - Los 17 subjects institucionales; docentes = los 20 reales del propietario
 *   (nombres EXACTOS de su lista para que el importador resuelva teacherId).
 * - Sin choques: un docente no puede estar en 2 grados el mismo (día, bloque).
 *   Aulas especiales compartidas (Sala de Sistemas, Lab de Ciencias, Cancha) con
 *   control de choque → fallback al aula del grupo.
 * - RNG con semilla fija → reproducible.
 */
import fs from 'node:fs';

const GRADES = ['6°4', '7°4', '8°4', '9°3', '10°3', '11°3'];
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']; // 1..5
const BLOCKS = [1, 2, 3, 4, 5, 6]; // ordinales entre los 6 bloques CLASE

// Cuotas semanales por grado (suman 30 = 5×6). Pools = docentes reales por asignatura.
const SUBJECTS = [
  { subject: 'Matemáticas', quota: 4, pool: ['Juan Pablo Pérez Gómez', 'Germán Antonio Ospina Muñoz'] },
  { subject: 'Lengua Castellana', quota: 4, pool: ['María Camila Restrepo Henao', 'Yenny Carolina Molina Giraldo'] },
  { subject: 'Inglés', quota: 3, pool: ['Andrés Felipe Giraldo Duque', 'Natalia Andrea Gaviria Rivera'] },
  { subject: 'Ciencias Naturales (Biología)', quota: 3, pool: ['Diana Carolina Valencia Morales', 'Lorena María Osorio Arboleda'] },
  { subject: 'Sociales', quota: 2, pool: ['Carlos Alberto Mendoza Jaramillo', 'Jorge Enrique Betancur Londoño'] },
  { subject: 'Educación Física', quota: 2, pool: ['Ricardo Alberto Salazar Jaramillo'], room: 'Cancha Polideportiva' },
  { subject: 'Informática', quota: 2, pool: ['Sebastián Morales Castro'], room: 'Sala de Sistemas' },
  { subject: 'Geometría', quota: 1, pool: ['Ana María Betancur Escobar'] },
  { subject: 'Física', quota: 1, pool: ['Diego Fernando Ramírez Zapata'] },
  { subject: 'Química', quota: 1, pool: ['Diana Carolina Valencia Morales'], room: 'Laboratorio de Ciencias' },
  { subject: 'Filosofía', quota: 1, pool: ['Carlos Alberto Mendoza Jaramillo'] },
  { subject: 'Ciencias Económicas y Políticas', quota: 1, pool: ['Óscar Iván Torres Monsalve'] },
  { subject: 'Artística', quota: 1, pool: ['Paula Andrea Ruiz Cardona', 'Natalia Andrea Gaviria Rivera'] },
  { subject: 'Ética', quota: 1, pool: ['Gloria Isabel Puerta Rendón', 'Yenny Carolina Molina Giraldo'] },
  { subject: 'Religión', quota: 1, pool: ['Héctor Mauricio Londoño Zuluaga', 'Sandra Milena Arboleda Ruiz'] },
  { subject: 'Cátedra de la Paz', quota: 1, pool: ['Laura Ximena Vargas Zuleta'] },
];
const DIRECCION = { subject: 'Dirección de Grupo', teacher: '' }; // Lunes bloque 1, Docente Titular

// mulberry32 — RNG determinista
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260906);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const rows = [];
let finalRem = null; // mapa de cuotas de la solución exitosa

// Scheduler con reintentos: cada intento construye la semana completa desde cero.
// Un (día, bloque) no puede repetir docente entre grados; si un intento se traba,
// se reinicia con nueva aleatoriedad (hasta 500 intentos, RNG determinista global).
let attempt = 0;
let done = false;
while (!done && attempt < 500) {
  attempt++;
  const teacherBusy = {}; // teacherBusy[dia][bloque] = Set(docentes)
  const roomBusy = {};
  for (const d of DAYS) { teacherBusy[d] = {}; roomBusy[d] = {}; for (const b of BLOCKS) { teacherBusy[d][b] = new Set(); roomBusy[d][b] = new Set(); } }
  const rem = {}; // grade -> Map(subject -> resta)
  for (const g of GRADES) rem[g] = new Map(SUBJECTS.map(s => [s.subject, s.quota]));
  const dayCount = {}; // grade -> dia -> Map(subject -> n) — coherencia: máx 1 por día (tolera 2 como fallback)
  for (const g of GRADES) { dayCount[g] = {}; for (const d of DAYS) dayCount[g][d] = new Map(); }
  rows.length = 0;
  done = true;

  outer:
  for (const d of shuffle(DAYS)) {
    for (const b of shuffle(BLOCKS)) {
      for (const g of shuffle(GRADES)) {
        // Lunes bloque 1 → Dirección de Grupo (Docente Titular, sin choque posible)
        if (d === 'Lunes' && b === 1) {
          rows.push({ day: d, grade: g, block: b, subject: DIRECCION.subject, teacher: '', room: `Aula ${g}` });
          continue;
        }
        const pend = SUBJECTS.filter(s => (rem[g].get(s.subject) || 0) > 0);
        const teacherFree = s => s.pool.some(t => !teacherBusy[d][b].has(t));
        const dayN = s => dayCount[g][d].get(s.subject) || 0;
        // preferencia: sin esa materia hoy; fallback: máx 2 el mismo día
        let free = pend.filter(s => teacherFree(s) && dayN(s) === 0);
        if (free.length === 0) free = pend.filter(s => teacherFree(s) && dayN(s) < 2);
        if (free.length === 0) { done = false; break outer; } // intento trancado → reiniciar
        const chosen = free[Math.floor(rnd() * free.length)];
        const teacherPool = chosen.pool.filter(t => !teacherBusy[d][b].has(t));
        const teacher = teacherPool[Math.floor(rnd() * teacherPool.length)];
        teacherBusy[d][b].add(teacher);
        let room = `Aula ${g}`;
        if (chosen.room && !roomBusy[d][b].has(chosen.room)) { room = chosen.room; roomBusy[d][b].add(room); }
        rem[g].set(chosen.subject, rem[g].get(chosen.subject) - 1);
        dayCount[g][d].set(chosen.subject, dayN(chosen) + 1);
        rows.push({ day: d, grade: g, block: b, subject: chosen.subject, teacher, room });
      }
    }
  }
  if (done) {
    for (const g of GRADES) for (const [, left] of rem[g]) if (left !== 0) { done = false; }
  }
  if (done) finalRem = rem;
}
if (!done) throw new Error('No se encontró solución en 500 intentos');

// Validaciones duras
const total = rows.length;
if (total !== 180) throw new Error(`filas esperadas 180, salieron ${total}`);
for (const g of GRADES) {
  for (const [subj, left] of finalRem.get ? finalRem.get(g) : finalRem[g]) if (left !== 0) throw new Error(`${g}: cupo sin usar de ${subj} (${left})`);
  const perGrade = rows.filter(r => r.grade === g).length;
  if (perGrade !== 30) throw new Error(`${g} tiene ${perGrade} cátedras (esperadas 30)`);
}
// cobertura de asignaturas por grado (17 con Dirección)
for (const g of GRADES) {
  const set = new Set(rows.filter(r => r.grade === g).map(r => r.subject));
  if (set.size !== 17) throw new Error(`${g} cubre ${set.size} asignaturas (esperadas 17)`);
}
// choques por (d,b) revisados en vivo; contador de docente libre adicional:
const teacherLoad = {};
rows.forEach(r => { if (r.teacher) teacherLoad[r.teacher] = (teacherLoad[r.teacher] || 0) + 1; });

// CSV (delimitador ',': ninguno de los campos lleva coma)
const lines = ['dia,grado,bloque,materia,docente,aula'];
const order = { Lunes: 1, Martes: 2, 'Miércoles': 3, Jueves: 4, Viernes: 5 };
const sorted = [...rows].sort((a, b) => (order[a.day] - order[b.day]) || a.grade.localeCompare(b.grade, 'es') || (a.block - b.block));
for (const r of sorted) lines.push(`${r.day},${r.grade},${r.block},${r.subject},${r.teacher},${r.room}`);
fs.writeFileSync('/home/z/my-project/scripts/horarios_demo_inas.csv', lines.join('\n') + '\n');

console.log(`✅ CSV generado: ${total} cátedras (6 grados × 30)`);
console.log('\nCarga por docente (horas/semana):');
Object.entries(teacherLoad).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${n}h  ${t}`));
console.log('\nMuestra (primeras 8):');
sorted.slice(0, 8).forEach(r => console.log(`  ${r.day} ${r.grade} B${r.block}: ${r.subject} — ${r.teacher || 'Docente Titular'} — ${r.room}`));
