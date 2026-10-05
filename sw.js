// Offline support: serve the app from cache, refresh the cache in the
// background. Bump VERSION whenever app files change.
const VERSION = 'myday-v2';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/ctx.js', './js/store.js', './js/engine.js', './js/format.js', './js/util.js', './js/charts.js',
  './js/views/today.js', './js/views/editor.js', './js/views/goals.js', './js/views/stats.js',
  './js/views/history.js', './js/views/settings.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
