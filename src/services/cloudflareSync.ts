import { Student, Teacher, AttendanceRecord, ClassScheduleAssignment, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from './attendanceStorage';
import { FirebaseService } from './firebase';
import { compressDataUrl, PHOTO_DATAURL_SOFT_LIMIT } from '../utils/imageCompressor';
import { generateHmacSignature, deriveStudentLoginKey, generateStudentQrPayload } from '../utils/crypto';

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

    // Ronda 54 (hueco #1): registrar el replayer del outbox para que AttendanceStorageService
    // delegue el replay de operaciones offline (sin import circular) a este servicio.
    AttendanceStorageService.registerOnlineReplayHandler(() => this.replayOutbox());

    const settings = AttendanceStorageService.getSettings();
    if (settings.cloudflareAutoSync !== false && settings.cloudflareWorkerUrl) {
      const intervalMs = (settings.cloudflareSyncIntervalMinutes || 5) * 60 * 1000;
      this.autoSyncTimer = setInterval(() => {
        // Ronda 58 (F-11): el PUSH automático SOLO corre si hay ediciones locales sin
        // subir (sello dirty de Ronda 57) o es sesión ADMIN (que además baja). Antes,
        // CADA terminal reescribía el snapshot completo cada 5 min aunque NADA hubiera
        // cambiado: 20 terminales × 288 ciclos/día ≈ 2.9M rows written/día contra un
        // cupo de 100 000/día de D1 (límite DURO desde el 01/09/2026) y 1 000
        // escrituras/día de KV. Un dispositivo idle ahora consume CUOTA CERO de
        // escritura. El push MANUAL (botón Sincronizar) siempre corre.
        const dirty = AttendanceStorageService.getLocalSyncDirty();
        if (!dirty) {
          // Nada que publicar → SOLO PULL (Ronda 60: para TODOS los roles). Antes solo
          // Rectoría bajaba en idle y los demás perfiles quedaban congelados con datos
          // viejos — la causa raíz del bug del representante: tarjetas de clase firmadas
          // por un dispositivo con secret desactualizado (o verificadas por uno que jamás
          // bajó el institucional). El pull es de SOLO-LECTURA (1 lectura KV/D1): cuota
          // de escritura CERO, y mantiene convergiendo secret, carnés pre-firmados,
          // verificadores de login y catálogo en docentes/estudiantes/terminales.
          this.pullFromCloudflare().catch(() => {
            /* sin red: el próximo ciclo reintenta */
          });
          return;
        }
        this.performCloudflareSync().then(async (pushResult) => {
          // Ronda 56 — CONVERGENCIA COMPLETA PARA RECTORÍA: tras el push (que ya subió
          // TODO el estado local — sin ventana de pérdida), se hace un Pull COMPLETO.
          // Esto cierra el hueco del 10/09/2026: el catálogo (estudiantes/roles/
          // docentes/plantillas/settings) SOLO bajaba con Pull manual, así que un
          // segundo dispositivo quedaba congelado en datos viejos (p. ej. el rol de
          // representante de un estudiante recién asignado jamás aparecía). Ahora cada
          // ciclo push→pull converge: lo local acaba de subirse y lo que baja incluye
          // los cambios de los demás terminales + settings institucionales (incluido
          // el qrSecret). Si el push falló (409 CAS/red) el pull re-ubica el terminal
          // con la nube ganadora (mismo propósito del CAS de R47).
          // Ronda 57 (INV-3): el pull SOLO corre si el push terminó BIEN. Si el push
          // falló (409 CAS / red / guarda anti-aplastado), bajar ahora podría REVERTIR
          // ediciones locales aún no publicadas — se espera al próximo ciclo, que
          // reintenta el push primero. Orden garantizado: primero subir, luego bajar.
          const session = AttendanceStorageService.getCurrentSession();
          if (pushResult?.success === true && session?.role === 'ADMIN') {
            try {
              await this.pullFromCloudflare();
            } catch {
              /* silencioso: la salud del sync no depende de este refresco */
            }
          }
        }).catch((err) => {
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
   * Ronda 54 (hueco #2) → Ronda 58 (F-12): opId determinista por CONTENIDO.
   *
   * ANTES: FNV-1a de 32 bits sobre CONTEOS (colegio + students.length + records.length
   * + catalogVersion + device + force). Dos pushes del mismo dispositivo con los MISMOS
   * conteos pero contenido DISTINTO (borrar un registro y crear otro, editar sin cambiar
   * conteos) colisionaban → el segundo se descartaba EN SILENCIO en el Worker
   * (`deduplicated:true`) — pérdida de datos por diseño.
   *
   * AHORA: SHA-256 (WebCrypto, ya en el repo) del payload canónico: los mismos datos
   * → mismo opId (reintento idempotente); cualquier cambio real → opId distinto.
   * Estable entre recargas y llamadas.
   */
  private static async makeOpId(payload: unknown): Promise<string> {
    const enc = new TextEncoder();
    let canonical: string;
    try {
      canonical = JSON.stringify(payload);
    } catch {
      canonical = String(Date.now()); // payload no serializable: opId único (jamás dedup)
    }
    const digest = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `op-${hex.substring(0, 32)}`;
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
    // Ronda 58 (F-23): el secret institucional con el que se calcula el verificador
    // de credenciales. ANTES: el push subía la ficha COMPLETA con tempPassword en
    // claro → cualquier poseedor del snapshot (docente, token de operador) tenía la
    // clave impresa de TODOS los estudiantes. AHORA: la clave viaja SOLO como
    // tempPasswordVerifier = HMAC-SHA256(qrSecret, "code|password") (32 hex) y los
    // docentes viajan despojados de password/passwordHash/tempPassword (ningún flujo
    // del cliente los compara: el login docente es Firebase Auth).
    // Límite honesto documentado: no es un KDF y no resiste ataque offline de quien
    // tenga el snapshot Y el qrSecret (que viaja en el mismo snapshot por decisión del
    // propietario). La verificación FUERTE sigue siendo Firebase Auth (R50).
    const settings = AttendanceStorageService.getSettings();
    const secretForVerifier = settings.qrSecret || '';

    for (const st of students) {
      let entry: Student = st;
      const photo = st.photoUrl || '';
      if (photo && photo.length > PHOTO_DATAURL_SOFT_LIMIT) {
        // Foto heredada sin comprimir: comprimir, persistir y usar la versión liviana
        const compressed = await compressDataUrl(photo);
        if (compressed) {
          entry = { ...st, photoUrl: compressed };
          AttendanceStorageService.updateStudent(st.code, { photoUrl: compressed });
        } else {
          const { photoUrl: _drop, ...rest } = st;
          entry = rest as Student;
          omitted.push(`${st.firstName} ${st.lastName} (${st.code})`);
        }
      }
      // F-23 + Ronda 59 (secreto por rol): egreso de credenciales.
      //   - signedCardToken: el QR del carné PRE-FIRMADO con el secret institucional
      //     viaja en la propia ficha → el portal del estudiante MUESTRA su QR sin
      //     necesidad de recibir el qrSecret (que le permitiría firmar carnés ajenos).
      //   - loginKey + verifier: par autocontenido por estudiante — loginKey =
      //     HMAC(qrSecret, `loginkey:v1:code`) y verifier = HMAC(loginKey, clave).
      //     La loginKey viaja SOLO en la propia ficha (el Worker la elimina de las
      //     fichas de los compañeros de grado), así el estudiante verifica SU clave
      //     offline sin poder atacar la de nadie más.
      const { tempPassword: _tp, password: _pw, passwordHash: _ph, ...rest } = entry as any;
      void _tp; void _pw; void _ph;
      let out = rest as Student;
      if (secretForVerifier) {
        try {
          out = { ...out, signedCardToken: await generateStudentQrPayload(entry, secretForVerifier) };
        } catch { /* sin campos suficientes para el token: sube sin él */ }
        if (entry.tempPassword) {
          const loginKey = await deriveStudentLoginKey(secretForVerifier, entry.code);
          const verifier = await generateHmacSignature(entry.tempPassword, loginKey);
          out = { ...out, loginKey, tempPasswordVerifier: verifier };
        }
      } else if (entry.tempPassword) {
        // Sin secret local no se puede calcular el verificador: JAMÁS se sube la clave
        // en claro como fallback (Regla 6). La ficha sube sin credencial; los otros
        // terminales ven "sin clave asignada" hasta que Rectoría sincronice con secret.
      }
      clean.push(out);
    }

    return { clean, omitted };
  }

  /**
   * Ronda 58 (F-23): los docentes viajan DESPOJADOS de credenciales en el push.
   * Ningún flujo del cliente compara password/passwordHash/tempPassword del docente
   * (el login docente es Firebase Auth desde R33) — eran solo superficie de fuga.
   */
  private static sanitizeTeachersForSync(teachers: Teacher[]): Teacher[] {
    return teachers.map((t: any) => {
      const { password: _pw, passwordHash: _ph, tempPassword: _tp, ...rest } = t;
      void _pw; void _ph; void _tp;
      return rest as Teacher;
    });
  }

  /** Copia de settings SIN secretos para el snapshot (deuda de seguridad de Ronda 4 cerrada) */
  private static safeSettingsCopy(settings: SchoolSettings): SchoolSettings {
    // Ronda 56 — CAMBIO DE POLÍTICA (mandato del propietario: "todo lo que se pueda
    // sincronizar y se deba sincronizar"): el `qrSecret` ahora SÍ viaja en el snapshot.
    // Es un secreto INSTITUCIONAL COMPARTIDO por diseño: todas las terminales verifican
    // las firmas HMAC de carnés y Tarjetas QR de Docente (CLASE:v2) con EL MISMO secret.
    // Sin distribuirlo, cada dispositivo con un secret distinto rechaza TODO lo firmado
    // por otros terminales ("la firma no coincide" — bug reproducido en producción
    // 10/09/2026 con tarjetas de clase escaneadas desde otro teléfono). Solo el push de
    // ADMIN (Rectoría) escribe el snapshot (el Worker descarta settings de pushes
    // OPERATOR/identidad), el canal es HTTPS y exige sesión/token; y el pull lo aplica
    // con exclusión de credenciales POR DISPOSITIVO (ver applyCloudSettingsToDevice).
    // Sí se excluyen los secretos personales/de-red: claves IA, tokens del Worker,
    // sessionSecret local.
    const {
      sessionSecret: _ss,
      cloudflareApiToken: _tok,
      cloudflareOperatorToken: _optok,
      customAiApiKey: _key,
      groqApiKey: _gq,
      mistralApiKey: _mr,
      openrouterApiKey: _or,
      geminiApiKey: _gm,
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

      // Ronda 54 (hueco #2) + Ronda 58 (F-12): opId ESTABLE por push — SHA-256 del
      // CONTENIDO (catálogo + hechos + device + force). Un reitero del MISMO estado
      // produce el mismo opId → el Worker lo deduce y no duplica. Cualquier cambio
      // REAL del contenido cambia el opId y se aplica como operación nueva (antes:
      // hash de 32 bits sobre CONTEOS → colisiones que perdían pushes en silencio).
      const pushTeachers = this.sanitizeTeachersForSync(AttendanceStorageService.getTeachers());
      const opId = await this.makeOpId({
        schoolCode: settings.schoolCode || 'INAS_2026',
        deviceId: this.getDeviceId(),
        force,
        catalogVersion: settings.cloudflareCatalogVersion ?? 0,
        students: safeStudents.map((s: any) => `${s.code}@${s.updatedAt || s.createdAt || ''}`),
        teachers: pushTeachers.map((t: any) => `${t.id}@${t.updatedAt || ''}`),
        records: records.map((r: any) => `${r.id}@${r.updatedAt || r.timestamp}`)
      });

      const payload = {
        schoolCode: settings.schoolCode || 'INAS_2026',
        schoolName: settings.schoolName || 'Institución Educativa Antonia Santos',
        syncedAt: new Date().toISOString(),
        studentsCount: safeStudents.length,
        recordsCount: records.length,
        opId,
        // Ronda 47 (Fase 2): identidad del dispositivo + versión de catálogo (CAS) + force.
        deviceId: this.getDeviceId(),
        deviceName: (settings.schoolName || 'Terminal INAS').slice(0, 80),
        catalogVersion: settings.cloudflareCatalogVersion,
        force,
        data: {
          settings: this.safeSettingsCopy(settings),
          students: safeStudents,
          teachers: pushTeachers,
          // Ronda 58 (F-11): RETIRADO el slice(0,500). El cap cortaba registros del
          // push (y el Worker ya fusiona por id+updatedAt desde R53, así que subir el
          // histórico completo es seguro y aditivo). El límite real pasa a ser el
          // almacenamiento local del navegador; cuando la escala lo exija, la ruta
          // correcta es el push de hechos por fila (/api/attendance con opId).
          records: records,
          assignments: AttendanceStorageService.getScheduleAssignments(),
          slots: AttendanceStorageService.getScheduleSlots(),
          // Ronda 4 (F1/F5): plantillas CUSTOM de Rectoría + horarios personales opcionales.
          // El worker guarda data verbatim y el pull destructura de forma tolerante →
          // clientes viejos ignoran estos campos sin romperse.
          customTemplates: AttendanceStorageService.getCustomTemplates(),
          studentSchedules: AttendanceStorageService.getAllStudentSchedules(),
          // Ronda 54 (hueco #5): marcas de borrado (soft-delete) que se propagan a la nube.
          tombstones: AttendanceStorageService.getTombstones()
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
        AttendanceStorageService.saveSettings({ ...AttendanceStorageService.getSettings(), cloudflareCatalogVersion: data.catalogVersion }, false); // R57: guardado de protocolo NO sella
      }
      // Ronda 57 (INV-1/INV-2): el push EXITOSO publicó todo el estado local — el sello de
      // "ediciones sin subir" se libera para que los pulls futuros vuelvan a converger.
      // Se hace DESPUÉS de guardar catalogVersion (ese saveSettings es de protocolo, con
      // sync=true, y volvería a sellar → por eso el orden es: saveSettings CAS → clear).
      if (data?.success !== false) {
        AttendanceStorageService.clearLocalSyncDirty();
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
   * Ronda 56 — política de aplicación de SETTINGS de la nube al dispositivo.
   * El pull SÍ sincroniza todo lo institucional (nombre, jornada, plantilla activa,
   * tolerancia, modos, qrSecret institucional…) y JAMÁS pisa lo propio del terminal
   * (URL del Worker con la que este dispositivo conecta, sus tokens, su clave IA
   * personal, sus cursores de sync y su sesión). Los valores vacíos en la nube no
   * pisan valores locales (neutralidad del snapshot incompleto).
   */
  private static readonly DEVICE_LOCAL_SETTINGS = new Set<string>([
    'cloudflareWorkerUrl',      // cómo CONECTA este terminal (previo al sync)
    'cloudflareApiToken',       // AUTH_TOKEN local del terminal
    'cloudflareOperatorToken',  // OPERATOR_TOKEN heredado localmente (R48)
    'customAiApiKey',           // clave IA personal (BYOK)
    'groqApiKey', 'mistralApiKey', 'openrouterApiKey', 'geminiApiKey',
    'sessionSecret',            // secreto de sesión local
    'cloudflareAutoSync', 'cloudflareSyncIntervalMinutes', // preferencia local de intervalo
    'lastCloudflareSync', 'lastCloudSync',                 // sellos locales
    'cloudflareLastSyncedAt',   // cursor incremental LOCAL (R54): nunca retrocede por snapshot
    'cloudflareCatalogVersion', // la gestiona el protocolo CAS por separado
    'updatedAt'                 // metadato del snapshot
  ]);

  private static applyCloudSettingsToDevice(cloudSettings: any): { changed: number; skipped?: boolean } {
    if (!cloudSettings || typeof cloudSettings !== 'object' || Array.isArray(cloudSettings)) return { changed: 0 };
    // Ronda 57 (INV-1): si este terminal tiene ediciones locales AÚN SIN SUBIR (sello
    // dirty activo), la nube NO puede pisarlas — ganará el push local (push-primero,
    // last-writer-wins). El sello se libera con el push exitoso y el próximo pull ya
    // converge. Es exactamente el invariante del propietario: "si lo local está un
    // poquito más adelantado, no me lo puede pisar".
    if (AttendanceStorageService.getLocalSyncDirty()) {
      console.info('[Sync Pull] Ajustes locales sin subir preservados: la nube no los pisa (convergerán tras el push).');
      return { changed: 0, skipped: true };
    }
    const current = AttendanceStorageService.getSettings();
    const merged: any = { ...current };
    // Ronda 59 (secreto por rol): en sesiones de ESTUDIANTE/ACUDIENTE el secret de
    // firma NO se instala en el dispositivo (defensa en profundidad — el Worker YA lo
    // elimina del snapshot para ese rol; este guard protege contra un Worker viejo
    // aún sin actualizar). El estudiante verifica su clave con la loginKey de SU ficha.
    const sessionNow = AttendanceStorageService.getCurrentSession();
    const studentLikeSession = sessionNow?.role === 'ESTUDIANTE_ACUDIENTE';
    let changed = 0;
    for (const [key, value] of Object.entries(cloudSettings)) {
      if (this.DEVICE_LOCAL_SETTINGS.has(key)) continue;
      if (value === undefined || value === null || value === '') continue; // vacío no pisa
      if (key === 'qrSecret' && typeof value !== 'string') continue;
      if (studentLikeSession && (key === 'qrSecret' || key === 'legacyQrSecret')) continue; // R59
      if (JSON.stringify((current as any)[key]) !== JSON.stringify(value)) {
        // Ronda 58 (F-23): al rotar el qrSecret institucional, el anterior pasa a
        // legacyQrSecret — los tempPasswordVerifier firmados con el secret viejo
        // siguen verificando durante la transición (verifyStudentCredential prueba
        // ambos). Sin esto, una rotación dejaba a todos los estudiantes sin login
        // local hasta que Rectoría re-emitiera claves.
        if (key === 'qrSecret' && typeof current.qrSecret === 'string' && current.qrSecret) {
          (merged as any).legacyQrSecret = current.qrSecret;
        }
        merged[key] = value;
        changed++;
      }
    }
    // Ronda 60: si la nube trae qrSecret, el de ESTE dispositivo ES el institucional
    // → se sella qrSecretSyncedAt. Las superficies que GENERAN tarjetas (Horarios →
    // QR de Clase, Mi Tarjeta del docente) advierten sin el sello: "tus tarjetas no
    // verificarán en otros dispositivos hasta sincronizar". Es la visibilidad del
    // bug original del representante (tarjetas firmadas con un secret divergente).
    if (typeof cloudSettings.qrSecret === 'string' && cloudSettings.qrSecret && !(merged as any).qrSecretSyncedAt) {
      (merged as any).qrSecretSyncedAt = new Date().toISOString();
      changed++;
    }
    if (changed > 0) {
      // syncToCloud=false: el pull no debe re-respaldar a Firestore lo que acaba de bajar.
      AttendanceStorageService.saveSettings(merged as SchoolSettings, false);
    }
    return { changed };
  }

  /**
   * Ronda 56 — merge UPSERT para snapshots SCOPEADOS (filterSnapshotByRole: DOCENTE /
   * ESTUDIANTE_ACUDIENTE). El snapshot de un rol no-ADMIN trae SOLO su porción
   * (p. ej. estudiantes de SU grado, teachers:[su ficha]) — reemplazar el catálogo local
   * completo con esa porción DESTRUIRÍA la matrícula del dispositivo (bug del "teléfono
   * 2" reproducido en producción). Upsert: lo que llega pisa/añade su id; lo demás local
   * se conserva. Los roles no editan el catálogo (solo Rectoría), así que el upsert
   * converge siempre hacia la nube sin destruir nada.
   */
  private static upsertBy<T>(localArr: T[], incoming: T[], keyOf: (item: T) => string): { result: T[]; changed: number } {
    const map = new Map<string, T>((localArr || []).map(item => [keyOf(item), item]));
    let changed = 0;
    for (const item of (incoming || [])) {
      if (!item) continue;
      const key = keyOf(item);
      if (JSON.stringify(map.get(key)) !== JSON.stringify(item)) changed++;
      map.set(key, item);
    }
    return { result: Array.from(map.values()), changed };
  }

  /**
   * Ronda 60 — VERIFICACIÓN DE TARJETA DE CLASE VÍA EL WORKER (server-side).
   *
   * Para dispositivos SIN el secret institucional (el portal del estudiante desde
   * Ronda 59 no lo recibe por diseño: verificar HMAC = poder firmar). El Worker sí
   * tiene el secret (vive en el snapshot) y devuelve SOLO el veredicto — el
   * dispositivo jamás recibe la llave. Es el camino que repara el flujo del
   * representante: escanear la Tarjeta QR de Clase desde el portal estudiante.
   */
  static async verifyClassTokenWithWorker(token: string): Promise<{ ok: boolean; verified?: boolean; reason?: string; kind?: string; context?: any; message?: string }> {
    const cleanBaseUrl = this.getWorkerBaseUrl();
    const schoolCode = AttendanceStorageService.getSettings().schoolCode || 'INAS_2026';
    if (!cleanBaseUrl) {
      return { ok: false, message: 'URL del Worker no configurada (Ajustes → Sync y Seguridad).' };
    }
    try {
      const res = await fetch(`${cleanBaseUrl.replace(/\/+$/, '')}/api/verify/class-token`, {
        method: 'POST',
        headers: await this.workerHeaders(),
        body: JSON.stringify({ token, schoolCode })
      });
      const json: any = await res.json().catch(() => null);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'La nube no aceptó la credencial de este dispositivo. Sincroniza una vez (Pull) o inicia sesión con tu cuenta.' };
      }
      if (!res.ok) {
        return { ok: false, message: json?.error || 'La nube no pudo verificar la tarjeta en este momento.' };
      }
      return { ok: true, verified: json.verified === true, reason: json.reason, kind: json.kind, context: json.context };
    } catch {
      return { ok: false, message: 'Sin conexión con la nube: no se puede verificar la tarjeta de clase desde este portal sin internet (por seguridad, este dispositivo no guarda la llave del colegio).' };
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
        AttendanceStorageService.saveSettings({ ...AttendanceStorageService.getSettings(), cloudflareCatalogVersion: result.catalogVersion }, false); // R57 (fix hueco #5): guardado de protocolo NO sella
      }

      const { students, records, teachers, assignments, slots, customTemplates, studentSchedules } = result.data;
      // Ronda 56: settings del snapshot (viajan en TODOS los scopes: el filtro por rol
      // hace spread de data). Se aplican con exclusión de campos por-dispositivo.
      const cloudSettings = result.data.settings;
      // Ronda 56: ¿snapshot SCOPEADO por rol? (filterSnapshotByRole añade scopedFor para
      // DOCENTE y ESTUDIANTE_ACUDIENTE). ADMIN/OPERATOR reciben el snapshot completo.
      const scopedRole = result.data.scopedFor?.role as ('DOCENTE' | 'ESTUDIANTE_ACUDIENTE' | undefined);

      let importedStudents = 0;
      let importedRecords = 0;
      let importedTeachers = 0;
      let importedAssignments = 0;
      let importedSlots = 0;
      let importedTemplates = 0;
      let updatedStudents = 0;
      let updatedTeachers = 0;
      let updatedAssignments = 0;
      let updatedSlots = 0;

      if (Array.isArray(students) && students.length > 0) {
        // Ronda 54 (hueco #5): aplicar tombstones LOCALES al pull. Un borrado hecho en este
        // terminal pero aún no subido (sin push) debía estar en la nube para que el Worker lo
        // filtrara; aquí se filtra también, para que el estudiante NO RESUCITE en este pull.
        const tombStudents = new Set(AttendanceStorageService.getTombstones().filter(t => t.type === 'student').map(t => t.id));
        const incomingStudents = students.filter((s: any) => s && !tombStudents.has(String(s.code)));
        if (scopedRole) {
          // Ronda 56: upsert — la porción del grado pisa/añade; el resto de la matrícula
          // local se CONSERVA (el snapshot scopeado jamás destruye el catálogo del teléfono).
          const local = AttendanceStorageService.getStudents();
          const { result: merged, changed } = CloudflareSyncService.upsertBy(local, incomingStudents, (s: any) => String(s.code));
          AttendanceStorageService.saveStudents(merged, 'cloud');
          importedStudents = incomingStudents.length;
          updatedStudents = changed;
        } else {
          AttendanceStorageService.saveStudents(incomingStudents, 'cloud');
          importedStudents = incomingStudents.length;
        }
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
        if (scopedRole === 'DOCENTE') {
          // Ronda 56: upsert de SU ficha — jamás reemplazar el directorio con teachers:[1].
          const local = AttendanceStorageService.getTeachers();
          const { result: merged, changed } = CloudflareSyncService.upsertBy(local, teachers, (t: any) => String(t.id));
          AttendanceStorageService.saveTeachers(merged, 'cloud');
          importedTeachers = teachers.length;
          updatedTeachers = changed;
        } else {
          AttendanceStorageService.saveTeachers(teachers, 'cloud');
          importedTeachers = teachers.length;
        }
      }

      if (Array.isArray(assignments) && assignments.length > 0) {
        if (scopedRole) {
          const local = AttendanceStorageService.getScheduleAssignments();
          const { result: merged, changed } = CloudflareSyncService.upsertBy(local, assignments, (a: any) => String(a.id));
          AttendanceStorageService.saveScheduleAssignments(merged, 'cloud');
          importedAssignments = assignments.length;
          updatedAssignments = changed;
        } else {
          AttendanceStorageService.saveScheduleAssignments(assignments, 'cloud');
          importedAssignments = assignments.length;
        }
      }

      if (Array.isArray(slots) && slots.length > 0) {
        if (scopedRole) {
          const local = AttendanceStorageService.getScheduleSlots();
          const { result: merged, changed } = CloudflareSyncService.upsertBy(local, slots, (s: any) => String(s.id));
          AttendanceStorageService.saveScheduleSlots(merged, 'cloud');
          importedSlots = slots.length;
          updatedSlots = changed;
        } else {
          AttendanceStorageService.saveScheduleSlots(slots, 'cloud');
          importedSlots = slots.length;
        }
      }

      // Ronda 4 (F5): plantillas CUSTOM y horarios personales viajan en el snapshot.
      if (Array.isArray(customTemplates)) {
        AttendanceStorageService.saveCustomTemplates(customTemplates, 'cloud');
        importedTemplates = customTemplates.length;
      }
      if (studentSchedules && typeof studentSchedules === 'object' && !Array.isArray(studentSchedules)) {
        AttendanceStorageService.saveAllStudentSchedules(studentSchedules, 'cloud');
      }

      // Ronda 57 (INV-4): convergencia de BORRADOS — los tombstones de la nube se aplican
      // al catálogo local (el estudiante/docente eliminado por Rectoría desaparece también
      // en los teléfonos scopeados, donde el UPSERT jamás borra por sí solo) y se UNEN a
      // la lista local para que no resuciten con un push posterior. Va DESPUÉS de las
      // colecciones como barrido final: el upsert actualizó/añadió lo vivo y aquí se
      // retira lo tombstoneado (la escritura es directa: derivado de la nube, no sella dirty).
      const cloudTombstones = Array.isArray(result.data.tombstones) ? result.data.tombstones : [];
      let tombApplied = { studentsRemoved: 0, teachersRemoved: 0, merged: 0 };
      // Ronda 57 (INV-1 aplicado a borrados): con ediciones locales sin subir, el barrido
      // se DIFIERE — un tombstone viejo de la nube no puede eliminar una entidad local
      // más nueva (p. ej. una re-matrícula hecha aquí y aún no publicada). Converge tras
      // el push exitoso, que libera el sello.
      if (AttendanceStorageService.getLocalSyncDirty()) {
        console.info('[Sync Pull] Tombstones de la nube diferidos: hay ediciones locales sin subir.');
      } else {
        tombApplied = AttendanceStorageService.applyCloudTombstones(cloudTombstones);
      }
      // Ronda 57: visibilidad total del barrido — loggea si integró tombstones NUEVOS
      // o si REMOVIÓ entidades locales (aunque ya conociera los tombstones).
      if (tombApplied.merged > 0 || tombApplied.studentsRemoved > 0 || tombApplied.teachersRemoved > 0) {
        console.info(`[Sync Pull] Tombstones de la nube integrados: ${tombApplied.merged} (estudiantes removidos: ${tombApplied.studentsRemoved}, docentes: ${tombApplied.teachersRemoved}).`);
      }

      // Ronda 56: aplicar SETTINGS de la nube (jornada, plantilla activa, tolerancia,
      // qrSecret institucional…) con exclusión de campos por-dispositivo. Esto es el fix
      // de los 3 bugs del 10/09/2026: fin de jornada / plantilla activa / firma de
      // tarjetas ("la firma no coincide") que no cruzaban entre teléfonos.
      const settingsChanged = CloudflareSyncService.applyCloudSettingsToDevice(cloudSettings);

      // Ronda 42 (H-42-2): el mensaje anterior solo mencionaba estudiantes y asistencias;
      // docentes y cátedras se importaban EN SILENCIO y el propietario concluyó "no bajan
      // horarios ni profesores". Ahora el resumen cuenta TODO lo restaurado.
      const summaryParts: string[] = [`${importedStudents} estudiante${importedStudents === 1 ? '' : 's'}`];
      if (importedTeachers > 0) summaryParts.push(`${importedTeachers} docente${importedTeachers === 1 ? '' : 's'}`);
      if (importedAssignments > 0) summaryParts.push(`${importedAssignments} cátedra${importedAssignments === 1 ? '' : 's'} de horarios`);
      if (importedSlots > 0) summaryParts.push(`${importedSlots} bloque${importedSlots === 1 ? '' : 's'} de jornada`);
      if (importedTemplates > 0) summaryParts.push(`${importedTemplates} plantilla${importedTemplates === 1 ? '' : 's'} de jornada`);
      summaryParts.push(`${importedRecords} ${importedRecords === 1 ? 'nueva asistencia' : 'nuevas asistencias'}`);
      if (settingsChanged.changed > 0) summaryParts.push(`${settingsChanged.changed} ajuste(s) institucional(es) actualizado(s)`);
      if (settingsChanged.skipped) summaryParts.push('ajustes locales sin subir preservados');
      if (tombApplied.merged > 0) summaryParts.push(`${tombApplied.merged} marca(s) de borrado integrada(s)`);

      // Ronda 54 — actualizar el cursor de sync (nunca retrocede). Con el pull COMPLETO
      // ya se trajo TODO, así que el próximo pull de hechos puede empezar desde acá.
      this.advanceLastSyncedAt(result?.syncedAt);

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

  /**
   * Ronda 54 — AUTO-SYNC DE HECHOS PARA RECTORÍA (pull `scope=facts`).
   * Baja SOLO los registros de asistencia/excusas que docentes y estudiantes subieron,
   * fusionándolos por id+updatedAt. JAMÁS reemplaza el catálogo (estudiantes/docentes/
   * horarios) — por eso es seguro para el auto-sync. Usa el cursor incremental
   * (`cloudflareLastSyncedAt`) para traer solo lo nuevo.
   */
  static async pullFactsFromCloudflare(): Promise<{ success: boolean; message: string; data?: any; newRecords?: number }> {
    const settings = AttendanceStorageService.getSettings();
    const cleanBaseUrl = this.getWorkerBaseUrl();
    const schoolCode = settings.schoolCode || 'INAS_2026';

    if (!cleanBaseUrl) {
      return { success: false, message: 'URL del Cloudflare Worker no configurada.' };
    }

    try {
      const cursor = settings.cloudflareLastSyncedAt || '';
      const sinceParam = cursor ? `&since=${encodeURIComponent(cursor)}` : '';
      const pullUrl = cleanBaseUrl.endsWith('/api/sync/pull')
        ? `${cleanBaseUrl}?schoolCode=${encodeURIComponent(schoolCode)}&scope=facts${sinceParam}`
        : `${cleanBaseUrl}/api/sync/pull?schoolCode=${encodeURIComponent(schoolCode)}&scope=facts${sinceParam}`;

      const res = await fetch(pullUrl, { method: 'GET', headers: await this.workerHeaders() });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Worker HTTP ${res.status}: ${errText}`);
      }
      const result = await res.json();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'No se recibieron hechos del Worker');
      }

      const pulledRecords = Array.isArray(result.data.records) ? result.data.records : [];
      let importedRecords = 0;
      if (pulledRecords.length > 0) {
        const current = AttendanceStorageService.getAllAttendance();
        const byId = new Map(current.map(r => [r.id, r]));
        for (const pulled of pulledRecords) {
          if (!pulled || !pulled.id) continue;
          const local = byId.get(pulled.id);
          if (!local) {
            byId.set(pulled.id, pulled);
            importedRecords++;
            continue;
          }
          // Ronda 54 (hueco #4): la VERSIÓN del servidor (serverUpdatedAt) arbitra el LWW,
          // no el reloj local. Fallback a updatedAt/timestamp para registros pre-R54.
          const pulledStamp: string = pulled.serverUpdatedAt || pulled.updatedAt || pulled.timestamp || '';
          const localStamp: string = local.serverUpdatedAt || local.timestamp || '';
          const pulledNewer = !!pulledStamp && (!localStamp || pulledStamp > localStamp);
          // Overlay de excusas (convergencia Ronda 21) + LWW por updatedAt.
          if (pulled.excuseId && (pulled.excuseId !== local.excuseId || pulled.excuseStatus !== local.excuseStatus)) {
            byId.set(pulled.id, {
              ...local,
              excuseId: pulled.excuseId,
              excuseStatus: pulled.excuseStatus,
              excuseUpdatedAt: pulled.excuseUpdatedAt || local.excuseUpdatedAt
            });
          } else if (!pulled.excuseId && local.excuseId && pulledNewer) {
            const { excuseId: _e, excuseStatus: _s, ...rest } = local;
            byId.set(pulled.id, { ...(rest as AttendanceRecord), excuseUpdatedAt: pulledStamp || local.excuseUpdatedAt });
          } else if (pulledNewer) {
            byId.set(pulled.id, pulled);
          }
        }
        AttendanceStorageService.saveAttendance(Array.from(byId.values()));
      }

      this.advanceLastSyncedAt(result?.syncedAt);

      return {
        success: true,
        message: `✓ ${importedRecords} asistencia${importedRecords === 1 ? '' : 's'} nueva${importedRecords === 1 ? '' : 's'} desde la nube.`,
        data: result.data,
        newRecords: importedRecords
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Error al sincronizar hechos: ${err.message || err}`
      };
    }
  }

  /**
   * Ronda 54 (hueco #1) — REPLAY DEL OUTBOX DURABLE. Reenvía, EN ORDEN, las operaciones de
   * hechos que se encolaron mientras el dispositivo estaba offline (o con red intermitente).
   * Cada operación va con su `opId` (idempotency key): el Worker deduce reintentos, así que
   * at-least-once ya no duplica. Tras confirmar, la operación se marca SENT (no se reenvía);
   * si falla, queda FAILED con retryCount++ para el siguiente intento.
   */
  static async replayOutbox(): Promise<void> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return;
    const pending = AttendanceStorageService.getOfflineQueue().filter(i => i.status !== 'SENT');
    for (const item of pending) {
      if (!item.payload) continue; // operaciones sin payload (legacy) se descartan
      try {
        const url = baseUrl.endsWith('/api/attendance')
          ? baseUrl
          : `${baseUrl}/api/attendance`;
        const res = await fetch(url, {
          method: 'POST',
          headers: await this.workerHeaders(),
          body: JSON.stringify({ ...item.payload, opId: item.opId })
        });
        if (res.ok) {
          AttendanceStorageService.markOfflineQueueSent(item.id);
        } else {
          AttendanceStorageService.markOfflineQueueFailed(item.id);
        }
      } catch {
        AttendanceStorageService.markOfflineQueueFailed(item.id);
      }
    }
  }

  /** Ronda 54 — el cursor de sync jamás retrocede (evita re-bajadas innecesarias). */
  private static advanceLastSyncedAt(next?: string | null): void {
    if (!next) return;
    const cur = AttendanceStorageService.getSettings().cloudflareLastSyncedAt || '';
    if (!cur || next > cur) {
      AttendanceStorageService.saveSettings({
        ...AttendanceStorageService.getSettings(),
        cloudflareLastSyncedAt: next
      }, false); // R57 (fix hueco #5): el cursor es estado de protocolo — jamás sella
    }
  }

  private static updateLastSync(timeStr: string) {
    const current = AttendanceStorageService.getSettings();
    AttendanceStorageService.saveSettings({
      ...current,
      lastCloudflareSync: `${new Date().toLocaleDateString('es-CO')} ${timeStr}`
    }, false); // R57: guardado de protocolo NO sella
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
