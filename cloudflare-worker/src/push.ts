/**
 * ==============================================================================
 * WEB PUSH (Ronda 23 — Fase P4 de spec-excusas-2026, NOTIFICACIONES)
 * Protocolo: RFC 8030 (Web Push) + RFC 8291 (aes128gcm) + RFC 8292 (VAPID).
 * 100% WebCrypto en el Worker — sin dependencias externas (OWASP supply chain).
 *
 * Flujo:
 *   1. El navegador (service worker /push-sw.js) pide permiso y se suscribe con
 *      la clave pública VAPID (GET /api/push/public-key).
 *   2. La suscripción (endpoint + p256dh + auth) se guarda en D1
 *      (POST /api/push/subscribe) con rol y studentCode opcional.
 *   3. El módulo de excusas dispara notificaciones:
 *      - EXCUSE_CREATED  → suscripciones RECTORIA ("nueva excusa por revisar")
 *      - EXCUSE_APPROVED → suscripciones del estudiante ("verificada")
 *      - EXCUSE_REJECTED → suscripciones del estudiante ("rechazada" + motivo)
 *   4. Endpoints 404/410 del push service → la suscripción se borra (higiene).
 *
 * Envío BEST-EFFORT: un fallo de push NUNCA rompe la operación principal de la
 * excusa (Regla del sistema: el Worker es la autoridad, el push es cortesía).
 * ==============================================================================
 */
import type { Env } from './index';

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key, length * 8
  );
  return new Uint8Array(bits);
}

// ============================ VAPID (RFC 8292) ===============================

interface VapidKeys { publicKey: string; privateKey: string; subject: string }

function getVapidKeys(env: Env): VapidKeys | null {
  const publicKey = (env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;
  if (!B64URL_RE.test(publicKey) || !B64URL_RE.test(privateKey)) return null;
  return { publicKey, privateKey, subject: (env.VAPID_SUBJECT || 'mailto:admin@example.com').trim() };
}

/** JWT ES256 firmado con la clave VAPID (ECDSA P-256, firma raw r||s de 64 bytes) */
async function createVapidJwt(endpoint: string, keys: VapidKeys): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject
  })));
  const unsigned = `${header}.${payload}`;

  const pubBytes = b64urlToBytes(keys.publicKey);   // 0x04 || X(32) || Y(32)
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
    d: keys.privateKey,
    ext: true
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)
  ));
  return `${unsigned}.${bytesToB64url(sig)}`;
}

// ====================== CIFRADO del payload (RFC 8291) =======================
// Esquema aes128gcm: header(salt16 + rs4 + idh_len4 + eph_pub65) + ciphertext.

async function encryptPayload(payload: string, p256dhB64url: string, authB64url: string): Promise<Uint8Array | null> {
  try {
    const uaPublic = b64urlToBytes(p256dhB64url);
    const authSecret = b64urlToBytes(authB64url);
    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length < 16) return null;

    // 1) IKM = HKDF(ecdh_secreto, salt=auth_secret, info="WebPush: info" || 0x00 || ua_pub || eph_pub)
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const ephPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey) as ArrayBuffer);
    const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublic as BufferSource } as any, eph.privateKey, 256
    ));
    const keyInfo = concatBytes(
      new TextEncoder().encode('WebPush: info'), new Uint8Array(1), uaPublic, ephPublicRaw
    );
    const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);

    // 2) salt aleatorio + CEK(16) y NONCE(12) derivados del IKM
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(ikm, salt, concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array(1)), 16);
    const nonce = await hkdf(ikm, salt, concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array(1)), 12);

    // 3) registro: plaintext || delimitador 0x02 || padding cero (rs=4096, un solo registro)
    const plaintext = new TextEncoder().encode(payload);
    if (plaintext.length > 4096 - 2) return null; // excede un registro: no se trunca jamás
    const record = new Uint8Array(plaintext.length + 1);
    record.set(plaintext, 0);
    record[plaintext.length] = 0x02;

    const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, record as BufferSource));

    // 4) header aes128gcm
    const header = concatBytes(
      salt,
      new Uint8Array([0x00, 0x00, 0x10, 0x00]),           // rs = 4096 (big-endian)
      new Uint8Array([0x00, 0x00, 0x00, 0x41]),           // idh_len = 65
      ephPublicRaw
    );
    return concatBytes(header, ciphertext);
  } catch {
    return null;
  }
}

// ============================ ALMACÉN EN D1 ==================================

