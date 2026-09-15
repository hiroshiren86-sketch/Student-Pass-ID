/**
 * Utilidades de normalización y búsqueda inteligente de estudiantes
 *
 * R69 — endurecimiento (RC-7b/RC-8):
 *  · lectura DEFENSIVA de campos: el pull por rol despoja las fichas de terceros
 *    (`documentId`, `photoUrl`, `loginKey`…) y una búsqueda que asumía el campo
 *    presente lanzaba TypeError o descartaba la ficha (misma familia de defecto que
 *    el RC-1 de la Ronda 68, allí corregido en `getStudentByCodeOrDoc`).
 *  · `matchTeacherFuzzy`: el selector de identidad ("Escudito") buscaba docentes y
 *    estudiantes con `.toLowerCase().includes(q)` → sensible a tildes ("gomez" no
 *    encontraba "Gómez") y sin coincidencia por tokens en cualquier orden.
 *  · `matchesGradeFilter`: comparación canónica de curso para TODOS los filtros de
 *    la UI (antes `s.grade === selectedGrade` sobre la cadena cruda).
 */
import { canonicalGrade, gradesMatch } from './gradeCatalog';

/**
 * Normaliza cadenas de texto para búsqueda insensible a tildes, mayúsculas, diacríticos y puntuación
 */
export function normalizeSearchText(text: string): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quita tildes: á -> a, é -> e, etc.
    .replace(/[^a-z0-9]/g, ' ')       // Convierte puntos, guiones y símbolos en espacios
    .replace(/\s+/g, ' ')            // Colapsa múltiples espacios
    .trim();
}

/**
 * Normaliza números de documento o códigos para estandarización criptográfica y almacenamiento
 * Quita puntos, comas, guiones y espacios ("1.025.883.921" -> "1025883921")
 */
export function normalizeDocumentOrCode(doc: string): string {
  if (!doc) return '';
  return String(doc).trim().replace(/[^a-zA-Z0-9]/g, '');
}

/** Campos mínimos que la búsqueda de estudiantes necesita (todos opcionales en runtime). */
export interface StudentSearchable {
  firstName?: string | null;
  lastName?: string | null;
  code?: string | null;
  documentId?: string | null;
  grade?: string | null;
  section?: string | null;
}

/**
 * Búsqueda inteligente con tolerancia a orden de palabras, tildes, puntos y coincidencias parciales
 */
export function matchStudentFuzzy(student: StudentSearchable, query: string): boolean {
  if (!query || !String(query).trim()) return true;
  // R69: una ficha despojada/incompleta jamás rompe la búsqueda ni queda excluida.
  if (!student) return false;

  const rawClean = String(query).trim();
  const normalizedQuery = normalizeSearchText(rawClean);
  const docQuery = normalizeDocumentOrCode(rawClean).toLowerCase();

  const firstName = String(student.firstName ?? '');
  const lastName = String(student.lastName ?? '');
  const grade = String(student.grade ?? '');

  // Búsqueda directa por código o documento sin formato
  const stdDocClean = normalizeDocumentOrCode(String(student.documentId ?? '')).toLowerCase();
  const stdCodeClean = normalizeDocumentOrCode(String(student.code ?? '')).toLowerCase();

  // R69: sólo se interpreta como documento/código si tiene longitud de documento
  // (≥4 dígitos). Antes, buscar un curso ("6°4" → normalizado "64") devolvía también
  // todas las fichas cuyo código contuviera "64": falsos positivos que hacían creer
  // que el filtro por curso no acotaba bien.
  if (docQuery.length >= 4 && (stdDocClean.includes(docQuery) || stdCodeClean.includes(docQuery))) {
    return true;
  }

  // R69: el curso también es un criterio de búsqueda ("6°1", "6-1", "grado 6") — se
  // canonicaliza en los dos lados para que la escritura no importe.
  const queryGrade = canonicalGrade(rawClean.replace(/^(grado|curso|grupo)\s*/i, ''));
  if (queryGrade && gradesMatch(grade, queryGrade)) return true;

  // Búsqueda por palabras en nombres y apellidos (+ curso, como antes)
  const fullNameNorm = normalizeSearchText(`${firstName} ${lastName} ${grade} ${String(student.section ?? '')}`);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length === 0) return true;

  // Todos los términos escritos deben coincidir (en cualquier orden)
  return queryTokens.every(token => fullNameNorm.includes(token));
}

/** Campos mínimos que la búsqueda de docentes necesita. */
export interface TeacherSearchable {
  fullName?: string | null;
  documentId?: string | null;
  email?: string | null;
  username?: string | null;
  authEmail?: string | null;
  subjects?: string[] | null;
  assignedGrades?: string[] | null;
  directorGrade?: string | null;
}

/**
 * R69 (RC-8) — búsqueda de docentes equivalente a la de estudiantes: insensible a
 * tildes/mayúsculas, por tokens en cualquier orden, y por documento, correo,
 * usuario, asignatura o curso asignado.
 */
export function matchTeacherFuzzy(teacher: TeacherSearchable, query: string): boolean {
  if (!query || !String(query).trim()) return true;
  if (!teacher) return false;

  const rawClean = String(query).trim();
  const normalizedQuery = normalizeSearchText(rawClean);
  const docQuery = normalizeDocumentOrCode(rawClean).toLowerCase();

  const haystack = normalizeSearchText([
    teacher.fullName ?? '',
    teacher.email ?? '',
    teacher.authEmail ?? '',
    teacher.username ?? '',
    teacher.directorGrade ?? '',
    ...(teacher.subjects ?? []),
    ...(teacher.assignedGrades ?? []),
  ].join(' '));

  if (docQuery.length >= 4 && normalizeDocumentOrCode(String(teacher.documentId ?? '')).toLowerCase().includes(docQuery)) {
    return true; // R69: mismo criterio de longitud que en estudiantes
  }
  // Correo y usuario suelen escribirse con punto/arroba: también se comparan en crudo.
  const rawLower = rawClean.toLowerCase();
  if (rawLower.includes('@') || rawLower.includes('.')) {
    const emails = [teacher.email, teacher.authEmail, teacher.username].map(v => String(v ?? '').toLowerCase());
    if (emails.some(e => e.includes(rawLower))) return true;
  }

  const queryGrade = canonicalGrade(rawClean.replace(/^(grado|curso|grupo)\s*/i, ''));
  if (queryGrade) {
    const grades = [...(teacher.assignedGrades ?? []), teacher.directorGrade ?? ''].filter(Boolean) as string[];
    if (grades.some(g => gradesMatch(g, queryGrade))) return true;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length === 0) return true;
  return queryTokens.every(token => haystack.includes(token));
}

/**
 * R69 (RC-7b) — filtro de curso compartido por TODAS las vistas con selector de grado
 * (Directorio, Planilla, Carnés, Analítica, Escudito). `'all'`/vacío no filtran; el
 * resto se compara de forma canónica en los dos lados.
 */
export function matchesGradeFilter(value: string | null | undefined, selected: string | null | undefined): boolean {
  if (!selected || selected === 'all') return true;
  return gradesMatch(value, selected);
}
