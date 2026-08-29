export type DocumentType = 'TI' | 'CC' | 'RC' | 'NES';

export type AttendanceMethod = 'usb_scanner' | 'camera_qr' | 'manual_entry' | 'batch_sync';

export type AttendanceStatus = 'punctual' | 'tardy' | 'early_departure' | 'justified';

export interface Student {
  id: string;
  documentId: string;
  documentType: DocumentType;
  firstName: string;
  lastName: string;
  grade: string;
  section: string;
  avatarUrl?: string;
  gender: 'M' | 'F' | 'O';
  birthDate?: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  secretToken: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentDocument: string;
  studentName: string;
  studentGrade: string;
  studentSection: string;
  studentAvatar?: string;
  guardianName: string;
  guardianPhone: string;
  timestamp: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  method: AttendanceMethod;
  status: AttendanceStatus;
  notes?: string;
  verifiedHmac: boolean;
  synced: boolean;
}

export interface ScanResultFeedback {
  type: 'success_punctual' | 'success_tardy' | 'already_scanned' | 'not_found' | 'invalid_signature' | 'error';
  title: string;
  message: string;
  timestamp: string;
  student?: Student;
  record?: AttendanceRecord;
}

export interface SchoolSettings {
  schoolName: string;
  schoolCode: string;
  dailyStartTime: string; // HH:mm format, e.g., "07:00"
  tardyGracePeriodMinutes: number; // e.g. 15 -> after 07:15 is tardy
  secretHmacKey: string;
  soundFeedback: boolean;
  autoFocusUsb: boolean;
  cooldownSeconds: number; // Prevent duplicate rapid scans (default 3s)
}

export interface AttendanceSummary {
  totalEnrolled: number;
  totalPresent: number;
  punctualCount: number;
  tardyCount: number;
  absentCount: number;
  attendanceRate: number; // Percentage 0-100
}
