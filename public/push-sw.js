/**
 * ==============================================================================
 * SERVICE WORKER DE NOTIFICACIONES PUSH — Ronda 23 (Excusas P4, spec 2026)
 * Recibe los push del Worker (VAPID) y los muestra como notificaciones del
 * sistema. También abre/enfoca la app al tocar la notificación.
 *
 * PWA COMPLETA — Ronda 32: este MISMO worker (alcance raíz "/") añade la capa
 * de app-shell offline. Debe ser único por alcance: si hubiera otro SW en "/",
 * las suscripciones push (vinculadas al registro del SW) se romperían.
 *
 * Estrategia de caché:
 *  - Navegaciones ("/"): network-first con respaldo offline (el shell de la app
 *    se sirve desde caché si no hay red; los DATOS ya son offline-first por
 *    diseño — viven en localStorage del dispositivo).
 *  - /assets/* (bundles Vite con hash inmutable): cache-first.
 *  - Estáticos propios (iconos, manifest): stale-while-revalidate.
 *  - JAMÁS se cachea: /api/* (Cloudflare Worker/D1 — datos en vivo) ni nada
 *    cross-origin (Firebase, fuentes) — pasan directo a la red.
 * ==============================================================================
 */

const SHELL_CACHE = 'inas-pwa-shell-v1';
const STATIC_CACHE = 'inas-pwa-static-v1';

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/logo-inas.png',
  '/logo-inas-192.png',
  '/logo-inas-maskable-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        // El shell se precachea; si falla (p.ej. instalado offline), no bloquea el install.
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        console.warn('[SW] Precache parcial:', e);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Limpieza de versiones anteriores de caché (futuras iteraciones)
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('inas-pwa-') && k !== SHELL_CACHE && k !== STATIC_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/** ¿Es una URL que jamás debemos cachear/interceptar? */
function isBypassed(url) {
  // API del Worker Cloudflare (D1/KV/excusas/push): SIEMPRE red en vivo.
  if (url.pathname.startsWith('/api/')) return true;
  // Cualquier origen distinto del propio (Firebase, Google Fonts, IA): red directa.
  if (url.origin !== self.location.origin) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (isBypassed(url)) return;

  // 1) Navegación de la SPA: network-first, respaldo al shell cacheado.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        const shell = (await cache.match('/')) || (await cache.match(req));
        if (shell) return shell;
        return new Response(
          '<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin conexión</title><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;text-align:center"><div><h1>Sin conexión</h1><p>Abra la app de nuevo cuando recupere la red.</p></div></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 2) Bundles con hash inmutable: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // 3) Estáticos propios (iconos, manifest, push-sw.js): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => hit || Response.error());
    return hit || network;
  })());
});

// ============================ PUSH (Ronda 23 — intacto) ============================

self.addEventListener('push', (event) => {
  let data = { title: 'INAS — Notificación', body: 'Tienes una novedad de excusas.', tag: 'inas', url: '/' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) { /* payload inválido: se usan los valores por defecto */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag || 'inas',
    renotify: true,
    requireInteraction: false,
    icon: '/logo-inas.png',
    badge: '/logo-inas.png',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      const u = new URL(client.url);
      if (u.pathname === target || u.pathname === '/') {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
