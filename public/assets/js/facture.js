import { api, esc, fmtDate, fmtTime, fmtEuro, fmtPhone } from './api.js';

const el = document.querySelector('[data-invoice]');
const params = new URLSearchParams(location.search);
const id = params.get('id');
const token = params.get('t');
if (token) document.querySelector('.invoice-toolbar a').href = '/';

document.querySelector('[data-print]').addEventListener('click', () => print());

const line = (k, v) => (v ? `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>` : '');
const issued = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

(async () => {
  if (!id) { el.innerHTML = '<p class="center">Facture introuvable.</p>'; return; }
  try {
    const { invoice: i } = await api(`/invoices/${encodeURIComponent(id)}${token ? `?t=${encodeURIComponent(token)}` : ''}`);
    document.title = `Facture ${i.number} · Taxi Saint-Irénée`;
    const c = i.company || {};
    const legal = [c.legalName, c.owner, 'Lyon'].filter(Boolean).join(' · ');
    const ids = [c.siret && `SIRET ${c.siret}`, c.vatNumber && `TVA ${c.vatNumber}`, c.ads && `ADS n° ${c.ads}`, c.cpam && `Conventionnement CPAM n° ${c.cpam}`].filter(Boolean).join(' · ');
    const covered = i.medical ? Math.max(0, i.amountTTC - (i.patientShare || 0)) : 0;
    el.innerHTML = `
      <header class="invoice__head">
        <img src="/assets/img/logo-horizontal-noir.svg" alt="Taxi Saint-Irénée" width="240" height="60">
        <div class="invoice__title">
          <p class="caps">Facture</p>
          <h1 class="invoice__number">${esc(i.number)}</h1>
          <p class="muted">Émise le ${esc(issued(i.issuedAt))}</p>
        </div>
      </header>
      <div class="invoice__parties">
        <div><p class="caps muted">Émetteur</p><p>${esc(c.legalName || 'Taxi Saint-Irénée')}<br>${esc(c.owner || '')}${c.address ? `<br>${esc(c.address)}` : ''}<br>06 61 88 27 07${c.email ? `<br>${esc(c.email)}` : ''}</p></div>
        <div><p class="caps muted">Client</p><p>${esc(i.client?.name || '')}${i.client?.email ? `<br>${esc(i.client.email)}` : ''}${i.client?.phone ? `<br>${esc(fmtPhone(i.client.phone))}` : ''}</p></div>
      </div>
      <table class="invoice__table">
        <tbody>
          ${line('Course du', esc(`${fmtDate(i.serviceDate, { year: true })} à ${fmtTime(i.serviceTime)}`))}
          ${line('Prestation', esc(i.service))}
          ${line('Départ', esc(i.pickup))}
          ${line('Arrivée', esc(i.dropoff))}
          ${line('Distance', i.distanceKm ? esc(`${String(i.distanceKm).replace('.', ',')} km`) : '')}
          ${line('Référence', esc(i.bookingRef))}
          ${line('Règlement', esc(i.paymentMethod))}
        </tbody>
      </table>
      <div class="invoice__amounts">
        ${i.vatRate > 0 ? `<div><span>Montant HT</span><span class="tabular">${fmtEuro(i.amountHT)}</span></div>
        <div><span>TVA ${String(i.vatRate).replace('.', ',')} %</span><span class="tabular">${fmtEuro(i.vat)}</span></div>` : ''}
        <div class="invoice__total"><span>Total TTC</span><span class="tabular">${fmtEuro(i.amountTTC)}</span></div>
        ${i.medical ? `<div><span>Pris en charge par l'Assurance Maladie</span><span class="tabular">${fmtEuro(covered)}</span></div>
        <div class="invoice__due"><span>Reste à charge du patient</span><span class="tabular">${fmtEuro(i.patientShare || 0)}</span></div>` : ''}
      </div>
      <div class="invoice__notes">
        ${i.vatRate > 0 ? '' : '<p>TVA non applicable, article 293 B du Code général des impôts.</p>'}
        ${i.medical ? '<p>Transport assis professionnalisé en taxi conventionné, pris en charge par l’Assurance Maladie sur prescription médicale.</p>' : ''}
        ${i.loyaltyApplied ? '<p>Avantage fidélité appliqué sur cette course.</p>' : ''}
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}
        <p>Tarif réglementé des taxis (arrêté préfectoral en vigueur). Merci de votre confiance.</p>
      </div>
      <footer class="invoice__legal"><p>${esc(legal)}</p>${ids ? `<p>${esc(ids)}</p>` : ''}</footer>`;
  } catch (err) {
    el.innerHTML = `<div class="center stack"><p>${esc(err.status === 401 ? 'Connectez-vous pour consulter cette facture.' : err.message)}</p>${err.status === 401 ? `<p><a class="btn btn--noir" href="/compte">Se connecter</a></p>` : ''}</div>`;
  }
})();
