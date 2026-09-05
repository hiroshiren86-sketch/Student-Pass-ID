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
  dayOfWeek: number; // 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes (jornada lectiva L–V; Ronda 22 elimina el sábado)
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
  // Ronda 22 (P4, Ley 1581 arts. 7 y 9): consentimiento específico del representante legal
  // para el tratamiento del soporte fotográfico de justificaciones (dato especial de salud).
  excuseDataConsent?: boolean;  // false/undefined = sin autorización (soporte solo físico)
  excuseDataConsentAt?: string; // fecha ISO del consentimiento (evidencia)
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
  // Ronda 19 — QR de Clase: transparencia de la planilla. 'QR_CLASE' = la materia/bloque
  // viene de un QR de clase firmado escaneado antes de pasar lista; 'HORA' = inferencia
  // por reloj/plantilla (comportamiento clásico). El CSV exporta una columna "Contexto".
  contextSource?: 'QR_CLASE' | 'HORA';
  classQrVerified?: boolean; // la firma del token CLASE:v1 que activó el contexto era válida
  // Ronda 21 — Excusas (spec-excusas-2026 §1.2): OVERLAY, no un 4º estado. El registro
  // conserva status='AUSENTE' y referencia la excusa que lo protege. "Falta injustificada"
  // = AUSENTE sin excuseId. excuseStatus es un SNAPSHOT para pintar la etiqueta derivada
  // ("Excusada (bajo revisión)" / "Excusada (verificada)") sin consultas extra; la verdad
  // vive en D1 (student_excuses) y se refresca por sync/post-hoc.
  excuseId?: string;
  excuseStatus?: ExcuseStatus;
  // Marcador local de CUÁNDO cambió el overlay por última vez (radicación/aprobación/
  // rechazo). Permite que el pull dirija la convergencia: si el snapshot trae un estado
  // del overlay más nuevo que el local, gana el snapshot (set O clear).
  excuseUpdatedAt?: string;
}

// ==================== Ronda 21 — Excusas Justificadas (spec-excusas-2026) ====================

export type ExcuseStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

export type ExcuseReason = 'CITA_MEDICA' | 'INCAPACIDAD' | 'CALAMIDAD' | 'DEPORTIVA' | 'OTRA';

export const EXCUSE_REASON_LABELS: Record<ExcuseReason, string> = {
  CITA_MEDICA: 'Cita médica',
  INCAPACIDAD: 'Incapacidad',
  CALAMIDAD: 'Calamidad doméstica',
  DEPORTIVA: 'Evento deportivo',
  OTRA: 'Otra'
};

/**
 * Entidad unificada (dos temporalidades, UNA entidad — spec §1):
 * - Anticipada (Escudo): start_date futura, sin vínculo a registros todavía.
 * - Post-hoc (1 toque de Rectoría): sourceAttendanceId apunta al AUSENTE justificado.
 * CamelCase (contrato API worker) — el mapeo a snake_case vive SOLO en el worker.
 */
export interface StudentExcuse {
  id: string;
  studentCode: string;
  studentName: string;
  grade: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason: ExcuseReason;
  notes?: string | null;
  status: ExcuseStatus;
  submittedBy: string;          // 'PORTAL_ESTUDIANTE' | 'RECTORIA' | ...
  sourceAttendanceId?: string | null; // post-hoc: el AUSENTE anclado (NULL si anticipada)
  attachmentPath?: string | null;
  reviewedBy?: string | null;   // usuario de Rectoría que decidió
  reviewedAt?: string | null;
  rejectReason?: string | null; // obligatorio si status=RECHAZADA (R6)
  autoApproved?: number;        // 1 = la ventana 72 h la aprobó (R8, auditable)
  auditHash?: string | null;    // eslabón HMAC tamper-evidente (§6.2)
  createdAt?: string;
}

