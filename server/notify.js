// Notifications : push sur le téléphone du chauffeur (ntfy) et e-mails (Resend).
// Chaque canal est facultatif ; l'espace /chauffeur liste toujours les demandes.
import { config } from './config.js';
import { SERVICES, formatDate } from './insights.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Envois en cours : sur Vercel, la réponse attend leur fin (la fonction s'arrête ensuite)
export const pending = new Set();
const track = (promise) => { pending.add(promise); promise.finally(() => pending.delete(promise)); return promise; };

function push(...args) { return track(pushNow(...args)); }
async function pushNow(title, body, { priority = 'high', click = `${config.siteUrl}/chauffeur`, tags = '' } = {}) {
  if (!config.ntfyUrl) return;
  try {
    await fetch(config.ntfyUrl, {
      method: 'POST',
      headers: { Title: encodeURIComponent(title), Priority: priority, Click: click, Tags: tags, 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn('[notify] ntfy en échec', err.message);
  }
}

export function sendMail(message) { return track(sendMailNow(message)); }
async function sendMailNow({ to, subject, html, text, replyTo }) {
  if (!config.resendKey || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.warn('[notify] e-mail refusé', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.warn('[notify] e-mail en échec', err.message);
    return false;
  }
}

function mailLayout(title, inner, lang = 'fr') {
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#F3EDE4;font-family:Jost,Helvetica,Arial,sans-serif;color:#161514">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
    <tr><td style="background:#161514;padding:28px 32px;text-align:center"><img src="${config.siteUrl}/assets/img/logo-creme.png" width="180" alt="Taxi Saint-Irénée" style="display:inline-block"></td></tr>
    <tr><td style="padding:32px">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8A7A66">${esc(title)}</p>
      ${inner}
      <p style="margin:28px 0 0;font-size:14px;color:#8A7A66">${lang === 'en' ? 'Any question: +33 6 61 88 27 07' : `Une question : ${config.phoneDisplay}`} · ${esc(config.contactEmail)}</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

const row = (k, v) => (v ? `<tr><td style="padding:6px 0;color:#8A7A66;font-size:14px;width:130px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:15px">${esc(v)}</td></tr>` : '');
const PRESC = { fr: { oui: 'oui', remise: 'à venir', non: 'non (course à ses frais)' }, en: { oui: 'yes', remise: 'to come', non: 'no (at own expense)' } };
const SERVICES_EN = { ville: 'City ride', aeroport: 'Airport', gare: 'Train station', conventionne: 'Medical transport', longue: 'Long distance', dispo: 'Chauffeur by the hour' };

function whenLine(b, lang = 'fr') {
  if (b.asap) return lang === 'en' ? 'As soon as possible' : 'Dès que possible';
  const d = formatDate(b.date, { withYear: true });
  if (lang === 'en') return `${new Date(`${b.date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ${b.timeKind === 'rdv' ? '— appointment at' : 'at'} ${b.time}`;
  return `${d} ${b.timeKind === 'rdv' ? '— rendez-vous à' : 'à'} ${b.time}`;
}

function bookingSummary(b, lang = 'fr') {
  const en = lang === 'en';
  const ret = b.returnTrip ? (b.returnTrip.tbd ? (en ? 'Return: time to agree' : 'Retour : heure à convenir') : `${b.returnTrip.date === b.date ? '' : formatDate(b.returnTrip.date) + ' '}${en ? 'at' : 'à'} ${b.returnTrip.time}`) : '';
  return [
    [en ? 'Service' : 'Service', en ? SERVICES_EN[b.service] : SERVICES[b.service] || b.service],
    [en ? 'When' : 'Date', whenLine(b, lang)],
    [en ? 'From' : 'Départ', b.pickup],
    [en ? 'To' : 'Arrivée', b.dropoff],
    [en ? 'Return' : 'Retour', ret],
    [en ? 'Estimate' : 'Estimation', b.estimate ? `≈ ${b.estimate.km} km · ${b.estimate.minutes} min (${en ? 'indicative' : 'indicatif'})` : ''],
    [en ? 'Passengers' : 'Passagers', `${b.passengers} · ${en ? 'luggage' : 'bagages'} : ${b.luggage}`],
    [en ? 'Prescription' : 'Prescription', b.medical ? `${PRESC[lang][b.medical.prescription] || ''}${b.medical.recurring ? (en ? ' · regular trips' : ' · transports réguliers') : ''}` : ''],
    [en ? 'Flight / train' : 'Vol / train', b.travelRef],
    [en ? 'Options' : 'Options', (b.options || []).join(', ')],
    [en ? 'Message' : 'Message', b.notes],
  ];
}

export function notifyNewBooking(b) {
  const when = b.asap ? 'DÈS QUE POSSIBLE' : `${formatDate(b.date)} ${b.timeKind === 'rdv' ? 'RDV ' : ''}${b.time}`;
  const lines = [
    `${when} · ${SERVICES[b.service] || b.service}`,
    `${b.pickup} → ${b.dropoff}`,
    `${b.contact.name} · ${b.contact.phone}${b.lang === 'en' ? ' · ANGLAIS' : ''}`,
    b.medical ? `Prescription : ${PRESC.fr[b.medical.prescription]}${b.medical.recurring ? ' · transports réguliers' : ''}` : '',
    b.returnTrip ? `Retour : ${b.returnTrip.tbd ? 'heure à convenir' : b.returnTrip.time}` : '',
    b.notes ? `« ${b.notes} »` : '',
  ].filter(Boolean);
  push(`Nouvelle demande ${b.ref}`, lines.join('\n'), { tags: 'taxi', priority: b.asap ? 'urgent' : 'high' });
  if (config.driverEmail) {
    const dateFr = b.asap ? 'départ immédiat' : new Date(`${b.date}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    sendMail({
      to: config.driverEmail,
      replyTo: b.contact.email || undefined,
      subject: `[NOUVELLE RÉSERVATION] Taxi Saint-Irénée — ${dateFr}${b.asap ? '' : ` ${b.time}`} · ${b.ref}`,
      text: [`Numéro de réservation : ${b.ref}`, ...lines, b.contact.email ? `E-mail : ${b.contact.email}` : '', `Demande reçue le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`].filter(Boolean).join('\n'),
      html: mailLayout(`Nouvelle demande ${b.ref}`, `<h1 style="font-size:22px;margin:0 0 6px">${esc(b.contact.name)}</h1>
        <p style="margin:0 0 18px;font-size:16px"><a href="tel:${esc(b.contact.phone)}" style="color:#161514">${esc(b.contact.phone)}</a>${b.contact.email ? ` · <a href="mailto:${esc(b.contact.email)}" style="color:#161514">${esc(b.contact.email)}</a>` : ''}${b.lang === 'en' ? ' · <strong>client anglophone</strong>' : ''}</p>
        <table role="presentation" width="100%">${bookingSummary(b).map(([k, v]) => row(k, v)).join('')}</table>
        <p style="margin:24px 0 0"><a href="${config.siteUrl}/chauffeur" style="display:inline-block;background:#161514;color:#F3EDE4;padding:12px 20px;border-radius:999px;text-decoration:none">Ouvrir l'espace chauffeur</a></p>
        <p style="margin:14px 0 0;font-size:13px;color:#8A7A66">Répondre à cet e-mail écrit directement au client.</p>`),
    });
  }
}

export function notifyClientReceived(b) {
  if (!b.contact.email) return;
  const en = b.lang === 'en';
  const first = esc(b.contact.name.split(' ')[0]);
  const medicalNote = b.medical ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${en ? 'On the day, bring your medical transport prescription and your Carte Vitale.' : 'Le jour du transport, munissez-vous de votre prescription médicale de transport et de votre carte Vitale.'}</p>` : '';
  sendMail({
    to: b.contact.email,
    replyTo: config.contactEmail,
    subject: en ? `Request received · ${b.ref}` : `Demande reçue · ${b.ref}`,
    text: en
      ? `Hello ${b.contact.name},\n\nYour request ${b.ref} has been received. The driver will call you back on ${b.contact.phone} to confirm the ride.\n\nTaxi Saint-Irénée · +33 6 61 88 27 07`
      : `Bonjour ${b.contact.name},\n\nVotre demande ${b.ref} est bien reçue. Le chauffeur vous rappelle au ${b.contact.phone} pour confirmer la course.\n\nTaxi Saint-Irénée · ${config.phoneDisplay}`,
    html: mailLayout(en ? 'Request received' : 'Demande reçue', `<h1 style="font-size:22px;margin:0 0 12px">${en ? `Thank you ${first}.` : `Merci ${first}.`}</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6">${en
        ? `Your request <strong>${esc(b.ref)}</strong> has been received. The driver will call you back on ${esc(b.contact.phone)} to confirm the time and details. The ride is only confirmed after this call.`
        : `Votre demande <strong>${esc(b.ref)}</strong> est bien reçue. Le chauffeur vous rappelle au ${esc(b.contact.phone)} pour confirmer l'horaire et les détails. La course n'est confirmée qu'après cet appel.`}</p>
      ${medicalNote}
      <table role="presentation" width="100%">${bookingSummary(b, b.lang).map(([k, v]) => row(k, v)).join('')}</table>`, b.lang),
  });
}

export function notifyClientConfirmed(b) {
  if (!b.contact.email) return;
  const en = b.lang === 'en';
  sendMail({
    to: b.contact.email,
    replyTo: config.contactEmail,
    subject: en ? `Ride confirmed · ${whenLine(b, 'en')}` : `Course confirmée · ${b.asap ? 'dès que possible' : `${formatDate(b.date)} à ${b.time}`}`,
    text: en ? `Your ride ${b.ref} is confirmed.\n${b.pickup} → ${b.dropoff}\n${b.driverNote || ''}` : `Votre course ${b.ref} est confirmée.\n${b.pickup} → ${b.dropoff}\n${b.driverNote || ''}`,
    html: mailLayout(en ? 'Ride confirmed' : 'Course confirmée', `<h1 style="font-size:22px;margin:0 0 12px">${en ? 'All set.' : 'C’est noté.'}</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6">${en ? `Your ride <strong>${esc(b.ref)}</strong> is confirmed.` : `Votre course <strong>${esc(b.ref)}</strong> est confirmée.`}${b.driverNote ? ` ${esc(b.driverNote)}` : ''}</p>
      <table role="presentation" width="100%">${bookingSummary(b, b.lang).map(([k, v]) => row(k, v)).join('')}</table>`, b.lang),
  });
}

export function notifyInvoice(invoice, link, email, name) {
  if (!email) return;
  sendMail({
    to: email,
    replyTo: config.contactEmail,
    subject: `Votre facture ${invoice.number}`,
    text: `Bonjour ${name},\n\nVotre facture ${invoice.number} est disponible : ${link}\n\nMerci et à bientôt.`,
    html: mailLayout(`Facture ${invoice.number}`, `<h1 style="font-size:22px;margin:0 0 12px">Merci pour ce trajet.</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6">${esc(invoice.pickup)} → ${esc(invoice.dropoff)}<br>Montant : ${invoice.amountTTC.toFixed(2).replace('.', ',')} € TTC</p>
      <p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#161514;color:#F3EDE4;padding:12px 20px;border-radius:999px;text-decoration:none">Voir la facture</a></p>`),
  });
}

export function notifyCancelled(b) {
  push(`Annulation ${b.ref}`, `${b.contact.name} a annulé : ${b.asap ? 'dès que possible' : `${formatDate(b.date)} ${b.time}`}\n${b.pickup} → ${b.dropoff}`, { tags: 'x', priority: 'high' });
  if (config.driverEmail) sendMail({ to: config.driverEmail, replyTo: b.contact.email || undefined, subject: `Annulation ${b.ref}`, text: `${b.contact.name} a annulé la course ${b.ref} (${b.date} ${b.time}).` });
}

export function notifyContact(msg) {
  push(`Message de ${msg.name}`, `${msg.phone || ''} ${msg.email || ''}\n${msg.message}`, { priority: 'default', tags: 'speech_balloon' });
  if (config.driverEmail) sendMail({ to: config.driverEmail, replyTo: msg.email || undefined, subject: `Message du site : ${msg.name}`, text: `${msg.name}\n${msg.phone || ''}\n${msg.email || ''}\n\n${msg.message}` });
}

export function sendResetMail(email, name, link) {
  return sendMail({
    to: email,
    subject: 'Réinitialisation de votre mot de passe',
    text: `Bonjour ${name},\n\nPour choisir un nouveau mot de passe : ${link}\nCe lien est valable une heure.`,
    html: mailLayout('Mot de passe', `<p style="font-size:15px;line-height:1.6">Bonjour ${esc(name)},<br>pour choisir un nouveau mot de passe, utilisez ce lien valable une heure.</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#161514;color:#F3EDE4;padding:12px 20px;border-radius:999px;text-decoration:none">Choisir un mot de passe</a></p>
      <p style="font-size:13px;color:#8A7A66">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`),
  });
}
