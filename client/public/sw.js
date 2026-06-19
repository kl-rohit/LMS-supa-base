/* Veena service worker — offline app-shell cache.
 *
 * Registered with scope = PUBLIC_URL ("/app/" in prod), so it ONLY ever sees
 * requests under that path. API calls live under "/server/api/..." which is
 * OUTSIDE this scope, so the SW never intercepts (and never caches) tenant
 * data — important for a multi-tenant app. Do not widen the scope.
 *
 * Strategy:
 *   - navigations  -> network-first, fall back to the cached shell when offline
 *   - static (js/css/img/font) -> stale-while-revalidate
 *   - anything else -> passthrough
 *
 * Bump CACHE to force old caches to be discarded on the next activate.
 */

const CACHE = 'veena-shell-v2';
const SHELL_URL = new URL('./', self.registration.scope).href; // e.g. https://host/app/

// Precache the shell AND the hashed assets it references (bundle + css), so a
// cold offline launch can actually boot — caching only the HTML leaves it
// requesting a bundle that isn't cached, which renders a blank page.
async function precacheShell(cache) {
  const res = await fetch(SHELL_URL, { cache: 'reload' });
  await cache.put(SHELL_URL, res.clone());
  const html = await res.text();
  const urls = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) urls.add(m[1]);
  await Promise.all(
    [...urls].map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await precacheShell(cache);
      } catch (_e) { /* offline at install — shell caches on first online nav */ }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // App navigations: try the network, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (_e) {
          const cache = await caches.open(CACHE);
          const shell = await cache.match(SHELL_URL);
          if (shell) return shell;
          return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
              + '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#374151;text-align:center">'
              + '<div><h2 style="margin:0 0 .5rem">You’re offline</h2>'
              + '<p style="color:#6b7280">Reconnect and reopen VidyaSetu.</p></div>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
          );
        }
      })()
    );
    return;
  }

  // Static build assets: stale-while-revalidate.
  const dest = request.destination;
  if (dest === 'script' || dest === 'style' || dest === 'image' || dest === 'font') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
  }
});

// Let the page trigger an immediate update (used after a new deploy is detected).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- Web push ----------
// Payload shape (see functions/api/lib/notify.js):
//   { title, body, url, type }
// `url` is a portal-relative path ("/portal/...") which we resolve against the
// SW scope ("/app/") so the deep link lands inside the SPA.
function resolveAppUrl(rawUrl) {
  const scope = self.registration.scope; // e.g. https://host/app/
  const path = (rawUrl || '/portal').replace(/^\/+/, ''); // strip leading slashes
  try { return new URL(path, scope).href; } catch { return scope; }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'VidyaSetu';
  const url = resolveAppUrl(data.url);
  const options = {
    body: data.body || '',
    icon: resolveAppUrl('icons/icon-192.png'),
    badge: resolveAppUrl('icons/icon-192.png'),
    tag: data.type || 'veena',          // collapse same-type bursts
    renotify: true,
    data: { url },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || resolveAppUrl('/portal');
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an already-open Veena tab if we have one; otherwise open a new one.
      for (const client of all) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    })()
  );
});
