// Costs view — Finance Module per-BU instance.
// Reads materialized snapshot from bus/<CURRENT_BU>/finance/snapshots/costs.json.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson } from '../../../assets/substrate-client.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const CURRENT_BU = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${CURRENT_BU}/finance/${file}`;

export async function renderCosts(_ctx) {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-costs'));
  if (!root) return;
  root.innerHTML = '<div class="card"><div class="card-body">Loading Costs…</div></div>';

  const [snap, conf] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/costs.json'), null).catch(() => null),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {} }).catch(() => ({ per_figure: {} })),
  ]);

  if (!snap) {
    root.innerHTML = `
      <div class="card"><div class="card-body">
        <h2>🪙 Costs — not active for ${escapeHtml(CURRENT_BU)}</h2>
        <p>No costs snapshot. Run the heartbeat for this BU.</p>
      </div></div>`;
    return;
  }

  const recurring = (snap.recurring || []).map(r => `
    <tr>
      <td><strong>${escapeHtml(r.vendor)}</strong></td>
      <td><code>${escapeHtml(r.category)}</code>${r.confidence_marker === 'low' ? ' <span class="conf-marker" title="Anomaly flagged">⚠ low</span>' : ''}</td>
      <td>${r.monthly_amount ? EUR(r.monthly_amount) : (r.variable_pct_of_revenue ? `${(r.variable_pct_of_revenue * 100).toFixed(2)}% of revenue` : '—')}</td>
      <td class="finance-note">${escapeHtml(r._anomaly_note || '')}</td>
    </tr>`).join('');

  const oneOffs = (snap.one_off_history || []).map(o => `<li>${escapeHtml(o.month)}: ${EUR(o.amount)}</li>`).join('');

  root.innerHTML = `
    <div class="finance-shell">
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Costs — ${escapeHtml(CURRENT_BU)}</span>
            <p class="card-sub">Snapshot: ${escapeHtml(snap.generated_at)}</p>
          </div>
        </div>
        <div class="finance-bignum">${EUR(snap.salaries_monthly_total)} <span class="finance-bignum-sub">/month salaries (incl. variable)</span></div>
      </div>
      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Recurring costs (real ledger)</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Vendor</th><th>Category</th><th>Monthly</th><th>Note</th></tr></thead>
          <tbody>${recurring}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Founder draws (monthly)</span></div></div>
        <div>${EUR(snap.founder_draws_monthly)} / month total</div>
      </div>
      ${oneOffs ? `<div class="card"><div class="card-header-row"><div class="card-header-left"><span class="card-title">One-off spend (history)</span></div></div><ul>${oneOffs}</ul></div>` : ''}
    </div>`;
}
