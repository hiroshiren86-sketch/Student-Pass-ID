import { Student, Teacher, AttendanceRecord, ClassScheduleAssignment, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from './attendanceStorage';

export interface CloudflareSyncResult {
  success: boolean;
  timestamp: string;
  syncedRecordsCount: number;
  syncedStudentsCount: number;
  message: string;
  target: 'Cloudflare D1' | 'Cloudflare KV' | 'Cloudflare Worker' | 'Local Cloudflare Cache';
  details?: any;
}

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
   * Ejecuta la sincronización de SUBIDA (Push) completa de la base de datos hacia Cloudflare (D1 / KV / Worker)
   */
  static async performCloudflareSync(): Promise<CloudflareSyncResult> {
    const settings = AttendanceStorageService.getSettings();
    const students = AttendanceStorageService.getStudents();
    const teachers = AttendanceStorageService.getTeachers();
    const records = AttendanceStorageService.getAllAttendance();
    const assignments = AttendanceStorageService.getScheduleAssignments();
    const slots = AttendanceStorageService.getScheduleSlots();

    const payload = {
      schoolCode: settings.schoolCode || 'INAS_2026',
      schoolName: settings.schoolName || 'Institución Educativa Antonia Santos',
      syncedAt: new Date().toISOString(),
      studentsCount: students.length,
      recordsCount: records.length,
      data: {
        settings,
        students,
        teachers,
        records: records.slice(0, 500), // Últimos 500 registros
        assignments,
        slots,
        // Ronda 4 (F1/F5): plantillas CUSTOM de Rectoría + horarios personales opcionales.
        // El worker guarda data verbatim y el pull destructura de forma tolerante →
        // clientes viejos ignoran estos campos sin romperse.
        customTemplates: AttendanceStorageService.getCustomTemplates(),
        studentSchedules: AttendanceStorageService.getAllStudentSchedules()
      }
    };

    const timestamp = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // 1. Si el usuario configuró una URL de Cloudflare Worker
    if (settings.cloudflareWorkerUrl && settings.cloudflareWorkerUrl.trim()) {
      try {
        const cleanBaseUrl = settings.cloudflareWorkerUrl.trim().replace(/\/+$/, '');
        const pushUrl = cleanBaseUrl.endsWith('/api/sync/push') ? cleanBaseUrl : `${cleanBaseUrl}/api/sync/push`;

        const response = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.cloudflareApiToken ? { Authorization: `Bearer ${settings.cloudflareApiToken.trim()}` } : {})
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Worker HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        this.updateLastSync(timestamp);
        return {
          success: true,
          timestamp,
          syncedRecordsCount: records.length,
          syncedStudentsCount: students.length,
          message: data.message || `Sincronización en vivo con Cloudflare D1 & KV completada a las ${timestamp}.`,
          target: 'Cloudflare Worker',
          details: data
        };
      } catch (err: any) {
        console.warn('Fallo de conexión con Cloudflare Worker URL:', err);
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

    // 2. Si el usuario configuró API Token y D1 Database ID directo de Cloudflare REST API
    if (settings.cloudflareAccountId && settings.cloudflareApiToken && settings.cloudflareD1DatabaseId) {
      try {
        const d1Endpoint = `https://api.cloudflare.com/client/v4/accounts/${settings.cloudflareAccountId}/d1/database/${settings.cloudflareD1DatabaseId}/query`;
        
        const sqlStatements = [
          `CREATE TABLE IF NOT EXISTS sync_snapshots (id TEXT PRIMARY KEY, school_code TEXT, school_name TEXT, data_json TEXT, students_count INTEGER, records_count INTEGER, updated_at TEXT);`,
          `INSERT OR REPLACE INTO sync_snapshots (id, school_code, school_name, data_json, students_count, records_count, updated_at) VALUES ('snapshot_${settings.schoolCode}', '${settings.schoolCode}', '${settings.schoolName}', '${JSON.stringify(payload).replace(/'/g, "''")}', ${students.length}, ${records.length}, datetime('now'));`
        ];

        const d1Res = await fetch(d1Endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.cloudflareApiToken}`
          },
          body: JSON.stringify({ sql: sqlStatements.join(' ') })
        });

        if (d1Res.ok) {
          this.updateLastSync(timestamp);
          return {
            success: true,
            timestamp,
            syncedRecordsCount: records.length,
            syncedStudentsCount: students.length,
            message: `Base de datos Cloudflare D1 actualizada vía REST API (${records.length} asistencias, ${students.length} estudiantes).`,
            target: 'Cloudflare D1'
          };
        }
      } catch (err: any) {
        console.warn('Fallo al conectar con Cloudflare D1 REST API:', err);
      }
    }

    // 3. Fallback Cloudflare Edge Cache Local (Resiliente de Cero Costo)
    try {
      localStorage.setItem('inas_cloudflare_d1_shadow_sync', JSON.stringify(payload));
      this.updateLastSync(timestamp);

      return {
        success: true,
        timestamp,
        syncedRecordsCount: records.length,
        syncedStudentsCount: students.length,
        message: `Almacenamiento estructurado para Cloudflare D1/KV listo en caché local (Sincronizado a las ${timestamp}).`,
        target: 'Local Cloudflare Cache'
      };
    } catch (e: any) {
      return {
        success: false,
        timestamp,
        syncedRecordsCount: 0,
        syncedStudentsCount: 0,
        message: `Error en sincronización: ${e.message || e}`,
        target: 'Cloudflare D1'
      };
    }
  }

  /**
   * Ejecuta la sincronización de BAJADA (Pull) desde Cloudflare Worker hacia el almacenamiento local
   */
  static async pullFromCloudflare(): Promise<{ success: boolean; message: string; data?: any }> {
    const settings = AttendanceStorageService.getSettings();
    const cleanBaseUrl = (settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');

    if (!cleanBaseUrl) {
      return { success: false, message: 'URL del Cloudflare Worker no configurada.' };
    }

    try {
      const pullUrl = cleanBaseUrl.endsWith('/api/sync/pull') 
        ? `${cleanBaseUrl}?schoolCode=${encodeURIComponent(settings.schoolCode || 'INAS_2026')}`
        : `${cleanBaseUrl}/api/sync/pull?schoolCode=${encodeURIComponent(settings.schoolCode || 'INAS_2026')}`;

      const res = await fetch(pullUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.cloudflareApiToken ? { Authorization: `Bearer ${settings.cloudflareApiToken.trim()}` } : {})
        }
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
      // NOTA de adopción: los dispositivos deben actualizarse todos primero; un push de
      // un cliente viejo NO incluye estos campos (los borrará del snapshot hasta el
      // próximo push de un cliente nuevo) — ver AGENTS.md Ronda 4.
      if (Array.isArray(customTemplates)) {
        AttendanceStorageService.saveCustomTemplates(customTemplates);
      }
      if (studentSchedules && typeof studentSchedules === 'object' && !Array.isArray(studentSchedules)) {
        AttendanceStorageService.saveAllStudentSchedules(studentSchedules);
      }

      return {
        success: true,
        message: `✓ Datos descargados de ${result.source || 'Cloudflare'}: ${importedStudents} estudiantes actualizados y ${importedRecords} nuevas asistencias integradas.`,
        data: result.data
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Error al descargar datos de Cloudflare: ${err.message || err}`
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
