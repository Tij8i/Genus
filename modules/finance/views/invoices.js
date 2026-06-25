// Invoices + Revenue view — Medivara Finance Module v1 (GEN-134).
// Dummy data baked in so the page renders without substrate dependency.

import { escapeHtml } from '../../../assets/utils.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const CURRENT_BU = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'medivara';

const CUSTOMERS = [
  { name: 'Clinica Verde NL', tier: 'growth', mrr: 3000, status: 'active' },
  { name: 'GezondNL Network', tier: 'growth', mrr: 3000, status: 'active' },
  { name: 'MedPlus AMS', tier: 'growth', mrr: 3000, status: 'active' },
  { name: 'ZorgPraktijk Utrecht', tier: 'team', mrr: 1500, status: 'active' },
  { name: 'FamilieDokter B.V.', tier: 'team', mrr: 1500, status: 'active' },
  { name: 'Tandarts Tilburg', tier: 'team', mrr: 1500, status: 'active' },
  { name: 'Fysio Rotterdam', tier: 'team', mrr: 1500, status: 'active' },
  { name: 'Praktijk Den Haag', tier: 'team', mrr: 1500, status: 'active' },
  { name: 'Dr. Janssen Almere', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'Huisarts Eindhoven', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'Praktijk Groningen', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'Dr. Vermeer Den Bosch', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'Spoedhulp Breda', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'Praktijk Leiden', tier: 'solo', mrr: 800, status: 'active' },
  { name: 'ChurnedDental NL', tier: 'team', mrr: 0, status: 'churned', churned_at: '2026-03-15' },
];

const HISTORY = [
  { month: '2026-01', revenue_gross: 41800, confidence: 'high' },
  { month: '2026-02', revenue_gross: 46100, confidence: 'high' },
  { month: '2026-03', revenue_gross: 48200, confidence: 'high' },
  { month: '2026-04', revenue_gross: 52800, confidence: 'high' },
  { month: '2026-05', revenue_gross: 56700, confidence: 'low',
    missing_invoice: { vendor: 'Stripe', expected_amount_eur: 1644,
      note: 'Stripe May fee invoice did not land in Moneybird; revenue figure is net-of-Stripe and may be incomplete.' } },
  { month: '2026-06', revenue_gross: 60100, confidence: 'high', status: 'in_progress' },
];

const TO_ISSUE = [
  { customer: 'Clinica Verde NL', amount: 3000, due_by: '2026-07-01' },
  { customer: 'GezondNL Network', amount: 3000, due_by: '2026-07-01' },
];

const ISSUED_UNPAID = [
  { customer: 'MedPlus AMS', amount: 3000, issued_at: '2026-06-15', due_by: '2026-06-30' },
];

const RECENTLY_PAID = [
  { customer: 'ZorgPraktijk Utrecht', amount: 1500, paid_at: '2026-06-20' },
  { customer: 'FamilieDokter B.V.', amount: 1500, paid_at: '2026-06-18' },
  { customer: 'Tandarts Tilburg', amount: 1500, paid_at: '2026-06-15' },
];

export function renderInvoices(_ctx) {
  const root = document.getElementById('route-invoices');
  if (!root) return;

  const activeCustomers = CUSTOMERS.filter(c => c.status === 'active');
  const mrr = activeCustomers.reduce((s, c) => s + c.mrr, 0);
  const byTier = activeCustomers.reduce((acc, c) => {
    acc[c.tier] = acc[c.tier] || { count: 0, mrr: 0 };
    acc[c.tier].count++;
    acc[c.tier].mrr += c.mrr;
    return acc;
  }, {});

  const tierRows = Object.entries(byTier).map(([tier, info]) => `
    <li><strong>${escapeHtml(tier)}</strong>: ${info.count} customers · ${EUR(info.mrr)} MRR</li>`).join('');

  const historyRows = HISTORY.map(m => `
    <tr>
      <td>${escapeHtml(m.month)}${m.status === 'in_progress' ? ' <span class="finance-pill">in progress</span>' : ''}</td>
      <td>${EUR(m.revenue_gross)}${m.confidence === 'low' ? ' <span class="conf-marker" title="Why this might be wrong">⚠ low</span>' : ''}</td>
      <td class="finance-note">${m.missing_invoice ? `Missing: ${escapeHtml(m.missing_invoice.vendor)} (~${EUR(m.missing_invoice.expected_amount_eur)} expected) — ${escapeHtml(m.missing_invoice.note)}` : ''}</td>
    </tr>`).join('');

  const toIssueRows = TO_ISSUE.map(i => `<li><strong>${escapeHtml(i.customer)}</strong>: ${EUR(i.amount)} <span class="finance-note">(due ${escapeHtml(i.due_by)})</span></li>`).join('');
  const issuedRows = ISSUED_UNPAID.map(i => `<li><strong>${escapeHtml(i.customer)}</strong>: ${EUR(i.amount)} <span class="finance-note">(issued ${escapeHtml(i.issued_at)}, due ${escapeHtml(i.due_by)})</span></li>`).join('');
  const paidRows = RECENTLY_PAID.map(i => `<li><strong>${escapeHtml(i.customer)}</strong>: ${EUR(i.amount)} <span class="finance-note">(paid ${escapeHtml(i.paid_at)})</span></li>`).join('');

  const customerRows = CUSTOMERS.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.tier)}</td>
      <td>${c.status === 'active' ? EUR(c.mrr) : `<span class="finance-note">churned ${escapeHtml(c.churned_at || '')}</span>`}</td>
    </tr>`).join('');

  root.innerHTML = `
    <div class="finance-shell">
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Revenue + Invoices — Medivara</span>
            <p class="card-sub">MRR + invoice queue (to issue / issued / paid). Inline ⚠ markers on months with incomplete data.</p>
          </div>
        </div>
        <div class="finance-bignum">${EUR(mrr)} <span class="finance-bignum-sub">MRR / ${activeCustomers.length} active customers</span></div>
        <ul>${tierRows}</ul>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Invoice queue</span></div></div>
        <div class="finance-section">
          <h3>To issue</h3>
          <ul>${toIssueRows || '<li class="finance-note">None pending.</li>'}</ul>
          <h3>Issued / awaiting payment</h3>
          <ul>${issuedRows || '<li class="finance-note">None.</li>'}</ul>
          <h3>Recently paid</h3>
          <ul>${paidRows}</ul>
        </div>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Revenue history (6 months)</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Month</th><th>Gross revenue</th><th>Note</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Customer list (15)</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Name</th><th>Tier</th><th>MRR</th></tr></thead>
          <tbody>${customerRows}</tbody>
        </table>
      </div>
    </div>`;
}
