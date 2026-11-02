import crypto from 'node:crypto';
import { db, uid, bookingRef, nextInvoiceNumber } from './db.js';
import { config, hasAssistantKey } from './config.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions,
  currentUser, isDriver, rateLimit, clientIp, sha256, safeEqual,
} from './auth.js';
import { SERVICES, computeInsights, parisToday } from './insights.js';
import { askAssistant } from './assistant.js';
import { qrUrl, qrTarget, normalizeTarget, brandedQrSvg, QR_THEMES, qrIsProvisional } from './qr.js';
import {
  notifyNewBooking, notifyClientReceived, notifyClientConfirmed, notifyInvoice,
  notifyCancelled, notifyContact, sendResetMail,
} from './notify.js';

// ── Utilitaires HTTP ───────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const fail = (status, message, field) => { throw new HttpError(status, message, field); };

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

async function readBody(req, limit = 32 * 1024) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return {};
  // Sur Vercel, le corps peut déjà avoir été lu et décodé par la plateforme
  if (req.body !== undefined) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) { try { return req.body.length ? JSON.parse(req.body.toString()) : {}; } catch { fail(400, 'Requête illisible.'); } }
    return {};
  }
  const type = req.headers['content-type'] || '';
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  if (!size) return {};
  if (!type.includes('application/json')) fail(415, 'Format non pris en charge.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Requête illisible.'); }
}

