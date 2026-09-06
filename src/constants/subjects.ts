/**
 * Ronda 37 — Lista institucional única de asignaturas (lista OFICIAL del propietario).
 *
 * Fuente de verdad para TODOS los selectores de materia del sistema:
 *  - Constructor de Horarios (ScheduleBuilderView → "Materia / Asignatura")
 *  - Portal Docente (TeacherClassroomView → formulario "Mis Cátedras" y selector de aula)
 *  - Gestión Docentes (TeachersManagerView → "Asignaturas que dicta", datalist de sugerencias)
 *
 * Lista entregada textualmente por el propietario (06/09/2026): 17 asignaturas.
 * Cambios Ronda 37 vs Ronda 34: fuera Emprendimiento, Ciencias Naturales y Biología
 * se funden en "Ciencias Naturales (Biología)", Ciencias Sociales → "Sociales",
 * Tecnología e Informática → "Informática", Educación Artística → "Artística",
 * Educación Religiosa → "Religión", Ética y Valores → "Ética" y se agrega
 * "Ciencias Económicas y Políticas". Nombres EXACTOS según el propietario.
 * El docente conserva libertad de escribir una asignatura propia fuera de la
 * lista donde el campo lo permite (datalist), pero las sugerencias nacen aquí.
 */
export const INSTITUTIONAL_SUBJECTS: string[] = [
  'Matemáticas',
  'Geometría',
  'Lengua Castellana',
  'Inglés',
  'Ciencias Naturales (Biología)',
  'Física',
  'Química',
  'Sociales',
  'Filosofía',
  'Ciencias Económicas y Políticas',
  'Informática',
  'Artística',
  'Educación Física',
  'Ética',
  'Religión',
  'Cátedra de la Paz',
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
