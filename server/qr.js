// QR code permanent : il contient toujours l'adresse fixe <site>/qr.
// La destination réelle se règle dans l'espace chauffeur, sans réimprimer le QR code.
import QRCode from 'qrcode';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { db } from './db.js';

const NOIR = '#161514';
const CREME = '#F3EDE4';
const mono = readFileSync(path.join(ROOT, 'public/assets/img/monogramme-noir.svg'), 'utf8');
const MONO_VB = mono.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const MONO_D = mono.match(/ d="([^"]+)"/)[1];

const isLocal = (u) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u);

// Adresse contenue dans le QR code. Elle est enregistrée une fois pour toutes (première
// utilisation sur le site en ligne) : changer ensuite de nom de domaine ne la modifie pas,
// le QR code déjà imprimé reste donc valable. QR_BASE_URL permet de l'imposer.
export function qrUrl() {
  if (process.env.QR_BASE_URL) return process.env.QR_BASE_URL.trim().replace(/\/$/, '');
  const saved = db.data.settings?.qrBase;
  if (saved) return saved;
  const current = `${config.siteUrl}/qr`;
  if (!isLocal(current)) {
    db.data.settings = db.data.settings || {};
    db.data.settings.qrBase = current;
    db.save();
  }
  return current;
}
export const qrIsProvisional = () => !process.env.QR_BASE_URL && !db.data.settings?.qrBase;

export function qrTarget() {
  return db.data.settings?.qrTarget || '/';
}

// Destination acceptée : un chemin du site (/reserver) ou une adresse http(s) complète.
export function normalizeTarget(value) {
  const v = String(value || '').trim();
  if (!v || v.length > 500) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function recordScan() {
  db.data.settings = db.data.settings || {};
  db.data.settings.qrScans = (db.data.settings.qrScans || 0) + 1;
  db.data.settings.qrLastScanAt = new Date().toISOString();
  db.save();
}

// QR code aux couleurs de la charte, monogramme TS. au centre.
// Correction d'erreur maximale (H) : le médaillon central ne gêne pas la lecture.
// Thèmes : « creme » (noir sur crème), « noir » (crème sur noir, pour la voiture),
// « cadre » (fond noir avec le QR code sur une plaque crème : lisible par tous les téléphones).
export const QR_THEMES = ['creme', 'noir', 'cadre'];

function qrBody(text, { fg, bg, offset = 0 }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const quiet = 4;
  const total = n + quiet * 2;
  let badge = Math.round(n * 0.24);
  if (badge % 2 !== n % 2) badge += 1;
  const b0 = (n - badge) / 2;
  const inBadge = (x, y) => x >= b0 && x < b0 + badge && y >= b0 && y < b0 + badge;
  const finders = [[0, 0], [n - 7, 0], [0, n - 7]];
  const inFinder = (x, y) => finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const o = quiet + offset;

  let d = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!qr.modules.data[y * n + x] || inBadge(x, y) || inFinder(x, y)) continue;
      d += `M${x + o} ${y + o}h1v1h-1z`;
    }
  }
  const finderSvg = finders.map(([fx, fy]) => {
    const x = fx + o; const y = fy + o;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.6" fill="none" stroke="${fg}" stroke-width="1"/>`
      + `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9" fill="${fg}"/>`;
  }).join('');

  const bx = b0 + o; const pad = badge * 0.07; const inner = badge - pad * 2;
  const [vx, vy, vw, vh] = MONO_VB;
  const scale = inner / Math.max(vw, vh);
  const mx = bx + pad + (inner - vw * scale) / 2; const my = bx + pad + (inner - vh * scale) / 2;
  const badgeSvg = `<rect x="${bx}" y="${bx}" width="${badge}" height="${badge}" rx="${badge * 0.22}" fill="${bg}"/>`
    + `<g transform="translate(${mx.toFixed(3)} ${my.toFixed(3)}) scale(${scale.toFixed(5)}) translate(${-vx} ${-vy})"><path fill="${fg}" d="${MONO_D}"/></g>`;
  return { total, quiet, svg: `<path fill="${fg}" shape-rendering="crispEdges" d="${d}"/>${finderSvg}${badgeSvg}` };
}

export function brandedQrSvg(text = qrUrl(), { theme = 'creme' } = {}) {
  const open = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="1024" height="1024" role="img" aria-label="QR code Taxi Saint-Irénée">`;
  if (theme === 'noir') {
    const q = qrBody(text, { fg: CREME, bg: NOIR });
    return `${open(q.total)}<rect width="${q.total}" height="${q.total}" rx="${q.quiet * 0.75}" fill="${NOIR}"/>${q.svg}</svg>\n`;
  }
  if (theme === 'cadre') {
    const frame = 3;
    const q = qrBody(text, { fg: NOIR, bg: CREME, offset: frame });
    const size = q.total + frame * 2;
    return `${open(size)}<rect width="${size}" height="${size}" rx="${frame * 1.4}" fill="${NOIR}"/>`
      + `<rect x="${frame}" y="${frame}" width="${q.total}" height="${q.total}" rx="${q.quiet * 0.6}" fill="${CREME}"/>${q.svg}</svg>\n`;
  }
  const q = qrBody(text, { fg: NOIR, bg: CREME });
  return `${open(q.total)}<rect width="${q.total}" height="${q.total}" rx="${q.quiet * 0.75}" fill="${CREME}"/>${q.svg}</svg>\n`;
}
