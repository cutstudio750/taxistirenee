// Stockage des données (comptes, réservations, factures) :
// - sur un serveur classique : un fichier JSON sur disque, écritures atomiques et sérialisées ;
// - sur Vercel (aucun disque permanent) : le même document JSON dans une base Postgres
//   (Neon), dès que DATABASE_URL est défini.
import { readFile, writeFile, rename, mkdir, readdir, unlink, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
let sqlClient = null;
async function sql() {
  if (!sqlClient) {
    const { neon } = await import('@neondatabase/serverless');
    sqlClient = neon(PG_URL);
    await sqlClient`CREATE TABLE IF NOT EXISTS site_data (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  }
  return sqlClient;
}

const EMPTY = () => ({
  users: [],
  sessions: [],
  bookings: [],
  invoices: [],
  messages: [],
  resetTokens: [],
  settings: {},
  counters: { booking: 0, invoice: {} },
});

class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.queue = Promise.resolve();
  }

  get usesDatabase() { return Boolean(PG_URL); }

  async load() {
    if (PG_URL) {
      const db = await sql();
      const rows = await db`SELECT data FROM site_data WHERE id = 'main'`;
      if (rows[0]) this.data = { ...EMPTY(), ...rows[0].data };
      else await this.save();
      this.purge();
      return;
    }
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await readFile(this.file, 'utf8');
      this.data = { ...EMPTY(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.save();
    }
    this.purge();
  }

  save() {
    const snapshot = JSON.stringify(this.data);
    this.queue = this.queue.then(async () => {
      if (PG_URL) {
        const db = await sql();
        await db`INSERT INTO site_data (id, data, updated_at) VALUES ('main', ${snapshot}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
        return;
      }
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.file);
    }).catch((err) => console.error('[db] écriture impossible', err));
    return this.queue;
  }

  // Copie de sauvegarde quotidienne (data/backups), conservée 30 jours
  async backup() {
    try {
      await this.queue;
      if (PG_URL) {
        const db = await sql();
        const id = `backup-${new Date().toISOString().slice(0, 10)}`;
        await db`INSERT INTO site_data (id, data) SELECT ${id}::text, data FROM site_data WHERE id = 'main' ON CONFLICT (id) DO NOTHING`;
        await db`DELETE FROM site_data WHERE id LIKE 'backup-%' AND updated_at < now() - interval '30 days'`;
        return;
      }
      const dir = path.join(path.dirname(this.file), 'backups');
      await mkdir(dir, { recursive: true });
      const base = path.basename(this.file, '.json');
      const day = new Date().toISOString().slice(0, 10);
      const target = path.join(dir, `${base}-${day}.json`);
      try { await stat(target); } catch { await copyFile(this.file, target); }
      const limit = Date.now() - 30 * 86400000;
      for (const name of await readdir(dir)) {
        const m = name.match(/^(.*)-(\d{4}-\d{2}-\d{2})\.json$/);
        if (m && m[1] === base && Date.parse(m[2]) < limit) await unlink(path.join(dir, name));
      }
    } catch (err) {
      console.error('[db] sauvegarde impossible', err.message);
    }
  }

  purge() {
    const now = Date.now();
    const before = this.data.sessions.length + this.data.resetTokens.length;
    this.data.sessions = this.data.sessions.filter((s) => s.expiresAt > now);
    this.data.resetTokens = this.data.resetTokens.filter((t) => t.expiresAt > now);
    if (this.data.sessions.length + this.data.resetTokens.length !== before) this.save();
  }
}

export const db = new Store(config.dataFile);
export const uid = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');

// Référence lisible au téléphone : TSI-AAMMJJ-XXXX (date de la demande, heure de Paris)
export function bookingRef(now = new Date()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (const b of crypto.randomBytes(4)) suffix += alphabet[b % alphabet.length];
  const p = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now)
    .reduce((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return `TSI-${p.year}${p.month}${p.day}-${suffix}`;
}

// Numérotation des factures continue et chronologique par année : F2026-0001
export function nextInvoiceNumber(date = new Date()) {
  const year = String(date.getFullYear());
  const counters = db.data.counters.invoice;
  counters[year] = (counters[year] || 0) + 1;
  return `F${year}-${String(counters[year]).padStart(4, '0')}`;
}
