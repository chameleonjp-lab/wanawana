const CACHE_PREFIX = 'wanawana-';
const scopeUrl = new URL(self.registration.scope);
const requestedHash = new URL(self.location.href).searchParams.get('v') || 'local';
const buildHash = requestedHash.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'local';
const cacheName = `${CACHE_PREFIX}${buildHash}`;

function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(scopeUrl.pathname);
}

function collectBuiltFiles(value, files) {
  if (typeof value === 'string') {
    if (/(^|\/)assets\//.test(value)) files.add(new URL(value, scopeUrl).toString());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBuiltFiles(item, files);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectBuiltFiles(item, files);
  }
}

async function requiredFiles() {
  const rootUrl = scopeUrl.toString();
  const manifestUrl = new URL('manifest.json', scopeUrl);
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest failed: ${response.status}`);
  const manifest = await response.json();
  const files = new Set([rootUrl, manifestUrl.toString()]);
  collectBuiltFiles(manifest, files);
  return [...files].filter((file) => isInScope(new URL(file)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const files = await requiredFiles();
    await cache.addAll(files);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || !isInScope(requestUrl)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      return (await cache.match(scopeUrl)) || fetch(event.request);
    }
    return fetch(event.request);
  })());
});
