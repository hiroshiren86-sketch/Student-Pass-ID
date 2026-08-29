import { 
  Student, 
  AttendanceRecord, 
  SchoolSettings, 
  AttendanceStatus, 
  AttendanceType, 
  AttendanceMethod, 
  ScanResultFeedback, 
  AttendanceSummary,
  OfflineQueueItem,
  Teacher,
  ScheduleSlot,
  ClassScheduleAssignment,
  SchoolScheduleConfig
} from '../types/attendance';
import { 
  INITIAL_STUDENTS, 
  DEFAULT_SCHOOL_SETTINGS, 
  SCHOOL_GRADES_LIST,
  INITIAL_TEACHERS,
  DEFAULT_SCHEDULE_SLOTS,
  INITIAL_SCHEDULE_ASSIGNMENTS
} from './mockData';
import { parseAndVerifyScan } from '../utils/crypto';

const STUDENTS_KEY = 'iedsj_students_v4';
const ATTENDANCE_KEY = 'iedsj_attendance_v4';
const SETTINGS_KEY = 'iedsj_settings_v4';
const OFFLINE_QUEUE_KEY = 'iedsj_offline_queue_v4';
const TEACHERS_KEY = 'iedsj_teachers_v4';
const SCHEDULE_SLOTS_KEY = 'iedsj_schedule_slots_v4';
const SCHEDULE_ASSIGNMENTS_KEY = 'iedsj_schedule_assignments_v4';

export function getTodayDateString(): string {
  const d = new Date();
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // YYYY-MM-DD
  return formatter.format(d);
}

