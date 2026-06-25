// Invoices view — Medivara Finance Module v1 (GEN-134 + Revenue tab content).

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson } from '../../../assets/substrate-client.js';

const BU = 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${BU}/finance/${file}`;
const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));

export async function renderInvoices(ctx) {
  const root = document.getElementById('route-invoices');
  root.innerHTML = '<div class="card"><div class="card-body">Loading Revenue + Invoices…</div></div>';

  const snap = await fetchSubstrateJson(baseRel('snapshots/revenue.json'), null);
  if (!snap) {
    root.innerHTML = '<div class="card"><div class="card-body">No revenue snapshot. Run the heartbeat.</div></div>';
    return;
  }

  const byTier = Object.entries(snap.by_tier || {}).map(([tier, info]) => `
    <li><strong>${escapeHtml(tier)}</strong>: ${info.count} customers · ${EUR(info.mrr)} MRR</li>`).join('');

  const history = (snap.history || []).map(m => `
    <tr>
      <td>${escapeHtml(m.month)}</td>
      <td>${EUR(m.revenue_gross)}${m.confidence === 'low' ? ' <span class="conf-marker" title="Why this might be wrong">⚠ low</span>' : ''}</td>
      <td class="finance-note">${m.missing_invoice ? `Missing: ${escapeHtml(m.missing_invoice.vendor)} (~${EUR(m.missing_invoice.expected_amount_eur)} expected) — ${escapeHtml(m.missing_invoice.note || '')}` : ''}</td>
    </tr>`).join('');

  const customers = (snap.customers || []).map(c => `
    <tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.tier)}</td><td>${EUR(c.mrr)}</td></tr>`).join('');

  root.innerHTML = `
    <div class="finance-shell">
      <header class="finance-header">
        <h1>🪙 Finance — Medivara <span class="finance-tab-chip">Revenue · Invoices</span></h1>
        <div class="finance-meta">Snapshot: ${escapeHtml(snap.generated_at)}</div>
      </header>
      <section class="finance-section">
        <h2>MRR</h2>
        <div class="finance-bignum">${EUR(snap.mrr_eur)} <span class="finance-bignum-sub">/ ${snap.active_customers} active customers</span></div>
        <ul>${byTier}</ul>
      </section>
      <section class="finance-section">
        <h2>Revenue history</h2>
        <table class="finance-table">
          <thead><tr><th>Month</th><th>Gross revenue</th><th>Confidence note</th></tr></thead>
          <tbody>${history}</tbody>
        </table>
      </section>
      <section class="finance-section">
        <h2>Customer list</h2>
        <table class="finance-table">
          <thead><tr><th>Name</th><th>Tier</th><th>MRR</th></tr></thead>
          <tbody>${customers}</tbody>
        </table>
      </section>
    </div>`;
}
