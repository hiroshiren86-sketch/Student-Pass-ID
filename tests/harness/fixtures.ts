/**
 * R69 — Fixtures de matrícula para pruebas locales (jsdom/bun, sin red).
 *
 * La distribución base replica el catálogo REAL de producción documentado en la
 * bitácora (AGENTS.md, Ronda 37 "matrícula demo mini colegio", línea ~1198):
 *   6°4 (14) · 7°4 (14) · 8°4 (14) · 9°3 (13) · 10°3 (13) · 11°3 (12) = 80 estudiantes.
 * Ese dato es el que explica el bug reportado por el propietario: el selector de
 * grado ofrecía 6°1/6°2/7°1/… (catálogo estático SCHOOL_GRADES_LIST) que en la
 * nube NO tienen ningún estudiante.
 *
 * Ningún fixture se inyecta en el código de la app: viven sólo en tests/.
 */
import type { Student, Teacher } from '../../src/types/attendance';

/** Grupos reales de producción (grado → cantidad de estudiantes). */
export const PRODUCTION_GROUPS: Array<{ grade: string; count: number }> = [
  { grade: '6°4', count: 14 },
  { grade: '7°4', count: 14 },
  { grade: '8°4', count: 14 },
  { grade: '9°3', count: 13 },
  { grade: '10°3', count: 13 },
  { grade: '11°3', count: 12 },
];

const FIRST = ['ALEJANDRO', 'JULIANA', 'NATALIA', 'SANTIAGO', 'VALERIA', 'MATEO', 'SALOME', 'EMILIANO', 'LUCIANA', 'NICOLAS', 'GABRIELA', 'SAMUEL', 'ANTONIA', 'DAVID', 'MANUELA', 'FELIPE'];
const LAST = ['GOMEZ RESTREPO', 'MARTINEZ VARGAS', 'ZULUAGA MEJIA', 'MORALES RIOS', 'QUINTERO GIRALDO', 'ARBOLEDA MONTOYA', 'OSORIO ECHEVERRI', 'VILLEGAS CEBALLOS', 'BETANCUR GALLEGO', 'TAMAYO BERRIO', 'CORREA GUZMAN', 'RENDON OCAMPO', 'ESPINOZA ALVAREZ', 'BOTERO CASTAÑEDA', 'SALDARRIAGA TRUJILLO', 'VALENCIA HENAO'];

function sectionOf(grade: string): string {
  const m = grade.match(/([1-9])$/);
  return m ? m[1] : '1';
}

/**
 * Construye el catálogo base (réplica de producción). Los códigos son secuenciales
 * y los documentos realistas (9-10 dígitos) como los del CSV SIMAT del colegio.
 */
export function buildProductionStudents(opts?: { withVariants?: boolean }): Student[] {
  const students: Student[] = [];
  let n = 0;
  for (const group of PRODUCTION_GROUPS) {
    for (let i = 0; i < group.count; i++) {
      n++;
      const doc = `${1700000000 + n * 137}`.slice(0, 10);
      students.push({
        code: doc,
        documentId: doc,
        documentType: 'TI',
        firstName: FIRST[n % FIRST.length],
        lastName: LAST[(n * 3) % LAST.length],
        grade: group.grade,
        section: sectionOf(group.grade),
        active: true,
        createdAt: '2026-09-01T10:00:00.000Z',
        tempPassword: '000000',
      });
    }
  }
  if (opts?.withVariants) {
    // Variantes de escritura del MISMO grado que han llegado históricamente por
    // CSV/Excel/SIMAT y que el pull de la nube NO canonicaliza (cloudflareSync.ts
    // guarda la ficha tal cual viene del Worker). Sirven para probar robustez.
    const variants: Array<{ grade: string; tag: string }> = [
      { grade: '6°1 ', tag: 'espacio final (CSV)' },
      { grade: '6º2', tag: 'ordinal masculino U+00BA (Excel)' },
      { grade: '7-1', tag: 'guion (SIMAT)' },
      { grade: ' 8°2', tag: 'espacio inicial' },
      { grade: '9\u00A01', tag: 'espacio duro NBSP' },
      { grade: '601', tag: 'compacto de 3 dígitos' },
    ];
    variants.forEach((v, idx) => {
      const doc = `${1900000000 + idx * 991}`.slice(0, 10);
      students.push({
        code: doc,
        documentId: doc,
        documentType: 'TI',
        firstName: `VARIANTE${idx + 1}`,
        lastName: 'PRUEBA GRADO',
        grade: v.grade,
        section: sectionOf(v.grade.replace(/\D/g, '')),
        active: true,
        createdAt: '2026-09-01T10:00:00.000Z',
      });
    });
  }
  return students;
}