export async function ensurePushTable(env: Env): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
       id TEXT PRIMARY KEY,
       endpoint TEXT NOT NULL UNIQUE,
       p256dh TEXT NOT NULL,
       auth TEXT NOT NULL,
       role TEXT NOT NULL DEFAULT 'PORTAL',
       student_code TEXT,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT DEFAULT (datetime('now'))
     )`
  ).run();
}

/** Envía un push a todas las suscripciones de un rol (y/o estudiante). Best-effort. */
export async function sendPushTo(env: Env, opts: {
  role?: string; studentCode?: string; title: string; body: string; tag?: string; url?: string
}): Promise<number> {
  const keys = getVapidKeys(env);
  if (!keys || !env.DB) return 0;
  try {
    await ensurePushTable(env);
    let rows: Array<{ endpoint: string; p256dh: string; auth: string; id: string }> = [];
    if (opts.studentCode) {
      rows = (await env.DB.prepare(
        `SELECT endpoint, p256dh, auth, id FROM push_subscriptions WHERE student_code = ?`
      ).bind(opts.studentCode).all<{ endpoint: string; p256dh: string; auth: string; id: string }>()).results || [];
    } else if (opts.role) {
      rows = (await env.DB.prepare(
        `SELECT endpoint, p256dh, auth, id FROM push_subscriptions WHERE role = ?`
      ).bind(opts.role).all<{ endpoint: string; p256dh: string; auth: string; id: string }>()).results || [];
    }
    if (!rows.length) return 0;

    const payload = JSON.stringify({ title: opts.title, body: opts.body, tag: opts.tag || 'inas', url: opts.url || '/' });
    let sent = 0;
    const stale: string[] = [];
    for (const sub of rows) {
      try {
        const body = await encryptPayload(payload, sub.p256dh, sub.auth);
        if (!body) { stale.push(sub.id); continue; }
        const jwt = await createVapidJwt(sub.endpoint, keys);
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400',
            'Urgency': 'normal',
            'Authorization': `vapid t=${jwt}, k=${keys.publicKey}`
          },
          body: body as unknown as BodyInit
        });
        if (res.status === 201 || res.status === 200) sent++;
        else if (res.status === 404 || res.status === 410) stale.push(sub.id); // suscripción muerta
      } catch { /* una suscripción que falla no detiene a las demás */ }
    }
    for (const id of stale) {
      await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id).run();
    }
    // Ronda 24: observabilidad mínima — visible con `wrangler tail` para diagnosticar
    // entregas sin instrumentar el cliente (p.ej. 403 = VAPID inválido/mal rotado).
    console.log(`[push] rol=${opts.role || opts.studentCode || '?'} destino=${rows.length} enviados=${sent} muertos=${stale.length}`);
    return sent;
  } catch {
    return 0; // el push jamás rompe el flujo principal
  }
}

// ================================ RUTAS ======================================

export async function handlePushRoutes(request: Request, env: Env, url: URL, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/push')) return null;
  if (!env.DB) return new Response(JSON.stringify({ success: false, error: 'D1 no configurada.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

  // GET /api/push/public-key — el navegador necesita la clave VAPID para suscribirse
  if (path === '/api/push/public-key' && request.method === 'GET') {
    const keys = getVapidKeys(env);
    if (!keys) {
      return new Response(JSON.stringify({
        success: false,
        error: 'El servidor no tiene claves VAPID configuradas (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY). Las notificaciones push no están activas.'
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true, publicKey: keys.publicKey }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // POST /api/push/subscribe — registra/renueva la suscripción del navegador
  if (path === '/api/push/subscribe' && request.method === 'POST') {
    let body: any;
    try { body = await request.json(); } catch { return err('JSON inválido.'); }
    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.keys?.p256dh || '').trim();
    const auth = String(body.keys?.auth || '').trim();
    const role = ['RECTORIA', 'PORTAL'].includes(String(body.role)) ? String(body.role) : 'PORTAL';
    const studentCode = body.studentCode ? String(body.studentCode).trim() : null;
    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
      return err('Suscripción inválida: se requiere endpoint https, keys.p256dh y keys.auth.');
    }
    await ensurePushTable(env);
    const id = `push-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, role, student_code)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth,
         role=excluded.role, student_code=excluded.student_code, updated_at=datetime('now')`
    ).bind(id, endpoint, p256dh, auth, role, studentCode).run();
    return ok({ success: true, message: 'Suscripción registrada. Recibirás notificaciones de las excusas.' });
  }

  // POST /api/push/unsubscribe — baja por endpoint (el usuario desactivó notificaciones)
  if (path === '/api/push/unsubscribe' && request.method === 'POST') {
    let body: any;
    try { body = await request.json(); } catch { return err('JSON inválido.'); }
    const endpoint = String(body.endpoint || '').trim();
    if (!endpoint) return err('Falta el endpoint.');
    await ensurePushTable(env);
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint).run();
    return ok({ success: true, message: 'Suscripción eliminada.' });
  }

  return null; // no es una ruta de push
}

function ok(data: any): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function err(message: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
