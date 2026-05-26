/* Service worker for WorkTrack Pro PWA.
 * - App shell: cached on install for offline navigation
 * - Hashed assets (/assets/*): cache-first (Vite fingerprints them, so they're immutable)
 * - Navigation requests: network-first, fallback to cached shell
 */
const CACHE_NAME = 'worktrack-pro-v3';
const ASSETS_CACHE = 'worktrack-pro-assets-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/', '/index.html', '/manifest.webmanifest']);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== ASSETS_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Hashed static assets (JS chunks, CSS, images) — cache-first, immutable
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Navigation requests — network-first, fallback to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((r) => r || caches.match('/index.html'))
      )
    );
    return;
  }
});
