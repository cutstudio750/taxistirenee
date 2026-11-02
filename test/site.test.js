// Tests de bout en bout : npm test
// Démarre le site sur une base de données temporaire et vérifie pages et parcours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 600);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = `test-${process.pid}.json`;
const DRIVER_PASSWORD = 'mot-de-passe-test-chauffeur';
let server;

class Client {
  constructor() { this.cookies = new Map(); }
  async req(p, { method = 'GET', body, headers = {}, redirect = 'follow' } = {}) {
    const res = await fetch(BASE + p, {
      method, redirect,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
    return res;
  }
  async json(p, opts) {
    const res = await this.req(p, opts);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
}

const tomorrow = () => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10); };
const booking = (extra = {}) => ({
  service: 'aeroport', pickup: '8 Rue des Farges, 69005 Lyon', dropoff: 'Aéroport Lyon Saint-Exupéry, 69125 Colombier-Saugnieu',
  date: tomorrow(), time: '06:15', passengers: 2, luggage: 2, options: ['fauteuil'], travelRef: 'AF7641',
  contact: { name: 'Paul Durand', phone: '06 11 22 33 44', email: 'paul@exemple.fr' }, consent: true, ...extra,
});

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_FILE: DATA, DRIVER_PASSWORD, NODE_ENV: 'production', SITE_URL: BASE, ANTHROPIC_API_KEY: '', NTFY_URL: '', RESEND_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* démarrage en cours */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Le serveur ne démarre pas :\n${log}`);
});

after(async () => {
  server?.kill();
  await rm(path.join(ROOT, 'data', DATA), { force: true });
  await rm(path.join(ROOT, 'data', 'backups', `${DATA.replace('.json', '')}-${new Date().toISOString().slice(0, 10)}.json`), { force: true });
});

test('toutes les pages publiques répondent', async () => {
  const c = new Client();
  const fr = ['/', '/prestations', '/aeroport-gares', '/conventionne', '/a-propos', '/contact', '/reserver', '/compte', '/mentions-legales', '/facture', '/chauffeur', '/hors-ligne'];
  const en = ['/en', '/en/services', '/en/airport-stations', '/en/medical-transport', '/en/about', '/en/contact', '/en/book', '/en/legal'];
  for (const p of [...fr, ...en]) {
    const res = await c.req(p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /<title>[^<]+<\/title>/, `${p} : titre`);
    assert.match(html, new RegExp(`<html lang="${en.includes(p) ? 'en' : 'fr'}"`), `${p} : langue`);
    assert.doesNotMatch(html, /\{\{[^}]+\}\}/, `${p} : variable de gabarit non remplie`);
    assert.match(html, /\/assets\/css\/site\.css\?v=[0-9a-f]{10}/, `${p} : feuille de style versionnée`);
  }
  assert.equal((await c.req('/page-inexistante')).status, 404);
  const en404 = await c.req('/en/page-inexistante');
  assert.equal(en404.status, 404);
  assert.match(await en404.text(), /<html lang="en"/);
  assert.match(await (await c.req('/en')).text(), /hreflang="fr" href="[^"]+\/"/);
  assert.equal((await c.req('/index.html', { redirect: 'manual' })).status, 301);
  assert.match(await (await c.req('/sitemap.xml')).text(), /<urlset/);
  assert.match(await (await c.req('/robots.txt')).text(), /Sitemap:/);
});

test('en-têtes de sécurité et de cache', async () => {
  const c = new Client();
  const res = await c.req('/');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  const css = html.match(/\/assets\/css\/site\.css\?v=[0-9a-f]+/)[0];
  const asset = await c.req(css);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.match(await asset.text(), /\/assets\/fonts\/jost-latin\.woff2\?v=/, 'police versionnée dans la feuille de style');
  assert.equal((await c.req('/assets/css/site.css')).headers.get('cache-control'), 'no-cache');
  assert.equal((await c.req('/assets/../server/config.js')).status, 404, 'pas d’accès aux fichiers du serveur');
});

test('réservation sans compte : validations puis envoi', async () => {
  const c = new Client();
  let r = await c.json('/api/bookings', { method: 'POST', body: booking({ pickup: '' }) });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'pickup');
  r = await c.json('/api/bookings', { method: 'POST', body: booking({ date: '2020-01-01' }) });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'date');
  r = await c.json('/api/bookings', { method: 'POST', body: booking({ consent: false }) });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'consent');
  r = await c.json('/api/bookings', { method: 'POST', body: booking({ contact: { name: 'Paul', phone: '12' } }) });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'phone');
  r = await c.json('/api/bookings', { method: 'POST', body: booking() });
  assert.equal(r.status, 200);
  assert.match(r.data.booking.ref, /^TSI-\d{6}-[A-Z0-9]{4}$/);
  assert.equal(r.data.booking.status, 'pending');
});

test('transport conventionné : prescription, heure de rendez-vous et retour à convenir', async () => {
  const c = new Client();
  const medical = (extra = {}) => booking({ service: 'conventionne', dropoff: 'Centre Léon Bérard, 28 Rue Laennec, 69008 Lyon', options: [], travelRef: '', time: '09:30', ...extra });
  let r = await c.json('/api/bookings', { method: 'POST', body: medical() });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'prescription');
  r = await c.json('/api/bookings', { method: 'POST', body: medical({ medical: { prescription: 'remise' }, returnTrip: { time: '09:00' } }) });
  assert.equal(r.status, 400, 'le retour doit suivre le rendez-vous');
  r = await c.json('/api/bookings', { method: 'POST', body: medical({ medical: { prescription: 'remise', recurring: true }, returnTrip: { time: '' }, passengers: 9, estimate: { km: 7.3, minutes: 18 }, lang: 'en' }) });
  assert.equal(r.status, 200);
  const b = r.data.booking;
  assert.equal(b.timeKind, 'rdv');
  assert.deepEqual(b.medical, { prescription: 'remise', recurring: true });
  assert.equal(b.returnTrip.tbd, true);
  assert.equal(b.returnTrip.date, b.date);
  assert.equal(b.passengers, 6, '6 passagers au maximum (7 places, chauffeur compris)');
  assert.deepEqual(b.estimate, { km: 7.3, minutes: 18 });
  assert.equal(b.lang, 'en');
});

test('requête venant d’un autre site refusée', async () => {
  const c = new Client();
  const r = await c.json('/api/bookings', { method: 'POST', body: booking(), headers: { Origin: 'https://site-malveillant.example' } });
  assert.equal(r.status, 403);
});

let invoice;
test('compte client, chauffeur, facture et assistant', async () => {
  const client = new Client();
  let r = await client.json('/api/auth/register', { method: 'POST', body: { firstName: 'Claire', lastName: 'Martin', email: 'claire@exemple.fr', phone: '0612345678', password: 'court' } });
  assert.equal(r.status, 400); assert.equal(r.data.field, 'password');
  r = await client.json('/api/auth/register', { method: 'POST', body: { firstName: 'Claire', lastName: 'Martin', email: 'claire@exemple.fr', phone: '0612345678', password: 'un-mot-de-passe-solide' } });
  assert.equal(r.status, 200);
  assert.equal((await client.json('/api/auth/register', { method: 'POST', body: { firstName: 'C', lastName: 'M', email: 'claire@exemple.fr', phone: '0612345678', password: 'un-autre-mot-de-passe' } })).status, 409);

  r = await client.json('/api/me', { method: 'PATCH', body: { addresses: [{ label: 'Domicile', address: '14 Rue des Macchabées, 69005 Lyon' }] } });
  assert.equal(r.data.user.addresses.length, 1);

  r = await client.json('/api/bookings', { method: 'POST', body: booking({ pickup: '14 Rue des Macchabées, 69005 Lyon', service: 'ville', contact: { name: 'Claire Martin', phone: '0612345678', email: 'claire@exemple.fr' } }) });
  assert.equal(r.status, 200);
  const bookingId = r.data.booking.id;
  r = await client.json('/api/bookings');
  assert.equal(r.data.bookings.length, 1);

  // Chauffeur
  const driver = new Client();
  assert.equal((await driver.json('/api/driver/bookings')).status, 401);
  assert.equal((await driver.json('/api/driver/login', { method: 'POST', body: { password: 'faux' } })).status, 401);
  assert.equal((await driver.json('/api/driver/login', { method: 'POST', body: { password: DRIVER_PASSWORD } })).status, 200);
  r = await driver.json(`/api/driver/bookings/${bookingId}`, { method: 'PATCH', body: { status: 'confirmed', date: tomorrow(), time: '06:15', driverNote: 'Devant le portail' } });
  assert.equal(r.data.booking.status, 'confirmed');
  r = await driver.json(`/api/driver/bookings/${bookingId}/complete`, { method: 'POST', body: { amountTTC: '0', paymentMethod: 'Carte bancaire' } });
  assert.equal(r.status, 400);
  r = await driver.json(`/api/driver/bookings/${bookingId}/complete`, { method: 'POST', body: { amountTTC: '42,50', paymentMethod: 'Carte bancaire', distanceKm: '12.4' } });
  assert.equal(r.status, 200);
  invoice = r.data.invoice;
  assert.match(invoice.number, /^F\d{4}-0001$/);
  assert.equal(invoice.amountTTC, 42.5);
  assert.equal(Math.round((invoice.amountHT + invoice.vat) * 100) / 100, 42.5);
  assert.equal(invoice.accessToken, undefined, 'le jeton secret ne sort pas');
  const link = new URL(r.data.link);

  // La cliente voit sa facture ; un autre compte non ; le lien à jeton fonctionne
  assert.equal((await client.json(`/api/invoices/${invoice.id}`)).status, 200);
  const other = new Client();
  await other.json('/api/auth/register', { method: 'POST', body: { firstName: 'Autre', lastName: 'Client', email: 'autre@exemple.fr', phone: '0698765432', password: 'encore-un-mot-de-passe' } });
  assert.equal((await other.json(`/api/invoices/${invoice.id}`)).status, 404);
  assert.equal((await new Client().json(`/api/invoices/${invoice.id}?t=${link.searchParams.get('t')}`)).status, 200);
  assert.equal((await new Client().json(`/api/invoices/${invoice.id}?t=mauvais-jeton`)).status, 401);

  // Analyse et assistant (mode intégré, sans clé API)
  r = await client.json('/api/insights');
  assert.equal(r.data.insights.totals.rides, 1);
  assert.equal(r.data.insights.totals.invoices, 1);
  r = await client.json('/api/assistant', { method: 'POST', body: { message: 'Combien ai-je dépensé ?' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.reply.length > 10);
  assert.equal(r.data.engine, 'local');

  // Déconnexion
  await client.json('/api/auth/logout', { method: 'POST' });
  assert.equal((await client.json('/api/bookings')).status, 401);
  assert.equal((await client.json('/api/auth/login', { method: 'POST', body: { email: 'claire@exemple.fr', password: 'un-mot-de-passe-solide' } })).status, 200);
});

test('page de facture et QR code permanent', async () => {
  const driver = new Client();
  await driver.json('/api/driver/login', { method: 'POST', body: { password: DRIVER_PASSWORD } });
  let res = await new Client().req('/qr', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await driver.json('/api/driver/qr', { method: 'POST', body: { target: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await driver.json('/api/driver/qr', { method: 'POST', body: { target: '/reserver' } })).status, 200);
  res = await new Client().req('/qr', { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/reserver');
  for (const theme of ['creme', 'noir', 'cadre']) {
    const svg = await driver.req(`/api/driver/qr.svg?theme=${theme}`);
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /^<svg/);
  }
  assert.equal((await new Client().req('/api/driver/qr.svg')).status, 401);
  // Lien complet vers un autre nom de domaine : le QR code imprimé ne change pas
  const futur = 'https://www.nouveau-domaine.fr/reserver?service=aeroport';
  assert.equal((await driver.json('/api/driver/qr', { method: 'POST', body: { target: futur } })).status, 200);
  res = await new Client().req('/qr', { redirect: 'manual' });
  assert.equal(res.headers.get('location'), futur);
  const qr = await driver.json('/api/driver/qr');
  assert.equal(qr.data.scans, 3);
  assert.equal(qr.data.target, futur);
  assert.match(qr.data.url, /\/qr$/);
  assert.equal(qr.data.provisional, true, 'adresse locale : pas encore figée');
});

test('adresse du QR code figée au premier lancement en ligne, même après un changement de domaine', async () => {
  const file = `qr-${process.pid}.json`;
  const run = (site) => spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { db } = await import('./server/db.js'); await db.load(); const { qrUrl, qrIsProvisional } = await import('./server/qr.js'); const u = qrUrl(); await new Promise((r) => setTimeout(r, 300)); console.log(JSON.stringify({ u, p: qrIsProvisional() }));"],
    { cwd: ROOT, env: { ...process.env, SITE_URL: site, DATA_FILE: file, QR_BASE_URL: '' }, encoding: 'utf8' });
  try {
    const first = JSON.parse(run('https://taxi-saint-irenee.onrender.com').stdout.trim().split('\n').pop());
    assert.deepEqual(first, { u: 'https://taxi-saint-irenee.onrender.com/qr', p: false });
    const later = JSON.parse(run('https://www.taxi-saint-irenee.fr').stdout.trim().split('\n').pop());
    assert.equal(later.u, 'https://taxi-saint-irenee.onrender.com/qr', 'le QR code déjà imprimé reste valable');
  } finally {
    await rm(path.join(ROOT, 'data', file), { force: true });
  }
});
