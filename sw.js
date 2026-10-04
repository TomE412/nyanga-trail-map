// Offline worker. Bump SHELL on every release (match APP_VERSION in app.js);
// that is what makes phones pick up new files. The tile cache is kept across
// releases so runners don't have to download the map again.
const SHELL = 'shell-v1';
const TILES = 'tiles-v1';
const CORE = [
  './', 'index.html', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'data/osm.geojson', 'tiles/index.json',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(cache => Promise.all(CORE.map(async url => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
      else console.warn('[sw] skipped', url, res.status);
    } catch (err) { console.warn('[sw] skipped', url, err.message); }
  }))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Map tiles: from the phone first; fetch and keep any that are missing.
  if (req.url.includes('/tiles/') && req.url.endsWith('.webp')) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // App files: always from the phone, so a weak signal can never stall startup.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = req.mode === 'navigate'
      ? (await cache.match('index.html')) || (await cache.match('./'))
      : await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Offline. Open the app once with internet first.', { status: 503 });
    }
  })());
});