export function getCurrentTimeString(): string {
  const d = new Date();
  const options: Intl.DateTimeFormatOptions = { 
    timeZone: 'America/Bogota', 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  };
  const formatter = new Intl.DateTimeFormat('es-CO', options);
  return formatter.format(d);
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
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.schoolName && !parsed.schoolName.includes('San Jerónimo')) {
          return parsed;
        } else if (parsed && parsed.schoolName && parsed.schoolName.includes('San Jerónimo')) {
          // Actualizar al nuevo nombre institucional por defecto si tenía el antiguo
          const updated = { ...parsed, schoolName: DEFAULT_SCHOOL_SETTINGS.schoolName, schoolCode: DEFAULT_SCHOOL_SETTINGS.schoolCode };
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
          return updated;
        }
      }
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
    this.saveStudents(INITIAL_STUDENTS);
    return INITIAL_STUDENTS;
  }

  static saveStudents(students: Student[]): void {
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    this.notify();
  }

  static getUniqueGrades(): string[] {
    const students = this.getStudents();
    const set = new Set<string>();
    SCHOOL_GRADES_LIST.forEach(g => set.add(g));
    students.forEach(s => {
      if (s.grade) set.add(s.grade);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  static getStudentsByGrade(grade: string): Student[] {
    const students = this.getStudents();
    if (grade === 'all') return students;
    return students.filter(s => s.grade === grade);
  }

  static getStudentByCodeOrDoc(identifier: string): Student | undefined {
    const students = this.getStudents();
    const rawClean = identifier.trim().toLowerCase();
    const normalizedDigits = identifier.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    return students.find(s => {
      const sCode = s.code.toLowerCase();
      const sDoc = s.documentId.toLowerCase();
      const sCodeClean = s.code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const sDocClean = s.documentId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      return (
        sCode === rawClean || 
        sDoc === rawClean || 
        (normalizedDigits.length >= 3 && (sCodeClean === normalizedDigits || sDocClean === normalizedDigits))
      );
    });
  }

  static addStudent(student: Student): { success: boolean; error?: string } {
    const students = this.getStudents();
    if (students.some(s => s.code === student.code || s.documentId === student.documentId)) {
      return { success: false, error: 'Ya existe un estudiante con ese código o documento (Error 409)' };
    }
    students.push(student);
    this.saveStudents(students);
    return { success: true };
  }

  static updateStudent(code: string, updates: Partial<Student>): boolean {
    const students = this.getStudents();
    const idx = students.findIndex(s => s.code === code);
    if (idx === -1) return false;
    students[idx] = { ...students[idx], ...updates };
    this.saveStudents(students);
    return true;
  }

  static deleteStudent(code: string): boolean {
    const students = this.getStudents();
    const filtered = students.filter(s => s.code !== code);
    if (filtered.length !== students.length) {
      this.saveStudents(filtered);
      return true;
    }
    return false;
  }

  // ==================== TEACHERS (DOCENTES) ====================
  static getTeachers(): Teacher[] {
    try {
      const stored = localStorage.getItem(TEACHERS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    this.saveTeachers(INITIAL_TEACHERS);
    return INITIAL_TEACHERS;
  }

  static saveTeachers(teachers: Teacher[]): void {
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(teachers));
    this.notify();
  }

  static getTeacherById(id: string): Teacher | undefined {
    return this.getTeachers().find(t => t.id === id);
  }

  static getTeacherByUsername(username: string): Teacher | undefined {
    const clean = username.trim().toLowerCase();
    return this.getTeachers().find(t => t.username.toLowerCase() === clean || t.documentId === clean || t.email.toLowerCase() === clean);
  }

  static addTeacher(teacher: Teacher): { success: boolean; error?: string } {
    const teachers = this.getTeachers();
    if (teachers.some(t => t.id === teacher.id || t.documentId === teacher.documentId || t.username.toLowerCase() === teacher.username.toLowerCase())) {
      return { success: false, error: 'Ya existe un docente con ese documento o usuario (Conflicto 409)' };
    }
    teachers.push(teacher);
    this.saveTeachers(teachers);
    return { success: true };
  }

  static updateTeacher(id: string, updates: Partial<Teacher>): boolean {
    const teachers = this.getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx === -1) return false;
    teachers[idx] = { ...teachers[idx], ...updates };
    this.saveTeachers(teachers);
    return true;
  }

  static resetTeacherPassword(id: string, newPassword?: string): { success: boolean; newPassword?: string } {
    const teachers = this.getTeachers();
    const idx = teachers.findIndex(t => t.id === id);
    if (idx === -1) return { success: false };
    const generated = newPassword || `Docente${Math.floor(1000 + Math.random() * 9000)}*`;
    teachers[idx].tempPassword = generated;
    this.saveTeachers(teachers);
    return { success: true, newPassword: generated };
  }

  static deleteTeacher(id: string): boolean {
    const teachers = this.getTeachers();
    const filtered = teachers.filter(t => t.id !== id);
    if (filtered.length !== teachers.length) {
      this.saveTeachers(filtered);
      return true;
    }
    return false;
  }

  // ==================== SCHEDULE & TIMETABLE BUILDER ====================
  static getScheduleSlots(): ScheduleSlot[] {
    try {
      const stored = localStorage.getItem(SCHEDULE_SLOTS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    this.saveScheduleSlots(DEFAULT_SCHEDULE_SLOTS);
    return DEFAULT_SCHEDULE_SLOTS;
  }

  static saveScheduleSlots(slots: ScheduleSlot[]): void {
    localStorage.setItem(SCHEDULE_SLOTS_KEY, JSON.stringify(slots));
    this.notify();
  }

  static getScheduleAssignments(): ClassScheduleAssignment[] {
    try {
      const stored = localStorage.getItem(SCHEDULE_ASSIGNMENTS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    this.saveScheduleAssignments(INITIAL_SCHEDULE_ASSIGNMENTS);
    return INITIAL_SCHEDULE_ASSIGNMENTS;
  }

  static saveScheduleAssignments(assignments: ClassScheduleAssignment[]): void {
    localStorage.setItem(SCHEDULE_ASSIGNMENTS_KEY, JSON.stringify(assignments));
    this.notify();
  }

  static getScheduleForGrade(grade: string, dayOfWeek: number = 1): (ScheduleSlot & { assignment?: ClassScheduleAssignment })[] {
    const slots = this.getScheduleSlots();
    const assignments = this.getScheduleAssignments().filter(a => a.grade === grade && a.dayOfWeek === dayOfWeek);
    const assignMap = new Map<string, ClassScheduleAssignment>();
    assignments.forEach(a => assignMap.set(a.slotId, a));

    return slots.map(slot => ({
      ...slot,
      assignment: assignMap.get(slot.id)
    }));
  }

  static getScheduleForTeacher(teacherId: string, dayOfWeek: number = 1): (ScheduleSlot & { assignment?: ClassScheduleAssignment })[] {
    const slots = this.getScheduleSlots();
    const assignments = this.getScheduleAssignments().filter(a => a.teacherId === teacherId && a.dayOfWeek === dayOfWeek);
    const assignMap = new Map<string, ClassScheduleAssignment>();
    assignments.forEach(a => assignMap.set(a.slotId, a));

    return slots.map(slot => ({
      ...slot,
      assignment: assignMap.get(slot.id)
    }));
  }

  static setAssignment(assignment: Omit<ClassScheduleAssignment, 'id'> & { id?: string }): void {
    const assignments = this.getScheduleAssignments();
    const existingIdx = assignments.findIndex(a => 
      a.grade === assignment.grade && 
      a.slotId === assignment.slotId && 
      a.dayOfWeek === assignment.dayOfWeek
    );

    const fullAssignment: ClassScheduleAssignment = {
      id: assignment.id || `as-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ...assignment
    };

    if (existingIdx >= 0) {
      assignments[existingIdx] = fullAssignment;
    } else {
      assignments.push(fullAssignment);
    }

    this.saveScheduleAssignments(assignments);
  }

  static getNextClassSlot(currentSlotId: string): ScheduleSlot | undefined {
    const slots = this.getScheduleSlots();
    const currentIdx = slots.findIndex(s => s.id === currentSlotId);
    if (currentIdx === -1) return undefined;

    for (let i = currentIdx + 1; i < slots.length; i++) {
      if (slots[i].type === 'CLASS') {
        return slots[i];
      }
      if (slots[i].type === 'BREAK' || slots[i].type === 'LUNCH') {
        // Blocks typically shouldn't span past a main lunch/break unless continuous, but let's check next class
        return undefined;
      }
    }
    return undefined;
  }

  static setDoubleBlockAssignment(params: {
    firstSlotId: string;
    secondSlotId: string;
    dayOfWeek: number;
    grade: string;
    subject: string;
    teacherId?: string;
    teacherName?: string;
    classroom?: string;
  }): void {
    const assignments = this.getScheduleAssignments().filter(a => 
      !(a.grade === params.grade && a.dayOfWeek === params.dayOfWeek && (a.slotId === params.firstSlotId || a.slotId === params.secondSlotId))
    );

    const asgn1: ClassScheduleAssignment = {
      id: `as-dbl-1-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      dayOfWeek: params.dayOfWeek,
      slotId: params.firstSlotId,
      grade: params.grade,
      subject: params.subject,
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      classroom: params.classroom,
      isDoubleBlock: true,
      doubleBlockRole: 'FIRST_HOUR',
      doubleBlockLinkedSlotId: params.secondSlotId
    };

    const asgn2: ClassScheduleAssignment = {
      id: `as-dbl-2-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      dayOfWeek: params.dayOfWeek,
      slotId: params.secondSlotId,
      grade: params.grade,
      subject: params.subject,
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      classroom: params.classroom,
      isDoubleBlock: true,
      doubleBlockRole: 'SECOND_HOUR',
      doubleBlockLinkedSlotId: params.firstSlotId
    };

    assignments.push(asgn1, asgn2);
    this.saveScheduleAssignments(assignments);
  }

  static checkTeacherConflict(params: {
    teacherId: string;
    dayOfWeek: number;
    slotId: string;
    excludeGrade: string;
  }): ClassScheduleAssignment | undefined {
    const assignments = this.getScheduleAssignments();
    return assignments.find(a => 
      a.teacherId === params.teacherId &&
      a.dayOfWeek === params.dayOfWeek &&
      a.slotId === params.slotId &&
      a.grade !== params.excludeGrade
    );
  }

  static removeAssignment(grade: string, slotId: string, dayOfWeek: number, removeDoubleBlock: boolean = true): void {
    const assignments = this.getScheduleAssignments();
    const target = assignments.find(a => a.grade === grade && a.slotId === slotId && a.dayOfWeek === dayOfWeek);
    
    let filtered: ClassScheduleAssignment[];
    if (target && target.isDoubleBlock && target.doubleBlockLinkedSlotId && removeDoubleBlock) {
      filtered = assignments.filter(a => 
        !(a.grade === grade && a.dayOfWeek === dayOfWeek && (a.slotId === slotId || a.slotId === target.doubleBlockLinkedSlotId))
      );
    } else {
      filtered = assignments.filter(a => !(a.grade === grade && a.slotId === slotId && a.dayOfWeek === dayOfWeek));
    }
    this.saveScheduleAssignments(filtered);
  }

  // ==================== ATTENDANCE RECORDS ====================
  static getAllAttendance(): AttendanceRecord[] {
    try {
      const stored = localStorage.getItem(ATTENDANCE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}

    const initialRecords = this.generateInitialSeededAttendance();
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

  static getAttendanceByGrade(grade: string): AttendanceRecord[] {
    const all = this.getAllAttendance();
    if (grade === 'all') return all;
    return all.filter(r => r.studentGrade === grade);
  }

  static calculateStatus(currentTimeStr: string, settings: SchoolSettings): AttendanceStatus {
    const [currH, currM] = currentTimeStr.split(':').map(Number);
    const [startH, startM] = settings.dailyStartTime.split(':').map(Number);
    
    const currentTotalMin = currH * 60 + currM;
    const limitTotalMin = startH * 60 + startM + settings.tardyGracePeriodMinutes;

    return currentTotalMin <= limitTotalMin ? 'PUNTUAL' : 'TARDANZA';
  }

  // ==================== SCAN & REGISTER (USB & CAMERA) ====================
  static async registerScan(params: {
    scanInput: string;
    method: AttendanceMethod;
    type?: AttendanceType;
    customStatus?: AttendanceStatus;
    notes?: string;
  }): Promise<ScanResultFeedback> {
    const settings = this.getSettings();
    const parsed = await parseAndVerifyScan(params.scanInput, settings.qrSecret);
    const today = getTodayDateString();
    const currentTime = getCurrentTimeString();
    const scanType: AttendanceType = params.type || 'ENTRADA';

    if (!parsed.isValidFormat || !parsed.studentCode) {
      return {
        type: 'error',
        title: 'Formato no reconocido',
        message: `El código escaneado "${params.scanInput}" no corresponde a un carné o código escolar válido.`,
        timestamp: new Date().toISOString()
      };
    }

    const student = this.getStudentByCodeOrDoc(parsed.studentCode);
    if (!student) {
      return {
        type: 'not_found',
        title: 'Estudiante no encontrado (404)',
        message: `No existe ningún estudiante registrado con el código: ${parsed.studentCode}.`,
        timestamp: new Date().toISOString()
      };
    }

    if (!student.active) {
      return {
        type: 'error',
        title: 'Estudiante Inactivo',
        message: `El estudiante ${student.firstName} ${student.lastName} se encuentra en estado inactivo.`,
        timestamp: new Date().toISOString(),
        student
      };
    }

    // Regla de Idempotencia: un mismo estudiante no duplica registro de entrada hoy
    const todayRecords = this.getAttendanceByDate(today);
    const existing = todayRecords.find(r => r.studentCode === student.code && r.type === scanType);

    if (existing) {
      return {
        type: 'already_scanned',
        title: `Registro de ${scanType} ya existente`,
        message: `${student.firstName} ${student.lastName} ya registró ${scanType.toLowerCase()} hoy a las ${existing.time} (${existing.status}).`,
        timestamp: new Date().toISOString(),
        student,
        record: existing
      };
    }

    const calculatedStatus: AttendanceStatus = params.customStatus || 
      (scanType === 'ENTRADA' ? this.calculateStatus(currentTime, settings) : 'PUNTUAL');

    const newRecord: AttendanceRecord = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      studentCode: student.code,
      studentDocument: student.documentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentGrade: student.grade,
      studentSection: student.section,
      timestamp: new Date().toISOString(),
      date: today,
      time: currentTime,
      type: scanType,
      method: params.method,
      status: calculatedStatus,
      notes: params.notes || (parsed.isSigned ? 'Verificado vía Carné Digital HMAC-SHA256' : 'Ingreso por Código de Barras'),
      verifiedHmac: parsed.isSigned,
      synced: true
    };

    const allRecords = this.getAllAttendance();
    allRecords.unshift(newRecord);
    this.saveAttendance(allRecords);

    return {
      type: scanType === 'SALIDA' 
        ? 'success_exit' 
        : (calculatedStatus === 'PUNTUAL' ? 'success_punctual' : 'success_tardy'),
      title: scanType === 'SALIDA'
        ? '¡Salida Registrada!'
        : (calculatedStatus === 'PUNTUAL' ? '¡Ingreso Puntual Registrado!' : '¡Ingreso con Tardanza Registrado!'),
      message: `${student.firstName} ${student.lastName} (${student.grade}) • Doc: ${student.documentId} • ${currentTime}`,
      timestamp: newRecord.timestamp,
      student,
      record: newRecord
    };
  }

  // ==================== OFFLINE QUEUE ====================
  static getOfflineQueue(): OfflineQueueItem[] {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  }

  static enqueueOfflineScan(item: Omit<OfflineQueueItem, 'id' | 'retryCount'>): void {
    const queue = this.getOfflineQueue();
    queue.push({
      ...item,
      id: `off-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      retryCount: 0
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    this.notify();
  }

  static async syncOfflineQueue(): Promise<{ syncedCount: number; errors: number }> {
    const queue = this.getOfflineQueue();
    if (queue.length === 0) return { syncedCount: 0, errors: 0 };

    let syncedCount = 0;
    let errors = 0;
    const remainingQueue: OfflineQueueItem[] = [];

    for (const item of queue) {
      const res = await this.registerScan({
        scanInput: item.studentCode,
        method: 'SYNC',
        type: item.type,
        notes: `Sincronizado desde cola offline (Hora original: ${item.timestamp.split('T')[1]?.substring(0,8) || ''})`
      });

      if (res.type.startsWith('success') || res.type === 'already_scanned') {
        syncedCount++;
      } else {
        errors++;
        if (item.retryCount < 3) {
          remainingQueue.push({ ...item, retryCount: item.retryCount + 1 });
        }
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));
    this.notify();
    return { syncedCount, errors };
  }

  // ==================== RESUMEN ====================
  static getSummary(dateStr: string = getTodayDateString()): AttendanceSummary {
    const students = this.getStudents().filter(s => s.active);
    const records = this.getAttendanceByDate(dateStr).filter(r => r.type === 'ENTRADA');

    const totalEnrolled = students.length;
    const totalPresent = records.length;
    const punctualCount = records.filter(r => r.status === 'PUNTUAL').length;
    const tardyCount = records.filter(r => r.status === 'TARDANZA').length;
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

  // ==================== EXPORTACIÓN CSV ====================
  static exportAttendanceCsv(dateStr: string = getTodayDateString()): void {
    const records = this.getAttendanceByDate(dateStr);
    if (records.length === 0) {
      alert('No hay registros de asistencia para exportar en esta fecha.');
      return;
    }

    const headers = [
      'Código Estudiante',
      'Identificación (Doc)',
      'Nombre Completo',
      'Grado',
      'Sección',
      'Tipo Registro',
      'Fecha',
      'Hora',
      'Estado',
      'Método de Captura',
      'Firma HMAC Verificada',
      'Notas'
    ];

    const rows = records.map(r => [
      `"${r.studentCode}"`,
      `"${r.studentDocument}"`,
      `"${r.studentName}"`,
      `"${r.studentGrade}"`,
      `"${r.studentSection}"`,
      `"${r.type}"`,
      `"${r.date}"`,
      `"${r.time}"`,
      `"${r.status}"`,
      `"${r.method}"`,
      `"${r.verifiedHmac ? 'VÁLIDA' : 'NO'}"`,
      `"${r.notes || ''}"`
    ]);

    const settings = this.getSettings();
    const schoolSlug = (settings.schoolCode || 'inas').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `planilla_asistencia_${schoolSlug}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ==================== REINICIAR A DEMO ====================
  static resetToDemo(): void {
    localStorage.removeItem(ATTENDANCE_KEY);
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(INITIAL_STUDENTS));
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(INITIAL_TEACHERS));
    localStorage.setItem(SCHEDULE_SLOTS_KEY, JSON.stringify(DEFAULT_SCHEDULE_SLOTS));
    localStorage.setItem(SCHEDULE_ASSIGNMENTS_KEY, JSON.stringify(INITIAL_SCHEDULE_ASSIGNMENTS));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SCHOOL_SETTINGS));
    this.getAllAttendance();
    this.notify();
  }

  private static generateInitialSeededAttendance(): AttendanceRecord[] {
    const today = getTodayDateString();
    const students = INITIAL_STUDENTS;
    const records: AttendanceRecord[] = [];

    // Generar registros para hoy
    for (let i = 0; i < Math.min(46, students.length); i++) {
      const std = students[i];
      const isLate = i >= 38; // 8 con tardanza
      const hour = isLate ? '07' : '06';
      const min = isLate ? String(16 + (i - 38) * 2).padStart(2, '0') : String(38 + Math.floor(i * 0.6)).padStart(2, '0');
      const sec = String((i * 7) % 60).padStart(2, '0');
      const time = `${hour}:${min}:${sec}`;

      records.push({
        id: `rec-seed-today-${i + 1}`,
        studentCode: std.code,
        studentDocument: std.documentId,
        studentName: `${std.firstName} ${std.lastName}`,
        studentGrade: std.grade,
        studentSection: std.section,
        timestamp: `${today}T${time}.000Z`,
        date: today,
        time: time,
        type: 'ENTRADA',
        method: i % 3 === 0 ? 'USB' : (i % 3 === 1 ? 'CAMERA' : 'USB'),
        status: isLate ? 'TARDANZA' : 'PUNTUAL',
        notes: isLate ? 'Ingreso tras 07:15 AM' : 'Ingreso puntual jornada matutina',
        verifiedHmac: true,
        synced: true
      });
    }

    return records;
  }
}
