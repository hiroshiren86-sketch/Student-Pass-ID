/**
 * R69 — Catálogo y canonicalización de GRADOS/CURSOS.
 *
 * ORIGEN (bug reportado por el propietario, reproducido en
 * `tests/unit/r69_filtro_grado_dom.ts`):
 *
 *   "Al filtrar por un grado específico (ej. 6°1) la lista aparece vacía, pero al
 *    seleccionar 'Todos los grados' se muestran datos."
 *
 * Causa raíz doble, ambas verificadas contra el catálogo real de producción
 * (80 estudiantes en 6°4, 7°4, 8°4, 9°3, 10°3, 11°3 — AGENTS.md R37 §"matrícula
 * demo mini colegio"):
 *
 *   RC-7a · SELECTOR CONTAMINADO POR DATOS ESTÁTICOS: `getUniqueGrades()` mezclaba
 *           la matrícula real con `SCHOOL_GRADES_LIST` (el catálogo demo hardcodeado
 *           de `mockData.ts`: 6°1, 6°2, 7°1 … 11°2) y, por el orden alfabético,
 *           esos 12 grados SIN UN SOLO ESTUDIANTE quedaban primeros en el desplegable.
 *           Elegir "6°1" filtraba correctamente… sobre un conjunto vacío. La Ronda 42
 *           (H-42-1) ya había diagnosticado este mismo mecanismo en Horarios y lo
 *           corrigió SOLO allí; el Directorio, la Planilla, los Carnés y la Analítica
 *           siguieron expuestos.
 *
 *   RC-7b · COMPARACIÓN POR IGUALDAD LITERAL: todos los filtros hacían
 *           `s.grade === selectedGrade` sobre la cadena cruda. El pull de la nube
 *           (cloudflareSync.ts) guarda la ficha TAL CUAL viene del Worker, sin
 *           canonicalizar, así que conviven escrituras equivalentes del mismo curso
 *           ("6°1" / "6°1 " / "6º1" con ordinal U+00BA / "6-1" / "601" / NBSP).
 *           `getUniqueGrades()` además añadía el valor CRUDO tras validar una copia
 *           recortada → dos opciones visualmente idénticas, una de ellas siempre vacía.
 *
 * Este módulo es la única autoridad de comparación de grados: canonicaliza en los
 * DOS lados y construye el catálogo a partir de los datos reales (con conteos, para
 * que "vacío" y "roto" no se confundan nunca más en la UI).
 */

/** Signo de grado canónico (U+00B0). */
export const DEGREE_SIGN = '\u00B0';

/** Variantes tipográficas del signo de grado que llegan de Excel/Word/teclados ES. */
const DEGREE_ALIASES = /[\u00BA\u02DA\u1D52\u00B0]/g; // º ˚ ᵒ °

/** Grupos especiales (preescolar / aceleración) que no son "grado°sección". */
const SPECIAL_GROUPS: Record<string, string> = {
  TRANSICION: 'TRANSICIÓN',
  TRANSICIÓN: 'TRANSICIÓN',
  JARDIN: 'JARDÍN',
  JARDÍN: 'JARDÍN',
  PARVULOS: 'PÁRVULOS',
  PÁRVULOS: 'PÁRVULOS',
  PREESCOLAR: 'PREESCOLAR',
  ACELERACION: 'ACELERACIÓN',
  ACELERACIÓN: 'ACELERACIÓN',
  BRICOL: 'BRICOL',
};

/** Nombres escritos de los grados (planillas que llegan por CSV en letras). */
const WORD_GRADES: Array<[RegExp, string]> = [
  [/PRE\s*ESCOLAR|PREESCOLAR/g, 'PREESCOLAR'],
  [/TRANSICION|TRANSICIÓ?N/g, 'TRANSICION'],
  [/PRIMERO/g, '1'], [/SEGUNDO/g, '2'], [/TERCERO/g, '3'], [/CUARTO/g, '4'],
  [/QUINTO/g, '5'], [/SEXTO/g, '6'], [/S[ÉE]PTIMO/g, '7'], [/OCTAVO/g, '8'],
  [/NOVENO/g, '9'], [/D[ÉE]CIMO/g, '10'], [/ONCE/g, '11'],
];

