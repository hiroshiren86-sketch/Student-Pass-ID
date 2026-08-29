import { 
  Student, 
  AttendanceRecord, 
  SchoolSettings, 
  AttendanceStatus, 
  AttendanceMethod, 
  ScanResultFeedback, 
  AttendanceSummary 
} from '../types/attendance';
import { INITIAL_STUDENTS, DEFAULT_SCHOOL_SETTINGS } from './mockData';
import { parseAndVerifyScan, generateStudentQrPayload } from '../utils/crypto';

const STUDENTS_KEY = 'col_asis_students_v1';
const ATTENDANCE_KEY = 'col_asis_attendance_v1';
const SETTINGS_KEY = 'col_asis_settings_v1';

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentTimeString(): string {
  const d = new Date();
  return d.toTimeString().split(' ')[0]; // "HH:MM:SS"
}

export class AttendanceStorageService {
  private static listeners: Array<() => void> = [];

  static subscribe(callback: () => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private static notify() {
    this.listeners.forEach(cb => cb());
  }

  // ==================== SETTINGS ====================
  static getSettings(): SchoolSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_SCHOOL_SETTINGS;
  }

  static saveSettings(settings: SchoolSettings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.notify();
  }

  // ==================== STUDENTS ====================
  static getStudents(): Student[] {
    try {
      const stored = localStorage.getItem(STUDENTS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    // Initialize if empty
    this.saveStudents(INITIAL_STUDENTS);
    return INITIAL_STUDENTS;
  }

  static saveStudents(students: Student[]): void {
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    this.notify();
  }

  static getStudentByDocument(documentId: string): Student | undefined {
    const students = this.getStudents();
    const cleanDoc = documentId.trim().toLowerCase();
    return students.find(s => s.documentId.trim().toLowerCase() === cleanDoc);
  }

  static getStudentById(id: string): Student | undefined {
    const students = this.getStudents();
    return students.find(s => s.id === id);
  }

  // ==================== ATTENDANCE RECORDS ====================
  static getAllAttendance(): AttendanceRecord[] {
    try {
      const stored = localStorage.getItem(ATTENDANCE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}

    // Generate initial seeded attendance for today for demo clarity
    const initialRecords = this.generateInitialDemoAttendance();
    this.saveAttendance(initialRecords);
    return initialRecords;
  }

  static saveAttendance(records: AttendanceRecord[]): void {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
    this.notify();
  }

  static getAttendanceByDate(dateStr: string = getTodayDateString()): AttendanceRecord[] {
    const all = this.getAllAttendance();
    return all.filter(r => r.date === dateStr);
  }

  // Calculate status (punctual vs tardy) according to school start time & grace period
  static calculateStatus(currentTimeStr: string, settings: SchoolSettings): AttendanceStatus {
    const [currH, currM] = currentTimeStr.split(':').map(Number);
    const [startH, startM] = settings.dailyStartTime.split(':').map(Number);
    
    const currentTotalMin = currH * 60 + currM;
    const limitTotalMin = startH * 60 + startM + settings.tardyGracePeriodMinutes;

    return currentTotalMin <= limitTotalMin ? 'punctual' : 'tardy';
  }

  // ==================== SCAN & REGISTER CORE FLOW ====================
  static async registerScan(params: {
    scanInput: string;
    method: AttendanceMethod;
    customStatus?: AttendanceStatus;
    notes?: string;
  }): Promise<ScanResultFeedback> {
    const settings = this.getSettings();
    const parsed = await parseAndVerifyScan(params.scanInput, settings.secretHmacKey);
    const today = getTodayDateString();
    const currentTime = getCurrentTimeString();

    if (!parsed.isValidFormat || !parsed.documentId) {
      return {
        type: 'error',
        title: 'Formato no reconocido',
        message: `El código escaneado "${params.scanInput}" no contiene un número de documento válido.`,
        timestamp: new Date().toISOString()
      };
    }

    const student = this.getStudentByDocument(parsed.documentId);
    if (!student) {
      return {
        type: 'not_found',
        title: 'Estudiante no encontrado',
        message: `No existe ningún estudiante registrado con el documento: ${parsed.documentId}.`,
        timestamp: new Date().toISOString()
      };
    }

    if (student.status !== 'active') {
      return {
        type: 'error',
        title: 'Estudiante Inactivo',
        message: `El estudiante ${student.firstName} ${student.lastName} se encuentra en estado "${student.status.toUpperCase()}".`,
        timestamp: new Date().toISOString(),
        student
      };
    }

    // Check for duplicate scan on the same date
    const todayRecords = this.getAttendanceByDate(today);
    const existing = todayRecords.find(r => r.studentId === student.id || r.studentDocument === student.documentId);

    if (existing) {
      return {
        type: 'already_scanned',
        title: 'Asistencia ya registrada hoy',
        message: `${student.firstName} ${student.lastName} ya registró ingreso a las ${existing.time} (${existing.status === 'punctual' ? 'Puntual' : 'Tardanza'}).`,
        timestamp: new Date().toISOString(),
        student,
        record: existing
      };
    }

    // Determine status
    const calculatedStatus = params.customStatus || this.calculateStatus(currentTime, settings);

    const newRecord: AttendanceRecord = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      studentId: student.id,
      studentDocument: student.documentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentGrade: student.grade,
      studentSection: student.section,
      studentAvatar: student.avatarUrl,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      timestamp: new Date().toISOString(),
      date: today,
      time: currentTime,
      method: params.method,
      status: calculatedStatus,
      notes: params.notes || (parsed.isSigned ? 'Verificado vía Carné Digital HMAC' : 'Ingreso estándar'),
      verifiedHmac: parsed.isSigned,
      synced: true
    };

    const allRecords = this.getAllAttendance();
    allRecords.unshift(newRecord);
    this.saveAttendance(allRecords);

    return {
      type: calculatedStatus === 'punctual' ? 'success_punctual' : 'success_tardy',
      title: calculatedStatus === 'punctual' ? '¡Ingreso Puntual Registrado!' : '¡Ingreso con Tardanza Registrado!',
      message: `${student.firstName} ${student.lastName} (${student.grade} - Sec. ${student.section}) ha registrado su ingreso a las ${currentTime}.`,
      timestamp: newRecord.timestamp,
      student,
      record: newRecord
    };
  }

  // Delete a specific record
  static deleteRecord(recordId: string): boolean {
    const records = this.getAllAttendance();
    const filtered = records.filter(r => r.id !== recordId);
    if (filtered.length !== records.length) {
      this.saveAttendance(filtered);
      return true;
    }
    return false;
  }

  // Update status or notes of a record
  static updateRecord(recordId: string, updates: Partial<AttendanceRecord>): boolean {
    const records = this.getAllAttendance();
    const index = records.findIndex(r => r.id === recordId);
    if (index !== -1) {
      records[index] = { ...records[index], ...updates };
      this.saveAttendance(records);
      return true;
    }
    return false;
  }

  // Calculate high-performance summary stats for a given date
  static getSummary(dateStr: string = getTodayDateString()): AttendanceSummary {
    const students = this.getStudents().filter(s => s.status === 'active');
    const records = this.getAttendanceByDate(dateStr);

    const totalEnrolled = students.length;
    const totalPresent = records.length;
    const punctualCount = records.filter(r => r.status === 'punctual').length;
    const tardyCount = records.filter(r => r.status === 'tardy').length;
    const absentCount = Math.max(0, totalEnrolled - totalPresent);
    const attendanceRate = totalEnrolled > 0 ? Math.round((totalPresent / totalEnrolled) * 100) : 0;

    return {
      totalEnrolled,
      totalPresent,
      punctualCount,
      tardyCount,
      absentCount,
      attendanceRate
    };
  }

  // Export attendance to CSV file download
  static exportAttendanceCsv(dateStr: string = getTodayDateString()): void {
    const records = this.getAttendanceByDate(dateStr);
    if (records.length === 0) {
      alert('No hay registros de asistencia para exportar en esta fecha.');
      return;
    }

    const headers = [
      'ID Registro',
      'Fecha',
      'Hora',
      'Documento',
      'Nombre Estudiante',
      'Grado',
      'Sección',
      'Estado',
      'Método de Escaneo',
      'Verificación HMAC',
      'Acudiente',
      'Teléfono Acudiente',
      'Notas'
    ];

    const rows = records.map(r => [
      `"${r.id}"`,
      `"${r.date}"`,
      `"${r.time}"`,
      `"${r.studentDocument}"`,
      `"${r.studentName}"`,
      `"${r.studentGrade}"`,
      `"${r.studentSection}"`,
      `"${r.status === 'punctual' ? 'Puntual' : r.status === 'tardy' ? 'Tarde' : r.status}"`,
      `"${r.method === 'usb_scanner' ? 'Escáner USB' : r.method === 'camera_qr' ? 'Cámara QR' : 'Manual'}"`,
      `"${r.verifiedHmac ? 'Sí (Firmado)' : 'No'}"`,
      `"${r.guardianName}"`,
      `"${r.guardianPhone}"`,
      `"${r.notes || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `asistencia_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Reset database to initial state
  static resetToDemo(): void {
    localStorage.removeItem(ATTENDANCE_KEY);
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(INITIAL_STUDENTS));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SCHOOL_SETTINGS));
    this.getAllAttendance(); // Repopulate initial demo records
    this.notify();
  }

  // Helper to generate some initial demo attendance scans for today
  private static generateInitialDemoAttendance(): AttendanceRecord[] {
    const today = getTodayDateString();
    const students = INITIAL_STUDENTS.slice(0, 14); // 14 pre-scanned students
    
    return students.map((std, idx) => {
      const isLate = idx >= 10;
      const hour = isLate ? '07' : '06';
      const min = isLate ? String(20 + (idx - 10) * 4).padStart(2, '0') : String(40 + idx * 2).padStart(2, '0');
      const sec = String(10 + idx * 3).padStart(2, '0');
      const time = `${hour}:${min}:${sec}`;
      const method: AttendanceMethod = idx % 3 === 0 ? 'usb_scanner' : idx % 3 === 1 ? 'camera_qr' : 'usb_scanner';

      return {
        id: `rec-demo-${idx + 1}`,
        studentId: std.id,
        studentDocument: std.documentId,
        studentName: `${std.firstName} ${std.lastName}`,
        studentGrade: std.grade,
        studentSection: std.section,
        studentAvatar: std.avatarUrl,
        guardianName: std.guardianName,
        guardianPhone: std.guardianPhone,
        timestamp: `${today}T${time}.000Z`,
        date: today,
        time: time,
        method: method,
        status: isLate ? 'tardy' : 'punctual',
        notes: isLate ? 'Ingreso tras hora límite (07:15)' : 'Ingreso en horario normal',
        verifiedHmac: true,
        synced: true
      };
    });
  }
}
