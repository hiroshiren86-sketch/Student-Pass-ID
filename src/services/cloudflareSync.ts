import { Student, Teacher, AttendanceRecord, ClassScheduleAssignment, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from './attendanceStorage';
import { FirebaseService } from './firebase';
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

  /**
   * Identidad de dispositivo estable y persistente (Flanco 2). Se genera una sola
   * vez por navegador y se viaja en el header X-Device-Id para que el Worker la
   * registre (append-only) y pueda atribuir cada push/purga a un terminal concreto.
   */
  private static getDeviceId(): string {
    const KEY = 'inas_device_id';
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return 'dev-anonymous';
    }
  }

  /**
   * Headers comunes para el Worker (Bearer con ALCANCE, Flanco 1) + identidad de
   * dispositivo (Flanco 2).
   *
   * Token según el rol de la sesión:
   *   - ADMIN (Rectoría) → AUTH_TOKEN (cloudflareApiToken) → escribe catálogo + hechos.
   *   - DOCENTE / acudiente → OPERATOR_TOKEN (cloudflareOperatorToken) → solo escribe
   *     hechos (asistencia). Lo HEREDA sin digitarlo. Si el token de operador aún no
   *     está configurado, cae al admin (retrocompat: nada rompe).
   *
   * `forceAdmin` fuerza el token de ADMIN para acciones exclusivas de Rectoría
   * (export, purge, log) aunque la sesión activa sea de un docente.
   */
  private static async workerHeaders(forceAdmin = false): Promise<Record<string, string>> {
    const settings = AttendanceStorageService.getSettings();
    const session = AttendanceStorageService.getCurrentSession();
    const isAdmin = forceAdmin || session?.role === 'ADMIN';
    const token = isAdmin
      ? (settings.cloudflareApiToken || '').trim()
      : ((settings.cloudflareOperatorToken || '').trim() || (settings.cloudflareApiToken || '').trim());
    const deviceId = this.getDeviceId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Device-Name': (settings.schoolName || 'Terminal INAS').slice(0, 80),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    // Ronda 49 (identidad-nube): si hay una cuenta REAL de Firebase (Rectoría o DOCENTE),
    // su ID token viaja para que el Worker autorice por IDENTIDAD Y ROL (no solo por token
    // de dispositivo). Esto es lo que permite a un docente usar su propio teléfono sin
    // token de dispositivo: el Worker lee su rol desde Firestore. Aditivo/retrocompat:
    // si la sesión es anónima o no hay cuenta, no se envía y todo funciona como hoy.
    try {
      const fbIdToken = await FirebaseService.getCurrentIdToken();
      if (fbIdToken) headers['X-Firebase-Id-Token'] = fbIdToken;
    } catch {
      // la identidad jamás rompe el sync (sigue el token de dispositivo).
    }
    return headers;
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
      cloudflareOperatorToken: _optok,
      customAiApiKey: _key,
      ...safe
    } = settings;
    return safe as SchoolSettings;
  }

  /**
   * Ejecuta la sincronización de SUBIDA (Push) completa hacia el Cloudflare Worker (D1 / KV)
   * @param force  Ronda 47 (Fase 2 — Flanco 3): escape explícito de Rectoría para ignorar
   *               el CAS de catálogo obsoleto (enviar force:true tras revisar que realmente
   *               se quiere pisar la nube). Por defecto false.
   */
  static async performCloudflareSync(force = false): Promise<CloudflareSyncResult> {
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
        // Ronda 47 (Fase 2): identidad del dispositivo + versión de catálogo (CAS) + force.
        deviceId: this.getDeviceId(),
        deviceName: (settings.schoolName || 'Terminal INAS').slice(0, 80),
        catalogVersion: settings.cloudflareCatalogVersion,
        force,
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

      // Ronda 38 (H-38-1): PROTECCIÓN ANTI-APLASTADO. El auto-sync empuja el estado local
      // verbatim; si el dispositivo pierde su localStorage (perfil reiniciado, limpieza del
      // navegador, corrupción — detectado en QA Ronda 38 con pérdida real de estado local),
      // un push con 0 estudiantes SOBREESCRIBIRÍA la matrícula completa de la nube sin
      // confirmación. Si el estado local viene TOTALMENTE vacío y la nube tiene estudiantes,
      // se aborta con aviso explícito: restaurar primero con "Descargar (Pull)"; vaciar de
      // verdad sigue siendo posible vía "Purgar datos de la nube…". El primer push de un
      // colegio nuevo no se ve afectado (remoto vacío o sin snapshot).
      // Ronda 42 (H-42-3): la misma protección para DOCENTES, CÁTEDRAS y BLOQUES — un
      // dispositivo con matrícula pero sin horarios locales (estado viejo/perdido) podía
      // aplastar los horarios de TODA la institución con un push vacío (la nube solo los
      // conserva en el snapshot KV). El bloque exige colecciones localmente vacías Y nube
      // poblada, así el flujo normal de edición nunca se ve afectado.
      const localTeachers = AttendanceStorageService.getTeachers();
      const localAssignments = AttendanceStorageService.getScheduleAssignments();
      const localSlots = AttendanceStorageService.getScheduleSlots();
      const localEmptyEnrollment = safeStudents.length === 0 && records.length === 0;
      const localMissingCoreCollections = localTeachers.length === 0 || localAssignments.length === 0 || localSlots.length === 0;
      if (localEmptyEnrollment || localMissingCoreCollections) {
        try {
          const probeUrl = baseUrl.endsWith('/api/sync/pull')
            ? `${baseUrl}?schoolCode=${encodeURIComponent(settings.schoolCode || 'INAS_2026')}`
            : `${baseUrl}/api/sync/pull?schoolCode=${encodeURIComponent(settings.schoolCode || 'INAS_2026')}`;
          const probe = await fetch(probeUrl, { headers: await this.workerHeaders() });
          if (probe.ok) {
            const probeData: any = await probe.json();
            const remoteData = probeData?.data || {};
            const remoteCount = remoteData.students?.length ?? probeData?.data?.studentsCount ?? 0;
            if (localEmptyEnrollment && remoteCount > 0) {
              return {
                success: false,
                timestamp,
                syncedRecordsCount: 0,
                syncedStudentsCount: 0,
                message: `PUSH BLOQUEADO por seguridad: el estado local está VACÍO pero la nube tiene ${remoteCount} estudiantes. Empujar ahora borraria la matrícula de la nube. Restaura primero con "Descargar (Pull)"; si realmente quieres vaciar la nube, usa "Purgar datos de la nube…".`,
                target: 'Cloudflare Worker'
              };
            }
            // Ronda 42 (H-42-3): colecciones que viven SOLO en el snapshot (KV) — si el
            // dispositivo no las tiene y la nube sí, el push las destruiría para todos.
            const missingParts: string[] = [];
            const remoteTeachers = remoteData.teachers?.length ?? 0;
            const remoteAssignments = remoteData.assignments?.length ?? 0;
            const remoteSlots = remoteData.slots?.length ?? 0;
            if (localTeachers.length === 0 && remoteTeachers > 0) missingParts.push(`${remoteTeachers} docente(s)`);
            if (localAssignments.length === 0 && remoteAssignments > 0) missingParts.push(`${remoteAssignments} cátedra(s) de horario`);
            if (localSlots.length === 0 && remoteSlots > 0) missingParts.push(`${remoteSlots} bloque(s) de jornada`);
            if (missingParts.length > 0) {
              return {
                success: false,
                timestamp,
                syncedRecordsCount: 0,
                syncedStudentsCount: 0,
                message: `PUSH BLOQUEADO por seguridad: tu dispositivo no tiene ${missingParts.join(' ni ')}, pero la nube sí. Empujar ahora los borraría de la nube para TODOS los terminales. Restaura primero con "Descargar (Pull)" en Ajustes → Sync y Seguridad; si de verdad quieres vaciar la nube, usa "Purgar datos de la nube…".`,
                target: 'Cloudflare Worker'
              };
            }
          }
        } catch { /* sonda indiferente a fallos: si no responde, el push seguirá su curso normal */ }
      }

      const pushUrl = baseUrl.endsWith('/api/sync/push')
        ? baseUrl
        : `${baseUrl}/api/sync/push`;

      const response = await fetch(pushUrl, {
        method: 'POST',
        headers: await this.workerHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        // Ronda 47 (Fase 2 — Flanco 3): 409 = catálogo obsoleto. Mensaje accionable.
        if (response.status === 409) {
          return {
            success: false,
            timestamp,
            syncedRecordsCount: 0,
            syncedStudentsCount: 0,
            message: `Sincronización rechazada: tu terminal tiene un catálogo desactualizado (${errText}). Descarga primero con "Descargar (Pull)" y reintenta.`,
            target: 'Cloudflare Worker',
            details: { conflict: true, raw: errText }
          };
        }
        throw new Error(`Worker HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      this.updateLastSync(timestamp);
      // Ronda 47 (Fase 2 — Flanco 3): el push de catálogo devuelve la nueva catalog_version;
      // se guarda para el próximo CAS sin costo.
      if (typeof data?.catalogVersion === 'number') {
        AttendanceStorageService.saveSettings({ ...AttendanceStorageService.getSettings(), cloudflareCatalogVersion: data.catalogVersion });
      }

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
        headers: await this.workerHeaders()
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Worker HTTP ${res.status}: ${errText}`);
      }

      const result = await res.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'No se recibieron datos del Worker');
      }

      // Ronda 47 (Fase 2 — Flanco 3): la versión de catálogo viaja en la respuesta del
      // pull. Se guarda para que el próximo push envíe la correcta (CAS).
      if (typeof result?.catalogVersion === 'number') {
        AttendanceStorageService.saveSettings({ ...AttendanceStorageService.getSettings(), cloudflareCatalogVersion: result.catalogVersion });
      }

      const { students, records, teachers, assignments, slots, customTemplates, studentSchedules } = result.data;

      let importedStudents = 0;
      let importedRecords = 0;
      let importedTeachers = 0;
      let importedAssignments = 0;
      let importedSlots = 0;
      let importedTemplates = 0;

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
        importedTeachers = teachers.length;
      }

      if (Array.isArray(assignments) && assignments.length > 0) {
        AttendanceStorageService.saveScheduleAssignments(assignments);
        importedAssignments = assignments.length;
      }

      if (Array.isArray(slots) && slots.length > 0) {
        AttendanceStorageService.saveScheduleSlots(slots);
        importedSlots = slots.length;
      }

      // Ronda 4 (F5): plantillas CUSTOM y horarios personales viajan en el snapshot.
      if (Array.isArray(customTemplates)) {
        AttendanceStorageService.saveCustomTemplates(customTemplates);
        importedTemplates = customTemplates.length;
      }
      if (studentSchedules && typeof studentSchedules === 'object' && !Array.isArray(studentSchedules)) {
        AttendanceStorageService.saveAllStudentSchedules(studentSchedules);
      }

      // Ronda 42 (H-42-2): el mensaje anterior solo mencionaba estudiantes y asistencias;
      // docentes y cátedras se importaban EN SILENCIO y el propietario concluyó "no bajan
      // horarios ni profesores". Ahora el resumen cuenta TODO lo restaurado.
      const summaryParts: string[] = [`${importedStudents} estudiante${importedStudents === 1 ? '' : 's'}`];
      if (importedTeachers > 0) summaryParts.push(`${importedTeachers} docente${importedTeachers === 1 ? '' : 's'}`);
      if (importedAssignments > 0) summaryParts.push(`${importedAssignments} cátedra${importedAssignments === 1 ? '' : 's'} de horarios`);
      if (importedSlots > 0) summaryParts.push(`${importedSlots} bloque${importedSlots === 1 ? '' : 's'} de jornada`);
      if (importedTemplates > 0) summaryParts.push(`${importedTemplates} plantilla${importedTemplates === 1 ? '' : 's'} de jornada`);
      summaryParts.push(`${importedRecords} ${importedRecords === 1 ? 'nueva asistencia' : 'nuevas asistencias'}`);

      return {
        success: true,
        message: `✓ Datos descargados del Cloudflare Worker: ${summaryParts.join(', ')} — todo integrado en este dispositivo.`,
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
        headers: await this.workerHeaders(true)
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
        headers: await this.workerHeaders(true),
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
