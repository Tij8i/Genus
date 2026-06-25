// Costs view — Medivara Finance Module v1 (GEN-133).
// Dummy data baked in so the page renders without substrate dependency.

import { escapeHtml } from '../../../assets/utils.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));

const SALARIES = [
  { name: 'Senior Engineer 1', monthly_gross: 7000 },
  { name: 'Senior Engineer 2', monthly_gross: 6500 },
  { name: 'Customer Success Lead', monthly_gross: 5500 },
  { name: 'Sales Lead', monthly_gross: 6000, variable: 1500 },
  { name: 'Operations Admin', monthly_gross: 4500 },
];

const RECURRING = [
  { vendor: 'AWS', category: 'saas-infra', monthly_amount: 1200 },
  { vendor: 'Stripe', category: 'saas-payments', variable_pct_of_revenue: 0.029 },
  { vendor: 'Twilio', category: 'saas-comms', monthly_amount: 400 },
  { vendor: 'Notion', category: 'saas-internal-tools', monthly_amount: 100 },
  { vendor: 'Slack', category: 'saas-internal-tools', monthly_amount: 150 },
  { vendor: 'WeWork Amsterdam', category: 'office-rent', monthly_amount: 3000 },
  { vendor: 'Boekhouder Schaap', category: 'professional-services', monthly_amount: 800 },
  { vendor: 'ChurnZero', category: 'office-supplies', monthly_amount: 2400,
    confidence: 'low', note: 'Categorized as office-supplies; should be saas-customer-success. See active recommendation rec-fin-2026-06-25-001.' },
  { vendor: 'UnusedAnalyticsTool', category: 'saas-analytics', monthly_amount: 200,
    confidence: 'low', note: 'No usage signals last 3 months. v1 does NOT recommend killing (subscription-audit is SPEC §4 forbidden); flagged only.' },
];

const FOUNDER_DRAWS = [
  { name: 'Joost Cornelissen', monthly_draw: 3000 },
  { name: 'Michiel Willekens', monthly_draw: 3000 },
];

const ONE_OFFS = [
  { month: '2026-03', amount: 15000, note: 'Healthcare data certification (legal/compliance)' },
];

export function renderCosts(_ctx) {
  const root = document.getElementById('route-costs');
  if (!root) return;

  const salariesTotal = SALARIES.reduce((s, e) => s + e.monthly_gross + (e.variable || 0), 0);
  const drawsTotal = FOUNDER_DRAWS.reduce((s, f) => s + f.monthly_draw, 0);
  const recurringTotal = RECURRING.reduce((s, r) => s + (r.monthly_amount || 0), 0);

  const salariesRows = SALARIES.map(e => `
    <tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${EUR(e.monthly_gross)}${e.variable ? ` <span class="finance-note">(+ ~${EUR(e.variable)} var)</span>` : ''}</td>
    </tr>`).join('');

  const recurringRows = RECURRING.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.vendor)}</strong></td>
      <td><code>${escapeHtml(r.category)}</code>${r.confidence === 'low' ? ' <span class="conf-marker" title="Why this might be wrong">⚠ low</span>' : ''}</td>
      <td>${r.monthly_amount ? EUR(r.monthly_amount) : (r.variable_pct_of_revenue ? `${(r.variable_pct_of_revenue * 100).toFixed(2)}% of revenue` : '—')}</td>
      <td class="finance-note">${escapeHtml(r.note || '')}</td>
    </tr>`).join('');

  const oneOffRows = ONE_OFFS.map(o => `
    <li><strong>${escapeHtml(o.month)}</strong>: ${EUR(o.amount)} — ${escapeHtml(o.note)}</li>`).join('');

  root.innerHTML = `
    <div class="finance-shell">
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Costs — Medivara</span>
            <p class="card-sub">Recurring ledger + salaries + founder draws. Inline ⚠ markers flag anomalies (CONFIDENCE_FRAME silent-low-only).</p>
          </div>
        </div>

        <div class="finance-bignum">${EUR(salariesTotal + recurringTotal + drawsTotal)} <span class="finance-bignum-sub">total monthly outflow (excl. variable + one-offs)</span></div>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Salaries (5 employees)</span></div></div>
        <div class="finance-bignum">${EUR(salariesTotal)} <span class="finance-bignum-sub">/month, incl. variable</span></div>
        <table class="finance-table">
          <thead><tr><th>Role</th><th>Monthly</th></tr></thead>
          <tbody>${salariesRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Recurring costs (real ledger)</span></div></div>
        <table class="finance-table">
          <thead><tr><th>Vendor</th><th>Category</th><th>Monthly</th><th>Note</th></tr></thead>
          <tbody>${recurringRows}</tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Founder draws</span></div></div>
        <div class="finance-bignum">${EUR(drawsTotal)} <span class="finance-bignum-sub">/month total (${FOUNDER_DRAWS.length} founders × ${EUR(FOUNDER_DRAWS[0].monthly_draw)})</span></div>
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">One-off spend (history)</span></div></div>
        <ul>${oneOffRows}</ul>
      </div>
    </div>`;
}
