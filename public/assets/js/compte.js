import { api, getMe, toast, esc, icon, fmtDate, fmtTime, fmtEuro, fmtPhone, parisNow, showFieldError, clearFieldErrors } from './api.js';
import { attachAddress } from './address.js';
import { reveal } from './site.js';

const views = Object.fromEntries([...document.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v]));
const params = new URLSearchParams(location.search);
const STATUS = {
  pending: ['À confirmer', 'pending'], confirmed: ['Confirmée', 'confirmed'], completed: ['Effectuée', 'completed'],
  cancelled: ['Annulée', 'cancelled'], declined: ['Indisponible', 'declined'],
};
const SERVICES = { ville: 'Course en ville', aeroport: 'Aéroport', gare: 'Gare', conventionne: 'Transport conventionné', longue: 'Longue distance', dispo: 'Mise à disposition' };
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
let state = { user: null, bookings: [], invoices: [], insights: null, engine: 'local' };

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  document.body.classList.toggle('page-account--auth', name === 'auth');
}

function bookHref(a = {}) {
  const p = new URLSearchParams();
  if (a.service) p.set('service', a.service);
  if (a.from) p.set('from', a.from);
  if (a.to) p.set('to', a.to);
  if (a.date) p.set('date', a.date);
  if (a.time) p.set('time', a.time);
  if (a.returnTime) p.set('retour', a.returnTime);
  return `/reserver${p.toString() ? `?${p}` : ''}`;
}

function setAlert(form, message, ok = false) {
  const el = form.querySelector('[data-form-alert]');
  if (!el) return toast(message);
  el.textContent = message;
  el.classList.toggle('alert--ok', ok);
  el.hidden = !message;
}

async function submitForm(form, fn) {
  const btn = form.querySelector('[type="submit"]');
  clearFieldErrors(form);
  setAlert(form, '');
  btn?.setAttribute('aria-busy', 'true');
  try {
    await fn(Object.fromEntries(new FormData(form)));
  } catch (err) {
    if (!showFieldError(form, err)) setAlert(form, err.message);
  } finally {
    btn?.removeAttribute('aria-busy');
  }
}

// ══ Connexion / inscription ═════════════════════════════════════════
const forms = Object.fromEntries([...document.querySelectorAll('[data-form]')].map((f) => [f.dataset.form, f]));
const tabs = [...document.querySelectorAll('[data-auth-tab]')];
const pill = document.querySelector('.tabs__pill');

function authTab(name) {
  ['login', 'register', 'forgot', 'reset'].forEach((k) => { forms[k].hidden = k !== name; });
  tabs.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.authTab === name)));
  const active = tabs.find((t) => t.dataset.authTab === name);
  document.querySelector('.tabs').hidden = !active;
  if (active) {
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
  }
  forms[name].querySelector('input')?.focus({ preventScroll: true });
}
tabs.forEach((t) => t.addEventListener('click', () => authTab(t.dataset.authTab)));
document.querySelector('[data-forgot]').addEventListener('click', () => {
  forms.forgot.elements.email.value = forms.login.elements.email.value;
  authTab('forgot');
});
document.querySelector('[data-back-login]').addEventListener('click', () => authTab('login'));

function afterAuth(user) {
  if (params.get('retour') === 'reserver') { location.href = '/reserver'; return; }
  history.replaceState(null, '', '/compte#apercu');
  getMe({ refresh: true });
  startDash(user);
}

forms.login.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.login, async (d) => {
    const { user } = await api('/auth/login', { method: 'POST', body: { email: d.email, password: d.password } });
    afterAuth(user);
  });
});
forms.register.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.register, async (d) => {
    if (!forms.register.elements.consent.checked) throw Object.assign(new Error('Merci d’accepter la politique de données.'), { field: 'consent' });
    const { user } = await api('/auth/register', { method: 'POST', body: d });
    toast(`Bienvenue ${user.firstName}, votre compte est prêt.`);
    afterAuth(user);
  });
});
forms.forgot.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.forgot, async (d) => {
    const res = await api('/auth/forgot', { method: 'POST', body: { email: d.email } });
    setAlert(forms.forgot, res.mail
      ? 'Si un compte existe avec cette adresse, un e-mail vient de partir. Pensez à vérifier les indésirables.'
      : 'La réinitialisation par e-mail n’est pas encore disponible. Appelez le 06 61 88 27 07 : le chauffeur vous aidera.', true);
  });
});
forms.reset.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.reset, async (d) => {
    const { user } = await api('/auth/reset', { method: 'POST', body: { token: params.get('reinitialiser'), password: d.password } });
    toast('Mot de passe modifié.');
    afterAuth(user);
  });
});