/** Docentes de prueba (34 en producción; aquí una muestra representativa). */
export function buildTeachers(): Teacher[] {
  const base = [
    { fullName: 'MARTA RESTREPO', subjects: ['Matemáticas', 'Física'], grades: ['6°4', '7°4'], email: 'mrestrepo@inas.edu.co', director: '6°4' },
    { fullName: 'JUAN PABLO OSPINA', subjects: ['Inglés'], grades: ['8°4', '9°3'], email: 'jospina@inas.edu.co', director: '' },
    { fullName: 'CARLOS ANDRES VELASQUEZ', subjects: ['Castellano', 'Humanidades'], grades: ['10°3', '11°3'], email: 'cvelasquez@inas.edu.co', director: '11°3' },
    { fullName: 'ANA MARÍA SOTO', subjects: ['Ciencias Naturales', 'Química'], grades: ['6°4', '8°4'], email: 'asoto@inas.edu.co', director: '' },
    { fullName: 'LUISA FERNANDA TORO', subjects: ['Sociales', 'Filosofía'], grades: ['9°3', '11°3'], email: 'ltoro@inas.edu.co', director: '9°3' },
  ];
  return base.map((t, i) => ({
    id: `t-${1000 + i}`,
    documentId: `${43000000 + i * 7331}`,
    fullName: t.fullName,
    email: t.email,
    subjects: t.subjects,
    assignedGrades: t.grades,
    username: t.email.split('@')[0],
    active: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    isGroupDirector: !!t.director,
    directorGrade: t.director || undefined,
    hasFirebaseAccount: i === 0,
    authEmail: i === 0 ? t.email : undefined,
  }));
}

/**
 * R69 — Docentes REALES del catálogo de producción con sus asignaturas.
 * Nombres y materias tomados de `scripts/gen_horarios_csv.mjs` (el generador que el
 * propietario usó en R41 con "los 20 docentes reales, nombres EXACTOS de su lista").
 * Se usan en el ensayo local para que el importador de horarios resuelva teacherId y
 * para que la tarjeta de clase v2 valide `asignatura ∈ teacher.subjects`.
 */
const TEACHER_SUBJECTS: Array<[string, string[]]> = [
  ['Juan Pablo Pérez Gómez', ['Matemáticas', 'Geometría']],
  ['Germán Antonio Ospina Muñoz', ['Matemáticas']],
  ['María Camila Restrepo Henao', ['Lengua Castellana', 'Ética']],
  ['Yenny Carolina Molina Giraldo', ['Lengua Castellana', 'Ética']],
  ['Andrés Felipe Giraldo Duque', ['Inglés']],
  ['Natalia Andrea Gaviria Rivera', ['Inglés', 'Artística']],
  ['Diana Carolina Valencia Morales', ['Ciencias Naturales (Biología)', 'Química']],
  ['Lorena María Osorio Arboleda', ['Ciencias Naturales (Biología)']],
  ['Carlos Alberto Mendoza Jaramillo', ['Sociales', 'Filosofía']],
  ['Jorge Enrique Betancur Londoño', ['Sociales']],
  ['Ricardo Alberto Salazar Jaramillo', ['Educación Física']],
  ['Sebastián Morales Castro', ['Informática']],
  ['Ana María Betancur Escobar', ['Geometría']],
  ['Diego Fernando Ramírez Zapata', ['Física']],
  ['Óscar Iván Torres Monsalve', ['Ciencias Económicas y Políticas']],
  ['Paula Andrea Ruiz Cardona', ['Artística']],
  ['Gloria Isabel Puerta Rendón', ['Ética']],
  ['Héctor Mauricio Londoño Zuluaga', ['Religión']],
  ['Sandra Milena Arboleda Ruiz', ['Religión']],
  ['Laura Ximena Vargas Zuleta', ['Cátedra de la Paz']],
];

function slugEmail(fullName: string): string {
  const parts = fullName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ');
  return `${parts[0].charAt(0)}${parts[2] || parts[1]}`;
}

/** Los 20 docentes reales, con cuenta de acceso sólo para el primero (caso E2E R68). */
export function buildRealTeachers(directorByGrade?: Record<string, string>): Teacher[] {
  return TEACHER_SUBJECTS.map(([fullName, subjects], i) => {
    const email = `${slugEmail(fullName)}@inas.edu.co`;
    const directedGrade = Object.entries(directorByGrade ?? {}).find(([, name]) => name === fullName)?.[0];
    return {
      id: `prof-real-${100 + i}`,
      documentId: `${43100000 + i * 4211}`,
      fullName,
      email,
      subjects: directedGrade ? [...subjects, 'Dirección de Grupo'] : subjects,
      assignedGrades: [],
      username: slugEmail(fullName),
      active: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      isGroupDirector: !!directedGrade,
      directorGrade: directedGrade,
      hasFirebaseAccount: i === 0,
      authEmail: i === 0 ? 'mrestrepo@inas.edu.co' : undefined,
    };
  });
}

/** Nombres exactos de los docentes reales (para asserts de resolución en importadores). */
export const REAL_TEACHER_NAMES = TEACHER_SUBJECTS.map(([n]) => n);
