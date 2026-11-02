// Service worker : le site reste utilisable sans réseau.
// - Pages : réseau d'abord, copie locale ou page « hors connexion » en secours.
// - Fichiers /assets versionnés (?v=…) : cache d'abord, ils ne changent jamais.
// - Espace client, espace chauffeur, factures, API et QR code : jamais mis en cache.
const VERSION = 'tsi-2026-11';
// Adresse de base : « » sur le serveur, « /taxistirenee » sur GitHub Pages
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const STATIC = BASE !== '';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const OFFLINE = STATIC ? `${BASE}/hors-ligne/` : '/hors-ligne';
const PRIVATE = /^\/(api|compte|chauffeur|facture|qr)(\/|$)/;
const local = (pathname) => (pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname);
const MAX_PAGES = 30;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const pages = await caches.open(PAGES);
    const res = await fetch(OFFLINE, { cache: 'reload' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await pages.put(OFFLINE, res);
    // Fichiers nécessaires à l'affichage de la page hors connexion
    const urls = [...new Set([...html.matchAll(/(?:href|src)="([^"#]*\/assets\/[^"#]+)/g)].map((m) => m[1].replace(/&amp;/g, '&')))];
    const assets = await caches.open(ASSETS);
    await Promise.all(urls.map((u) => assets.add(u).catch(() => {})));
  })().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) if (!k.url.endsWith(OFFLINE)) await cache.delete(k);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || PRIVATE.test(local(url.pathname)) || local(url.pathname) === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(PAGES);
          cache.put(url.pathname, res.clone()).then(() => trim(cache)).catch(() => {});
        }
        return res;
      } catch {
        const cache = await caches.open(PAGES);
        return (await cache.match(url.pathname)) || (await cache.match(OFFLINE)) || Response.error();
      }
    })());
    return;
  }

  if (local(url.pathname).startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok && url.searchParams.has('v')) cache.put(request, res.clone()).catch(() => {});
      return res;
    })());
  }
});
