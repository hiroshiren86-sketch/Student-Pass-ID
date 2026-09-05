/**
 * ==============================================================================
 * SERVICIO DE RESPALDO LOCAL (Ronda 27, doc-produccion §3) — lógica pura, testeable.
 *
 * Formato UN archivo .json versionado:
 *   { format: "INAS_BACKUP", version: 1, exportedAt, schoolCode, scope: CONFIG|DATA|BOTH,
 *     includesSecrets, config?: { settings }, data?: { students, teachers, assignments,
 *     slots, attendance, excuses, customTemplates, studentSchedules }, counts }
 *
 * Reglas (pedido del propietario + QA):
 *  - Scope CONFIG | DATA | BOTH (import parsiela: CONFIG no toca datos, DATA no toca secretos).
 *  - Secretos (qrSecret, token Worker) SOLO con casilla explícita (includesSecrets).
 *  - Import: respaldo automático previo (ambas + secretos) → hidratación → push a la nube.
 *  - VAPID nunca se exporta (pública por diseño, vive en el Worker).
 * ==============================================================================
 */
import { AttendanceStorageService } from './attendanceStorage';
import { ExcuseService } from './excuseService';
import type { SchoolSettings, Student, Teacher, AttendanceRecord, ClassScheduleAssignment, ScheduleSlot, StudentExcuse } from '../types/attendance';

export const BACKUP_FORMAT = 'INAS_BACKUP';
export const BACKUP_VERSION = 1;

export type BackupScope = 'CONFIG' | 'DATA' | 'BOTH';

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  schoolCode: string;
  scope: BackupScope;
  includesSecrets: boolean;
  config?: { settings: SchoolSettings };
  data?: {
    students: Student[];
    teachers: Teacher[];
    assignments: ClassScheduleAssignment[];
    slots: ScheduleSlot[];
    attendance: AttendanceRecord[];
    excuses: StudentExcuse[];
    customTemplates: any[];
    studentSchedules: Record<string, any>;
  };
  counts: Record<string, number>;
}

const SECRET_FIELDS = ['qrSecret', 'cloudflareApiToken', 'sessionSecret'] as const;

/** Serializa el snapshot local actual al formato INAS_BACKUP. */
export function buildBackup(scope: BackupScope, includeSecrets: boolean): BackupFile {
  const settings = AttendanceStorageService.getSettings();
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schoolCode: settings.schoolCode || '',
    scope,
    includesSecrets: includeSecrets,
    counts: {}
  };

  if (scope === 'CONFIG' || scope === 'BOTH') {
    const copy = { ...settings } as any;
    if (!includeSecrets) {
      SECRET_FIELDS.forEach(f => { delete copy[f]; });
    }
    file.config = { settings: copy };
    file.counts['config'] = 1;
  }
  if (scope === 'DATA' || scope === 'BOTH') {
    const students = AttendanceStorageService.getStudents();
    const attendance = AttendanceStorageService.getAllAttendance();
    const excuses = ExcuseService.getCachedExcuses();
    file.data = {
      students,
      teachers: AttendanceStorageService.getTeachers(),
      assignments: AttendanceStorageService.getScheduleAssignments(),
      slots: AttendanceStorageService.getScheduleSlots(),
      attendance,
      excuses,
      customTemplates: AttendanceStorageService.getCustomTemplates(),
      studentSchedules: AttendanceStorageService.getAllStudentSchedules()
    };
    file.counts = {
      ...file.counts,
      students: students.length,
      teachers: file.data.teachers.length,
      assignments: file.data.assignments.length,
      attendance: attendance.length,
      excuses: excuses.length
    };
  }
  return file;
}

/** Valida un archivo de respaldo externo (parse aparte). Devuelve error legible o null. */
export function validateBackup(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return 'Archivo vacío o no JSON.';
  if (parsed.format !== BACKUP_FORMAT) return 'Formato no reconocido (no es un respaldo de I.N.A.S).';
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) return 'Versión de respaldo no soportada por esta app.';
  if (!['CONFIG', 'DATA', 'BOTH'].includes(parsed.scope)) return 'Alcance (scope) inválido.';
  return null;
}

/** Descarga el respaldo como archivo JSON (usado por export y por el auto-backup del import). */
export function downloadBackup(file: BackupFile, label: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `INAS_respaldo_${label}_${file.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Hidrata el localStorage con el contenido del respaldo (sin push ni recarga — eso
 * lo hace la UI). Respeta el scope: CONFIG no toca datos; DATA no toca settings/secretos.
 * Devuelve resumen de lo aplicado.
 */
export function applyBackup(file: BackupFile): { applied: string[] } {
  const applied: string[] = [];

  if ((file.scope === 'CONFIG' || file.scope === 'BOTH') && file.config?.settings) {
    AttendanceStorageService.saveSettings(file.config.settings as SchoolSettings);
    applied.push('configuración');
  }
  if ((file.scope === 'DATA' || file.scope === 'BOTH') && file.data) {
    AttendanceStorageService.saveStudents(file.data.students || []);
    AttendanceStorageService.saveTeachers(file.data.teachers || []);
    AttendanceStorageService.saveScheduleAssignments(file.data.assignments || []);
    // Los slots son estructura de jornada: solo se aplican si el respaldo los trae
    // (un DATA sin slots no debe dejar la jornada vacía por accidente).
    if (Array.isArray(file.data.slots) && file.data.slots.length > 0) {
      AttendanceStorageService.saveScheduleSlots(file.data.slots);
    }
    AttendanceStorageService.saveAttendance(file.data.attendance || []);
    if (file.data.customTemplates) AttendanceStorageService.saveCustomTemplates(file.data.customTemplates);
    if (file.data.studentSchedules) AttendanceStorageService.saveAllStudentSchedules(file.data.studentSchedules);
    // Cache de excusas (vista local del estado de D1 — best-effort por diseño).
    try {
      localStorage.setItem('inas_excuses_cache_v1', JSON.stringify(file.data.excuses || []));
    } catch {}
    applied.push('base de datos');
  }
  return { applied };
}
