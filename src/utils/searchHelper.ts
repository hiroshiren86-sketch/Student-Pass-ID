/**
 * Utilidades de normalización y búsqueda inteligente de estudiantes
 */

/**
 * Normaliza cadenas de texto para búsqueda insensible a tildes, mayúsculas, diacríticos y puntuación
 */
export function normalizeSearchText(text: string): string {
  if (!text) return '';
  return text
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
  return doc.trim().replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Búsqueda inteligente con tolerancia a orden de palabras, tildes, puntos y coincidencias parciales
 */
export function matchStudentFuzzy(
  student: { firstName: string; lastName: string; code: string; documentId: string; grade: string },
  query: string
): boolean {
  if (!query || !query.trim()) return true;

  const rawClean = query.trim();
  const normalizedQuery = normalizeSearchText(rawClean);
  const docQuery = normalizeDocumentOrCode(rawClean).toLowerCase();

  // Búsqueda directa por código o documento sin formato
  const stdDocClean = normalizeDocumentOrCode(student.documentId).toLowerCase();
  const stdCodeClean = normalizeDocumentOrCode(student.code).toLowerCase();

  if (docQuery && (stdDocClean.includes(docQuery) || stdCodeClean.includes(docQuery))) {
    return true;
  }

  // Búsqueda por palabras en nombres y apellidos
  const fullNameNorm = normalizeSearchText(`${student.firstName} ${student.lastName} ${student.grade}`);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  // Todos los términos escritos deben coincidir (en cualquier orden)
  return queryTokens.every(token => fullNameNorm.includes(token));
}
