/* Vizn service worker.
 *
 * - App shell (index.html): network-first, so a new deploy is picked up immediately;
 *   the cached copy is only used offline.
 * - Built assets (/assets/*, content-hashed): cache-first.
 * - COCO-SSD model files (storage.googleapis.com/tfjs-models): cache-first, so the camera
 *   detector starts without re-downloading several MB every time.
 * - Fonts, Leaflet CSS, icons: stale-while-revalidate.
 * - Never cached: /api/* (login session, routes, reports must always be live), place search,
 *   routing, Google sign-in, and Vite dev-server internals.
 *
 * Bump VERSION to drop all old caches.
 */
const VERSION = 'v2'; // v2: app renamed to Vizn
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const MODEL_CACHE = `model-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;
const CURRENT = [SHELL_CACHE, ASSET_CACHE, MODEL_CACHE, STATIC_CACHE];
const MAX_ASSETS = 80;

const OFFLINE_HTML = `<!doctype html><html lang="ro"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vizn - fără conexiune</title>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><h1 style="font-size:22px">Nu există conexiune la internet</h1>
<p style="color:#cbd5e1">Aplicația are nevoie de internet la prima pornire. Reîncearcă după ce te conectezi.</p>
<button onclick="location.reload()" style="padding:12px 20px;font-size:16px;border:0;border-radius:12px;background:#2563eb;color:#fff">Reîncearcă</button></div>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !CURRENT.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isViteDevRequest(url) {
  return /^\/(@vite|@react-refresh|@id|@fs|src|node_modules)\//.test(url.pathname)
    || url.pathname.startsWith('/@')
    || url.searchParams.has('import')
    || url.searchParams.has('t')
    || url.searchParams.has('v');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    if (url.pathname.startsWith('/api/') || isViteDevRequest(url)) return; // always live
    if (request.mode === 'navigate') {
      event.respondWith(networkFirstShell(request));
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(request, ASSET_CACHE, MAX_ASSETS));
      return;
    }
    if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    }
    return;
  }

  if (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/tfjs-models/')) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    (url.hostname === 'unpkg.com' && url.pathname.startsWith('/leaflet@'))
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
  // Everything else (map tiles, Nominatim, OSRM, Google sign-in, TTS) goes straight to the network
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/');
    return cached || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (maxEntries) trimCache(cache, maxEntries);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}
