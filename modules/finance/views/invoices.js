// Invoices + Revenue view — Finance Module per-BU instance.
// Reads materialized snapshot from bus/<CURRENT_BU>/finance/snapshots/revenue.json.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson } from '../../../assets/substrate-client.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const CURRENT_BU = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${CURRENT_BU}/finance/${file}`;

export async function renderInvoices(_ctx) {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-invoices'));
  if (!root) return;
  root.innerHTML = '<div class="card"><div class="card-body">Loading Revenue + Invoices…</div></div>';

  const snap = await fetchSubstrateJson(baseRel('snapshots/revenue.json'), null).catch(() => null);
  if (!snap) {
    root.innerHTML = `
      <div class="card"><div class="card-body">
        <h2>🪙 Revenue — not active for ${escapeHtml(CURRENT_BU)}</h2>
        <p>No revenue snapshot. Run the heartbeat for this BU.</p>
      </div></div>`;
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
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Revenue + Invoices — ${escapeHtml(CURRENT_BU)}</span>
            <p class="card-sub">Snapshot: ${escapeHtml(snap.generated_at)}</p>
          </div>
        </div>
        <div class="finance-bignum">${EUR(snap.mrr_eur)} <span class="finance-bignum-sub">MRR / ${snap.active_customers} active customers</span></div>
        <ul>${byTier}</ul>
      </div>
      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Revenue history</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Month</th><th>Gross revenue</th><th>Confidence note</th></tr></thead>
          <tbody>${history}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Customer list</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Name</th><th>Tier</th><th>MRR</th></tr></thead>
          <tbody>${customers}</tbody>
        </table>
      </div>
    </div>`;
}
