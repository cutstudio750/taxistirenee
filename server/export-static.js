// Version fixe du site pour GitHub Pages : npm run build:pages
//
// GitHub Pages ne fait tourner aucun serveur : cette version contient toutes les pages
// publiques (français et anglais) avec le même design, mais sans comptes clients,
// factures, assistant ni espace chauffeur. La réservation part par WhatsApp ou par
// e-mail, déjà rédigée. Le résultat est écrit dans dist/github-pages/ : son contenu se
// place tel quel à la racine du dépôt GitHub Pages.
//
// Réglages (facultatifs) :
//   SITE_URL   adresse publique   (défaut : https://cutstudio750.github.io/taxistirenee)
//   QR_TARGET  destination du QR code (défaut : l'accueil du site)
//   OUT        dossier de sortie  (défaut : dist/github-pages)
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = (process.env.SITE_URL || 'https://cutstudio750.github.io/taxistirenee').replace(/\/$/, '');
const BASE = new URL(SITE_URL).pathname.replace(/\/$/, '');
const OUT = path.resolve(ROOT, process.env.OUT || 'dist/github-pages');
const QR_TARGET = process.env.QR_TARGET || `${SITE_URL}/`;

// La configuration est lue à l'import : on la règle avant de charger le moteur de pages
Object.assign(process.env, { STATIC_EXPORT: '1', SITE_URL, BASE_PATH: BASE, NODE_ENV: 'production' });
const { config } = await import('./config.js');
const { renderPage, PAGES, PUBLIC_PAGES } = await import('./render.js');
const { versionHtml, versionJs, minifyCss } = await import('./assets.js');
const { brandedQrSvg } = await import('./qr.js');

// Adresses internes (« /prestations », « /assets/… ») → adresses sous BASE.
// Les pages deviennent des dossiers : /prestations → BASE/prestations/
function rewriteUrl(u) {
  if (!u.startsWith('/') || u.startsWith('//')) return u;
  const [, p, rest] = u.match(/^([^?#]*)(.*)$/);
  if (p.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(p)) return `${BASE}${p}${rest}`;
  if (p === '/') return `${BASE}/${rest}`;
  return `${BASE}${p.replace(/\/$/, '')}/${rest}`;
}
const rewriteHtml = (html) => html
  .replace(/\b(href|src|action|poster)="([^"]*)"/g, (all, attr, u) => `${attr}="${rewriteUrl(u)}"`)
  .replace(/\bsrcset="([^"]*)"/g, (all, list) => `srcset="${list.split(',').map((part) => {
    const [u, ...d] = part.trim().split(/\s+/);
    return [rewriteUrl(u), ...d].join(' ');
  }).join(', ')}"`);
const rewriteCss = (css) => css.replace(/url\((["']?)\/assets\//g, (all, q) => `url(${q}${BASE}/assets/`);

async function write(rel, content) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1) Pages publiques
const pages = [...PUBLIC_PAGES, '/hors-ligne'];
for (const pathname of pages) {
  const html = await renderPage(PAGES[pathname], pathname);
  if (!html) throw new Error(`Page introuvable : ${pathname}`);
  await write(pathname === '/' ? 'index.html' : `${pathname.slice(1)}/index.html`, rewriteHtml(html));
}
await write('404.html', rewriteHtml(await renderPage('404', '/404')));

// 2) Fichiers statiques (styles, scripts, polices, images…)
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(abs));
    else out.push(abs);
  }
  return out;
}
const PUBLIC = path.join(ROOT, 'public');
for (const abs of await walk(PUBLIC)) {
  const rel = path.relative(PUBLIC, abs).split(path.sep).join('/');
  const urlPath = `/${rel}`;
  if (rel.endsWith('.css')) {
    await write(rel, rewriteCss(versionHtml(minifyCss(await readFile(abs, 'utf8')))));
  } else if (rel.startsWith('assets/js/') && rel.endsWith('.js')) {
    await write(rel, versionJs(await readFile(abs, 'utf8'), urlPath));
  } else if (rel === 'manifest.webmanifest') {
    const m = JSON.parse(await readFile(abs, 'utf8'));
    m.start_url = `${BASE}/`;
    m.scope = `${BASE}/`;
    m.icons = m.icons.map((i) => ({ ...i, src: rewriteUrl(i.src) }));
    await write(rel, JSON.stringify(m, null, 2));
  } else {
    await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
    await copyFile(abs, path.join(OUT, rel));
  }
}

// 3) Référencement
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES
  .map((p) => `  <url><loc>${SITE_URL}${p === '/' ? '/' : `${p}/`}</loc></url>`).join('\n')}\n</urlset>\n`);
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
await write('.nojekyll', '');

// 4) QR code permanent : il mène à SITE_URL/qr/, qui redirige vers la destination choisie
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
await write('qr/index.html', `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Taxi Saint-Irénée</title>
<!-- ─────────────────────────────────────────────────────────────────────
     DESTINATION DU QR CODE
     Pour changer la page ouverte par le QR code, remplacez l'adresse écrite
     après « url= » sur la ligne ci-dessous, puis enregistrez (« Commit changes »).
     Le QR code imprimé ne change pas.
     ───────────────────────────────────────────────────────────────────── -->
<meta http-equiv="refresh" content="0; url=${esc(QR_TARGET)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161514;color:#F3EDE4;font:18px/1.5 system-ui,sans-serif}a{color:#CDBDA4}</style>
</head>
<body>
<p><a id="go" href="${esc(QR_TARGET)}">Taxi Saint-Irénée</a></p>
<script>
var target = document.querySelector('meta[http-equiv="refresh"]').content.split('url=')[1];
document.getElementById('go').href = target;
location.replace(target);
</script>
</body>
</html>
`);
const qrText = `${SITE_URL}/qr/`;
for (const [theme, name] of [['noir', 'qr-voiture-fond-noir'], ['cadre', 'qr-voiture-fond-noir-cadre'], ['creme', 'qr-fond-creme']]) {
  await write(`qr/${name}.svg`, brandedQrSvg(qrText, { theme }));
}

// 5) Mode d'emploi affiché sur la page du dépôt GitHub
await write('README.md', `# Taxi Saint-Irénée · version GitHub Pages

Site en ligne : ${SITE_URL}/

Cette version est générée automatiquement (\`npm run build:pages\` dans le projet complet).
Elle contient toutes les pages en français et en anglais. La réservation part par
WhatsApp ou par e-mail, déjà rédigée ; le chauffeur rappelle le client pour confirmer.
Sans serveur, elle ne comprend pas les comptes clients, les factures, l'assistant ni l'espace chauffeur.

## QR code permanent

- Les fichiers à imprimer sont dans le dossier \`qr/\` :
  \`qr-voiture-fond-noir.svg\` (pour la voiture), \`qr-voiture-fond-noir-cadre.svg\`
  (lisible par tous les lecteurs) et \`qr-fond-creme.svg\` (cartes, documents).
- Ils mènent tous à ${qrText}
- **Changer la destination sans réimprimer** : ouvrir \`qr/index.html\` sur GitHub,
  cliquer sur le crayon, remplacer l'adresse après \`url=\`, puis « Commit changes ».
  La nouvelle destination est active en quelques minutes.
`);

console.log(`Version GitHub Pages créée dans ${path.relative(ROOT, OUT)}/ (${pages.length} pages, adresse ${SITE_URL}/)`);
console.log(`QR code : ${qrText} → ${QR_TARGET}`);
console.log(config.staticExport ? 'Mode sans serveur : OK' : 'ATTENTION : mode sans serveur non activé');
