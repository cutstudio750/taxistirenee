import { attachAddress } from './address.js';
import { parisNow, getMe } from './api.js';

const form = document.querySelector('[data-quick-book]');
if (form) {
  const now = parisNow();
  const [h, m] = now.time.split(':').map(Number);
  let mins = Math.ceil((h * 60 + m + 60) / 5) * 5;
  let date = now.date;
  if (mins >= 1440) { mins -= 1440; const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); date = d.toISOString().slice(0, 10); }
  form.elements.date.min = now.date;
  form.elements.date.value = date;
  form.elements.time.value = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  let saved = [];
  getMe().then((u) => { saved = u?.addresses || []; if (u && saved[0] && !form.elements.from.value) form.elements.from.value = saved[0].address; });
  form.querySelectorAll('[data-address]').forEach((input) => attachAddress(input, { saved: () => saved }));

  form.querySelector('[data-swap]').addEventListener('click', (e) => {
    const { from, to } = form.elements;
    [from.value, to.value] = [to.value, from.value];
    e.currentTarget.animate?.([{ transform: 'translateY(-50%) rotate(0)' }, { transform: 'translateY(-50%) rotate(180deg)' }], { duration: 420, easing: 'cubic-bezier(.22,.8,.24,1)' });
  });
}