export interface UserSession {
  username: string;
  role: UserRole;
  token: string;
  // Ronda 30 (H-30-1): instante (epoch ms) del login REAL que creó la sesión.
  // Las sesiones sin authAt (era pre-hardening, Rectoría implícita) NO son
  // restaurables al recargar: solo un login explícito abre la app.
  authAt?: number;
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
  // Ronda 19: 'no_active_slot' — escaneo durante recreo/transición (BUG-1 del informe de testing:
  // antes caía al fallback 'slot-1' y se registraba TARDANZA en 1ª Hora). No registra nada.
  // Ronda 19: 'class_activated' — un QR de Clase (CLASE:v1) firmado activó el contexto del dispositivo.
  type: 'success_punctual' | 'success_tardy' | 'already_scanned' | 'not_found' | 'invalid_signature' | 'rate_limited' | 'error' | 'block_closed' | 'pending_review' | 'non_computable' | 'out_of_window' | 'no_active_slot' | 'class_activated';
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
  // Ronda 21 (spec §7.4): ausencias protegidas por excusa no rechazada. La vista del
  // estudiante las muestra como "Excusada" y NO entran al % de faltas injustificadas.
  justificados: number;
  absentUnjustified: number;
  attendancePercentage: number; // (attendedCount / totalClasses) * 100
  punctualityRate: number; // (punctualCount / attendedCount) * 100
  bySubject: SubjectAttendanceSummary[];
}

export interface AttendanceSummary {
  totalEnrolled: number;
  totalClassesToday: number;
  // Ronda 19 (BUG-2 del informe): cuenta ESTUDIANTES ÚNICOS (Set por studentCode), no registros;
  // con múltiples bloques el conteo por registros podía superar la matrícula (53 "presentes" con 50).
  totalPresent: number;
  punctualCount: number;
  tardyCount: number;
  absentCount: number;
  // Ronda 19 (BUG-2 del informe): null cuando la fecha no tiene registros — antes mostraba un 95%
  // hardcodeado, dato contradictorio en una revisión (día sin escaneos = "95% de asistencia").
  attendanceRate: number | null; // 0 - 100, o null si no hay registros en la fecha
  // Ronda 21 — Excusas (spec §4.3): 4º número del resumen. Ausencias AUSENTE con excusa
  // NO rechazada (protegidas). No toca presentes/ausentes: la excusa no altera el conteo
  // hasta que es RECHAZADA (y entonces el overlay se desvincula, no cambia el estado).
  justificados: number;
}

/**
 * Ronda 19 — QR de Clase: contexto de "clase activa" del dispositivo.
 * Nace cuando el representante/docente escanea un token `CLASE:v1:...` firmado (o lo activa
 * desde el aula) y muere al expirar el bloque o al cancelarlo. Es POR DISPOSITIVO (el que
 * escanea el QR de la pizarra es quien va a pasar lista) — no viaja por la nube.
 */
export interface ActiveClassContext {
  grade: string;           // '10°1'
  dayOfWeek: number;       // 1 = Lunes ... 5 = Viernes (jornada L–V; Ronda 22)
  slotId: string;          // 'slot-4'
  slotName: string;        // '4ª Hora de Clase'
  slotStartTime: string;   // '09:45'
  slotEndTime: string;     // '10:40'
  subject: string;         // Resuelto de la asignación vigente al momento de activar
  teacherName: string;
  classroom?: string;
  activatedAt: string;     // ISO
  expiresAt: number;       // epoch ms = fin del bloque del día de activación
  activatedBy: string;     // 'QR_CLASE' | 'AULA_DOCENTE'
  tokenSignature: string;  // firma HMAC (trazabilidad)
}

/**
 * Ronda 19 — Importación masiva de horarios (informe, roadmap #3): elimina los ~360
 * clics de rectoría. Una fila del CSV = una cátedra (grado + día + bloque).
 */
export interface ParsedScheduleRow {
  lineNo: number;          // número de línea en el archivo (trazabilidad de errores)
  dayOfWeek: number;       // 1 = Lunes ... 5 = Viernes (jornada L–V; Ronda 22)
  grade: string;           // normalizado al formato del sistema ('10°1')
  slotId: string;
  subject: string;
  teacherId?: string;      // si el nombre coincidió con un docente registrado
  teacherName?: string;
  classroom?: string;
}

export interface ScheduleImportResult {
  rows: ParsedScheduleRow[];
  errors: string[];        // "Línea 3: ..." — estilo de la validación del horario personal
  totalLines: number;
  detectedHeader: boolean;
  delimiter: string;       // ',' | ';' | '\t' (sniff automático)
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

// ==================== Ronda 4 (F4): Horario opcional del estudiante ====================
// Informativo: NO interfiere con la asistencia (el escaneo registra fecha y hora).
// Se deshabilita globalmente con settings.templatesOnlyMode = true (interruptor de Rectoría).
export interface StudentPersonalScheduleEntry {
  dayOfWeek: number; // 1 = Lunes … 5 = Viernes (jornada L–V; Ronda 22)
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
