import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { ROOT, config } from './config.js';
import { db } from './db.js';
import { handleApi } from './api.js';
import { renderPage, PAGES, PUBLIC_PAGES } from './render.js';
import { qrTarget, recordScan } from './qr.js';
import { versionOf, versionHtml, versionJs, minifyCss } from './assets.js';

const PUBLIC = path.join(ROOT, 'public');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.webmanifest', '.txt', '.xml']);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://data.geopf.fr https://api-adresse.data.gouv.fr",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const compressedCache = new Map();
async function sendBody(req, res, status, body, ext, headers = {}) {
  const accept = req.headers['accept-encoding'] || '';
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { 'Content-Type': TYPES[ext] || 'application/octet-stream', Vary: 'Accept-Encoding', ...headers };
  if (COMPRESSIBLE.has(ext) && payload.length > 1024) {
    const enc = accept.includes('br') ? 'br' : accept.includes('gzip') ? 'gzip' : null;
    if (enc) {
      const key = headers['X-Cache-Key'] ? `${enc}:${headers['X-Cache-Key']}` : null;
      let out = key && compressedCache.get(key);
      if (!out) {
        out = enc === 'br' ? await brotli(payload, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : await gzip(payload);
        if (key) compressedCache.set(key, out);
      }
      payload = out;
      h['Content-Encoding'] = enc;
    }
  }
  delete h['X-Cache-Key'];
  h['Content-Length'] = payload.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

async function serveStatic(req, res, pathname, url) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const file = path.normalize(path.join(PUBLIC, decoded));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let info;
  try { info = await stat(file); } catch { return false; }
  if (!info.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const version = versionOf(decoded);
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}-${version || '0'}"`;
  // URL versionnée (?v= identique à l'empreinte actuelle) : cache d'un an ; sinon revalidation
  let cache;
  if (version && url.searchParams.get('v') === version && !config.dev) cache = 'public, max-age=31536000, immutable';
  else if (['.css', '.js', '.html', '.webmanifest'].includes(ext) || config.dev) cache = 'no-cache';
  else cache = 'public, max-age=86400, stale-while-revalidate=604800';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); res.end(); return true; }
  let body = await readFile(file);
  if (ext === '.js' && decoded.startsWith('/assets/js/')) body = Buffer.from(versionJs(body.toString('utf8'), decoded));
  if (ext === '.css') body = Buffer.from(versionHtml(config.dev ? body.toString('utf8') : minifyCss(body.toString('utf8'))));
  await sendBody(req, res, 200, body, ext, { ETag: etag, 'Cache-Control': cache, 'X-Cache-Key': `${file}:${info.mtimeMs}:${version}` });
  return true;
}

export async function handleRequest(req, res) {
  securityHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }

    // Anciennes adresses en .html → adresses propres
    if (pathname.endsWith('.html')) {
      const clean = pathname === '/index.html' ? '/' : pathname.replace(/\.html$/, '');
      if (PAGES[clean]) { res.writeHead(301, { Location: clean + url.search }); res.end(); return; }
    }
    // QR code permanent : redirection temporaire (302) pour que la destination reste modifiable
    if (pathname === '/qr' || pathname === '/qr/') {
      recordScan();
      res.writeHead(302, { Location: qrTarget(), 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    const page = PAGES[pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname];
    const html = page ? await renderPage(page, pathname) : null;
    if (html) return await sendBody(req, res, 200, html, '.html', { 'Cache-Control': 'no-cache', 'X-Cache-Key': config.dev ? undefined : `page:${page}` });
    if (pathname === '/sitemap.xml') return await sendBody(req, res, 200, sitemap(), '.xml', { 'Cache-Control': 'public, max-age=86400' });
    if (pathname === '/robots.txt') return await sendBody(req, res, 200, `User-agent: *\nDisallow: /compte\nDisallow: /chauffeur\nDisallow: /facture\nDisallow: /qr\nDisallow: /api/\nSitemap: ${config.siteUrl}/sitemap.xml\n`, '.txt');
    if (!page && await serveStatic(req, res, pathname, url)) return;

    const english = pathname === '/en' || pathname.startsWith('/en/');
    const notFound = (english && await renderPage('en/404', pathname)) || await renderPage('404', pathname);
    return await sendBody(req, res, 404, notFound || 'Page introuvable', '.html', { 'Cache-Control': 'no-cache' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      let html = null;
      try { html = await renderPage('500', '/'); } catch { /* gabarit indisponible */ }
      res.writeHead(500, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html || `Incident technique. Pour réserver : ${config.phoneDisplay}`);
    }
  }
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map((p) => `  <url><loc>${config.siteUrl}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

await db.load();
await db.backup();
// Sur Vercel, le site tourne en fonctions (api/index.js) : pas de serveur à démarrer ici
if (!process.env.VERCEL) {
  setInterval(() => db.backup(), 6 * 60 * 60 * 1000).unref();
  http.createServer(handleRequest).listen(config.port, () => {
  console.log(`Taxi Saint-Irénée en ligne sur http://localhost:${config.port}`);
  if (!config.driverPassword) console.warn('⚠ DRIVER_PASSWORD non défini : l’espace /chauffeur est inaccessible.');
  if (!config.ntfyUrl && !config.resendKey) console.warn('⚠ Aucune notification configurée (NTFY_URL ou RESEND_API_KEY) : consultez /chauffeur pour voir les demandes.');
  });
}
