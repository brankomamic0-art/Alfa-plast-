/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(/^\/api\//, new NetworkOnly());
registerRoute(/^\/uploads\//, new StaleWhileRevalidate({ cacheName: 'uploads-cache' }));

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// ---- Push obavijesti: prikazuju se i kad je aplikacija zatvorena ----
self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; refType?: string; refId?: number } = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: 'Alfa Plast', body: event.data?.text() || '' };
  }

  const title = data.title || 'Alfa Plast';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: data.refType && data.refId ? `${data.refType}-${data.refId}` : undefined,
      data: { refType: data.refType, refId: data.refId },
    })
  );
});

// ---- Klik na obavijest: fokusiraj/otvori app ----
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList[0];
      if (existing) {
        existing.focus();
      } else {
        await self.clients.openWindow('/');
      }
    })()
  );
});
