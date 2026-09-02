export type DocumentType = 'TI' | 'CC' | 'RC' | 'CE' | 'PPT' | 'PEP' | 'NES';

export type AttendanceMethod = 'USB' | 'CAMERA' | 'MANUAL' | 'SYNC' | 'AUTO_CIERRE';

export type AttendanceType = 'CLASE';

export type AttendanceStatus = 'PUNTUAL' | 'TARDANZA' | 'AUSENTE' | 'JUSTIFICADO';

export type UserRole = 'ADMIN' | 'DOCENTE' | 'ESTUDIANTE_ACUDIENTE';

export type ScannedByRole = 
  | 'DOCENTE' 
  | 'REPRESENTANTE_TITULAR' 
  | 'REPRESENTANTE_SUPLENTE' 
  | 'DELEGADO_EFIMERO' 
  | 'REPRESENTANTE' // backwards compatible
  | 'ADMIN' 
  | 'AUTO_CIERRE';

export type DayTemplateType = 
  | 'NORMAL' 
  | 'RECORTE_10' 
  | 'IZADA_BANDERA' 
  | 'ASESORIA_GRUPO' 
  | 'DIA_ESPECIAL' 
  | 'CUSTOM';

export type DayTemplateId = DayTemplateType;

export type SchoolShiftType = 'MANANA' | 'TARDE' | 'UNICA';

export interface DayTemplateConfig {
  id: string;
  type: DayTemplateType;
  name: string;
  badge: string;
  description: string;
  shift: SchoolShiftType;
  baseStartTime: string; // e.g. "06:30"
  blockDurationMinutes: number; // e.g. 55 or 45
  trimMinutesPerBlock: number; // 0, 5, 10, 15, custom
  recessDurationMinutes: number; // 30
  totalBlocks: number; // 6
  isNonComputableAllDay?: boolean; // Día Especial (sin ausencias)
  firstBlockSpecial?: 'ACTO_CIVICO' | 'ASESORIA_GRUPO' | 'NORMAL';
  proportionalNoticeMinutes?: number; // T-11 en 55m, T-7 en 35m
  // Ronda 4 (F1/F3): ventana de JORNADA definida por la plantilla. Si se omiten,
  // se derivan de baseStartTime y del fin del último slot generado.
  dayStartTime?: string; // e.g. "07:00" — antes de esta hora la jornada está cerrada
  dayEndTime?: string;   // e.g. "14:00" — después de esta hora la jornada se cierra (no se escanea)
}

export interface EphemeralScanDelegation {
  id: string;
  token: string;
  teacherId: string;
  teacherName: string;
  studentCode: string;
  studentName: string;
  grade: string;
  slotId: string;
  date: string;
  createdAt: string;
  expiresAt: string; // HH:mm o ISO
}

export interface DayScheduleState {
  activeTemplate: DayTemplateType;
  appliedDate: string;
  trimMinutes: number;
  shift: SchoolShiftType;
  nonComputableSlots: string[]; // Slot IDs marcados como Hora Libre / No Computable
  pendingReviewSlots: string[]; // Slot IDs marcados como < 30% escaneados
  isInstitutionalWeek?: boolean;
}

export interface Teacher {
  id: string;
  documentId: string;
  fullName: string;
  email: string;
  phone?: string;
  subjects: string[]; // Asignaturas que dicta
  assignedGrades: string[]; // Cursos asignados (ej: ["10°1", "10°2", "11°1"])
  username: string; // Usuario de acceso
  password?: string; // Contraseña en texto plano para demo/reset
  passwordHash?: string; // Contraseña / hash
  tempPassword?: string; // Contraseña actual visible/reemplazable por admin
  active: boolean;
  createdAt: string;
  isGroupDirector?: boolean; // Subrol: Director de Grupo
  directorGrade?: string; // Grado del que es director (ej: "6°1")
}

export type ScheduleSlotType = 'CLASS' | 'BREAK' | 'TRANSITION' | 'LUNCH' | 'CIVIC' | 'ADVISORY';

export interface ScheduleSlot {
  id: string;
  order: number; // 1, 2, 3...
  type: ScheduleSlotType;
  name: string; // "1ª Hora", "Descanso / Recreo", "Cambio de Salón", "Almuerzo"
  startTime: string; // "06:30"
  endTime: string; // "07:25"
  durationMinutes: number; // 55
  noticeMinutesBeforeEnd?: number; // 11
  color?: string;
  isNonComputable?: boolean;
  isSpecialAdvisory?: boolean;
}

