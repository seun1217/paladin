/* 쿠팡 특가 알리미 service worker: push display, click routing, subscription refresh. */
const SW_VERSION = 'v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || '쿠팡 특가 알림';
  const options = {
    body: data.body || '평시보다 크게 할인 중인 상품이 있어요.',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    image: data.image || undefined,
    tag: data.tag || undefined,
    renotify: false,
    lang: 'ko-KR',
    timestamp: Date.now(),
    data: { url: data.url || '/' },
  };
  // Always show a notification: Chrome shows a generic notice otherwise and Safari may revoke silent pushes.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    let target = new URL(url, self.location.origin);
    // The server builds absolute links from BASE_URL; if that is misconfigured (e.g. still localhost behind a proxy)
    // keep the path but use the origin this worker was actually served from.
    if (/^https?:$/.test(target.protocol) && target.origin !== self.location.origin && !/(^|\.)coupang\.com$/.test(target.hostname)) {
      target = new URL(target.pathname + target.search, self.location.origin);
    }
    if (target.origin === self.location.origin && !target.pathname.startsWith('/go/')) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) { await w.focus(); if ('navigate' in w) return w.navigate(target.href); return; }
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let newSub = event.newSubscription || null;
    if (!newSub) {
      let key = event.oldSubscription && event.oldSubscription.options ? event.oldSubscription.options.applicationServerKey : null;
      if (!key) {
        const cfg = await (await fetch('/api/config')).json();
        if (!cfg.vapidPublicKey) return;
        key = urlBase64ToUint8Array(cfg.vapidPublicKey);
      }
      newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    // user id is kept by the page in localStorage; the SW cannot read it, so ask any open client
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let userId = null;
    for (const c of clients) {
      const reply = await new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (m) => resolve(m.data);
        c.postMessage({ type: 'get-user-id' }, [ch.port2]);
        setTimeout(() => resolve(null), 1000);
      });
      if (reply && reply.userId) { userId = reply.userId; break; }
    }
    const cache = await caches.open('deal-alerts-meta');
    if (!userId) {
      const r = await cache.match('/meta/user-id');
      if (r) userId = (await r.text()) || null;
    }
    if (!userId) return;
    await fetch(`/api/users/${encodeURIComponent(userId)}/push`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: newSub.toJSON(), oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null }),
    });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'set-user-id' && event.data.userId) {
    event.waitUntil(caches.open('deal-alerts-meta').then((c) => c.put('/meta/user-id', new Response(String(event.data.userId)))));
  }
});
