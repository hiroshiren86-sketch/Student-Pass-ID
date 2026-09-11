/**
 * =============================================================================
 * RONDA 60 — VERIFICACIÓN SERVER-SIDE DE TARJETAS DE CLASE (CLASE:v1 / CLASE:v2)
 * =============================================================================
 *
 * CONTEXTO (bug real reportado por el propietario, origen de la auditoría 2026-09):
 * un representante, desde el PORTAL ESTUDIANTE, escaneaba la Tarjeta QR de Clase
 * (inglés, filosofía, economía…) y recibía "firma inválida" sin que la clase se
 * activara. Causa raíz: la verificación HMAC exige el qrSecret DEL DISPOSITIVO, y
 * el del estudiante era otro (aleatorio de fábrica, R56) o —desde Ronda 59— ya no
 * viaja a ese rol POR DISEÑO (verificar = poder firmar en HMAC simétrico).
 *
 * SOLUCIÓN ("verificar no es firmar", lado servidor): el Worker SÍ tiene el secret
 * institucional (vive en el snapshot) y verifica la tarjeta POR el estudiante:
 *
 *   POST /api/verify/class-token  { token }  →  { verified, reason, kind, context }
 *
 * El dispositivo del estudiante jamás recibe el secret; recibe solo el VEREDICTO.
 * Terminales de escaneo y docentes siguen verificando OFFLINE con su secret local
 * (más rápido y sin depender de red); este endpoint es el camino de los portales.
 *
 * Nada de lo que devuelve es sensible: un veredicto válido/inválido no filtra el
 * secret (verificar un HMAC forjado por fuerza bruta sigue siendo computacionalmente
 * inviable) ni datos de terceros (el contexto es el de la PROPIA tarjeta escaneada).
 */

export interface ClassTokenVerdict {
  /** true SOLO si formato válido + firma verificada + no expirada. */
  verified: boolean;
  /** OK | MALFORMED | BAD_SIGNATURE | EXPIRED | UNKNOWN_FORMAT | NO_SECRET */
  reason: string;
  /** 'CLASE_V1' (QR de pizarra) | 'CLASE_V2' (Tarjeta de Docente) */
  kind?: 'CLASE_V1' | 'CLASE_V2';
  /** Campos firmados de la tarjeta (lo que el token MISMO declara). */
  context?: {
    teacherId?: string;
    subjectSlug?: string;
    grade?: string;
    slotId?: string;
    dayOfWeek?: number;
    expiresAt?: number;
  };
}

/** HMAC-SHA256 hex con WebCrypto (Workers). Recibe el secret como texto. */
async function hmacHex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante entre dos hex (mismo patrón que authz.ts). */
function timingSafeHexEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/**
 * Verifica un token CLASE:v1/v2 contra una lista de secrets institucionales
 * (el vigente y el legacy — tolerancia a rotación, mismo criterio del cliente).
 * Acepta firmas de 32 hex (R58+) y 16 hex (tarjetas impresas pre-R58).
 */
export async function verifyClassToken(token: string, secrets: string[]): Promise<ClassTokenVerdict> {
  const trimmed = String(token || '').trim();
  if (!trimmed.startsWith('CLASE:v')) {
    return { verified: false, reason: 'UNKNOWN_FORMAT' };
  }
  const validSecrets = secrets.filter(s => typeof s === 'string' && s.length > 0);
  if (validSecrets.length === 0) {
    return { verified: false, reason: 'NO_SECRET' };
  }

  const parts = trimmed.split(':');

  // ── CLASE:v2:teacherId:subjectSlug:expiresAtMs:sig (6 partes) ──
  if (trimmed.startsWith('CLASE:v2:')) {
    if (parts.length !== 6) return { verified: false, kind: 'CLASE_V2', reason: 'MALFORMED' };
    const [, , teacherId, subjectSlug, expStr, sig] = parts;
    const expiresAt = Number(expStr);
    if (!teacherId || !subjectSlug || !Number.isFinite(expiresAt) || !/^[0-9a-f]{16}|[0-9a-f]{32}$/.test(sig || '')) {
      return { verified: false, kind: 'CLASE_V2', reason: 'MALFORMED' };
    }
    const base = `${teacherId}|${subjectSlug}|${expiresAt}`;
    let signatureOk = false;
    for (const secret of validSecrets) {
      const expected = (await hmacHex(base, secret)).substring(0, sig.length); // 32 o 16 según el token
      if (timingSafeHexEqual(expected, sig)) { signatureOk = true; break; }
    }
    if (!signatureOk) return { verified: false, kind: 'CLASE_V2', reason: 'BAD_SIGNATURE' };
    if (Date.now() > expiresAt) {
      return { verified: false, kind: 'CLASE_V2', reason: 'EXPIRED', context: { teacherId, subjectSlug, expiresAt } };
    }
    return { verified: true, kind: 'CLASE_V2', reason: 'OK', context: { teacherId, subjectSlug, expiresAt } };
  }

  // ── CLASE:v1:grade:slotId:dayOfWeek:expiresAtMs:sig (7 partes) ──
  if (trimmed.startsWith('CLASE:v1:')) {
    if (parts.length !== 7) return { verified: false, kind: 'CLASE_V1', reason: 'MALFORMED' };
    const [, , grade, slotId, dowStr, expStr, sig] = parts;
    const dayOfWeek = Number(dowStr);
    const expiresAt = Number(expStr);
    if (!grade || !slotId || !Number.isFinite(dayOfWeek) || !Number.isFinite(expiresAt) || !/^[0-9a-f]{16}|[0-9a-f]{32}$/.test(sig || '')) {
      return { verified: false, kind: 'CLASE_V1', reason: 'MALFORMED' };
    }
    const base = `${grade}|${slotId}|${dayOfWeek}|${expiresAt}`;
    let signatureOk = false;
    for (const secret of validSecrets) {
      const expected = (await hmacHex(base, secret)).substring(0, sig.length);
      if (timingSafeHexEqual(expected, sig)) { signatureOk = true; break; }
    }
    if (!signatureOk) return { verified: false, kind: 'CLASE_V1', reason: 'BAD_SIGNATURE' };
    if (Date.now() > expiresAt) {
      return { verified: false, kind: 'CLASE_V1', reason: 'EXPIRED', context: { grade, slotId, dayOfWeek, expiresAt } };
    }
    return { verified: true, kind: 'CLASE_V1', reason: 'OK', context: { grade, slotId, dayOfWeek, expiresAt } };
  }

  return { verified: false, reason: 'UNKNOWN_FORMAT' };
}
