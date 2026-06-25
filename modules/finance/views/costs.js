// Costs view — Medivara Finance Module v1 (GEN-133).

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson } from '../../../assets/substrate-client.js';

const BU = 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${BU}/finance/${file}`;
const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));

export async function renderCosts(ctx) {
  const root = document.getElementById('route-costs');
  root.innerHTML = '<div class="card"><div class="card-body">Loading Costs…</div></div>';

  const [snap, conf] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/costs.json'), null),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {} }),
  ]);
  if (!snap) {
    root.innerHTML = '<div class="card"><div class="card-body">No costs snapshot. Run the heartbeat.</div></div>';
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
      <header class="finance-header">
        <h1>🪙 Finance — Medivara <span class="finance-tab-chip">Costs</span></h1>
        <div class="finance-meta">Snapshot: ${escapeHtml(snap.generated_at)}</div>
      </header>
      <section class="finance-section">
        <h2>Monthly salaries</h2>
        <div class="finance-bignum">${EUR(snap.salaries_monthly_total)} <span class="finance-bignum-sub">/month, incl. variable</span></div>
      </section>
      <section class="finance-section">
        <h2>Recurring costs (real ledger)</h2>
        <table class="finance-table">
          <thead><tr><th>Vendor</th><th>Category</th><th>Monthly</th><th>Note</th></tr></thead>
          <tbody>${recurring}</tbody>
        </table>
      </section>
      <section class="finance-section">
        <h2>Founder draws (monthly)</h2>
        <div>${EUR(snap.founder_draws_monthly)} / month total</div>
      </section>
      ${oneOffs ? `
      <section class="finance-section">
        <h2>One-off spend (history)</h2>
        <ul>${oneOffs}</ul>
      </section>` : ''}
    </div>`;
}
