export type DocumentType = 'TI' | 'CC' | 'RC' | 'CE' | 'PPT' | 'PEP' | 'NES';

export type AttendanceMethod = 'USB' | 'CAMERA' | 'MANUAL' | 'SYNC';

export type AttendanceType = 'ENTRADA' | 'SALIDA';

export type AttendanceStatus = 'PUNTUAL' | 'TARDANZA' | 'JUSTIFICADO';

export type UserRole = 'ADMIN' | 'DOCENTE' | 'PORTERO' | 'ESTUDIANTE_ACUDIENTE';

export interface Teacher {
  id: string;
  documentId: string;
  fullName: string;
  email: string;
  phone?: string;
  subjects: string[]; // Asignaturas que dicta
  assignedGrades: string[]; // Cursos asignados (ej: ["10°1", "10°2", "11°1"])
  username: string; // Usuario de acceso
  passwordHash?: string; // Contraseña / hash
  tempPassword?: string; // Contraseña actual visible/reemplazable por admin
  active: boolean;
  createdAt: string;
}

export type ScheduleSlotType = 'CLASS' | 'BREAK' | 'TRANSITION' | 'LUNCH';

export interface ScheduleSlot {
  id: string;
  order: number; // 1, 2, 3...
  type: ScheduleSlotType;
  name: string; // "1ª Hora", "Descanso / Recreo", "Cambio de Salón", "Almuerzo"
  startTime: string; // "07:00"
  endTime: string; // "07:45"
  durationMinutes: number; // 45
  color?: string;
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

export interface ClassroomAttendanceRecord {
  id: string;
  date: string;
  grade: string;
  subject: string;
  teacherName: string;
  period: string; // ej: "1ª Hora (07:00 - 08:00)"
  verifiedAt: string;
  totalStudents: number;
  presentInRoom: number;
  missingFromGate: number; // No cruzaron portería
  alertGateWithoutRoom: number; // Cruzaron portería pero no están en el salón
  studentDetails: {
    studentCode: string;
    studentName: string;
    gateStatus: 'PUNTUAL' | 'TARDANZA' | 'NO_INGRESO';
    gateTime?: string;
    inRoom: boolean;
    observations?: string;
  }[];
}

export interface Student {
  code: string;           // Código único operativo (ej: "1000000001")
  documentId: string;     // Identificación única (ej: "1000000001")
  documentType?: DocumentType; // Tipo de documento oficial SIMAT (TI, CC, RC, CE, PPT, etc.)
  firstName: string;      // Nombres
  lastName: string;       // Apellidos
  grade: string;          // Grado (ej: "6°5", "10°4", "11°2")
  section: string;        // Sección (ej: "1", "2", "A")
  photoUrl?: string;      // Fotografía opcional tamaño carné (Base64 / DataUrl)
  active: boolean;        // Estado activo
  createdAt: string;      // Fecha ISO
  tempPassword?: string;  // Contraseña temporal aleatoria para portal
  hasCustomPassword?: boolean; // Indica si el estudiante ya personalizó su contraseña
}

export interface AttendanceRecord {
  id: string;
  studentCode: string;
  studentDocument: string;
  studentName: string;
  studentGrade: string;
  studentSection: string;
  timestamp: string;      // ISO String
  date: string;           // YYYY-MM-DD en America/Bogota
  time: string;           // HH:mm:ss
  type: AttendanceType;   // ENTRADA o SALIDA
  status: AttendanceStatus;
  method: AttendanceMethod;
  verifiedHmac: boolean;
  synced: boolean;
  notes?: string;
}

export interface UserSession {
  username: string;
  role: UserRole;
  token: string;
  studentCode?: string; // Si el rol es ESTUDIANTE_ACUDIENTE
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
  type: 'success_punctual' | 'success_tardy' | 'success_exit' | 'already_scanned' | 'not_found' | 'invalid_signature' | 'rate_limited' | 'error';
  title: string;
  message: string;
  timestamp: string;
  student?: Student;
  record?: AttendanceRecord;
}

export interface SchoolSettings {
  schoolName: string;
  schoolCode: string;
  dailyStartTime: string; // "07:00"
  dailyEndTime: string;   // "13:30"
  tardyGracePeriodMinutes: number; // e.g. 15
  qrSecret: string;
  sessionSecret: string;
  soundFeedback: boolean;
  autoFocusUsb: boolean;
  rateLimitMaxPerMin: number;
}

export interface AttendanceSummary {
  totalEnrolled: number;
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
  type: AttendanceType;
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
}

