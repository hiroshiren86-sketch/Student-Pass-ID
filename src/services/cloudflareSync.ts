import { Student, Teacher, AttendanceRecord, ClassScheduleAssignment, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from './attendanceStorage';
import { compressDataUrl, PHOTO_DATAURL_SOFT_LIMIT } from '../utils/imageCompressor';

export interface CloudflareSyncResult {
  success: boolean;
  timestamp: string;
  syncedRecordsCount: number;
  syncedStudentsCount: number;
  message: string;
  target: 'Cloudflare Worker';
  details?: any;
}

/**
 * Ronda 16 (auditoría integral): arquitectura de sincronización SIMPLIFICADA y SEGURA.
 *
 * ANTES (Rondas 10-15 del agente anterior — eliminado):
 *  - Push/pull con FALLBACK a la API REST de D1 desde el navegador (token D1:Edit
 *    expuesto en el cliente + SQL por interpolación) — anti-patrón documentado:
 *    las credenciales de API NUNCA deben vivir en el frontend; el backend (Worker)
 *    es el único que habla con la base de datos.
 *  - Fallback "Local Cloudflare Cache" que reportaba ÉXITO guardando en localStorage
 *    sin haber salido del dispositivo (éxito falso).
 *  - `wipeCloudflareData()` con DELETE FROM ... ejecutado desde el navegador.
 *  - Truncado SILENCIOSO de fotos grandes.
 *
 * AHORA (única ruta canónica):
 *  Cliente → Cloudflare Worker (URL configurable, Authorization: Bearer AUTH_TOKEN opcional)
 *  El Worker (sincronizado con GitHub vía wrangler.toml) es el ÚNICO con acceso a D1/KV.
 *  Sin token configurado en el Worker, el acceso queda abierto (decisión pendiente del
 *  propietario; ver AGENTS.md). Las fotos grandes se COMPRIMEN on-the-fly antes de
 *  viajar; si una foto es irrecuperable se omite con AVISO EXPLÍCITO en el resultado
 *  (nunca en silencio). Los secretos locales (qrSecret, sessionSecret, tokens, clave IA)
 *  NUNCA viajan en el payload.
 */
export class CloudflareSyncService {
  private static autoSyncTimer: any = null;

  /**
   * Inicializa el servicio de sincronización automática periódica con Cloudflare
   */
  static initAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }

    const settings = AttendanceStorageService.getSettings();
    if (settings.cloudflareAutoSync !== false && settings.cloudflareWorkerUrl) {
      const intervalMs = (settings.cloudflareSyncIntervalMinutes || 5) * 60 * 1000;
      this.autoSyncTimer = setInterval(() => {
        this.performCloudflareSync().catch((err) => {
          console.warn('[Cloudflare AutoSync] Sincronización periódica fallida:', err);
        });
      }, intervalMs);
    }
  }

  /** URL base del Worker ya normalizada (sin espacios ni slashes finales) */
  private static getWorkerBaseUrl(): string {
    const settings = AttendanceStorageService.getSettings();
    return (settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
  }

  /** Headers comunes para el Worker (Bearer AUTH_TOKEN opcional) */
  private static workerHeaders(): Record<string, string> {
    const settings = AttendanceStorageService.getSettings();
    const token = (settings.cloudflareApiToken || '').trim();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  /**
   * Realiza un test de conexión en vivo con el Cloudflare Worker (/api/health)
   */
  static async testWorkerConnection(workerUrl?: string, apiToken?: string): Promise<{ success: boolean; message: string; details?: any }> {
    const settings = AttendanceStorageService.getSettings();
    const targetUrl = (workerUrl || settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
    const token = (apiToken || settings.cloudflareApiToken || '').trim();

    if (!targetUrl) {
      return { success: false, message: 'URL del Cloudflare Worker no configurada.' };
    }

    try {
      const healthUrl = targetUrl.endsWith('/api/health') ? targetUrl : `${targetUrl}/api/health`;
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) {
        return { success: false, message: `Worker respondió con error HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        message: `✓ Conexión exitosa con Worker (${data.service || 'Cloudflare Edge'}). D1: ${data.storage?.d1 || 'ok'}, KV: ${data.storage?.kv || 'ok'}.`,
        details: data
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Fallo al contactar el Worker: ${err.message || err}`
      };
    }
  }

  /**
   * Ronda 16: sanea las fotos de estudiantes ANTES del push. Las fotos heredadas sin
   * comprimir (>500 KB de dataURL) se comprimen on-the-fly y se PERSISTEN comprimidas
   * (auto-sanación del dispositivo). Si una foto es irrecuperable se omite y se informa
   * en el mensaje del resultado — jamás en silencio.
   */
  private static async sanitizeStudentsForSync(students: Student[]): Promise<{ clean: Student[]; omitted: string[] }> {
    const omitted: string[] = [];
    const clean: Student[] = [];

    for (const st of students) {
      const photo = st.photoUrl || '';
      if (!photo || photo.length <= PHOTO_DATAURL_SOFT_LIMIT) {
        clean.push(st);
        continue;
      }
      // Foto heredada sin comprimir: comprimir, persistir y usar la versión liviana
      const compressed = await compressDataUrl(photo);
      if (compressed) {
        const fixed = { ...st, photoUrl: compressed };
        AttendanceStorageService.updateStudent(st.code, { photoUrl: compressed });
        clean.push(fixed);
      } else {
        const { photoUrl: _drop, ...rest } = st;
        clean.push(rest as Student);
        omitted.push(`${st.firstName} ${st.lastName} (${st.code})`);
      }
    }

    return { clean, omitted };
  }

  /** Copia de settings SIN secretos para el snapshot (deuda de seguridad de Ronda 4 cerrada) */
  private static safeSettingsCopy(settings: SchoolSettings): SchoolSettings {
    const {
      qrSecret: _qr,
      sessionSecret: _ss,
      cloudflareApiToken: _tok,
      customAiApiKey: _key,
      ...safe
    } = settings;
    return safe as SchoolSettings;
  }

  /**
   * Ejecuta la sincronización de SUBIDA (Push) completa hacia el Cloudflare Worker (D1 / KV)
   */
  static async performCloudflareSync(): Promise<CloudflareSyncResult> {
    const settings = AttendanceStorageService.getSettings();
    const baseUrl = this.getWorkerBaseUrl();
    const timestamp = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (!baseUrl) {
      return {
        success: false,
        timestamp,
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: 'URL del Cloudflare Worker no configurada. Ingrésala en Ajustes → Sincronización en la Nube.',
        target: 'Cloudflare Worker'
      };
    }

    try {
      const students = AttendanceStorageService.getStudents();
      const records = AttendanceStorageService.getAllAttendance();
      const { clean: safeStudents, omitted } = await this.sanitizeStudentsForSync(students);

      const payload = {
        schoolCode: settings.schoolCode || 'INAS_2026',
        schoolName: settings.schoolName || 'Institución Educativa Antonia Santos',
        syncedAt: new Date().toISOString(),
        studentsCount: safeStudents.length,
        recordsCount: records.length,
        data: {
          settings: this.safeSettingsCopy(settings),
          students: safeStudents,
          teachers: AttendanceStorageService.getTeachers(),
          records: records.slice(0, 500), // Últimos 500 registros
          assignments: AttendanceStorageService.getScheduleAssignments(),
          slots: AttendanceStorageService.getScheduleSlots(),
          // Ronda 4 (F1/F5): plantillas CUSTOM de Rectoría + horarios personales opcionales.
          // El worker guarda data verbatim y el pull destructura de forma tolerante →
          // clientes viejos ignoran estos campos sin romperse.
          customTemplates: AttendanceStorageService.getCustomTemplates(),
          studentSchedules: AttendanceStorageService.getAllStudentSchedules()
        }
      };

      const pushUrl = baseUrl.endsWith('/api/sync/push')
        ? baseUrl
        : `${baseUrl}/api/sync/push`;

      const response = await fetch(pushUrl, {
        method: 'POST',
        headers: this.workerHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Worker HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      this.updateLastSync(timestamp);

      const warn = omitted.length > 0
        ? ` ⚠ ${omitted.length} foto(s) omitidas por ser irrecuperables (${omitted.slice(0, 3).join(', ')}${omitted.length > 3 ? '…' : ''}); vuelve a subirlas desde el carné.`
        : '';
      return {
        success: true,
        timestamp,
        syncedRecordsCount: records.length,
        syncedStudentsCount: safeStudents.length,
        message: (data.message || `Sincronización en vivo con Cloudflare D1 & KV completada a las ${timestamp}.`) + warn,
        target: 'Cloudflare Worker',
        details: data
      };
    } catch (err: any) {
      console.warn('Fallo de sincronización con Cloudflare Worker:', err);
      return {
        success: false,
        timestamp,
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: `Error al sincronizar con Cloudflare Worker: ${err.message || err}`,
        target: 'Cloudflare Worker'
      };
    }
  }

  /**
   * Ejecuta la sincronización de BAJADA (Pull) desde el Cloudflare Worker hacia el almacenamiento local
   */
  static async pullFromCloudflare(): Promise<{ success: boolean; message: string; data?: any }> {
    const settings = AttendanceStorageService.getSettings();
    const cleanBaseUrl = this.getWorkerBaseUrl();
    const schoolCode = settings.schoolCode || 'INAS_2026';

    if (!cleanBaseUrl) {
      return {
        success: false,
        message: 'URL del Cloudflare Worker no configurada. Ingrésala en Ajustes → Sincronización en la Nube.'
      };
    }

    try {
      const pullUrl = cleanBaseUrl.endsWith('/api/sync/pull')
        ? `${cleanBaseUrl}?schoolCode=${encodeURIComponent(schoolCode)}`
        : `${cleanBaseUrl}/api/sync/pull?schoolCode=${encodeURIComponent(schoolCode)}`;

      const res = await fetch(pullUrl, {
        method: 'GET',
        headers: this.workerHeaders()
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Worker HTTP ${res.status}: ${errText}`);
      }

      const result = await res.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'No se recibieron datos del Worker');
      }

      const { students, records, teachers, assignments, slots, customTemplates, studentSchedules } = result.data;

      let importedStudents = 0;
      let importedRecords = 0;

      if (Array.isArray(students) && students.length > 0) {
        AttendanceStorageService.saveStudents(students);
        importedStudents = students.length;
      }

      if (Array.isArray(records) && records.length > 0) {
        // Unir registros sin duplicar
        const currentRecords = AttendanceStorageService.getAllAttendance();
        const existingIds = new Set(currentRecords.map(r => r.id));
        const newRecords = records.filter((r: any) => !existingIds.has(r.id));
        const merged = [...currentRecords, ...newRecords];
        AttendanceStorageService.saveAttendance(merged);
        importedRecords = newRecords.length;
      }

      if (Array.isArray(teachers) && teachers.length > 0) {
        AttendanceStorageService.saveTeachers(teachers);
      }

      if (Array.isArray(assignments) && assignments.length > 0) {
        AttendanceStorageService.saveScheduleAssignments(assignments);
      }

      if (Array.isArray(slots) && slots.length > 0) {
        AttendanceStorageService.saveScheduleSlots(slots);
      }

      // Ronda 4 (F5): plantillas CUSTOM y horarios personales viajan en el snapshot.
      if (Array.isArray(customTemplates)) {
        AttendanceStorageService.saveCustomTemplates(customTemplates);
      }
      if (studentSchedules && typeof studentSchedules === 'object' && !Array.isArray(studentSchedules)) {
        AttendanceStorageService.saveAllStudentSchedules(studentSchedules);
      }

      return {
        success: true,
        message: `✓ Datos descargados del Cloudflare Worker: ${importedStudents} estudiantes actualizados y ${importedRecords} nuevas asistencias integradas.`,
        data: result.data
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Error al descargar datos del Cloudflare Worker: ${err.message || err}`
      };
    }
  }

  private static updateLastSync(timeStr: string) {
    const current = AttendanceStorageService.getSettings();
    AttendanceStorageService.saveSettings({
      ...current,
      lastCloudflareSync: `${new Date().toLocaleDateString('es-CO')} ${timeStr}`
    });
  }
}
