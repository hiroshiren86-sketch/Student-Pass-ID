/**
 * ==============================================================================
 * SERVICIO DE NOTIFICACIONES PUSH — Ronda 23 (Excusas P4, spec 2026 §4)
 * El Worker es la única autoridad: la clave VAPID se pide a /api/push/public-key
 * y las suscripciones se registran/bajan en /api/push/subscribe|unsubscribe.
 *
 * Flujo de activación (por dispositivo):
 *   1. Registrar /push-sw.js (service worker de notificaciones).
 *   2. Notification.requestPermission() — el navegador pide permiso al usuario.
 *   3. pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).
 *   4. POST /api/push/subscribe con rol (RECTORIA | PORTAL) y studentCode opcional.
 *
 * Roles: RECTORIA recibe "nueva excusa por revisar"; PORTAL recibe la decisión
 * (verificada / rechazada con motivo). WCAG/veracidad: los errores se muestran,
 * nunca se simula éxito.
 * ==============================================================================
 */

const SW_PATH = '/push-sw.js';

function getWorkerBaseUrl(): string {
  try {
    const raw = localStorage.getItem('inas_settings_v5');
    const settings = raw ? JSON.parse(raw) : {};
    return (settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function workerHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem('inas_settings_v5');
    const token = raw ? (JSON.parse(raw).cloudflareApiToken || '') : '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  } catch {
    return { 'Content-Type': 'application/json' };
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Ronda 24 (fix crítico): la sesión `inas_user_session_v5` históricamente NUNCA se
 * escribía (saveCurrentSession sin llamadores) → toda suscripción se registraba como
 * PORTAL y el push de "nueva excusa" (dirigido a RECTORIA) jamás tenía destinatarios.
 * Ahora el rol vive en DOS fuentes, en orden de confianza:
 *   1. `inas_push_role_v1` — escrito por App.tsx en cada login/cambio de rol.
 *   2. `inas_user_session_v5` — respaldo (persistida desde Ronda 24).
 */
function currentRole(): 'RECTORIA' | 'PORTAL' {
  try {
    const flag = localStorage.getItem('inas_push_role_v1');
    if (flag === 'RECTORIA' || flag === 'PORTAL') return flag;
    const raw = localStorage.getItem('inas_user_session_v5');
    const session = raw ? JSON.parse(raw) : {};
    return session?.role === 'ADMIN' ? 'RECTORIA' : 'PORTAL';
  } catch {
    return 'PORTAL';
  }
}

function currentStudentCode(): string | null {
  try {
    const raw = localStorage.getItem('inas_user_session_v5');
    const session = raw ? JSON.parse(raw) : {};
    return (session?.studentCode || '').trim() || null;
  } catch {
    return null;
  }
}

export interface PushEnableResult { ok: boolean; message: string }

/** Activa las notificaciones en ESTE dispositivo (permiso + suscripción + registro en el Worker). */
export async function enablePush(): Promise<PushEnableResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, message: 'Este navegador no soporta notificaciones push (requiere HTTPS y navegador moderno).' };
  }
  const baseUrl = getWorkerBaseUrl();
  if (!baseUrl) {
    return { ok: false, message: 'Configura primero la URL del Cloudflare Worker (Conexión Cloudflare).' };
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH);
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, message: 'Permiso de notificaciones denegado. Actívalo en la configuración del navegador si cambias de opinión.' };
    }

    const keyRes = await fetch(`${baseUrl}/api/push/public-key`, { headers: workerHeaders() });
    const keyData = await keyRes.json().catch(() => null);
    if (!keyRes.ok || !keyData?.success) {
      return { ok: false, message: keyData?.error || `El Worker no tiene notificaciones activas (HTTP ${keyRes.status}).` };
    }

    let sub = await registration.pushManager.getSubscription();
    if (sub) {
      // Ronda 24: si la clave VAPID del Worker rotó (applicationServerKey distinto),
      // la suscripción vieja está huérfana → se renueva en silencio. Sin esto, tras
      // rotar claves habría que limpiar localStorage a mano en cada dispositivo.
      const currentKeyB64 = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey as ArrayBufferLike & ArrayLike<number>)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (currentKeyB64 !== keyData.publicKey) {
        await sub.unsubscribe().catch(() => {});
        sub = null as any;
      }
    }
    if (!sub) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource
      });
    }
    const json = sub.toJSON();
    const res = await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, role: currentRole(), studentCode: currentStudentCode() })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return { ok: false, message: data?.error || `No se pudo registrar la suscripción (HTTP ${res.status}).` };
    }
    return { ok: true, message: 'Notificaciones activadas en este dispositivo.' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Fallo al activar las notificaciones.' };
  }
}

/** Desactiva las notificaciones en ESTE dispositivo (baja la suscripción del Worker). */
export async function disablePush(): Promise<PushEnableResult> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sub = await registration?.pushManager.getSubscription();
    const baseUrl = getWorkerBaseUrl();
    if (sub && baseUrl) {
      await fetch(`${baseUrl}/api/push/unsubscribe`, {
        method: 'POST',
        headers: workerHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => null);
    }
    const unsub = await sub?.unsubscribe();
    return { ok: true, message: unsub ? 'Notificaciones desactivadas en este dispositivo.' : 'No había notificaciones activas.' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Fallo al desactivar las notificaciones.' };
  }
}

/** Estado actual de las notificaciones en ESTE dispositivo. */
export async function getPushStatus(): Promise<{ supported: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sub = await registration?.pushManager.getSubscription();
    return { supported: true, permission: Notification.permission, subscribed: !!sub };
  } catch {
    return { supported: true, permission: Notification.permission, subscribed: false };
  }
}
