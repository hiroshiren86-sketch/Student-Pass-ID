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
  UserSession,
  StudentAttendanceStats,
  SubjectAttendanceSummary,
  ScheduleImportResult,
  ScannedByRole,
  DayTemplateType,
  DayTemplateConfig,
  EphemeralScanDelegation,
  StudentPersonalSchedule,
  StudentPersonalScheduleEntry
} from '../types/attendance';
import { 
  INITIAL_STUDENTS, 
  DEFAULT_SCHOOL_SETTINGS, 
  SCHOOL_GRADES_LIST,
  INITIAL_TEACHERS,
  DEFAULT_SCHEDULE_SLOTS,
  INITIAL_SCHEDULE_ASSIGNMENTS,
  DAY_TEMPLATES_DEFINITIONS
} from './mockData';
import { parseAndVerifyScan } from '../utils/crypto';
import { isValidGrade } from '../utils/documentParser';
import { FirebaseService } from './firebase';

const STUDENTS_KEY = 'inas_students_v5';
const ATTENDANCE_KEY = 'inas_attendance_v5';
const SETTINGS_KEY = 'inas_settings_v5';
const OFFLINE_QUEUE_KEY = 'inas_offline_queue_v5';
const TEACHERS_KEY = 'inas_teachers_v5';
const SCHEDULE_SLOTS_KEY = 'inas_schedule_slots_v5';
const SCHEDULE_ASSIGNMENTS_KEY = 'inas_schedule_assignments_v5';
const USER_SESSION_KEY = 'inas_user_session_v5';
const DELEGATIONS_KEY = 'inas_ephemeral_delegations_v5';
const NON_COMPUTABLE_SLOTS_KEY = 'inas_non_computable_slots_v5';
const CUSTOM_TEMPLATES_KEY = 'inas_custom_templates_v1'; // Ronda 4 (F1): plantillas creadas por Rectoría
const DAY_CLOSED_KEY = 'inas_day_closed_v1';             // Ronda 4 (F3): flag de cierre de jornada por fecha
const STUDENT_SCHEDULES_KEY = 'inas_student_schedules_v1'; // Ronda 4 (F4): horario opcional por estudiante

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

  // ==================== USER SESSION (GUARD & PERSISTENCE) ====================
  static getCurrentSession(): UserSession | null {
    try {
      const stored = localStorage.getItem(USER_SESSION_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  }

  static saveCurrentSession(session: UserSession): void {
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session));
    this.notify();
  }

  static clearSession(): void {
    localStorage.removeItem(USER_SESSION_KEY);
    this.notify();
  }

  // ==================== SETTINGS ====================
  private static isCloudSyncInitialized = false;

  static getSettings(): SchoolSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.schoolName) {
          // Merge with defaults for any newly introduced keys
          return {
            ...DEFAULT_SCHOOL_SETTINGS,
            ...parsed,
            cloudflareWorkerUrl: parsed.cloudflareWorkerUrl || DEFAULT_SCHOOL_SETTINGS.cloudflareWorkerUrl
          };
        }
      }
    } catch {}
    return DEFAULT_SCHOOL_SETTINGS;
  }

  static saveSettings(settings: SchoolSettings, syncToCloud = true): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.notify();

    if (syncToCloud) {
      FirebaseService.saveSchoolSettings(settings).catch((e) => {
        console.warn('Firestore async settings backup deferred:', e);
      });
    }
  }

  /**
   * Initializes automatic bidirectional cloud sync with Firebase Firestore
   * Restores institutional settings if browser storage was wiped or when switching devices
   *
   * Ronda 18: espera la sesión anónima del terminal (Firebase Anonymous ya habilitado
   * en la consola) ANTES de leer/escuchar Firestore, porque las reglas endurecidas
   * exigen `isAuthenticated()`. La espera tiene tope de 6 s y jamás rechaza: si no
   * hay red o el proveedor falla, el sync se intenta igualmente y la app sigue
   * offline-first (cero bloqueo del arranque).
   */
  static initCloudSettingsSync(): void {
    if (this.isCloudSyncInitialized) return;
    this.isCloudSyncInitialized = true;

    FirebaseService.ensureAnonymousAuth().then(() => {
      // 1. Initial fetch from Firestore
      FirebaseService.loadSchoolSettings().then((cloudSettings) => {
        if (cloudSettings) {
          const local = this.getSettings();
          // If local has empty or default worker URL but cloud has it, or if local is older
          const merged: SchoolSettings = {
            ...DEFAULT_SCHOOL_SETTINGS,
            ...local,
            ...cloudSettings,
            cloudflareWorkerUrl: cloudSettings.cloudflareWorkerUrl || local.cloudflareWorkerUrl || DEFAULT_SCHOOL_SETTINGS.cloudflareWorkerUrl
          };
          this.saveSettings(merged, false);
        }
      }).catch(() => {});

      // 2. Real-time listener for multi-device sync
      FirebaseService.onSchoolSettingsChange((cloudSettings) => {
        if (cloudSettings && (cloudSettings.schoolName || cloudSettings.cloudflareWorkerUrl)) {
          const current = this.getSettings();
          const updated = { ...current, ...cloudSettings };
          this.saveSettings(updated as SchoolSettings, false);
        }
      });
    }).catch(() => {});

    // 3. Listen to auth changes (when Admin or Teacher logs in, restore their cloud profile settings)
    //    No requiere espera: onAuthStateChanged es local al SDK y dispara con la sesión restaurada.
    FirebaseService.onAuthStateChange(async (user) => {
      if (user) {
        try {
          const profile = await FirebaseService.getUserProfile(user.uid);
          const cloudSettings = await FirebaseService.loadSchoolSettings();
          if (cloudSettings) {
            const current = this.getSettings();
            const merged = { ...current, ...cloudSettings };
            this.saveSettings(merged, false);
          }
        } catch (e) {
          console.warn('Auth sync notice:', e);
        }
      }
    });
  }

  // ==================== STUDENTS ====================
  static getStudents(): Student[] {
    try {
      const stored = localStorage.getItem(STUDENTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('[AttendanceStorageService] Error parsing students from storage (JSON corrupt):', err);
      try {
        const raw = localStorage.getItem(STUDENTS_KEY);
        if (raw) {
          localStorage.setItem(`${STUDENTS_KEY}_corrupt_backup_${Date.now()}`, raw);
        }
      } catch {}
      // Auto-recover with demo data if JSON is corrupted
      this.saveStudents(INITIAL_STUDENTS);
      return INITIAL_STUDENTS;
    }

    // Only seed initial students if key has never been initialized
    if (localStorage.getItem(STUDENTS_KEY) === null) {
      this.saveStudents(INITIAL_STUDENTS);
      return INITIAL_STUDENTS;
    }
    return [];
  }

  static saveStudents(students: Student[]): void {
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    this.notify();
  }

  static getUniqueGrades(): string[] {
    const students = this.getStudents();
    const set = new Set<string>();
    SCHOOL_GRADES_LIST.forEach(g => {
      if (isValidGrade(g)) set.add(g);
    });
    students.forEach(s => {
      if (s.grade && isValidGrade(s.grade)) set.add(s.grade);
    });
    // Include schedule assignments grades to prevent orphaned schedules
    try {
      const assignments = this.getScheduleAssignments();
      assignments.forEach(a => {
        if (a.grade && isValidGrade(a.grade)) set.add(a.grade);
      });
    } catch {}

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

      // Cascading cleanup of any active delegation for this student
      try {
        const delegations = this.getEphemeralDelegations();
        const activeDelegations = delegations.filter(d => d.studentCode !== code);
        if (activeDelegations.length !== delegations.length) {
          this.saveEphemeralDelegations(activeDelegations);
        }
      } catch {}

      return true;
    }
    return false;
  }

  // ==================== SUBROLES & CASCADA DE 3 NIVELES ====================
  static getRepresentativeForGrade(grade: string): Student | undefined {
    return this.getStudents().find(s => s.grade === grade && s.isRepresentative && s.active);
  }

  static getSubstituteRepresentativeForGrade(grade: string): Student | undefined {
    return this.getStudents().find(s => s.grade === grade && s.isSubstituteRepresentative && s.active);
  }

  static setRepresentativeForGrade(grade: string, studentCode: string, isSubstitute: boolean = false): boolean {
    const students = this.getStudents();
    let updated = false;
    students.forEach(s => {
      if (s.grade === grade) {
        if (s.code === studentCode) {
          if (isSubstitute) {
            s.isSubstituteRepresentative = true;
            s.isRepresentative = false;
          } else {
            s.isRepresentative = true;
            s.isSubstituteRepresentative = false;
          }
          s.representativeGrade = grade;
          updated = true;
        } else {
          if (isSubstitute && s.isSubstituteRepresentative) {
            s.isSubstituteRepresentative = false;
            if (!s.isRepresentative) s.representativeGrade = undefined;
            updated = true;
          } else if (!isSubstitute && s.isRepresentative) {
            s.isRepresentative = false;
            if (!s.isSubstituteRepresentative) s.representativeGrade = undefined;
            updated = true;
          }
        }
      }
    });
    if (updated) {
      this.saveStudents(students);
    }
    return updated;
  }

  // Delegaciones Efímeras (Nivel 2 de la Cascada)
  static getEphemeralDelegations(): EphemeralScanDelegation[] {
    try {
      const stored = localStorage.getItem(DELEGATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  static saveEphemeralDelegations(delegations: EphemeralScanDelegation[]): void {
    localStorage.setItem(DELEGATIONS_KEY, JSON.stringify(delegations));
    this.notify();
  }

  static createEphemeralDelegation(params: {
    teacherId: string;
    teacherName: string;
    studentCode: string;
    studentName: string;
    grade: string;
    slotId: string;
  }): EphemeralScanDelegation {
    const slots = this.getScheduleSlots();
    const slot = slots.find(s => s.id === params.slotId) || slots[0];
    const today = getTodayDateString();
    
    // Calculate expiry: end of the current slot or 1 hour from now
    const expiresAt = slot ? slot.endTime : '23:59';
    const delegation: EphemeralScanDelegation = {
      id: `del-${Date.now()}-${params.studentCode}`,
      token: `TOKEN-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      studentCode: params.studentCode,
      studentName: params.studentName,
      grade: params.grade,
      slotId: params.slotId,
      date: today,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    const delegations = this.getEphemeralDelegations().filter(d => 
      !(d.studentCode === params.studentCode && d.slotId === params.slotId && d.date === today)
    );
    delegations.unshift(delegation);
    this.saveEphemeralDelegations(delegations);
    return delegation;
  }

  static getValidEphemeralDelegation(studentCode: string, slotId?: string): EphemeralScanDelegation | undefined {
    const today = getTodayDateString();
    const delegations = this.getEphemeralDelegations();
    const currentTime = getCurrentTimeString();

    return delegations.find(d => {
      if (d.studentCode !== studentCode || d.date !== today) return false;
      if (slotId && d.slotId !== slotId) return false;
      // Check expiry
      return currentTime <= d.expiresAt;
    });
  }

  static revokeEphemeralDelegation(id: string): void {
    const delegations = this.getEphemeralDelegations().filter(d => d.id !== id);
    this.saveEphemeralDelegations(delegations);
  }

  static getScannerAuthority(studentCode: string, grade: string, slotId?: string): {
    role: ScannedByRole;
    authorized: boolean;
    delegation?: EphemeralScanDelegation;
  } {
    const titular = this.getRepresentativeForGrade(grade);
    if (titular && titular.code === studentCode) {
      return { role: 'REPRESENTANTE_TITULAR', authorized: true };
    }

    const suplente = this.getSubstituteRepresentativeForGrade(grade);
    if (suplente && suplente.code === studentCode) {
      return { role: 'REPRESENTANTE_SUPLENTE', authorized: true };
    }

    const ephem = this.getValidEphemeralDelegation(studentCode, slotId);
    if (ephem && ephem.grade === grade) {
      return { role: 'DELEGADO_EFIMERO', authorized: true, delegation: ephem };
    }

    return { role: 'REPRESENTANTE', authorized: false };
  }

  static getGroupDirectorForGrade(grade: string): Teacher | undefined {
    return this.getTeachers().find(t => t.isGroupDirector && t.directorGrade === grade && t.active);
  }

  static setGroupDirectorForGrade(grade: string, teacherId: string): boolean {
    const teachers = this.getTeachers();
    let updated = false;
    teachers.forEach(t => {
      if (t.id === teacherId) {
        t.isGroupDirector = true;
        t.directorGrade = grade;
        updated = true;
      } else if (t.directorGrade === grade && t.id !== teacherId) {
        t.isGroupDirector = false;
        t.directorGrade = undefined;
        updated = true;
      }
    });
    if (updated) {
      this.saveTeachers(teachers);
    }
    return updated;
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

  static deleteTeacher(id: string): boolean {
    const teachers = this.getTeachers();
    const filtered = teachers.filter(t => t.id !== id);
    if (filtered.length !== teachers.length) {
      this.saveTeachers(filtered);
      return true;
    }
    return false;
  }

  static resetTeacherPassword(teacherId: string): { success: boolean; newPassword?: string; error?: string } {
    const teachers = this.getTeachers();
    const teacher = teachers.find(t => t.id === teacherId);
    if (!teacher) {
      return { success: false, error: 'Docente no encontrado' };
    }
    const newPassword = `Doc_${Math.floor(1000 + Math.random() * 9000)}`;
    teacher.password = newPassword;
    this.saveTeachers(teachers);
    return { success: true, newPassword };
  }

  // ==================== SCHEDULES & TIMETABLE ====================
  // ==================== HORARIOS & PLANTILLAS DE DÍA (DAY TEMPLATES) ====================
  // Ronda 4 (F1): plantillas CUSTOM creadas por Rectoría + fusión con las 5 oficiales.
  static getCustomTemplates(): DayTemplateConfig[] {
    try {
      const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  static saveCustomTemplates(templates: DayTemplateConfig[]): void {
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates || []));
    this.notify();
  }

  static upsertCustomTemplate(tmpl: DayTemplateConfig): void {
    const list = this.getCustomTemplates();
    const idx = list.findIndex(t => t.id === tmpl.id);
    if (idx >= 0) list[idx] = tmpl; else list.push(tmpl);
    this.saveCustomTemplates(list);
  }

  // Ronda 8 (B4): al eliminar una plantilla CUSTOM que estaba APLICADA, el reset a la
  // plantilla oficial + regeneración de slots se hace AQUÍ (fuente única de verdad),
  // no en la UI. Así ningún llamador puede dejar settings.activeDayTemplate apuntando
  // a un id inexistente con los slots de la plantilla borrada ("ventana fantasma").
  static deleteCustomTemplate(id: string): void {
    this.saveCustomTemplates(this.getCustomTemplates().filter(t => t.id !== id));
    if (this.getSettings().activeDayTemplate === id) {
      this.applyDayTemplate('tmpl-normal');
    }
  }

  // Ronda 8 (B4): auto-sanación al arranque. Si settings.activeDayTemplate apunta a un
  // id que ya no existe (p. ej. estado heredado de una plantilla custom borrada antes de
  // este fix), getActiveDayTemplate() haría fallback silencioso a "Plantilla A" en el
  // badge mientras los slots siguen siendo los de la plantilla eliminada. Esto realinea
  // slots + setting una sola vez por sesión.
  static ensureActiveTemplateConsistency(): void {
    const activeId = this.getSettings().activeDayTemplate;
    if (activeId && !this.resolveTemplate(activeId)) {
      this.applyDayTemplate('tmpl-normal');
    }
  }

  // Ronda 4 (F1): resuelve una plantilla por ID (canónico) o por TYPE legado ('NORMAL'…)
  // Corrige el bug latente: el selector enviaba el ID pero la búsqueda era por TYPE,
  // por lo que elegir otra plantilla siempre aplicaba la NORMAL.
  static resolveTemplate(idOrType: string): DayTemplateConfig | undefined {
    if (!idOrType) return undefined;
    const all = [...DAY_TEMPLATES_DEFINITIONS, ...this.getCustomTemplates()];
    return all.find(t => t.id === idOrType) || all.find(t => t.type === idOrType);
  }

  static getDayTemplates(): DayTemplateConfig[] {
    return [...DAY_TEMPLATES_DEFINITIONS, ...this.getCustomTemplates()];
  }

  static getActiveDayTemplate(): DayTemplateConfig {
    const settings = this.getSettings();
    return this.resolveTemplate(settings.activeDayTemplate) || DAY_TEMPLATES_DEFINITIONS[0];
  }

  static getProportionalNoticeMinutes(durationMinutes: number): number {
    if (durationMinutes >= 50) return 11;
    if (durationMinutes >= 40) return 9;
    if (durationMinutes >= 30) return 7;
    return 5;
  }

  // Ronda 4 (F1): generador puro de slots — misma lógica que el applyDayTemplate original,
  // extraída para previsualización en el editor de plantillas y para aplicar plantillas custom.
  static generateSlotsFromTemplate(tmpl: DayTemplateConfig): ScheduleSlot[] {
    let baseHour = 6;
    let baseMin = 30;
    if (tmpl.baseStartTime) {
      const [h, m] = tmpl.baseStartTime.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m)) { baseHour = h; baseMin = m; }
    }

    let currentTotalMin = baseHour * 60 + baseMin;
    const newSlots: ScheduleSlot[] = [];
    const totalBlocks = Math.max(1, tmpl.totalBlocks || 6);
    const blockDur = Math.max(5, tmpl.blockDurationMinutes || 55);
    const noticeMin = tmpl.proportionalNoticeMinutes || this.getProportionalNoticeMinutes(blockDur);

    for (let i = 1; i <= totalBlocks; i++) {
      // Recreo de 30 min tras el 3er bloque de clase
      if (i === 4) {
        const recessDur = Math.max(0, tmpl.recessDurationMinutes || 30);
        const recStartH = Math.floor(currentTotalMin / 60).toString().padStart(2, '0');
        const recStartM = (currentTotalMin % 60).toString().padStart(2, '0');
        currentTotalMin += recessDur;
        const recEndH = Math.floor(currentTotalMin / 60).toString().padStart(2, '0');
        const recEndM = (currentTotalMin % 60).toString().padStart(2, '0');

        newSlots.push({
          id: `slot-recess`,
          order: 4,
          type: 'BREAK',
          name: 'Recreo / Descanso Principal',
          startTime: `${recStartH}:${recStartM}`,
          endTime: `${recEndH}:${recEndM}`,
          durationMinutes: recessDur,
          color: '#10b981'
        });
      }

      const slotOrder = i >= 4 ? i + 1 : i;
      const startH = Math.floor(currentTotalMin / 60).toString().padStart(2, '0');
      const startM = (currentTotalMin % 60).toString().padStart(2, '0');
      currentTotalMin += blockDur;
      const endH = Math.floor(currentTotalMin / 60).toString().padStart(2, '0');
      const endM = (currentTotalMin % 60).toString().padStart(2, '0');

      let slotName = `${i}ª Hora de Clase`;
      let isNonComputable = tmpl.isNonComputableAllDay;
      let slotType: ScheduleSlot['type'] = 'CLASS';

      if (i === 1 && tmpl.firstBlockSpecial === 'ACTO_CIVICO') {
        slotName = 'Acto Cívico (Izada de Bandera)';
        isNonComputable = true;
        slotType = 'CIVIC';
      } else if (i === 1 && tmpl.firstBlockSpecial === 'ASESORIA_GRUPO') {
        slotName = 'Dirección y Asesoría de Grupo';
        slotType = 'ADVISORY';
      }

      newSlots.push({
        id: `slot-${i}`,
        order: slotOrder,
        type: slotType,
        name: slotName,
        startTime: `${startH}:${startM}`,
        endTime: `${endH}:${endM}`,
        durationMinutes: blockDur,
        noticeMinutesBeforeEnd: noticeMin,
        isNonComputable,
        color: isNonComputable ? '#94a3b8' : (slotType === 'ADVISORY' ? '#8b5cf6' : '#4f46e5')
      });
    }

    newSlots.sort((a, b) => a.order - b.order);
    return newSlots;
  }

  static applyDayTemplate(templateIdOrType: string): { success: boolean; template: DayTemplateConfig; slots: ScheduleSlot[] } {
    const tmpl = this.resolveTemplate(templateIdOrType) || DAY_TEMPLATES_DEFINITIONS[0];
    const settings = this.getSettings();
    settings.activeDayTemplate = tmpl.id; // Ronda 4 (F1): siempre se guarda el ID canónico
    settings.trimMinutes = tmpl.trimMinutesPerBlock || 0;
    this.saveSettings(settings);

    const newSlots = this.generateSlotsFromTemplate(tmpl);
    this.saveScheduleSlots(newSlots);
    return { success: true, template: tmpl, slots: newSlots };
  }

  // ==================== Ronda 4 (F3): VENTANA DE JORNADA (día lectivo) ====================
  // Fuente: dayStartTime/dayEndTime de la plantilla activa → fallback settings.daily* →
  // fallback primer/último slot. null = día no lectivo (fin de semana).
  static getSchoolDayWindow(dateStr?: string): { start: string; end: string; startMin: number; endMin: number } | null {
    const date = dateStr || getTodayDateString();
    const [y, mo, d] = date.split('-').map(Number);
    const dow = y && mo && d ? new Date(y, mo - 1, d).getDay() : new Date().getDay();
    if (dow === 0 || dow === 6) return null; // domingo/sábado: sin jornada lectiva

    const settings = this.getSettings();
    const tmpl = this.getActiveDayTemplate();
    const slots = this.getScheduleSlots().filter(s => s.type !== 'BREAK' && s.type !== 'LUNCH');
    const firstSlot = slots[0];
    const lastSlot = slots[slots.length - 1];

    const start = tmpl.dayStartTime || settings.dailyStartTime || firstSlot?.startTime;
    const end = tmpl.dayEndTime || settings.dailyEndTime || lastSlot?.endTime;
    if (!start || !end) return null;

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(v => Number.isNaN(v))) return null;
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) return null;
    return { start, end, startMin, endMin };
  }

  static isWithinSchoolDay(timeStr?: string, dateStr?: string): boolean {
    const window = this.getSchoolDayWindow(dateStr);
    if (!window) return false;
    const t = timeStr || getCurrentTimeString();
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return false;
    const nowMin = h * 60 + m;
    return nowMin >= window.startMin && nowMin <= window.endMin;
  }

  // ==================== Ronda 4 (F3): CIERRE AUTOMÁTICO DE JORNADA ====================
  static getDayCloseState(dateStr?: string): { closedAt?: string; summary?: { blocksClosed: number; absentMarked: number; pendingRevision: number } } {
    const date = dateStr || getTodayDateString();
    try {
      const raw = localStorage.getItem(DAY_CLOSED_KEY);
      const map = raw ? JSON.parse(raw) : {};
      return map[date] || {};
    } catch {
      return {};
    }
  }

  static async closeDayAttendance(params: { dateStr?: string; forceClose?: boolean; closedBy?: string }): Promise<{ closedAt: string; blocksClosed: number; absentMarked: number; pendingRevision: number; details: Array<{ grade: string; slotId: string; status: string; absent: number }> }> {
    const date = params.dateStr || getTodayDateString();
    const slots = this.getScheduleSlots().filter(s => s.type !== 'BREAK' && s.type !== 'LUNCH');
    const grades = Array.from(new Set(this.getStudents().filter(s => s.active).map(s => s.grade)));
    const details: Array<{ grade: string; slotId: string; status: string; absent: number }> = [];
    let absentMarked = 0;
    let pendingRevision = 0;

    for (const grade of grades) {
      for (const slot of slots) {
        try {
          const res = this.closeBlockAttendance({
            grade,
            slotId: slot.id,
            subject: slot.name,
            teacherName: params.closedBy || 'Cierre Automático de Jornada',
            dateStr: date,
            forceClose: params.forceClose
          });
          if (res.status === 'CLOSED') {
            absentMarked += res.markedAbsentCount;
            details.push({ grade, slotId: slot.id, status: 'CLOSED', absent: res.markedAbsentCount });
          } else if (res.status === 'PENDIENTE_REVISION') {
            pendingRevision += 1;
            details.push({ grade, slotId: slot.id, status: 'PENDIENTE_REVISION', absent: 0 });
          }
          // NO_COMPUTABLE (Regla de Oro: 0 escaneos / hora libre / día especial) → no se cuenta
        } catch { /* un bloque que falla no debe abortar el cierre del día */ }
      }
    }

    const closedAt = new Date().toISOString();
    try {
      const raw = localStorage.getItem(DAY_CLOSED_KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[date] = { closedAt, summary: { blocksClosed: details.filter(d => d.status === 'CLOSED').length, absentMarked, pendingRevision } };
      localStorage.setItem(DAY_CLOSED_KEY, JSON.stringify(map));
    } catch { /* flag informativo */ }
    this.notify();

    return { closedAt, blocksClosed: details.filter(d => d.status === 'CLOSED').length, absentMarked, pendingRevision, details };
  }

  // Evaluación perezosa e idempotente: solo actúa si la hora actual superó el fin de
  // la jornada y el día aún no se ha cerrado. Llamado por el timer de App y por las vistas.
  static async maybeAutoCloseDay(dateStr?: string): Promise<boolean> {
    const date = dateStr || getTodayDateString();
    if (this.getDayCloseState(date).closedAt) return false;
    const window = this.getSchoolDayWindow(date);
    if (!window) return false;
    const t = getCurrentTimeString();
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return false;
    if (h * 60 + m < window.endMin) return false;
    await this.closeDayAttendance({ dateStr: date });
    return true;
  }

  // ==================== Ronda 4 (F4): HORARIO OPCIONAL DEL ESTUDIANTE ====================
  // Informativo: NO interfiere con asistencia/KPIs/cierres. Se oculta para TODAS las
  // cuentas cuando settings.templatesOnlyMode = true (guard en la UI del portal).
  static getAllStudentSchedules(): Record<string, StudentPersonalSchedule> {
    try {
      const raw = localStorage.getItem(STUDENT_SCHEDULES_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  }

  // Ronda 4 (F5): reemplazo total desde el snapshot de sync (patrón igual que slots/assignments)
  static saveAllStudentSchedules(map: Record<string, StudentPersonalSchedule>): void {
    localStorage.setItem(STUDENT_SCHEDULES_KEY, JSON.stringify(map && typeof map === 'object' ? map : {}));
    this.notify();
  }

  static getStudentPersonalSchedule(studentCode: string): StudentPersonalSchedule | null {
    if (!studentCode) return null;
    return this.getAllStudentSchedules()[studentCode] || null;
  }

  static saveStudentPersonalSchedule(studentCode: string, entries: StudentPersonalScheduleEntry[]): StudentPersonalSchedule {
    const all = this.getAllStudentSchedules();
    const schedule: StudentPersonalSchedule = { studentCode, entries: entries || [], updatedAt: new Date().toISOString() };
    all[studentCode] = schedule;
    localStorage.setItem(STUDENT_SCHEDULES_KEY, JSON.stringify(all));
    this.notify();
    return schedule;
  }

  static deleteStudentPersonalSchedule(studentCode: string): void {
    const all = this.getAllStudentSchedules();
    if (!all[studentCode]) return;
    delete all[studentCode];
    localStorage.setItem(STUDENT_SCHEDULES_KEY, JSON.stringify(all));
    this.notify();
  }

  // Parser CSV del horario personal. Formato por fila (separador coma o punto y coma):
  //   dia, materia, horaInicio, horaFin[opcional]
  //   "Lunes", "Matemáticas", "07:00", "07:55"
  // Devuelve entradas válidas + errores por línea (sin lanzar excepciones).
  static parsePersonalScheduleCSV(text: string): { entries: StudentPersonalScheduleEntry[]; errors: string[] } {
    const errors: string[] = [];
    const entries: StudentPersonalScheduleEntry[] = [];
    const dayMap: Record<string, number> = { lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, 'viernes': 5, 'sábado': 6, sabado: 6 };
    const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;

    (text || '').split(/\r?\n/).forEach((line, i) => {
      const trimmed = line.trim();
      // Ronda 8 (B5): encabezado = primera celda EXACTAMENTE "día"/"dia" (separada por ; o ,).
      // Antes se descartaba en silencio cualquier línea que EMPEZARA con "dia" (p. ej.
      // "DiaInvalido, Química, 08:00"), lo que escondía errores reales del CSV.
      const headerCell = trimmed.split(/[;,]/)[0].trim().toLowerCase();
      if (!trimmed || headerCell === 'dia' || headerCell === 'día') return; // header o vacío
      const cells = trimmed.split(/[;,]/).map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length < 3) {
        errors.push(`Línea ${i + 1}: se requieren al menos día, materia y hora de inicio.`);
        return;
      }
      const dayKey = cells[0].toLowerCase();
      const dayOfWeek = /^\d$/.test(cells[0]) ? Number(cells[0]) : dayMap[dayKey];
      if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 6) {
        errors.push(`Línea ${i + 1}: día no reconocido ("${cells[0]}"). Usa Lunes…Sábado o 1-6.`);
        return;
      }
      const subject = cells[1].slice(0, 60);
      const startTime = cells[2];
      const endTime = cells[3] || '';
      if (!timeRe.test(startTime) || (endTime && !timeRe.test(endTime))) {
        errors.push(`Línea ${i + 1}: hora inválida (formato HH:mm, 24h).`);
        return;
      }
      let finalEnd = endTime;
      if (!finalEnd) {
        const [h, m] = startTime.split(':').map(Number);
        const endMin = Math.min(23 * 60 + 59, h * 60 + m + 55);
        finalEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      }
      entries.push({ dayOfWeek, subject, startTime, endTime: finalEnd });
    });

    return { entries, errors };
  }

  // ==================== HORAS LIBRES / BLOQUES NO COMPUTABLES ====================
  static getNonComputableSlots(dateStr?: string): { slotId: string; grade: string; date: string; reason: string }[] {
    try {
      const stored = localStorage.getItem(NON_COMPUTABLE_SLOTS_KEY);
      const list = stored ? JSON.parse(stored) : [];
      const date = dateStr || getTodayDateString();
      return list.filter((item: any) => item.date === date);
    } catch {
      return [];
    }
  }

  static markSlotNonComputable(params: { slotId: string; grade: string; dateStr?: string; reason?: string }): void {
    const date = params.dateStr || getTodayDateString();
    try {
      const stored = localStorage.getItem(NON_COMPUTABLE_SLOTS_KEY);
      const list = stored ? JSON.parse(stored) : [];
      const filtered = list.filter((item: any) => !(item.slotId === params.slotId && item.grade === params.grade && item.date === date));
      filtered.push({
        slotId: params.slotId,
        grade: params.grade,
        date,
        reason: params.reason || 'Hora Libre / Docente Ausente / Actividad Especial'
      });
      localStorage.setItem(NON_COMPUTABLE_SLOTS_KEY, JSON.stringify(filtered));
      this.notify();
    } catch {}
  }

  static markSlotComputable(params: { slotId: string; grade: string; dateStr?: string }): void {
    const date = params.dateStr || getTodayDateString();
    try {
      const stored = localStorage.getItem(NON_COMPUTABLE_SLOTS_KEY);
      const list = stored ? JSON.parse(stored) : [];
      const filtered = list.filter((item: any) => !(item.slotId === params.slotId && item.grade === params.grade && item.date === date));
      localStorage.setItem(NON_COMPUTABLE_SLOTS_KEY, JSON.stringify(filtered));
      this.notify();
    } catch {}
  }

  static isSlotNonComputable(slotId: string, grade: string, dateStr?: string): { isNonComputable: boolean; reason?: string } {
    const currentTemplate = this.getActiveDayTemplate();
    if (currentTemplate.isNonComputableAllDay) {
      return { isNonComputable: true, reason: 'Día Especial (Sin ausencias automáticas)' };
    }

    const slots = this.getScheduleSlots();
    const slot = slots.find(s => s.id === slotId);
    if (slot?.isNonComputable) {
      return { isNonComputable: true, reason: slot.name };
    }

    const date = dateStr || getTodayDateString();
    const nonComp = this.getNonComputableSlots(date).find(item => item.slotId === slotId && item.grade === grade);
    if (nonComp) {
      return { isNonComputable: true, reason: nonComp.reason };
    }

    return { isNonComputable: false };
  }

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

  static getCurrentActiveSlot(customTimeStr?: string): { slot: ScheduleSlot; isWithin: boolean; dayOfWeek: number } | null {
    const slots = this.getScheduleSlots().filter(s => s.type === 'CLASS');
    const now = new Date();
    const dayOfWeek = now.getDay() || 1; // 1 = Lunes
    const timeStr = customTimeStr || getCurrentTimeString();
    const [h, m] = timeStr.split(':').map(Number);
    const currentMin = h * 60 + m;

    for (const slot of slots) {
      const [startH, startM] = slot.startTime.split(':').map(Number);
      const [endH, endM] = slot.endTime.split(':').map(Number);
      const slotStartMin = startH * 60 + startM;
      const slotEndMin = endH * 60 + endM;

      if (currentMin >= slotStartMin && currentMin < slotEndMin) {
        return { slot, isWithin: true, dayOfWeek };
      }
    }

    // Default fallback to first class slot if outside hours
    return slots[0] ? { slot: slots[0], isWithin: false, dayOfWeek } : null;
  }

  static getNextClassSlot(slotId: string): ScheduleSlot | undefined {
    const classSlots = this.getScheduleSlots().filter(s => s.type === 'CLASS').sort((a, b) => a.order - b.order);
    const currIdx = classSlots.findIndex(s => s.id === slotId);
    if (currIdx >= 0 && currIdx < classSlots.length - 1) {
      return classSlots[currIdx + 1];
    }
    return undefined;
  }

  static checkTeacherConflict(params: { teacherId: string; dayOfWeek: number; slotId: string; excludeGrade?: string }): { conflict: boolean; conflictingGrade?: string; conflictingSubject?: string; slotName?: string } | undefined {
    const assignments = this.getScheduleAssignments();
    const slots = this.getScheduleSlots();
    const conflict = assignments.find(a => 
      a.teacherId === params.teacherId &&
      a.dayOfWeek === params.dayOfWeek &&
      a.slotId === params.slotId &&
      (!params.excludeGrade || a.grade !== params.excludeGrade)
    );
    if (conflict) {
      const slot = slots.find(s => s.id === params.slotId);
      return {
        conflict: true,
        conflictingGrade: conflict.grade,
        conflictingSubject: conflict.subject,
        slotName: slot?.name || params.slotId
      };
    }
    return undefined;
  }

  static setDoubleBlockAssignment(params: {
    firstSlotId: string;
    secondSlotId?: string;
    dayOfWeek: number;
    grade: string;
    subject: string;
    teacherId?: string;
    teacherName?: string;
    classroom?: string;
  }): void {
    const secondSlot = params.secondSlotId ? this.getScheduleSlots().find(s => s.id === params.secondSlotId) : this.getNextClassSlot(params.firstSlotId);
    
    this.setAssignment({
      dayOfWeek: params.dayOfWeek,
      slotId: params.firstSlotId,
      grade: params.grade,
      subject: params.subject,
      teacherId: params.teacherId,
      teacherName: params.teacherName,
      classroom: params.classroom,
      isDoubleBlock: true
    });

    if (secondSlot) {
      this.setAssignment({
        dayOfWeek: params.dayOfWeek,
        slotId: secondSlot.id,
        grade: params.grade,
        subject: params.subject,
        teacherId: params.teacherId,
        teacherName: params.teacherName,
        classroom: params.classroom,
        isDoubleBlock: true
      });
    }
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

  static removeAssignment(grade: string, slotId: string, dayOfWeek: number, removeDoubleBlock?: boolean): void {
    const assignments = this.getScheduleAssignments();
    const target = assignments.find(a => a.grade === grade && a.slotId === slotId && a.dayOfWeek === dayOfWeek);
    let filtered = assignments.filter(a => !(a.grade === grade && a.slotId === slotId && a.dayOfWeek === dayOfWeek));
    
    if (removeDoubleBlock && target && target.isDoubleBlock) {
      const nextSlot = this.getNextClassSlot(slotId);
      if (nextSlot) {
        filtered = filtered.filter(a => !(a.grade === grade && a.slotId === nextSlot.id && a.dayOfWeek === dayOfWeek && a.subject === target.subject));
      }
    }
    this.saveScheduleAssignments(filtered);
  }

  // Multi-Course Master Schedule Importer (CSV / JSON)
  static importMasterScheduleCsvOrJson(rawText: string): ScheduleImportResult {
    const result: ScheduleImportResult = {
      success: true,
      totalRowsProcessed: 0,
      importedAssignmentsCount: 0,
      conflictsCount: 0,
      ignoredRowsCount: 0,
      conflicts: [],
      ignoredRows: []
    };

    const trimmed = rawText.trim();
    if (!trimmed) {
      return { ...result, success: false, ignoredRows: [{ row: 0, line: '', reason: 'Texto de horario vacío.' }] };
    }

    const slots = this.getScheduleSlots();
    const teachers = this.getTeachers();
    const newAssignments = [...this.getScheduleAssignments()];

    // Helper map day names
    const dayMap: Record<string, number> = {
      'lunes': 1, 'lun': 1, '1': 1,
      'martes': 2, 'mar': 2, '2': 2,
      'miercoles': 3, 'miércoles': 3, 'mie': 3, 'mié': 3, '3': 3,
      'jueves': 4, 'jue': 4, '4': 4,
      'viernes': 5, 'vie': 5, '5': 5,
      'sabado': 6, 'sábado': 6, 'sab': 6, '6': 6
    };

    // Try parsing as JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const list = Array.isArray(parsed) ? parsed : (parsed.assignments || parsed.horarios || []);
        result.totalRowsProcessed = list.length;

        list.forEach((item: any, idx: number) => {
          const rowNum = idx + 1;
          const grade = String(item.grade || item.curso || item.grado || '').trim();
          const dayRaw = String(item.day || item.dia || item.diaSemana || '1').toLowerCase().trim();
          const dayOfWeek = dayMap[dayRaw] || Number(dayRaw) || 1;
          const subject = String(item.subject || item.materia || item.asignatura || '').trim();
          const teacherNameRaw = String(item.teacher || item.profesor || item.docente || '').trim();
          const classroom = String(item.classroom || item.aula || item.salon || 'Aula Regular').trim();
          const slotIdentifier = String(item.slotId || item.slot || item.hora || item.bloque || '').trim();

          if (!grade || !subject) {
            result.ignoredRowsCount++;
            result.ignoredRows.push({ row: rowNum, line: JSON.stringify(item), reason: 'Falta grado o asignatura requerida.' });
            return;
          }

          // Match slot
          let matchedSlot = slots.find(s => s.id === slotIdentifier || s.name.toLowerCase().includes(slotIdentifier.toLowerCase()) || s.startTime === slotIdentifier);
          if (!matchedSlot) {
            matchedSlot = slots.find(s => s.type === 'CLASS');
          }

          if (!matchedSlot) {
            result.ignoredRowsCount++;
            result.ignoredRows.push({ row: rowNum, line: JSON.stringify(item), reason: 'Bloque horario no reconocido.' });
            return;
          }

          // Match teacher
          const teacher = teachers.find(t => 
            t.fullName.toLowerCase().includes(teacherNameRaw.toLowerCase()) || 
            t.username.toLowerCase() === teacherNameRaw.toLowerCase()
          );

          // Check conflict
          const conflict = newAssignments.find(a => 
            a.slotId === matchedSlot!.id && 
            a.dayOfWeek === dayOfWeek && 
            a.teacherId && 
            teacher && 
            a.teacherId === teacher.id && 
            a.grade !== grade
          );

          if (conflict) {
            result.conflictsCount++;
            result.conflicts.push({
              row: rowNum,
              reason: `Conflicto de docente solapado`,
              detail: `El docente ${teacher?.fullName} ya está asignado al grado ${conflict.grade} en el bloque ${matchedSlot.name} el día ${dayOfWeek}.`
            });
          }

          // Upsert
          const existIdx = newAssignments.findIndex(a => a.grade === grade && a.slotId === matchedSlot!.id && a.dayOfWeek === dayOfWeek);
          const assignmentObj: ClassScheduleAssignment = {
            id: `as-imp-${Date.now()}-${idx}`,
            grade,
            dayOfWeek,
            slotId: matchedSlot.id,
            subject,
            teacherId: teacher?.id,
            teacherName: teacher?.fullName || teacherNameRaw || 'Docente Asignado',
            classroom
          };

          if (existIdx >= 0) {
            newAssignments[existIdx] = assignmentObj;
          } else {
            newAssignments.push(assignmentObj);
          }
          result.importedAssignmentsCount++;
        });

        this.saveScheduleAssignments(newAssignments);
        return result;
      } catch (err: any) {
        // Fallback to CSV
      }
    }

    // CSV Parsing
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
    result.totalRowsProcessed = lines.length;

    let startIndex = 0;
    const firstLineLower = lines[0].toLowerCase();
    if (firstLineLower.includes('curso') || firstLineLower.includes('grado') || firstLineLower.includes('dia') || firstLineLower.includes('asignatura') || firstLineLower.includes('grade')) {
      startIndex = 1; // Skip header
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const rowNum = i + 1;
      const delimiter = line.includes(';') ? ';' : (line.includes('\t') ? '\t' : ',');
      const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));

      if (parts.length < 3) {
        result.ignoredRowsCount++;
        result.ignoredRows.push({ row: rowNum, line, reason: 'Línea con menos de 3 columnas (se requiere al menos Grado; Día; Asignatura).' });
        continue;
      }

      // Expected format: Grade; Day; Slot/Hour; Subject; Teacher; Classroom
      const grade = parts[0];
      const dayRaw = parts[1].toLowerCase();
      const dayOfWeek = dayMap[dayRaw] || Number(dayRaw) || 1;
      const slotRaw = parts.length >= 4 ? parts[2] : '1';
      const subject = parts.length >= 4 ? parts[3] : parts[2];
      const teacherRaw = parts[4] || '';
      const classroom = parts[5] || 'Aula Regular';

      if (!grade || !subject) {
        result.ignoredRowsCount++;
        result.ignoredRows.push({ row: rowNum, line, reason: 'Grado o Asignatura vacía.' });
        continue;
      }

      let matchedSlot = slots.find(s => s.id === slotRaw || s.name.toLowerCase().includes(slotRaw.toLowerCase()) || s.startTime.startsWith(slotRaw));
      if (!matchedSlot) {
        const orderNum = parseInt(slotRaw.replace(/\D/g, ''), 10);
        if (!isNaN(orderNum)) {
          matchedSlot = slots.find(s => s.order === orderNum && s.type === 'CLASS');
        }
      }
      if (!matchedSlot) {
        matchedSlot = slots.find(s => s.type === 'CLASS');
      }

      if (!matchedSlot) {
        result.ignoredRowsCount++;
        result.ignoredRows.push({ row: rowNum, line, reason: `No se encontró slot de clase para: ${slotRaw}` });
        continue;
      }

      const teacher = teachers.find(t => 
        t.fullName.toLowerCase().includes(teacherRaw.toLowerCase()) || 
        t.username.toLowerCase() === teacherRaw.toLowerCase()
      );

      // Check conflict
      const conflict = newAssignments.find(a => 
        a.slotId === matchedSlot!.id && 
        a.dayOfWeek === dayOfWeek && 
        a.teacherId && 
        teacher && 
        a.teacherId === teacher.id && 
        a.grade !== grade
      );

      if (conflict) {
        result.conflictsCount++;
        result.conflicts.push({
          row: rowNum,
          reason: 'Conflicto de cruce docente',
          detail: `Prof. ${teacher?.fullName} ocupado en ${conflict.grade} el día ${dayOfWeek} en ${matchedSlot.name}.`
        });
      }

      const existIdx = newAssignments.findIndex(a => a.grade === grade && a.slotId === matchedSlot!.id && a.dayOfWeek === dayOfWeek);
      const assignmentObj: ClassScheduleAssignment = {
        id: `as-csv-${Date.now()}-${i}`,
        grade,
        dayOfWeek,
        slotId: matchedSlot.id,
        subject,
        teacherId: teacher?.id,
        teacherName: teacher?.fullName || teacherRaw || 'Docente Titular',
        classroom
      };

      if (existIdx >= 0) {
        newAssignments[existIdx] = assignmentObj;
      } else {
        newAssignments.push(assignmentObj);
      }
      result.importedAssignmentsCount++;
    }

    this.saveScheduleAssignments(newAssignments);
    return result;
  }

  // ==================== ATTENDANCE RECORDS (CLASS BASED) ====================
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

  static getAttendanceByGradeAndSlot(grade: string, slotId: string, dateStr: string = getTodayDateString()): AttendanceRecord[] {
    return this.getAllAttendance().filter(r => r.studentGrade === grade && r.slotId === slotId && r.date === dateStr);
  }

  // ==================== CLASSROOM SCANNER ====================
  static async registerClassScan(params: {
    scanInput: string;
    method: AttendanceMethod;
    slotId: string;
    grade: string;
    subject?: string;
    teacherName?: string;
    scannedBy?: ScannedByRole;
    scannedByName?: string;
    scannedByCode?: string;
    customStatus?: AttendanceStatus;
    notes?: string;
  }): Promise<ScanResultFeedback> {
    const settings = this.getSettings();
    const parsed = await parseAndVerifyScan(params.scanInput, settings.qrSecret);
    const today = getTodayDateString();
    const currentTime = getCurrentTimeString();

    if (!parsed.isValidFormat || !parsed.studentCode) {
      return {
        type: 'error',
        title: 'Formato no reconocido',
        message: `El código "${params.scanInput}" no corresponde a un carné o código escolar válido.`,
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
        message: `El estudiante ${student.firstName} ${student.lastName} se encuentra inactivo en la matrícula.`,
        timestamp: new Date().toISOString(),
        student
      };
    }

    // Ronda 4 (F3): VENTANA DE JORNADA — punto de control ÚNICO para todos los puntos de
    // escaneo (aula, portería, representante). Fuera de la ventana de la plantilla del día
    // NO se registra nada (ni re-apertura de ausentes post-cierre). El override humano del
    // docente (marca manual en planilla) y los cierres NO pasan por aquí a propósito.
    if (!this.isWithinSchoolDay(currentTime)) {
      const window = this.getSchoolDayWindow();
      return {
        type: 'out_of_window',
        title: 'Jornada Cerrada',
        message: window
          ? `La jornada de hoy inicia a las ${window.start} y termina a las ${window.end}. Fuera de ese rango no se registra asistencia por escáner.`
          : 'Hoy no hay jornada lectiva configurada; no se registra asistencia por escáner.',
        timestamp: new Date().toISOString(),
        student
      };
    }

    const slots = this.getScheduleSlots();
    const currentSlot = slots.find(s => s.id === params.slotId) || slots[0];

    // Check if slot has assignment
    const currentDay = new Date().getDay() || 1;
    const assignments = this.getScheduleAssignments();
    const assignment = assignments.find(a => a.grade === student.grade && a.slotId === currentSlot.id && a.dayOfWeek === currentDay);

    const resolvedSubject = params.subject || assignment?.subject || 'Cátedra General';
    const resolvedTeacher = params.teacherName || assignment?.teacherName || 'Docente Titular';

    // Regla de Unicidad: Estudiante + Fecha + Bloque
    const allRecords = this.getAllAttendance();
    const existingIdx = allRecords.findIndex(r => 
      r.studentCode === student.code && 
      r.date === today && 
      r.slotId === currentSlot.id
    );

    if (existingIdx >= 0) {
      const existing = allRecords[existingIdx];
      // If student was marked AUSENTE by auto-cierre, update to TARDANZA/PUNTUAL
      if (existing.status === 'AUSENTE') {
        existing.status = 'TARDANZA';
        existing.time = currentTime;
        existing.method = params.method;
        existing.scannedBy = params.scannedBy || 'DOCENTE';
        existing.notes = `Marcado tardío tras auto-cierre (${currentTime})`;
        this.saveAttendance(allRecords);

        return {
          type: 'success_tardy',
          title: 'Asistencia Actualizada (Tardanza)',
          message: `${student.firstName} ${student.lastName} registrado en ${resolvedSubject} (${currentSlot.name}).`,
          timestamp: new Date().toISOString(),
          student,
          record: existing
        };
      }

      return {
        type: 'already_scanned',
        title: 'Asistencia ya registrada en este bloque',
        message: `${student.firstName} ${student.lastName} ya fue registrado en ${resolvedSubject} a las ${existing.time} (${existing.status}).`,
        timestamp: new Date().toISOString(),
        student,
        record: existing
      };
    }

    // Determine status (Puntual vs Tardanza based on slot start time + grace period)
    const [startH, startM] = currentSlot.startTime.split(':').map(Number);
    const [currH, currM] = currentTime.split(':').map(Number);
    const slotStartMin = startH * 60 + startM;
    const currentMin = currH * 60 + currM;
    const graceMin = settings.tardyGracePeriodMinutes || 10;

    let calculatedStatus: AttendanceStatus = params.customStatus || 'PUNTUAL';
    if (!params.customStatus) {
      if (currentMin > slotStartMin + graceMin) {
        calculatedStatus = 'TARDANZA';
      } else {
        calculatedStatus = 'PUNTUAL';
      }
    }

    const newRecord: AttendanceRecord = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      studentCode: student.code,
      studentDocument: student.documentId,
      studentName: `${student.firstName} ${student.lastName}`,
      studentGrade: student.grade,
      studentSection: student.section,
      slotId: currentSlot.id,
      slotName: currentSlot.name,
      slotStartTime: currentSlot.startTime,
      slotEndTime: currentSlot.endTime,
      subject: resolvedSubject,
      teacherName: resolvedTeacher,
      timestamp: new Date().toISOString(),
      date: today,
      time: currentTime,
      type: 'CLASE',
      status: calculatedStatus,
      method: params.method,
      scannedBy: params.scannedBy || 'DOCENTE',
      scannedByName: params.scannedByName,
      scannedByCode: params.scannedByCode,
      notes: params.notes || (parsed.isSigned ? 'Verificado vía Carné Digital HMAC-SHA256' : 'Escaneado en Aula de Clase'),
      verifiedHmac: parsed.isSigned,
      synced: true
    };

    allRecords.unshift(newRecord);
    this.saveAttendance(allRecords);

    return {
      type: calculatedStatus === 'PUNTUAL' ? 'success_punctual' : 'success_tardy',
      title: calculatedStatus === 'PUNTUAL' ? '¡Asistencia Puntual Registrada!' : '¡Asistencia con Tardanza Registrada!',
      message: `${student.firstName} ${student.lastName} • ${student.grade} • ${resolvedSubject} (${currentSlot.name})`,
      timestamp: newRecord.timestamp,
      student,
      record: newRecord
    };
  }

  // ==================== AUTO-CIERRE & VENTANA PROPORCIONAL ====================
  static closeBlockAttendance(params: {
    grade: string;
    slotId: string;
    subject?: string;
    teacherName?: string;
    dateStr?: string;
    forceClose?: boolean;
  }): { 
    status: 'CLOSED' | 'NO_COMPUTABLE' | 'PENDIENTE_REVISION';
    markedAbsentCount: number; 
    presentCount: number;
    totalStudents: number;
    reason?: string;
  } {
    const today = params.dateStr || getTodayDateString();
    const students = this.getStudentsByGrade(params.grade).filter(s => s.active);
    const totalStudents = students.length;
    const allRecords = this.getAllAttendance();
    const slots = this.getScheduleSlots();
    const slot = slots.find(s => s.id === params.slotId) || slots[0];

    // Verificar si el bloque está marcado como NO COMPUTABLE (Hora libre, acto cívico o día especial)
    const checkNonComp = this.isSlotNonComputable(params.slotId, params.grade, today);
    if (checkNonComp.isNonComputable) {
      return {
        status: 'NO_COMPUTABLE',
        markedAbsentCount: 0,
        presentCount: 0,
        totalStudents,
        reason: checkNonComp.reason
      };
    }

    // Contar cuántos estudiantes registraron asistencia válida en este bloque hoy
    const blockScans = allRecords.filter(r => 
      r.studentGrade === params.grade && 
      r.slotId === params.slotId && 
      r.date === today &&
      (r.status === 'PUNTUAL' || r.status === 'TARDANZA')
    );
    const presentCount = blockScans.length;

    // REGLA DE ORO: Si hay 0 escaneos, JAMÁS marcar ausencias automáticas (se asume hora libre / docente ausente)
    if (presentCount === 0 && !params.forceClose) {
      return {
        status: 'NO_COMPUTABLE',
        markedAbsentCount: 0,
        presentCount: 0,
        totalStudents,
        reason: 'Cero escaneos en el bloque. Se presume hora libre sin penalizar ausencias a los estudiantes.'
      };
    }

    // UMBRAL DEL 30%: Si se escaneó menos del 30% del grupo, requiere validación docente
    const scanRatio = totalStudents > 0 ? (presentCount / totalStudents) : 1;
    if (scanRatio < 0.3 && !params.forceClose) {
      return {
        status: 'PENDIENTE_REVISION',
        markedAbsentCount: 0,
        presentCount,
        totalStudents,
        reason: `Solo se registró el ${Math.round(scanRatio * 100)}% del grupo (${presentCount}/${totalStudents}). Requiere confirmación docente para evitar falsos ausentes.`
      };
    }

    // Auto-cierre estándar: Marcar a los estudiantes no registrados como AUSENTES
    let markedAbsentCount = 0;
    const resolvedSubject = params.subject || 'Cátedra General';
    const resolvedTeacher = params.teacherName || 'Docente Titular';

    students.forEach(student => {
      const existing = allRecords.find(r => 
        r.studentCode === student.code && 
        r.date === today && 
        r.slotId === params.slotId
      );

      if (!existing) {
        markedAbsentCount++;
        allRecords.push({
          id: `rec-abs-${Date.now()}-${student.code}`,
          studentCode: student.code,
          studentDocument: student.documentId,
          studentName: `${student.firstName} ${student.lastName}`,
          studentGrade: student.grade,
          studentSection: student.section,
          slotId: slot.id,
          slotName: slot.name,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          subject: resolvedSubject,
          teacherName: resolvedTeacher,
          timestamp: new Date().toISOString(),
          date: today,
          time: getCurrentTimeString(),
          type: 'CLASE',
          status: 'AUSENTE',
          method: 'AUTO_CIERRE',
          scannedBy: 'AUTO_CIERRE',
          notes: 'Inasistencia marcada automáticamente por auto-cierre de bloque horario',
          verifiedHmac: true,
          synced: true
        });
      }
    });

    if (markedAbsentCount > 0) {
      this.saveAttendance(allRecords);
    }

    return { 
      status: 'CLOSED',
      markedAbsentCount, 
      presentCount,
      totalStudents 
    };
  }

  // ==================== EXACT AUDITED STUDENT STATS (A.9 / D1) ====================
  static getStudentAttendanceStats(studentCode: string): StudentAttendanceStats {
    const student = this.getStudentByCodeOrDoc(studentCode);
    const records = this.getAllAttendance().filter(r => r.studentCode === studentCode);

    const totalClasses = records.length;
    const punctualCount = records.filter(r => r.status === 'PUNTUAL').length;
    const tardyCount = records.filter(r => r.status === 'TARDANZA').length;
    const absentCount = records.filter(r => r.status === 'AUSENTE').length;
    const attendedCount = punctualCount + tardyCount;

    const attendancePercentage = totalClasses > 0 ? Math.round((attendedCount / totalClasses) * 100) : 100;
    const punctualityRate = attendedCount > 0 ? Math.round((punctualCount / attendedCount) * 100) : 100;

    // Breakdown by subject
    const subjectMap = new Map<string, { total: number; punctual: number; tardy: number; absent: number; teacher: string }>();
    records.forEach(r => {
      const subj = r.subject || 'General';
      const curr = subjectMap.get(subj) || { total: 0, punctual: 0, tardy: 0, absent: 0, teacher: r.teacherName || 'Docente Titular' };
      curr.total++;
      if (r.status === 'PUNTUAL') curr.punctual++;
      else if (r.status === 'TARDANZA') curr.tardy++;
      else if (r.status === 'AUSENTE') curr.absent++;
      subjectMap.set(subj, curr);
    });

    const bySubject: SubjectAttendanceSummary[] = Array.from(subjectMap.entries()).map(([subject, data]) => {
      const attended = data.punctual + data.tardy;
      const rate = data.total > 0 ? Math.round((attended / data.total) * 100) : 100;
      return {
        subject,
        teacherName: data.teacher,
        totalClasses: data.total,
        punctualCount: data.punctual,
        tardyCount: data.tardy,
        absentCount: data.absent,
        attendanceRate: rate
      };
    });

    return {
      studentCode: student?.code || studentCode,
      studentName: student ? `${student.firstName} ${student.lastName}` : 'Estudiante',
      grade: student?.grade || 'N/A',
      totalClasses,
      attendedCount,
      punctualCount,
      tardyCount,
      absentCount,
      attendancePercentage,
      punctualityRate,
      bySubject
    };
  }

  // ==================== SUMMARY & METRICS ====================
  static getSummary(dateStr: string = getTodayDateString()): AttendanceSummary {
    const students = this.getStudents().filter(s => s.active);
    const records = this.getAttendanceByDate(dateStr);

    const totalEnrolled = students.length;
    const totalClassesToday = records.length;
    const punctualCount = records.filter(r => r.status === 'PUNTUAL').length;
    const tardyCount = records.filter(r => r.status === 'TARDANZA').length;
    const absentCount = records.filter(r => r.status === 'AUSENTE').length;
    const totalPresent = punctualCount + tardyCount;

    const attendanceRate = totalClassesToday > 0 
      ? Math.round((totalPresent / totalClassesToday) * 100) 
      : (totalEnrolled > 0 ? 95 : 100);

    return {
      totalEnrolled,
      totalClassesToday,
      totalPresent,
      punctualCount,
      tardyCount,
      absentCount,
      attendanceRate
    };
  }

  // ==================== EXPORTACIÓN CSV ====================
  static exportAttendanceCsv(dateStr: string = getTodayDateString(), recordsToExport?: AttendanceRecord[]): void {
    const records = recordsToExport || this.getAttendanceByDate(dateStr);
    if (records.length === 0) {
      alert('No hay registros de asistencia para exportar en esta fecha.');
      return;
    }

    const headers = [
      'Código Estudiante',
      'Identificación (Doc)',
      'Nombre Completo',
      'Grado',
      'Bloque / Hora',
      'Asignatura',
      'Docente',
      'Fecha',
      'Hora Registro',
      'Estado',
      'Escaneado Por',
      'Nombre Escaneador',
      'Método de Captura',
      'Firma HMAC Verificada',
      'Notas'
    ];

    const rows = records.map(r => [
      `"${r.studentCode}"`,
      `"${r.studentDocument}"`,
      `"${r.studentName}"`,
      `"${r.studentGrade}"`,
      `"${r.slotName || ''}"`,
      `"${r.subject || ''}"`,
      `"${r.teacherName || ''}"`,
      `"${r.date}"`,
      `"${r.time}"`,
      `"${r.status}"`,
      `"${r.scannedBy || 'DOCENTE'}"`,
      `"${r.scannedByName || ''}"`,
      `"${r.method}"`,
      `"${r.verifiedHmac ? 'Token QR Firmado (VÁLIDO)' : (r.method === 'AUTO_CIERRE' ? 'N/A (Auto-Cierre)' : 'Manual / Teclado (N/A)')}"`,
      `"${r.notes || ''}"`
    ]);

    const settings = this.getSettings();
    const schoolSlug = (settings.schoolCode || 'inas').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `planilla_asistencia_aula_${schoolSlug}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ==================== REINICIAR A DEMO ====================
  static getOfflineQueue(): any[] {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  static async syncOfflineQueue(): Promise<void> {
    // Offline records are already fully persisted in localStorage
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([]));
    this.notify();
  }

  static async registerScan(params: {
    scanInput: string;
    method?: any;
    scanType?: any;
    customStatus?: any;
    notes?: string;
  }): Promise<any> {
    const activeSlotInfo = this.getCurrentActiveSlot();
    const slotId = activeSlotInfo?.slot.id || 'slot-1';
    
    // Look up student to supply grade
    const parsed = await parseAndVerifyScan(params.scanInput);
    const students = this.getStudents();
    const student = students.find(s => 
      s.code === parsed.studentCode || 
      s.documentId === parsed.studentCode ||
      (parsed.documentId && s.documentId === parsed.documentId)
    );
    const grade = student?.grade || parsed.grade || '6°1';

    return this.registerClassScan({
      scanInput: params.scanInput,
      method: params.method || 'CAMERA',
      slotId,
      grade,
      scannedBy: 'DOCENTE',
      scannedByName: 'Terminal Escolar Principal',
      notes: params.notes
    });
  }

  static resetToDemo(): void {
    // Backup before resetting
    try {
      const curStudents = localStorage.getItem(STUDENTS_KEY);
      const curAtt = localStorage.getItem(ATTENDANCE_KEY);
      if (curStudents) localStorage.setItem('inas_students_backup_prior_reset', curStudents);
      if (curAtt) localStorage.setItem('inas_attendance_backup_prior_reset', curAtt);
    } catch {}

    localStorage.removeItem(ATTENDANCE_KEY);
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    localStorage.removeItem(USER_SESSION_KEY);
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
    const slots = DEFAULT_SCHEDULE_SLOTS.filter(s => s.type === 'CLASS');
    const records: AttendanceRecord[] = [];

    // Seed realistic class attendances for grade 6°1, 10°1, 10°2
    const seededGrades = ['6°1', '10°1', '10°2', '11°2'];

    seededGrades.forEach((grd) => {
      const gradeStudents = students.filter(s => s.grade === grd);
      slots.slice(0, 3).forEach((slot, slotIdx) => {
        const subject = slotIdx === 0 ? 'Matemáticas' : (slotIdx === 1 ? 'Lengua Castellana' : 'Ciencias Naturales');
        const teacher = slotIdx === 0 ? 'Juan Pablo Pérez Gómez' : (slotIdx === 1 ? 'María Camila Restrepo Henao' : 'Diana Carolina Valencia Morales');

        gradeStudents.forEach((std, sIdx) => {
          const isAbsent = sIdx === gradeStudents.length - 1 && slotIdx === 2;
          const isLate = sIdx === gradeStudents.length - 2;

          const hour = slot.startTime.split(':')[0];
          const min = isLate ? '20' : String(5 + (sIdx % 8) * 3).padStart(2, '0');
          const time = `${hour}:${min}:12`;

          records.push({
            id: `rec-seed-${grd}-${slot.id}-${std.code}`,
            studentCode: std.code,
            studentDocument: std.documentId,
            studentName: `${std.firstName} ${std.lastName}`,
            studentGrade: std.grade,
            studentSection: std.section,
            slotId: slot.id,
            slotName: slot.name,
            slotStartTime: slot.startTime,
            slotEndTime: slot.endTime,
            subject,
            teacherName: teacher,
            timestamp: `${today}T${time}.000Z`,
            date: today,
            time: time,
            type: 'CLASE',
            status: isAbsent ? 'AUSENTE' : (isLate ? 'TARDANZA' : 'PUNTUAL'),
            method: sIdx % 2 === 0 ? 'CAMERA' : 'USB',
            scannedBy: sIdx % 4 === 0 ? 'REPRESENTANTE' : 'DOCENTE',
            scannedByName: sIdx % 4 === 0 ? 'Valentina Gómez (Representante)' : teacher,
            verifiedHmac: true,
            synced: true,
            notes: isAbsent ? 'Inasistencia no justificada' : (isLate ? 'Ingreso tardío al aula' : 'Asistencia en aula verificada')
          });
        });
      });
    });

    return records;
  }
}
