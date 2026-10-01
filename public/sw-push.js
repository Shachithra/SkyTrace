/* SkyTrace push + notification handlers, imported into the Workbox service worker. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SkyTrace', body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'SkyTrace pass alert';
  const options = {
    body: typeof data.body === 'string' ? data.body.slice(0, 300) : '',
    tag: typeof data.tag === 'string' ? data.tag : 'skytrace-pass',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/?view=passes' },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      typeof data.badge === 'number' && self.navigator.setAppBadge ? self.navigator.setAppBadge(data.badge).catch(() => {}) : Promise.resolve(),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/?view=passes';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
