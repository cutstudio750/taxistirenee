import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'tsi_session';
const DAY = 24 * 60 * 60 * 1000;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, expected);
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return config.secureCookies || req.headers['x-forwarded-proto'] === 'https';
}

export function createSession(req, res, { userId = null, role = 'client', days = 60 }) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.data.sessions.push({ id: sha256(token), userId, role, createdAt: Date.now(), expiresAt: Date.now() + days * DAY });
  db.save();
  const cookie = [
    `${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${days * 86400}`,
    isSecure(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  appendCookie(res, cookie);
}

export function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const id = sha256(token);
    db.data.sessions = db.data.sessions.filter((s) => s.id !== id);
    db.save();
  }
  appendCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`);
}

export function destroyUserSessions(userId) {
  db.data.sessions = db.data.sessions.filter((s) => s.userId !== userId);
  db.save();
}

function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

export function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const id = sha256(token);
  const session = db.data.sessions.find((s) => s.id === id);
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

export function currentUser(req) {
  const session = getSession(req);
  if (!session || session.role !== 'client') return null;
  return db.data.users.find((u) => u.id === session.userId) || null;
}

export function isDriver(req) {
  return getSession(req)?.role === 'driver';
}

// Limiteur de débit en mémoire : fenêtre glissante par clé.
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) if (!hits.some((t) => now - t < DAY)) buckets.delete(key);
}, 60 * 60 * 1000).unref();

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
