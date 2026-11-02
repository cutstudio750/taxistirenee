// Assemblage des pages : chaque vue (views/*.html, views/en/*.html) déclare ses
// métadonnées en tête, puis est insérée dans le gabarit commun.
// Dans les vues : {{VARIABLE}}, {{T:cle}} (texte traduit), {{>partiel}} (inclusion).
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { versionHtml } from './assets.js';
import { NAV, tr } from './i18n.js';

const VIEWS = path.join(ROOT, 'views');
const PARTIALS = path.join(VIEWS, 'partials');
let cache = null;

function parseView(raw) {
  const m = raw.match(/^<!--meta\n([\s\S]*?)\n-->\n?/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

async function load() {
  const partials = {};
  for (const file of await readdir(PARTIALS)) {
    if (file.endsWith('.html')) partials[file.replace(/\.html$/, '')] = await readFile(path.join(PARTIALS, file), 'utf8');
  }
  const views = {};
  for (const dir of ['', 'en']) {
    const abs = path.join(VIEWS, dir);
    if (!existsSync(abs)) continue;
    for (const file of await readdir(abs)) {
      if (!file.endsWith('.html')) continue;
      views[(dir ? `${dir}/` : '') + file.replace(/\.html$/, '')] = parseView(await readFile(path.join(abs, file), 'utf8'));
    }
  }
  return { partials, views };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fill(tpl, vars, lang) {
  return tpl
    .replace(/\{\{T:([\w.-]+)\}\}/g, (all, key) => tr(lang, key))
    .replace(/\{\{(\w+)\}\}/g, (all, key) => (key in vars ? vars[key] : all));
}
const include = (tpl, partials) => tpl.replace(/\{\{>([\w-]+)\}\}/g, (all, name) => partials[name] ?? '');

// Blocs réservés à une version : <!--srv-->…<!--/srv--> (site avec serveur : comptes,
// factures, assistant) et <!--static-->…<!--/static--> (version GitHub Pages).
function modeBlocks(html) {
  const drop = config.staticExport ? 'srv' : 'static';
  const keep = config.staticExport ? 'static' : 'srv';
  return html
    .replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->`, 'g'), '')
    .replace(new RegExp(`<!--/?${keep}-->`, 'g'), '');
}
// Adresse publique d'une page (avec barre finale dans la version GitHub Pages)
const pageUrl = (p) => `${config.siteUrl}${p === '/' ? '/' : config.staticExport ? `${p}/` : p}`;

export const PAGES = {
  '/': 'index',
  '/prestations': 'prestations',
  '/aeroport-gares': 'aeroport-gares',
  '/conventionne': 'conventionne',
  '/a-propos': 'a-propos',
  '/contact': 'contact',
  '/reserver': 'reserver',
  '/compte': 'compte',
  '/facture': 'facture',
  '/chauffeur': 'chauffeur',
  '/mentions-legales': 'mentions-legales',
  '/hors-ligne': 'hors-ligne',
  '/en': 'en/index',
  '/en/services': 'en/services',
  '/en/airport-stations': 'en/airport',
  '/en/medical-transport': 'en/medical',
  '/en/about': 'en/about',
  '/en/contact': 'en/contact',
  '/en/book': 'en/book',
  '/en/legal': 'en/legal',
};
export const PUBLIC_PAGES = ['/', '/prestations', '/aeroport-gares', '/conventionne', '/a-propos', '/contact', '/reserver', '/mentions-legales',
  '/en', '/en/services', '/en/airport-stations', '/en/medical-transport', '/en/about', '/en/contact', '/en/book', '/en/legal'];

// Avis clients : uniquement de vrais avis, saisis dans content/reviews.json
function reviewsBlock(lang) {
  let list = [];
  try { list = JSON.parse(readFileSync(path.join(ROOT, 'content', 'reviews.json'), 'utf8')).filter((r) => r && r.text && r.name); } catch { list = []; }
  const leave = config.googleReviewUrl
    ? `<a class="btn btn--outline" href="${esc(config.googleReviewUrl)}" rel="noopener" target="_blank">${lang === 'en' ? 'Leave a review' : 'Laisser un avis'}</a>`
    : `<a class="btn btn--outline" href="mailto:${esc(config.contactEmail)}?subject=${encodeURIComponent(lang === 'en' ? 'My review of Taxi Saint-Irénée' : 'Mon avis sur Taxi Saint-Irénée')}">${lang === 'en' ? 'Leave a review' : 'Laisser un avis'}</a>`;
  if (!list.length) {
    return `<div class="reviews-empty card card--creme" data-reveal>
      <svg class="icon icon--lg" aria-hidden="true"><use href="/assets/img/icons.svg#star"/></svg>
      <div><h3 class="h3">${lang === 'en' ? 'Client reviews will appear here soon.' : 'Les avis de nos clients seront bientôt affichés ici.'}</h3>
      <p class="muted mt-1">${lang === 'en' ? 'Have you travelled with Taxi Saint-Irénée? Your feedback helps other travellers choose with confidence.' : 'Vous avez voyagé avec Taxi Saint-Irénée ? Votre retour aide d’autres voyageurs à choisir sereinement.'}</p>
      <div class="mt-3">${leave}</div></div></div>`;
  }
  const stars = (n) => `<span class="review__stars" role="img" aria-label="${lang === 'en' ? `Rating: ${n} out of 5` : `Note : ${n} sur 5`}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
  return `<div class="reviews-grid" data-stagger>${list.map((r) => `<figure class="review card">
      ${stars(Math.max(1, Math.min(5, Number(r.rating) || 5)))}
      <blockquote class="mt-2">${esc(r.text)}</blockquote>
      <figcaption class="muted mt-2">${esc(r.name)}${r.date ? ` · ${esc(r.date)}` : ''}${r.source ? ` · ${esc(r.source)}` : ''}</figcaption>
    </figure>`).join('')}</div><div class="mt-4">${leave}</div>`;
}

// Photos du véhicule : affichées seulement si les vrais fichiers ont été déposés
function vehiclePhotos(lang) {
  const dir = path.join(ROOT, 'public', 'assets', 'img', 'vehicule');
  const slots = [['exterieur', lang === 'en' ? 'The Taxi Saint-Irénée vehicle' : 'Le véhicule de Taxi Saint-Irénée'],
    ['interieur', lang === 'en' ? 'Inside the vehicle' : 'L’habitacle du véhicule'],
    ['coffre', lang === 'en' ? 'Luggage space' : 'L’espace bagages']];
  const found = slots.map(([name, alt]) => {
    const file = ['jpg', 'jpeg', 'webp', 'png'].map((e) => `${name}.${e}`).find((f) => existsSync(path.join(dir, f)));
    return file ? `<figure class="vehicle-photo"><img src="/assets/img/vehicule/${file}" alt="${esc(alt)}" width="1200" height="800" loading="lazy" decoding="async"></figure>` : '';
  }).filter(Boolean);
  return found.length ? `<div class="vehicle-photos vehicle-photos--${found.length}" data-reveal="scale">${found.join('')}</div>` : '';
}

// Données structurées FAQPage, construites à partir des questions de la page
function faqJsonLd(body) {
  const items = [...body.matchAll(/<summary>([\s\S]*?)<svg[\s\S]*?<\/summary>\s*<div class="faq__body">([\s\S]*?)<\/div>/g)]
    .map(([, q, a]) => ({ q: q.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(), a: a.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter((x) => x.q && x.a);
  if (!items.length) return '';
  const data = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export async function renderPage(name, pathname) {
  if (!cache || config.dev) cache = await load();
  const view = cache.views[name];
  if (!view) return null;
  const { meta } = view;
  const lang = meta.lang || (name.startsWith('en/') ? 'en' : 'fr');
  const nav = NAV[lang].map(([key, href, label]) => `<li><a href="${href}"${meta.nav === key ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const altPath = meta.alt || (lang === 'en' ? '/' : '/en');
  const shared = {
    PHONE: config.phoneDisplay, PHONE_TEL: config.phoneTel, PHONE_INTL: '+33 6 61 88 27 07', WHATSAPP: config.whatsapp,
    EMAIL: esc(config.contactEmail),
    YEAR: String(new Date().getFullYear()), SITE_URL: config.siteUrl,
    LOYALTY_STEP: String(config.loyalty.step), LOYALTY_REWARD: esc(config.loyalty.reward),
    COMPANY_LEGAL_NAME: esc(config.company.legalName), COMPANY_ADDRESS: esc(config.company.address || '[adresse du siège à compléter]'),
    COMPANY_SIRET: esc(config.company.siret || '[à compléter]'), COMPANY_ADS: esc(config.company.ads || '[à compléter]'),
    COMPANY_CPAM: esc(config.company.cpam || '[à compléter]'), COMPANY_EMAIL: esc(config.company.email || config.contactEmail),
    COMPANY_VAT: esc(config.company.vatNumber || '[à compléter]'), COMPANY_MEDIATOR: esc(config.company.mediator || '[médiateur de la consommation à compléter]'),
    COMPANY_HOST: esc(config.company.host || '[hébergeur à compléter]'),
    COMPANY_LEGAL_FORM: esc(config.company.legalForm || '[forme juridique à compléter]'),
    COMPANY_DIRECTOR: esc(config.company.director || '[à compléter]'),
    LANG: lang, ALT_URL: altPath,
    REVIEWS: '', VEHICLE_PHOTOS: '',
  };
  const rawBody = modeBlocks(include(view.body, cache.partials));
  if (rawBody.includes('{{REVIEWS}}')) shared.REVIEWS = reviewsBlock(lang);
  if (rawBody.includes('{{VEHICLE_PHOTOS}}')) shared.VEHICLE_PHOTOS = vehiclePhotos(lang);
  const body = fill(rawBody, shared, lang);
  const header = fill(modeBlocks(cache.partials.header), { ...shared, NAV: nav, HEADER_CLASS: '' }, lang);
  const footer = meta.footer === 'none' ? '' : fill(modeBlocks(cache.partials.footer), shared, lang);
  const scripts = (meta.scripts || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => `<script type="module" src="/assets/js/${s}"></script>`).join('\n');
  const canonical = pageUrl(pathname);
  const alternates = meta.alt
    ? [[lang, pathname], [lang === 'en' ? 'fr' : 'en', meta.alt]]
      .map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${pageUrl(p)}">`).join('\n')
      + `\n<link rel="alternate" hreflang="x-default" href="${pageUrl(lang === 'fr' ? pathname : meta.alt)}">`
    : '';
  const jsonld = [meta.jsonld === 'business' ? businessJsonLd(lang) : '', meta.faq === 'yes' ? faqJsonLd(body) : ''].join('\n');
  return versionHtml(fill(cache.partials.layout, {
    ...shared,
    TITLE: esc(meta.title || 'Taxi Saint-Irénée'),
    DESCRIPTION: esc(meta.description || ''),
    CANONICAL: canonical,
    ALTERNATES: alternates,
    OG_LOCALE: lang === 'en' ? 'en_GB' : 'fr_FR',
    ROBOTS: meta.robots || 'index, follow',
    BODY_CLASS: meta.bodyClass || '',
    HEADER: meta.header === 'none' ? '' : header,
    FOOTER: footer,
    DOCK: meta.dock === 'none' ? '' : fill(modeBlocks(cache.partials.dock), shared, lang),
    HTML_ATTRS: config.staticExport ? ` data-static data-base="${esc(config.basePath)}"` : '',
    CONTENT: body,
    SCRIPTS: scripts,
    JSONLD: jsonld,
  }, lang));
}

function businessJsonLd(lang) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TaxiService',
    name: 'Taxi Saint-Irénée',
    description: lang === 'en'
      ? 'Taxi in Lyon since 2014, approved for medical transport: city rides, Lyon-Saint Exupéry airport, train stations, long distance, up to 6 passengers.'
      : 'Taxi conventionné CPAM à Lyon et dans la métropole depuis 2014 : courses, aéroport Saint-Exupéry, gares, transport médical assis, jusqu’à 6 passagers.',
    url: config.siteUrl,
    telephone: config.phoneTel,
    email: config.contactEmail,
    image: `${config.siteUrl}/assets/img/og-image.png`,
    logo: `${config.siteUrl}/assets/img/apple-touch-icon.png`,
    foundingDate: '2014',
    areaServed: [{ '@type': 'City', name: 'Lyon' }, { '@type': 'AdministrativeArea', name: 'Métropole de Lyon' }],
    availableLanguage: ['fr', 'en'],
    provider: { '@type': 'LocalBusiness', name: 'Taxi Saint-Irénée', telephone: config.phoneTel, foundingDate: '2014', address: { '@type': 'PostalAddress', addressLocality: 'Lyon', addressCountry: 'FR' } },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}