function clean(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')              // NBSP → espacio, ligaduras, etc.
    .replace(DEGREE_ALIASES, DEGREE_SIGN)
    .replace(/[\u2013\u2014\u2010\u2011\u2012]/g, '-') // guiones tipográficos → ASCII
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Devuelve la forma canónica de un curso: `"6°1"`, `"11°3"`, `"TRANSICIÓN"`.
 * Devuelve `null` cuando la entrada NO es un curso reconocible — a diferencia de
 * `normalizeGradeName()` (que ante basura devuelve `'6°1'` y por tanto INVENTA
 * matrícula), aquí la ambigüedad se propaga al llamador en vez de silenciarse.
 *
 * Acepta, entre otras: `6°1` · `6º1` · `6 1` · `6-1` · `6.1` · `601` · `0601` ·
 * `1004` · `GRADO 6-1` · `CURSO 6°1` · `SEXTO 1` · `"  6°1  "` · `6\u00A01`.
 */
export function canonicalGrade(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = clean(String(raw));
  if (!s) return null;

  s = s.replace(/^(GRADO|CURSO|GRUPO|CLASE)\s*/i, '').trim();
  if (!s) return null;

  // 1) Grupos especiales por nombre
  const letters = s.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  if (letters && SPECIAL_GROUPS[letters]) return SPECIAL_GROUPS[letters];
  if (SPECIAL_GROUPS[s]) return SPECIAL_GROUPS[s];

  // 2) Nombres escritos → dígitos ("SEXTO 1" → "6 1")
  let words = s;
  for (const [re, rep] of WORD_GRADES) words = words.replace(re, rep);

  // 3) Extracción numérica grado/sección
  const compact = words.replace(/[^0-9]/g, '');
  if (!compact) return null;

  // 3a) Con separador explícito: "6°1", "10-4", "11 2", "6.1"
  const sep = words.match(/(\d{1,2})\s*[°\-\s./]\s*(\d{1,2})/);
  if (sep) {
    const g = parseInt(sep[1], 10);
    const sec = parseInt(sep[2], 10);
    if (g >= 1 && g <= 11 && sec >= 1 && sec <= 9) return `${g}${DEGREE_SIGN}${sec}`;
  }

  // 3b) Compacto sin separador: "601", "1004", "1103", "0601"
  if (/^\d{3,4}$/.test(compact)) {
    const head = compact.length === 4 ? compact.slice(0, 2) : compact[0];
    const tail = compact.length === 4 ? compact.slice(2) : compact.slice(1);
    const g = parseInt(head, 10);
    const sec = parseInt(tail, 10);
    if (g >= 1 && g <= 11 && sec >= 1 && sec <= 9) return `${g}${DEGREE_SIGN}${sec}`;
  }

  // 3c) Dos dígitos sueltos: "61" → 6°1
  if (/^\d{2}$/.test(compact)) {
    const g = parseInt(compact[0], 10);
    const sec = parseInt(compact[1], 10);
    if (g >= 1 && g <= 11 && sec >= 1 && sec <= 9) return `${g}${DEGREE_SIGN}${sec}`;
  }

  return null;
}

/** `true` si la cadena es un curso reconocible (canónico o equivalente). */
export function isKnownGrade(raw: string | null | undefined): boolean {
  return canonicalGrade(raw) !== null;
}

/**
 * Comparación canónica de cursos. `null`/vacío sólo iguala a `null`/vacío:
 * una ficha sin grado nunca "coincide" con un filtro concreto.
 */
export function gradesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalGrade(a);
  const cb = canonicalGrade(b);
  if (ca === null || cb === null) return false;
  return ca === cb;
}

/** Orden natural: 6°1 < 6°2 < 6°10 < 7°1 … < 11°3; los grupos especiales van primero. */
export function compareGrades(a: string, b: string): number {
  const ca = canonicalGrade(a) ?? clean(a);
  const cb = canonicalGrade(b) ?? clean(b);
  const ma = ca.match(/^(\d{1,2})°(\d{1,2})$/);
  const mb = cb.match(/^(\d{1,2})°(\d{1,2})$/);
  if (ma && mb) {
    const g = parseInt(ma[1], 10) - parseInt(mb[1], 10);
    if (g !== 0) return g;
    return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  }
  if (ma && !mb) return 1;   // numéricos después de los especiales
  if (!ma && mb) return -1;
  return ca.localeCompare(cb, 'es');
}

/** Una entrada del catálogo de cursos derivada de datos REALES. */
export interface GradeCatalogEntry {
  /** Curso en forma canónica (valor estable para el `value` del <select>). */
  grade: string;
  /** Estudiantes de la matrícula (activos e inactivos). */
  students: number;
  /** Estudiantes activos. */
  activeStudents: number;
  /** Registros de asistencia/planilla del curso. */
  records: number;
  /** Cátedras asignadas en el horario. */
  assignments: number;
  /** Docentes con el curso asignado. */
  teachers: number;
  /** Escrituras crudas distintas que se canonicalizan a este curso (transparencia). */
  rawVariants: string[];
}

