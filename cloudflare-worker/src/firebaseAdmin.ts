/**
 * R67 — Cliente REST de Firebase Identity Toolkit (Admin) con la Service
 * Account del Worker.
 *
 * CONTEXTO Y AUTORIZACIÓN (Regla 7, actualizada por la directiva máster del
 * propietario del 15/09/2026 §11/§16): la SA del Worker se usa EXCLUSIVAMENTE
 * para operaciones administrativas sobre cuentas EXISTENTES solicitadas por
 * Rectoría a través de los flujos de la aplicación (restablecer contraseña,
 * eliminar cuenta en la cascada) y para diagnóstico de solo lectura
 * (inventario/lookup). SIGUE PROHIBIDO: crear cuentas con la SA (la provisión
 * de cuentas vive en el cliente con el flujo real de Rectoría, R50), crear
 * cuentas de administrador/Rectoría, impersonar identidades o emitir custom
 * tokens.
 *
 * VERIFICACIÓN EMPÍRICA (15/09/2026, contra producción): los endpoints admin
 * v2 de identitytoolkit (`/v2/projects/{id}/accounts:query`) responden 404 en
 * este proyecto (Firebase Auth estándar, sin Identity Platform/GCIP). Los
 * endpoints ADMIN que el Firebase Admin SDK usa históricamente para proyectos
 * estándar son los v3 "relyingparty" en
 *   https://www.googleapis.com/identitytoolkit/v3/relyingparty/<método>
 * autenticados con el OAuth2 access token de la SA (mismo token que el Worker
 * ya acuña para Firestore; el scope cloud-platform cubre la operación). Estos
 * son los métodos implementados aquí:
 *   · downloadAccount  — listar cuentas paginado (inventario)
 *   · getAccountInfo   — lookup por email o localId
 *   · setAccountInfo   — restablecer contraseña {localId, password}
 *   · deleteAccount    — eliminar cuenta {localId}
 * El access token se cachea ~50 min (vence ~1h).
 */
import { SignJWT, importPKCS8 } from 'jose';

// Cache del access_token de la SA (vence ~1h; se cachea 50min). Independiente
// del de authz.ts (mismo costo: se acuña una vez por isolate y se comparte).
let saTokenCache: { token: string; expiresAt: number } | null = null;

export async function getSaAdminAccessToken(env: any): Promise<string> {
  if (saTokenCache && Date.now() < saTokenCache.expiresAt) return saTokenCache.token;
  const email = env.FIREBASE_SA_CLIENT_EMAIL;
  const pk = env.FIREBASE_SA_PRIVATE_KEY;
  if (!email || !pk) {
    throw new Error('Firebase SA no configurada (FIREBASE_SA_CLIENT_EMAIL / FIREBASE_SA_PRIVATE_KEY).');
  }
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(String(pk).replace(/\\n/g, '\n'), 'RS256');
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
  });
  const json = await res.json() as any;
  if (!json.access_token) {
    throw new Error('No se pudo obtener access_token de la SA: ' + (json.error_description || json.error || res.status));
  }
  saTokenCache = { token: json.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return json.access_token;
}

const ITK_V3 = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';

async function itkPost(env: any, method: string, body: any): Promise<any> {
  const token = await getSaAdminAccessToken(env);
  const res = await fetch(`${ITK_V3}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => null) as any;
  if (!res.ok) {
    const apiMsg = json && (json.error && (json.error.message || json.error.errors?.[0]?.message || json.error.code)) ;
    const err = new Error(apiMsg ? `${apiMsg} (HTTP ${res.status})` : `identitytoolkit ${method} HTTP ${res.status}`) as any;
    err.itkStatus = res.status;
    err.itkBody = json;
    throw err;
  }
  return json;
}

export interface ItkAccount {
  localId: string;
  email?: string;
  displayName?: string;
  disabled?: boolean;
  emailVerified?: boolean;
  createdAt?: string;   // ms epoch (string) en v3
  lastLoginAt?: string; // ms epoch (string) en v3
  validSince?: string;
  providerUserInfo?: Array<{ providerId: string; email?: string; displayName?: string; rawId?: string }>;
}

function normAccount(a: any): ItkAccount {
  return {
    localId: String(a.localId || ''),
    email: a.email || undefined,
    displayName: a.displayName || undefined,
    disabled: a.disabled === true,
    emailVerified: a.emailVerified === true || a.emailVerified === 'true',
    createdAt: a.createdAt ? new Date(Number(a.createdAt)).toISOString() : undefined,
    lastLoginAt: a.lastLoginAt ? new Date(Number(a.lastLoginAt)).toISOString() : undefined,
    validSince: a.validSince ? new Date(Number(a.validSince) * 1000).toISOString() : undefined,
    providerUserInfo: a.providerUserInfo || []
  };
}

/**
 * downloadAccount — lista paginada de TODAS las cuentas del proyecto
 * (solo lectura; maxResults ≤ 1000 por página).
 */
export async function itkQueryAccounts(env: any, pageSize = 200, pageToken?: string): Promise<{ accounts: ItkAccount[]; nextPageToken?: string }> {
  const out = await itkPost(env, 'downloadAccount', { maxResults: pageSize, ...(pageToken ? { nextPageToken: pageToken } : {}) });
  return {
    accounts: ((out.users || []) as any[]).map(normAccount),
    nextPageToken: out.nextPageToken || undefined
  };
}

/** getAccountInfo — lookup por email (resuelve uid a partir del correo). */
export async function itkGetAccountByEmail(env: any, email: string): Promise<ItkAccount | null> {
  const out = await itkPost(env, 'getAccountInfo', { email: [email] });
  const users = (out.users || []) as any[];
  return users.length > 0 ? normAccount(users[0]) : null;
}

/**
 * setAccountInfo — RESTABLECER la contraseña de una cuenta EXISTENTE sin
 * conocer la anterior (operación administrativa autorizada, directiva §11).
 * Firebase exige contraseña de 6–4096 caracteres; el llamador valida antes.
 * Devuelve la respuesta de la API (incluye localId/email confirmados).
 */
export async function itkUpdateAccountPassword(env: any, localId: string, newPassword: string): Promise<ItkAccount> {
  const out = await itkPost(env, 'setAccountInfo', { localId, password: newPassword });
  return normAccount(out);
}

/** deleteAccount — elimina la cuenta (usado por la cascada de Rectoría, §5/R64). */
export async function itkDeleteAccount(env: any, localId: string): Promise<void> {
  await itkPost(env, 'deleteAccount', { localId });
}
