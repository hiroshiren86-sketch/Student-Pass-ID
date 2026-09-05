/**
 * Ronda 34 — Lista institucional única de asignaturas.
 *
 * Fuente de verdad para TODOS los selectores de materia del sistema:
 *  - Constructor de Horarios (ScheduleBuilderView → "Materia / Asignatura")
 *  - Portal Docente (TeacherClassroomView → formulario "Mis Cátedras" y selector de aula)
 *  - Gestión Docentes (TeachersManagerView → "Asignaturas que dicta", datalist de sugerencias)
 *
 * Nomenclatura alineada con el Plan de Estudios colombiano (Ley 115 de 1994,
 * Decreto 1075 de 2015 y Ley 1732 de 2014 — Cátedra de la Paz). El docente
 * conserva libertad de escribir una asignatura propia fuera de la lista donde
 * el campo lo permite (datalist), pero las sugerencias oficiales nacen aquí.
 */
export const INSTITUTIONAL_SUBJECTS: string[] = [
  'Matemáticas',
  'Física',
  'Química',
  'Biología',
  'Ciencias Naturales',
  'Ciencias Sociales',
  'Lengua Castellana',
  'Inglés',
  'Tecnología e Informática',
  'Educación Física',
  'Educación Artística',
  'Educación Religiosa',
  'Cátedra de la Paz',
  'Geometría',
  'Filosofía',
  'Ética y Valores',
  'Emprendimiento',
  'Dirección de Grupo',
];

/** Normaliza nombres de asignatura para búsquedas/comparaciones insensibles a mayúsculas y tildes. */
export function normalizeSubjectName(s: string): string {
  return (s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