export interface GradeCatalogInput {
  students?: Array<{ grade?: string | null; active?: boolean } | null | undefined>;
  records?: Array<{ studentGrade?: string | null } | null | undefined>;
  assignments?: Array<{ grade?: string | null } | null | undefined>;
  teachers?: Array<{ assignedGrades?: string[] | null; directorGrade?: string | null } | null | undefined>;
  /**
   * Grados institucionales de referencia (p. ej. el catálogo oficial del colegio).
   * Entran al catálogo SOLO si tienen datos; si `includeEmptyInstitutional` es true
   * se listan al final con conteo 0 (uso: constructores de horario/asignación de
   * docentes, donde sí tiene sentido ofrecer un curso aún sin matrícula).
   */
  institutional?: string[];
  includeEmptyInstitutional?: boolean;
}

/**
 * Construye el catálogo de cursos a partir de los datos reales, canonicalizado,
 * deduplicado y ordenado naturalmente. Es la fuente del selector de grado de
 * Directorio / Planilla / Carnés / Analítica y del agrupador del Escudito.
 */
export function buildGradeCatalog(input: GradeCatalogInput): GradeCatalogEntry[] {
  const map = new Map<string, GradeCatalogEntry>();
  const entry = (grade: string): GradeCatalogEntry | null => {
    const canonical = canonicalGrade(grade);
    if (!canonical) return null;
    let e = map.get(canonical);
    if (!e) {
      e = { grade: canonical, students: 0, activeStudents: 0, records: 0, assignments: 0, teachers: 0, rawVariants: [] };
      map.set(canonical, e);
    }
    return e;
  };
  // Se registra la escritura CRUDA (sin recortar) para que la UI pueda avisar al
  // operador que su catálogo trae variantes invisibles ("6°4 " con espacio final,
  // "604" compacto, "6-4" con guion) aunque todas filtren igual.
  const noteVariant = (e: GradeCatalogEntry, raw: string | null | undefined) => {
    const value = String(raw ?? '');
    if (value && value !== e.grade && !e.rawVariants.includes(value)) e.rawVariants.push(value);
  };

  for (const s of input.students ?? []) {
    if (!s) continue;
    const e = entry(String(s.grade ?? ''));
    if (!e) continue;
    e.students += 1;
    if (s.active !== false) e.activeStudents += 1;
    noteVariant(e, s.grade);
  }
  for (const r of input.records ?? []) {
    if (!r) continue;
    const e = entry(String(r.studentGrade ?? ''));
    if (!e) continue;
    e.records += 1;
    noteVariant(e, r.studentGrade);
  }
  for (const a of input.assignments ?? []) {
    if (!a) continue;
    const e = entry(String(a.grade ?? ''));
    if (!e) continue;
    e.assignments += 1;
    noteVariant(e, a.grade);
  }
  for (const t of input.teachers ?? []) {
    if (!t) continue;
    const grades = new Set<string>();
    for (const g of t.assignedGrades ?? []) if (g) grades.add(String(g));
    if (t.directorGrade) grades.add(String(t.directorGrade));
    for (const g of grades) {
      const e = entry(g);
      if (!e) continue;
      e.teachers += 1;
      noteVariant(e, g);
    }
  }

  let entries = Array.from(map.values()).filter(e => e.students > 0 || e.records > 0 || e.assignments > 0 || e.teachers > 0);

  if (input.includeEmptyInstitutional) {
    for (const g of input.institutional ?? []) {
      const e = entry(g);
      if (e) continue; // ya existe con datos
      const canonical = canonicalGrade(g);
      if (!canonical || map.has(canonical)) continue;
      map.set(canonical, { grade: canonical, students: 0, activeStudents: 0, records: 0, assignments: 0, teachers: 0, rawVariants: [] });
    }
    entries = Array.from(map.values());
  }

  return entries.sort((a, b) => compareGrades(a.grade, b.grade));
}

/**
 * Selector de grado "seguro": si el valor elegido ya no existe en el catálogo
 * (p. ej. llegó de un localStorage viejo o el pull cambió la matrícula), devuelve
 * `'all'` en vez de dejar la vista clavada en un filtro huérfano → tabla vacía.
 */
export function resolveGradeSelection(selected: string | null | undefined, catalog: GradeCatalogEntry[]): string {
  if (!selected || selected === 'all') return 'all';
  const canonical = canonicalGrade(selected);
  if (canonical && catalog.some(c => c.grade === canonical)) return canonical;
  return 'all';
}

/** Etiqueta legible para una opción del selector: `Grado 6°1 (14 estudiantes)`. */
export function gradeOptionLabel(entry: GradeCatalogEntry, opts?: { noun?: string; short?: boolean }): string {
  const noun = opts?.noun ?? 'estudiante';
  const count = entry.students;
  if (opts?.short) return `${entry.grade} (${count})`;
  return `Grado ${entry.grade} · ${count} ${noun}${count === 1 ? '' : 's'}`;
}
