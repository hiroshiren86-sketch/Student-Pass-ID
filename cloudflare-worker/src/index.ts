/**
 * ==============================================================================
 * CLOUDFLARE WORKER: D1 RELATIONAL DATABASE & KV CACHE (SYNC DE DATOS)
 * La IA se ejecuta 100% local en el navegador (BYOK). Este Worker NO integra proveedores de IA.
 * Sistema de Control de Asistencia Escolar y Carnetización Criptográfica
 * ==============================================================================
 */

import { handleExcusesRoutes } from './excuses';
import { handlePushRoutes } from './push';
import { SignJWT, jwtVerify, importPKCS8, importX509 } from 'jose';

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
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-School-Code, X-Requested-With, X-Device-Id, X-Device-Name, X-Firebase-Id-Token',
  'Access-Control-Max-Age': '86400',
};
export { corsHeaders }; // Ronda 24: compartido con push.ts (sus rutas Cross-Origin)

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

// Ronda 18: comparación en tiempo constante (OWASP) — evita ataques de timing
// sobre el token; un string === corto-circuita en el primer carácter distinto.
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

// Verificación de token Bearer opcional o institucional
function verifyAuth(request: Request, env: Env): boolean {
  if (!env.AUTH_TOKEN && !env.OPERATOR_TOKEN) return true; // Sin tokens → acceso abierto (solo desarrollo)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  // ADMIN si coincide con AUTH_TOKEN; OPERADOR si coincide con OPERATOR_TOKEN; si el
  // token coincide con ambos (iguales) gana ADMIN.
  if (env.AUTH_TOKEN && timingSafeEqual(token, env.AUTH_TOKEN.trim())) return true;
  if (env.OPERATOR_TOKEN && timingSafeEqual(token, env.OPERATOR_TOKEN.trim())) return true;
  return false;
}

// ==============================================================================
// Ronda 47 (Fase 2 — Flanco 1): resolución del ALCANCE del token. Devuelve el rol
// efectivo del terminal para una petición: 'ADMIN' | 'OPERATOR' | null (token inválido).
// Regla de retrocompatibilidad: si no hay NINGÚN token configurado (modo abierto), un
// terminal equivale a ADMIN (hoy todos lo son y nada rompe). Si hay AUTH_TOKEN pero la
// petición viene con OPERATOR_TOKEN → OPERATOR (limitado a hechos). Si viene con
// AUTH_TOKEN → ADMIN.
// ==============================================================================
type TokenRole = 'ADMIN' | 'OPERATOR';

export function resolveTokenScope(request: Request, env: Env): TokenRole | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return (env.AUTH_TOKEN || env.OPERATOR_TOKEN) ? null : 'ADMIN';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!(env.AUTH_TOKEN || env.OPERATOR_TOKEN)) return 'ADMIN'; // modo abierto (desarrollo)
  if (env.AUTH_TOKEN && timingSafeEqual(token, env.AUTH_TOKEN.trim())) return 'ADMIN';
  if (env.OPERATOR_TOKEN && timingSafeEqual(token, env.OPERATOR_TOKEN.trim())) return 'OPERATOR';
  return null;
}

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

// Merge de HECHOS por id + updatedAt (Flanco 4): el updatedAt del DATO decide; si el
// registro previo no trae updatedAt, el entrante gana. Se usa para fusionar los registros
// del operador dentro del snapshot vigente sin machacar el catálogo.
export function mergeRecordsByUpdatedAt(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of existing || []) if (r && r.id) map.set(String(r.id), r);
  for (const r of incoming || []) {
    if (!r || !r.id) continue;
    const prev = map.get(String(r.id));
    if (!prev) { map.set(String(r.id), r); continue; }
    const prevA = prev.updatedAt || prev.timestamp || '';
    const inA = r.updatedAt || r.timestamp || '';
    // Gana el más nuevo por updatedAt (o timestamp como fallback). Reglas:
    //  - entrante SIN fecha: solo gana si el previo tampoco la tiene (no pisar dato
    //    fechado con uno sin fecha).
    //  - previo SIN fecha: el entrante gana (el previo es no-datable, se confía en el push).
    //  - ambos con fecha: gana el mayor; empate → entrante.
    if (!inA) {
      if (!prevA) map.set(String(r.id), r);
    } else if (!prevA || inA >= prevA) {
      map.set(String(r.id), r);
    }
  }
  return Array.from(map.values());
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

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

