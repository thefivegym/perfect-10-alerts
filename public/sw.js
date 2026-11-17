/* Push only. The page itself is always loaded from the network. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Perfect 10';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'A Division I gymnast just scored a 10.0.',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    data,
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'unsubscribe', title: 'Unsubscribe' },
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = event.action === 'unsubscribe' ? data.unsubscribe : (data.open || data.url);
  if (!target) return;
  event.waitUntil(self.clients.openWindow(target));
});