// ══ Tableau de bord ════════════════════════════════════════════════
const panels = Object.fromEntries([...document.querySelectorAll('[data-panel]')].map((p) => [p.dataset.panel, p]));
const dashTabs = [...document.querySelectorAll('[data-tab]')];
const dashPill = document.querySelector('.dash-tabs__pill');

function moveDashPill() {
  const active = dashTabs.find((t) => t.getAttribute('aria-current') === 'page');
  if (!active) return;
  dashPill.style.width = `${active.offsetWidth}px`;
  dashPill.style.transform = `translateX(${active.offsetLeft}px)`;
  active.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}
function openTab(name, { scroll = false } = {}) {
  if (!panels[name]) name = 'apercu';
  for (const [k, p] of Object.entries(panels)) {
    p.hidden = k !== name;
    if (k === name) { p.classList.remove('is-entering'); void p.offsetWidth; p.classList.add('is-entering'); }
  }
  dashTabs.forEach((t) => (t.dataset.tab === name ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
  moveDashPill();
  if (name === 'assistant') initChat();
  if (scroll) document.querySelector('.dash-body').scrollIntoView({ behavior: 'smooth' });
}
addEventListener('hashchange', () => openTab(location.hash.slice(1)));
addEventListener('resize', moveDashPill);

async function loadData() {
  const [b, i, ins] = await Promise.all([api('/bookings'), api('/invoices'), api('/insights')]);
  state.bookings = b.bookings;
  state.invoices = i.invoices;
  state.insights = ins.insights;
  state.engine = ins.engine;
}

async function startDash(user) {
  state.user = user;
  show('dash');
  const hour = Number(parisNow().time.slice(0, 2));
  document.querySelector('[data-greeting]').textContent = `${hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour'} ${user.firstName}`;
  openTab(location.hash.slice(1) || 'apercu');
  fillProfile();
  try {
    await loadData();
  } catch (err) {
    if (err.status === 401) { show('auth'); authTab('login'); return; }
    toast(err.message);
  }
  renderAll();
}

function renderAll() {
  renderNextRide();
  renderLoyalty();
  renderStats();
  renderInsights();
  renderTrips();
  renderInvoices();
  renderHabits();
  reveal(document.querySelector('.dash-body'));
}

// ── Aperçu ──────────────────────────────────────────────────────────
const isUpcoming = (b) => ['pending', 'confirmed'].includes(b.status);
function upcoming() {
  const now = parisNow();
  return state.bookings.filter((b) => isUpcoming(b) && `${b.date}T${b.time}` >= `${now.date}T00:00`)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function renderNextRide() {
  const el = document.querySelector('[data-next-ride]');
  const next = upcoming()[0];
  if (!next) {
    el.innerHTML = `<div class="card next-ride next-ride--empty" data-reveal>
      <p class="caps muted">Prochaine course</p>
      <h2 class="h3 mt-2">Aucune course prévue.</h2>
      <p class="muted mt-1">Vos demandes et vos courses confirmées apparaîtront ici.</p>
      <a class="btn btn--noir mt-3" href="/reserver">Réserver une course</a></div>`;
    return;
  }
  const [label, cls] = STATUS[next.status];
  el.innerHTML = `<div class="card next-ride" data-reveal>
    <div class="next-ride__top"><p class="caps muted">Prochaine course</p><span class="badge badge--${cls}">${label}</span></div>
    <p class="next-ride__when">${next.asap ? 'Dès que possible' : `${esc(cap(fmtDate(next.date)))} <span class="nowrap">· ${esc(fmtTime(next.time))}</span>`}</p>
    <div class="route-line">
      <div><span class="route-line__dot"></span><p>${esc(next.pickup)}</p></div>
      <div><span class="route-line__dot route-line__dot--end"></span><p>${esc(next.dropoff)}</p></div>
    </div>
    <p class="muted mt-2">${esc(next.serviceLabel)} · ${esc(next.ref)}${next.status === 'pending' ? ' · Le chauffeur vous rappelle pour confirmer.' : ''}</p>
    ${next.driverNote ? `<p class="note mt-2">${icon('info')}<span>${esc(next.driverNote)}</span></p>` : ''}
    <div class="btn-row mt-3">
      <a class="btn btn--outline btn--sm" href="tel:+33661882707">${icon('phone', 'icon icon--sm')}Appeler</a>
      <button class="btn btn--quiet" type="button" data-cancel="${next.id}">Annuler la demande</button>
    </div></div>`;
}

function renderLoyalty() {
  const l = state.insights?.loyalty;
  const el = document.querySelector('[data-loyalty]');
  if (!l) { el.innerHTML = ''; return; }
  const stamps = Array.from({ length: l.step }, (_, i) => `<span class="stamp${i < l.progress ? ' is-on' : ''}"></span>`).join('');
  el.innerHTML = `<div class="loyalty-wrap on-noir" data-reveal>
    <div class="ambient" aria-hidden="true"><span class="ambient__halo ambient__halo--1"></span><span class="ambient__halo ambient__halo--4"></span></div>
    <div class="loyalty-card glass glass--dark">
      <div class="loyalty-card__top">
        <div><p class="loyalty-card__level">Carte fidélité · ${esc(l.level)}</p><p class="mt-1">${esc(state.user.firstName)} ${esc(state.user.lastName.charAt(0))}.</p></div>
        <img width="120" height="105" class="loyalty-card__mono" src="/assets/img/monogramme-creme.svg" alt="">
      </div>
      <div class="stamps" data-n="${l.step}" role="img" aria-label="${l.progress} courses sur ${l.step}">${stamps}</div>
      <div class="loyalty-card__foot"><span>${l.progress} sur ${l.step}</span><span>${l.available > 0 ? 'Avantage disponible' : `Encore ${l.toNext} course${l.toNext > 1 ? 's' : ''}`}</span></div>
    </div>
    <p class="loyalty-wrap__note">${l.available > 0 ? `${esc(l.reward)} : appliqué sur votre prochaine course.` : `Récompense : ${esc(l.reward)}.`} Hors transport conventionné.</p>
  </div>`;
}

function renderStats() {
  const t = state.insights?.totals;
  if (!t) return;
  const year = parisNow().date.slice(0, 4);
  document.querySelector('[data-stats]').innerHTML = [
    [t.thisMonth, 'trajets ce mois-ci'], [t.lastMonth, 'le mois dernier'], [fmtEuro(t.spentYear), `réglés en ${year}`], [t.invoices, `facture${t.invoices > 1 ? 's' : ''}`],
  ].map(([v, l], i) => `<div class="stat" data-reveal data-d="${i}"><strong class="tabular">${esc(v)}</strong><span>${esc(l)}</span></div>`).join('');
}

function actionButton(a, cls = 'btn btn--noir btn--sm') {
  if (!a) return '';
  if (a.kind === 'book') return `<a class="${cls}" href="${esc(bookHref(a))}">${esc(a.label)}${icon('arrow', 'icon icon--sm icon--move')}</a>`;
  if (a.kind === 'call') return `<a class="${cls}" href="tel:+33661882707">${icon('phone', 'icon icon--sm')}${esc(a.label)}</a>`;
  if (a.kind === 'invoices') return `<a class="${cls}" href="#factures">${esc(a.label)}</a>`;
  if (a.kind === 'trips') return `<a class="${cls}" href="#trajets">${esc(a.label)}</a>`;
  if (a.kind === 'save_address') return `<button class="${cls}" type="button" data-save-address="${esc(a.address)}">${esc(a.label)}</button>`;
  return '';
}

function renderInsights() {
  const ins = state.insights;
  const el = document.querySelector('[data-insights]');
  if (!ins) return;
  if (!ins.totals.rides) {
    el.innerHTML = `<div class="insights-empty card card--creme" data-reveal>
      ${icon('repeat', 'icon icon--lg')}
      <div><h2 class="h3">Votre assistant apprend avec vous.</h2>
      <p class="muted mt-1">Après quelques courses, il repère vos destinations fréquentes et vos trajets réguliers, et vous propose de les réserver au bon moment.</p></div></div>`;
    return;
  }
  const suggestions = ins.suggestions.map((s, i) => `<article class="suggestion" data-reveal data-d="${i}">
      <p class="suggestion__title">${esc(s.title)}</p><p class="muted">${esc(s.text)}</p>
      ${s.action ? `<div class="mt-2">${actionButton(s.action)}</div>` : ''}</article>`).join('');
  const routes = ins.routes.slice(0, 4).map((r) => `<li>
      <div><p class="route-name">${esc(r.from)} ${icon('arrow', 'icon icon--sm')} ${esc(r.to)}</p>
      <p class="muted">${esc(r.label)}${r.regular ? '' : ''} · ${r.count} trajet${r.count > 1 ? 's' : ''}</p></div>
      <a class="icon-btn icon-btn--light" href="${esc(bookHref({ from: r.fromAddress, to: r.toAddress, service: r.service, time: r.time || '' }))}" aria-label="Réserver à nouveau ${esc(r.from)} vers ${esc(r.to)}">${icon('repeat')}</a></li>`).join('');
  const max = Math.max(...ins.places.map((p) => p.count), 1);
  const places = ins.places.map((p) => `<li><div class="place-row"><span>${esc(p.name)}</span><span class="muted tabular">${p.count}</span></div><span class="bar"><span data-w="${(p.count / max).toFixed(3)}"></span></span></li>`).join('');
  el.innerHTML = `
    <div class="panel-head mt-5" data-reveal><div><span class="eyebrow">Assistant</span><h2 class="h3">Ce que vos trajets disent de vos habitudes</h2></div><a class="btn btn--outline btn--sm" href="#assistant">${icon('chat', 'icon icon--sm')}Poser une question</a></div>
    ${ins.highlights.length ? `<div class="highlights card" data-reveal>${ins.highlights.map((h) => `<p>${esc(h)}</p>`).join('')}</div>` : ''}
    ${suggestions ? `<div class="suggestions">${suggestions}</div>` : ''}
    <div class="habits-grid">
      ${routes ? `<div class="card" data-reveal><p class="caps muted">Trajets fréquents</p><ul class="route-list mt-2">${routes}</ul></div>` : ''}
      ${places ? `<div class="card" data-reveal><p class="caps muted">Lieux fréquents</p><ul class="place-list mt-2">${places}</ul></div>` : ''}
    </div>`;
}

// ── Trajets ─────────────────────────────────────────────────────────
function tripItem(b) {
  const [label, cls] = STATUS[b.status] || [b.status, 'completed'];
  const d = new Date(`${b.date}T12:00:00Z`);
  const now = parisNow();
  const future = `${b.date}T${b.time}` >= `${now.date}T${now.time}`;
  const actions = [
    isUpcoming(b) && future ? `<button class="btn btn--quiet" type="button" data-cancel="${b.id}">Annuler</button>` : '',
    b.invoice ? `<a class="btn btn--outline btn--sm" href="/facture?id=${encodeURIComponent(b.invoice.id)}">${icon('file', 'icon icon--sm')}Facture</a>` : '',
    `<a class="btn btn--quiet" href="${esc(bookHref({ from: b.pickup, to: b.dropoff, service: b.service, time: b.time }))}">${icon('repeat', 'icon icon--sm')}Refaire</a>`,
  ].join('');
  return `<li class="trip" data-reveal>
    <div class="trip__date"><strong>${d.getUTCDate()}</strong><span>${MONTHS_SHORT[d.getUTCMonth()]}</span></div>
    <div class="trip__main">
      <p class="trip__route"><span>${esc(b.pickup)}</span>${icon('arrow', 'icon icon--sm')}<span>${esc(b.dropoff)}</span></p>
      <p class="trip__meta">${esc(cap(fmtDate(b.date, { year: d.getUTCFullYear() !== new Date().getFullYear() })))} · ${b.timeKind === 'rdv' ? 'rendez-vous ' : ''}${fmtTime(b.time)} · ${esc(SERVICES[b.service] || '')} · ${esc(b.ref)}${b.returnTrip ? (b.returnTrip.tbd ? ' · retour à convenir' : ` · retour ${b.returnTrip.date === b.date ? '' : `${esc(fmtDate(b.returnTrip.date, { weekday: false }))} `}${fmtTime(b.returnTrip.time)}`) : ''}</p>
    </div>
    <div class="trip__side"><span class="badge badge--${cls}">${label}</span><div class="trip__actions">${actions}</div></div>
  </li>`;
}
function renderTrips() {
  const filter = document.querySelector('[name="tripfilter"]:checked').value;
  const now = parisNow();
  let list = state.bookings;
  if (filter === 'upcoming') list = upcoming();
  if (filter === 'past') list = list.filter((b) => !isUpcoming(b) || `${b.date}T${b.time}` < `${now.date}T00:00`);
  const el = document.querySelector('[data-trips]');
  el.innerHTML = list.length ? list.map(tripItem).join('') : `<li class="empty">${filter === 'upcoming' ? 'Aucune course à venir.' : 'Aucun trajet pour le moment.'} <a class="text-link" href="/reserver">Réserver une course</a></li>`;
  reveal(el);
}
document.querySelector('[data-trip-filter]').addEventListener('change', renderTrips);

document.addEventListener('click', async (e) => {
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) {
    if (!confirm('Annuler cette demande de course ?')) return;
    cancel.setAttribute('aria-busy', 'true');
    try {
      await api(`/bookings/${cancel.dataset.cancel}/cancel`, { method: 'POST' });
      toast('La course est annulée. Le chauffeur est prévenu.');
      await loadData();
      renderAll();
    } catch (err) { toast(err.message); cancel.removeAttribute('aria-busy'); }
  }
  const save = e.target.closest('[data-save-address]');
  if (save) {
    location.hash = 'profil';
    openAddressForm({ address: save.dataset.saveAddress });
  }
});

// ── Factures ────────────────────────────────────────────────────────
function renderInvoices() {
  const select = document.querySelector('[data-invoice-year]');
  const years = [...new Set(state.invoices.map((i) => i.issuedAt.slice(0, 4)))].sort().reverse();
  const current = select.value || years[0];
  select.innerHTML = years.map((y) => `<option${y === current ? ' selected' : ''}>${y}</option>`).join('');
  select.hidden = years.length < 2;
  const list = state.invoices.filter((i) => i.issuedAt.startsWith(current || ''));
  const el = document.querySelector('[data-invoices]');
  if (!state.invoices.length) {
    el.innerHTML = '<div class="card card--creme empty-card"><p>Vos factures apparaîtront ici après chaque course.</p></div>';
    return;
  }
  const total = list.reduce((s, i) => s + (i.medical ? i.patientShare || 0 : i.amountTTC), 0);
  el.innerHTML = `<div class="invoice-table card">
    <div class="invoice-row invoice-row--head"><span>Facture</span><span>Trajet</span><span>Montant</span><span></span></div>
    ${list.map((i) => `<a class="invoice-row" href="/facture?id=${encodeURIComponent(i.id)}">
      <span><strong>${esc(i.number)}</strong><small>${esc(fmtDate(i.serviceDate, { weekday: false, year: true }))}</small></span>
      <span class="invoice-row__route">${esc(i.pickup)} → ${esc(i.dropoff)}${i.medical ? '<small>Transport conventionné</small>' : ''}</span>
      <span class="tabular">${fmtEuro(i.amountTTC)}${i.medical ? `<small>Reste à charge ${fmtEuro(i.patientShare || 0)}</small>` : ''}</span>
      <span class="invoice-row__go">${icon('arrow', 'icon icon--sm')}</span></a>`).join('')}
    <div class="invoice-row invoice-row--total"><span>Total réglé ${esc(current)}</span><span></span><span class="tabular">${fmtEuro(total)}</span><span></span></div>
  </div>`;
}
document.querySelector('[data-invoice-year]').addEventListener('change', renderInvoices);

// ── Assistant ───────────────────────────────────────────────────────
const log = document.querySelector('[data-chat-log]');
const chatForm = document.querySelector('[data-chat-form]');
const CHAT_KEY = 'tsi-chat';
let chatHistory = [];
let chatReady = false;
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch { return []; } },
  set(v) { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(v.slice(-30))); } catch { /* indisponible */ } },
};

