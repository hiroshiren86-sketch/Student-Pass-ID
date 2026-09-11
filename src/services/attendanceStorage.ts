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
  StudentExcuse,
  ScheduleImportResult,
  ScannedByRole,
  DayTemplateType,
  DayTemplateConfig,
  EphemeralScanDelegation,
  StudentPersonalSchedule,
  StudentPersonalScheduleEntry,
  ActiveClassContext,
  ActiveClassSource,
  ParsedScheduleRow
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
import { parseAndVerifyScan, parseAndVerifyClassScan, parseAndVerifyTeacherCard, slugifySubject, prettifySubjectSlug, generateHmacSignature } from '../utils/crypto';
import { isValidGrade } from '../utils/documentParser';
import { FirebaseService } from './firebase';
import { SEED_DEMO_ON_FIRST_LAUNCH } from './demoConfig';
// Ciclo runtime-only (excuseService ↔ attendanceStorage): seguro, solo métodos estáticos.
import { ExcuseService, justificationLabelOf, isRecordProtected } from './excuseService';

const STUDENTS_KEY = 'inas_students_v5';
const STUDENTS_PREV_KEY = 'inas_students_prev_v5'; // Ronda 38 (H-38-2): respaldo previo sin fotos
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
const ACTIVE_CLASS_KEY = 'inas_active_class_v1'; // Ronda 19: QR de Clase — contexto de clase activa POR DISPOSITIVO
const TOMBSTONES_KEY = 'inas_tombstones_v1'; // Ronda 54 (hueco #5): marca de borrado que se PROPAGA (soft-delete)
const LOCAL_SYNC_DIRTY_KEY = 'inas_local_sync_dirty_v1'; // Ronda 57: sello de "hay ediciones locales SIN SUBIR a la nube"
const QRSECRET_MIRROR_KEY = 'inas_qrsecret_mirror_v1'; // Ronda 58 (F-10): espejo anti-corrupción del secret institucional

/**
 * Ronda 19 — QR de Clase: helper de tiempo Bogotá. Convierte "HH:mm" de hoy a epoch ms
 * local (Date.parse sin sufijo Z usa la zona del runtime; en producción el navegador del
 * colegio está en America/Bogota y la suite corre con la misma zona simulada).
 */
export function bogotaTodayTimeToEpochMs(timeStr: string, dateStr: string = getTodayDateString()): number {
  return Date.parse(`${dateStr}T${timeStr}:00`);
}

/**
 * Ronda 19 — QR de Clase: vigencia del TOKEN impreso (fin del año escolar, 19-dic 23:59).
 * El anti-replay real son TRES capas: (1) firma HMAC, (2) día de la semana validado al
 * activar, (3) la clase activa muere al fin del bloque. Así la tarjeta impresa sirve
 * todo el período académico sin reimprimir cada semana.
 */
export function schoolYearEndEpochMs(): number {
  const year = new Date().getFullYear();
  return Date.parse(`${year}-12-19T23:59:59`);
}

export function getTodayDateString(): string {
  const d = new Date();
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // YYYY-MM-DD
  return formatter.format(d);
}

export function getCurrentTimeString(): string {
  const d = new Date();
  // Ronda 58 (F-22): hourCycle:'h23' EXPLÍCITO. Con `hour12: false` algunos runtimes
  // usan el ciclo h24 heredado de ICU/CLDR y entre las 00:00 y las 00:59 formatean
  // "24:37:19" — con eso maybeAutoCloseDay cerraba el día RECÉN estrenado (todo el
  // curso AUSENTE con sello de cierre) y getCurrentActiveSlot respondía "no hay
  // clase en curso". 'h23' es la única forma 0–23 en TODOS los runtimes.
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  };
  const formatter = new Intl.DateTimeFormat('es-CO', options);
  return formatter.format(d);
}

/**
 * Ronda 44 (handoff v2) — ¿es una clase activa de TARJETA DE DOCENTE (v2)?
 * Una única fuente de verdad para registerScan, el banner y el Aula Docente: en v2 el
 * registro NO lleva gate de grado (el grado lo aporta cada carné) y el contexto firma
 * "quién + para qué", no "dónde + cuándo".
 */
export function isActiveClassV2(ctx: ActiveClassContext | null | undefined): boolean {
  return !!ctx && (ctx.source === 'QR_CLASE_V2' || ctx.source === 'AULA_DOCENTE_V2');
}

/**
 * Ronda 46 — Etiqueta humana única del rol del escaneador (fuente única de verdad para
 * planilla, CSV y mensajes). Resuelve la cascada completa (Titular/Suplente/Efímero) y
 * los roles operativos; el default es 'Docente' para conservar el comportamiento previo
 * de cualquier registro legacy sin `scannedBy`.
 */
export function scannedByRoleLabel(role?: ScannedByRole | null | undefined): string {
  switch (role) {
    case 'REPRESENTANTE_TITULAR': return 'Representante Titular';
    case 'REPRESENTANTE_SUPLENTE': return 'Representante Suplente';
    case 'DELEGADO_EFIMERO': return 'Delegado Efímero';
    case 'REPRESENTANTE': return 'Representante';
    case 'AUTO_CIERRE': return 'Auto-Cierre';
    case 'ADMIN': return 'Administración';
    case 'DOCENTE': return 'Docente';
    default: return 'Docente';
  }
}

export class AttendanceStorageService {
  private static listeners: Array<() => void> = [];

