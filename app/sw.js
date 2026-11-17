// Offline support: the app shell is cached so Carver opens without a connection.
const VERSION = 'carver-v7';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/store.js', 'js/db.js', 'js/sync.js', 'js/editor.js', 'js/scene.js', 'js/sound.js', 'js/icons.js',
  'js/compile.js', 'js/radio.js', 'js/importer.js', 'js/files.js', 'js/vendor.js',
  'vendor/jszip.min.js', 'vendor/mammoth.browser.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.github.com') return;
  if (url.origin === location.origin) {
    // Network first, always checking with the server (so updates arrive immediately),
    // falling back to the cached copy when offline.
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
    })));
  }
});