function bubble(role, text, actions = [], { animate = true } = {}) {
  const div = document.createElement('div');
  div.className = `msg msg--${role}${animate ? ' is-new' : ''}`;
  div.innerHTML = `<p>${esc(text)}</p>${actions.length ? `<div class="msg__actions">${actions.map((a) => actionButton(a, a.kind === 'book' ? 'btn btn--noir btn--sm' : 'btn btn--outline btn--sm')).join('')}</div>` : ''}`;
  log.append(div);
  log.scrollTo({ top: log.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
  return div;
}

function initChat() {
  if (chatReady || !state.insights) return;
  chatReady = true;
  const ins = state.insights;
  const intro = ins.totals.rides
    ? `Bonjour ${state.user.firstName}. ${ins.highlights.join(' ')} Que puis-je faire pour vous ?`
    : `Bonjour ${state.user.firstName}. Je suis l'assistant de votre espace. Dès vos premières courses, je repérerai vos habitudes et vos trajets réguliers. Vous pouvez déjà me poser vos questions sur le service.`;
  const firstBook = ins.suggestions.find((s) => s.action?.kind === 'book');
  bubble('assistant', intro, firstBook ? [firstBook.action] : [], { animate: false });
  chatHistory = session.get();
  for (const h of chatHistory) bubble(h.role, h.text, h.actions || [], { animate: false });
  const chips = ins.totals.rides
    ? ['Quelles sont mes habitudes ?', 'Réserve mon trajet habituel', 'Ma prochaine course ?', 'Combien ai-je dépensé ce mois-ci ?', 'Où en est ma fidélité ?']
    : ['Comment réserver ?', 'Que faut-il pour un transport conventionné ?', 'Comment fonctionne la fidélité ?'];
  document.querySelector('[data-chat-chips]').innerHTML = chips.map((c) => `<button type="button" class="chip chip--sm">${esc(c)}</button>`).join('');
}
document.querySelector('[data-chat-chips]').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { chatForm.elements.message.value = b.textContent; chatForm.requestSubmit(); }
});
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = chatForm.elements.message;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  bubble('user', message);
  const typing = document.createElement('div');
  typing.className = 'msg msg--assistant msg--typing is-new';
  typing.innerHTML = '<span></span><span></span><span></span>';
  typing.setAttribute('aria-label', 'L’assistant écrit');
  log.append(typing);
  log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  chatForm.querySelector('button').disabled = true;
  try {
    const res = await api('/assistant', { method: 'POST', body: { message, history: chatHistory.map(({ role, text }) => ({ role, text })) } });
    typing.remove();
    bubble('assistant', res.reply, res.actions || []);
    chatHistory.push({ role: 'user', text: message }, { role: 'assistant', text: res.reply, actions: res.actions || [] });
    session.set(chatHistory);
  } catch (err) {
    typing.remove();
    bubble('assistant', err.message);
  } finally {
    chatForm.querySelector('button').disabled = false;
  }
});

