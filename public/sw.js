// Offline shell: the app opens without the Mac mini, shows the last-loaded page.
// API calls always go to the network (quotes live on the Mac mini, not in the phone).
const CACHE = 'pricer-v2';
const SHELL = ['/', '/style.css', '/app.js', '/src/pricing.js', '/src/catalogue.js', '/manifest.webmanifest', '/icons/icon-192.png', '/fonts/Nuckle-Medium.woff2', '/fonts/Nuckle-Semibold.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Network first so edits show up at once; cache as the fallback.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('/'))));
});
