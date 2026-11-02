// Assistant de l'espace client.
// Avec une clé API Claude : réponses rédigées par le modèle à partir des données
// du client. Sans clé (ou en cas d'erreur) : réponses construites localement à
// partir de l'analyse des habitudes, pour que l'espace client reste utile.
import { config, hasAssistantKey } from './config.js';
import { SERVICES, formatDate, formatTime } from './insights.js';

let clientPromise = null;
async function getClient() {
  if (!hasAssistantKey()) return null;
  clientPromise ??= import('@anthropic-ai/sdk')
    .then(({ default: Anthropic }) => new Anthropic({ apiKey: config.anthropicKey || undefined, maxRetries: 1, timeout: 45_000 }))
    .catch((err) => { console.warn('[assistant] SDK Anthropic indisponible, mode intégré.', err.message); return null; });
  return clientPromise;
}

const ACTION_KINDS = ['book', 'trips', 'invoices', 'call'];

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string', description: 'Réponse au client, en français, 1 à 5 phrases, sans markdown.' },
    actions: {
      type: 'array',
      description: "0 à 3 boutons d'action proposés sous la réponse.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'label', 'from', 'to', 'date', 'time', 'returnTime', 'service'],
        properties: {
          kind: { type: 'string', enum: ACTION_KINDS },
          label: { type: 'string', description: 'Texte du bouton, 2 à 5 mots.' },
          from: { type: 'string', description: 'Adresse de départ complète pour kind=book, sinon chaîne vide.' },
          to: { type: 'string', description: "Adresse d'arrivée complète pour kind=book, sinon chaîne vide." },
          date: { type: 'string', description: 'AAAA-MM-JJ pour kind=book si connue, sinon chaîne vide.' },
          time: { type: 'string', description: 'HH:MM pour kind=book si connue, sinon chaîne vide.' },
          returnTime: { type: 'string', description: "HH:MM du retour le même jour si le client fait habituellement l'aller-retour, sinon chaîne vide." },
          service: { type: 'string', enum: ['', ...Object.keys(SERVICES)] },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `Tu es l'assistant de l'espace client de Taxi Saint-Irénée, un taxi conventionné haut de gamme à Lyon et dans la métropole depuis 2014. Le chauffeur conduit lui-même chaque client.

Ton rôle : aider le client à comprendre et gérer ses déplacements à partir de ses propres données (fournies plus bas) : habitudes, trajets réguliers, prochaines courses, factures, programme de fidélité. Tu peux préparer une réservation en proposant un bouton d'action ; le client la vérifie puis l'envoie lui-même.

Ce que tu sais du service :
- Une réservation en ligne est une demande : le chauffeur rappelle toujours le client pour confirmer l'horaire et les détails. Rien n'est confirmé tant qu'il n'a pas rappelé.
- Le site ne donne aucune estimation de prix. Le tarif d'un taxi est réglementé (compteur, tarif préfectoral) et le chauffeur le précise lors de son appel. Ne donne jamais de montant estimé pour une course future.
- Transport conventionné : il faut une prescription médicale de transport établie avant le trajet, la carte Vitale et, selon le cas, la convocation. La prise en charge dépend de la situation du patient ; l'Assurance Maladie décide, pas le taxi. Ces courses ne cumulent pas de points de fidélité.
- Fidélité : ${config.loyalty.step} courses (hors conventionné) donnent droit à : ${config.loyalty.reward}.
- Pour toute urgence, modification le jour même ou annulation tardive : appeler le ${config.phoneDisplay}.

Règles :
- Réponds en français, en vouvoyant, de façon brève et concrète (1 à 5 phrases). Pas de markdown, pas d'émoji, pas de formules creuses.
- Appuie-toi uniquement sur les données fournies. Si une information manque, dis-le simplement.
- Pas de conseil médical. Pas de sujet sans rapport avec les déplacements du client ou le service de taxi : recentre poliment.
- Quand tu identifies un trajet à réserver, propose une action kind="book" avec les adresses complètes telles qu'elles figurent dans l'historique, la date (AAAA-MM-JJ) et l'heure (HH:MM) si elles sont connues.
- Utilise kind="invoices" pour renvoyer vers les factures, kind="trips" vers la liste des trajets, kind="call" pour appeler le chauffeur. Les champs inutiles restent des chaînes vides.`;

function clientContext(user, bookings, invoices, insights) {
  const trips = bookings.slice(-60).map((b) => ({
    ref: b.ref, date: b.date, heure: b.time, depart: b.pickup, arrivee: b.dropoff,
    service: SERVICES[b.service] || b.service, statut: b.status, retour: b.returnTrip ? (b.returnTrip.tbd ? `${b.returnTrip.date} heure à convenir` : `${b.returnTrip.date} ${b.returnTrip.time}`) : null, heure_type: b.timeKind === 'rdv' ? 'heure du rendez-vous médical' : 'heure de prise en charge',
  }));
  const factures = invoices.slice(-40).map((i) => ({
    numero: i.number, date: i.issuedAt.slice(0, 10), trajet: `${i.pickup} → ${i.dropoff}`,
    montant_ttc: i.amountTTC, reste_a_charge: i.medical ? i.patientShare : i.amountTTC, conventionne: i.medical,
  }));
  return JSON.stringify({
    aujourdhui: insights.today,
    client: { prenom: user.firstName, adresses_enregistrees: (user.addresses || []).map((a) => ({ nom: a.label, adresse: a.address })) },
    analyse: { totaux: insights.totals, lieux_frequents: insights.places, trajets: insights.routes, habitudes: insights.habits, fidelite: insights.loyalty, suggestions: insights.suggestions.map((s) => `${s.title} : ${s.text}`) },
    trajets: trips,
    factures,
  });
}

function sanitizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return actions
    .filter((a) => a && ACTION_KINDS.includes(a.kind))
    .slice(0, 3)
    .map((a) => ({
      kind: a.kind, label: s(a.label, 40) || 'Ouvrir', from: s(a.from, 200), to: s(a.to, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : '', time: /^\d{2}:\d{2}$/.test(a.time) ? a.time : '',
      returnTime: /^\d{2}:\d{2}$/.test(a.returnTime) ? a.returnTime : '',
      service: Object.hasOwn(SERVICES, a.service) ? a.service : '',
    }));
}

export async function askAssistant({ user, bookings, invoices, insights, message, history }) {
  const client = await getClient();
  if (client) {
    try {
      const messages = [];
      for (const h of history.slice(-10)) {
        if (!h || typeof h.text !== 'string' || !['user', 'assistant'].includes(h.role)) continue;
        const last = messages.at(-1);
        if (last?.role === h.role) last.content += `\n${h.text.slice(0, 1500)}`;
        else messages.push({ role: h.role, content: h.text.slice(0, 1500) });
      }
      while (messages[0]?.role === 'assistant') messages.shift();
      if (messages.at(-1)?.role === 'user') messages.pop();
      messages.push({ role: 'user', content: message });

      const response = await client.beta.messages.create({
        model: config.assistantModel,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'text', text: `Données du client (JSON) :\n${clientContext(user, bookings, invoices, insights)}` },
        ],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages,
      });

      if (response.stop_reason === 'refusal') return localAnswer({ user, insights, message, bookings });
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const parsed = JSON.parse(text);
      if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) throw new Error('réponse vide');
      return { reply: parsed.reply.trim().slice(0, 2000), actions: sanitizeActions(parsed.actions), engine: 'claude' };
    } catch (err) {
      console.error('[assistant] appel Claude en échec, réponse intégrée.', err?.status || '', err?.message || err);
    }
  }
  return localAnswer({ user, insights, message, bookings });
}