export interface ClassScheduleAssignment {
  id: string;
  dayOfWeek: number; // 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes, 6 = Sábado
  slotId: string; // Referencia al ScheduleSlot
  grade: string; // "10°1"
  subject: string; // "Matemáticas"
  teacherId?: string; // ID del docente asignado
  teacherName?: string; // "Juan Pablo Pérez"
  classroom?: string; // "Aula 204", "Laboratorio", etc.
  isDoubleBlock?: boolean; // Indica si es parte de un bloque de 2 horas seguidas
  doubleBlockLinkedSlotId?: string; // ID del slot complementario (1ra o 2da hora)
  doubleBlockRole?: 'FIRST_HOUR' | 'SECOND_HOUR'; // 1ª o 2ª hora del bloque
}

export interface SchoolScheduleConfig {
  id: string;
  name: string; // "Jornada Mañana Ordinaria"
  startTime: string; // "07:00"
  slots: ScheduleSlot[];
  assignments: ClassScheduleAssignment[]; // Asignaciones por curso/día/hora
}

export interface Student {
  code: string;           // Código único operativo (ej: "1000000001")
  documentId: string;     // Identificación única (ej: "1000000001")
  documentType?: DocumentType; // Tipo de documento oficial SIMAT (TI, CC, RC, CE, PPT, etc.)
  firstName: string;      // Nombres
  lastName: string;       // Apellidos
  grade: string;          // Grado (ej: "6°1", "10°4", "11°2")
  section: string;        // Sección (ej: "1", "2", "A")
  photoUrl?: string;      // Fotografía opcional tamaño carné (Base64 / DataUrl)
  active: boolean;        // Estado activo
  createdAt: string;      // Fecha ISO
  tempPassword?: string;  // Contraseña inicial
  hasCustomPassword?: boolean; // Indica si el estudiante ya personalizó su contraseña
  isRepresentative?: boolean; // Subrol: Representante Titular
  isSubstituteRepresentative?: boolean; // Subrol: Representante Suplente
  representativeGrade?: string; // Grado que representa (ej: "6°1")
}

export interface AttendanceRecord {
  id: string;
  studentCode: string;
  studentDocument: string;
  studentName: string;
  studentGrade: string;
  studentSection: string;
  slotId: string;         // ID del bloque de clase (ej: "slot-1")
  slotName: string;       // Nombre del bloque (ej: "1ª Hora")
  slotStartTime?: string; // "07:00"
  slotEndTime?: string;   // "07:45"
  subject: string;        // Asignatura (ej: "Matemáticas")
  teacherId?: string;     // ID del docente
  teacherName: string;    // Nombre del docente a cargo
  timestamp: string;      // ISO String
  date: string;           // YYYY-MM-DD en America/Bogota
  time: string;           // HH:mm:ss
  type: AttendanceType;   // 'CLASE'
  status: AttendanceStatus; // 'PUNTUAL' | 'TARDANZA' | 'AUSENTE' | 'JUSTIFICADO'
  method: AttendanceMethod; // 'USB' | 'CAMERA' | 'MANUAL' | 'SYNC' | 'AUTO_CIERRE'
  scannedBy: ScannedByRole; // 'DOCENTE' | 'REPRESENTANTE' | 'ADMIN' | 'AUTO_CIERRE'
  scannedByName?: string;
  scannedByCode?: string;
  verifiedHmac: boolean;
  synced: boolean;
  notes?: string;
}

export interface UserSession {
  username: string;
  role: UserRole;
  token: string;
  studentCode?: string; // Si el rol es ESTUDIANTE_ACUDIENTE
  teacherId?: string;   // Si el rol es DOCENTE
  isRepresentative?: boolean;
  isSubstituteRepresentative?: boolean;
  representativeGrade?: string;
  isGroupDirector?: boolean;
  directorGrade?: string;
  fullName?: string;
  ephemeralDelegation?: EphemeralScanDelegation;
}