// ==============================================================================
// Ronda 49 (Identidad-nube, Opción B) — ACCESO A LA NUBE POR IDENTIDAD Y ROL.
//
// El cliente autenticado (Rectoría / DOCENTE con cuenta Firebase) envía su ID token
// de Firebase en el header `X-Firebase-Id-Token`. El Worker:
//   1. VERIFICA el ID token: firma RS256 contra las llaves públicas de Google
//      (se descargan de securetoken@system.gserviceaccount.com y se cachean).
//   2. LEE el ROL del perfil users/{uid} en Firestore con la cuenta de servicio
//      (la "fuente de verdad" del rol — inmutable por reglas; ver firestore.rules).
//   3. AUTORIZA por rol (ADMIN / DOCENTE / ESTUDIANTE_ACUDIENTE) en cada endpoint.
//
// Esto NO reemplaza el token de dispositivo (AUTH_TOKEN / OPERATOR_TOKEN): es una
// capa ADITIVA. La identidad, cuando está presente y es válida, GANA; si no hay ID
// token, el Worker usa el scope del token de dispositivo (retrocompat 100%).
//
// NOTA de privacidad (Ley 1581): el rol del perfil es un dato mínimo, leído con
// cuenta de servicio SOLO en el edge, nunca expuesto al cliente. Nunca se filtra
// asistencia ajena: cada rol ve SOLO lo que le corresponde (ver filterSnapshotByRole).
// ==============================================================================

// Firebase issuer / audience del proyecto (instalaciones distintas = proyecto distinto).
function firebaseIssuer(env: Env): string {
  const proj = env.FIREBASE_PROJECT_ID || 'gen-lang-client-0224520207';
  return `https://securetoken.google.com/${proj}`;
}
function firebaseAudience(env: Env): string {
  return env.FIREBASE_PROJECT_ID || 'gen-lang-client-0224520207';
}

// Cache de certificados públicos de Google (rotan ~cada 24h; se cachean 6h).
let fbCertsCache: { certs: Record<string, string>; fetchedAt: number } | null = null;
async function getFbCerts(env: Env): Promise<Record<string, string>> {
  if (fbCertsCache && Date.now() - fbCertsCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return fbCertsCache.certs;
  }
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('No se pudo obtener los certificados de Firebase');
  const certs = await res.json() as Record<string, string>;
  fbCertsCache = { certs, fetchedAt: Date.now() };
  return certs;
}

// Cache de CryptoKeys por kid (evita re-importar X.509 en cada verificación).
let fbKeyCache: Record<string, any> = {};
// Cache del perfil users/{uid} por ~60s (evita golpear Firestore en cada auto-sync).
const fbProfileCache = new Map<string, { profile: FbProfile; fetchedAt: number }>();

// Cache del access_token de la cuenta de servicio (vence ~1h; se cachea 50min).
let saCache: { token: string; expiresAt: number } | null = null;
async function getSaAccessToken(env: Env): Promise<string> {
  if (saCache && Date.now() < saCache.expiresAt) return saCache.token;
  const email = env.FIREBASE_SA_CLIENT_EMAIL;
  const pk = env.FIREBASE_SA_PRIVATE_KEY;
  if (!email || !pk) throw new Error('Firebase SA no configurada (FIREBASE_SA_CLIENT_EMAIL / FIREBASE_SA_PRIVATE_KEY).');
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(pk.replace(/\\n/g, '\n'), 'RS256');
  // El flujo "service account" de Google exige el claim `scope` (espacios) en el JWT:
  // cloud-platform para Firestore y firebase para leer users/{uid}.
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setSubject(email)
    .setIssuer(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });
  const json = await res.json() as any;
  if (!json.access_token) throw new Error('No se pudo obtener access_token de la SA: ' + (json.error_description || json.error || res.status));
  saCache = { token: json.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return json.access_token;
}

interface FbProfile { role?: string; linkedTeacherId?: string; linkedStudentCode?: string }
interface FbIdentity { uid: string; profile: FbProfile }

// Lee el perfil users/{uid} de Firestore vía REST con la SA (la fuente del rol).
async function readFbUserProfile(env: Env, uid: string): Promise<FbProfile> {
  const proj = env.FIREBASE_PROJECT_ID || 'gen-lang-client-0224520207';
  const db = encodeURIComponent(env.FIREBASE_DB_ID || '(default)');
  const token = await getSaAccessToken(env);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${proj}/databases/${db}/documents/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return {}; // usuario sin perfil
  if (!res.ok) throw new Error('Firestore read falló: ' + res.status);
  const doc = await res.json() as any;
  const f = doc.fields || {};
  const sv = (v: any) => v?.stringValue;
  return {
    role: f.role ? sv(f.role) : undefined,
    linkedTeacherId: f.linkedTeacherId ? sv(f.linkedTeacherId) : undefined,
    linkedStudentCode: f.linkedStudentCode ? sv(f.linkedStudentCode) : undefined
  };
}

