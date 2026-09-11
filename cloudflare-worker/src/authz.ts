/**
 * ==============================================================================
 * Ronda 58 — AUTORIZACIÓN UNIFICADA (módulo compartido, extraído de index.ts).
 *
 * Motivo de la extracción (F-3): el módulo de excusas (excuses.ts) y el de web
 * push (push.ts) necesitaban resolver la autorización REAL del request
 * (identidad verificada + scope del token) en vez de confiar en campos
 * autodeclarados del body/query. Para evitar imports circulares y duplicar la
 * primitiva, la maquinaria de identidad/rol vive aquí y index.ts la re-exporta
 * (compatibilidad con las suites QA que importan desde index).
 *
 * Contenido (movido textualmente de index.ts, sin cambios de comportamiento
 * salvo donde se indica):
 *   - timingSafeEqual, resolveTokenScope, verifyAuth ( eliminado: sin llamadores )
 *   - verifyFirebaseIdentity (RS256 contra llaves de Google + rol desde Firestore)
 *   - resolveAuthz  ← CAMBIO F-5(a): la identidad ya NO exime del token para
 *     escribir catálogo; ver comentario en la función.
 *   - filterSnapshotByRole (mínimo privilegio por rol)
 * ==============================================================================
 */
import { SignJWT, jwtVerify, importPKCS8, importX509 } from 'jose';
import type { Env } from './index';

// Ronda 18: comparación en tiempo constante (OWASP) — evita ataques de timing
// sobre el token; un string === corto-circuita en el primer carácter distinto.
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

// ==============================================================================
// Ronda 47 (Fase 2 — Flanco 1): resolución del ALCANCE del token. Devuelve el rol
// efectivo del terminal para una petición: 'ADMIN' | 'OPERATOR' | null (token inválido).
// Regla de retrocompatibilidad: si no hay NINGÚN token configurado (modo abierto), un
// terminal equivale a ADMIN. Si hay AUTH_TOKEN pero la petición viene con
// OPERATOR_TOKEN → OPERATOR (limitado a hechos). Si viene con AUTH_TOKEN → ADMIN.
// ==============================================================================
export type TokenRole = 'ADMIN' | 'OPERATOR';

export function resolveTokenScope(request: Request, env: Env): TokenRole | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return (env.AUTH_TOKEN || env.OPERATOR_TOKEN) ? null : 'ADMIN';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!(env.AUTH_TOKEN || env.OPERATOR_TOKEN)) return 'ADMIN'; // modo abierto (desarrollo)
  if (env.AUTH_TOKEN && timingSafeEqual(token, env.AUTH_TOKEN.trim())) return 'ADMIN';
  if (env.OPERATOR_TOKEN && timingSafeEqual(token, env.OPERATOR_TOKEN.trim())) return 'OPERATOR';
  return null;
}

// ==============================================================================
// Ronda 49 (Identidad-nube, Opción B) — ACCESO A LA NUBE POR IDENTIDAD Y ROL.
//
// El cliente autenticado (Rectoría / DOCENTE con cuenta Firebase) envía su ID token
// de Firebase en el header `X-Firebase-Id-Token`. El Worker:
//   1. VERIFICA el ID token: firma RS256 contra las llaves públicas de Google.
//   2. LEE el ROL del perfil users/{uid} en Firestore con la cuenta de servicio.
//   3. AUTORIZA por rol (ADMIN / DOCENTE / ESTUDIANTE_ACUDIENTE) en cada endpoint.
//
// Esto NO reemplaza el token de dispositivo (AUTH_TOKEN / OPERATOR_TOKEN): es una
// capa ADITIVA. La identidad, cuando está presente y es válida, aporta el ROL;
// el token de dispositivo aporta el ALCANCE del terminal.
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

export interface FbProfile { role?: string; linkedTeacherId?: string; linkedStudentCode?: string }
export interface FbIdentity { uid: string; profile: FbProfile }

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

