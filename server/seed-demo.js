// Données de démonstration pour essayer l'espace client en local.
// Usage : DATA_FILE=demo.json npm run seed:demo, puis DATA_FILE=demo.json npm start
// Compte créé : claire.martin@exemple.fr / demo-taxi-2026
import { config } from './config.js';
import { db, uid, bookingRef, nextInvoiceNumber } from './db.js';
import { hashPassword } from './auth.js';
import { parisToday, SERVICES } from './insights.js';
import crypto from 'node:crypto';

if (config.dataFile.endsWith('/db.json')) {
  console.error('Par sécurité, lancez ce script avec DATA_FILE=demo.json (il ne touche pas aux vraies données).');
  process.exit(1);
}

await db.load();
db.data = { users: [], sessions: [], bookings: [], invoices: [], messages: [], resetTokens: [], counters: { booking: 0, invoice: {} } };

const HOME = '14 Rue des Macchabées, 69005 Lyon';
const LYON_SUD = 'Centre hospitalier Lyon Sud, 165 Chemin du Grand Revoyet, 69310 Pierre-Bénite';
const AIRPORT = 'Aéroport Lyon Saint-Exupéry, 69125 Colombier-Saugnieu';
const PART_DIEU = 'Gare de Lyon Part-Dieu, 5 Place Charles Béraudier, 69003 Lyon';
const RESTAURANT = '20 Quai Romain Rolland, 69005 Lyon';

const user = {
  id: uid('u_'), firstName: 'Claire', lastName: 'Martin', email: 'claire.martin@exemple.fr', phone: '+33612345678',
  passHash: await hashPassword('demo-taxi-2026'), addresses: [{ id: uid('a_'), label: 'Domicile', address: HOME }],
  loyalty: { redeemed: 0 }, createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
};
db.data.users.push(user);

const today = parisToday().date;
const shift = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

function add(date, time, pickup, dropoff, service, status, amount, share) {
  const b = {
    id: uid('b_'), ref: bookingRef(new Date(`${shift(date, -3)}T10:00:00Z`)), status, userId: user.id, source: 'site', service, pickup, dropoff, asap: false, date, time,
    returnTrip: null, passengers: 1, luggage: service === 'aeroport' ? 2 : 0, options: [], medical: service === 'conventionne' ? { prescription: 'oui', recurring: true } : null, timeKind: service === 'conventionne' ? 'rdv' : 'prise-en-charge', estimate: null, lang: 'fr',
    travelRef: '', notes: '', contact: { name: 'Claire Martin', phone: user.phone, email: user.email }, driverNote: '', invoiceId: null,
    createdAt: new Date(`${shift(date, -3)}T10:00:00Z`).toISOString(), updatedAt: new Date().toISOString(),
  };
  if (status === 'completed') {
    const issued = new Date(`${date}T${time}:00+01:00`);
    const inv = {
      id: uid('f_'), number: nextInvoiceNumber(issued), accessToken: crypto.randomBytes(18).toString('base64url'),
      bookingId: b.id, bookingRef: b.ref, userId: user.id, issuedAt: issued.toISOString(), serviceDate: date, serviceTime: time,
      service: SERVICES[service], pickup, dropoff, distanceKm: null, client: b.contact, amountTTC: amount, vatRate: config.vatRate,
      amountHT: Math.round((amount / (1 + config.vatRate / 100)) * 100) / 100, vat: 0, paymentMethod: service === 'conventionne' ? 'Tiers payant Assurance Maladie' : 'Carte bancaire',
      medical: service === 'conventionne', patientShare: service === 'conventionne' ? share : null, loyaltyApplied: false, note: '', company: { ...config.company },
    };
    inv.vat = Math.round((inv.amountTTC - inv.amountHT) * 100) / 100;
    db.data.invoices.push(inv);
    b.invoiceId = inv.id;
  }
  db.data.bookings.push(b);
}

// Radiothérapie : chaque mardi depuis 9 semaines, aller 8 h 15, retour 11 h 30
let d = shift(today, -63);
while (weekday(d) !== 2) d = shift(d, 1);
for (; d < today; d = shift(d, 7)) {
  add(d, '08:15', HOME, LYON_SUD, 'conventionne', 'completed', 41.6, 4);
  add(d, '11:30', LYON_SUD, HOME, 'conventionne', 'completed', 41.6, 4);
}
// Trajets privés
add(shift(today, -52), '06:10', HOME, AIRPORT, 'aeroport', 'completed', 74.2);
add(shift(today, -45), '21:40', AIRPORT, HOME, 'aeroport', 'completed', 79.5);
add(shift(today, -38), '19:30', HOME, RESTAURANT, 'ville', 'completed', 14.8);
add(shift(today, -30), '07:05', HOME, PART_DIEU, 'gare', 'completed', 21.3);
add(shift(today, -27), '18:50', PART_DIEU, HOME, 'gare', 'completed', 23.9);
add(shift(today, -16), '07:10', HOME, PART_DIEU, 'gare', 'completed', 21.6);
add(shift(today, -13), '19:05', PART_DIEU, HOME, 'gare', 'completed', 24.4);
add(shift(today, -6), '20:00', HOME, RESTAURANT, 'ville', 'completed', 15.2);
// À venir : un départ en avion
add(shift(today, 5), '05:45', HOME, AIRPORT, 'aeroport', 'confirmed');
add(shift(today, 9), '19:30', HOME, RESTAURANT, 'ville', 'pending');

db.data.counters.booking = db.data.bookings.length;
await db.save();
console.log(`Démo prête : ${db.data.bookings.length} courses, ${db.data.invoices.length} factures.`);
console.log('Connexion : claire.martin@exemple.fr / demo-taxi-2026');