// Verifica el ID token y devuelve la identidad (uid + rol del perfil). null si no hay.
export async function verifyFirebaseIdentity(request: Request, env: Env): Promise<FbIdentity | null> {
  const token = request.headers.get('X-Firebase-Id-Token');
  if (!token) return null;
  try {
    const certs = await getFbCerts(env);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    const pem = certs[header.kid];
    if (!pem) throw new Error('No hay certificado para el kid ' + header.kid);
    let key = fbKeyCache[header.kid];
    if (!key) {
      key = await importX509(pem, 'RS256');
      fbKeyCache[header.kid] = key;
    }
    const { payload } = await jwtVerify(token, key, {
      issuer: firebaseIssuer(env),
      audience: firebaseAudience(env)
    });
    const uid = String(payload.sub);
    const cachedProfile = fbProfileCache.get(uid);
    if (cachedProfile && Date.now() - cachedProfile.fetchedAt < 60 * 1000) {
      return { uid, profile: cachedProfile.profile };
    }
    const profile = await readFbUserProfile(env, uid);
    fbProfileCache.set(uid, { profile, fetchedAt: Date.now() });
    return { uid, profile };
  } catch (e: any) {
    console.warn('[identity] ID token no verificado:', e?.message || e);
    return null;
  }
}

type IdentityRole = 'ADMIN' | 'DOCENTE' | 'ESTUDIANTE_ACUDIENTE';

// Autorización resuelta: puede venir de la IDENTIDAD (Firebase, si hay token válido) o,
// en su defecto, del scope del token de dispositivo (retrocompat). El rol resultante es
// el que arbitra permisos de lectura/escritura por endpoint.
export interface Authz {
  source: 'identity' | 'token';
  role: string;                       // 'ADMIN' | 'OPERATOR' | 'DOCENTE' | 'ESTUDIANTE_ACUDIENTE'
  uid?: string;
  linkedTeacherId?: string;
  linkedStudentCode?: string;
  // true si puede escribir el CATÁLOGO (estudiantes/docentes/horarios/slots).
  canWriteCatalog: boolean;
}
async function resolveAuthz(request: Request, env: Env): Promise<Authz | null> {
  const identity = await verifyFirebaseIdentity(request, env);
  if (identity && identity.profile.role) {
    const r = identity.profile.role as IdentityRole;
    return {
      source: 'identity',
      role: r,
      uid: identity.uid,
      linkedTeacherId: identity.profile.linkedTeacherId,
      linkedStudentCode: identity.profile.linkedStudentCode,
      canWriteCatalog: r === 'ADMIN'
    };
  }
  // Sin identidad (o verificación fallida) → scope del token de dispositivo.
  // resolveTokenScope devuelve 'ADMIN' solo en modo abierto (sin tokens configurados);
  // devuelve null cuando hay tokens pero ninguno matchea (credencial inválida).
  const tokenRole = resolveTokenScope(request, env);
  if (tokenRole === null) return null; // no autenticado (ni identidad ni device token válido)
  return {
    source: 'token',
    role: tokenRole,
    canWriteCatalog: tokenRole === 'ADMIN'
  };
}