  static subscribe(callback: () => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private static notify(invalidateReads = true) {
    // Ronda 58 (F-10): por defecto toda notificación invalida los caches de lectura
    // (la próxima lectura reconstruye desde localStorage) — es el único punto de
    // invalidación necesario porque TODA escritura de colecciones pasa por los save*
    // del servicio o por un setItem directo seguido de notify() (verificado por grep:
    // cero setItem directos a las llaves de colección fuera de este archivo). Los
    // save* pasan invalidateReads=false porque ya hicieron WRITE-THROUGH (el array
    // persistido ES el cache válido — evitar re-parsear ~3 MB en el próximo escaneo).
    if (invalidateReads) this.invalidateReadCaches();
    this.listeners.forEach(cb => cb());
  }

  // ==================== RONDA 58 (F-10) — CACHE DE LECTURA ====================
  // Medición de la auditoría (perf-probe, 1 500 estudiantes / 15 000 registros):
  // UN escaneo hacía 9 lecturas + 3 escrituras y 6.9 MB de JSON serializado
  // (61.5 ms en Node; más lento en un teléfono real) porque CADA getter re-parseaba
  // la colección completa. Este cache en memoria elimina el parseo repetido: la
  // primera lectura de cada colección parsea y las demás (el mismo tick de escaneo
  // llama getSettings/getStudents/getAllAttendance/getScheduleSlots varias veces)
  // cuestan O(1). Invariantes:
  //   - Se invalida en notify() → toda escritura del servicio limpia el cache.
  //   - Los arrays devueltos son EL cache vivo (mutarlos sin pasar por el save*
  //     correspondiente es un bug del llamador — exactamente igual que hoy con el
  //     array recién parseado).
  //   - La recuperación de corruptos sigue siendo la de R27 (respaldo + vacío o
  //     demo según SEED_DEMO_ON_FIRST_LAUNCH): el cache nunca "esconde" un fallo
  //     de lectura porque el fallo se maneja dentro del propio getter ANTES de
  //     cachear el resultado.
  private static readCache: {
    students: Student[] | null;
    teachers: Teacher[] | null;
    attendance: AttendanceRecord[] | null;
    slots: ScheduleSlot[] | null;
    assignments: ClassScheduleAssignment[] | null;
    settings: SchoolSettings | null;
  } = { students: null, teachers: null, attendance: null, slots: null, assignments: null, settings: null };

  private static invalidateReadCaches(): void {
    this.readCache = { students: null, teachers: null, attendance: null, slots: null, assignments: null, settings: null };
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

  /**
   * Ronda 30 (H-30-1): restauración SEGURA de sesión al recargar la página.
   *
   * La app ya NO arranca como Rectoría implícita (isAuthenticated=false): solo un
   * login explícito abre la aplicación. Al recargar, esta función decide si la
   * sesión persistida es restorable bajo TRES condiciones:
   *   1. Existe y tiene `authAt` (estampa del login real — las sesiones legacy de la
   *      era de Rectoría implícita, sin authAt, se descartan y se borran).
   *   2. No ha expirado (TTL 12 h, espejo del expiró de la sesión HMAC del servidor
   *      legado): en un dispositivo compartido, la sesión muere sola cada media jornada.
   *   3. El rol aún existe en la BD local (App.tsx valida docente/estudiante por id).
   *
   * Si algo falla, la sesión se limpia y se devuelve null → LoginScreen.
   */
  static restoreValidSession(maxAgeMs: number = 12 * 60 * 60 * 1000): UserSession | null {
    try {
      const session = this.getCurrentSession();
      if (!session || !session.authAt) {
        this.clearSession();
        return null;
      }
      if (Date.now() - session.authAt > maxAgeMs) {
        this.clearSession();
        return null;
      }
      return session;
    } catch {
      this.clearSession();
      return null;
    }
  }

  // ==================== SETTINGS ====================
  private static isCloudSyncInitialized = false;

  /**
   * Ronda 19 (BUG-5 del informe): secreto aleatorio por colegio generado en el PRIMER
   * arranque y persistido de inmediato. El secreto por defecto del repo es conocido por
   * cualquiera con acceso al código — un carné firmado con él es falsificable. Multidispositivo:
   * el dueño copia el secreto una sola vez desde Ajustes (los secrets NO viajan en el sync,
   * por diseño de safeSettingsCopy). resetToDemo NO rota: no rompe carnés ya impresos.
   */
  static generateRandomSecret(bytes: number = 32): string {
    try {
      const arr = new Uint8Array(bytes);
      crypto.getRandomValues(arr);
      return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return `INAS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`.toUpperCase();
    }
  }

  static getSettings(): SchoolSettings {
    // Ronda 58 (F-10): cache de lectura — getSettings se llama varias veces por
    // render y por escaneo; el parseo repetido era parte de los 6.9 MB/escaneo.
    if (this.readCache.settings !== null) return this.readCache.settings;
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.schoolName) {
          // Merge with defaults for any newly introduced keys
          const merged: SchoolSettings = {
            ...DEFAULT_SCHOOL_SETTINGS,
            ...parsed,
            cloudflareWorkerUrl: parsed.cloudflareWorkerUrl || DEFAULT_SCHOOL_SETTINGS.cloudflareWorkerUrl
          };
          // Ronda 58 (F-2): un ajuste persistido SIN qrSecret (o con el default viejo
          // hardcodeado del repo, conocido por cualquiera) se re-genera ALEATORIO aquí.
          // Antes: el merge podía dejar el qrSecret del repo → carnés firmados con un
          // secret público, verificables por cualquiera que leyera el código.
          if (!merged.qrSecret || merged.qrSecret === 'INAS-HMAC-QR-SECRET-COL-2026' || merged.qrSecret === 'PROTOTYPE-HMAC-QR-SECRET-COL-2026') {
            merged.qrSecret = this.generateRandomSecret();
          }
          this.readCache.settings = merged;
          return merged;
        }
      }
    } catch {
      // Ronda 58 (F-10): JSON de ajustes CORRUPTO — antes este camino regeneraba el
      // qrSecret EN SILENCIO y el dispositivo dejaba de verificar TODAS las firmas
      // sin un solo error visible. Ahora se restaura del ESPEJO (llave diminuta,
      // escrita en cada saveSettings, sobrevive a que el JSON grande se corrompa)
      // y el fallo se registra alto; solo sin espejo se genera uno nuevo.
      try {
        const mirror = localStorage.getItem(QRSECRET_MIRROR_KEY);
        if (mirror) {
          console.error('[Settings] JSON corrupto — qrSecret restaurado del espejo (las firmas NO se pierden).');
          const rescued: SchoolSettings = { ...DEFAULT_SCHOOL_SETTINGS, schoolName: 'Institución Educativa Antonia Santos (I.N.A.S)', qrSecret: mirror };
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(rescued)); } catch {}
          this.readCache.settings = rescued;
          return rescued;
        }
      } catch {}
      console.error('[Settings] JSON corrupto y sin espejo de qrSecret — se genera un secret nuevo (Rectoría debe re-sincronizar con Pull).');
    }
    // Primer arranque real (sin ajustes persistidos): qrSecret aleatorio, no el del repo
    const fresh: SchoolSettings = { ...DEFAULT_SCHOOL_SETTINGS, qrSecret: this.generateRandomSecret() };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(fresh)); } catch {}
    try { localStorage.setItem(QRSECRET_MIRROR_KEY, fresh.qrSecret); } catch {}
    this.readCache.settings = fresh;
    return fresh;
  }

  /**
   * Ronda 29 (H-29-1): el doc `school_settings/main` arrastra campos de secretos
   * legados de la era pre-Ronda 16 (p. ej. `cloudflareApiToken` con un valor que ya
   * no es el AUTH_TOKEN del Worker). El merge con la nube reintroducía esos valores
   * y PISABA el token correcto guardado en el dispositivo → 401 en push/pull/excusas
   * en cada re-init (bug observado en QA R29: el Buzón moría con "No autorizado" tras
   * cada re-login). Política vigente desde Ronda 16: los secretos viven SOLO en el
   * localStorage de cada dispositivo; la nube jamás los aporta ni los pisa.
   * Se aplica a TODAS las lecturas de settings provenientes de Firestore.
   */
  private static stripSecretFields(source: Partial<SchoolSettings> | null): Partial<SchoolSettings> {
    if (!source) return {} as Partial<SchoolSettings>;
    const { qrSecret, sessionSecret, cloudflareApiToken, customAiApiKey, ...safe } = source as Record<string, unknown>;
    void qrSecret; void sessionSecret; void cloudflareApiToken; void customAiApiKey;
    return safe as Partial<SchoolSettings>;
  }

  static saveSettings(settings: SchoolSettings, syncToCloud = true): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    // Ronda 58 (F-10): espejo del qrSecret en llave diminuta — sobrevive a la
    // corrupción del JSON grande de settings (y a truncamientos de cuota parciales).
    try { if (settings.qrSecret) localStorage.setItem(QRSECRET_MIRROR_KEY, settings.qrSecret); } catch {}
    this.readCache.settings = settings; // R58 (F-10): write-through
    this.notify(false);

    // Ronda 57 (INV-1): un guardado de ORIGEN LOCAL (con respaldo a la nube pendiente)
    // sella "edición sin subir" — los pulls no pueden pisar estos ajustes hasta que el
    // push exitoso libere el sello. El pull aplica settings con syncToCloud=false
    // exactamente para NO sellar lo que acaba de bajar.
    if (syncToCloud) {
      this.markLocalSyncDirty();
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
          // Ronda 29 (H-29-1): merge SIN secretos — el token correcto del dispositivo prevalece
          const safeCloud = this.stripSecretFields(cloudSettings);
          // If local has empty or default worker URL but cloud has it, or if local is older
          const merged: SchoolSettings = {
            ...DEFAULT_SCHOOL_SETTINGS,
            ...local,
            ...safeCloud,
            cloudflareWorkerUrl: (safeCloud.cloudflareWorkerUrl as string) || local.cloudflareWorkerUrl || DEFAULT_SCHOOL_SETTINGS.cloudflareWorkerUrl
          };
          this.saveSettings(merged, false);
        }
      }).catch(() => {});

      // 2. Real-time listener for multi-device sync
      //    Ronda 29 (H-29-1): idem — el snapshot de Firestore JAMÁS aporta secretos
      //    (el write de saveSchoolSettings dispara este listener con el doc mergeado
      //    que aún contiene el campo legacy cloudflareApiToken).
      FirebaseService.onSchoolSettingsChange((cloudSettings) => {
        if (cloudSettings && (cloudSettings.schoolName || cloudSettings.cloudflareWorkerUrl)) {
          const current = this.getSettings();
          const updated = { ...current, ...this.stripSecretFields(cloudSettings) };
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
            // Ronda 29 (H-29-1): merge SIN secretos (mismo vector de envenenamiento)
            const merged = { ...current, ...this.stripSecretFields(cloudSettings) };
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
    // Ronda 58 (F-10): cache de lectura (invalidado por notify → toda escritura).
    if (this.readCache.students !== null) return this.readCache.students;
    try {
      const stored = localStorage.getItem(STUDENTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.readCache.students = parsed;
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
      // Ronda 27 (entrega limpia): con el anti-seed activo la corrupción NUNCA recupera con
      // demo — se protegió un respaldo `_corrupt_backup_*` y se recupera vacío; el usuario
      // restaura con "Descargar de Cloudflare" (PULL). Regla 6: cero fallback silencioso.
      if (!SEED_DEMO_ON_FIRST_LAUNCH) {
        this.saveStudents([], 'system');
        return [];
      }
      // Auto-recover with demo data if JSON is corrupted
      this.saveStudents(INITIAL_STUDENTS, 'system'); // auto-reparación NO sella
      return INITIAL_STUDENTS;
    }

    // Only seed initial students if key has never been initialized
    if (localStorage.getItem(STUDENTS_KEY) === null) {
      // Ronda 27 (entrega limpia): primer arranque SIN demo — se persiste `[]` explícito
      // (patrón Ronda 14: evita re-disparos del seed) y la app queda lista para importar
      // la matrícula real o crear estudiantes desde cero.
      if (!SEED_DEMO_ON_FIRST_LAUNCH) {
        this.saveStudents([], 'system');
        return [];
      }
      this.saveStudents(INITIAL_STUDENTS, 'system'); // auto-reparación NO sella
      return INITIAL_STUDENTS;
    }
    return [];
  }

  static saveStudents(students: Student[], origin: 'local' | 'cloud' | 'system' = 'local'): void {
    // Ronda 57: solo lo de ORIGEN LOCAL sella "edición sin subir"; el pull escribe con
    // origin:'cloud' (es dato derivado de la nube y no debe bloquear pulls futuros).
    if (origin === 'local') this.markLocalSyncDirty();
    // Ronda 38 (H-38-2): RESPALDO PREVIO anti-pérdida. Antes de sobrescribir la matrícula
    // se conserva una copia SIN fotos (las dataURL son lo que explota la cuota de
    // localStorage; nombres/códigos/grados son lo crítico para reconstruir) en
    // `inas_students_prev_v5`. Así, cualquier truncamiento accidental del almacenamiento
    // (perfil reiniciado, corrupción, bug de terceros) es recuperable de inmediato —
    // lección del incidente de QA Ronda 38 donde el estado local se vació y el push
    // habría pisado la nube si el dispositivo hubiese tenido el token correcto.
    try {
      const current = localStorage.getItem(STUDENTS_KEY);
      if (current && current !== JSON.stringify(students)) {
        const prev: Student[] = JSON.parse(current);
        if (Array.isArray(prev) && prev.length > 0) {
          const light = prev.map(s => ({ ...s, photoUrl: undefined }));
          localStorage.setItem(STUDENTS_PREV_KEY, JSON.stringify(light));
        }
      }
    } catch { /* la cuota o un JSON corrupto nunca deben impedir un guardado */ }
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    this.readCache.students = students; // R58 (F-10): write-through
    this.notify(false);
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
    // Ronda 58 (F-8): una RE-MATRÍCULA con el mismo código desactiva el tombstone
    // local de ese código. Antes el comentario de Ronda 54 decía "se descarta el
    // tombstone al re-crear" pero NADIE llamaba a clearTombstones → el código
    // re-matriculado quedaba muerto para siempre en la nube (el Worker filtraba
    // por id sin comparar fechas y la unión de tombstones lo re-añadía).
    this.clearTombstones([student.code], 'student');
    return { success: true };
  }

  // ==================== RONDA 58 (F-23/F-18) — VERIFICACIÓN DE CREDENCIAL ====================
  // Punto ÚNICO de verificación de la clave de acceso del estudiante, usado por
  // LoginScreen y el Portal del Estudiante. Acepta:
  //   1. La clave en claro SI este dispositivo la tiene (ficha local de Rectoría o
  //      fichas creadas aquí) — comparación directa.
  //   2. El VERIFICADOR HMAC (tempPasswordVerifier = HMAC(qrSecret, "code|password"))
  //      que viaja en el snapshot desde R58 EN LUGAR de la clave en claro — es lo
  //      único que tienen los terminales que recibieron la ficha por sync.
  // Tolerancia a rotación: prueba qrSecret Y legacyQrSecret (el secret anterior).
  // SIN fallback: una ficha sin clave ni verificador NO deja pasar a nadie
  // (antes: el portal aceptaba 'SJ-2026'/'colegio2026'/el propio código — F-24).
  static async verifyStudentCredential(student: { code: string; tempPassword?: string; tempPasswordVerifier?: string }, password: string): Promise<{ ok: boolean; reason: 'OK' | 'no_credential' | 'no_key' | 'mismatch'; message?: string }> {
    const pass = String(password || '').trim();
    if (!pass) {
      return { ok: false, reason: 'no_credential', message: 'Ingresa la clave de acceso impresa en el reverso del carné.' };
    }
    // 1) Clave en claro local (si existe). Una clave personalizada en OTRO dispositivo
    //    puede hacer que la local esté desactualizada → se sigue con el verificador.
    if (student.tempPassword && pass === student.tempPassword) {
      return { ok: true, reason: 'OK' };
    }
    // 2) Verificador HMAC institucional.
    if (student.tempPasswordVerifier) {
      const settings = this.getSettings();
      const secrets = [settings.qrSecret, settings.legacyQrSecret].filter((s): s is string => !!s);
      if (secrets.length === 0) {
        return { ok: false, reason: 'no_key', message: 'Este dispositivo no tiene la clave institucional configurada. Sincroniza (Ajustes → Sync y Seguridad → Descargar Pull) e inténtalo de nuevo.' };
      }
      for (const secret of secrets) {
        const expected = await generateHmacSignature(`${student.code}|${pass}`, secret);
        if (expected === student.tempPasswordVerifier) {
          return { ok: true, reason: 'OK' };
        }
      }
    }
    if (!student.tempPassword && !student.tempPasswordVerifier) {
      return { ok: false, reason: 'no_credential', message: 'Este estudiante no tiene clave de acceso asignada. Solicítala en Rectoría (Carnés → Emitir/Reimprimir clave).' };
    }
    return { ok: false, reason: 'mismatch', message: 'Credenciales incorrectas. Verifica el código y la clave, o solicita una nueva clave en Rectoría.' };
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
      // Ronda 54 (hueco #5): crear TOMBSTONE para que el borrado se PROPAGUE a la nube y no
      // "resucite" en otro dispositivo al hacer pull. No se borra el dato: se marca eliminado.
      this.addTombstone(code, 'student');

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

  // ==================== Ronda 54 (hueco #5): TOMBSTONES / SOFT-DELETE ====================
  // Lista durable de marcas de borrado { id, type: 'student'|'teacher', deletedAt }. Viaja en
  // el push (el Worker la conserva en el snapshot) y hace que una entidad eliminada en un
  // terminal NUNCA RESUCITE en otro al hacer pull. La entidad puede reaparecer si alguien la
  // re-crea (p. ej. re-importación de matrícula): se descarta el tombstone al re-crear.
  static getTombstones(): Array<{ id: string; type: 'student' | 'teacher'; deletedAt: string }> {
    try {
      const stored = localStorage.getItem(TOMBSTONES_KEY);
      const list = stored ? JSON.parse(stored) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  static saveTombstones(tombstones: Array<{ id: string; type: 'student' | 'teacher'; deletedAt: string }>): void {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
    this.notify();
  }

  /** Marca una entidad como borrada (idempotente: no duplica). */
  static addTombstone(id: string, type: 'student' | 'teacher'): void {
    const list = this.getTombstones();
    if (list.some(t => t.id === id && t.type === type)) return;
    list.push({ id, type, deletedAt: new Date().toISOString() });
    this.saveTombstones(list);
  }

  /** Descarta los tombstones de entidades vuelto a existir (re-importación). */
  static clearTombstones(ids: string[], type: 'student' | 'teacher'): void {
    const idset = new Set(ids);
    this.saveTombstones(this.getTombstones().filter(t => !(t.type === type && idset.has(t.id))));
  }

  // ==================== RONDA 57 — SELLO DE EDICIÓN LOCAL SIN SUBIR ====================
  // Invariante del propietario: "si lo local está un poquito más adelantado, la nube NO
  // lo puede pisar". Todo guardado de ORIGEN LOCAL sella la fecha (dirty); el sello se
  // libera cuando el push termina en éxito (lo local ya vive en la nube). Los pulls
  // consultan este sello para no revertir trabajo local aún no subido.

  static markLocalSyncDirty(): void {
    try { localStorage.setItem(LOCAL_SYNC_DIRTY_KEY, new Date().toISOString()); } catch { /* cuota: el sello es best-effort */ }
  }

  /** Fecha de la última edición local sin subir, o null si todo lo local ya está en la nube. */
  static getLocalSyncDirty(): string | null {
    try { return localStorage.getItem(LOCAL_SYNC_DIRTY_KEY); } catch { return null; }
  }

  static clearLocalSyncDirty(): void {
    try { localStorage.removeItem(LOCAL_SYNC_DIRTY_KEY); } catch { /* noop */ }
  }

  /**
   * Ronda 57 (INV-4): aplica a la matrícula/directorio LOCAL los tombstones que vienen
   * de la nube y los UNE a la lista local. Cierra el hueco del UPSERT (que añade y
   * actualiza pero jamás borra): el estudiante/docente que Rectoría eliminó desaparece
   * también en los teléfonos scopeados y NO resucita por un push posterior del propio
   * terminal. Escritura DIRECTA (sin markLocalSyncDirty): es un cambio DERIVADO de la
   * nube, no una edición local — no debe bloquear pulls futuros.
   */
  static applyCloudTombstones(tombs: Array<{ id: string; type: 'student' | 'teacher'; deletedAt?: string }>): { studentsRemoved: number; teachersRemoved: number; merged: number } {
    if (!Array.isArray(tombs) || tombs.length === 0) return { studentsRemoved: 0, teachersRemoved: 0, merged: 0 };
    const stIds = new Set<string>(tombs.filter(t => t && t.type === 'student').map(t => String(t.id)));
    const tcIds = new Set<string>(tombs.filter(t => t && t.type === 'teacher').map(t => String(t.id)));
    let studentsRemoved = 0;
    let teachersRemoved = 0;
    if (stIds.size > 0) {
      const students = this.getStudents();
      const filtered = students.filter(s => !stIds.has(String(s.code)));
      studentsRemoved = students.length - filtered.length;
      if (studentsRemoved > 0) {
        localStorage.setItem(STUDENTS_KEY, JSON.stringify(filtered));
        this.notify();
      }
    }
    if (tcIds.size > 0) {
      const teachers = this.getTeachers();
      const filtered = teachers.filter(t => !tcIds.has(String(t.id)));
      teachersRemoved = teachers.length - filtered.length;
      if (teachersRemoved > 0) {
        localStorage.setItem(TEACHERS_KEY, JSON.stringify(filtered));
        this.notify();
      }
    }
    const keyOf = (t: { id: string; type: string }) => `${t.type}:${t.id}`;
    const map = new Map(this.getTombstones().map(t => [keyOf(t), t]));
    let merged = 0;
    for (const t of tombs) {
      if (!t || !t.id) continue;
      const k = keyOf({ id: String(t.id), type: t.type });
      if (!map.has(k)) {
        map.set(k, { id: String(t.id), type: t.type, deletedAt: t.deletedAt || new Date().toISOString() });
        merged++;
      }
    }
    if (merged > 0) this.saveTombstones(Array.from(map.values()));
    return { studentsRemoved, teachersRemoved, merged };
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
        // Ronda 55: invariante «Dirección de Grupo» ⇔ directorGrade — quien recibe la
        // dirección obtiene TAMBIÉN la asignatura (de ella dependen la tarjeta QR de clase
        // CLASE:v2 y la validación de escaneo C.2/D2: asignatura ∈ teacher.subjects).
        t.subjects = (t.subjects || []).filter(s => s !== 'Dirección de Grupo');
        t.subjects = [...t.subjects, 'Dirección de Grupo'];
        updated = true;
      } else if (t.directorGrade === grade && t.id !== teacherId) {
        t.isGroupDirector = false;
        t.directorGrade = undefined;
        // Ronda 55: quien pierde la dirección pierde la tarjeta derivada (misma fuente de verdad).
        t.subjects = (t.subjects || []).filter(s => s !== 'Dirección de Grupo');
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
    if (this.readCache.teachers !== null) return this.readCache.teachers; // R58 (F-10)
    try {
      const stored = localStorage.getItem(TEACHERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.readCache.teachers = parsed;
          return parsed;
        }
      }
    } catch {
      // Ronda 27: respaldo del JSON corrupto antes de recuperar (jamás borrar sin copia).
      try {
        const raw = localStorage.getItem(TEACHERS_KEY);
        if (raw) localStorage.setItem(`${TEACHERS_KEY}_corrupt_backup_${Date.now()}`, raw);
      } catch {}
    }
    // Ronda 27 (entrega limpia): key null o corrupta → `[]` persistido (sin demo).
    if (!SEED_DEMO_ON_FIRST_LAUNCH) {
      this.saveTeachers([], 'system'); // Ronda 57 (fix hueco #7): auto-reparación NO sella
      return [];
    }
    this.saveTeachers(INITIAL_TEACHERS, 'system');
    return INITIAL_TEACHERS;
  }

  static saveTeachers(teachers: Teacher[], origin: 'local' | 'cloud' | 'system' = 'local'): void {
    if (origin === 'local') this.markLocalSyncDirty(); // Ronda 57
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(teachers));
    this.readCache.teachers = teachers; // R58 (F-10): write-through
    this.notify(false);
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
    // Ronda 58 (F-8): re-crear la ficha desactiva el tombstone local (re-contratación).
    this.clearTombstones([teacher.id], 'teacher');
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
      // Ronda 54 (hueco #5): tombstone para propagar el borrado (no resucita en otro pull).
      this.addTombstone(id, 'teacher');
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

  static saveCustomTemplates(templates: DayTemplateConfig[], origin: 'local' | 'cloud' | 'system' = 'local'): void {
    if (origin === 'local') this.markLocalSyncDirty(); // Ronda 57
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
    // Ronda 22: política confirmada por el propietario — la jornada escolar es de LUNES a VIERNES.
    // dom/sab quedan sin ventana lectiva (fin de semana de descanso). Guard protector: aunque un
    // dato legado día-6 sobreviva en algún rincón, jamás genera jornada ni cierre de asistencia.
    if (dow === 0 || dow === 6) return null;

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

  static async closeDayAttendance(params: { dateStr?: string; forceClose?: boolean; closedBy?: string }): Promise<{ closedAt: string; blocksClosed: number; absentMarked: number; excusedMarked: number; pendingRevision: number; details: Array<{ grade: string; slotId: string; status: string; absent: number; excused: number }> }> {
    const date = params.dateStr || getTodayDateString();
    const slots = this.getScheduleSlots().filter(s => s.type !== 'BREAK' && s.type !== 'LUNCH');
    const grades = Array.from(new Set(this.getStudents().filter(s => s.active).map(s => s.grade)));
    const details: Array<{ grade: string; slotId: string; status: string; absent: number; excused: number }> = [];
    let absentMarked = 0;
    let excusedMarked = 0;
    let pendingRevision = 0;

    // Ronda 21 (spec §4.1): refrescar la protección UNA sola vez por cierre (best-effort:
    // si el Worker no responde, el cache vigente protege y el día se cierra igual).
    await ExcuseService.syncFromWorker();
    const protection = ExcuseService.getProtectionMapForDate(date);

    for (const grade of grades) {
      for (const slot of slots) {
        try {
          const res = this.closeBlockAttendance({
            grade,
            slotId: slot.id,
            subject: slot.name,
            teacherName: params.closedBy || 'Cierre Automático de Jornada',
            dateStr: date,
            forceClose: params.forceClose,
            excuseProtectionMap: protection
          });
          if (res.status === 'CLOSED') {
            absentMarked += res.markedAbsentCount;
            excusedMarked += res.excusedCount;
            details.push({ grade, slotId: slot.id, status: 'CLOSED', absent: res.markedAbsentCount, excused: res.excusedCount });
          } else if (res.status === 'PENDIENTE_REVISION') {
            pendingRevision += 1;
            details.push({ grade, slotId: slot.id, status: 'PENDIENTE_REVISION', absent: 0, excused: 0 });
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

    return { closedAt, blocksClosed: details.filter(d => d.status === 'CLOSED').length, absentMarked, excusedMarked, pendingRevision, details };
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
      const obj: Record<string, StudentPersonalSchedule> = raw ? JSON.parse(raw) : {};
      if (!(obj && typeof obj === 'object')) return {};
      // Ronda 22 (limpieza de huérfanas): entradas día-6 legadas se descartan en lectura;
      // el próximo save (o la sincronización que use este getter) persiste la versión limpia.
      const clean: Record<string, StudentPersonalSchedule> = {};
      let purged = false;
      for (const [code, sched] of Object.entries(obj) as [string, StudentPersonalSchedule][]) {
        if (!sched || !Array.isArray(sched.entries)) { clean[code] = sched; continue; }
        const entries = sched.entries.filter(e => !(e && typeof e.dayOfWeek === 'number' && (e.dayOfWeek < 1 || e.dayOfWeek > 5)));
        if (entries.length !== sched.entries.length) purged = true;
        clean[code] = { ...sched, entries };
      }
      if (purged) {
        try { localStorage.setItem(STUDENT_SCHEDULES_KEY, JSON.stringify(clean)); } catch {}
      }
      return clean;
    } catch {
      return {};
    }
  }

  // Ronda 4 (F5): reemplazo total desde el snapshot de sync (patrón igual que slots/assignments)
  static saveAllStudentSchedules(map: Record<string, StudentPersonalSchedule>, origin: 'local' | 'cloud' | 'system' = 'local'): void {
    if (origin === 'local') this.markLocalSyncDirty(); // Ronda 57
    // Ronda 22: barrera de escritura — un snapshot entrante no puede reintroducir el sábado.
    const clean: Record<string, StudentPersonalSchedule> = {};
    for (const [code, sched] of Object.entries(map && typeof map === 'object' ? map : {})) {
      clean[code] = sched && Array.isArray(sched.entries)
        ? { ...sched, entries: sched.entries.filter(e => !(e && typeof e.dayOfWeek === 'number' && (e.dayOfWeek < 1 || e.dayOfWeek > 5))) }
        : sched;
    }
    localStorage.setItem(STUDENT_SCHEDULES_KEY, JSON.stringify(clean));
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
    // Ronda 22: el sábado NO es día lectivo — se elimina del mapa y se rechaza con mensaje claro.
    const dayMap: Record<string, number> = { lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5 };
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
      if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 5) {
        if (dayOfWeek === 6 || /s[áa]b/.test(dayKey)) {
          errors.push(`Línea ${i + 1}: el sábado no es día lectivo (jornada de lunes a viernes). Usa Lunes…Viernes o 1-5.`);
        } else {
          errors.push(`Línea ${i + 1}: día no reconocido ("${cells[0]}"). Usa Lunes…Viernes o 1-5.`);
        }
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
    if (this.readCache.slots !== null) return this.readCache.slots; // R58 (F-10)
    try {
      const stored = localStorage.getItem(SCHEDULE_SLOTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.readCache.slots = parsed;
          return parsed;
        }
      }
    } catch {}
    this.saveScheduleSlots(DEFAULT_SCHEDULE_SLOTS, 'system'); // Ronda 57 (fix hueco #7): lazy-init NO sella
    return DEFAULT_SCHEDULE_SLOTS;
  }

  static saveScheduleSlots(slots: ScheduleSlot[], origin: 'local' | 'cloud' | 'system' = 'local'): void {
    if (origin === 'local') this.markLocalSyncDirty(); // Ronda 57
    localStorage.setItem(SCHEDULE_SLOTS_KEY, JSON.stringify(slots));
    this.readCache.slots = slots; // R58 (F-10): write-through
    this.notify(false);
  }

  static getScheduleAssignments(): ClassScheduleAssignment[] {
    if (this.readCache.assignments !== null) return this.readCache.assignments; // R58 (F-10)
    try {
      const stored = localStorage.getItem(SCHEDULE_ASSIGNMENTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ClassScheduleAssignment[];
        if (Array.isArray(parsed)) {
          // Ronda 22 (limpieza de huérfanas): la jornada es L–V; toda cátedra día-6 legada se
          // purga en la primera lectura y se persiste el resultado (sin notify para no
          // interrumpir renders — la próxima escritura real ya nace limpia).
          const clean = parsed.filter(a => !(a && typeof a.dayOfWeek === 'number' && (a.dayOfWeek < 1 || a.dayOfWeek > 5)));
          if (clean.length !== parsed.length) {
            try { localStorage.setItem(SCHEDULE_ASSIGNMENTS_KEY, JSON.stringify(clean)); } catch {}
          }
          this.readCache.assignments = clean; // R58 (F-10): persistido == cache
          return clean;
        }
      }
    } catch {
      // Ronda 27: respaldo del JSON corrupto antes de recuperar (jamás borrar sin copia).
      try {
        const raw = localStorage.getItem(SCHEDULE_ASSIGNMENTS_KEY);
        if (raw) localStorage.setItem(`${SCHEDULE_ASSIGNMENTS_KEY}_corrupt_backup_${Date.now()}`, raw);
      } catch {}
    }
    // Ronda 27 (entrega limpia): key null o corrupta → `[]` persistido (sin cátedras demo).
    if (!SEED_DEMO_ON_FIRST_LAUNCH) {
      this.saveScheduleAssignments([], 'system');
      return [];
    }
    this.saveScheduleAssignments(INITIAL_SCHEDULE_ASSIGNMENTS, 'system');
    return INITIAL_SCHEDULE_ASSIGNMENTS;
  }

  static saveScheduleAssignments(assignments: ClassScheduleAssignment[], origin: 'local' | 'cloud' | 'system' = 'local'): void {
    if (origin === 'local') this.markLocalSyncDirty(); // Ronda 57
    localStorage.setItem(SCHEDULE_ASSIGNMENTS_KEY, JSON.stringify(assignments));
    this.readCache.assignments = assignments; // R58 (F-10): write-through
    this.notify(false);
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

  /**
   * Ronda 19 (BUG-1 del informe de testing): primer bloque CLASE que inicia DESPUÉS de la hora
   * dada (o actual). Sirve para redactar el mensaje de `no_active_slot`:
   * "El próximo bloque es la 4ª a las 09:45". Devuelve undefined si no queda ninguno por hoy.
   */
  static getNextUpcomingClassSlot(customTimeStr?: string): ScheduleSlot | undefined {
    const slots = this.getScheduleSlots().filter(s => s.type === 'CLASS');
    const timeStr = customTimeStr || getCurrentTimeString();
    const [h, m] = timeStr.split(':').map(Number);
    const currentMin = h * 60 + m;

    return slots
      .filter(s => {
        const [startH, startM] = s.startTime.split(':').map(Number);
        return startH * 60 + startM > currentMin;
      })
      .sort((a, b) => {
        const [ah, am] = a.startTime.split(':').map(Number);
        const [bh, bm] = b.startTime.split(':').map(Number);
        return (ah * 60 + am) - (bh * 60 + bm);
      })[0];
  }

  /**
   * Ronda 19 (BUG-1): mensaje único y honesto para cuando el reloj NO está dentro de un bloque
   * CLASE (recreo, cambio de salón, antes de la primera hora). Una sola fuente de verdad para
   * los tres puntos de escaneo (terminal, representante, aula docente).
   */
  static buildNoActiveSlotMessage(customTimeStr?: string): string {
    const timeStr = customTimeStr || getCurrentTimeString();
    const next = this.getNextUpcomingClassSlot(timeStr);
    if (next) {
      return `Ahora no hay clase en curso (recreo o transición, ${timeStr}). El próximo bloque es ${next.name} a las ${next.startTime}. El escaneo se habilitará al iniciar ese bloque.`;
    }
    return `Ahora no hay clase en curso (${timeStr}) y no quedan más bloques de clase por hoy. No se registra asistencia por escáner.`;
  }

  // ==================== RATE LIMIT (BUG-3 del informe) ====================
  // Ronda 19: `rateLimitMaxPerMin` existía en Ajustes pero ninguna función lo leía (32/32
  // escaneos en 10 s pasaron). Cola de timestamps en memoria (sesión de la pestaña): cuenta
  // INTENTOS de escaneo del terminal, incluidos los rechazados — detecta lectores USB defectuosos
  // que re-disparan. No persiste: un recargo de página reinicia el contador (aceptable).
  private static scanAttemptTimestamps: number[] = [];

  static checkScanRateLimit(): { limited: boolean; maxPerMin: number; retryAfterSec: number } {
    const settings = this.getSettings();
    const max = settings.rateLimitMaxPerMin && settings.rateLimitMaxPerMin > 0 ? settings.rateLimitMaxPerMin : 30;
    const now = Date.now();
    this.scanAttemptTimestamps = this.scanAttemptTimestamps.filter(t => now - t < 60_000);

    if (this.scanAttemptTimestamps.length >= max) {
      const oldest = this.scanAttemptTimestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000));
      return { limited: true, maxPerMin: max, retryAfterSec };
    }

    this.scanAttemptTimestamps.push(now);
    return { limited: false, maxPerMin: max, retryAfterSec: 0 };
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

  // ==================== IMPORTACIÓN MASIVA DE HORARIOS (Ronda 19 — informe, roadmap #3) ====================
  // Reemplaza al importador legado (código muerto desde su creación, con fallbacks silenciosos:
  // bloque no reconocido → primer bloque CLASE; día no reconocido → lunes). Aquí NADA se
  // adivina: cada ambigüedad es un error de línea con mensaje concreto, estilo del parser del
  // horario personal. Parse (previsualización) y Apply (con borrado escopado opcional) son
  // pasos separados — la rectoría ve qué va a pasar ANTES de aplicar.

  private static normalizeTextForMatch(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  static parseScheduleImport(text: string): ScheduleImportResult {
    const errors: string[] = [];
    const rows: ParsedScheduleRow[] = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      return { rows, errors: ['El archivo o el texto está vacío.'], totalLines: 0, detectedHeader: false, delimiter: ',' };
    }

    // Sniff del delimitador en todo el archivo (Excel en Colombia suele usar ';' o ',')
    const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of text) if (ch in counts) counts[ch]++;
    const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0)
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : ',';

    const splitLine = (l: string): string[] => l.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const norm = this.normalizeTextForMatch;

    // Días: nombre (con/sin tildes, mayúsculas) o número 1-5. Prefijo de 3 letras aceptado.
    // Ronda 22: el sábado se elimina de la jornada — el parser lo rechaza con mensaje explícito.
    const dayByName: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5 };
    const parseDay = (raw: string): number | null => {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
      const key = norm(raw);
      if (!key) return null;
      for (const [name, dow] of Object.entries(dayByName)) {
        if (key.startsWith(name.slice(0, 3))) return dow;
      }
      return null;
    };

    // Grado: normaliza '10-1' / '10.1' / '10 1' → '10°1' y valida contra la matrícula real
    const knownGrades = new Set<string>([...SCHOOL_GRADES_LIST, ...this.getStudents().map(s => s.grade)]);
    const normalizeGrade = (raw: string): string | null => {
      const cleaned = raw.trim().toUpperCase().replace(/\s*[-.\s]\s*/g, '°');
      const m = cleaned.match(/^(\d{1,2})°?([A-Z0-9]{1,3})$/);
      return m ? `${m[1]}°${m[2]}` : null;
    };

    // Bloque: por id exacto → nombre (sin tildes) → ordinal entre los bloques CLASE (1..N)
    const classSlots = this.getScheduleSlots().filter(s => s.type === 'CLASS').sort((a, b) => a.order - b.order);
    const resolveSlot = (raw: string): ScheduleSlot | null => {
      const byId = classSlots.find(s => s.id === raw.trim());
      if (byId) return byId;
      const target = norm(raw);
      const byName = classSlots.find(s => norm(s.name) === target);
      if (byName) return byName;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= classSlots.length) return classSlots[n - 1];
      return null;
    };

    // Docente: coincidencia exacta o por contención (siempre insensible a tildes/mayúsculas)
    const teachers = this.getTeachers();
    const resolveTeacher = (raw: string): { teacherId?: string; teacherName: string } => {
      const target = norm(raw);
      if (!target) return { teacherName: 'Docente Titular' };
      const exact = teachers.find(t => norm(t.fullName) === target || norm(t.username || '') === target);
      if (exact) return { teacherId: exact.id, teacherName: exact.fullName };
      if (target.length >= 4) {
        const partial = teachers.find(t => norm(t.fullName).includes(target) || target.includes(norm(t.fullName)));
        if (partial) return { teacherId: partial.id, teacherName: partial.fullName };
      }
      return { teacherName: raw.trim() };
    };

    // Encabezado: primera celda == 'dia' (norm quita tildes). Si hay, mapea columnas por nombre.
    const headerCells = splitLine(lines[0]).map(norm);
    const detectedHeader = headerCells[0] === 'dia';
    const colIdx = { day: 0, grade: 1, slot: 2, subject: 3, teacher: 4, classroom: 5 };
    if (detectedHeader) {
      const find = (...names: string[]) => headerCells.findIndex(c => names.includes(c));
      colIdx.day = find('dia');
      colIdx.grade = find('grado', 'curso');
      colIdx.slot = find('bloque', 'hora', 'slot');
      colIdx.subject = find('materia', 'asignatura');
      colIdx.teacher = find('docente', 'profesor');
      colIdx.classroom = find('aula', 'salon');
    }

    const dataLines = lines.slice(detectedHeader ? 1 : 0);
    dataLines.forEach((line, idx) => {
      const lineNo = idx + (detectedHeader ? 2 : 1); // numeración humana: encabezado = línea 1
      const cells = splitLine(line);
      const cell = (i: number) => (i >= 0 && i < cells.length ? cells[i] : '');

      const day = parseDay(cell(colIdx.day));
      if (day === null) {
        if (/^\s*6\s*$/.test(cell(colIdx.day)) || /s[áa]b/i.test(cell(colIdx.day))) {
          errors.push(`Línea ${lineNo}: el sábado no es día lectivo (jornada de lunes a viernes). Usa Lunes…Viernes o 1-5.`);
        } else {
          errors.push(`Línea ${lineNo}: día no reconocido ("${cell(colIdx.day)}"). Usa Lunes…Viernes o 1-5.`);
        }
        return;
      }

      const grade = normalizeGrade(cell(colIdx.grade));
      if (!grade) {
        errors.push(`Línea ${lineNo}: grado no reconocido ("${cell(colIdx.grade)}"). Usa el formato del sistema, ej: 10°1.`);
        return;
      }
      if (!knownGrades.has(grade)) {
        errors.push(`Línea ${lineNo}: el grado "${grade}" no existe en la matrícula. Regístralo primero o corrige el CSV.`);
        return;
      }

      const slotRaw = cell(colIdx.slot);
      const slot = resolveSlot(slotRaw);
      if (!slot) {
        errors.push(`Línea ${lineNo}: bloque no reconocido ("${slotRaw}"). Usa el nombre del bloque (ej: "${classSlots[0]?.name || '1ª Hora'}"), su número 1-${classSlots.length} o el id (slot-N).`);
        return;
      }

      const subject = cell(colIdx.subject);
      if (!subject) {
        errors.push(`Línea ${lineNo}: la materia está vacía.`);
        return;
      }

      const teacher = resolveTeacher(cell(colIdx.teacher));
      const classroom = cell(colIdx.classroom) || undefined;

      rows.push({ lineNo, dayOfWeek: day, grade, slotId: slot.id, subject, teacherId: teacher.teacherId, teacherName: teacher.teacherName, classroom });
    });

    return { rows, errors, totalLines: lines.length, detectedHeader, delimiter };
  }

  /**
   * Aplica filas ya validadas de parseScheduleImport. Upsert por (grado, día, bloque).
   * wipeIncludedGrades: borra ANTES las asignaciones actuales SOLO de los cursos que
   * aparecen en el archivo (borrado escopado — jamás toca cursos no incluidos).
   */
  static applyScheduleImport(rows: ParsedScheduleRow[], opts?: { wipeIncludedGrades?: boolean }): { applied: number; removed: number } {
    let removed = 0;
    if (opts?.wipeIncludedGrades && rows.length > 0) {
      const grades = [...new Set(rows.map(r => r.grade))];
      const assignments = this.getScheduleAssignments();
      const kept = assignments.filter(a => !grades.includes(a.grade));
      removed = assignments.length - kept.length;
      this.saveScheduleAssignments(kept);
    }

    let applied = 0;
    for (const row of rows) {
      this.setAssignment({
        dayOfWeek: row.dayOfWeek,
        slotId: row.slotId,
        grade: row.grade,
        subject: row.subject,
        teacherId: row.teacherId,
        teacherName: row.teacherName,
        classroom: row.classroom
      });
      applied++;
    }
    return { applied, removed };
  }

  // ==================== AUTOGESTIÓN DOCENTE (Ronda 19 — informe, roadmap #3.2) ====================
  // El trabajo de cargar horarios se distribuye: cada docente ve y administra SOLO sus
  // cátedras. Guardas de negocio: (1) no puede pisar una celda asignada a OTRO docente;
  // (2) no puede estar en dos cursos al mismo tiempo (checkTeacherConflict).

  static getTeacherOwnAssignments(teacherId: string): ClassScheduleAssignment[] {
    return this.getScheduleAssignments()
      .filter(a => a.teacherId === teacherId)
      .sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || a.slotId.localeCompare(b.slotId));
  }

  /**
   * Crea o actualiza una cátedra del propio docente. Devuelve { ok } o { ok:false, error }
   * con mensaje en español listo para mostrar. Jamás toca celdas de otros docentes.
   */
  static upsertTeacherOwnAssignment(teacher: { id?: string; fullName: string }, params: {
    dayOfWeek: number;
    slotId: string;
    grade: string;
    subject: string;
    classroom?: string;
  }): { ok: boolean; error?: string } {
    const teacherId = teacher.id;
    if (!teacherId) return { ok: false, error: 'Sesión de docente sin identificador; recarga e intenta de nuevo.' };

    const slot = this.getScheduleSlots().find(s => s.id === params.slotId && s.type === 'CLASS');
    if (!slot) return { ok: false, error: 'El bloque seleccionado no es un bloque de clase.' };
    if (params.dayOfWeek < 1 || params.dayOfWeek > 5) return { ok: false, error: 'El día debe ser Lunes (1) a Viernes (5): la jornada escolar no incluye el sábado.' };
    if (!params.subject.trim()) return { ok: false, error: 'La materia no puede estar vacía.' };

    // Guarda 1: la celda (grado, día, bloque) ya tiene cátedra de OTRO docente → no se pisa
    const existing = this.getScheduleAssignments().find(a =>
      a.grade === params.grade && a.slotId === params.slotId && a.dayOfWeek === params.dayOfWeek
    );
    if (existing && existing.teacherId && existing.teacherId !== teacherId) {
      return { ok: false, error: `"${slot.name}" del ${params.grade} ya está asignada a ${existing.teacherName}. Pide a Rectoría que la reasigne.` };
    }

    // Guarda 2: cruce de horario SOLO al OCUPAR una celda nueva. Si la celda ya era suya,
    // actualizar materia/aula no cambia la ocupación espacio-temporal: bloquearlo impediría
    // editar horarios con conflictos heredados del propio dato (p. ej. semillas del demo).
    const isOwnUpdate = !!existing && existing.teacherId === teacherId;
    if (!isOwnUpdate) {
      const conflict = this.checkTeacherConflict({ teacherId, dayOfWeek: params.dayOfWeek, slotId: params.slotId, excludeGrade: params.grade });
      if (conflict?.conflict) {
        return { ok: false, error: `Cruce de horario: ya tienes ${conflict.conflictingSubject} con ${conflict.conflictingGrade} en ${conflict.slotName || 'ese bloque'}.` };
      }
    }

    this.setAssignment({
      dayOfWeek: params.dayOfWeek,
      slotId: params.slotId,
      grade: params.grade,
      subject: params.subject.trim(),
      teacherId,
      teacherName: teacher.fullName,
      classroom: params.classroom,
      id: existing?.id // conserva el id si era suya (actualización)
    });
    return { ok: true };
  }

  static removeTeacherOwnAssignment(teacherId: string, grade: string, slotId: string, dayOfWeek: number): boolean {
    const target = this.getScheduleAssignments().find(a => a.grade === grade && a.slotId === slotId && a.dayOfWeek === dayOfWeek);
    if (!target || target.teacherId !== teacherId) return false; // solo las propias
    this.removeAssignment(grade, slotId, dayOfWeek);
    return true;
  }

  // ==================== ATTENDANCE RECORDS (CLASS BASED) ====================
  static getAllAttendance(): AttendanceRecord[] {
    if (this.readCache.attendance !== null) return this.readCache.attendance; // R58 (F-10)
    try {
      const stored = localStorage.getItem(ATTENDANCE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.readCache.attendance = parsed;
          return parsed;
        }
      }
    } catch {
      // Ronda 27: respaldo del JSON corrupto antes de recuperar (jamás borrar sin copia).
      try {
        const raw = localStorage.getItem(ATTENDANCE_KEY);
        if (raw) localStorage.setItem(`${ATTENDANCE_KEY}_corrupt_backup_${Date.now()}`, raw);
      } catch {}
    }

    // Ronda 27 (entrega limpia): la planilla nace sin registros (sin asistencias demo).
    if (!SEED_DEMO_ON_FIRST_LAUNCH) {
      this.saveAttendance([]);
      return [];
    }
    const initialRecords = this.generateInitialSeededAttendance();
    this.saveAttendance(initialRecords);
    return initialRecords;
  }

  static saveAttendance(records: AttendanceRecord[]): void {
    localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
    // Ronda 58 (F-10): WRITE-THROUGH — el array recién persistido ES el cache
    // válido (mismo contenido que storage). Sin esto, notify() invalidaba y el
    // SIGUIENTE escaneo re-parseaba los ~3 MB de hechos (el costo que F-10 elimina).
    this.readCache.attendance = records;
    this.notify(false);
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

  // ==================== QR DE CLASE — CONTEXTO ACTIVO (Ronda 19) ====================
  /**
   * Devuelve la clase activa del dispositivo, o null si no hay/expiró. NO notifica
   * (puede llamarse durante render): la expiración se limpia perezosamente.
   *
   * Ronda 44 (handoff v2): normaliza AL LEER los contextos persistidos por versiones
   * anteriores del contrato — `activatedBy`/`sourceVersion` → `source`, y v2 sin grado →
   * '*'. Así un dispositivo que activó una tarjeta con el build R43 sigue funcionando
   * sin migración (el contexto es efímero: muere al fin del bloque como máximo).
   */
  static getActiveClass(): ActiveClassContext | null {
    try {
      const raw = localStorage.getItem(ACTIVE_CLASS_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Record<string, unknown> & { slotId?: string; expiresAt?: number };
      // Ronda 43 (v2): el grado ya no es obligatorio — las tarjetas de docente (v2)
      // no lo traen (el grado del registro lo aporta el carné del estudiante).
      if (!stored?.slotId || !stored?.expiresAt) return null;
      if (Date.now() > stored.expiresAt) return null; // expirada: ignorar (anti-replay por diseño)

      const { activatedBy: legacyActivatedBy, sourceVersion: legacySourceVersion, ...rest } = stored as Record<string, unknown> & { activatedBy?: string; sourceVersion?: 'v1' | 'v2' };
      const legacyBy = (legacyActivatedBy || '') as ActiveClassSource | '';
      const source: ActiveClassSource = stored.source as ActiveClassSource
        ?? (legacyBy === 'QR_CLASE_V2' || legacyBy === 'AULA_DOCENTE_V2' || legacyBy === 'AULA_DOCENTE' || legacyBy === 'QR_CLASE'
          ? legacyBy
          : legacySourceVersion === 'v2' ? 'QR_CLASE_V2' : 'QR_CLASE');
      const isV2 = source === 'QR_CLASE_V2' || source === 'AULA_DOCENTE_V2';
      const grade = (rest.grade as string | undefined) ?? (isV2 ? '*' : undefined);
      if (!grade) return null; // v1 sin grado = contexto dañado (la v1 SIEMPRE trae grado)
      return {
        ...(rest as unknown as ActiveClassContext),
        grade,
        source,
        teacherVerified: (rest.teacherVerified as boolean | undefined) ?? (isV2 ? true : undefined)
      };
    } catch {
      return null;
    }
  }

  static clearActiveClass(): void {
    localStorage.removeItem(ACTIVE_CLASS_KEY);
    this.notify();
  }

  /**
   * Activa la clase a partir de un token CLASE:v1 escaneado. Validaciones en orden:
   * firma HMAC → vigencia (expiresAt) → día correcto → asignación vigente.
   * Devuelve un ScanResultFeedback listo para mostrar en cualquiera de los 3 escáneres.
   */
  static async setActiveClassFromToken(token: string, activatedBy: ActiveClassSource = 'QR_CLASE'): Promise<ScanResultFeedback> {
    const settings = this.getSettings();
    const parsed = await parseAndVerifyClassScan(token, settings.qrSecret);

    if (!parsed.isClassToken) {
      return { type: 'error', title: 'Token de clase no reconocido', message: 'El código no corresponde a un QR de Clase (CLASE:v1).', timestamp: new Date().toISOString() };
    }
    if (!parsed.isValidFormat || parsed.grade === undefined || parsed.slotId === undefined || parsed.dayOfWeek === undefined) {
      return { type: 'error', title: 'QR de Clase malformado', message: 'El token CLASE:v1 está incompleto o dañado. Genera la tarjeta de nuevo en Horarios → QR de Clase.', timestamp: new Date().toISOString() };
    }
    if (parsed.isSignatureValid === false || parsed.signature === undefined) {
      return { type: 'error', title: 'QR de Clase con firma inválida', message: 'La firma HMAC no coincide: el QR fue alterado o pertenece a otra institución. No se activó ninguna clase.', timestamp: new Date().toISOString() };
    }
    if (parsed.isExpired) {
      const expiredTime = parsed.expiresAt ? new Date(parsed.expiresAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
      return { type: 'error', title: 'QR de Clase expirado', message: `Este QR venció a las ${expiredTime} (fin del bloque). Imprime o proyecta el QR del bloque actual.`, timestamp: new Date().toISOString() };
    }
    const todayDow = new Date().getDay();
    if (parsed.dayOfWeek !== todayDow) {
      const dayNames: Record<number, string> = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
      return { type: 'error', title: 'QR de otro día', message: `Este QR de Clase es para ${dayNames[parsed.dayOfWeek] || 'otro día'} y hoy es ${dayNames[todayDow]}. Usa la tarjeta del día de hoy.`, timestamp: new Date().toISOString() };
    }

    const slot = this.getScheduleSlots().find(s => s.id === parsed.slotId);
    if (!slot) {
      return { type: 'error', title: 'Bloque inexistente', message: `El QR referencia el bloque "${parsed.slotId}" que ya no existe en la plantilla. Regenera la tarjeta.`, timestamp: new Date().toISOString() };
    }

    const assignment = this.getScheduleAssignments().find(a => a.grade === parsed.grade && a.slotId === parsed.slotId && a.dayOfWeek === parsed.dayOfWeek);
    const ctx: ActiveClassContext = {
      grade: parsed.grade,
      dayOfWeek: parsed.dayOfWeek,
      slotId: slot.id,
      slotName: slot.name,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      subject: assignment?.subject || 'Cátedra General',
      teacherName: assignment?.teacherName || 'Docente Titular',
      classroom: assignment?.classroom,
      activatedAt: new Date().toISOString(),
      expiresAt: parsed.expiresAt!,
      source: activatedBy,
      tokenSignature: parsed.signature
    };

    localStorage.setItem(ACTIVE_CLASS_KEY, JSON.stringify(ctx));
    this.notify();

    return {
      type: 'class_activated',
      title: 'Clase activa en este dispositivo',
      message: `${ctx.subject} · ${ctx.grade} · ${ctx.slotName} (${ctx.slotStartTime}–${ctx.slotEndTime})${ctx.classroom ? ` · ${ctx.classroom}` : ''}. Los próximos escaneos de estudiantes de ${ctx.grade} quedarán vinculados a esta materia.`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Activación directa desde el Aula Docente ("con un toque", sección 5.3 del informe):
   * usa la selección vigente del docente (curso/bloque) y resuelve la asignación.
   */
  static activateClassDirect(grade: string, slotId: string, activatedBy: ActiveClassSource = 'AULA_DOCENTE'): ScanResultFeedback {
    const slot = this.getScheduleSlots().find(s => s.id === slotId);
    if (!slot || slot.type !== 'CLASS') {
      return { type: 'error', title: 'Bloque no apto', message: 'Selecciona un bloque de CLASE para activar la clase.', timestamp: new Date().toISOString() };
    }
    const todayDow = new Date().getDay();
    const expiresAt = bogotaTodayTimeToEpochMs(slot.endTime);
    if (Date.now() > expiresAt) {
      return { type: 'error', title: 'Bloque ya finalizado', message: `${slot.name} terminó a las ${slot.endTime}; no se puede activar una clase vencida.`, timestamp: new Date().toISOString() };
    }
    const assignment = this.getScheduleAssignments().find(a => a.grade === grade && a.slotId === slotId && a.dayOfWeek === (todayDow || 1));
    const ctx: ActiveClassContext = {
      grade,
      dayOfWeek: todayDow || 1,
      slotId: slot.id,
      slotName: slot.name,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      subject: assignment?.subject || 'Cátedra General',
      teacherName: assignment?.teacherName || 'Docente Titular',
      classroom: assignment?.classroom,
      activatedAt: new Date().toISOString(),
      expiresAt,
      source: activatedBy,
      tokenSignature: 'DIRECT-ACTIVATION'
    };
    localStorage.setItem(ACTIVE_CLASS_KEY, JSON.stringify(ctx));
    this.notify();
    return {
      type: 'class_activated',
      title: 'Clase activa en este dispositivo',
      message: `${ctx.subject} · ${ctx.grade} · ${ctx.slotName} (${ctx.slotStartTime}–${ctx.slotEndTime}). Vence a las ${slot.endTime}.`,
      timestamp: new Date().toISOString()
    };
  }

  // ==================== TARJETAS QR DE DOCENTE — v2 (Ronda 43) ====================
  /**
   * Ronda 43 — Activación de una TARJETA DE DOCENTE (protocolo CLASE:v2, mandato del
   * propietario: "cada profesor tenga su tarjeta; no depende del horario").
   *
   * Orden de validación (manual v2 §2.2 + refinamientos Ronda 44):
   *   1. Prefijo/ruteo (el llamador) → 2. Formato (6 partes) → 3. Firma HMAC →
   *   4. Vigencia anual → 5. Docente ACTIVO en la matrícula local (si está; C.3: si NO está,
   *   la tarjeta se ACEPTA con teacherVerified:false — la firma es fresca y la asignatura
   *   viene de la lista institucional del colegio que la emitió) →
   *   6. Asignatura ∈ teacher.subjects SOLO si la ficha trae asignaturas (C.2/D2: una ficha
   *   vacía no prueba obsolescencia — no se rechaza; match por slug) →
   *   7. Bloque CLASE en curso POR RELOJ (capa anti-abuso temporal — reemplaza el check de
   *   día de v1; Refinamiento B) → 8. Enriquecimiento opcional (aula de la cátedra
   *   coincidente, si hay horario).
   *
   * El contexto resultante trae grade:'*': cualquier estudiante activo de CUALQUIER curso
   * se registra con la asignatura/docente de la tarjeta y el GRADO DE SU CARNÉ (§2.3,
   * Refinamiento A).
   */
  static async setActiveTeacherCard(token: string, activatedBy: ActiveClassSource = 'QR_CLASE_V2'): Promise<ScanResultFeedback> {
    const settings = this.getSettings();
    const parsed = await parseAndVerifyTeacherCard(token, settings.qrSecret);

    if (!parsed.isTeacherCard) {
      return { type: 'error', title: 'Tarjeta de docente no reconocida', message: 'El código no corresponde a una Tarjeta QR de Docente (CLASE:v2).', timestamp: new Date().toISOString() };
    }
    if (!parsed.isValidFormat || parsed.teacherId === undefined || parsed.subjectSlug === undefined) {
      return { type: 'error', title: 'Tarjeta de docente malformada', message: 'El token CLASE:v2 está incompleto o dañado. Genera la tarjeta de nuevo en Mis Tarjetas QR (Portal Docente) o en Horarios → QR de Clase (Rectoría).', timestamp: new Date().toISOString() };
    }
    if (parsed.isSignatureValid === false || parsed.signature === undefined) {
      return { type: 'error', title: 'Tarjeta con firma inválida', message: 'La firma HMAC no coincide: la tarjeta fue alterada o pertenece a otra institución. No se activó ninguna clase.', timestamp: new Date().toISOString() };
    }
    if (parsed.isExpired) {
      const expiredDate = parsed.expiresAt ? new Date(parsed.expiresAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      return { type: 'error', title: 'Tarjeta expirada', message: `Esta tarjeta venció el ${expiredDate} (fin del año escolar). Genera una tarjeta nueva.`, timestamp: new Date().toISOString() };
    }

    // (5) Docente en la matrícula local. C.3/D2 (Refinamiento C): NO encontrado ≠ obsoleto —
    // el dispositivo puede no haber sincronizado docentes todavía; la firma es fresca y la
    // asignatura la firmó la institución al emitir la tarjeta → se ACEPTA con
    // teacherVerified:false y la credencial se muestra por su id (cero ambigüedad).
    const teacher = this.getTeachers().find(t => t.id === parsed.teacherId);
    if (teacher && !teacher.active) {
      return { type: 'error', title: 'Docente inactivo', message: `La tarjeta pertenece a ${teacher.fullName}, quien está inactivo en la matrícula actual. Verifica con Rectoría.`, timestamp: new Date().toISOString() };
    }

    // (6) Asignatura ∈ teacher.subjects SOLO si la ficha tiene asignaturas (C.2/D2):
    // con ficha poblada, una tarjeta de asignatura retirada se rechaza con error explícito
    // que lista las vigentes (cero fallbacks); con ficha vacía NO se puede probar
    // obsolescencia → se acepta con el nombre formateado del propio slug firmado.
    let subjectName: string;
    let teacherVerified: boolean;
    if (teacher) {
      const ficha = teacher.subjects || [];
      if (ficha.length > 0) {
        const matchedSubject = ficha.find(s => slugifySubject(s) === parsed.subjectSlug);
        if (!matchedSubject) {
          return {
            type: 'error',
            title: 'Asignatura ya no asignada',
            message: `El docente ${teacher.fullName} ya no dicta "${prettifySubjectSlug(parsed.subjectSlug)}". Genera una tarjeta nueva con: ${ficha.join(', ')}.`,
            timestamp: new Date().toISOString()
          };
        }
        subjectName = matchedSubject;
      } else {
        subjectName = prettifySubjectSlug(parsed.subjectSlug);
      }
      teacherVerified = true;
    } else {
      subjectName = prettifySubjectSlug(parsed.subjectSlug);
      teacherVerified = false;
    }

    // (7) Bloque CLASE en curso POR RELOJ (la capa anti-abuso temporal de v2 — Refinamiento B)
    const activeSlotInfo = this.getCurrentActiveSlot();
    if (!activeSlotInfo || !activeSlotInfo.isWithin) {
      return {
        type: 'no_active_slot' as const,
        title: 'No hay clase en curso',
        message: activeSlotInfo
          ? this.buildNoActiveSlotMessage()
          : 'No hay bloques de clase configurados en la plantilla de jornada activa.',
        timestamp: new Date().toISOString()
      };
    }
    const slot = activeSlotInfo.slot;
    const expiresAt = bogotaTodayTimeToEpochMs(slot.endTime);
    if (Date.now() > expiresAt) {
      return { type: 'error', title: 'Bloque ya finalizado', message: `${slot.name} terminó a las ${slot.endTime}; no se puede activar una clase vencida.`, timestamp: new Date().toISOString() };
    }

    // (8) Enriquecimiento opcional: aula de la cátedra coincidente (docente+asignatura+hoy+bloque)
    const todayDow = new Date().getDay() || 1;
    const enrichment = teacher
      ? this.getScheduleAssignments().find(a =>
          a.teacherId === teacher.id && a.subject === subjectName && a.dayOfWeek === todayDow && a.slotId === slot.id
        )
      : undefined;

    const ctx: ActiveClassContext = {
      grade: '*', // v2: multi-grado — el grado del registro lo aporta el CARNÉ de cada estudiante (Refinamiento A)
      slotId: slot.id,
      slotName: slot.name,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      subject: subjectName,
      teacherName: teacher ? teacher.fullName : `Docente (id ${parsed.teacherId})`,
      teacherId: parsed.teacherId,
      teacherVerified,
      classroom: enrichment?.classroom,
      activatedAt: new Date().toISOString(),
      expiresAt,
      source: activatedBy,
      tokenSignature: parsed.signature
    };
    localStorage.setItem(ACTIVE_CLASS_KEY, JSON.stringify(ctx));
    this.notify();

    return {
      type: 'class_activated',
      title: 'Clase activa en este dispositivo',
      message: `${ctx.subject} · ${ctx.teacherName} · ${ctx.slotName} (${ctx.slotStartTime}–${ctx.slotEndTime})${ctx.classroom ? ` · ${ctx.classroom}` : ''}.${teacherVerified ? '' : ' (Docente no registrado en este dispositivo: tarjeta aceptada por su firma válida.)'} Los próximos escaneos (cualquier curso, el grado lo aporta cada carné) quedan vinculados a esta asignatura hasta las ${slot.endTime}.`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Ronda 43 — Variante v2 del 1-toque en Aula Docente: el docente elige una de SUS
   * asignaturas (de teacher.subjects) y se activa SIN escanear nada (el dispositivo es
   * suyo). Mismo bloque-por-reloj que la tarjeta escaneada. NO depende del horario:
   * funciona con la matrícula sola. La variante v1 (activateClassDirect, por cátedra
   * grado+bloque) se conserva intacta.
   */
  static activateTeacherSubjectDirect(teacherId: string, subject: string, activatedBy: ActiveClassSource = 'AULA_DOCENTE_V2'): ScanResultFeedback {
    const teacher = this.getTeachers().find(t => t.id === teacherId);
    if (!teacher) {
      return { type: 'error', title: 'Docente no encontrado', message: 'No existe la ficha del docente en la matrícula local. Haz un Pull en Ajustes → Sync y Seguridad.', timestamp: new Date().toISOString() };
    }
    const matchedSubject = (teacher.subjects || []).find(s => s === subject);
    if (!matchedSubject) {
      return { type: 'error', title: 'Asignatura no vigente', message: `"${subject}" no está en la ficha de ${teacher.fullName}. Genera la tarjeta de nuevo si la asignatura cambió.`, timestamp: new Date().toISOString() };
    }

    const activeSlotInfo = this.getCurrentActiveSlot();
    if (!activeSlotInfo || !activeSlotInfo.isWithin) {
      return {
        type: 'no_active_slot' as const,
        title: 'No hay clase en curso',
        message: activeSlotInfo
          ? this.buildNoActiveSlotMessage()
          : 'No hay bloques de clase configurados en la plantilla de jornada activa.',
        timestamp: new Date().toISOString()
      };
    }
    const slot = activeSlotInfo.slot;
    const expiresAt = bogotaTodayTimeToEpochMs(slot.endTime);
    if (Date.now() > expiresAt) {
      return { type: 'error', title: 'Bloque ya finalizado', message: `${slot.name} terminó a las ${slot.endTime}; no se puede activar una clase vencida.`, timestamp: new Date().toISOString() };
    }

    const todayDow = new Date().getDay() || 1;
    const enrichment = this.getScheduleAssignments().find(a =>
      a.teacherId === teacher.id && a.subject === matchedSubject && a.dayOfWeek === todayDow && a.slotId === slot.id
    );

    const ctx: ActiveClassContext = {
      grade: '*', // v2: multi-grado — el grado del registro lo aporta el CARNÉ de cada estudiante (Refinamiento A)
      slotId: slot.id,
      slotName: slot.name,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      subject: matchedSubject,
      teacherName: teacher.fullName,
      teacherId: teacher.id,
      teacherVerified: true, // 1-toque: el docente SIEMPRE existe en la matrícula local (se resolvió arriba)
      classroom: enrichment?.classroom,
      activatedAt: new Date().toISOString(),
      expiresAt,
      source: activatedBy,
      tokenSignature: 'DIRECT-ACTIVATION-V2'
    };
    localStorage.setItem(ACTIVE_CLASS_KEY, JSON.stringify(ctx));
    this.notify();
    return {
      type: 'class_activated',
      title: 'Clase activa en este dispositivo',
      message: `${ctx.subject} · ${teacher.fullName} · ${ctx.slotName} (${ctx.slotStartTime}–${ctx.slotEndTime}). Vence a las ${slot.endTime}.`,
      timestamp: new Date().toISOString()
    };
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
    teacherId?: string; // Ronda 43 (v2): atribución exacta del docente de la tarjeta — campo aditivo
    contextSource?: 'QR_CLASE' | 'HORA'; // Ronda 19: QR de Clase → 'QR_CLASE'; inferencia por reloj → 'HORA'
    classQrVerified?: boolean;
    presenceCapture?: 'CARD_SCAN' | 'CLASS_UNLOCK_AUTO'; // Ronda 46: método honesto de captura (no es una firma)
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

    // =========================================================================
    // Ronda 58 (F-1) — VERIFICACIÓN DE LA FIRMA DEL CARNÉ EN EL PUNTO ÚNICO DE
    // REGISTRO. Antes: parseAndVerifyScan calculaba isSignatureValid/isExpired y
    // NADIE los consultaba — un carné forjado (firma de otro secret) o VENCIDO se
    // registraba como asistencia y quedaba en planilla/CSV como "Token QR Firmado
    // (VÁLIDO)" (evidencia forense falsa). Ahora la política del dispositivo decide:
    //
    //   requireSignedCards !== false (DEFAULT):
    //     - UNSIGNED        (código 1D plano / tecleado)     → RECHAZADO
    //     - BAD_SIGNATURE   (firma de otro secret/alterada)  → RECHAZADO
    //     - EXPIRED         (carné vencido)                  → RECHAZADO
    //     - LEGACY_COL_ASIS (formato viejo sin criptografía) → RECHAZADO
    //   requireSignedCards === false (modo legado explícito):
    //     todo se acepta, pero verifiedHmac queda en false salvo firma VÁLIDA —
    //     la planilla/CSV deja de afirmar verificaciones que no ocurrieron.
    //
    // Exención: presenceCapture === 'CLASS_UNLOCK_AUTO' (auto-registro del
    // representante). Su autenticidad NO viene del carné sino del desbloqueo de la
    // TARJETA DE DOCENTE firmada (CLASE:v2); el registro ya documenta honestamente
    // verifiedHmac:false + presenceCapture (Ronda 46) — no es un bypass, es una
    // captura con otra prueba de presencia.
    // =========================================================================
    if (settings.requireSignedCards !== false && params.presenceCapture !== 'CLASS_UNLOCK_AUTO') {
      if (!parsed.isSigned || parsed.isSignatureValid !== true) {
        const motivo = parsed.reason === 'EXPIRED'
          ? 'El carné está VENCIDO. El estudiante debe solicitar reposición en Rectoría.'
          : parsed.reason === 'BAD_SIGNATURE'
            ? 'La firma HMAC no coincide: carné alterado o emitido por otra institución. Si es un error de configuración, verifica que el qrSecret de este terminal sea el institucional (Ajustes → Sync y Seguridad → Descargar Pull).'
            : parsed.reason === 'LEGACY_COL_ASIS'
              ? 'El carné usa el formato legado COL_ASIS (sin criptografía). Pide el carné digital firmado (QR) en Rectoría.'
              : 'El código escaneado no es un carné firmado (código 1D plano o tecleo manual). Si tu colegio opera con lectores USB de código de barras 1D, desactiva "Exigir carné firmado" en Ajustes → Sync y Seguridad (queda registrado como verificación no criptográfica).';
        return {
          type: 'invalid_signature' as any,
          title: 'Carné no verificado',
          message: motivo,
          timestamp: new Date().toISOString()
        };
      }
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
        if (params.teacherId) existing.teacherId = params.teacherId; // Ronda 43 (v2): atribución aditiva
        if (params.presenceCapture) existing.presenceCapture = params.presenceCapture; // Ronda 46
        existing.notes = `Marcado tardío tras auto-cierre (${currentTime})`;
        this.saveAttendance(allRecords);
        // Ronda 54 (hueco #1): la corrección de un ausente a tardanza también es un HECHO
        // que debe propagarse; se encola como mutación idempotente por id.
        this.enqueueOfflineMutation(existing, `op-mutation-${existing.id}`);

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
      teacherId: params.teacherId, // Ronda 43 (v2): aditivo — registros viejos se leen igual (reportes por teacherName intactos)
      timestamp: new Date().toISOString(),
      date: today,
      time: currentTime,
      type: 'CLASE',
      status: calculatedStatus,
      method: params.method,
      scannedBy: params.scannedBy || 'DOCENTE',
      scannedByName: params.scannedByName,
      scannedByCode: params.scannedByCode,
      // Ronda 58 (F-1): HONESTIDAD FORENSE — verifiedHmac solo es true si la firma
      // criptográfica se verificó de verdad. Antes: `parsed.isSigned` significaba
      // "el texto empieza con IEDSJ:v1:" y un carné FORJADO quedaba en planilla y
      // CSV como "Token QR Firmado (VÁLIDO)".
      notes: params.notes || (
        parsed.isSigned && parsed.isSignatureValid === true
          ? 'Verificado vía Carné Digital HMAC-SHA256'
          : parsed.isSigned
            ? 'Carné firmado SIN verificación válida (política legada: requireSignedCards=false)'
            : 'Escaneado en Aula de Clase (sin firma criptográfica)'
      ),
      verifiedHmac: parsed.isSigned && parsed.isSignatureValid === true,
      synced: true,
      // Ronda 19 — QR de Clase: transparencia de vinculación (planilla + CSV)
      contextSource: params.contextSource || 'HORA',
      classQrVerified: params.classQrVerified,
      presenceCapture: params.presenceCapture // Ronda 46: método honesto de captura (no es una firma)
    };

    allRecords.unshift(newRecord);
    this.saveAttendance(allRecords);
    // Ronda 54 (hueco #1): OUTBOX DURABLE — este hecho capturado se encola para garantizar
    // que llegue a la nube aunque el dispositivo esté offline en ese instante (el push
    // snapshot lo subirá completo, pero el outbox cubre la ventana de reconexión inmediata).
    this.enqueueOfflineMutation(newRecord, `op-mutation-${newRecord.id}`);

    return {
      type: calculatedStatus === 'PUNTUAL' ? 'success_punctual' : 'success_tardy',
      title: calculatedStatus === 'PUNTUAL' ? '¡Asistencia Puntual Registrada!' : '¡Asistencia con Tardanza Registrada!',
      message: `${student.firstName} ${student.lastName} • ${student.grade} • ${resolvedSubject} (${currentSlot.name})`,
      timestamp: newRecord.timestamp,
      student,
      record: newRecord
    };
  }

  /**
   * Ronda 46 - AUTO-REGISTRO DEL REPRESENTANTE al desbloquear el QR de Clase.
   *
   * El representante (titular/suplente) o el delegado efímero es a la vez el ESCANEADOR y
   * un ESTUDIANTE que necesita su propia asistencia. Hasta ahora, al escanear la tarjeta
   * del docente (CLASE:v2) o la tarjeta de pizarra (CLASE:v1) solo se ACTIVABA el contexto:
   * el rep quedaba registrando a sus compañeros pero NADIE lo registraba a él. Cuando el
   * cierre de bloque marca ausentes (presentCount > 0 => ya NO aplica la Regla de Oro de
   * 0 escaneos), el rep caia como AUSENTE pese a estar presente (quien activa la clase está
   * en el aula) - y la regla del 30% solo evita el problema si el rep es de los pocos
   * escaneados (rectángulo PENDIENTE_REVISION), no en el caso normal.
   *
   * SOLUCIÓN: reutiliza registerClassScan como punto único => hereda la unicidad
   * estudiante+día+bloque (si ya se escaneó, devuelve already_scanned y no duplica), el
   * cálculo PUNTUAL/TARDANZA con grace, contextSource:'QR_CLASE' y la atribución teacherId.
   * El grado SIEMPRE es el del carné del representante; el bloque sale del RELOJ primero.
   *
   * CASCADA REAL (A5): la autoridad se resuelve con getScannerAuthority (Titular → Suplente →
   * Efímero), no con un booleano. Si el escaneador NO es un representante autorizado para su
   * grado, NO se auto-registra (la activación de la clase ya ocurrió y no debe revertirse) —
   * se informa sin bloquear el flujo.
   *
   * HONESTIDAD FORENSE: NO se sintetiza un carné y NO se pone verifiedHmac:true a mano. El
   * auto-registro se documenta con presenceCapture:'CLASS_UNLOCK_AUTO' (presencia real: quien
   * desbloquea la clase está en el aula); verifiedHmac queda en false y classQrVerified refleja
   * si la tarjeta que desbloqueó pasó HMAC.
   *
   * @param studentCode  código del representante (su carné personal)
   * @param method       método con que se desbloqueó la tarjeta (CAMERA/USB/MANUAL)
   */
  static async registerRepresentativeSelf(studentCode: string, method: AttendanceMethod = 'CAMERA'): Promise<ScanResultFeedback> {
    const activeClass = this.getActiveClass();
    if (!activeClass) {
      return { type: 'error', title: 'No hay clase activa', message: 'Escanea la tarjeta del docente (QR de Clase) para activar la clase antes de pasar lista. El representante se registra automaticamente al desbloquearla.', timestamp: new Date().toISOString() };
    }
    const student = this.getStudentByCodeOrDoc(studentCode);
    if (!student) {
      return { type: 'not_found', title: 'Representante no encontrado', message: 'No existe ningun estudiante registrado con el codigo: ' + studentCode + '.', timestamp: new Date().toISOString() };
    }
    if (!student.active) {
      return { type: 'error', title: 'Representante inactivo', message: 'El estudiante ' + student.firstName + ' ' + student.lastName + ' esta inactivo en la matricula.', timestamp: new Date().toISOString(), student };
    }

    // Bloque del RELOJ primero (igual que la rama v2 de registerScan); solo usa el bloque
    // de activacion si el reloj esta fuera de un bloque.
    const slotInfo = this.getCurrentActiveSlot();
    const slotId = slotInfo?.isWithin ? slotInfo.slot.id : activeClass.slotId;

    // A5 — CASCADA REAL de sub-roles: resuelve Titular → Suplente → Efímero. No autorizado
    // => no auto-registrar (flujo informativo, la activación ya ocurrió).
    const authority = this.getScannerAuthority(student.code, student.grade, slotId);
    if (!authority.authorized) {
      return {
        type: 'error',
        title: 'Sin autoridad de escaneo',
        message: `${student.firstName} ${student.lastName} no figura como representante (titular, suplente o delegado efímero) de ${student.grade}. La clase quedó activa, pero el auto-registro no aplica.`,
        timestamp: new Date().toISOString(),
        student
      };
    }

    // Coherencia de grado: el auto-registro SOLO aplica si la clase activa corresponde al
    // grado del representante. v2 es multi-grado ('*' — el grado lo aporta cada carné);
    // v1 es de un curso concreto y debe ser EXACTAMENTE el suyo. Evita registrar al rep en
    // un curso ajeno (p. ej. si por error se desbloqueó la planilla de otra sección).
    if (!isActiveClassV2(activeClass) && activeClass.grade !== student.grade) {
      return {
        type: 'error',
        title: 'Clase de otro grado',
        message: `La clase activa es de ${activeClass.grade} y ${student.firstName} ${student.lastName} pertenece a ${student.grade}. El auto-registro solo aplica a su propio curso.`,
        timestamp: new Date().toISOString(),
        student
      };
    }

    // classQrVerified honesto: true solo si la tarjeta que desbloqueó fue un QR firmado
    // (no aplica para activación directa de Aula Docente, cuyo tokenSignature es un marcador).
    const qrSigned = activeClass.source === 'QR_CLASE' || activeClass.source === 'QR_CLASE_V2';

    return this.registerClassScan({
      scanInput: student.code,
      method,
      slotId,
      grade: student.grade,
      subject: activeClass.subject,
      teacherName: activeClass.teacherName,
      teacherId: activeClass.teacherId,
      scannedBy: authority.role,
      scannedByName: `${student.firstName} ${student.lastName} (${scannedByRoleLabel(authority.role)}, auto-registro)`,
      scannedByCode: student.code,
      contextSource: 'QR_CLASE',
      classQrVerified: qrSigned,
      presenceCapture: 'CLASS_UNLOCK_AUTO',
      notes: `Auto-registro del representante (${scannedByRoleLabel(authority.role)}) al desbloquear el QR de Clase`
    });
  }

  // ==================== AUTO-CIERRE & VENTANA PROPORCIONAL ====================

  static closeBlockAttendance(params: {
    grade: string;
    slotId: string;
    subject?: string;
    teacherName?: string;
    dateStr?: string;
    forceClose?: boolean;
    // Ronda 21 (spec §4.1): mapa studentCode → excusa vigente. Si no viene, se lee del
    // cache de excusas (el llamante responsable refresca con syncFromWorker() antes).
    excuseProtectionMap?: Map<string, StudentExcuse>;
  }): {
    status: 'CLOSED' | 'NO_COMPUTABLE' | 'PENDIENTE_REVISION';
    markedAbsentCount: number;
    presentCount: number;
    totalStudents: number;
    // Ronda 21: ausencias cubiertas por excusa NO-Rechazada — AUSENTE + excuse_id
    // (protegidas, §4.1). NO entran en markedAbsentCount (spec: "no entran al X% ni
    // al 'Se marcaron N inasistencias'").
    excusedCount: number;
    reason?: string;
  } {
    const today = params.dateStr || getTodayDateString();
    const students = this.getStudentsByGrade(params.grade).filter(s => s.active);
    const totalStudents = students.length;
    const allRecords = this.getAllAttendance();
    const slots = this.getScheduleSlots();
    const slot = slots.find(s => s.id === params.slotId) || slots[0];
    const protection = params.excuseProtectionMap || ExcuseService.getProtectionMapForDate(today);

    // Verificar si el bloque está marcado como NO COMPUTABLE (Hora libre, acto cívico o día especial)
    const checkNonComp = this.isSlotNonComputable(params.slotId, params.grade, today);
    if (checkNonComp.isNonComputable) {
      return {
        status: 'NO_COMPUTABLE',
        markedAbsentCount: 0,
        excusedCount: 0,
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
        excusedCount: 0,
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
        excusedCount: 0,
        presentCount,
        totalStudents,
        reason: `Solo se registró el ${Math.round(scanRatio * 100)}% del grupo (${presentCount}/${totalStudents}). Requiere confirmación docente para evitar falsos ausentes.`
      };
    }

    // Auto-cierre estándar: Marcar a los estudiantes no registrados como AUSENTES
    let markedAbsentCount = 0;
    let excusedCount = 0;
    const resolvedSubject = params.subject || 'Cátedra General';
    const resolvedTeacher = params.teacherName || 'Docente Titular';

    students.forEach(student => {
      const existing = allRecords.find(r => 
        r.studentCode === student.code && 
        r.date === today && 
        r.slotId === params.slotId
      );

      if (!existing) {
        // Ronda 21 (spec §4.1): ANTES de marcar AUSENTE, consultar la protección.
        // Con excusa → AUSENTE + excuse_id (overlay, jamás "injustificado");
        // sin excusa → AUSENTE puro (comportamiento actual, sin cambios).
        const excuse = protection.get(student.code);
        if (excuse) {
          excusedCount++;
          allRecords.push({
            // Ronda 58 (F-9): ID DETERMINISTA por (fecha, bloque, estudiante, auto-cierre):
            // N dispositivos que cierran el mismo bloque generan EL MISMO id → el merge
            // de la nube los deduplica en vez de SUMAR N series de AUSENTE (planillas
            // infladas). Antes: rec-abs-<Date.now()>-<code> era distinto en cada terminal.
            id: `rec-autoclose-${today}-${slot.id}-${student.code}`,
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
            notes: `Inasistencia automática protegida por excusa (${excuse.status === 'APROBADA' ? 'verificada' : 'bajo revisión'})`,
            excuseId: excuse.id,
            excuseStatus: excuse.status,
            // Ronda 58 (F-1/herencia): JAMÁS verifiedHmac:true en un registro que no
            // pasó por un escaneo de carné — el CSV/reportes no deben afirmar
            // verificación criptográfica que no ocurrió (evidencia probatoria falsa).
            verifiedHmac: false,
            synced: true
          });
          return;
        }
        markedAbsentCount++;
        allRecords.push({
          // Ronda 58 (F-9): id determinista — ver comentario de la rama protegida.
          id: `rec-autoclose-${today}-${slot.id}-${student.code}`,
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
          verifiedHmac: false, // Ronda 58: sin carné escaneado no hay verificación HMAC
          synced: true
        });
      }
    });

    if (markedAbsentCount > 0 || excusedCount > 0) {
      this.saveAttendance(allRecords);
    }

    return { 
      status: 'CLOSED',
      markedAbsentCount, 
      excusedCount,
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
    // Ronda 21 (spec §7.4): excusas no rechazadas protegen la ausencia — el estudiante
    // ve "Excusada" y su % de faltas injustificadas no las cuenta (§1.1).
    const justificados = records.filter(isRecordProtected).length;
    const absentUnjustified = absentCount - justificados;

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
      justificados,
      absentUnjustified,
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
    // Ronda 21 (spec §4.3): 4º número del resumen — ausencias protegidas por excusa
    // no rechazada. NO toca presentes/ausentes (regla de oro §1.1: la excusa no altera
    // el conteo hasta ser RECHAZADA, y entonces el overlay ya se desvinculó).
    const justificados = records.filter(isRecordProtected).length;

    // Ronda 19 (BUG-2 del informe): presentes = ESTUDIANTES ÚNICOS con registro PUNTUAL/TARDANZA.
    // Antes contaba registros; con múltiples bloques el KPI mostraba "PRESENTES HOY: 53" con
    // matrícula de 50. Un Set por studentCode lo hace imposible.
    const totalPresent = new Set(
      records
        .filter(r => r.status === 'PUNTUAL' || r.status === 'TARDANZA')
        .map(r => r.studentCode)
    ).size;

    // Ronda 19 (BUG-2 del informe): tasa = PRESENTES ÚNICOS / MATRÍCULA ACTIVA — la misma
    // semántica del KPI "Presentes Hoy" (antes mezclaba registros; ahora el % y el número
    // del KPI cuentan lo mismo). Sin registros → null (la UI muestra texto honesto);
    // clamp a 100 por si existieran registros de estudiantes ya eliminados de la matrícula.
    // Antes: `a>0 ? 95 : 100` — un 95 hardcodeado que en un día sin escaneos mostraba
    // "95% de asistencia" con 0 presentes.
    const attendanceRate = totalClassesToday > 0 && totalEnrolled > 0
      ? Math.min(100, Math.round((totalPresent / totalEnrolled) * 100))
      : null;

    return {
      totalEnrolled,
      totalClassesToday,
      totalPresent,
      punctualCount,
      tardyCount,
      absentCount,
      justificados,
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
      'Contexto de Vinculación', // Ronda 19: QR de Clase vs inferencia por hora (transparencia del informe, sección 5.3)
      'Justificación', // Ronda 21 (spec §4.3): Bajo revisión | Verificada | (vacío) — misma línea que Contexto
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
      `"${r.verifiedHmac ? 'Token QR Firmado (VÁLIDO)' : (r.presenceCapture === 'CLASS_UNLOCK_AUTO' ? 'Auto-registro por desbloqueo de clase (sin firma)' : (r.method === 'AUTO_CIERRE' ? 'N/A (Auto-Cierre)' : 'Manual / Teclado (N/A)'))}"`,
      `"${r.contextSource === 'QR_CLASE' ? 'QR de Clase (firmado)' : 'Inferencia por hora'}"`,
      `"${justificationLabelOf(r)}"`,
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
  static getOfflineQueue(): OfflineQueueItem[] {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const list = stored ? JSON.parse(stored) : [];
      return Array.isArray(list) ? list.filter((i: any) => i && i.id) : [];
    } catch {
      return [];
    }
  }

  // Ronda 54 (hueco #1): OUTBOX DURABLE + REPLAY ORDENADO + IDEMPOTENCIA.
  //
  // Cada mutación de HECHOS (un registro de asistencia creado/actualizado en un escaneo o un
  // auto-cierre) se ENCOLA aquí con un `opId` estable y el payload completo. Si el dispositivo
  // está offline, la operación queda en la cola durable (localStorage); al volver la red el
  // replayer la re-envía EN ORDEN. Cada opId se deduce en el destino (at-least-once sin
  // duplicar). A diferencia del no-op anterior (que solo hacía `setItem(..., '[]')`), esto
  // garantiza que ningún hecho capturado sin red se pierda ni se duplique al reconectar.
  //
  // EL REPLAY vive en CloudflareSyncService (que sí tiene acceso al Worker): este servicio
  // registra el handler con `registerOnlineReplayHandler`. Si nadie lo registró (p. ej. la
  // app aún no inicializó el sync), la cola queda intacta y se reintenta luego — jamás se borra.
  private static onlineReplayHandler: (() => Promise<void>) | null = null;
  static registerOnlineReplayHandler(handler: () => Promise<void>): void {
    this.onlineReplayHandler = handler;
  }

  /** Encola una mutación de hechos (idempotente por id: no duplica la misma operación). */
  static enqueueOfflineMutation(payload: AttendanceRecord, opId: string): void {
    try {
      const queue = this.getOfflineQueue();
      const existingIdx = queue.findIndex(i => i.id === payload.id);
      const item: OfflineQueueItem = {
        id: payload.id,
        studentCode: payload.studentCode,
        timestamp: payload.timestamp,
        slotId: payload.slotId,
        subject: payload.subject,
        method: payload.method,
        retryCount: 0,
        opId,
        payload,
        status: 'PENDING'
      };
      if (existingIdx >= 0) queue[existingIdx] = item; // reemplaza (la versión más nueva)
      else queue.unshift(item);                        // orden de captura
      // Conservar solo los últimos 2000 (la cola no debe crecer sin límite).
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(0, 2000)));
      // R58 (F-10): la cola offline NO toca las colecciones cacheadas → notifica sin
      // invalidar (antes, cada escaneo invalidaba el cache de asistencia y el
      // SIGUIENTE escaneo re-parseaba ~3 MB).
      this.notify(false);
    } catch { /* la cola jamás debe romper la captura del escaneo */ }
  }

  /** Marca una operación de la cola como enviada (dedup) para no reenviarla. */
  static markOfflineQueueSent(id: string, appliedAt?: string): void {
    try {
      const queue = this.getOfflineQueue();
      const idx = queue.findIndex(i => i.id === id);
      if (idx >= 0) {
        queue[idx] = { ...queue[idx], status: 'SENT', appliedAt: appliedAt || new Date().toISOString() };
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        this.notify();
      }
    } catch { /* best-effort */ }
  }

  /** Marca una operación como fallida (retryCount++) para reintentarla después. */
  static markOfflineQueueFailed(id: string): void {
    try {
      const queue = this.getOfflineQueue();
      const idx = queue.findIndex(i => i.id === id);
      if (idx >= 0) {
        queue[idx] = { ...queue[idx], status: 'FAILED', retryCount: (queue[idx].retryCount || 0) + 1 };
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        this.notify();
      }
    } catch { /* best-effort */ }
  }

  /**
   * Ronda 54 (hueco #1): replayer del outbox. Reenvía las operaciones PENDING/FAILED en orden
   * a través del handler registrado (CloudflareSyncService). Con las mismas garantías de
   * idempotencia que el resto del sync. Ya no es un no-op.
   */
  static async syncOfflineQueue(): Promise<void> {
    // Experiencia: al volver la red, un escaneo de la cola desvía al replayer real del worker
    const queue = this.getOfflineQueue().filter(i => i.status !== 'SENT');
    if (queue.length === 0) return;
    if (this.onlineReplayHandler) {
      try {
        await this.onlineReplayHandler();
      } catch {
        /* el replayer falló: la cola queda intacta para el siguiente intento */
      }
    }
  }

  static async registerScan(params: {
    scanInput: string;
    method?: any;
    scanType?: any;
    customStatus?: any;
    notes?: string;
  }): Promise<any> {
    // Look up student FIRST (necesario tanto para el emparejamiento del QR de Clase
    // como para el grade del fallback clásico)
    const settings = this.getSettings();
    const parsed = await parseAndVerifyScan(params.scanInput, settings.qrSecret);
    const students = this.getStudents();
    const student = students.find(s =>
      s.code === parsed.studentCode ||
      s.documentId === parsed.studentCode ||
      (parsed.documentId && s.documentId === parsed.documentId)
    );

    // Ronda 19 — QR DE CLASE: si hay una clase activa en el dispositivo y el carné pertenece
    // a ese curso, el contexto lo aporta el QR (materia/bloque exactos), no el reloj — la
    // misma semántica de los sistemas de control de acceso modernos. Grados distintos usan
    // la lógica clásica (el contexto es una lente, no una puerta).
    const activeClass = this.getActiveClass();

    // Ronda 43 — v2 (Tarjeta de Docente): SIN gate de grado. CUALQUIER estudiante activo de
    // cualquier curso se registra con la asignatura/docente FIRMADOS en la tarjeta y el
    // GRADO DE SU CARNÉ (el estudiante lo trae consigo) — mandato del propietario.
    // El v1 conserva su gate de grado (compatibilidad).
    // Ronda 44 (Refinamiento A.2 del handoff): el slotId del registro sale del RELOJ primero
    // (getCurrentActiveSlot) y solo usa el bloque de activación si el reloj está fuera de
    // un bloque — el bloque es un dato del RELOJ, igual que el grado es un dato del carné.
    if (activeClass && isActiveClassV2(activeClass) && student) {
      const slotInfo = this.getCurrentActiveSlot();
      return this.registerClassScan({
        scanInput: params.scanInput,
        method: params.method || 'CAMERA',
        slotId: slotInfo?.isWithin ? slotInfo.slot.id : activeClass.slotId,
        grade: student.grade,
        subject: activeClass.subject,
        teacherName: activeClass.teacherName,
        teacherId: activeClass.teacherId,
        scannedBy: 'DOCENTE',
        scannedByName: 'Terminal Escolar Principal',
        notes: params.notes,
        contextSource: 'QR_CLASE',
        classQrVerified: true
      });
    }

    if (activeClass && student && student.grade === activeClass.grade) {
      return this.registerClassScan({
        scanInput: params.scanInput,
        method: params.method || 'CAMERA',
        slotId: activeClass.slotId,
        grade: student.grade,
        subject: activeClass.subject,
        teacherName: activeClass.teacherName,
        scannedBy: 'DOCENTE',
        scannedByName: 'Terminal Escolar Principal',
        notes: params.notes,
        contextSource: 'QR_CLASE',
        classQrVerified: true
      });
    }

    // Ronda 19 (BUG-1 del informe de testing): si el reloj NO está dentro de un bloque CLASE
    // (recreo, cambio de salón, antes de la primera hora) NO se registra nada. Antes:
    // `activeSlotInfo?.slot.id || 'slot-1'` inyectaba la 1ª Hora y el estudiante aparecía
    // "tardando a una clase que terminó hace 2 horas", contaminando la planilla.
    const activeSlotInfo = this.getCurrentActiveSlot();
    if (!activeSlotInfo || !activeSlotInfo.isWithin) {
      return {
        type: 'no_active_slot' as const,
        title: 'No hay clase en curso',
        message: activeSlotInfo
          ? this.buildNoActiveSlotMessage()
          : 'No hay bloques de clase configurados en la plantilla de jornada activa.',
        timestamp: new Date().toISOString()
      };
    }
    const slotId = activeSlotInfo.slot.id;
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
    localStorage.removeItem(ACTIVE_CLASS_KEY); // Ronda 19: el reset también apaga la clase activa
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
            verifiedHmac: false, // Ronda 58: datos demo sembrados — no pasaron por escaneo firmado
            synced: true,
            notes: isAbsent ? 'Inasistencia no justificada' : (isLate ? 'Ingreso tardío al aula' : 'Asistencia en aula verificada')
          });
        });
      });
    });

    return records;
  }
}
