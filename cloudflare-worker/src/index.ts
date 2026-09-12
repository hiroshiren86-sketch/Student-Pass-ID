/**
 * ==============================================================================
 * CLOUDFLARE WORKER: D1 RELATIONAL DATABASE & KV CACHE (SYNC DE DATOS)
 * La IA se ejecuta 100% local en el navegador (BYOK). Este Worker NO integra proveedores de IA.
 * Sistema de Control de Asistencia Escolar y Carnetización Criptográfica
 * ==============================================================================
 */

import { handleExcusesRoutes } from './excuses';
import { handlePushRoutes } from './push';
// Ronda 58: autorización y CORS extraídos a módulos compartidos (sin ciclos).
// authz.ts: la primitiva de identidad+rol que ANTES solo usaban las rutas de sync
//           (F-3: excusas y push también la usan ahora — nada de roles autodeclarados).
// cors.ts : allowlist de orígenes (F-17: se retiró el Allow-Origin '*').
import {
  timingSafeEqual, clientIp, resolveTokenScope, verifyFirebaseIdentity, resolveAuthz, filterSnapshotByRole,
  type Authz, type IdentityRole, type TokenRole, type FbProfile, type FbIdentity
} from './authz';
import { corsBaseHeaders, corsPreflightResponse, withCorsHeaders } from './cors';
// Ronda 60: verificación server-side de tarjetas de clase (portales sin secret).
import { verifyClassToken } from './verifyToken';

// Re-export de compatibilidad: las suites QA (qa-r49-identity.ts) y herramientas
// importan estas primitivas desde './index'.
export { timingSafeEqual, clientIp, resolveTokenScope, verifyFirebaseIdentity, resolveAuthz, filterSnapshotByRole };
export type { Authz, IdentityRole, TokenRole, FbProfile, FbIdentity };

// Tipos autocontenidos para Cloudflare Worker Runtime
export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<{ success: boolean; results?: T[]; error?: string; meta?: { changes?: number } }>;
  all<T = unknown>(): Promise<{ success: boolean; results?: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean; results?: T[] }>>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface KVNamespace {
  get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<any>;
  put(key: string, value: string | ReadableStream | ArrayBuffer, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: any): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  ATTENDANCE_KV: KVNamespace;
  
  // Variables públicas
  SCHOOL_CODE?: string;
  SCHOOL_NAME?: string;

  // Secretos institucionales configurados con `wrangler secret put`
  AUTH_TOKEN?: string;

  // Ronda 47 (Fase 2 — Flanco 1): token con alcance de OPERADOR (docente/encargada).
  // ADITIVO y retrocompatible: AUTH_TOKEN sigue siendo el token ADMIN (escribe catálogo
  // + hechos); OPERATOR_TOKEN solo puede escribir HECHOS (attendance_records), nunca el
  // catálogo. Si OPERATOR_TOKEN no está configurado, el Worker se comporta como hoy
  // (solo AUTH_TOKEN = admin en todos los terminales). Configurar con:
  //   wrangler secret put OPERATOR_TOKEN  (npx wrangler@3 — v4 exige Node ≥22)
  OPERATOR_TOKEN?: string;

  // Ronda 21 (Excusas, spec-excusas-2026) — configuración opcional:
  EXCUSE_CHAIN_SECRET?: string;       // secret de la cadena de auditoría HMAC (fallback: AUTH_TOKEN)
  EXCUSE_AUTO_APPROVE_HOURS?: string; // ventana R8 en horas (default 72; 0 desactiva el auto-aprobo)
  SCHOOL_TERM_START?: string;         // YYYY-MM-DD — inicio del término (R3: máx. 10 días justificados)
  SCHOOL_TERM_END?: string;           // YYYY-MM-DD — fin del término (R10: fin de vigencia de excusas)
  // Ronda 22 (Fase P3 — evidencia): secret de cifrado AES-GCM de los soportes fotográficos
  // (fallback: EXCUSE_CHAIN_SECRET → AUTH_TOKEN). Sin secret → uploads rechazados 503 (jamás se
  // guarda un soporte sin cifrar).
  EXCUSE_ATTACHMENT_SECRET?: string;
  // Ronda 22 (Fase P4 — retención Ley 1581): meses de conservación de las excusas (y sus
  // soportes) tras su fecha final. Default 12 ("término +1 año"). 0 = sin purga automática.
  EXCUSE_RETENTION_MONTHS?: string;
  // Ronda 23 (Fase P4 — WEB PUSH de excusas, RFC 8030/8291/8292): claves VAPID del
  // servidor de notificaciones. Se configuran con `wrangler secret put VAPID_*`.
  // Sin claves → GET /api/push/public-key responde 503 y la app no ofrece notificaciones.
  VAPID_PUBLIC_KEY?: string;   // clave pública P-256 (base64url, 87 chars)
  VAPID_PRIVATE_KEY?: string;  // escalar privado P-256 (base64url, 43 chars)
  VAPID_SUBJECT?: string;      // contacto VAPID (mailto: o https:)

  // Ronda 49 (Identidad-nube, Opción B): cuando el cliente envía un ID token de
  // Firebase (X-Firebase-Id-Token), el Worker lo VERIFICA (firma RS256 con llaves
  // públicas de Google) y LEE el ROL del perfil users/{uid} en Firestore vía la
  // cuenta de servicio. Así la autorización es por IDENTIDAD (el rol del usuario),
  // no por token de dispositivo. FIREBASE_PROJECT_ID y FIREBASE_DB_ID son VARS
  // (públicas, en wrangler.toml); la cuenta de servicio va como SECRET.
  FIREBASE_PROJECT_ID?: string;       // p. ej. gen-lang-client-0224520207
  FIREBASE_DB_ID?: string;            // p. ej. ai-studio-sistemaderegistr-... (la BD nombrada)
  FIREBASE_SA_CLIENT_EMAIL?: string;  // SECRET — client_email de la SA
  FIREBASE_SA_PRIVATE_KEY?: string;   // SECRET — private_key PEM de la SA
}

// Encabezados de CORS para permitir conexiones seguras desde cualquier frontend o app móvil
// Ronda 24 (fix crítico): PATCH faltaba → el preflight rechazaba TODA decisión de
// excusas (aprobar/rechazar) desde el navegador con "Failed to fetch" — el rector no
// podía decidir ninguna excusa radicada desde otro dispositivo.
// Ronda 51 (fix crítico, autorizado por el propietario): el cliente envía X-Device-Id y
// X-Device-Name (R48, SIEMPRE) y X-Firebase-Id-Token (R49, con sesión Firebase), pero
// este Allow-Headers no los declaraba → el preflight OPTIONS los rechazaba y TODA
// llamada del navegador al Worker caía en "Failed to fetch" (Pull/Push, ficha del
// docente en teléfono nuevo). Se añaden los tres; nada más cambia.
// Ronda 58 (F-17): el Allow-Origin '*' fue RETIRADO. Los headers base (métodos,
// allow-headers, max-age) viven en ./cors.ts; el origen permitido se resuelve POR
// REQUEST contra una allowlist (producción Pages + previews + localhost + dominio
// del colegio en ALLOWED_ORIGINS) en el wrapper del fetch handler. Las respuestas
// de navegadores con origen no permitido salen SIN Access-Control-Allow-Origin
// (el navegador las bloquea) y los preflight de esos orígenes reciben 403.
// Compat: push.ts importa `corsHeaders` desde aquí — se mantiene el export como
// alias de los headers base (sin origen).
const corsHeaders = { ...corsBaseHeaders };
export { corsHeaders };

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function errorResponse(message: string, status = 400, details?: any) {
  return jsonResponse({ success: false, error: message, details }, status);
}

// Ronda 58: timingSafeEqual / verifyAuth / resolveTokenScope / verifyFirebaseIdentity /
// resolveAuthz / filterSnapshotByRole viven en authz.ts (re-exportados arriba).
// verifyAuth fue ELIMINADO: no tenía llamadores (el router usa resolveAuthz).

// ------------------------------------------------------------------------------
// Flanco 2 — identidad de dispositivo: origen determinista y estable del terminal.
// Acepta el header X-Device-Id (preferente, enviado por el cliente) o el cuerpo; si no
// hay, cae a un hash de la IP + user-agent (identidad de fallback, no perfecta pero
// trazable). El nombre amigable viene del cuerpo (deviceName) o del header X-Device-Name.
// ------------------------------------------------------------------------------
function getDeviceContext(request: Request, body: any, env: Env): { deviceId: string; deviceName: string } {
  const ip = clientIp(request);
  const ua = request.headers.get('User-Agent') || '';
  const deviceId =
    (typeof body?.deviceId === 'string' && body.deviceId.trim()) ||
    request.headers.get('X-Device-Id')?.trim() ||
    `device-${hashString(ip)}-${hashString(ua).slice(0, 6)}`;
  const deviceName =
    (typeof body?.deviceName === 'string' && body.deviceName.trim()) ||
    request.headers.get('X-Device-Name')?.trim() ||
    'Terminal sin nombre';
  return { deviceId, deviceName };
}

// Hash simple FNV-1a no criptográfico para el deviceId de fallback (no es un secreto).
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ------------------------------------------------------------------------------
// Flanco 2/3 — tablas del guard de sync (creadas bajo demanda, idempotentes).
// ------------------------------------------------------------------------------
async function ensureSyncGuardTables(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS catalog_versions (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         school_code TEXT NOT NULL,
         version INTEGER NOT NULL DEFAULT 0,
         updated_by_device TEXT,
         updated_by_role TEXT,
         updated_at TEXT DEFAULT (datetime('now'))
       )`
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS device_sync_log (
         id TEXT PRIMARY KEY,
         device_id TEXT NOT NULL,
         device_name TEXT,
         role TEXT NOT NULL,
         action TEXT NOT NULL,
         school_code TEXT,
         catalog_version INTEGER,
         students_count INTEGER,
         records_count INTEGER,
         details_json TEXT,
         created_at TEXT DEFAULT (datetime('now'))
       )`
    ).run();
  } catch (e: any) {
    console.warn('[sync_guard] ensure tables no crítico:', e?.message || e);
  }
}