// Filtra el snapshot según el rol, para que cada identidad vea SOLO lo que le corresponde
// (mínimo privilegio / Ley 1581). ADMIN (y token-admin) devuelve todo intacto.
export function filterSnapshotByRole(data: any, authz: Authz): any {
  if (!data || authz.role === 'ADMIN' || authz.role === 'OPERATOR') return data;

  if (authz.role === 'DOCENTE') {
    // El docente ve SOLO sus cursos asignados (assignedGrades de SU ficha, en el snapshot).
    const teachers = Array.isArray(data.teachers) ? data.teachers : [];
    const self = teachers.find((t: any) => String(t.id) === String(authz.linkedTeacherId));
    const grades = new Set<string>(Array.isArray(self?.assignedGrades) ? self.assignedGrades : []);
    return {
      ...data,
      students: Array.isArray(data.students) ? data.students.filter((s: any) => grades.has(s.grade)) : [],
      assignments: Array.isArray(data.assignments) ? data.assignments.filter((a: any) => grades.has(a.grade)) : [],
      records: Array.isArray(data.records) ? data.records.filter((r: any) => grades.has(r.studentGrade || r.grade)) : [],
      teachers: self ? [self] : [],
      scopedFor: { role: 'DOCENTE', grades: Array.from(grades), teacherId: authz.linkedTeacherId }
    };
  }

  if (authz.role === 'ESTUDIANTE_ACUDIENTE') {
    const students = Array.isArray(data.students) ? data.students : [];
    const self = students.find((s: any) => String(s.code) === String(authz.linkedStudentCode));
    const grade = self?.grade;
    const codes = new Set<string>(String(authz.linkedStudentCode) ? [String(authz.linkedStudentCode)] : []);
    return {
      ...data,
      students: Array.isArray(data.students) ? data.students.filter((s: any) => (grade && s.grade === grade)) : [],
      assignments: Array.isArray(data.assignments) ? data.assignments.filter((a: any) => grade && a.grade === grade) : [],
      records: Array.isArray(data.records) ? data.records.filter((r: any) => codes.has(r.studentCode)) : [],
      teachers: [],
      scopedFor: { role: 'ESTUDIANTE_ACUDIENTE', grade, studentCode: authz.linkedStudentCode }
    };
  }

  return data;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Manejo de preflight OPTIONS para navegadores web
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

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
        if (isAdmin && env.DB) {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO sync_snapshots (id, school_code, school_name, data_json, students_count, records_count, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
          ).bind(
            `snapshot_${schoolCode}`,
            schoolCode,
            body.schoolName || env.SCHOOL_NAME || '',
            JSON.stringify(data),
            students.length,
            records.length
          ).run();

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

        // 2b. CAMINO DE OPERADOR (Flanco 1): si solo trae HECHOS (OPERATOR_TOKEN), fusiona
        //     sus registros en el snapshot vigente SIN tocar el catálogo. Así un terminal con
        //     el catálogo viejo no aplasta los cambios de Rectoría; solo aporta las asistencias
        //     nuevas del día. El catálogo del snapshot queda intacto.
        if (isOperator && env.DB) {
          try {
            // Leer snapshot vigente (D1) para conservar su catálogo.
            const existing = await env.DB.prepare(
              `SELECT data_json, students_count, records_count, school_name FROM sync_snapshots WHERE id = ?`
            ).bind(`snapshot_${schoolCode}`).first<{ data_json: string; students_count: number; records_count: number; school_name: string | null }>();
            let mergedData: any;
            let mergedRecords: any[];
            let catalogCount = 0;
            if (existing?.data_json) {
              const prev = JSON.parse(existing.data_json);
              mergedRecords = mergeRecordsByUpdatedAt(prev.records || [], records);
              // conservar catálogo previo; solo actualizar records
              mergedData = { ...prev, records: mergedRecords };
              catalogCount = Array.isArray(prev.students) ? prev.students.length : existing.students_count || 0;
            } else {
              // No hay snapshot previo: almacenar solo los hechos de este operador (sin catálogo).
              mergedRecords = [...records];
              mergedData = { ...data, records: mergedRecords };
            }
            await env.DB.prepare(
              `INSERT OR REPLACE INTO sync_snapshots (id, school_code, school_name, data_json, students_count, records_count, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
            ).bind(
              `snapshot_${schoolCode}`,
              schoolCode,
              (body.schoolName || existing?.school_name || env.SCHOOL_NAME || ''),
              JSON.stringify(mergedData),
              catalogCount,
              mergedRecords.length
            ).run();

            // Reflejar el snapshot fusionado en KV para que /api/sync/pull lo sirva fresco
            // (el pull lee KV primero). El catálogo conservado es el vigente, no el del operador.
            if (env.ATTENDANCE_KV) {
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
            recordsCount: records.length,
            data
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
          details: { force: !!body.force, sentCatalogVersion: bodyCatalogVersion }
        });

        return jsonResponse({
          success: true,
          message: isAdmin
            ? `Sincronización Cloudflare completada: ${students.length} estudiantes y ${records.length} asistencias guardadas en D1 y KV (catálogo v${newCatalogVersion ?? '?'}).`
            : `Asistencias sincronizadas (vía operador): ${records.length} registros fusionados en la nube. El catálogo no fue modificado.`,
          timestamp: new Date().toISOString(),
          studentsSaved: isAdmin ? students.length : 0,
          recordsSaved: records.length,
          catalogVersion: newCatalogVersion,
          role: tokenRole,
          deviceId: device.deviceId
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
        const respondWith = (data: any, source: string, syncedAt: string, catalogVersion: number) => {
          const finalData = scoped(data, authz);
          return jsonResponse({
            success: true,
            source,
            syncedAt,
            catalogVersion,
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
      console.error('Worker internal error:', err);
      return errorResponse(err.message || 'Error interno en Cloudflare Worker', 500);
    }
  }
};
