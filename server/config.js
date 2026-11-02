import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lecture d'un fichier .env simple (clé=valeur), sans dépendance.
const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;

export const config = {
  port: Number(env('PORT', '3000')),
  dev: env('NODE_ENV') === 'development',
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  // Version fixe pour GitHub Pages (npm run build:pages) : pas de serveur, pas de comptes
  staticExport: env('STATIC_EXPORT') === '1',
  basePath: env('BASE_PATH', '').replace(/\/$/, ''),
  secureCookies: env('SECURE_COOKIES') === '1',
  // DATA_DIR : dossier du disque permanent chez l'hébergeur (par défaut ./data)
  dataFile: path.join(path.resolve(ROOT, env('DATA_DIR', 'data')), env('DATA_FILE', 'db.json')),

  phoneDisplay: '06 61 88 27 07',
  contactEmail: env('CONTACT_EMAIL', 'taxisaintirenee@gmail.com'),
  googleReviewUrl: env('GOOGLE_REVIEW_URL'),
  phoneTel: '+33661882707',
  whatsapp: 'https://wa.me/33661882707',

  driverPassword: env('DRIVER_PASSWORD'),
  ntfyUrl: env('NTFY_URL'),
  resendKey: env('RESEND_API_KEY'),
  mailFrom: env('MAIL_FROM', 'Taxi Saint-Irénée <reservation@taxi-saint-irenee.fr>'),
  driverEmail: env('DRIVER_EMAIL', env('CONTACT_EMAIL', 'taxisaintirenee@gmail.com')),

  anthropicKey: env('ANTHROPIC_API_KEY'),
  assistantModel: env('ASSISTANT_MODEL', 'claude-opus-5-5'),

  company: {
    name: 'Taxi Saint-Irénée',
    legalName: env('COMPANY_LEGAL_NAME', 'Taxi Saint-Irénée'),
    legalForm: env('COMPANY_LEGAL_FORM'),
    // Nom du dirigeant : jamais affiché sur le site, sauf s'il est renseigné ici
    owner: env('COMPANY_OWNER'),
    director: env('COMPANY_DIRECTOR'),
    address: env('COMPANY_ADDRESS'),
    siret: env('COMPANY_SIRET'),
    vatNumber: env('COMPANY_VAT_NUMBER'),
    ads: env('COMPANY_ADS_NUMBER'),
    cpam: env('COMPANY_CPAM_CONVENTION'),
    email: env('COMPANY_EMAIL', env('CONTACT_EMAIL', 'taxisaintirenee@gmail.com')),
    mediator: env('COMPANY_MEDIATOR'),
    host: env('COMPANY_HOST'),
  },
  vatRate: Number(env('VAT_RATE', '10')),
  loyalty: {
    step: Math.max(2, Number(env('LOYALTY_STEP', '10'))),
    reward: env('LOYALTY_REWARD', '10 % de remise sur la course suivante'),
  },
};

export const hasAssistantKey = () => Boolean(config.anthropicKey || process.env.ANTHROPIC_AUTH_TOKEN);