async function getCatalogVersion(env: Env, schoolCode: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    await ensureSyncGuardTables(env);
    const row = await env.DB.prepare(
      `SELECT version FROM catalog_versions WHERE id = 1 AND school_code = ?`
    ).bind(schoolCode).first<{ version: number }>();
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

async function bumpCatalogVersion(env: Env, schoolCode: string, deviceId: string, role: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    await ensureSyncGuardTables(env);
    const cur = await getCatalogVersion(env, schoolCode);
    const next = cur + 1;
    await env.DB.prepare(
      `INSERT INTO catalog_versions (id, school_code, version, updated_by_device, updated_by_role, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         version=excluded.version, updated_by_device=excluded.updated_by_device,
         updated_by_role=excluded.updated_by_role, updated_at=datetime('now')`
    ).bind(schoolCode, next, deviceId, role).run();
    return next;
  } catch {
    return 0;
  }
}

// Registro APPEND-ONLY en device_sync_log. El Worker SOLO inserta — jamás UPDATE/DELETE.
async function logDeviceSync(env: Env, entry: {
  deviceId: string; deviceName: string; role: string; action: string;
  schoolCode: string; catalogVersion?: number | null; studentsCount: number; recordsCount: number; details?: any;
}): Promise<void> {
  if (!env.DB) return;
  try {
    await ensureSyncGuardTables(env);
    const id = `dsl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await env.DB.prepare(
      `INSERT INTO device_sync_log
        (id, device_id, device_name, role, action, school_code, catalog_version, students_count, records_count, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, entry.deviceId, entry.deviceName, entry.role, entry.action, entry.schoolCode,
      entry.catalogVersion ?? null, entry.studentsCount, entry.recordsCount,
      entry.details ? JSON.stringify(entry.details).slice(0, 2000) : null
    ).run();
  } catch { /* el log jamás rompe el push */ }
}

// Version de un registro para merge LWW (Flanco 4 + Ronda 54 hueco #4):
//  1) serverUpdatedAt — asignada por el SERVIDOR en el push (determinista, inmune a
//     relojes de dispositivo desincronizados / clock-skew). Es la fuente de verdad.
//  2) updatedAt / timestamp — versiones locales heredadas (fallback).
// Nunca vacío → '' (un registro sin versión nunca gana a uno con versión).
export function recordVersion(r: any): string {
  return (r && (r.serverUpdatedAt || r.updatedAt || r.timestamp)) || '';
}

// Merge de HECHOS por id + versión (Flanco 4 + hueco #4): la versión del DATO decide;
// si el registro previo no trae versión, el entrante gana. Se usa para fusionar los
// registros del operador dentro del snapshot vigente sin machacar el catálogo, y para
// preservar el histórico acumulado en el push ADMIN (Ronda 53).
export function mergeRecordsByUpdatedAt(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of existing || []) if (r && r.id) map.set(String(r.id), r);
  for (const r of incoming || []) {
    if (!r || !r.id) continue;
    const prev = map.get(String(r.id));
    if (!prev) { map.set(String(r.id), r); continue; }
    const prevA = recordVersion(prev);
    const inA = recordVersion(r);
    // Gana el más nuevo por versión (serverUpdatedAt → updatedAt → timestamp). Reglas:
    //  - entrante SIN versión: solo gana si el previo tampoco la tiene (no pisar dato
    //    fechado con uno sin fecha).
    //  - previo SIN versión: el entrante gana (el previo es no-datable, se confía en el push).
    //  - ambos con versión: gana el mayor; empate → entrante.
    if (!inA) {
      if (!prevA) map.set(String(r.id), r);
    } else if (!prevA || inA >= prevA) {
      map.set(String(r.id), r);
    }
  }
  return Array.from(map.values());
}

// Ronda 60-b (H-3) — FUSIÓN DE TOMBSTONES por type+id conservando la baja MÁS
// RECIENTE. Los tombstones no traen updatedAt/serverUpdatedAt (traen deletedAt),
// así que mergeRecordsByUpdatedAt los trataba como "sin versión" y el ENTRANTE
// ganaba siempre: un deletedAt viejo podía sobrevivir a una baja más nueva y el
// filtro F-8 (entDate > deletedAt) resucitaba la entidad tras una re-escritura
// posterior a la baja real. Esta fusión además deduplica por entidad.
export function mergeTombstones(prev: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  const tombKey = (t: any) => `${t?.type === 'teacher' ? 't' : 's'}:${String(t?.id)}`;
  const tombTime = (t: any) => {
    const p = Date.parse(String(t?.deletedAt || ''));
    return Number.isFinite(p) ? p : 0;
  };
  for (const t of [...(prev || []), ...(incoming || [])]) {
    if (!t || t.id === undefined || t.id === null) continue;
    const k = tombKey(t);
    const cur = map.get(k);
    if (!cur || tombTime(t) >= tombTime(cur)) map.set(k, t);
  }
  return Array.from(map.values());
}

// Ronda 54 (hueco #4) — SELLO DE VERSIÓN DE SERVIDOR. Tras fusionar, el Worker asigna a
// CADA registro la versión monotónica del servidor (`serverUpdatedAt = now`), sobrescribiendo
// cualquier timestamp local. Así el LWW de cada registro queda DETERMINISTA: es "el que el
// servidor procesó más tarde", no "el que el reloj del dispositivo dijo más tarde". Solo
// marca los registros que el push realmente tocó (los heredados conservan su versión previa).
// Devuelve los registros ya sellados.
export function stampServerVersion(records: any[]): any[] {
  const now = new Date().toISOString();
  return (records || []).map((r: any) => {
    if (!r || !r.id) return r;
    return { ...r, serverUpdatedAt: now };
  });
}

// ==============================================================================
// Ronda 58 (F-6) — ESCRITURA DEL SNAPSHOT CON CAS (compare-and-swap).
//
// ANTES: el camino de operador hacía SELECT → merge en memoria → INSERT OR REPLACE,
// sin exclusión mutua. Dos docentes que pushean en la misma ventana se pisaban la
// fusión: el último en escribir ELIMINABA del snapshot las asistencias del primero
// (pérdida silenciosa de datos; D1 no ofrece transacciones read-then-write por HTTP).
//
// AHORA: la escritura se hace con guard de versión sobre `updated_at` (precisión
// de milisegundos) y REINTENTO con re-lectura + re-fusión (hasta 3 intentos). Si
// otro push gana la carrera, este la pierde, RE-LEE el snapshot ya actualizado y
// fusiona sus registros encima — nadie pierde datos. Si los 3 intentos fallan
// (contención extrema), se degrada honestamente al INSERT final (comportamiento
// previo) y se registra en el log del Worker.
// ==============================================================================
const SNAPSHOT_MAX_CAS_ATTEMPTS = 3;

export async function casWriteSnapshot(
  env: Env,
  schoolCode: string,
  mutate: (prev: any, row: { students_count?: number; school_name?: string | null } | null) => {
    data: any;
    studentsCount: number;
    recordsCount: number;
    schoolName: string;
  }
): Promise<boolean> {
  const snapshotId = `snapshot_${schoolCode}`;
  for (let attempt = 0; attempt < SNAPSHOT_MAX_CAS_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare(
      `SELECT data_json, students_count, school_name, updated_at FROM sync_snapshots WHERE id = ?`
    ).bind(snapshotId).first<{ data_json: string; students_count: number; school_name: string | null; updated_at: string }>();

    const prev = row?.data_json ? safeJsonParse(row.data_json) : null;
    const out = mutate(prev ?? null, row ?? null);

    if (!row) {
      // Primera escritura: INSERT OR IGNORE gana la carrera de creación; si otro
      // la ganó, se reintenta como UPDATE (re-leyendo lo que el ganador escribió).
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO sync_snapshots (id, school_code, school_name, data_json, students_count, records_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      ).bind(snapshotId, schoolCode, out.schoolName, JSON.stringify(out.data), out.studentsCount, out.recordsCount).run();
      const changes = (r as any)?.meta?.changes;
      if (changes === undefined || changes > 0) return true;
      continue; // alguien creó el snapshot entre el SELECT y el INSERT → reintentar como update
    }

    const r = await env.DB.prepare(
      `UPDATE sync_snapshots SET school_name = ?, data_json = ?, students_count = ?, records_count = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND updated_at = ?`
    ).bind(out.schoolName, JSON.stringify(out.data), out.studentsCount, out.recordsCount, snapshotId, row.updated_at).run();
    const changes = (r as any)?.meta?.changes;
    if (changes === undefined || changes > 0) return true;
    // changes === 0 → otro push escribió entre nuestro SELECT y nuestro UPDATE → reintentar.
  }
  console.warn(`[sync/push] CAS: ${SNAPSHOT_MAX_CAS_ATTEMPTS} intentos con contención; última escritura gana (degradación honesta, se registra).`);
  return false;
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

// ==============================================================================
// Ronda 58 (F-23) — SANITIZACIÓN DE CREDENCIALES EN EL SNAPSHOT (defensa en
// profundidad del lado del servidor).
//
// El cliente nuevo ya envía `tempPasswordVerifier` (HMAC) en vez de la clave en
// claro (ver cloudflareSync.sanitizeStudentsForSync). Este strip del Worker
// protege contra terminales VIEJOS que todavía suban `tempPassword` /
// `password` / `passwordHash` en el payload: la clave en claro JAMÁS debe
// quedar persistida en el snapshot de D1/KV, donde cualquier poseedor de un
// token de operador puede leerla (y con ella entrar al portal de cualquier
// estudiante — hallazgo F-23 del informe de auditoría 2026-09).
// ==============================================================================
export function stripSnapshotCredentials(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const out: any = { ...data };
  if (Array.isArray(out.students)) {
    out.students = out.students.map((s: any) => {
      if (!s || typeof s !== 'object') return s;
      const { tempPassword: _tp, password: _pw, passwordHash: _ph, ...rest } = s;
      void _tp; void _pw; void _ph;
      return rest;
    });
  }
  if (Array.isArray(out.teachers)) {
    out.teachers = out.teachers.map((t: any) => {
      if (!t || typeof t !== 'object') return t;
      const { tempPassword: _tp, password: _pw, passwordHash: _ph, ...rest } = t;
      void _tp; void _pw; void _ph;
      return rest;
    });
  }
  return out;
}

// ==============================================================================
// Ronda 28 — PURGA DE LA NUBE con rate limit (defensa en profundidad, patrón
// H-2 de push.ts): máx. 3 purgas por hora por IP. El Map vive mientras viva el
// isolate — suficiente contra abuso casual; la barrera real es el AUTH_TOKEN
// (guard global) + confirmación textual "PURGAR" en el cuerpo.
// ==============================================================================
const PURGE_HITS = new Map<string, number[]>();
const PURGE_LIMIT_PER_HOUR = 3;

function purgeRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const hits = (PURGE_HITS.get(ip) || []).filter((t) => t > windowStart);
  if (hits.length >= PURGE_LIMIT_PER_HOUR) {
    PURGE_HITS.set(ip, hits);
    return true;
  }
  hits.push(now);
  PURGE_HITS.set(ip, hits);
  return false;
}

