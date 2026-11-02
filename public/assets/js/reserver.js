// Réservation en trois étapes (français et anglais).
// Reprend le parcours de l'ancien site : transport médical (heure du rendez-vous,
// prescription, aller-retour, transports réguliers), estimation indicative de distance
// et de durée, raccourcis de date, alerte de départ imminent, mémorisation des
// coordonnées, partage, agenda avec rappel, repli par téléphone ou e-mail.
// Version GitHub Pages (sans serveur) : la demande part par WhatsApp ou par e-mail, déjà rédigée.
import { api, getMe, toast, showFieldError, clearFieldErrors, fmtDate, fmtTime, parisNow, fmtPhone, esc, STATIC } from './api.js';
import { attachAddress, locate, PLACES } from './address.js';
import { t, lang } from './i18n.js';

const form = document.querySelector('[data-booking-form]');
const steps = [...form.querySelectorAll('[data-step]')];
const stepper = [...document.querySelectorAll('[data-stepper] li')];
const progress = document.querySelector('[data-progress]');
const announce = document.querySelector('[data-step-announce]');
const DRAFT_KEY = 'tsi-booking-draft';
const REMEMBER_KEY = 'tsi-contact';
const ROUTE_API = 'https://data.geopf.fr/navigation/itineraire';
const startedAt = Date.now();
let current = 1;
let user = null;
let estimate = null;
const coords = { pickup: null, dropoff: null };

const storage = (key) => ({
  get() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  clear() { try { localStorage.removeItem(key); } catch { /* idem */ } },
});
const draftStore = storage(DRAFT_KEY);
const contactStore = storage(REMEMBER_KEY);

const $ = (name) => form.elements[name];
const val = (name) => (form.elements[name]?.value || '').trim();
const q = (sel) => document.querySelector(sel);
const service = () => form.querySelector('[name="service"]:checked').value;
const isMedical = () => service() === 'conventionne';
const isAsap = () => form.querySelector('[name="when"]:checked').value === 'asap';
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── Dates ───────────────────────────────────────────────────────────
function isoPlus(days) {
  const d = new Date(`${parisNow().date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function minutesUntil() {
  if (isAsap() || !val('date') || !val('time')) return null;
  const now = parisNow();
  const [h, m] = val('time').split(':').map(Number);
  const [nh, nm] = now.time.split(':').map(Number);
  const days = Math.round((new Date(`${val('date')}T12:00:00Z`) - new Date(`${now.date}T12:00:00Z`)) / 86400000);
  return days * 1440 + (h * 60 + m) - (nh * 60 + nm);
}
function defaultDateTime() {
  const now = parisNow();
  const [h, m] = now.time.split(':').map(Number);
  let mins = Math.ceil((h * 60 + m + 120) / 5) * 5;
  let date = now.date;
  if (mins >= 1440) { mins -= 1440; date = isoPlus(1); }
  return { date, time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` };
}
$('date').min = isoPlus(0);
$('date').max = isoPlus(365);
$('returnDate').min = isoPlus(0);

