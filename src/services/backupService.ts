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
import { ExcuseService, normalizeExcuse } from './excuseService';
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
  /** Ronda 28: 'cloud' = el contenido proviene del volcado completo del Worker (GET /api/sync/export). */
  source?: 'local' | 'cloud';
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

// ============================================================================
// Ronda 28 — RESPALDOS DESDE/PARA LA NUBE (export completo + borrado local)
// ============================================================================

/** Fila cruda de D1 (snake_case) — subconjunto relacional del estudiante. */
function normalizeCloudStudent(s: any): Student {
  const grade = String(s.grade || '');
  return {
    code: String(s.code || ''),
    documentId: String(s.document_id || s.documentId || ''),
    documentType: (s.document_type || s.documentType || 'TI') as Student['documentType'],
    firstName: String(s.first_name || s.firstName || ''),
    lastName: String(s.last_name || s.lastName || ''),
    grade,
    section: String(grade.split('°')[1] || s.section || ''),
    photoUrl: s.photo_url || s.photoUrl || undefined,
    active: String(s.status || s.active || 'ACTIVO') === 'ACTIVO',
    createdAt: String(s.created_at || s.createdAt || new Date().toISOString())
  } as Student;
}

/** Fila cruda de D1 (snake_case) — subconjunto relacional del registro de asistencia. */
function normalizeCloudRecord(r: any): AttendanceRecord {
  const date = String(r.date || '');
  const time = String(r.time || '');
  return {
    id: String(r.id || ''),
    studentCode: String(r.student_code || r.studentCode || ''),
    studentDocument: String(r.document_id || r.documentId || ''),
    studentName: String(r.student_name || r.studentName || ''),
    studentGrade: String(r.grade || ''),
    studentSection: String(String(r.grade || '').split('°')[1] || ''),
    slotId: String(r.slot_id || r.slotId || ''),
    slotName: String(r.slot_name || r.slotName || ''),
    subject: String(r.subject || ''),
    teacherName: String(r.teacher_name || r.teacherName || ''),
    timestamp: date && time ? `${date}T${time}` : String(r.timestamp || ''),
    date,
    time,
    type: 'CLASE',
    status: r.status,
    method: r.method,
    scannedBy: (r.scanned_by || r.scannedBy || 'ADMIN') as AttendanceRecord['scannedBy'],
    scannedByName: r.scanned_by_name || r.scannedByName || undefined,
    verifiedHmac: !!(r.verified_hmac ?? r.verifiedHmac),
    synced: true,
    notes: r.notes || undefined,
    excuseId: r.excuse_id || r.excuseId || undefined,
    excuseStatus: r.excuse_status || r.excuseStatus || undefined
  } as AttendanceRecord;
}

/** Fila cruda de D1 schedule_slots (snake_case) → bloque de jornada del frontend. */
function normalizeCloudSlot(s: any): ScheduleSlot {
  const startTime = String(s.start_time || s.startTime || '');
  const endTime = String(s.end_time || s.endTime || '');
  // Duración derivada de HH:MM (los slots D1 no guardan durationMinutes);
  // 0 si las horas son ilegibles — el frontend recalcula al re-guardar.
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const d0 = toMin(startTime), d1 = toMin(endTime);
  const duration = d0 !== null && d1 !== null && d1 >= d0 ? d1 - d0 : 0;
  return {
    id: String(s.id || ''),
    order: Number(s.order_index ?? s.order ?? s.orderIndex ?? 0),
    type: (s.type || 'CLASS') as ScheduleSlot['type'],
    name: String(s.name || ''),
    startTime,
    endTime,
    durationMinutes: Number(s.duration_minutes ?? s.durationMinutes ?? duration),
    isNonComputable: s.is_non_computable ?? s.isNonComputable ?? (String(s.type || '') === 'ASSEMBLY')
  } as ScheduleSlot;
}

/**
 * Ronda 28: convierte el volcado COMPLETO de la nube (GET /api/sync/export) en un
 * archivo INAS_BACKUP v1 (scope DATA, sin secretos — la nube nunca los almacena).
 * Fuente de verdad EN ORDEN: (1) snapshot KV — objetos frontend fieles que algún
 * dispositivo subió; (2) filas D1 normalizadas (fallback si la KV está vacía).
 * Las excusas SIEMPRE vienen de D1 (no viajan en el snapshot).
 */
export function buildBackupFromCloudExport(exportData: any, schoolCode: string): BackupFile {
  const kv = exportData?.kvSnapshot?.data || {};
  const pickCloud = (kvArr: any, d1Arr: any[], normalize: (row: any) => any): any[] => {
    if (Array.isArray(kvArr) && kvArr.length > 0) return kvArr;
    return (Array.isArray(d1Arr) ? d1Arr : []).map(normalize);
  };

  const students = pickCloud(kv.students, exportData?.students, normalizeCloudStudent);
  const attendance = pickCloud(kv.records, exportData?.records, normalizeCloudRecord);
  const slots = pickCloud(kv.slots, exportData?.slots, normalizeCloudSlot);
  const teachers = Array.isArray(kv.teachers) && kv.teachers.length > 0
    ? kv.teachers
    : (Array.isArray(exportData?.teachers) ? exportData.teachers : []);
  const assignments = Array.isArray(kv.assignments) && kv.assignments.length > 0
    ? kv.assignments
    : (Array.isArray(exportData?.assignments) ? exportData.assignments : []);
  const excuses = (Array.isArray(exportData?.excuses) ? exportData.excuses : []).map(normalizeExcuse);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schoolCode: schoolCode || '',
    scope: 'DATA',
    includesSecrets: false,
    source: 'cloud',
    data: {
      students,
      teachers,
      assignments,
      slots,
      attendance,
      excuses,
      customTemplates: Array.isArray(kv.customTemplates) ? kv.customTemplates : [],
      studentSchedules: kv.studentSchedules && typeof kv.studentSchedules === 'object' ? kv.studentSchedules : {}
    },
    counts: {
      students: students.length,
      teachers: teachers.length,
      assignments: assignments.length,
      slots: slots.length,
      attendance: attendance.length,
      excuses: excuses.length
    }
  };
}

/**
 * Ronda 28: respaldo VACÍO (scope DATA) para el flujo de purga — aplicado con
 * applyBackup() deja el dispositivo en blanco (patrón anti-seed Ronda 27: []
 * persistido explícito, NUNCA re-inyecta demo). No toca settings (Worker URL,
 * token y jornada se conservan) ni slots (applyBackup solo aplica si trae >0 —
 * la estructura de jornada local sobrevive al borrado).
 */
export function buildEmptyWipeBackup(schoolCode: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schoolCode: schoolCode || '',
    scope: 'DATA',
    includesSecrets: false,
    source: 'local',
    data: {
      students: [],
      teachers: [],
      assignments: [],
      slots: [],
      attendance: [],
      excuses: [],
      customTemplates: [],
      studentSchedules: {}
    },
    counts: { students: 0, teachers: 0, assignments: 0, attendance: 0, excuses: 0 }
  };
}