// ==============================================================================
// Ronda 60-b (B-1) — VERIFICACIÓN DE TARJETA con rate limit: /api/verify/
// class-token es PÚBLICO (el portal del estudiante no porta token de
// dispositivo). Ventana en-memoria del isolate (mismo patrón de la purga R28):
// disuade el forceo masivo de tokens; la barrera estructural es que el token
// firmado HMAC es infalsificable y la respuesta jamás revela el secret.
// 60 verificaciones / 5 min / IP: holgado para un aula real escaneando en fila.
// ==============================================================================
const VERIFY_HITS = new Map<string, number[]>();
const VERIFY_LIMIT_PER_WINDOW = 60;
const VERIFY_WINDOW_MS = 5 * 60 * 1000;

function verifyRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - VERIFY_WINDOW_MS;
  const hits = (VERIFY_HITS.get(ip) || []).filter((t) => t > windowStart);
  if (hits.length >= VERIFY_LIMIT_PER_WINDOW) {
    VERIFY_HITS.set(ip, hits);
    return true;
  }
  hits.push(now);
  VERIFY_HITS.set(ip, hits);
  return false;
}

// ==============================================================================
// Ronda 39 (H-39-1) — CONVERGENCIA DE ENLACES DE EXCUSAS EN /api/sync/pull.
// El snapshot (KV o sync_snapshots) se escribe SOLO en /api/sync/push, pero las
// radicaciones/aprobaciones de la API de excusas actualizan D1 en vivo
// (student_excuses + attendance_records.excuse_id) SIN tocar el snapshot. Un
// dispositivo que hace Pull recibía registros con el enlace obsoleto (excuseId
// null) y la Planilla le ofrecía "Justificar" sobre una ausencia ya justificada
// (el Worker lo bloquea con R2 — correcto, pero es confusión evitable).
// Fix: antes de servir el snapshot, se inyecta el estado VIVO de D1:
//  - enlace existe en D1 y difiere del snapshot → se inyecta (+stamp para que el
//    cliente lo aplique por regla 1 de convergencia Ronda 21);
//  - snapshot trae enlace que D1 ya no tiene (purga/unlink) → se retira con stamp
//    nuevo (regla 2 del cliente converge al clear).
// Coste: 2 consultas D1 por pull solo si hay registros en el payload. Nunca lanza
// (fallos → snapshot intacto; el pull jamás se rompe por esto).
// ==============================================================================
async function injectExcuseLinks(env: Env, data: any): Promise<void> {
  try {
    if (!env.DB || !data || !Array.isArray(data.records) || data.records.length === 0) return;
    const CH = 90; // SQLite máx. variables — chunking conservador
    const ids = data.records.map((r: any) => String(r.id)).filter(Boolean);
    const d1State = new Map<string, { excuseId: string | null; excuseStatus: string | null }>();
    for (let i = 0; i < ids.length; i += CH) {
      const chunk = ids.slice(i, i + CH);
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT r.id AS rid, r.excuse_id AS eid, e.status AS est
         FROM attendance_records r LEFT JOIN student_excuses e ON e.id = r.excuse_id
         WHERE r.id IN (${ph})`
      ).bind(...chunk).all<{ rid: string; eid: string | null; est: string | null }>();
      for (const row of (rows.results || [])) {
        d1State.set(row.rid, { excuseId: row.eid || null, excuseStatus: row.est || null });
      }
    }
    if (d1State.size === 0) return;
    const stamp = new Date().toISOString();
    let patched = 0;
    data.records = data.records.map((r: any) => {
      const live = d1State.get(String(r.id));
      if (!live) return r;
      if (live.excuseId && (live.excuseId !== r.excuseId || live.excuseStatus !== r.excuseStatus)) {
        patched++;
        return { ...r, excuseId: live.excuseId, excuseStatus: live.excuseStatus, excuseUpdatedAt: stamp };
      }
      if (!live.excuseId && r.excuseId) {
        patched++;
        const { excuseId: _e, excuseStatus: _s, ...rest } = r;
        return { ...rest, excuseUpdatedAt: stamp };
      }
      return r;
    });
    if (patched > 0) {
      console.log(`[sync/pull] H-39-1: ${patched} registro(s) convergido(s) con el estado vivo de excusas en D1.`);
    }
  } catch (e: any) {
    console.warn('[sync/pull] injectExcuseLinks no crítico:', e?.message || e);
  }
}

// Ronda 58: clientIp / verifyFirebaseIdentity / resolveAuthz / filterSnapshotByRole
// viven en ./authz.ts (importados y re-exportados arriba).

// ==============================================================================
// Ronda 54 — PULL INCREMENTAL (`since`) + PULL DE HECHOS (`scope=facts`).
// `filterRecordsSince`: conserva solo los registros con updatedAt/timestamp >= `since`.
// Un registro sin fecha jamás se descarta (mejor tenerlo de más que perderlo). Sin
// `since` devuelve todo (retrocompat 100%). Se aplica después del scoping por rol.
// `scope=facts` pide SOLO los hechos (records): útil para que Rectoría baje los
// escaneos que hicieron docentes/estudiantes SIN reemplazar su catálogo local.
// ==============================================================================
export function filterRecordsSince(records: any[], since?: string | null): any[] {
  if (!since || !Array.isArray(records)) return records || [];
  const t = Date.parse(since);
  if (Number.isNaN(t)) return records || [];
  return records.filter((r: any) => {
    // Ronda 54 (hueco #4): comparar por la VERSIÓN DE SERVIDOR (serverUpdatedAt) primero,
    // porque un dispositivo con el reloj atrasado podría subir un hecho con `timestamp`
    // anterior al cursor; si filtráramos por timestamp local, ese hecho NUNCA se bajaría
    // en el pull incremental (clock-skew). La versión del servidor es monotónica y lo resuelve.
    const stamp = r && (r.serverUpdatedAt || r.updatedAt || r.timestamp || '');
    if (!stamp) return true;             // sin fecha → conservar
    const s = Date.parse(stamp);
    if (Number.isNaN(s)) return true;    // fecha ilegible → conservar
    return s >= t;
  });
}

// ==============================================================================
// Ronda 54 (hueco #5) — TOMBSTONES / SOFT-DELETE. Un estudiante o docente eliminado en un
// dispositivo debe PRODUCIRSE a los demás y NO resucitar en el próximo pull. Al eliminar,
// el cliente crea un tombstone `{ id, type: 'student'|'teacher', deletedAt }` que viaja en
// el push. El Worker lo conserva en el snapshot y, al servir el pull, FILTRA los catálogos
// para que ningún terminal vuelva a recibir la entidad borrada. Los registros de asistencia
// de un estudiante eliminado se conservan (Ley 1581: el agregado NO se pierde), pero la
// entidad ya no aparece en la matrícula (no resucita).
// ==============================================================================
export function applyTombstones(data: any): any {
  if (!data) return data;
  const tombstones: any[] = Array.isArray(data.tombstones) ? data.tombstones : [];
  if (tombstones.length === 0) return data;
  // Ronda 58 (F-8): mapa id → deletedAt. El filtro de entidades compara FECHAS:
  // una entidad cuyo updatedAt/createdAt es POSTERIOR al tombstone fue RE-MATRICULADA
  // (revivida) y NO se filtra. Las entidades sin fecha tratan el tombstone como
  // vigente (comportamiento previo — mejor perder la entidad que resucitar un borrado).
  const tombDeletedAt = new Map<string, number>();
  for (const t of tombstones) {
    if (!t || !t.id) continue;
    const key = t.type === 'teacher' ? `t:${String(t.id)}` : `s:${String(t.id)}`;
    const ts = Date.parse(String(t.deletedAt || ''));
    const prev = tombDeletedAt.get(key) ?? -Infinity;
    tombDeletedAt.set(key, Number.isNaN(ts) ? prev : Math.max(prev, ts));
  }
  const entityNewerThanTombstone = (id: string, type: 'student' | 'teacher', entity: any): boolean => {
    const deletedAt = tombDeletedAt.get(type === 'teacher' ? `t:${String(id)}` : `s:${String(id)}`);
    if (deletedAt === undefined) return false; // no hay tombstone → no aplica el filtro
    const entDate = Date.parse(String(entity?.updatedAt || entity?.createdAt || ''));
    if (Number.isNaN(entDate) || !entDate) return false; // sin fecha: el tombstone manda
    return entDate > deletedAt; // la entidad es MÁS NUEVA que su tombstone → revive
  };
  const studentIds = new Set<string>(Array.from(tombDeletedAt.keys()).filter(k => k.startsWith('s:')).map(k => k.slice(2)));
  const teacherIds = new Set<string>(Array.from(tombDeletedAt.keys()).filter(k => k.startsWith('t:')).map(k => k.slice(2)));
  const result: any = { ...data };
  if (Array.isArray(data.students) && studentIds.size > 0) {
    result.students = data.students.filter((s: any) => s && !(studentIds.has(String(s.code)) && !entityNewerThanTombstone(s.code, 'student', s)));
  }
  if (Array.isArray(data.teachers) && teacherIds.size > 0) {
    result.teachers = data.teachers.filter((t: any) => t && !(teacherIds.has(String(t.id)) && !entityNewerThanTombstone(t.id, 'teacher', t)));
  }
  // Records: se conservan (agregado), pero se retira el identificador personal si la entidad
  // fue eliminada, cumpliendo la minimización de la Ley 1581 (anonimización, no borrado).
  if (Array.isArray(data.records) && studentIds.size > 0) {
    result.records = data.records.map((r: any) => {
      if (!r) return r;
      if (r.studentCode && studentIds.has(String(r.studentCode))) {
        const { studentName: _n, studentCode: _c, studentDocument: _d, ...rest } = r;
        return { ...(rest as any), studentName: 'Estudiante retirado', studentCode: `RET-${String(r.studentCode).slice(0, 8)}`, studentDocument: '_anon' };
      }
      return r;
    });
  }
  return result;
}

// ==============================================================================
// Ronda 58 (F-17): WRAPPER DE CORS. Todo el enrutamiento vive en handleRoute;
// este wrapper añade los headers CORS SOLO si el Origin del request está en la
// allowlist (ver ./cors.ts) y responde los preflight OPTIONS (403 a orígenes
// desconocidos). Los requests sin Origin (curl/Node/suites/healthchecks) pasan
// intactos: CORS es una política de navegador, no del servidor.
// ==============================================================================
async function handleRoute(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

    try {
      // =========================================================================
      // RUTA: HEALTH CHECK & ESTADO DE CAPACIDADES
      // =========================================================================
      if (path === '/' || path === '/api/health') {
        const hasD1 = !!env.DB;
        const hasKV = !!env.ATTENDANCE_KV;
        return jsonResponse({
          status: 'online',
          service: 'INAS Attendance Cloudflare Edge Worker',
          school: env.SCHOOL_NAME || 'Institución Educativa Antonia Santos',
          schoolCode: env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026',
          storage: {
            d1: hasD1 ? 'connected' : 'unconfigured',
            kv: hasKV ? 'connected' : 'unconfigured'
          },
          ai: {
            mode: 'client-side-byok',
            note: 'La IA se ejecuta en el navegador del usuario con su propia clave API. El Worker ya no integra proveedores de IA.'
          },
          timestamp: new Date().toISOString()
        });
      }

      // =========================================================================
      // RUTAS IA RETIRADAS (01/09/2026, decisión del propietario):
      // La IA se ejecuta 100% LOCAL en el navegador (cliente directo BYOK con la
      // clave del administrador). Los proveedores bloquean el egreso de datacenters
      // (Groq -> 403), por lo que el proxy de IA en este Worker era inviable.
      // Stub de migración: respuesta explícita para clientes antiguos en caché.
      // =========================================================================
      if (path.startsWith('/api/ai/')) {
        return jsonResponse({
          success: false,
          code: 'AI_REMOVED_FROM_WORKER',
          error: 'Las rutas de IA fueron retiradas del Worker. La IA ahora se ejecuta localmente en el navegador con la clave API del administrador (BYOK). Actualiza la aplicación (Ctrl+F5).'
        }, 410);
      }

      // Validar autenticación para el resto de rutas de datos. Ronda 49 (identidad-nube):
      // una credencial VÁLIDA puede ser un ID token de Firebase (identidad) o el token de
      // dispositivo (AUTH_TOKEN / OPERATOR_TOKEN). resolveAuthz unifica ambos y devuelve
      // null solo si NO hay ninguna credencial válida. Si no está configurada la SA, la
      // identidad se degrada silenciosamente al token de dispositivo (retrocompat 100%).
      const authz = await resolveAuthz(request, env);
      if (!authz) {
        return errorResponse('No autorizado. Credencial inválida o ausente.', 401);
      }

      // =========================================================================
      // RUTA: SYNC PUSH (Subida masiva o actualización desde Terminal Local)
      // =========================================================================
      if (path === '/api/sync/push' && request.method === 'POST') {
        const body = await request.json() as any;
        const schoolCode = body.schoolCode || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';
        const data = body.data || body;
        const students = Array.isArray(data.students) ? data.students : [];
        const records = Array.isArray(data.records) ? data.records : [];
        const teachers = Array.isArray(data.teachers) ? data.teachers : [];

        // =========================================================================
        // Ronda 47 (Fase 2 — Flanco 1/2/3): ALCANCE DEL TOKEN EN EL PUSH.
        // - ADMIN (AUTH_TOKEN / modo abierto) → push COMPLETO: reemplaza el snapshot
        //   (catálogo + hechos), upserta catálogo, incrementa catalog_version.
        // - OPERATOR (OPERATOR_TOKEN, docente/encargada) → push de HECHOS SOLO: sus
        //   registros de asistencia se fusionan por id+updatedAt dentro del snapshot
        //   vigente (SIN machacar el catálogo que escribió Rectoría) y NO se incrementa
        //   catalog_version. Un terminal con el catálogo viejo ya no puede aplastar los
        //   cambios de Rectoría.
        // =========================================================================
        const tokenRole = authz.role; // 'ADMIN'|'OPERATOR' (token) o 'ADMIN'|'DOCENTE'|'ESTUDIANTE_ACUDIENTE' (identidad)
        const device = getDeviceContext(request, body, env);
        const isAdmin = authz.canWriteCatalog; // solo ADMIN (token o identidad) escribe catálogo
        const isOperator = !isAdmin; // OPERATOR (token) o DOCENTE/ESTUDIANTE (identidad) → solo hechos
        const bodyCatalogVersion = (typeof body.catalogVersion === 'number') ? body.catalogVersion : null;

        // Ronda 54 (hueco #2) — IDEMPOTENCIA POR `opId` (at-least-once sin duplicados).
        // El cliente envía un opId ESTABLE por push (hash del payload). Si el Worker ya
        // procesó ese opId (reintento de un push que llegó pero cuya respuesta se perdió),
        // devuelve el resultado con `deduplicated:true` SIN volver a aplicar el snapshot
        // ni a incrementar catalog_version. Se guarda en KV con TTL (dedup ventana).
        // Sin `opId` (clientes viejos) se omite por completo: comportamiento previo.
        const opId = typeof body.opId === 'string' && body.opId.trim() ? body.opId.trim() : null;
        if (opId && env.ATTENDANCE_KV) {
          try {
            const dedupKey = `sync_opid_${schoolCode}_${opId}`;
            const prior = await env.ATTENDANCE_KV.get(dedupKey, 'json') as any;
            if (prior && prior.ok) {
              return jsonResponse({
                success: true,
                deduplicated: true,
                message: 'Push ya procesado (opId duplicado): resultado devuelto sin re-aplicar.',
                catalogVersion: prior.catalogVersion ?? null,
                studentsSaved: prior.studentsSaved ?? 0,
                recordsSaved: prior.recordsSaved ?? 0,
                timestamp: prior.timestamp || new Date().toISOString()
              });
            }
          } catch {
            /* si el guard de dedup falla, el push sigue su curso (at-least-once) */
          }
        }

        // Flanco 3 — CAS de catálogo para pushes ADMIN: si el terminal declara una
        // catalog_version MENOR que la vigente, Rectoría no debe pisar la nube sin antes
        // re-ubicarse. Solo se aplica si el cliente la envía (retrocompat: clientes viejos
        // no la mandan → sin fricción). force:true es el escape explícito de Rectoría.
        if (isAdmin && bodyCatalogVersion !== null && !body.force && env.DB) {
          const currentVersion = await getCatalogVersion(env, schoolCode);
          if (bodyCatalogVersion < currentVersion) {
            return errorResponse(
              `Push rechazado (catálogo obsoleto): tu terminal tiene el catálogo v${bodyCatalogVersion} pero la nube está en v${currentVersion}. Descarga primero con Pull (/api/sync/pull) y reintenta. Si eres Rectoría y sabes lo que haces, envía force:true.`,
              409,
              { catalogVersion: currentVersion, sentVersion: bodyCatalogVersion }
            );
          }
        }

        // Ronda 38 (H-38-1b): PROTECCIÓN ANTI-APLASTADO server-side (defensa en profundidad
        // de la guarda del cliente en cloudflareSync.ts). Un dispositivo cuyo localStorage
        // se perdió (perfil reiniciado, corrupción — incidente real detectado en QA Ronda 38)
        // empujaría un payload con 0 estudiantes y sobreescribiría la matrícula completa de
        // D1/KV. Si el snapshot vigente tiene estudiantes y el push entrante trae 0, se
        // rechaza con 409 salvo force:true. Vaciar de verdad sigue siendo posible con
        // force:true o con la purga del panel. Solo aplica a pushes ADMIN de catálogo.
        if (isAdmin && students.length === 0 && !body.force && env.DB) {
          try {
            const row = await env.DB.prepare(
              `SELECT students_count FROM sync_snapshots WHERE id = ?`
            ).bind(`snapshot_${schoolCode}`).first() as any;
            if (row && (row.students_count || 0) > 0) {
              return errorResponse(
                `Push rechazado (anti-aplastado): el payload trae 0 estudiantes pero la nube tiene ${row.students_count}. Si tu terminal perdió sus datos locales, recupéralos con Pull (/api/sync/pull); para vaciar la nube intencionadamente envía force:true.`,
                409
              );
            }
          } catch { /* si la lectura del snapshot falla, el push sigue su curso previo */ }
        }

        // 1. Guardar Snapshot en D1 — SOLO en push de catálogo (ADMIN). Un operador
        //    NO reemplaza el snapshot (su catálogo podría estar obsoleto); solo fusiona
        //    sus hechos en el snapshot vigente (ver camino de operador más abajo).
        //    Ronda 53 (FIX PÉRDIDA DE DATOS): el push ADMIN reemplazaba el snapshot con
        //    `data` tal cual, y el cliente manda `records` capado a los últimos 500
        //    (slice(0,500)). Resultado: a partir de 500 registros, el snapshot (que sirve
        //    /api/sync/pull) perdía los más antiguos → planillas/clientes con datos en falta
        //    a escala (un día completo de escaneos ≈ 500+, una semana ≫ 500). Como la
        //    matrícula SÍ es de Rectoría (catálogo) pero los HECHOS (asistencia/excusas) los
        //    capturan docentes/estudiantes, el catálogo entrante se conserva y SOLO se
        //    FUSIONAN los records por id+updatedAt (misma primitiva `mergeRecordsByUpdatedAt`
        //    del camino operador), preservando el histórico acumulado. Es ADITIVO: jamás
        //    borra un registro que ya estaba en el snapshot.
        let adminSnapshotData: any = data;
        let adminRecordsCount = records.length;
        if (isAdmin && env.DB) {
          // =========================================================================
          // Ronda 58 (F-6 + F-7 + F-8 + F-23) — reescritura del camino ADMIN:
          //   F-6: la escritura del snapshot es CAS (guard sobre updated_at + re-
          //        intento con re-fusión) — ver casWriteSnapshot. Un push ADMIN que
          //        llegue tras un push de operador ya no PISA sus asistencias.
          //   F-7: el sello de servidor (serverUpdatedAt) se aplica SOLO a los
          //        registros ENTRANTES de este push, ANTES de fusionar. Antes se
          //        sellaba el array fusionado completo → los registros heredados
          //        heredaban un "now" falso y podían ganar por LWW a ediciones
          //        legítimas aún no subidas desde un terminal offline.
          //   F-8: REVIVIFICACIÓN — si el catálogo entrante contiene el código
          //        (re-matrícula), el tombstone de esa entidad se RETIRA del
          //        snapshot (un código re-matriculado vuelve a vivir; antes quedaba
          //        muerto para siempre porque la unión de tombstones lo re-añadía).
          //   F-23: strip de credenciales en claro (tempPassword/password) del
          //        snapshot antes de persistirlo — defensa en profundidad para
          //        terminales viejos que aún las suban.
          // =========================================================================
          try {
            // F-7 (refinado por Ronda 60-b, H-2): fusión PRIMERO con las versiones
            // verdaderas y sello SOLO a los entrantes que GANARON el LWW. El sello
            // ANTES del merge hacía ganar a CUALQUIER copia entrante (su
            // serverUpdatedAt=now vencía siempre), incluso a una copia obsoleta que
            // llegaba tarde y REGRESABA el dato fusionado. El set de referencias
            // distingue un ganador entrante de un registro heredado del snapshot.
            const incomingSet = new Set<any>((records || []).filter((r: any) => r && r.id));
            const stampWinner = (r: any) => (incomingSet.has(r) ? stampServerVersion([r])[0] : r);
            const written = await casWriteSnapshot(env, schoolCode, (prev, row) => {
              let mergedRecords: any[];
              let mergedTombstones: any[];
              if (prev) {
                const prevRecords = Array.isArray(prev.records) ? prev.records : [];
                mergedRecords = mergeRecordsByUpdatedAt(prevRecords, records).map(stampWinner);
                const prevTombs = Array.isArray(prev.tombstones) ? prev.tombstones : [];
                const incomingTombs = Array.isArray(data.tombstones) ? data.tombstones : [];
                // Ronda 60-b (H-3): fusión por type+id con la baja más reciente.
                mergedTombstones = mergeTombstones(prevTombs, incomingTombs);
                // F-8: retirar tombstones de entidades re-matriculadas en ESTE push.
                const incomingStudentIds = new Set(students.map((s: any) => String(s?.code)));
                const incomingTeacherIds = new Set(teachers.map((t: any) => String(t?.id)));
                mergedTombstones = mergedTombstones.filter((t: any) => {
                  if (!t || !t.id) return true;
                  if (t.type === 'student' && incomingStudentIds.has(String(t.id))) return false;
                  if (t.type === 'teacher' && incomingTeacherIds.has(String(t.id))) return false;
                  return true;
                });
              } else {
                mergedRecords = stampServerVersion(records); // sin previo: todos los entrantes son ganadores
                mergedTombstones = Array.isArray(data.tombstones) ? data.tombstones : [];
              }
              const snapshotData = stripSnapshotCredentials({   // F-23
                ...data,
                records: mergedRecords,
                tombstones: mergedTombstones
              });
              return {
                data: snapshotData,
                studentsCount: students.length,
                recordsCount: mergedRecords.length,
                schoolName: body.schoolName || row?.school_name || env.SCHOOL_NAME || ''
              };
            });
            void written; // el CAS degrada honestamente y lo registra casWriteSnapshot
            adminSnapshotData = safeJsonParse((await env.DB.prepare(
              `SELECT data_json FROM sync_snapshots WHERE id = ?`
            ).bind(`snapshot_${schoolCode}`).first<{ data_json: string }>())?.data_json || 'null') || data;
            adminRecordsCount = Array.isArray(adminSnapshotData.records) ? adminSnapshotData.records.length : records.length;
          } catch (e: any) {
            /* snapshot corrupto o escritura fallida: usar el payload entrante tal cual (comportamiento previo) */
            console.warn('[sync/push] camino ADMIN (CAS) no crítico:', e?.message || e);
            adminSnapshotData = stripSnapshotCredentials({ ...data, records: stampServerVersion(records) });
            adminRecordsCount = records.length;
          }

          // 2. Guardar Estudiantes en tabla relacional D1 en batches
          if (students.length > 0) {
            // Ronda 23 (BUG CRÍTICO RESUELTO con prueba forense en D1): era INSERT OR REPLACE.
            // En SQLite REPLACE = DELETE+INSERT, y students tiene FKs hijas con ON DELETE
            // CASCADE (attendance_records y student_excuses, schema.sql:44 y :124). Cada push
            // que reinsertaba un estudiante BORRABA EN CASCADA sus excusas y asistencias —
            // por eso desaparecían las excusas radicadas tras cada "Sincronizar". El upsert
            // verdadero (ON CONFLICT DO UPDATE) NO borra la fila: no dispara cascadas ni
            // firea el trigger de auditoría trg_excuse_delete_audit.
            const studentStmt = env.DB.prepare(
              `INSERT INTO students (code, document_id, document_type, first_name, last_name, grade, photo_url, guardian_name, guardian_phone, status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(code) DO UPDATE SET
                 document_id=excluded.document_id, document_type=excluded.document_type,
                 first_name=excluded.first_name, last_name=excluded.last_name,
                 grade=excluded.grade, photo_url=excluded.photo_url,
                 guardian_name=excluded.guardian_name, guardian_phone=excluded.guardian_phone,
                 status=excluded.status, updated_at=datetime('now')`
            );
            const studentBatch = students.map((s: any) => 
              studentStmt.bind(
                s.code,
                s.documentId || '',
                s.documentType || 'TI',
                s.firstName || '',
                s.lastName || '',
                s.grade || '',
                s.photoUrl || null,
                s.guardianName || null,
                s.guardianPhone || null,
                s.status || 'ACTIVO'
              )
            );
            // Ejecutar en fragmentos de 50 para respetar límites de D1
            for (let i = 0; i < studentBatch.length; i += 50) {
              await env.DB.batch(studentBatch.slice(i, i + 50));
            }
          }
        }

        // Ronda 54 (hueco #6): contador de registros fusionados sobre existentes (conflictos
        // resueltos por versión). Se expone en la respuesta del push para medir convergencia.
        let pushFusedCount = 0;

        // 2b. CAMINO DE OPERADOR (Flanco 1): si solo trae HECHOS (OPERATOR_TOKEN), fusiona
        //     sus registros en el snapshot vigente SIN tocar el catálogo. Así un terminal con
        //     el catálogo viejo no aplasta los cambios de Rectoría; solo aporta las asistencias
        //     nuevas del día. El catálogo del snapshot queda intacto.
        if (isOperator && env.DB) {
          try {
            // =========================================================================
            // Ronda 58 (F-6 + F-7 + F-23) — el camino de operador ahora:
            //   1. Sella SOLO sus registros entrantes (F-7) ANTES de fusionar.
            //   2. Escribe con CAS (F-6): si otro push (docente o Rectoría) escribió
            //      entre la lectura y la escritura, RE-LEE y RE-FUSIONA en vez de
            //      pisar la fusión del otro (antes: el último borraba los hechos del
            //      primero — pérdida silenciosa de asistencia).
            //   3. Aplica stripSnapshotCredentials (F-23) por si un terminal viejo
            //      aún sube tempPassword en claro.
            // El catálogo del snapshot vigente se conserva intacto (comportamiento R47).
            // =========================================================================
            // Ronda 60-b (H-2, vía operador): mismo refinamiento que el camino ADMIN —
            // fusión con versiones verdaderas y sello solo a los ganadores entrantes
            // (el sello pre-merge hacía ganar a copias obsoletas que llegaban tarde).
            const incomingSet = new Set<any>((records || []).filter((r: any) => r && r.id));
            const stampWinner = (r: any) => (incomingSet.has(r) ? stampServerVersion([r])[0] : r);
            let mergedData: any;
            let mergedRecords: any[] = [];
            let catalogCount = 0;
            const written = await casWriteSnapshot(env, schoolCode, (prev, row) => {
              if (prev) {
                const prevRecords = Array.isArray(prev.records) ? prev.records : [];
                const prevById = new Map<string, any>(prevRecords.map((r: any) => [String(r.id), r]));
                // Ronda 54 (hueco #6): registros que YA existían y se resuelven por LWW (conflicto).
                pushFusedCount = records.filter((r: any) => r && r.id && prevById.has(String(r.id))).length;
                mergedRecords = mergeRecordsByUpdatedAt(prevRecords, records).map(stampWinner);
                mergedData = stripSnapshotCredentials({ ...prev, records: mergedRecords });
                catalogCount = Array.isArray(prev.students) ? prev.students.length : (row?.students_count ?? 0);
              } else {
                // No hay snapshot previo: almacenar solo los hechos de este operador (sin catálogo).
                mergedRecords = stampServerVersion(records); // sin previo: todos los entrantes son ganadores
                mergedData = stripSnapshotCredentials({ ...data, records: mergedRecords });
                catalogCount = Array.isArray(data.students) ? data.students.length : 0;
              }
              return {
                data: mergedData,
                studentsCount: catalogCount,
                recordsCount: mergedRecords.length,
                schoolName: body.schoolName || row?.school_name || env.SCHOOL_NAME || ''
              };
            });
            if (!written) {
              // Contención extrema tras 3 intentos: degradación honesta (última escritura
              // gana), documentada en el log. El KV de abajo no se actualiza con datos
              // posiblemente pisados: se omite para no servir una fusión perdida.
              console.warn('[sync/push] operador: CAS sin éxito tras reintentos; KV no refrescado este ciclo.');
            }

            // Reflejar el snapshot fusionado en KV para que /api/sync/pull lo sirva fresco
            // (el pull lee KV primero). El catálogo conservado es el vigente, no el del operador.
            if (env.ATTENDANCE_KV && written) {
              await env.ATTENDANCE_KV.put(`latest_snapshot_${schoolCode}`, JSON.stringify({
                syncedAt: new Date().toISOString(),
                studentsCount: catalogCount,
                recordsCount: mergedRecords.length,
                data: mergedData
              }));
            }
          } catch (e: any) {
            console.warn('[sync/push] merge de operador no crítico:', e?.message || e);
          }
        }

        // 3. Guardar Registros de Asistencia en D1 en batches (ADMIN y OPERATOR)
        if (env.DB && records.length > 0) {
            // Ronda 21 (spec §1.2): upsert con PROTECCIÓN DEL OVERLAY. INSERT OR REPLACE
            // reemplazaba la fila completa: un dispositivo que aún no conocía una excusa
            // (excuseId NULL local) BORRABA la vinculación vigente en D1 al pushear su
            // snapshot. Con ON CONFLICT DO UPDATE, excuse_id = COALESCE(entrante, vigente):
            // el entrante solo gana cuando trae un valor (fuente: auto-cierre con excusa o
            // post-hoc propagado). El rechazo converge vía excuseUpdatedAt en el pull.
            const recordStmt = env.DB.prepare(
              `INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method, verified_hmac, scanned_by, scanned_by_name, subject, slot_id, notes, excuse_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 student_code=excluded.student_code, student_name=excluded.student_name,
                 document_id=excluded.document_id, grade=excluded.grade, date=excluded.date,
                 time=excluded.time, status=excluded.status, method=excluded.method,
                 verified_hmac=excluded.verified_hmac, scanned_by=excluded.scanned_by,
                 scanned_by_name=excluded.scanned_by_name, subject=excluded.subject,
                 slot_id=excluded.slot_id, notes=excluded.notes,
                 excuse_id=COALESCE(excluded.excuse_id, attendance_records.excuse_id)`
            );
            const recordBatch = records.map((r: any) =>
              recordStmt.bind(
                r.id || `${r.studentCode}_${r.date}_${r.time}`,
                r.studentCode,
                r.studentName || '',
                r.documentId || '',
                r.grade || '',
                r.date,
                r.time,
                r.status,
                r.method || 'QR_CAMERA',
                r.verifiedHmac ? 1 : 0,
                r.scannedBy || 'PORTERO',
                r.scannedByName || null,
                r.subject || null,
                r.slotId || null,
                r.notes || null,
                r.excuseId || null
              )
            );
            for (let i = 0; i < recordBatch.length; i += 50) {
              await env.DB.batch(recordBatch.slice(i, i + 50));
            }
          }

        // 4. Guardar en Cloudflare KV para acceso instantáneo (<20ms) desde porterías.
        //    SOLO en push de catálogo (ADMIN). Un operador no debe refrescar el snapshot
        //    KV con su catálogo (posiblemente obsoleto) ni el índice de estudiantes.
        if (isAdmin && env.ATTENDANCE_KV) {
          await env.ATTENDANCE_KV.put(`latest_snapshot_${schoolCode}`, JSON.stringify({
            syncedAt: new Date().toISOString(),
            studentsCount: students.length,
            recordsCount: adminRecordsCount,
            data: adminSnapshotData
          }));
          // Guardar índice de estudiantes para validación rápida de QR en portería
          const studentIndex: Record<string, any> = {};
          students.forEach((s: any) => {
            studentIndex[s.code] = { name: `${s.firstName} ${s.lastName}`, grade: s.grade, doc: s.documentId };
          });
          await env.ATTENDANCE_KV.put(`students_index_${schoolCode}`, JSON.stringify(studentIndex));
        }

        // 5. Flanco 3 (CAS): SOLO un push de catálogo (ADMIN) incrementa catalog_version.
        //    Un operador jamás la toca → el desfase de catálogo se detecta en el próximo
        //    push de Rectoría sin que un terminal viejo "gane" la carrera.
        let newCatalogVersion: number | null = null;
        if (isAdmin) {
          newCatalogVersion = await bumpCatalogVersion(env, schoolCode, device.deviceId, tokenRole);
        }

        // 6. Flanco 2 (trazabilidad append-only): registro de la operación por dispositivo.
        await logDeviceSync(env, {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          role: tokenRole,
          action: isAdmin ? 'PUSH_CATALOG' : 'PUSH_FACTS',
          schoolCode,
          catalogVersion: newCatalogVersion,
          studentsCount: isAdmin ? students.length : 0,
          recordsCount: records.length,
          details: {
            force: !!body.force,
            sentCatalogVersion: bodyCatalogVersion,
            opId: opId,
            recordsMerged: pushFusedCount
          }
        });

        // Ronda 54 (hueco #2): registrar el opId como aplicado (TTL 7 días). Un reintento
        // con el mismo opId se deduce y devuelve el mismo resultado sin re-aplicar.
        if (opId && env.ATTENDANCE_KV) {
          try {
            await env.ATTENDANCE_KV.put(
              `sync_opid_${schoolCode}_${opId}`,
              JSON.stringify({
                ok: true,
                catalogVersion: newCatalogVersion,
                studentsSaved: isAdmin ? students.length : 0,
                recordsSaved: records.length,
                timestamp: new Date().toISOString()
              }),
              { expirationTtl: 24 * 60 * 60 } // R58 (F-12): ventana de dedup = 24 h (cubre reintentos; antes 7 d quemaba cuota KV)
            );
          } catch {
            /* el dedup es best-effort: no debe romper el push */
          }
        }

        // Ronda 54 (hueco #6): observabilidad de conflictos/reintentos — el push devuelve
        // cuántos registros nuevos se consolidaron (recordsSaved) y cuántos colisionaron con
        // registros existentes y se resolvieron por versión (recordsMerged / pushFusedCount).
        const recordsMerged = pushFusedCount;

        return jsonResponse({
          success: true,
          message: isAdmin
            ? `Sincronización Cloudflare completada: ${students.length} estudiantes y ${records.length} asistencias guardadas en D1 y KV (catálogo v${newCatalogVersion ?? '?'}).`
            : `Asistencias sincronizadas (vía operador): ${records.length} registros fusionados en la nube. El catálogo no fue modificado.`,
          timestamp: new Date().toISOString(),
          studentsSaved: isAdmin ? students.length : 0,
          recordsSaved: records.length,
          recordsMerged,
          deduplicated: false,
          catalogVersion: newCatalogVersion,
          role: tokenRole,
          deviceId: device.deviceId,
          opId: opId
        });
      }

      // =========================================================================
      // RUTA: SYNC PULL (Descarga de datos para sincronizar nuevos dispositivos)
      // =========================================================================
      if (path === '/api/sync/pull' && request.method === 'GET') {
        const schoolCode = url.searchParams.get('schoolCode') || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';

        // Ronda 49 (identidad-nube): el contenido se ESPECIALIZA según el rol de la identidad.
        // Un docente/representante ve SOLO su matrícula y su planilla (mínimo privilegio /
        // Ley 1581); Rectoría (ADMIN) ve todo. Un terminal con token de dispositivo (sin
        // identidad) sigue viendo todo como hoy (retrocompat).
        const scoped = filterSnapshotByRole;
        const since = url.searchParams.get('since');
        const scope = url.searchParams.get('scope');
        const respondWith = (data: any, source: string, syncedAt: string, catalogVersion: number) => {
          // Ronda 54 (hueco #5): aplicar tombstones ANTES del scoping por rol, para que
          // ninguna identidad reciba entidades eliminadas (no resucitan).
          let finalData = scoped(applyTombstones(data), authz);
          if (since) {
            finalData = { ...finalData, records: filterRecordsSince(finalData.records, since) };
          }
          // Ronda 54 (scope=facts): SOLO los hechos; Rectoría baja los escaneos de
          // docentes/estudiantes sin reemplazar su catálogo local.
          if (scope === 'facts') {
            finalData = { records: Array.isArray(finalData.records) ? finalData.records : [] };
          }
          return jsonResponse({
            success: true,
            source,
            syncedAt,
            catalogVersion,
            incremental: !!since,
            data: finalData,
            scope: authz.source === 'identity' ? authz.role : 'FULL'
          });
        };

        // Primero intentar lectura ultrarrápida desde KV
        if (env.ATTENDANCE_KV) {
          const cached = await env.ATTENDANCE_KV.get(`latest_snapshot_${schoolCode}`, 'json') as any;
          if (cached && cached.data) {
            await injectExcuseLinks(env, cached.data);
            const catalogVersion = await getCatalogVersion(env, schoolCode);
            return respondWith(cached.data, 'Cloudflare KV (Ultra-Fast Edge Cache)', cached.syncedAt, catalogVersion);
          }
        }

        // Fallback a lectura desde Cloudflare D1
        if (env.DB) {
          const row = await env.DB.prepare(
            `SELECT data_json, updated_at FROM sync_snapshots WHERE school_code = ? OR id = ? LIMIT 1`
          ).bind(schoolCode, `snapshot_${schoolCode}`).first() as any;

          if (row && row.data_json) {
            const data = JSON.parse(row.data_json);
            await injectExcuseLinks(env, data);
            const catalogVersion = await getCatalogVersion(env, schoolCode);
            return respondWith(data, 'Cloudflare D1 Database', row.updated_at, catalogVersion);
          }
        }

        return errorResponse('No se encontraron datos de sincronización previos para este colegio.', 404);
      }

      // =========================================================================
      // RUTA: VERIFY CLASS TOKEN (Ronda 60 — verificación server-side de tarjetas
      // de clase para dispositivos SIN el secret institucional, p. ej. el portal
      // del estudiante/representante desde Ronda 59). El Worker tiene el secret en
      // el snapshot y devuelve SOLO el veredicto — el dispositivo nunca lo recibe.
      // Requiere la misma credencial que el pull (identidad o token de dispositivo);
      // es de solo-lectura (1 lectura KV/D1) y no expone nada sensible.
      // =========================================================================
      if (path === '/api/verify/class-token' && request.method === 'POST') {
        if (verifyRateLimited(clientIp(request))) {
          return errorResponse('Demasiadas verificaciones desde esta red. Espera unos minutos e intenta de nuevo.', 429);
        }
        let body: any;
        try {
          body = await request.json() as any;
        } catch {
          return errorResponse('Cuerpo de la petición inválido: se espera JSON con el campo "token".', 400);
        }
        const token = String(body?.token || '').trim();
        const schoolCode = body?.schoolCode || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';
        if (!token) {
          return errorResponse('Falta el token de la tarjeta (campo "token").', 400);
        }
        // Cargar el secret institucional del snapshot (KV primero, D1 después —
        // mismo orden y llaves que /api/sync/pull para consistencia).
        let settings: any = null;
        if (env.ATTENDANCE_KV) {
          const cached = await env.ATTENDANCE_KV.get(`latest_snapshot_${schoolCode}`, 'json') as any;
          if (cached && cached.data?.settings) settings = cached.data.settings;
        }
        if (!settings && env.DB) {
          const row = await env.DB.prepare(
            `SELECT data_json FROM sync_snapshots WHERE school_code = ? OR id = ? LIMIT 1`
          ).bind(schoolCode, `snapshot_${schoolCode}`).first() as any;
          if (row && row.data_json) {
            try { settings = (JSON.parse(row.data_json) || {}).settings; } catch { settings = null; }
          }
        }
        if (!settings || !(settings.qrSecret || settings.legacyQrSecret)) {
          return errorResponse('La institución no tiene clave de firma configurada en la nube. Rectoría debe sincronizar una vez (Push) para habilitar la verificación.', 409);
        }
        let verdict;
        try {
          verdict = await verifyClassToken(token, [settings.qrSecret, settings.legacyQrSecret].filter(Boolean));
        } catch (e: any) {
          // Ronda 60-b (B-1): los detalles internos (message de la excepción) quedan
          // en el log del Worker; al cliente solo llega un genérico accionable.
          console.error('[verify/class-token] fallo interno:', e?.message || e);
          return errorResponse('No se pudo verificar el token en este momento. Intenta de nuevo.', 500);
        }
        return jsonResponse({
          success: true,
          verified: verdict.verified,
          reason: verdict.reason,
          kind: verdict.kind,
          context: verdict.context,
          serverVerifiedAt: new Date().toISOString()
        });
      }

      // =========================================================================
      // RUTA: SYNC LOG (Ronda 47 — Fase 2, Flanco 2): bitácora append-only de los
      // dispositivos/roles que sincronizaron. SOLO ADMIN (un operador no debe leer la
      // trazabilidad de otros terminales). Se trunca a los últimos 100 registros.
      // =========================================================================
      if (path === '/api/sync/log' && request.method === 'GET') {
        if (authz.role !== 'ADMIN') {
          return errorResponse('Solo Rectoría (ADMIN) puede consultar el registro de sincronización.', 403);
        }
        if (!env.DB) {
          return errorResponse('D1 no configurada.', 503);
        }
        const schoolCode = url.searchParams.get('schoolCode') || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';
        await ensureSyncGuardTables(env);
        const rows = await env.DB.prepare(
          `SELECT device_id, device_name, role, action, school_code, catalog_version,
                  students_count, records_count, details_json, created_at
           FROM device_sync_log
           WHERE school_code = ?
           ORDER BY created_at DESC
           LIMIT 100`
        ).bind(schoolCode).all<{
          device_id: string; device_name: string | null; role: string; action: string;
          school_code: string; catalog_version: number | null; students_count: number;
          records_count: number; details_json: string | null; created_at: string;
        }>();
        const catalogVersion = await getCatalogVersion(env, schoolCode);
        return jsonResponse({
          success: true,
          schoolCode,
          catalogVersion,
          entries: (rows.results || []).map(e => ({
            deviceId: e.device_id,
            deviceName: e.device_name,
            role: e.role,
            action: e.action,
            catalogVersion: e.catalog_version,
            studentsCount: e.students_count,
            recordsCount: e.records_count,
            details: e.details_json ? JSON.parse(e.details_json) : null,
            createdAt: e.created_at
          }))
        });
      }

      // =========================================================================
      // RUTA: SYNC METRICS (Ronda 54 — hueco #6, OBSERVABILIDAD de conflictos/reintentos).
      // SOLO ADMIN. Devuelve contadores agregados del device_sync_log (append-only) para
      // detectar regresiones y afinar el merge: total de pushes por tipo, lo que cada rol
      // sube, el catálogo vigente y un heurístico de "reintentos" (pushes con el mismo opId
      // desde un mismo dispositivo — operaciones que se reenviaron al menos una vez).
      // =========================================================================
      if (path === '/api/sync/metrics' && request.method === 'GET') {
        if (authz.role !== 'ADMIN') {
          return errorResponse('Solo Rectoría (ADMIN) puede consultar las métricas de sincronización.', 403);
        }
        if (!env.DB) {
          return errorResponse('D1 no configurada.', 503);
        }
        const schoolCode = url.searchParams.get('schoolCode') || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';
        await ensureSyncGuardTables(env);
        const rows = await env.DB.prepare(
          `SELECT role, action, device_id, details_json, created_at
           FROM device_sync_log
           WHERE school_code = ?
           ORDER BY created_at ASC`
        ).bind(schoolCode).all<{
          role: string; action: string; device_id: string; details_json: string | null; created_at: string;
        }>();
        const all = rows.results || [];

        const byAction: Record<string, number> = {};
        const byRole: Record<string, number> = {};
        let totalRecordsFused = 0;
        for (const e of all) {
          byAction[e.action] = (byAction[e.action] || 0) + 1;
          byRole[e.role] = (byRole[e.role] || 0) + 1;
          try {
            const d = e.details_json ? JSON.parse(e.details_json) : {};
            totalRecordsFused += (typeof d.recordsMerged === 'number' ? d.recordsMerged : 0) || 0;
          } catch { /* details_json legado no parseable */ }
        }

        // Heurístico de reintentos: operaciones con el mismo opId repetidas (mismo action +
        // device + opId > 1) indican al menos un reenvío at-least-once.
        const opCount = new Map<string, number>();
        for (const e of all) {
          let opId = '';
          try { opId = (JSON.parse(e.details_json || '{}') || {}).opId || ''; } catch {}
          if (opId) {
            const k = `${e.device_id}:${e.action}:${opId}`;
            opCount.set(k, (opCount.get(k) || 0) + 1);
          }
        }
        const retriedOps = Array.from(opCount.values()).filter(n => n > 1).length;

        const catalogVersion = await getCatalogVersion(env, schoolCode);
        return jsonResponse({
          success: true,
          schoolCode,
          catalogVersion,
          metrics: {
            totalOperations: all.length,
            pushesByAction: byAction,
            pushesByRole: byRole,
            totalRecordsFused,
            retriedOperations: retriedOps,
            lastOperationAt: all.length ? all[all.length - 1].created_at : null
          },
          note: 'Métricas agregadas del device_sync_log (append-only). retriedOperations ≈ reintentos at-least-once deduplicados por opId.'
        });
      }

      // =========================================================================
      // RUTA: SYNC EXPORT (Ronda 28) — Volcado COMPLETO de la nube para respaldo.
      // A diferencia de /pull (snapshot KV con últimos 500 registros), este endpoint
      // lee TODAS las filas de D1 sin límites + el snapshot KV + las excusas.
      // Propósito: copia fiel ANTES de operaciones destructivas (purga) y archivo
      // forense de cada "era" de datos. Requiere AUTH_TOKEN (guard global).
      // =========================================================================
      if (path === '/api/sync/export' && request.method === 'GET') {
        const schoolCode = url.searchParams.get('schoolCode') || env.SCHOOL_CODE || 'INAS-ANTONIA-SANTOS-2026';

        const count = async (table: string): Promise<number> => {
          if (!env.DB) return 0;
          try {
            const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
            return row?.n ?? 0;
          } catch { return 0; }
        };

        const all = async <T = any>(table: string): Promise<T[]> => {
          if (!env.DB) return [];
          try {
            const res = await env.DB.prepare(`SELECT * FROM ${table}`).all<T>();
            return res.results || [];
          } catch { return []; }
        };

        // Snapshot KV vigente (estructura de jornada + settings viajan dentro).
        let kvSnapshot: any = null;
        if (env.ATTENDANCE_KV) {
          try {
            kvSnapshot = await env.ATTENDANCE_KV.get(`latest_snapshot_${schoolCode}`, 'json');
          } catch { kvSnapshot = null; }
        }

        const [students, teachers, assignments, slots, records, excuses, auditN, subsN] = await Promise.all([
          all('students'),
          all('teachers'),
          all('schedule_assignments'),
          all('schedule_slots'),
          all('attendance_records'),
          all('student_excuses'),
          count('audit_logs'),
          count('push_subscriptions')
        ]);

        return jsonResponse({
          success: true,
          source: 'Cloudflare D1 full dump + KV snapshot',
          schoolCode,
          exportedAt: new Date().toISOString(),
          data: {
            students,        // filas D1 crudas (snake_case) — el frontend normaliza
            teachers,
            assignments,
            slots,
            records,         // TODOS los registros de asistencia (sin recorte de 500)
            excuses,         // buzón completo (D1 student_excuses)
            kvSnapshot,
            kvSnapshotSyncedAt: kvSnapshot?.syncedAt || null
          },
          counts: {
            students: students.length,
            teachers: teachers.length,
            assignments: assignments.length,
            slots: slots.length,
            records: records.length,
            excuses: excuses.length,
            audit_logs: auditN,            // archive-only (cadena HMAC de la era)
            push_subscriptions: subsN      // no restaurables (tokens por dispositivo)
          }
        });
      }

      // =========================================================================
      // RUTA: SYNC PURGE (Ronda 28) — Eliminar TODOS los datos de la nube (D1 + KV).
      // Caso de uso del propietario: limpiar datos demo contaminantes sin wrangler,
      // p.ej. después de que un probador subió basura. Barreras (no es una acción al
      // azar): (1) guard global AUTH_TOKEN, (2) rate limit 3/h por IP, (3) cuerpo
      // exige confirm === 'PURGAR', (4) la UI descarga copia de la nube ANTES y
      // exige tipear PURGAR, (5) auditoría CLOUD_PURGE insertada DESPUÉS de borrar
      // (el nuevo era arranca con el registro del propio evento).
      // ORDEN FK-SEGURO (hijas antes que madres; attendance ↔ excuses cruzadas primero).
      // =========================================================================
      if (path === '/api/sync/purge' && request.method === 'POST') {
        if (purgeRateLimited(clientIp(request))) {
          return errorResponse('Límite de purgas alcanzado (3 por hora). Espera antes de reintentar.', 429);
        }

        const body = await request.json().catch(() => null) as any;
        if (!body || body.confirm !== 'PURGAR') {
          return errorResponse('Confirmación requerida: el cuerpo debe incluir { "confirm": "PURGAR" } exacto.', 400);
        }
        const performedBy = (typeof body.performedBy === 'string' && body.performedBy.trim())
          ? body.performedBy.trim().slice(0, 120)
          : 'SETTINGS_UI';

        if (!env.DB && !env.ATTENDANCE_KV) {
          return errorResponse('Worker sin D1 ni KV configurados: nada que purgar.', 503);
        }

        const tables: Record<string, number> = {};

        // 1) Tablas cruzadas / hijas primero (FKs: attendance→students, attendance→excuses,
        //    excuses→students, excuses→attendance).
        const deleteOrder = [
          'attendance_records',
          'student_excuses',
          'students',
          'teachers',
          'schedule_assignments',
          'schedule_slots',
          'sync_snapshots',
          'push_subscriptions',
          'audit_logs',
          'catalog_versions',
          'device_sync_log'
        ];

        if (env.DB) {
          for (const table of deleteOrder) {
            try {
              const res = await env.DB.prepare(`DELETE FROM ${table}`).run();
              tables[table] = res.meta?.changes ?? 0;
            } catch (e: any) {
              // Tabla inexistente en despliegues viejos: cuenta 0 y continúa (purga idempotente).
              tables[table] = 0;
            }
          }

          // 2) Auditoría del propio evento — DESPUÉS de los DELETEs: primera fila de la era nueva.
          try {
            await env.DB.prepare(
              `INSERT INTO audit_logs (id, event_type, performed_by, ip_address, details_json, created_at)
               VALUES (?, 'CLOUD_PURGE', ?, ?, ?, datetime('now'))`
            ).bind(
              `purge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              performedBy,
              clientIp(request),
              JSON.stringify({ tables, reason: body.reason || 'purga-demo-produccion' })
            ).run();
          } catch { /* auditoría best-effort: no bloquea el reporte de purga */ }
        }

        // 3) KV: namespace DEDICADO de la app — se vacía completo con nombres reportados.
        const kvDeleted: string[] = [];
        if (env.ATTENDANCE_KV) {
          try {
            let cursor: string | undefined = undefined;
            let complete = false;
            while (!complete) {
              const page = await env.ATTENDANCE_KV.list(cursor ? { cursor } : undefined);
              for (const key of page.keys) {
                await env.ATTENDANCE_KV.delete(key.name);
                kvDeleted.push(key.name);
              }
              complete = page.list_complete;
              cursor = (page as any).cursor;
            }
          } catch (e: any) {
            return jsonResponse({
              success: false,
              error: `D1 purgado pero KV falló: ${e?.message || e}. Revisa la KV manualmente.`,
              tables,
              kvDeleted
            }, 500);
          }
        }

        return jsonResponse({
          success: true,
          message: `Nube purgada: ${Object.values(tables).reduce((a, b) => a + b, 0)} filas D1 eliminadas y ${kvDeleted.length} claves KV borradas. La cadena de excusas reinicia en GENESIS con la próxima excusa real.`,
          timestamp: new Date().toISOString(),
          tables,
          kvDeleted,
          note: 'Las suscripciones push fueron eliminadas: cada dispositivo debe reactivar notificaciones. El auto-sync de los dispositivos volverá a subir su estado local en el próximo intervalo.'
        });
      }

      // =========================================================================
      // RUTA: REGISTRAR ASISTENCIA INDIVIDUAL EN VIVO (Escaneo instantáneo)
      // =========================================================================
      if (path === '/api/attendance' && request.method === 'POST') {
        const r = await request.json() as any;
        if (!r.studentCode || !r.date || !r.time) {
          return errorResponse('studentCode, date y time son requeridos.');
        }

        // Ronda 54 (hueco #2): idempotencia del outbox — el cliente envía un `opId` estable
        // por escaneo. Si el Worker ya lo procesó (re-intento porque la respuesta se perdió),
        // devuelve `deduplicated:true` sin volver a escribir. Sin `opId` (cliente no actualizado)
        // se comporta como antes (INSERT OR REPLACE por id, ya idempotente).
        if (r.opId && env.ATTENDANCE_KV) {
          try {
            const dedupKey = `att_opid_${r.opId}`;
            const prior = await env.ATTENDANCE_KV.get(dedupKey, 'json') as any;
            if (prior && prior.ok) {
              return jsonResponse({ success: true, id: prior.id || r.id || `${r.studentCode}_${r.date}_${r.time}`, deduplicated: true, message: 'Asistencia ya registrada (opId duplicado).' });
            }
          } catch { /* best-effort */ }
        }

        const id = r.id || `${r.studentCode}_${r.date}_${r.time}`;

        if (env.DB) {
          // Ronda 21: misma protección COALESCE del overlay que en /api/sync/push.
          await env.DB.prepare(
            `INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method, verified_hmac, scanned_by, scanned_by_name, subject, slot_id, notes, excuse_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               student_code=excluded.student_code, student_name=excluded.student_name,
               document_id=excluded.document_id, grade=excluded.grade, date=excluded.date,
               time=excluded.time, status=excluded.status, method=excluded.method,
               verified_hmac=excluded.verified_hmac, scanned_by=excluded.scanned_by,
               scanned_by_name=excluded.scanned_by_name, subject=excluded.subject,
               slot_id=excluded.slot_id, notes=excluded.notes,
               excuse_id=COALESCE(excluded.excuse_id, attendance_records.excuse_id)`
          ).bind(
            id,
            r.studentCode,
            r.studentName || '',
            r.documentId || '',
            r.grade || '',
            r.date,
            r.time,
            r.status || 'PUNTUAL',
            r.method || 'QR_CAMERA',
            r.verifiedHmac ? 1 : 0,
            r.scannedBy || 'PORTERO',
            r.scannedByName || null,
            r.subject || null,
            r.slotId || null,
            r.notes || null,
            r.excuseId || null
          ).run();
        }

        // Ronda 54 (hueco #2): registrar el opId como aplicado para dedup de reintentos.
        if (r.opId && env.ATTENDANCE_KV) {
          try {
            // R58 (F-12): ventana de dedup = 24 h (cubre reintentos; antes 7 d quemaba cuota KV)
            await env.ATTENDANCE_KV.put(`att_opid_${r.opId}`, JSON.stringify({ ok: true, id }), { expirationTtl: 24 * 60 * 60 });
          } catch { /* best-effort */ }
        }

        return jsonResponse({ success: true, id, message: 'Asistencia registrada en Cloudflare D1' });
      }

      // =========================================================================
      // RUTAS: EXCUSAS JUSTIFICADAS (Ronda 21 — spec-excusas-2026, fases P0–P3)
      // Anticipada (Escudo) + post-hoc (1 toque) en una entidad; reglas R1–R10,
      // audit_logs EXCUSE_* con cadena HMAC tamper-evidente. Ver src/excuses.ts
      // =========================================================================
      const excusesResponse = await handleExcusesRoutes(request, env, url, path, ctx);
      if (excusesResponse) return excusesResponse;

      // RUTAS: WEB PUSH (Ronda 23 — suscripciones de notificaciones de excusas)
      const pushResponse = await handlePushRoutes(request, env, url, path);
      if (pushResponse) return pushResponse;

      return errorResponse(`Ruta no encontrada: ${path}`, 404);
    } catch (err: any) {
      // Ronda 60-b (B-1): el detalle (message/stack) queda SOLO en el log interno;
      // al cliente jamás se le filtran detalles de infraestructura.
      console.error('Worker internal error:', err);
      return errorResponse('Error interno en Cloudflare Worker. Reintenta y, si persiste, revisa el log del Worker.', 500);
    }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Ronda 58 (F-17): preflight con allowlist + envoltura CORS de TODAS las respuestas.
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(request, env);
    }
    try {
      const res = await handleRoute(request, env, ctx);
      return withCorsHeaders(res, request, env);
    } catch (err: any) {
      // Error ANTES del try interno (p. ej. new URL malformada): respuesta honesta + CORS.
      // Ronda 60-b (B-1): mensaje genérico al cliente; el detalle vive en el log.
      console.error('Worker fetch error:', err);
      const fallback = new Response(JSON.stringify({ success: false, error: 'Error interno en Cloudflare Worker.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
      return withCorsHeaders(fallback, request, env);
    }
  }
};
