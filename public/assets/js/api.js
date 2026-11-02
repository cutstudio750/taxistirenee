// Client HTTP de l'API du site.

// Version GitHub Pages (sans serveur) et adresse de base du site, par exemple /taxistirenee
export const STATIC = document.documentElement.hasAttribute('data-static');
export const BASE = document.documentElement.dataset.base || '';
export class ApiError extends Error {
  constructor(message, status, field) { super(message); this.status = status; this.field = field; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Connexion impossible. Vérifiez votre réseau ou appelez le 06 61 88 27 07.', 0);
  }
  let data = {};
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) throw new ApiError(data.error || 'Une erreur est survenue.', res.status, data.field);
  return data;
}

let mePromise = null;
export function getMe({ refresh = false } = {}) {
  if (STATIC) return Promise.resolve(null);
  if (!mePromise || refresh) mePromise = api('/me').then((d) => d.user).catch(() => null);
  return mePromise;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DATE_LOCALE = (document.documentElement.lang || 'fr').startsWith('en') ? 'en-GB' : 'fr-FR';
export function fmtDate(date, { weekday = true, year = false } = {}) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat(DATE_LOCALE, { timeZone: 'UTC', weekday: weekday ? 'long' : undefined, day: 'numeric', month: 'long', year: year ? 'numeric' : undefined }).format(d);
}
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  if (DATE_LOCALE === 'en-GB') return `${h}:${m}`;
  return `${Number(h)}\u00a0h${m && m !== '00' ? `\u00a0${m}` : ''}`;
}
export const fmtEuro = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export function fmtPhone(p) {
  const m = String(p || '').match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : p;
}

export function parisNow() {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function toast(message, { timeout = 4200 } = {}) {
  const el = document.querySelector('.toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, timeout);
}

// Affiche les erreurs de champ renvoyées par l'API
export function showFieldError(form, err) {
  clearFieldErrors(form);
  const input = err.field && form.querySelector(`[name="${err.field}"]`);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    const msg = document.createElement('p');
    msg.className = 'field-error';
    msg.dataset.error = '';
    msg.textContent = err.message;
    (input.closest('.field') || input.parentElement).append(msg);
    input.focus({ preventScroll: false });
    return true;
  }
  return false;
}
export function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('[data-error]').forEach((el) => el.remove());
}

export function icon(name, cls = 'icon') {
  return `<svg class="${cls}" aria-hidden="true"><use href="${BASE}/assets/img/icons.svg#${name}"/></svg>`;
}