function renderHabits() {
  const ins = state.insights;
  const el = document.querySelector('[data-habits]');
  if (!ins) return;
  const regular = ins.routes.filter((r) => r.regular);
  el.innerHTML = `
    <div class="card">
      <p class="caps muted">Repéré par l'assistant</p>
      ${regular.length ? `<ul class="route-list mt-2">${regular.slice(0, 3).map((r) => `<li><div><p class="route-name">${esc(r.from)} ${icon('arrow', 'icon icon--sm')} ${esc(r.to)}</p><p class="muted">${esc(r.label)}</p>${r.next && !r.next.booked ? `<p class="next-chip">Prochain : ${esc(r.next.label)}</p>` : r.next?.booked ? '<p class="next-chip next-chip--ok">Prochain déjà réservé</p>' : ''}</div></li>`).join('')}</ul>` : '<p class="muted mt-2">Aucun trajet régulier pour l’instant. Il en faut au moins trois sur un même créneau.</p>'}
    </div>
    <div class="card card--creme">
      <p class="caps muted">Confidentialité</p>
      <p class="muted mt-1">L'assistant n'utilise que vos propres trajets et factures. ${state.engine === 'claude' ? 'Vos questions sont traitées par Claude (Anthropic), sans réutilisation à d’autres fins.' : 'L’analyse est faite sur le serveur du site.'}</p>
    </div>`;
}