// ── Compteurs passagers / bagages ───────────────────────────────────
function setCounter(name, value) {
  const box = form.querySelector(`[data-counter="${name}"]`);
  const min = Number(box.dataset.min); const max = Number(box.dataset.max);
  const v = Math.min(max, Math.max(min, Number(value) || min));
  const out = box.querySelector('output');
  out.value = v; out.textContent = v;
  box.querySelector('[data-dec]').disabled = v <= min;
  box.querySelector('[data-inc]').disabled = v >= max;
  return v;
}
form.querySelectorAll('[data-counter]').forEach((box) => {
  const name = box.dataset.counter;
  setCounter(name, box.querySelector('output').value);
  box.addEventListener('click', (e) => {
    const out = box.querySelector('output');
    if (e.target.closest('[data-inc]')) setCounter(name, Number(out.value) + 1);
    else if (e.target.closest('[data-dec]')) setCounter(name, Number(out.value) - 1);
    else return;
    out.animate?.([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    update();
  });
});

// ── Pré-remplissage : brouillon, paramètres d'URL, coordonnées mémorisées ─
const params = new URLSearchParams(location.search);
function applyValues(v) {
  if (!v) return;
  if (v.service && form.querySelector(`[name="service"][value="${v.service}"]`)) form.querySelector(`[name="service"][value="${v.service}"]`).checked = true;
  for (const k of ['pickup', 'dropoff', 'date', 'time', 'travelRef', 'notes', 'name', 'phone', 'email', 'returnDate', 'returnTime']) {
    if (v[k]) $(k).value = v[k];
  }
  if (v.when === 'asap') form.querySelector('[name="when"][value="asap"]').checked = true;
  if (v.roundtrip) $('roundtrip').checked = true;
  if (v.passengers) setCounter('passengers', v.passengers);
  if (v.luggage) setCounter('luggage', v.luggage);
  if (Array.isArray(v.options)) form.querySelectorAll('[name="options"]').forEach((o) => { o.checked = v.options.includes(o.value); });
  if (v.prescription) { const r = form.querySelector(`[name="prescription"][value="${v.prescription}"]`); if (r) r.checked = true; }
  if (v.recurring) $('recurring').checked = true;
  if (v.coords) Object.assign(coords, v.coords);
}
const fromUrl = ['service', 'from', 'to', 'date', 'time', 'retour'].some((k) => params.has(k));
const draft = draftStore.get();
if (draft && !fromUrl && Date.now() - (draft.savedAt || 0) < 3 * 86400000) applyValues(draft);
if (fromUrl) {
  applyValues({ service: params.get('service'), pickup: params.get('from'), dropoff: params.get('to'), date: params.get('date'), time: params.get('time') });
  if (/^\d{2}:\d{2}$/.test(params.get('retour') || '')) {
    $('roundtrip').checked = true;
    $('returnDate').value = params.get('date') || '';
    $('returnTime').value = params.get('retour');
  }
}
const def = defaultDateTime();
if (!val('date') || val('date') < isoPlus(0)) $('date').value = def.date;
if (!val('time')) $('time').value = def.time;
const remembered = contactStore.get();
if (remembered && !val('name')) {
  $('name').value = remembered.name || '';
  $('phone').value = remembered.phone || '';
  $('email').value = remembered.email || '';
  $('remember').checked = true;
}

// ── Téléphone : mise en forme automatique (06 12 34 56 78) ─────────
function formatPhone(raw) {
  const s = raw.replace(/[^\d+]/g, '');
  if (/^0\d{0,9}$/.test(s)) return s.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  if (/^\+33\d{0,9}$/.test(s)) return `+33 ${s.slice(3).replace(/^(\d)(\d{0,8})$/, (m, a, b) => `${a} ${b.replace(/(\d{2})(?=\d)/g, '$1 ')}`).trim()}`.trim();
  return raw;
}
$('phone').addEventListener('input', (e) => {
  const el = e.target;
  if (el.selectionStart !== el.value.length) return;
  const f = formatPhone(el.value);
  if (f !== el.value && (e.inputType || '').startsWith('insert')) el.value = f;
});
$('phone').addEventListener('blur', (e) => { e.target.value = formatPhone(e.target.value); });

// ── Libellés et champs selon le type de course ──────────────────────
function swapLabels() {
  const medical = isMedical();
  document.querySelectorAll('[data-label-default][data-label-medical]').forEach((el) => {
    const text = medical ? el.dataset.labelMedical : el.dataset.labelDefault;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.placeholder = text; else el.textContent = text;
  });
}
function syncConditional() {
  const svc = service();
  const medical = svc === 'conventionne';
  form.querySelectorAll('[data-show-for]').forEach((el) => { el.hidden = !el.dataset.showFor.split(' ').includes(svc); });
  const asap = isAsap();
  q('[data-when-fields]').hidden = asap;
  q('[data-asap-note]').hidden = !asap;
  const m = minutesUntil();
  q('[data-soon-note]').hidden = !(m !== null && m >= 0 && m < 120);
  q('[data-return-fields]').hidden = !$('roundtrip').checked;
  q('[data-return-date-field]').hidden = medical;
  q('[data-prescription-no]').hidden = !(medical && form.querySelector('[name="prescription"]:checked')?.value === 'non');
  // (la création de compte n'existe pas dans la version GitHub Pages)
  const create = Boolean($('createAccount')?.checked);
  const pwd = q('[data-password-field]');
  if (pwd) pwd.hidden = !create;
  q('[data-email-optional]').hidden = create;
  q('[data-remember-box]').hidden = Boolean(user) || create;
  document.querySelectorAll('[data-day]').forEach((c) => c.setAttribute('aria-pressed', String(val('date') === isoPlus(Number(c.dataset.day)))));
  swapLabels();
}

// ── Raccourcis d'adresses ──────────────────────────────────────────
// Un lieu d'aéroport ou de gare choisi pendant une « course en ville » adapte le service
function suggestService(place) {
  if (!place || service() !== 'ville') return;
  const next = { plane: 'aeroport', train: 'gare' }[place.icon];
  const radio = next && form.querySelector(`[name="service"][value="${next}"]`);
  if (!radio) return;
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderChips() {
  const saved = (user?.addresses || []).map((a) => ({ label: a.label, address: a.address }));
  const fill = (target, list) => {
    const box = q(`[data-chips="${target}"]`);
    box.innerHTML = list.map((p, i) => `<button type="button" class="chip chip--sm" data-i="${i}">${esc(p.label)}</button>`).join('');
    box.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = list[Number(b.dataset.i)];
      $(target).value = p.address;
      coords[target] = p.lonlat || null;
      clearFieldErrors(form);
      suggestService(p);
      update();
      updateEstimate();
    };
  };
  fill('pickup', saved.slice(0, 4));
  const popular = isMedical() ? PLACES.filter((p) => p.icon === 'medical') : PLACES.filter((p) => p.icon !== 'medical');
  fill('dropoff', [...saved.slice(0, 3), ...popular.slice(0, isMedical() ? 6 : 4)]);
}

// ── Estimation indicative : distance et durée (jamais de prix) ─────
let estCtrl = null;
async function updateEstimate() {
  estCtrl?.abort();
  const [a, b] = [coords.pickup, coords.dropoff];
  const box = q('[data-estimate]');
  if (!a || !b || (a[0] === b[0] && a[1] === b[1])) { estimate = null; box.hidden = true; update(); return; }
  const ctrl = new AbortController();
  estCtrl = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const p = new URLSearchParams({
    resource: 'bdtopo-osrm', profile: 'car', optimization: 'fastest', start: `${a[0]},${a[1]}`, end: `${b[0]},${b[1]}`,
    distanceUnit: 'kilometer', timeUnit: 'minute', getSteps: 'false', getBbox: 'false',
  });
  try {
    const res = await fetch(`${ROUTE_API}?${p}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const km = Number(j.distance); const minutes = Number(j.duration);
    if (!(km > 0) || !(minutes > 0)) throw new Error('vide');
    estimate = { km: Math.round(km * 10) / 10, minutes: Math.round(minutes) };
    q('[data-estimate-value]').textContent = estimateText();
    box.hidden = false;
  } catch {
    if (estCtrl === ctrl) { estimate = null; box.hidden = true; }
  } finally {
    clearTimeout(timer);
    update();
  }
}
function estimateText() {
  if (!estimate) return '';
  const km = estimate.km.toLocaleString(t('locale'), { maximumFractionDigits: estimate.km < 10 ? 1 : 0 });
  const h = Math.floor(estimate.minutes / 60); const m = estimate.minutes % 60;
  const dur = h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
  return `≈ ${km} km · ${dur}`;
}
document.addEventListener('address:select', (e) => {
  const name = e.target?.name;
  if (name === 'pickup' || name === 'dropoff') { coords[name] = e.detail?.lonlat || null; suggestService(e.detail); }
  update();
  updateEstimate();
});

// ── Données et récapitulatif ───────────────────────────────────────
function data() {
  const svc = service();
  const medical = svc === 'conventionne';
  const roundtrip = $('roundtrip').checked;
  return {
    service: svc, asap: isAsap(),
    pickup: val('pickup'), dropoff: val('dropoff'), date: val('date'), time: val('time'),
    returnTrip: roundtrip ? { date: medical ? val('date') : val('returnDate'), time: val('returnTime') } : null,
    passengers: Number(form.querySelector('[data-counter="passengers"] output').value),
    luggage: Number(form.querySelector('[data-counter="luggage"] output').value),
    options: [...form.querySelectorAll('[name="options"]:checked')].map((o) => o.value),
    travelRef: ['aeroport', 'gare'].includes(svc) ? val('travelRef') : '',
    medical: medical ? { prescription: form.querySelector('[name="prescription"]:checked')?.value || '', recurring: $('recurring').checked } : null,
    notes: val('notes'),
    contact: { name: val('name'), phone: val('phone'), email: val('email') },
    estimate, lang,
  };
}
const sum = (key) => q(`[data-sum="${key}"]`);
const paxText = (d) => `${t(d.passengers > 1 ? 'pax.many' : 'pax.one', { n: d.passengers })} · ${d.luggage ? t(d.luggage > 1 ? 'bag.many' : 'bag.one', { n: d.luggage }) : t('bag.none')}`;
function whenText(d) {
  if (d.asap) return t('sum.asap');
  if (!d.date || !d.time) return t('sum.tbd');
  const date = fmtDate(d.date);
  return `${date.charAt(0).toUpperCase()}${date.slice(1)}, ${d.medical ? `${t('sum.rdv')} ` : ''}${fmtTime(d.time)}`;
}
function returnText(d) {
  if (!d.returnTrip) return '';
  if (d.medical) return d.returnTrip.time ? fmtTime(d.returnTrip.time) : t('sum.returnTbd');
  return d.returnTrip.date && d.returnTrip.time ? `${fmtDate(d.returnTrip.date)}, ${fmtTime(d.returnTrip.time)}` : t('sum.tbd');
}
function update() {
  const d = data();
  const setText = (key, text, empty) => { const el = sum(key); el.textContent = text || empty; el.classList.toggle('summary__empty', !text); };
  setText('pickup', d.pickup, t('sum.from'));
  setText('dropoff', d.dropoff, t('sum.to'));
  sum('service').textContent = t(`svc.${d.service}`);
  sum('when').textContent = whenText(d);
  q('[data-sum-row="estimate"]').hidden = !estimate;
  sum('estimate').textContent = estimateText();
  q('[data-sum-row="return"]').hidden = !d.returnTrip;
  sum('return').textContent = returnText(d);
  sum('pax').textContent = paxText(d);
  q('[data-sum-row="medical"]').hidden = !d.medical;
  if (d.medical) sum('medical').textContent = [d.medical.prescription ? t(`presc.${d.medical.prescription}`) : t('sum.tbd'), d.medical.recurring ? t('sum.recurring') : ''].filter(Boolean).join(' · ');
  q('[data-sum-row="options"]').hidden = !d.options.length;
  sum('options').textContent = d.options.map((o) => t(`opt.${o}`)).join(', ');
  syncConditional();
  saveDraft();
}
let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const d = data();
    draftStore.set({
      savedAt: Date.now(), service: d.service, pickup: d.pickup, dropoff: d.dropoff, date: d.date, time: d.time, coords,
      when: d.asap ? 'asap' : 'later', roundtrip: Boolean(d.returnTrip), returnDate: val('returnDate'), returnTime: val('returnTime'),
      passengers: d.passengers, luggage: d.luggage, options: d.options, travelRef: val('travelRef'), notes: d.notes,
      prescription: d.medical?.prescription || '', recurring: Boolean(d.medical?.recurring),
    });
  }, 250);
}
form.addEventListener('input', (e) => {
  if (e.isTrusted && (e.target.name === 'pickup' || e.target.name === 'dropoff')) {
    coords[e.target.name] = null;
    if (estimate) { estimate = null; q('[data-estimate]').hidden = true; }
  }
  update();
});
form.addEventListener('change', (e) => {
  if (e.target.name === 'service') renderChips();
  if (e.target.matches('[aria-invalid]')) e.target.removeAttribute('aria-invalid');
  if (e.target.type === 'radio' || e.target.type === 'checkbox') {
    const field = e.target.closest('.field');
    field?.querySelectorAll('[data-error]').forEach((el) => el.remove());
    form.querySelectorAll(`[name="${e.target.name}"][aria-invalid]`).forEach((el) => el.removeAttribute('aria-invalid'));
  }
  update();
});

// Raccourcis « Aujourd'hui / Demain »
document.querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', () => {
  $('date').value = isoPlus(Number(c.dataset.day));
  clearFieldErrors(form);
  update();
}));

// Inverser départ / arrivée
q('[data-swap]').addEventListener('click', (e) => {
  const a = val('pickup'); $('pickup').value = val('dropoff'); $('dropoff').value = a;
  [coords.pickup, coords.dropoff] = [coords.dropoff, coords.pickup];
  e.currentTarget.animate?.([{ transform: 'translateY(-50%) rotate(0)' }, { transform: 'translateY(-50%) rotate(180deg)' }], { duration: 420, easing: 'cubic-bezier(.22,.8,.24,1)' });
  update();
  updateEstimate();
});

// ── Validation et navigation entre étapes ───────────────────────────
const fail = (name, key) => { showFieldError(form, { field: name, message: t(key) }); return false; };
function validate(step) {
  clearFieldErrors(form);
  const d = data();
  if (step === 1) {
    if (d.pickup.length < 3) return fail('pickup', 'err.pickup');
    if (d.dropoff.length < 3) return fail('dropoff', 'err.dropoff');
    if (norm(d.pickup) === norm(d.dropoff)) return fail('dropoff', 'err.same');
    if (!d.asap) {
      if (!d.date) return fail('date', 'err.date');
      if (!d.time) return fail('time', 'err.time');
      if (d.date > isoPlus(365)) return fail('date', 'err.tooFar');
      if ((minutesUntil() ?? 0) < -5) return fail('time', 'err.past');
    }
    if (d.returnTrip) {
      if (d.medical) {
        if (d.returnTrip.time && d.returnTrip.time <= (d.asap ? parisNow().time : d.time)) return fail('returnTime', 'err.returnAfter');
      } else {
        if (!d.returnTrip.date || !d.returnTrip.time) return fail('returnDate', 'err.returnDate');
        const out = d.asap ? `${parisNow().date}T${parisNow().time}` : `${d.date}T${d.time}`;
        if (`${d.returnTrip.date}T${d.returnTrip.time}` <= out) return fail('returnDate', 'err.returnAfter');
      }
    }
  }
  if (step === 2 && d.medical && !d.medical.prescription) return fail('prescription', 'err.prescription');
  if (step === 3) {
    if (d.contact.name.length < 2) return fail('name', 'err.name');
    if (d.contact.phone.replace(/\D/g, '').length < 9) return fail('phone', 'err.phone');
    if (d.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.contact.email)) return fail('email', 'err.email');
    if ($('createAccount')?.checked) {
      if (!d.contact.email) return fail('email', 'err.emailAccount');
      if (val('password').length < 8) return fail('password', 'err.password');
    }
    if (!$('consent').checked) return fail('consent', 'err.consent');
  }
  return true;
}
function go(step, { focus = true } = {}) {
  const prev = current;
  current = step;
  steps.forEach((s) => {
    const n = Number(s.dataset.step);
    s.hidden = n !== step;
    s.classList.toggle('is-active', n === step);
    s.classList.toggle('from-left', n === step && step < prev);
  });
  stepper.forEach((li, i) => {
    li.classList.toggle('is-current', i + 1 === step);
    li.classList.toggle('is-done', i + 1 < step);
    if (i + 1 === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  progress.style.transform = `scaleX(${step / steps.length})`;
  if (focus) {
    announce.textContent = t('step', { n: step, name: t(`step.${step}`) });
    const top = q('[data-stepper]').getBoundingClientRect().top + scrollY - 110;
    if (scrollY > top) scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    steps[step - 1].querySelector('input:not([type=radio]):not([type=checkbox]):not([hidden]), textarea')?.focus({ preventScroll: true });
  }
}
function goTo(step) {
  if (step < current) return go(step);
  for (let s = current; s < step; s += 1) if (!validate(s)) return go(s, { focus: false });
  return go(step);
}
form.addEventListener('click', (e) => {
  if (e.target.closest('[data-next]')) { if (validate(current)) go(current + 1); }
  if (e.target.closest('[data-prev]')) go(current - 1);
});
stepper.forEach((li, i) => li.addEventListener('click', () => goTo(i + 1)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
  goTo(Number(b.dataset.goto));
  q('.booking__main').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input') && current < 3 && !e.target.closest('.input-icon')?.querySelector('[aria-expanded="true"]')) {
    e.preventDefault();
    if (validate(current)) go(current + 1);
  }
});

// ── Envoi ───────────────────────────────────────────────────────────
let lastBooking = null;
const FIELD_STEP = { pickup: 1, dropoff: 1, date: 1, time: 1, returnDate: 1, returnTime: 1, service: 1, prescription: 2 };
function summaryText(d, ref = '') {
  return [
    ref && `${lang === 'en' ? 'Ref.' : 'Réf.'} ${ref}`,
    `${t('svc.' + d.service)}`,
    `${d.pickup} → ${d.dropoff}`,
    whenText(d),
    d.returnTrip ? `${lang === 'en' ? 'Return' : 'Retour'} : ${returnText(d)}` : '',
    paxText(d),
    d.medical ? `${t('presc.label')} : ${t(`presc.${d.medical.prescription}`)}${d.medical.recurring ? ` · ${t('sum.recurring')}` : ''}` : '',
    d.travelRef ? `${lang === 'en' ? 'Flight/train' : 'Vol/train'} : ${d.travelRef}` : '',
    d.options?.length ? d.options.map((o) => t(`opt.${o}`)).join(', ') : '',
    d.notes,
  ].filter(Boolean).join('\n');
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  for (const s of [1, 2, 3]) { if (!validate(s)) { if (s !== current) { go(s); validate(s); } return; } }
  const btn = form.querySelector('[type="submit"]');
  const alert = q('[data-form-alert]');
  const fallback = q('[data-fallback]');
  alert.hidden = true; fallback.hidden = true;
  btn.setAttribute('aria-busy', 'true');
  const d = data();
  const payload = {
    ...d, consent: true, website: val('website'), elapsed: Date.now() - startedAt,
    contact: { ...d.contact, phone: d.contact.phone.replace(/\s/g, '') },
    createAccount: !user && $('createAccount')?.checked ? { password: $('password').value } : null,
  };
  if (d.asap) { delete payload.date; delete payload.time; }
  if (STATIC) { btn.removeAttribute('aria-busy'); sendWithoutServer(d); return; }
  try {
    const res = await api('/bookings', { method: 'POST', body: payload });
    lastBooking = { ...res.booking, contactPhone: d.contact.phone };
    draftStore.clear();
    if (!user && $('remember').checked) contactStore.set({ name: d.contact.name, phone: d.contact.phone, email: d.contact.email });
    else if (!user) contactStore.clear();
    showDone(res, d);
  } catch (err) {
    if (err.status === 0 || err.status >= 500) {
      alert.textContent = t('err.network'); alert.hidden = false;
      const body = `${t('mail.intro')}\n\n${summaryText(d)}\n\n${d.contact.name}\n${d.contact.phone}${d.contact.email ? `\n${d.contact.email}` : ''}`;
      q('[data-fallback-mail]').href = `mailto:${q('[data-fallback-mail]').getAttribute('href').replace('mailto:', '').split('?')[0]}?subject=${encodeURIComponent(t('mail.subject', { date: d.asap ? t('sum.asap') : fmtDate(d.date) }))}&body=${encodeURIComponent(body)}`;
      fallback.hidden = false;
    } else {
      const step = FIELD_STEP[err.field];
      if (step && step !== current) go(step);
      const message = lang === 'en' && err.field ? t(`err.${err.field}`) : err.message;
      if (!showFieldError(form, { field: err.field, message: message.startsWith('err.') ? t('err.generic') : message })) { alert.textContent = lang === 'en' ? t('err.generic') : err.message; alert.hidden = false; }
    }
  } finally {
    btn.removeAttribute('aria-busy');
  }
});

// Sans serveur : référence créée sur l'appareil, message prêt pour WhatsApp et l'e-mail
function newRef() {
  const now = parisNow().date.replace(/-/g, '').slice(2);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  return `TSI-${now}-${[...rnd].map((n) => chars[n % chars.length]).join('')}`;
}
function sendWithoutServer(d) {
  if (val('website')) return;
  const ref = newRef();
  const body = `${t('mail.intro')}\n\n${summaryText(d, ref)}\n\n${d.contact.name}\n${d.contact.phone}${d.contact.email ? `\n${d.contact.email}` : ''}`;
  const wa = q('[data-send-wa]');
  const mail = q('[data-send-mail]');
  wa.href = `${wa.getAttribute('href').split('?')[0]}?text=${encodeURIComponent(body)}`;
  mail.href = `mailto:${mail.getAttribute('href').replace('mailto:', '').split('?')[0]}?subject=${encodeURIComponent(`${t('mail.subject', { date: d.asap ? t('sum.asap') : fmtDate(d.date) })} · ${ref}`)}&body=${encodeURIComponent(body)}`;
  draftStore.clear();
  if ($('remember').checked) contactStore.set({ name: d.contact.name, phone: d.contact.phone, email: d.contact.email });
  else contactStore.clear();
  lastBooking = { ref, asap: d.asap, date: d.date, time: d.time, pickup: d.pickup, dropoff: d.dropoff, contactPhone: d.contact.phone };
  showDone({ booking: lastBooking }, d);
  q('[data-done-text]').textContent = t('done.static', { phone: d.contact.phone });
}

function showDone(res, d) {
  const b = res.booking;
  form.hidden = true;
  q('[data-stepper]').hidden = true;
  q('.stepper__bar').hidden = true;
  const done = q('[data-done]');
  done.hidden = false;
  q('[data-done-ref]').textContent = b.ref;
  const phone = d.contact.phone;
  q('[data-done-text]').textContent = b.asap
    ? t('done.asap', { phone })
    : t(d.medical ? 'done.textMedical' : 'done.text', { phone, date: fmtDate(b.date), time: fmtTime(b.time) });
  q('[data-done-medical]').hidden = !d.medical;
  if ((user || res.accountCreated) && q('[data-done-account]')) q('[data-done-account]').hidden = false;
  if (res.accountCreated) toast(t('done.account'));
  done.focus({ preventScroll: true });
  scrollTo({ top: 0, behavior: 'smooth' });
  lastBooking.summary = summaryText(d, b.ref);
  lastBooking.medical = Boolean(d.medical);
}

// Agenda (.ics) avec rappel une heure avant
q('[data-ics]').addEventListener('click', () => {
  if (!lastBooking) return;
  const b = lastBooking;
  const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const [h, m] = b.time.split(':').map(Number);
  const endM = h * 60 + m + 45;
  const end = `${String(Math.floor(endM / 60) % 24).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
  const escIcs = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taxi Saint-Irenee//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${b.ref}@taxi-saint-irenee`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Paris:${stamp(b.date, b.time)}`, `DTEND;TZID=Europe/Paris:${stamp(b.date, end)}`,
    `SUMMARY:${escIcs(t(b.medical ? 'ics.titleMedical' : 'ics.title'))}`,
    `LOCATION:${escIcs(b.pickup)}`,
    `DESCRIPTION:${escIcs(`${b.summary}\n\n${t('ics.desc')}`)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT1H', `DESCRIPTION:${escIcs(t('ics.alarm'))}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `taxi-${b.ref}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// Partage (partage natif du téléphone, sinon copie)
q('[data-share]').addEventListener('click', async () => {
  if (!lastBooking) return;
  const text = `${lastBooking.summary}\n\nTaxi Saint-Irénée · ${lang === 'en' ? '+33 6 61 88 27 07' : '06 61 88 27 07'}`;
  try {
    if (navigator.share) await navigator.share({ title: t('share.title'), text });
    else { await navigator.clipboard.writeText(text); toast(t('copied')); }
  } catch { /* partage annulé */ }
});

// ── Initialisation ─────────────────────────────────────────────────
form.querySelectorAll('[data-address]').forEach((input) => attachAddress(input, { saved: () => user?.addresses || [] }));
locate($('pickup'), q('[data-locate]'));
renderChips();
update();
go(1, { focus: false });
updateEstimate();

getMe().then((me) => {
  user = me;
  if (!me) return;
  q('[data-signed-in]').hidden = false;
  q('[data-signed-name]').textContent = `${me.firstName} ${me.lastName} · ${fmtPhone(me.phone)}`;
  q('[data-guest-note]').hidden = true;
  q('[data-account-offer]').hidden = true;
  if (!val('name') || remembered) $('name').value = `${me.firstName} ${me.lastName}`;
  if (!val('phone') || remembered) $('phone').value = formatPhone(fmtPhone(me.phone));
  if (!val('email') || remembered) $('email').value = me.email;
  if (!val('pickup') && me.addresses?.[0] && !fromUrl) $('pickup').value = me.addresses[0].address;
  renderChips();
  update();
});
