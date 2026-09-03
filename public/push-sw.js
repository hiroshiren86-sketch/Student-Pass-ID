/**
 * ==============================================================================
 * SERVICE WORKER DE NOTIFICACIONES PUSH — Ronda 23 (Excusas P4, spec 2026)
 * Recibe los push del Worker (VAPID) y los muestra como notificaciones del
 * sistema. También abre/enfoca la app al tocar la notificación.
 *
 * NOTA: este SW es SOLO de notificaciones (no cachea assets — la PWA completa
 * es un ítem aparte del roadmap). Se registra desde src/services/pushService.ts.
 * ==============================================================================
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