// ── Profil ──────────────────────────────────────────────────────────
function fillProfile() {
  const u = state.user;
  const f = forms.profile.elements;
  f.firstName.value = u.firstName; f.lastName.value = u.lastName; f.email.value = u.email; f.phone.value = fmtPhone(u.phone);
  renderAddresses();
}
forms.profile.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.profile, async (d) => {
    const { user } = await api('/me', { method: 'PATCH', body: d });
    state.user = user;
    getMe({ refresh: true });
    document.querySelector('[data-greeting]').textContent = `Bonjour ${user.firstName}`;
    setAlert(forms.profile, 'Coordonnées enregistrées.', true);
  });
});

function renderAddresses() {
  const list = state.user.addresses || [];
  document.querySelector('[data-addresses]').innerHTML = list.length
    ? list.map((a) => `<li><span class="address-list__icon">${icon(a.label.toLowerCase().includes('domicile') ? 'home' : 'pin')}</span><div><strong>${esc(a.label)}</strong><p class="muted">${esc(a.address)}</p></div>
        <button class="icon-btn icon-btn--light" type="button" data-edit-address="${esc(a.id)}" aria-label="Modifier ${esc(a.label)}">${icon('edit')}</button>
        <button class="icon-btn icon-btn--light" type="button" data-del-address="${esc(a.id)}" aria-label="Supprimer ${esc(a.label)}">${icon('trash')}</button></li>`).join('')
    : '<li class="empty">Ajoutez votre domicile, votre travail ou votre cabinet médical pour réserver plus vite.</li>';
}
let editing = null;
function openAddressForm(a = {}) {
  editing = a.id || null;
  forms.address.hidden = false;
  forms.address.elements.label.value = a.label || (state.user.addresses?.length ? '' : 'Domicile');
  forms.address.elements.address.value = a.address || '';
  forms.address.elements[a.address ? 'label' : 'address'].focus();
}
async function saveAddresses(addresses) {
  const { user } = await api('/me', { method: 'PATCH', body: { addresses } });
  state.user = user;
  renderAddresses();
  getMe({ refresh: true });
}
document.querySelector('[data-add-address]').addEventListener('click', () => openAddressForm());
document.querySelector('[data-cancel-address]').addEventListener('click', () => { forms.address.hidden = true; });
document.querySelector('[data-addresses]').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit-address]');
  const del = e.target.closest('[data-del-address]');
  if (edit) openAddressForm(state.user.addresses.find((a) => a.id === edit.dataset.editAddress));
  if (del) {
    await saveAddresses(state.user.addresses.filter((a) => a.id !== del.dataset.delAddress)).catch((err) => toast(err.message));
    toast('Adresse supprimée.');
  }
});
forms.address.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.address, async (d) => {
    const list = [...(state.user.addresses || [])];
    const entry = { id: editing || undefined, label: d.label.trim(), address: d.address.trim() };
    if (!entry.label) throw Object.assign(new Error('Donnez un nom à cette adresse.'), { field: 'label' });
    if (entry.address.length < 3) throw Object.assign(new Error('Indiquez l’adresse.'), { field: 'address' });
    const i = list.findIndex((a) => a.id === editing);
    if (i >= 0) list[i] = entry; else list.push(entry);
    await saveAddresses(list);
    forms.address.hidden = true;
    toast('Adresse enregistrée.');
    api('/insights').then((r) => { state.insights = r.insights; renderInsights(); renderHabits(); }).catch(() => {});
  });
});
attachAddress(forms.address.elements.address);

forms.password.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.password, async (d) => {
    await api('/me/password', { method: 'POST', body: d });
    forms.password.reset();
    setAlert(forms.password, 'Mot de passe modifié.', true);
  });
});
document.querySelector('[data-logout]').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  try { sessionStorage.removeItem(CHAT_KEY); } catch { /* indisponible */ }
  location.href = '/';
});
document.querySelector('[data-delete-account]').addEventListener('click', () => {
  forms.delete.hidden = false;
  forms.delete.elements.password.focus();
});
forms.delete.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(forms.delete, async (d) => {
    await api('/me/delete', { method: 'POST', body: d });
    location.href = '/';
  });
});

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ══ Démarrage ══════════════════════════════════════════════════════
(async () => {
  if (params.get('reinitialiser')) {
    show('auth');
    authTab('reset');
    return;
  }
  const user = await getMe();
  if (user) startDash(user);
  else {
    show('auth');
    authTab(params.has('inscription') ? 'register' : 'login');
  }
})();