// Protection CSRF : les requêtes qui modifient des données doivent venir du site.
function checkOrigin(req) {
  if (['GET', 'HEAD'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const host = new URL(origin).host;
    const allowed = [req.headers.host, req.headers['x-forwarded-host'], new URL(config.siteUrl).host].filter(Boolean);
    if (!allowed.includes(host)) fail(403, 'Origine refusée.');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(403, 'Origine refusée.');
  }
}

// ── Validation ─────────────────────────────────────────────────────
const str = (v, { max = 200, min = 0, field, label = 'Ce champ' } = {}) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (s.length < min) fail(400, min <= 1 ? `${label} est obligatoire.` : `${label} est trop court.`, field);
  return s.slice(0, max);
};
const text = (v, max = 600) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const email = (v, { required = false, field = 'email' } = {}) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase().slice(0, 160) : '';
  if (!s && !required) return '';
  if (!EMAIL_RE.test(s)) fail(400, 'Adresse e-mail invalide.', field);
  return s;
};
export function normalizePhone(v) {
  let s = String(v || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(s)) s = `+33${s.slice(1)}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}
const phone = (v, field = 'phone') => normalizePhone(v) || fail(400, 'Numéro de téléphone invalide.', field);
const password = (v, field = 'password') => {
  if (typeof v !== 'string' || v.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.', field);
  if (v.length > 200) fail(400, 'Mot de passe trop long.', field);
  return v;
};
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const OPTIONS = { fauteuil: 'Fauteuil roulant pliable', animal: 'Animal de compagnie', aide: 'Aide à la montée' };

// ── Vues publiques ─────────────────────────────────────────────────
const publicUser = (u) => ({
  id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone,
  addresses: u.addresses || [], createdAt: u.createdAt,
});
function publicBooking(b) {
  const inv = b.invoiceId ? db.data.invoices.find((i) => i.id === b.invoiceId) : null;
  return {
    id: b.id, ref: b.ref, status: b.status, service: b.service, serviceLabel: SERVICES[b.service],
    pickup: b.pickup, dropoff: b.dropoff, asap: b.asap, date: b.date, time: b.time, returnTrip: b.returnTrip,
    passengers: b.passengers, luggage: b.luggage, options: b.options, travelRef: b.travelRef, notes: b.notes,
    medical: b.medical, timeKind: b.timeKind, estimate: b.estimate, lang: b.lang, driverNote: b.driverNote, createdAt: b.createdAt,
    invoice: inv ? { id: inv.id, number: inv.number, amountTTC: inv.amountTTC } : null,
  };
}
const userBookings = (u) => db.data.bookings.filter((b) => b.userId === u.id);
const userInvoices = (u) => db.data.invoices.filter((i) => i.userId === u.id);

function requireUser(req) {
  const user = currentUser(req);
  if (!user) fail(401, 'Veuillez vous connecter.');
  return user;
}
function requireDriver(req) {
  if (!isDriver(req)) fail(401, 'Accès réservé au chauffeur.');
}

// ── Réservation (client, invité ou saisie chauffeur) ───────────────
function parseBooking(body, { byDriver = false } = {}) {
  const service = Object.hasOwn(SERVICES, body.service) ? body.service : fail(400, 'Choisissez un type de course.', 'service');
  const pickup = str(body.pickup, { min: 3, field: 'pickup', label: "L'adresse de départ" });
  const dropoff = str(body.dropoff, { min: 3, field: 'dropoff', label: "L'adresse d'arrivée" });
  const asap = body.asap === true;
  const today = parisToday();
  let date = '';
  let time = '';
  if (!asap) {
    if (!isDate(body.date)) fail(400, 'Indiquez une date.', 'date');
    if (!isTime(body.time)) fail(400, 'Indiquez une heure.', 'time');
    date = body.date; time = body.time;
    if (!byDriver) {
      const [h, m] = time.split(':').map(Number);
      if (date < today.date || (date === today.date && h * 60 + m < today.minutes - 15)) fail(400, 'Cette date est déjà passée.', 'date');
      const max = new Date(); max.setFullYear(max.getFullYear() + 1);
      if (date > max.toISOString().slice(0, 10)) fail(400, "Les réservations sont ouvertes jusqu'à un an à l'avance.", 'date');
    }
  } else {
    date = today.date;
    const h = Math.floor(today.minutes / 60); const m = today.minutes % 60;
    time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const medicalRide = service === 'conventionne';
  let returnTrip = null;
  if (body.returnTrip && typeof body.returnTrip === 'object') {
    if (medicalRide) {
      // Transport médical : retour le même jour, heure facultative (à convenir avec le chauffeur)
      const rt = body.returnTrip.time ? body.returnTrip.time : '';
      if (rt && !isTime(rt)) fail(400, 'Heure de retour invalide.', 'returnTime');
      if (rt && rt <= time) fail(400, 'Le retour doit avoir lieu après le rendez-vous.', 'returnTime');
      returnTrip = { date, time: rt, tbd: !rt };
    } else if (body.returnTrip.date || body.returnTrip.time) {
      if (!isDate(body.returnTrip.date) || !isTime(body.returnTrip.time)) fail(400, 'Précisez la date et l’heure du retour.', 'returnDate');
      if (`${body.returnTrip.date}T${body.returnTrip.time}` <= `${date}T${time}`) fail(400, 'Le retour doit avoir lieu après l’aller.', 'returnDate');
      returnTrip = { date: body.returnTrip.date, time: body.returnTrip.time };
    }
  }
  const passengers = Math.min(6, Math.max(1, Number.parseInt(body.passengers, 10) || 1));
  const luggage = Math.min(8, Math.max(0, Number.parseInt(body.luggage, 10) || 0));
  const options = Array.isArray(body.options) ? [...new Set(body.options.filter((o) => Object.hasOwn(OPTIONS, o)))].map((o) => OPTIONS[o]) : [];
  // Transport médical : aucune donnée de santé, seulement la situation administrative
  let medical = null;
  if (medicalRide) {
    const p = body.medical?.prescription;
    const prescription = ['oui', 'remise', 'non'].includes(p) ? p : (byDriver ? 'oui' : fail(400, 'Indiquez si vous avez une prescription médicale de transport.', 'prescription'));
    medical = { prescription, recurring: body.medical?.recurring === true };
  }
  const km = Number(body.estimate?.km); const minutes = Number(body.estimate?.minutes);
  const estimate = km > 0 && km < 3000 && minutes > 0 && minutes < 3000 ? { km: Math.round(km * 10) / 10, minutes: Math.round(minutes) } : null;
  return {
    service, pickup, dropoff, asap, date, time, timeKind: medicalRide ? 'rdv' : 'prise-en-charge', returnTrip, passengers, luggage, options, medical, estimate,
    lang: body.lang === 'en' ? 'en' : 'fr',
    travelRef: str(body.travelRef, { max: 24 }), notes: text(body.notes),
  };
}

function storeBooking(data, { userId = null, contact, source = 'site' }) {
  const booking = {
    id: uid('b_'), ref: bookingRef(), status: 'pending', userId, contact, source, ...data,
    driverNote: '', invoiceId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.data.counters.booking += 1;
  db.data.bookings.push(booking);
  db.save();
  return booking;
}

// ── Routes ─────────────────────────────────────────────────────────
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', () => ({ ok: true }));

route('GET', '/api/config', () => ({
  phone: config.phoneDisplay, phoneTel: config.phoneTel, services: SERVICES, options: OPTIONS,
  loyalty: config.loyalty, assistant: hasAssistantKey() ? 'claude' : 'local',
}));

// Authentification client
route('POST', '/api/auth/register', async ({ req, res, body }) => {
  if (!rateLimit(`register:${clientIp(req)}`, 6, 3600_000)) fail(429, 'Trop de tentatives. Réessayez plus tard.');
  const user = await createUser(body);
  createSession(req, res, { userId: user.id });
  return { user: publicUser(user) };
});

async function createUser(body) {
  const firstName = str(body.firstName, { min: 1, max: 60, field: 'firstName', label: 'Le prénom' });
  const lastName = str(body.lastName, { min: 1, max: 60, field: 'lastName', label: 'Le nom' });
  const mail = email(body.email, { required: true });
  const tel = phone(body.phone);
  const pass = password(body.password);
  if (db.data.users.some((u) => u.email === mail)) fail(409, 'Un compte existe déjà avec cette adresse. Connectez-vous.', 'email');
  const user = {
    id: uid('u_'), firstName, lastName, email: mail, phone: tel, passHash: await hashPassword(pass),
    addresses: [], loyalty: { redeemed: 0 }, createdAt: new Date().toISOString(),
  };
  db.data.users.push(user);
  db.save();
  return user;
}

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  const mail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!rateLimit(`login:${clientIp(req)}`, 20, 900_000) || !rateLimit(`login:${mail}`, 8, 900_000)) fail(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  const user = db.data.users.find((u) => u.email === mail);
  const ok = await verifyPassword(String(body.password || ''), user?.passHash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!user || !ok) fail(401, 'E-mail ou mot de passe incorrect.');
  createSession(req, res, { userId: user.id });
  return { user: publicUser(user) };
});

route('POST', '/api/auth/logout', ({ req, res }) => { destroySession(req, res); return { ok: true }; });

route('POST', '/api/auth/forgot', async ({ req, body }) => {
  if (!rateLimit(`forgot:${clientIp(req)}`, 5, 3600_000)) fail(429, 'Trop de demandes. Réessayez plus tard.');
  const mail = email(body.email, { required: true });
  const user = db.data.users.find((u) => u.email === mail);
  if (!config.resendKey) return { ok: true, mail: false };
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.data.resetTokens.push({ id: sha256(token), userId: user.id, expiresAt: Date.now() + 3600_000 });
    db.save();
    await sendResetMail(user.email, user.firstName, `${config.siteUrl}/compte?reinitialiser=${token}`);
  }
  return { ok: true, mail: true };
});

route('POST', '/api/auth/reset', async ({ req, res, body }) => {
  const id = sha256(String(body.token || ''));
  const entry = db.data.resetTokens.find((t) => t.id === id && t.expiresAt > Date.now());
  if (!entry) fail(400, 'Ce lien a expiré. Faites une nouvelle demande.');
  const user = db.data.users.find((u) => u.id === entry.userId) || fail(400, 'Compte introuvable.');
  user.passHash = await hashPassword(password(body.password));
  db.data.resetTokens = db.data.resetTokens.filter((t) => t.userId !== user.id);
  destroyUserSessions(user.id);
  createSession(req, res, { userId: user.id });
  return { user: publicUser(user) };
});

// Profil
route('GET', '/api/me', ({ req }) => {
  const user = currentUser(req);
  return { user: user ? publicUser(user) : null };
});

route('PATCH', '/api/me', ({ req, body }) => {
  const user = requireUser(req);
  if ('firstName' in body) user.firstName = str(body.firstName, { min: 1, max: 60, field: 'firstName', label: 'Le prénom' });
  if ('lastName' in body) user.lastName = str(body.lastName, { min: 1, max: 60, field: 'lastName', label: 'Le nom' });
  if ('phone' in body) user.phone = phone(body.phone);
  if ('email' in body) {
    const mail = email(body.email, { required: true });
    if (mail !== user.email && db.data.users.some((u) => u.email === mail)) fail(409, 'Cette adresse est déjà utilisée.', 'email');
    user.email = mail;
  }
  if (Array.isArray(body.addresses)) {
    user.addresses = body.addresses.slice(0, 12).map((a) => ({
      id: typeof a.id === 'string' && a.id.length < 30 ? a.id : uid('a_'),
      label: str(a.label, { min: 1, max: 40, label: 'Le nom de l’adresse' }),
      address: str(a.address, { min: 3, max: 200, label: 'L’adresse' }),
    }));
  }
  db.save();
  return { user: publicUser(user) };
});

route('POST', '/api/me/password', async ({ req, body }) => {
  const user = requireUser(req);
  if (!rateLimit(`pw:${user.id}`, 6, 900_000)) fail(429, 'Trop de tentatives.');
  if (!(await verifyPassword(String(body.current || ''), user.passHash))) fail(400, 'Mot de passe actuel incorrect.', 'current');
  user.passHash = await hashPassword(password(body.next, 'next'));
  db.save();
  return { ok: true };
});

route('POST', '/api/me/delete', async ({ req, res, body }) => {
  const user = requireUser(req);
  if (!(await verifyPassword(String(body.password || ''), user.passHash))) fail(400, 'Mot de passe incorrect.', 'password');
  // Les factures sont conservées (obligation comptable), détachées du compte.
  for (const b of db.data.bookings) if (b.userId === user.id) b.userId = null;
  for (const i of db.data.invoices) if (i.userId === user.id) i.userId = null;
  db.data.users = db.data.users.filter((u) => u.id !== user.id);
  destroyUserSessions(user.id);
  destroySession(req, res);
  return { ok: true };
});

// Réservations
route('POST', '/api/bookings', async ({ req, res, body }) => {
  if (!rateLimit(`booking:${clientIp(req)}`, 12, 3600_000)) fail(429, 'Trop de demandes envoyées. Appelez le ' + config.phoneDisplay + '.');
  // Anti-robots : champ piège rempli, ou formulaire envoyé en moins de 2,5 secondes
  if (body.website || (typeof body.elapsed === 'number' && body.elapsed >= 0 && body.elapsed < 2500)) return { booking: { ref: bookingRef(), status: 'pending' } };
  if (body.consent !== true) fail(400, 'Merci d’accepter l’utilisation de vos données pour traiter la demande.', 'consent');
  const data = parseBooking(body);
  let user = currentUser(req);
  const c = body.contact || {};
  const contact = {
    name: str(c.name, { min: 2, max: 80, field: 'name', label: 'Le nom' }),
    phone: phone(c.phone),
    email: email(c.email, { required: Boolean(body.createAccount) }),
  };
  let created = false;
  if (!user && body.createAccount) {
    const [firstName, ...rest] = contact.name.split(' ');
    user = await createUser({ firstName, lastName: rest.join(' ') || firstName, email: contact.email, phone: contact.phone, password: body.createAccount.password });
    createSession(req, res, { userId: user.id });
    created = true;
  }
  const booking = storeBooking(data, { userId: user?.id || null, contact });
  notifyNewBooking(booking);
  notifyClientReceived(booking);
  return { booking: publicBooking(booking), accountCreated: created };
});

route('GET', '/api/bookings', ({ req }) => {
  const user = requireUser(req);
  return { bookings: userBookings(user).map(publicBooking).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)) };
});

route('POST', '/api/bookings/:id/cancel', ({ req, params }) => {
  const user = requireUser(req);
  const b = db.data.bookings.find((x) => x.id === params.id && x.userId === user.id) || fail(404, 'Réservation introuvable.');
  if (!['pending', 'confirmed'].includes(b.status)) fail(400, 'Cette course ne peut plus être annulée en ligne.');
  b.status = 'cancelled';
  b.updatedAt = new Date().toISOString();
  db.save();
  notifyCancelled(b);
  return { booking: publicBooking(b) };
});

// Factures
route('GET', '/api/invoices', ({ req }) => {
  const user = requireUser(req);
  return { invoices: userInvoices(user).map(publicInvoice).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) };
});

route('GET', '/api/invoices/:id', ({ req, params, url }) => {
  const inv = db.data.invoices.find((i) => i.id === params.id) || fail(404, 'Facture introuvable.');
  const user = currentUser(req);
  const token = url.searchParams.get('t');
  const allowed = isDriver(req) || (user && inv.userId === user.id) || (token && safeEqual(token, inv.accessToken));
  if (!allowed) fail(user ? 404 : 401, user ? 'Facture introuvable.' : 'Veuillez vous connecter.');
  return { invoice: publicInvoice(inv) };
});

function publicInvoice(i) {
  const { accessToken, ...rest } = i;
  return rest;
}

// Analyse et assistant
route('GET', '/api/insights', ({ req }) => {
  const user = requireUser(req);
  return { insights: computeInsights(user, userBookings(user), userInvoices(user)), engine: hasAssistantKey() ? 'claude' : 'local' };
});

route('POST', '/api/assistant', async ({ req, body }) => {
  const user = requireUser(req);
  if (!rateLimit(`assistant:${user.id}`, 40, 3600_000)) fail(429, "L'assistant a besoin d'une pause. Réessayez dans un moment.");
  const message = text(body.message, 800);
  if (!message) fail(400, 'Votre message est vide.');
  const bookings = userBookings(user);
  const invoices = userInvoices(user);
  const insights = computeInsights(user, bookings, invoices);
  const history = Array.isArray(body.history) ? body.history : [];
  return askAssistant({ user, bookings, invoices, insights, message, history });
});

// Contact
route('POST', '/api/contact', ({ req, body }) => {
  if (!rateLimit(`contact:${clientIp(req)}`, 6, 3600_000)) fail(429, 'Trop de messages. Appelez le ' + config.phoneDisplay + '.');
  if (body.website) return { ok: true };
  if (body.consent !== true) fail(400, 'Merci d’accepter l’utilisation de vos données pour vous répondre.', 'consent');
  const msg = {
    id: uid('m_'), name: str(body.name, { min: 2, max: 80, field: 'name', label: 'Le nom' }),
    phone: body.phone ? phone(body.phone) : '', email: email(body.email),
    message: text(body.message, 2000) || fail(400, 'Votre message est vide.', 'message'),
    createdAt: new Date().toISOString(), read: false,
  };
  if (!msg.phone && !msg.email) fail(400, 'Indiquez un téléphone ou un e-mail pour la réponse.', 'phone');
  db.data.messages.push(msg);
  db.save();
  notifyContact(msg);
  return { ok: true };
});

// ── Espace chauffeur ───────────────────────────────────────────────
route('POST', '/api/driver/login', ({ req, res, body }) => {
  if (!rateLimit(`driver:${clientIp(req)}`, 8, 900_000)) fail(429, 'Trop de tentatives.');
  if (!config.driverPassword) fail(503, 'Définissez DRIVER_PASSWORD dans la configuration du serveur.');
  if (!safeEqual(String(body.password || ''), config.driverPassword)) fail(401, 'Mot de passe incorrect.');
  createSession(req, res, { role: 'driver', days: 30 });
  return { ok: true };
});

route('GET', '/api/driver/session', ({ req }) => ({ driver: isDriver(req) }));

route('GET', '/api/driver/bookings', ({ req }) => {
  requireDriver(req);
  const users = new Map(db.data.users.map((u) => [u.id, u]));
  return {
    bookings: db.data.bookings.map((b) => ({
      ...publicBooking(b), contact: b.contact, source: b.source,
      account: b.userId && users.get(b.userId) ? { name: `${users.get(b.userId).firstName} ${users.get(b.userId).lastName}`, loyalty: loyaltyFor(users.get(b.userId)) } : null,
    })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    messages: db.data.messages.slice(-30).reverse(),
  };
});

function loyaltyFor(user) {
  const eligible = db.data.bookings.filter((b) => b.userId === user.id && b.status === 'completed' && b.service !== 'conventionne').length;
  const available = Math.floor(eligible / config.loyalty.step) - (user.loyalty?.redeemed || 0);
  return { eligible, available: Math.max(0, available) };
}

route('POST', '/api/driver/bookings', ({ req, body }) => {
  requireDriver(req);
  const data = parseBooking(body, { byDriver: true });
  const c = body.contact || {};
  const account = body.accountEmail ? db.data.users.find((u) => u.email === String(body.accountEmail).trim().toLowerCase()) : null;
  if (body.accountEmail && !account) fail(404, 'Aucun compte client avec cet e-mail.', 'accountEmail');
  const contact = {
    name: c.name ? str(c.name, { max: 80 }) : account ? `${account.firstName} ${account.lastName}` : fail(400, 'Indiquez le nom du client.', 'name'),
    phone: c.phone ? phone(c.phone) : account?.phone || fail(400, 'Indiquez le téléphone du client.', 'phone'),
    email: c.email ? email(c.email) : account?.email || '',
  };
  const booking = storeBooking(data, { userId: account?.id || null, contact, source: 'telephone' });
  if (body.confirmed) { booking.status = 'confirmed'; db.save(); }
  return { booking: publicBooking(booking) };
});

route('PATCH', '/api/driver/bookings/:id', ({ req, params, body }) => {
  requireDriver(req);
  const b = db.data.bookings.find((x) => x.id === params.id) || fail(404, 'Réservation introuvable.');
  const before = b.status;
  if (body.status) {
    if (!['pending', 'confirmed', 'declined', 'cancelled'].includes(body.status)) fail(400, 'Statut inconnu.');
    if (b.status === 'completed') fail(400, 'Course déjà terminée.');
    b.status = body.status;
  }
  if (body.date !== undefined || body.time !== undefined) {
    if (!isDate(body.date) || !isTime(body.time)) fail(400, 'Date ou heure invalide.');
    b.date = body.date; b.time = body.time; b.asap = false;
  }
  if (typeof body.driverNote === 'string') b.driverNote = text(body.driverNote, 300);
  b.updatedAt = new Date().toISOString();
  db.save();
  if (b.status === 'confirmed' && before !== 'confirmed') notifyClientConfirmed(b);
  return { booking: publicBooking(b) };
});

route('POST', '/api/driver/bookings/:id/complete', ({ req, params, body }) => {
  requireDriver(req);
  const b = db.data.bookings.find((x) => x.id === params.id) || fail(404, 'Réservation introuvable.');
  if (b.invoiceId) fail(400, 'Une facture existe déjà pour cette course.');
  const amount = Math.round(Number(String(body.amountTTC).replace(',', '.')) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) fail(400, 'Montant invalide.', 'amountTTC');
  const medical = b.service === 'conventionne';
  const patientShare = medical ? Math.max(0, Math.min(amount, Math.round(Number(String(body.patientShare || 0).replace(',', '.')) * 100) / 100 || 0)) : null;
  const vatRate = config.vatRate;
  const amountHT = Math.round((amount / (1 + vatRate / 100)) * 100) / 100;
  const methods = ['Carte bancaire', 'Espèces', 'Virement', 'Tiers payant Assurance Maladie', 'Compte entreprise'];
  const user = b.userId ? db.data.users.find((u) => u.id === b.userId) : null;
  const loyaltyApplied = Boolean(body.loyaltyApplied && user && !medical && loyaltyFor(user).available > 0);
  if (loyaltyApplied) { user.loyalty = user.loyalty || { redeemed: 0 }; user.loyalty.redeemed += 1; }
  const issued = new Date();
  const invoice = {
    id: uid('f_'), number: nextInvoiceNumber(issued), accessToken: crypto.randomBytes(18).toString('base64url'),
    bookingId: b.id, bookingRef: b.ref, userId: b.userId, issuedAt: issued.toISOString(),
    serviceDate: b.date, serviceTime: b.time, service: SERVICES[b.service], pickup: b.pickup, dropoff: b.dropoff,
    distanceKm: Number(body.distanceKm) > 0 ? Math.round(Number(body.distanceKm) * 10) / 10 : null,
    client: { name: b.contact.name, email: b.contact.email, phone: b.contact.phone },
    amountTTC: amount, vatRate, amountHT, vat: Math.round((amount - amountHT) * 100) / 100,
    paymentMethod: methods.includes(body.paymentMethod) ? body.paymentMethod : methods[0],
    medical, patientShare, loyaltyApplied, note: text(body.note, 200),
    company: { ...config.company },
  };
  db.data.invoices.push(invoice);
  b.status = 'completed';
  b.invoiceId = invoice.id;
  b.updatedAt = issued.toISOString();
  db.save();
  const link = `${config.siteUrl}/facture?id=${invoice.id}&t=${invoice.accessToken}`;
  notifyInvoice(invoice, link, b.contact.email, b.contact.name);
  return { invoice: publicInvoice(invoice), link };
});

// QR code permanent
route('GET', '/api/driver/qr', ({ req }) => {
  requireDriver(req);
  const s = db.data.settings || {};
  const url = qrUrl();
  const target = qrTarget();
  return { url, provisional: qrIsProvisional(), siteUrl: config.siteUrl, target: target.startsWith('/') ? `${config.siteUrl}${target}` : target, scans: s.qrScans || 0, lastScanAt: s.qrLastScanAt || null };
});

route('POST', '/api/driver/qr', ({ req, body }) => {
  requireDriver(req);
  const target = normalizeTarget(body.target) || fail(400, 'Indiquez un lien complet commençant par https:// (ou une page du site, ex. /reserver).', 'target');
  db.data.settings = db.data.settings || {};
  db.data.settings.qrTarget = target;
  db.save();
  return { url: qrUrl(), target };
});

route('GET', '/api/driver/qr.svg', ({ req, res, url }) => {
  requireDriver(req);
  const theme = QR_THEMES.includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'creme';
  const svg = brandedQrSvg(qrUrl(), { theme });
  const headers = { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' };
  if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename="qr-code-taxi-saint-irenee-${theme}.svg"`;
  res.writeHead(200, headers);
  res.end(svg);
  return null;
});

route('POST', '/api/driver/messages/:id/read', ({ req, params }) => {
  requireDriver(req);
  const m = db.data.messages.find((x) => x.id === params.id);
  if (m) { m.read = true; db.save(); }
  return { ok: true };
});

// ── Point d'entrée ─────────────────────────────────────────────────
export async function handleApi(req, res, url) {
  try {
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) {
      const exists = routes.some((r) => r.re.test(url.pathname));
      fail(exists ? 405 : 404, exists ? 'Méthode non autorisée.' : 'Ressource introuvable.');
    }
    checkOrigin(req);
    const body = await readBody(req);
    const values = url.pathname.match(match.re).slice(1);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(values[i])]));
    const result = await match.handler({ req, res, body: body && typeof body === 'object' ? body : {}, params, url });
    if (!res.headersSent) send(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message, field: err.field });
    else {
      console.error('[api]', err);
      send(res, 500, { error: 'Une erreur est survenue. Appelez le ' + config.phoneDisplay + '.' });
    }
  }
}
