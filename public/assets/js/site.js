// Comportements communs : en-tête, menu, dock, apparitions, reflets du verre.
import { getMe, BASE } from './api.js';

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ── En-tête et dock selon le défilement ─────────────────────────────
const header = document.querySelector('[data-header]');
const dock = document.querySelector('[data-dock]');
let ticking = false;
function onScroll() {
  const y = scrollY;
  header?.classList.toggle('is-scrolled', y > 24);
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

// La barre de raccourcis reste affichée en permanence ; elle s'efface seulement quand le clavier virtuel est ouvert
dock?.querySelectorAll('a[href^="/"]').forEach((a) => { if (a.pathname === location.pathname) a.setAttribute('aria-current', 'page'); });
// (clavier détecté par la réduction de la zone visible, pas par le simple focus d'un champ)
if (dock && window.visualViewport) {
  const vv = window.visualViewport;
  const check = () => dock.classList.toggle('is-hidden', vv.height < innerHeight * 0.72);
  vv.addEventListener('resize', check);
}

// ── Menu mobile ─────────────────────────────────────────────────────
const toggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');
if (toggle && menu) {
  menu.querySelectorAll('.mobile-menu__links a').forEach((a, i) => a.style.setProperty('--i', i));
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
    } else {
      menu.classList.remove('is-open');
      setTimeout(() => { if (toggle.getAttribute('aria-expanded') === 'false') menu.hidden = true; }, reduceMotion ? 0 : 350);
    }
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); } });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  matchMedia('(min-width: 1041px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

// ── Variables CSS portées par des attributs (CSP sans style en ligne) ─
export function applyVars(scope = document) {
  scope.querySelectorAll('[data-d], [data-n], [data-w]').forEach((el) => {
    if (el.dataset.d) el.style.setProperty('--d', el.dataset.d);
    if (el.dataset.n) el.style.setProperty('--n', el.dataset.n);
    if (el.dataset.w) el.style.setProperty('--w', el.dataset.w);
  });
}
applyVars();

// ── Apparitions au défilement ───────────────────────────────────────
document.querySelectorAll('[data-stagger]').forEach((group) => {
  [...group.children].forEach((child, i) => {
    if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', group.dataset.stagger || '');
    child.style.setProperty('--d', Math.min(i, 8));
  });
});
const revealables = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  revealables.forEach((el) => io.observe(el));
} else {
  revealables.forEach((el) => el.classList.add('is-in'));
}
export function reveal(scope = document) {
  applyVars(scope);
  const items = scope.querySelectorAll('[data-reveal]:not(.is-in)');
  items.forEach((el, i) => { if (!el.dataset.d) el.style.setProperty('--d', Math.min(i, 8)); });
  requestAnimationFrame(() => requestAnimationFrame(() => items.forEach((el) => el.classList.add('is-in'))));
}

// ── Reflet du verre qui suit le pointeur ────────────────────────────
if (finePointer && !reduceMotion) {
  let target = null;
  let frame = 0;
  let pos = { x: 0, y: 0 };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('.glass, [data-glow]');
    if (!el) return;
    target = el;
    pos = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      const r = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${pos.x - r.left}px`);
      target.style.setProperty('--my', `${pos.y - r.top}px`);
    });
  }, { passive: true });
}

// ── Lien « compte » selon la connexion ──────────────────────────────
getMe().then((user) => {
  if (!user) return;
  document.querySelectorAll('[data-account-label]').forEach((el) => { el.textContent = 'Espace'; });
  document.querySelectorAll('[data-account-link]').forEach((el) => el.setAttribute('aria-label', `Espace client de ${user.firstName}`));
});

// Année courante, liens d'appel suivis, etc.
root.classList.add('js');

// ── Hors connexion : service worker (HTTPS ou poste local) ───────────
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => { navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {}); });
}

// ── Suggestion de langue : visiteur anglophone sur une page française ──
{
  const link = document.querySelector('.lang-switch[data-lang-switch]');
  const pageLang = root.lang || 'fr';
  const prefersEnglish = (navigator.languages || [navigator.language || '']).find((l) => /^(fr|en)\b/i.test(l))?.toLowerCase().startsWith('en');
  let seen = false;
  try { seen = localStorage.getItem('tsi-lang-hint') === '1'; } catch { /* stockage indisponible */ }
  document.querySelectorAll('[data-lang-switch]').forEach((a) => a.addEventListener('click', () => { try { localStorage.setItem('tsi-lang-hint', '1'); } catch { /* */ } }));
  if (link && pageLang === 'fr' && prefersEnglish && !seen) {
    setTimeout(() => {
      const box = document.createElement('div');
      box.className = 'toast toast--lang';
      box.lang = 'en';
      box.setAttribute('role', 'status');
      box.innerHTML = `<span>This site is also available in English.</span><a class="toast__action" href="${link.getAttribute('href')}" hreflang="en">English</a><button type="button" class="toast__close" aria-label="Close">×</button>`;
      const close = () => { box.remove(); try { localStorage.setItem('tsi-lang-hint', '1'); } catch { /* */ } };
      box.querySelector('button').addEventListener('click', close);
      box.querySelector('a').addEventListener('click', close);
      document.body.append(box);
    }, 1200);
  }
}