export interface QRPayload {
  code: string;
  documentId: string;
  name: string;
  grade: string;
  section: string;
  schoolCode: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface ScanResultFeedback {
  type: 'success_punctual' | 'success_tardy' | 'already_scanned' | 'not_found' | 'invalid_signature' | 'rate_limited' | 'error' | 'block_closed' | 'pending_review' | 'non_computable' | 'out_of_window';
  title: string;
  message: string;
  timestamp: string;
  student?: Student;
  record?: AttendanceRecord;
}

export interface SchoolSettings {
  schoolName: string;
  schoolCode: string;
  dailyStartTime: string; // "06:30"
  dailyEndTime: string;   // "12:30"
  shiftType: SchoolShiftType; // 'MANANA' | 'TARDE' | 'UNICA'
  activeDayTemplate: string; // ID de plantilla ('tmpl-normal'…, 'tmpl-custom-…'). Compat: también acepta el TYPE legado ('NORMAL'); se normaliza al resolver (Ronda 4 F1)
  templatesOnlyMode?: boolean; // Ronda 4 (F2): interruptor maestro de Rectoría — ON = solo plantillas oficiales; deshabilita horarios personales para TODAS las cuentas
  trimMinutes: number; // 0, 5, 10, 15, custom
  tardyGracePeriodMinutes: number; // e.g. 10 minutos
  qrSecret: string;
  sessionSecret: string;
  soundFeedback: boolean;
  autoFocusUsb: boolean;
  rateLimitMaxPerMin: number;
  aiProvider: 'groq' | 'mistral' | 'openrouter' | 'gemini' | 'openai' | 'local';
  aiModel?: string; // Modelo de texto/analítica seleccionado
  aiVisionModel?: string; // Modelo de visión seleccionado
  aiTemperature?: number;
  customAiApiKey?: string;
  aiFallbackOfflineMode?: boolean;
  groqApiKey?: string;
  mistralApiKey?: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  aiPrivacyOptOut: boolean; // Cumplimiento de no almacenamiento de datos de estudiantes
  // Ronda 16: cloudflareAccountId/cloudflareD1DatabaseId ELIMINADOS del modelo —
  // el navegador no habla con la API de Cloudflare; D1/KV son exclusivos del Worker
  // (su configuración vive en cloudflare-worker/wrangler.toml).
  cloudflareApiToken?: string; // AUTH_TOKEN opcional del Worker (Bearer)
  cloudflareKvNamespaceId?: string;
  cloudflareWorkerUrl?: string;
  cloudflareAutoSync?: boolean;
  cloudflareSyncIntervalMinutes?: number;
  lastCloudflareSync?: string;
}

export interface SubjectAttendanceSummary {
  subject: string;
  teacherName: string;
  totalClasses: number;
  punctualCount: number;
  tardyCount: number;
  absentCount: number;
  attendanceRate: number; // Porcentaje 0 - 100
}

export interface StudentAttendanceStats {
  studentCode: string;
  studentName: string;
  grade: string;
  totalClasses: number;
  attendedCount: number;
  punctualCount: number;
  tardyCount: number;
  absentCount: number;
  attendancePercentage: number; // (attendedCount / totalClasses) * 100
  punctualityRate: number; // (punctualCount / attendedCount) * 100
  bySubject: SubjectAttendanceSummary[];
}

export interface AttendanceSummary {
  totalEnrolled: number;
  totalClassesToday: number;
  totalPresent: number;
  punctualCount: number;
  tardyCount: number;
  absentCount: number;
  attendanceRate: number; // 0 - 100
}

export interface OfflineQueueItem {
  id: string;
  studentCode: string;
  timestamp: string;
  slotId: string;
  subject: string;
  method: AttendanceMethod;
  retryCount: number;
}

export interface FrequentAbsentee {
  name: string;
  code: string;
  absencesCount: number;
  reasonPattern: string;
}

export interface GradeChartPoint {
  label: string;
  puntuales: number;
  tardanzas: number;
  ausencias: number;
}

export interface GradeAiSummaryResult {
  success?: boolean;
  error?: string;
  summary: string;
  keyMetrics: {
    totalStudents: number;
    overallAttendanceRate: number;
    totalAbsences: number;
    totalTardiness: number;
  };
  frequentAbsentees: FrequentAbsentee[];
  insights: string[];
  chartData: GradeChartPoint[];
  isSimulated?: boolean;
  simulatedReason?: string;
  provider?: string;
  model?: string;
}

export interface ScheduleImportResult {
  success: boolean;
  totalRowsProcessed: number;
  importedAssignmentsCount: number;
  conflictsCount: number;
  ignoredRowsCount: number;
  conflicts: Array<{ row: number; reason: string; detail: string }>;
  ignoredRows: Array<{ row: number; line: string; reason: string }>;
}


// ==================== Ronda 4 (F4): Horario opcional del estudiante ====================
// Informativo: NO interfiere con la asistencia (el escaneo registra fecha y hora).
// Se deshabilita globalmente con settings.templatesOnlyMode = true (interruptor de Rectoría).
export interface StudentPersonalScheduleEntry {
  dayOfWeek: number; // 1 = Lunes … 6 = Sábado
  subject: string;
  startTime: string; // "07:00"
  endTime: string;   // "07:55"
  slotId?: string;   // opcional: si el estudiante alineó su entrada con un bloque oficial
}

export interface StudentPersonalSchedule {
  studentCode: string;
  entries: StudentPersonalScheduleEntry[];
  updatedAt: string; // ISO
}