// ── Réponses intégrées (sans modèle) ─────────────────────────────────
const has = (text, ...words) => words.some((w) => text.includes(w));

export function localAnswer({ user, insights, message, bookings }) {
  const q = String(message).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const { totals, routes, places, loyalty, suggestions } = insights;
  const regular = routes.filter((r) => r.regular && r.active);
  const euro = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const actions = [];

  if (!totals.rides && !has(q, 'fidel', 'conventionn', 'cpam', 'bon de transport')) {
    return {
      reply: `Vous n'avez pas encore de trajet enregistré${user.firstName ? `, ${user.firstName}` : ''}. Dès vos premières courses, je repère vos habitudes, vos trajets réguliers et je vous propose de les réserver en un geste.`,
      actions: [{ kind: 'book', label: 'Réserver une course', from: '', to: '', date: '', time: '', service: '' }],
      engine: 'local',
    };
  }

  if (has(q, 'reserv', 'commande', 'habituel', "d'habitude", 'comme d', 'meme trajet', 'prochain trajet regulier')) {
    const ready = suggestions.find((x) => x.action?.kind === 'book' && x.id.startsWith('route-'));
    if (ready) {
      return { reply: `${ready.title} : ${ready.text} Je vous prépare la demande ; vérifiez-la puis envoyez-la, le chauffeur vous rappellera pour confirmer.`, actions: [ready.action], engine: 'local' };
    }
    const target = regular.find((r) => r.next && !r.next.booked) || regular[0];
    if (target) {
      const when = target.next ? `${target.next.label}${target.time ? ` à ${formatTime(toMin(target.time)).label}` : ''}` : 'la date de votre choix';
      actions.push({ kind: 'book', label: 'Préparer la réservation', from: target.fromAddress, to: target.toAddress, date: target.next?.date || '', time: target.time || '', service: target.service || '' });
      return { reply: `Je vous prépare votre trajet habituel ${target.from} → ${target.to} pour ${when}. Vérifiez les informations puis envoyez la demande ; le chauffeur vous rappellera pour confirmer.`, actions, engine: 'local' };
    }
    const top = routes[0];
    if (top) actions.push({ kind: 'book', label: 'Reprendre ce trajet', from: top.fromAddress, to: top.toAddress, date: '', time: '', service: top.service || '' });
    actions.push({ kind: 'book', label: 'Nouvelle course', from: '', to: '', date: '', time: '', service: '' });
    return { reply: top ? `Votre trajet le plus fréquent est ${top.from} → ${top.to}. Je peux le préparer, il vous restera à choisir la date et l'heure.` : 'Je vous ouvre le formulaire de réservation.', actions, engine: 'local' };
  }

  if (has(q, 'factur', 'depens', 'cout', 'combien', 'montant', 'paye', 'euro', '€', 'budget')) {
    actions.push({ kind: 'invoices', label: 'Voir mes factures', from: '', to: '', date: '', time: '', service: '' });
    return {
      reply: `Ce mois-ci : ${euro(totals.spentMonth)} réglés. Depuis le début de l'année : ${euro(totals.spentYear)}, sur ${totals.invoices} facture${totals.invoices > 1 ? 's' : ''}. Pour les transports conventionnés, seul votre reste à charge est compté.`,
      actions, engine: 'local',
    };
  }

  if (has(q, 'prochain', 'a venir', 'prevu', 'demain', 'semaine')) {
    const upcoming = bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && b.date >= insights.today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    actions.push({ kind: 'trips', label: 'Voir mes trajets', from: '', to: '', date: '', time: '', service: '' });
    if (!upcoming.length) {
      const s = suggestions.find((x) => x.action?.kind === 'book');
      if (s) actions.unshift(s.action);
      return { reply: `Aucune course n'est prévue pour le moment.${s ? ` ${s.title} : ${s.text}` : ''}`, actions, engine: 'local' };
    }
    const n = upcoming[0];
    const status = n.status === 'confirmed' ? 'confirmée' : 'en attente du rappel du chauffeur';
    return { reply: `Prochaine course : ${formatDate(n.date)}${n.time ? ` à ${n.time.replace(':', ' h ')}` : ''}, ${n.pickup} → ${n.dropoff} (${status}).${upcoming.length > 1 ? ` ${upcoming.length - 1} autre${upcoming.length > 2 ? 's' : ''} course${upcoming.length > 2 ? 's sont prévues' : ' est prévue'} ensuite.` : ''}`, actions, engine: 'local' };
  }

  if (has(q, 'fidel', 'point', 'avantage', 'remise', 'carte')) {
    const txt = loyalty.available > 0
      ? `Vous avez ${loyalty.available} avantage${loyalty.available > 1 ? 's' : ''} disponible${loyalty.available > 1 ? 's' : ''} : ${loyalty.reward}.`
      : `Vous en êtes à ${loyalty.progress} course${loyalty.progress > 1 ? 's' : ''} sur ${loyalty.step}. Encore ${loyalty.toNext} avant : ${loyalty.reward}.`;
    return { reply: `${txt} Les transports conventionnés ne sont pas comptés.`, actions, engine: 'local' };
  }

  if (has(q, 'conventionn', 'cpam', 'bon de transport', 'prescription', 'secu', 'hopital', 'medical', 'vitale')) {
    return {
      reply: `Pour un transport conventionné, munissez-vous de la prescription médicale de transport (établie avant le trajet), de votre carte Vitale et de votre convocation. ${totals.medical ? `Vous avez déjà effectué ${totals.medical} transport${totals.medical > 1 ? 's' : ''} conventionné${totals.medical > 1 ? 's' : ''} avec nous.` : ''} Pour des soins en série, le chauffeur peut planifier toutes les séances d'un coup.`.trim(),
      actions: [{ kind: 'book', label: 'Réserver un transport', from: '', to: '', date: '', time: '', service: 'conventionne' }],
      engine: 'local',
    };
  }

  if (has(q, 'annul', 'modifi', 'changer', 'decal', 'retard')) {
    return { reply: `Vous pouvez annuler une demande depuis l'onglet Trajets. Pour modifier un horaire ou annuler le jour même, le plus sûr est d'appeler le chauffeur au ${config.phoneDisplay}.`, actions: [{ kind: 'trips', label: 'Mes trajets', from: '', to: '', date: '', time: '', service: '' }, { kind: 'call', label: 'Appeler le chauffeur', from: '', to: '', date: '', time: '', service: '' }], engine: 'local' };
  }

  if (has(q, 'aeroport', 'gare', 'vol', 'train', 'exupery', 'part dieu', 'perrache')) {
    return { reply: totals.airportTrain ? `Vous avez fait ${totals.airportTrain} trajet${totals.airportTrain > 1 ? 's' : ''} vers ou depuis une gare ou l'aéroport. Indiquez votre numéro de vol ou de train lors de la réservation : le chauffeur suit l'horaire réel et adapte la prise en charge en cas de retard.` : "Indiquez votre numéro de vol ou de train lors de la réservation : le chauffeur suit l'horaire réel et adapte la prise en charge en cas de retard.", actions: [{ kind: 'book', label: 'Réserver', from: '', to: '', date: '', time: '', service: 'aeroport' }], engine: 'local' };
  }

  // Par défaut : synthèse des habitudes
  const lines = [];
  if (regular.length) lines.push(`Votre trajet régulier : ${regular[0].from} → ${regular[0].to}, ${regular[0].label.charAt(0).toLowerCase()}${regular[0].label.slice(1)}.`);
  else if (routes[0]) lines.push(`Votre trajet le plus fréquent : ${routes[0].from} → ${routes[0].to} (${routes[0].count} fois).`);
  const savedKeys = new Set((user.addresses || []).map((x) => x.address));
  const notable = places.find((p) => !savedKeys.has(p.address));
  if (notable) lines.push(`Lieu le plus fréquent : ${notable.name}.`);
  if (insights.habits.slot) lines.push(`Vous voyagez surtout ${insights.habits.slot}.`);
  lines.push(`${totals.thisMonth} trajet${totals.thisMonth > 1 ? 's' : ''} ce mois-ci, ${totals.lastMonth} le mois dernier.`);
  const s = suggestions.find((x) => x.action?.kind === 'book');
  if (s) { lines.push(`${s.title} : pas encore réservé.`); actions.push(s.action); }
  return { reply: lines.join(' '), actions, engine: 'local' };
}

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
