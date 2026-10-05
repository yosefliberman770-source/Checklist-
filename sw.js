// Offline support. When online, always load the newest files from the
// network (bypassing the browser's HTTP cache) and keep a copy; when offline
// or the network is too slow, fall back to that copy. Bump VERSION whenever
// app files change.
const VERSION = 'myday-v12';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/ctx.js', './js/store.js', './js/engine.js', './js/format.js', './js/util.js', './js/charts.js',
  './js/views/today.js', './js/views/editor.js', './js/views/goals.js', './js/views/stats.js',
  './js/views/history.js', './js/views/settings.js', './js/views/categories.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so an update never stores stale files.
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const fromNetwork = fetch(url.href, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([fromNetwork, timeout]);
      if (res) return res;
    } catch { /* offline: use the saved copy */ }
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached || fromNetwork;
  })());
});
