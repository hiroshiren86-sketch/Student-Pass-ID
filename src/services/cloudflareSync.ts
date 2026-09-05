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

/** Reporte de purga devuelto por el Worker (filas D1 por tabla + claves KV borradas). */
export interface CloudPurgeReport {
  tables: Record<string, number>;
  kvDeleted: string[];
  message: string;
  note?: string;
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

      // Ronda 29 (H-29-2): /api/health está ABIERTO por diseño (monitor) — un 200 aquí
      // NO valida el token. Se añade una sonda autenticada de SOLO LECTURA (GET
      // /api/excuses, el endpoint más ligero tras health) para distinguir
      // "Worker alcanzable" de "AUTH_TOKEN válido". Sin token → se informa modo abierto.
      let tokenMsg = 'Sin Token de Acceso configurado (el Worker rechazará push/pull/excusas con 401 si tiene AUTH_TOKEN activo).';
      if (token) {
        try {
          const probeUrl = `${targetUrl}/api/excuses?schoolCode=${encodeURIComponent(settings.schoolCode || 'INAS_2026')}`;
          const probe = await fetch(probeUrl, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
          if (probe.ok) {
            tokenMsg = 'Token de Acceso (AUTH_TOKEN) VÁLIDO ✓ — push/pull/excusas autorizados.';
          } else if (probe.status === 401 || probe.status === 403) {
            tokenMsg = `⚠ Token de Acceso INVÁLIDO (HTTP ${probe.status}): el Worker lo rechazará. Revísalo o pégalo de nuevo.`;
          } else {
            tokenMsg = `Sonda de token inconclusa (HTTP ${probe.status}) — revisa la URL/endpoint.`;
          }
        } catch (probeErr: any) {
          tokenMsg = `Sonda de token falló: ${probeErr?.message || probeErr}`;
        }
      }

      return {
        success: true,
        message: `✓ Conexión exitosa con Worker (${data.service || 'Cloudflare Edge'}). D1: ${data.storage?.d1 || 'ok'}, KV: ${data.storage?.kv || 'ok'}. ${tokenMsg}`,
        details: { ...data, tokenProbe: tokenMsg }
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
        // Ronda 21 (spec §1.2/§4.4): convergencia dirigida del OVERLAY de excusas.
        // El pull clásico solo AÑADÍA registros nuevos; una decisión de Rectoría
        // (aprobar → verificada / rechazar → desvincular) jamás alcanzaba a los
        // registros que ya existían localmente. Reglas (por id):
        //  1) snapshot trae excuseId → se aplica (radicación/aprobación propagadas).
        //  2) snapshot NO trae excuseId pero trae excuseUpdatedAt más nuevo que el
        //     local → gana el snapshot (rechazo/eliminación propagados; el stamp se
        //     conserva como evidencia). Sin stamp en el snapshot (datos pre-Ronda 21)
        //     el overlay local NO se toca: no se destruye lo que no se puede comparar.
        const byIdMap = new Map(currentRecords.map(r => [r.id, r]));
        const mergedExcuse = records
          .filter((r: any) => existingIds.has(r.id))
          .reduce((changes: number, pulled: any) => {
            const local = byIdMap.get(pulled.id);
            if (!local) return changes;
            const pulledStamp: string | undefined = pulled.excuseUpdatedAt || undefined;
            const localStamp: string | undefined = local.excuseUpdatedAt || undefined;
            const pulledNewer = !!pulledStamp && (!localStamp || pulledStamp > localStamp);
            if (pulled.excuseId && (pulled.excuseId !== local.excuseId || pulled.excuseStatus !== local.excuseStatus)) {
              byIdMap.set(pulled.id, {
                ...local,
                excuseId: pulled.excuseId,
                excuseStatus: pulled.excuseStatus,
                excuseUpdatedAt: pulledStamp || local.excuseUpdatedAt
              });
              return changes + 1;
            }
            if (!pulled.excuseId && local.excuseId && pulledNewer) {
              const { excuseId: _e, excuseStatus: _s, ...rest } = local;
              byIdMap.set(pulled.id, { ...(rest as AttendanceRecord), excuseUpdatedAt: pulledStamp });
              return changes + 1;
            }
            return changes;
          }, 0);
        const merged = [...byIdMap.values(), ...newRecords];
        AttendanceStorageService.saveAttendance(merged);
        importedRecords = newRecords.length;
        if (mergedExcuse > 0) {
          console.info(`[Sync Pull] Overlay de excusas convergido en ${mergedExcuse} registro(s) (Ronda 21).`);
        }
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

  // ===========================================================================
  // Ronda 28 — EXPORT Y PURGA DE LA NUBE (Ajustes → Sync y Seguridad)
  // ===========================================================================

  /**
   * Descarga el volcado COMPLETO de la nube (GET /api/sync/export) SIN tocar el
   * estado local — a diferencia de pullFromCloudflare(), este método no hidrata
   * localStorage: es una lectura pura para respaldos y para la purga asistida.
   */
  static async fetchCloudExport(): Promise<{ ok: boolean; data?: any; counts?: Record<string, number>; message: string }> {
    const settings = AttendanceStorageService.getSettings();
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) {
      return { ok: false, message: 'URL del Cloudflare Worker no configurada. Ingrésala en Ajustes → Sync y Seguridad.' };
    }
    try {
      const schoolCode = settings.schoolCode || 'INAS_2026';
      const res = await fetch(`${baseUrl}/api/sync/export?schoolCode=${encodeURIComponent(schoolCode)}`, {
        method: 'GET',
        headers: this.workerHeaders()
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return { ok: false, message: json?.error || `Worker HTTP ${res.status}` };
      }
      return { ok: true, data: json.data, counts: json.counts, message: 'Volcado completo de la nube recibido.' };
    } catch (err: any) {
      return { ok: false, message: `Fallo al exportar la nube: ${err?.message || err}` };
    }
  }

  /**
   * Ejecuta la purga de la nube (POST /api/sync/purge). El Worker exige
   * confirm === 'PURGAR' en el cuerpo — la UI además descarga el respaldo previo
   * y pide tipear la frase. Jamás llamada sin intervención explícita del usuario.
   */
  static async purgeCloudData(performedBy: string): Promise<{ ok: boolean; report?: CloudPurgeReport; message: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) {
      return { ok: false, message: 'URL del Cloudflare Worker no configurada. Ingrésala en Ajustes → Sync y Seguridad.' };
    }
    if (!(AttendanceStorageService.getSettings().cloudflareApiToken || '').trim()) {
      return { ok: false, message: 'Sin el Token de Acceso (AUTH_TOKEN) configurado, el Worker rechazará la purga con 401. Configúralo arriba en esta misma pestaña.' };
    }
    try {
      const res = await fetch(`${baseUrl}/api/sync/purge`, {
        method: 'POST',
        headers: this.workerHeaders(),
        body: JSON.stringify({ confirm: 'PURGAR', performedBy: performedBy || 'SETTINGS_UI' })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return { ok: false, message: json?.error || `Worker HTTP ${res.status}: la nube NO fue purgada.` };
      }
      return {
        ok: true,
        report: { tables: json.tables || {}, kvDeleted: json.kvDeleted || [], message: json.message, note: json.note },
        message: json.message
      };
    } catch (err: any) {
      return { ok: false, message: `Fallo de red durante la purga: ${err?.message || err}` };
    }
  }
}
