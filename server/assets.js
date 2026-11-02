// Versionnage des fichiers statiques : chaque URL reçoit ?v=<empreinte>.
// Les navigateurs peuvent garder les fichiers un an, et une mise à jour du site
// change l'empreinte, donc l'URL : les visiteurs reçoivent toujours la bonne version.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './config.js';

const PUBLIC = path.join(ROOT, 'public');
let manifest = null;
let builtAt = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sha = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 10);

function build() {
  const map = new Map();
  const files = walk(path.join(PUBLIC, 'assets')).sort();
  for (const file of files) map.set('/' + path.relative(PUBLIC, file).split(path.sep).join('/'), sha(readFileSync(file)));
  // Modules JS : une version commune, pour qu'un import modifié change aussi l'URL des modules qui l'utilisent
  const js = [...map].filter(([p]) => p.endsWith('.js'));
  const jsVersion = sha(js.map(([p, h]) => p + h).join('|'));
  for (const [p] of js) map.set(p, jsVersion);
  // Feuilles de style : la version tient compte des polices et images qu'elles référencent
  const others = [...map].filter(([p]) => !p.endsWith('.css') && !p.endsWith('.js')).map(([p, h]) => p + h).join('|');
  for (const [p, h] of [...map].filter(([p]) => p.endsWith('.css'))) map.set(p, sha(h + others));
  return map;
}

export function assetManifest() {
  // En développement, on recalcule au plus toutes les secondes pour suivre les modifications.
  if (!manifest || (config.dev && Date.now() - builtAt > 1000)) {
    manifest = build();
    builtAt = Date.now();
  }
  return manifest;
}

export const versionOf = (urlPath) => assetManifest().get(urlPath) || null;

// Ajoute ?v= aux références /assets/... d'une page HTML (y compris les sprites d'icônes)
export function versionHtml(html) {
  const m = assetManifest();
  return html.replace(/(["'(])(\/assets\/[^"'()?#\s]+)(#[^"'()\s]*)?(["')])/g, (all, open, p, hash = '', close) => {
    const v = m.get(p);
    return v ? `${open}${p}?v=${v}${hash}${close}` : all;
  });
}

// Dans les modules JavaScript, les imports relatifs reçoivent aussi leur version
export function versionJs(source, urlPath) {
  const m = assetManifest();
  const dir = urlPath.slice(0, urlPath.lastIndexOf('/') + 1);
  return source.replace(/(from\s+|import\s*\()(['"])\.\/([\w.-]+\.js)\2/g, (all, kw, q, file) => {
    const v = m.get(dir + file);
    return v ? `${kw}${q}./${file}?v=${v}${q}` : all;
  });
}

// Minification légère du CSS : commentaires et espaces superflus, chaînes et url() intactes.
export function minifyCss(css) {
  const parts = css.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  return parts.map((part, i) => {
    if (i % 2) return part; // chaîne entre guillemets : inchangée
    return part
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{};,>])\s*/g, '$1')
      .replace(/:\s+/g, ':')
      .replace(/;}/g, '}');
  }).join('').trim();
}
