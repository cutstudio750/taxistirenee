// Analyse des habitudes de déplacement d'un client, à partir de ses réservations.
// Déterministe : sert de base à l'assistant (avec ou sans modèle de langage).
import { config } from './config.js';

export const SERVICES = {
  ville: 'Course en ville',
  aeroport: 'Aéroport',
  gare: 'Gare',
  conventionne: 'Transport conventionné',
  longue: 'Longue distance',
  dispo: 'Mise à disposition',
};

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WEEKDAYS_PLURAL = ['dimanches', 'lundis', 'mardis', 'mercredis', 'jeudis', 'vendredis', 'samedis'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const KNOWN_PLACES = [
  { test: (k) => k.includes('exupery') && !k.includes('gare'), name: 'Aéroport Lyon Saint-Exupéry', category: 'aeroport' },
  { test: (k) => k.includes('exupery') && k.includes('gare'), name: 'Gare Lyon Saint-Exupéry TGV', category: 'gare' },
  { test: (k) => k.includes('part dieu') && (k.includes('gare') || k.includes('sncf')), name: 'Gare Part-Dieu', category: 'gare' },
  { test: (k) => k.includes('perrache') && !k.includes('cours'), name: 'Gare de Perrache', category: 'gare' },
  { test: (k) => k.includes('jean mace') && k.includes('gare'), name: 'Gare Jean Macé', category: 'gare' },
  { test: (k) => k.includes('herriot'), name: 'Hôpital Édouard Herriot', category: 'sante' },
  { test: (k) => k.includes('lyon sud'), name: 'Centre hospitalier Lyon Sud', category: 'sante' },
  { test: (k) => k.includes('leon berard') || k.includes('berard'), name: 'Centre Léon Bérard', category: 'sante' },
  { test: (k) => k.includes('croix rousse') && (k.includes('hopital') || k.includes('hospitalier')), name: 'Hôpital de la Croix-Rousse', category: 'sante' },
  { test: (k) => k.includes('femme mere enfant'), name: 'Hôpital Femme Mère Enfant', category: 'sante' },
  { test: (k) => k.includes('louis pradel') || k.includes('cardiologique'), name: 'Hôpital Louis Pradel', category: 'sante' },
  { test: (k) => k.includes('wertheimer') || k.includes('neurologique'), name: 'Hôpital Pierre Wertheimer', category: 'sante' },
  { test: (k) => k.includes('saint joseph saint luc'), name: 'Hôpital Saint Joseph Saint-Luc', category: 'sante' },
  { test: (k) => k.includes('jean mermoz'), name: 'Hôpital privé Jean Mermoz', category: 'sante' },
  { test: (k) => k.includes('medipole'), name: 'Médipôle Lyon-Villeurbanne', category: 'sante' },
  { test: (k) => k.includes('sauvegarde'), name: 'Clinique de la Sauvegarde', category: 'sante' },
  { test: (k) => k.includes('pierre garraud'), name: 'Hôpital Pierre Garraud', category: 'sante' },
  { test: (k) => k.includes('charpennes'), name: 'Hôpital des Charpennes', category: 'sante' },
  { test: (k) => k.includes('infirmerie protestante'), name: 'Infirmerie Protestante', category: 'sante' },
  { test: (k) => /\b(hopital|clinique|dialyse|aural|chu|centre hospitalier)\b/.test(k), name: null, category: 'sante' },
];

export function normalizePlace(label = '') {
  return String(label)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bfrance\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function describePlace(label, savedAddresses = []) {
  const key = normalizePlace(label);
  const saved = savedAddresses.find((a) => normalizePlace(a.address) === key);
  const known = KNOWN_PLACES.find((p) => p.test(key));
  const short = String(label).split(/,|\b\d{5}\b/)[0].trim() || String(label);
  return {
    key,
    name: saved ? saved.label : known?.name || short,
    category: known?.category || null,
    address: label,
  };
}

export function parisToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const toMinutes = (time) => { const [h, m] = String(time || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function formatTime(minutes) {
  const rounded = Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return { label: m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`, value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

export function formatDate(date, { withYear = false } = {}) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}

function listFr(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

const ACTIVE = new Set(['pending', 'confirmed', 'completed']);

export function computeInsights(user, bookings, invoices, now = new Date()) {
  const saved = user.addresses || [];
  const today = parisToday(now);
  const trips = bookings
    .filter((b) => ACTIVE.has(b.status) && b.date)
    .map((b) => ({ ...b, fromP: describePlace(b.pickup, saved), toP: describePlace(b.dropoff, saved), minutes: toMinutes(b.time) }))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  const past = trips.filter((t) => t.date < today.date || (t.date === today.date && (t.minutes ?? 0) <= today.minutes));
  const upcoming = trips.filter((t) => !past.includes(t) && t.status !== 'completed');
  const month = today.date.slice(0, 7);
  const prevMonthDate = new Date(`${month}-15T12:00:00Z`); prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const year = today.date.slice(0, 4);

  // ── Lieux les plus fréquents (départ + arrivée) ───────────────────
  const placeMap = new Map();
  for (const t of trips) {
    for (const p of [t.fromP, t.toP]) {
      const entry = placeMap.get(p.key) || { ...p, count: 0 };
      entry.count += 1;
      placeMap.set(p.key, entry);
    }
  }
  const places = [...placeMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  // ── Trajets récurrents ───────────────────────────────────────────
  const routeMap = new Map();
  for (const t of trips) {
    const key = `${t.fromP.key}→${t.toP.key}`;
    const r = routeMap.get(key) || { key, from: t.fromP, to: t.toP, service: t.service, trips: [] };
    r.trips.push(t);
    routeMap.set(key, r);
  }

  const routes = [];
  for (const r of routeMap.values()) {
    const n = r.trips.length;
    if (n < 2) continue;
    const dates = r.trips.map((t) => t.date);
    const mins = r.trips.map((t) => t.minutes).filter((m) => m !== null);
    const time = mins.length ? median(mins) : null;
    const timeSpread = mins.length ? median(mins.map((m) => Math.abs(m - time))) : 999;
    const wdCount = Array(7).fill(0);
    dates.forEach((d) => { wdCount[weekday(d)] += 1; });
    const dominant = wdCount.map((c, i) => ({ c, i })).filter((x) => x.c >= 2).map((x) => x.i);
    const coverage = dominant.reduce((s, i) => s + wdCount[i], 0) / n;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter((g) => g > 0);
    const gap = gaps.length ? median(gaps) : null;
    const gapSpread = gaps.length ? median(gaps.map((g) => Math.abs(g - gap))) : 99;
    const lastDate = dates.at(-1);
    const recent = daysBetween(lastDate, today.date) <= 45;

    let pattern = null;
    if (n >= 3 && dominant.length && dominant.length <= 3 && coverage >= 0.7 && (gap === null || gap <= 9)) {
      pattern = { kind: 'weekly', weekdays: dominant };
    } else if (n >= 3 && gap !== null && gap >= 12 && gap <= 16 && gapSpread <= 2) {
      pattern = { kind: 'biweekly', weekdays: [weekday(lastDate)], gap: 14 };
    } else if (n >= 3 && gap !== null && gap >= 26 && gap <= 33 && gapSpread <= 4) {
      pattern = { kind: 'monthly', weekdays: [weekday(lastDate)], gap: 30 };
    }

    const timeInfo = time !== null && timeSpread <= 45 ? formatTime(time) : null;
    let label;
    if (pattern?.kind === 'weekly') {
      label = pattern.weekdays.length === 1
        ? `Chaque ${WEEKDAYS[pattern.weekdays[0]]}`
        : `Les ${listFr(pattern.weekdays.map((i) => WEEKDAYS_PLURAL[i]))}`;
    } else if (pattern?.kind === 'biweekly') {
      label = `Un ${WEEKDAYS[pattern.weekdays[0]]} sur deux`;
    } else if (pattern?.kind === 'monthly') {
      label = 'Environ une fois par mois';
    } else {
      label = `${n} fois`;
    }
    if (timeInfo) label += ` vers ${timeInfo.label}`;

    // Prochaine occurrence probable et vérification qu'elle est déjà réservée
    let next = null;
    if (pattern && recent) {
      let candidate = null;
      if (pattern.kind === 'weekly') {
        for (let i = 0; i <= 7 && !candidate; i += 1) {
          const d = addDays(today.date, i);
          const lateToday = i === 0 && timeInfo && toMinutes(timeInfo.value) <= today.minutes + 60;
          if (pattern.weekdays.includes(weekday(d)) && !lateToday) candidate = d;
        }
      } else {
        candidate = addDays(lastDate, pattern.gap);
        while (candidate < today.date) candidate = addDays(candidate, pattern.gap);
      }
      if (candidate) {
        const booked = upcoming.some((t) => t.date === candidate && `${t.fromP.key}→${t.toP.key}` === r.key);
        next = { date: candidate, time: timeInfo?.value || '', label: formatDate(candidate), booked };
      }
    }

    routes.push({
      from: r.from.name, fromAddress: r.from.address, to: r.to.name, toAddress: r.to.address,
      service: r.service, count: n, regular: Boolean(pattern), active: recent, pattern: pattern?.kind || null,
      label, time: timeInfo?.value || null, lastDate, next,
    });
  }
  routes.sort((a, b) => Number(b.regular && b.active) - Number(a.regular && a.active) || b.count - a.count);

  // ── Créneaux horaires ────────────────────────────────────────────
  const slots = { 'tôt le matin (avant 7 h)': 0, 'le matin': 0, "l'après-midi": 0, 'le soir': 0, 'la nuit': 0 };
  for (const t of trips) {
    if (t.minutes === null) continue;
    const h = t.minutes / 60;
    if (h >= 5 && h < 7) slots['tôt le matin (avant 7 h)'] += 1;
    else if (h >= 7 && h < 12) slots['le matin'] += 1;
    else if (h >= 12 && h < 18) slots["l'après-midi"] += 1;
    else if (h >= 18 && h < 23) slots['le soir'] += 1;
    else slots['la nuit'] += 1;
  }
  const topSlot = Object.entries(slots).sort((a, b) => b[1] - a[1])[0];
  const wdAll = Array(7).fill(0);
  trips.forEach((t) => { wdAll[weekday(t.date)] += 1; });
  const topWeekday = wdAll.indexOf(Math.max(...wdAll));

  // ── Chiffres ─────────────────────────────────────────────────────
  const completed = trips.filter((t) => t.status === 'completed');
  const due = (inv) => (inv.medical ? inv.patientShare || 0 : inv.amountTTC || 0);
  const totals = {
    rides: trips.length,
    completed: completed.length,
    upcoming: upcoming.length,
    thisMonth: trips.filter((t) => t.date.startsWith(month)).length,
    lastMonth: trips.filter((t) => t.date.startsWith(prevMonth)).length,
    medical: trips.filter((t) => t.service === 'conventionne').length,
    airportTrain: trips.filter((t) => ['aeroport', 'gare'].includes(t.service) || ['aeroport', 'gare'].includes(t.toP.category) || ['aeroport', 'gare'].includes(t.fromP.category)).length,
    spentYear: Math.round(invoices.filter((i) => i.issuedAt.startsWith(year)).reduce((s, i) => s + due(i), 0) * 100) / 100,
    spentMonth: Math.round(invoices.filter((i) => i.issuedAt.startsWith(month)).reduce((s, i) => s + due(i), 0) * 100) / 100,
    invoices: invoices.length,
    since: trips[0]?.date || null,
  };

  // ── Fidélité (les transports conventionnés ne cumulent pas) ─────
  const eligible = completed.filter((t) => t.service !== 'conventionne').length;
  const step = config.loyalty.step;
  const earned = Math.floor(eligible / step);
  const redeemed = user.loyalty?.redeemed || 0;
  const loyalty = {
    step, reward: config.loyalty.reward, eligible,
    progress: eligible % step, toNext: step - (eligible % step),
    available: Math.max(0, earned - redeemed), redeemed,
    level: eligible >= 30 ? 'Privilège' : eligible >= 10 ? 'Habitué' : 'Membre',
  };

  // ── Suggestions concrètes ────────────────────────────────────────
  const suggestions = [];
  const pending = routes.filter((x) => x.regular && x.active && x.next && !x.next.booked);
  const used = new Set();
  for (const r of pending) {
    if (used.has(r) || suggestions.length >= 2) continue;
    used.add(r);
    // Le retour du même jour (trajet inverse, plus tard) est proposé avec l'aller
    const back = pending.find((x) => !used.has(x) && x.fromAddress === r.toAddress && x.toAddress === r.fromAddress && x.next.date === r.next.date && (x.time || '') > (r.time || ''));
    if (back) used.add(back);
    const at = (t) => (t ? formatTime(toMinutes(t)).label : '');
    suggestions.push({
      id: `route-${r.from}-${r.to}`,
      title: `Votre trajet du ${r.next.label}`,
      text: back
        ? `${r.from} → ${r.to} vers ${at(r.time)}, retour vers ${at(back.time)}. ${r.label.split(' vers ')[0]}, et ce créneau n'est pas encore réservé.`
        : `${r.from} → ${r.to}${r.time ? `, vers ${at(r.time)}` : ''}. ${r.label.charAt(0).toUpperCase() + r.label.slice(1)}, et ce créneau n'est pas encore réservé.`,
      action: { kind: 'book', label: back ? "Préparer l'aller-retour" : 'Préparer la réservation', from: r.fromAddress, to: r.toAddress, date: r.next.date, time: r.time || '', service: r.service || '', returnTime: back?.time || '' },
    });
  }
  const departure = upcoming.find((t) => ['aeroport', 'gare'].includes(t.toP.category) && !t.returnTrip);
  if (departure) {
    const hasReturn = upcoming.some((t) => t.fromP.key === departure.toP.key && t.date >= departure.date);
    if (!hasReturn) {
      suggestions.push({
        id: `return-${departure.id}`,
        title: 'Et le retour ?',
        text: `Vous partez ${formatDate(departure.date)} vers ${departure.toP.name}. Réservez le retour maintenant, le chauffeur l'organisera avec votre aller.`,
        action: { kind: 'book', label: 'Réserver le retour', from: departure.dropoff, to: departure.pickup, date: '', time: '', service: departure.service },
      });
    }
  }
  const unsaved = places.find((p) => p.count >= 3 && !p.category && !saved.some((a) => normalizePlace(a.address) === p.key));
  if (unsaved) {
    suggestions.push({
      id: `save-${unsaved.key}`,
      title: 'Une adresse à enregistrer',
      text: `« ${unsaved.name} » revient dans ${unsaved.count} trajets. Enregistrez-la pour la sélectionner en un geste.`,
      action: { kind: 'save_address', label: "Enregistrer l'adresse", address: unsaved.address },
    });
  }
  if (loyalty.available > 0) {
    suggestions.push({ id: 'loyalty-ready', title: 'Avantage fidélité disponible', text: `${loyalty.reward}. Il sera appliqué sur votre prochaine course (hors transport conventionné).`, action: null });
  } else if (eligible > 0 && loyalty.toNext <= 2) {
    suggestions.push({ id: 'loyalty-near', title: `Plus que ${loyalty.toNext} course${loyalty.toNext > 1 ? 's' : ''}`, text: `avant votre avantage fidélité : ${loyalty.reward}.`, action: null });
  }

  // ── Phrases de synthèse ──────────────────────────────────────────
  const highlights = [];
  if (totals.rides) {
    const since = totals.since ? ` depuis ${MONTHS[Number(totals.since.slice(5, 7)) - 1]} ${totals.since.slice(0, 4)}` : '';
    highlights.push(`${totals.rides} trajet${totals.rides > 1 ? 's' : ''} avec Taxi Saint-Irénée${since}.`);
    const regular = routes.filter((r) => r.regular && r.active);
    if (regular.length) highlights.push(`Trajet régulier : ${regular[0].from} → ${regular[0].to}, ${regular[0].label.charAt(0).toLowerCase()}${regular[0].label.slice(1)}.`);
    const notable = places.find((p) => p.count >= 2 && !saved.some((a) => normalizePlace(a.address) === p.key));
    if (notable) highlights.push(`Lieu le plus fréquent : ${notable.name} (${notable.count} passages).`);
    if (topSlot && topSlot[1] >= 2) highlights.push(`Vous voyagez surtout ${topSlot[0]}, souvent le ${WEEKDAYS[topWeekday]}.`);
  }

  return {
    generatedAt: now.toISOString(),
    today: today.date,
    totals,
    places: places.map(({ name, count, category, address }) => ({ name, count, category, address })),
    routes: routes.slice(0, 6),
    habits: { slot: topSlot?.[1] ? topSlot[0] : null, weekday: trips.length ? WEEKDAYS[topWeekday] : null },
    loyalty,
    suggestions: suggestions.slice(0, 4),
    highlights,
  };
}