// Decodifica una parte base64url de un JWT SIN Buffer (compatible Workers puro).
// Ronda 58: el código original usaba Buffer.from(...,'base64url'), que funciona
// en runtime por nodejs_compat pero no tipa sin @types/node — el Worker nunca se
// tsc-eaba (deuda latente, descubierta al extraer el módulo). atob es estándar.
function b64urlToJson(part: string): any {
  const pad = '='.repeat((4 - (part.length % 4)) % 4);
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(atob(b64));
}

// Verifica el ID token y devuelve la identidad (uid + rol del perfil). null si no hay.
export async function verifyFirebaseIdentity(request: Request, env: Env): Promise<FbIdentity | null> {
  const token = request.headers.get('X-Firebase-Id-Token');
  if (!token) return null;
  try {
    const certs = await getFbCerts(env);
    const header = b64urlToJson(token.split('.')[0]);
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

export type IdentityRole = 'ADMIN' | 'DOCENTE' | 'ESTUDIANTE_ACUDIENTE';

// Autorización resuelta: puede venir de la IDENTIDAD (Firebase, si hay token válido)
// o, en su defecto, del scope del token de dispositivo (retrocompat). El rol resultante
// es el que arbitra permisos de lectura/escritura por endpoint.
export interface Authz {
  source: 'identity' | 'token';
  role: string;                       // 'ADMIN' | 'OPERATOR' | 'DOCENTE' | 'ESTUDIANTE_ACUDIENTE'
  uid?: string;
  linkedTeacherId?: string;
  linkedStudentCode?: string;
  // true si puede escribir el CATÁLOGO (estudiantes/docentes/horarios/slots).
  canWriteCatalog: boolean;
}

export async function resolveAuthz(request: Request, env: Env): Promise<Authz | null> {
  const tokenRole = resolveTokenScope(request, env);
  const identity = await verifyFirebaseIdentity(request, env);

  if (identity && identity.profile.role) {
    const r = identity.profile.role as IdentityRole;
    // -------------------------------------------------------------------------
    // Ronda 58 (F-5a) — la identidad válida ya NO exime del token de dispositivo
    // para ESCRIBIR CATÁLOGO. Antes: un perfil users/{uid}.role === 'ADMIN'
    // (documento que el cliente puede llegar a crear/influir, ver F-5/F-4)
    // bastaba para reescribir la matrícula completa de la escuela. Ahora, cuando
    // la instalación tiene tokens configurados, escribir catálogo exige ADEMÁS
    // el token ADMIN del terminal (doble llave: identidad Y dispositivo). En
    // modo abierto (sin tokens, p. ej. desarrollo) la identidad ADMIN basta.
    // La LECTURA y los roles no cambian: un docente/estudiante sigue entrando
    // con su identidad desde un teléfono sin token de dispositivo.
    // -------------------------------------------------------------------------
    const tokensConfigured = !!(env.AUTH_TOKEN || env.OPERATOR_TOKEN);
    const canWriteCatalog = r === 'ADMIN' && (!tokensConfigured || tokenRole === 'ADMIN');
    return {
      source: 'identity',
      role: r,
      uid: identity.uid,
      linkedTeacherId: identity.profile.linkedTeacherId,
      linkedStudentCode: identity.profile.linkedStudentCode,
      canWriteCatalog
    };
  }

  // Sin identidad (o verificación fallida) → scope del token de dispositivo.
  // resolveTokenScope devuelve 'ADMIN' solo en modo abierto (sin tokens configurados);
  // devuelve null cuando hay tokens pero ninguno matchea (credencial inválida).
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

  // =========================================================================
  // Ronda 59 — EL SECRETO VIAJA POR ROL ("verificar NO es firmar").
  //
  // El qrSecret institucional es capacidad de FIRMAR carnés: mientras viajara en
  // settings hacia TODOS los roles (incl. estudiantes — decisión R56), cualquier
  // estudiante podía falsificar el carné de CUALQUIER compañero del colegio. Ahora:
  //   · ADMIN / OPERATOR (terminales de escaneo y Rectoría): reciben el secret —
  //     tienen que VERIFICAR firmas offline (y con HMAC simétrico, verificar implica
  //     poder firmar: es el límite del diseño actual, ver plan Ed25519 en AGENTS.md).
  //   · DOCENTE: recibe el secret (verifica escaneos offline) pero las fichas de
  //     estudiantes llegan SIN loginKey/verifier (los deriva del secret al vuelo).
  //   · ESTUDIANTE_ACUDIENTE: JAMÁS recibe qrSecret/legacyQrSecret. Su propio carné
  //     viaja PRE-FIRMADO en su ficha (signedCardToken) y su login offline funciona
  //     con la loginKey de SU PROPIA ficha (verificador HMAC por estudiante).
  //     Las fichas de sus COMPAÑEROS DE GRADO llegan despojadas de credenciales,
  //     token firmado y documento (mínimo privilegio Ley 1581).
  // =========================================================================

  // Despoja una ficha de estudiante de todo lo que no necesita un tercio:
  // credenciales (loginKey/verifier/claves), el token firmado de SU carné y su documento.
  const stripStudentRecord = (s: any) => {
    if (!s || typeof s !== 'object') return s;
    const {
      loginKey: _lk, tempPasswordVerifier: _tv, tempPassword: _tp,
      password: _pw, passwordHash: _ph, signedCardToken: _sc, documentId: _doc,
      ...rest
    } = s;
    return rest;
  };

  if (authz.role === 'DOCENTE') {
    // El docente ve SOLO sus cursos asignados (assignedGrades de SU ficha, en el snapshot).
    const teachers = Array.isArray(data.teachers) ? data.teachers : [];
    const self = teachers.find((t: any) => String(t.id) === String(authz.linkedTeacherId));
    const grades = new Set<string>(Array.isArray(self?.assignedGrades) ? self.assignedGrades : []);
    return {
      ...data,
      students: Array.isArray(data.students)
        ? data.students.filter((s: any) => grades.has(s.grade)).map(stripStudentRecord)
        : [],
      assignments: Array.isArray(data.assignments) ? data.assignments.filter((a: any) => grades.has(a.grade)) : [],
      records: Array.isArray(data.records) ? data.records.filter((r: any) => grades.has(r.studentGrade || r.grade)) : [],
      teachers: self ? [self] : [],
      scopedFor: { role: 'DOCENTE', grades: Array.from(grades), teacherId: authz.linkedTeacherId }
    };
  }

  if (authz.role === 'ESTUDIANTE_ACUDIENTE') {
    const students = Array.isArray(data.students) ? data.students : [];
    const selfCode = String(authz.linkedStudentCode || '');
    const self = students.find((s: any) => String(s.code) === selfCode);
    const grade = self?.grade;
    const codes = new Set<string>(selfCode ? [selfCode] : []);
    // settings SIN secretos de firma (el resto de ajustes sí: nombre, jornada, bloques).
    const { qrSecret: _qs, legacyQrSecret: _lqs, ...safeSettings } = data.settings || {};
    return {
      ...data,
      settings: safeSettings,
      students: Array.isArray(data.students)
        ? data.students
            .filter((s: any) => grade && s.grade === grade)
            // La PROPIA ficha viaja INTACTA (con su signedCardToken y loginKey — el
            // portal los necesita); las de los compañeros, despojadas (stripStudentRecord).
            .map((s: any) => (String(s.code) === selfCode ? s : stripStudentRecord(s)))
        : [],
      assignments: Array.isArray(data.assignments) ? data.assignments.filter((a: any) => grade && a.grade === grade) : [],
      records: Array.isArray(data.records) ? data.records.filter((r: any) => codes.has(r.studentCode)) : [],
      teachers: [],
      scopedFor: { role: 'ESTUDIANTE_ACUDIENTE', grade, studentCode: authz.linkedStudentCode }
    };
  }

  return data;
}
