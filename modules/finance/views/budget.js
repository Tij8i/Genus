// Budget view — lightweight venture budgeting (GEN-99).
//
// v1 scope per the GEN-99 handoff:
//   - Planned vs actual spend across categories (agents/runtime, infra,
//     marketing, tools)
//   - Burn vs the active plan
//   - Runway
//
// Real accounting/Stripe integration is GEN-89 (Finance Module). For now we
// drive the visualization from a small in-file v1 mock that exercises the
// shape of the cards. The Budget screen exists so the IA + design language
// can ship; the numbers get wired up next.

import { escapeHtml } from '../../../assets/utils.js';

const EUR = (n) => '€' + (Math.round(n).toLocaleString('en-US'));
const PCT = (n) => `${Math.round(n)}%`;

// ============ v1 mock data ============
// Period is the active month. Each category has a planned + actual figure.
// Tagged with a posture: under_plan | on_plan | over_plan based on % used vs
// pace through the period.
const PERIOD = {
  label: 'June 2026',
  daysElapsed: 24,
  daysTotal: 30,
};

const CATEGORIES = [
  { id: 'agents-runtime', name: 'Agents & runtime', planned: 1800, actual: 1420,
    note: 'Anthropic API + Paperclip runtime.' },
  { id: 'infra', name: 'Infrastructure', planned: 420, actual: 388,
    note: 'Cloudflare Pages, Workers, R2.' },
  { id: 'marketing', name: 'Marketing', planned: 600, actual: 240,
    note: 'Landing-page experiments only this month.' },
  { id: 'tools', name: 'Tools', planned: 380, actual: 502,
    note: 'Linear, Notion, design tools. Slight overspend — see Costs.' },
];

const CASH_ON_HAND = 38400;
const MONTHLY_BURN_3MO = 3120;

function paceFor(cat, period) {
  const expectedAt = cat.planned * (period.daysElapsed / period.daysTotal);
  if (cat.actual > cat.planned) return 'over_plan';
  if (cat.actual > expectedAt * 1.05) return 'hot';
  if (cat.actual < expectedAt * 0.7) return 'cool';
  return 'on_plan';
}

function paceChip(pace) {
  const map = {
    on_plan: { label: 'On plan', cls: 'budget-pace-on' },
    hot:     { label: 'Hot',     cls: 'budget-pace-hot' },
    cool:    { label: 'Under',   cls: 'budget-pace-cool' },
    over_plan: { label: 'Over plan', cls: 'budget-pace-over' },
  };
  const m = map[pace] || map.on_plan;
  return `<span class="budget-pace-chip ${m.cls}">${m.label}</span>`;
}

// ============ Render ============

export function renderBudget(_ctx) {
  const root = document.getElementById('route-budget');
  if (!root) return;

  const totalPlanned = CATEGORIES.reduce((s, c) => s + c.planned, 0);
  const totalActual = CATEGORIES.reduce((s, c) => s + c.actual, 0);
  const pctUsed = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;
  const pacePct = (PERIOD.daysElapsed / PERIOD.daysTotal) * 100;
  const runwayMonths = MONTHLY_BURN_3MO > 0 ? CASH_ON_HAND / MONTHLY_BURN_3MO : null;

  root.innerHTML = `
    ${renderConnectHint()}
    ${renderSummaryCard({ totalPlanned, totalActual, pctUsed, pacePct, runwayMonths })}
    ${renderCategoriesCard()}
    ${renderBurnCard()}
  `;
}

function renderConnectHint() {
  return `
    <div class="budget-hint mono">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
      Demo numbers. Wiring to accounting + Stripe ships with the Finance module (GEN-89).
    </div>
  `;
}

function renderSummaryCard({ totalPlanned, totalActual, pctUsed, pacePct, runwayMonths }) {
  const tone = pctUsed > 100 ? 'over' : (pctUsed > pacePct + 5 ? 'hot' : 'on');
  return `
    <div class="card budget-summary-card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">${escapeHtml(PERIOD.label)}</span>
          <p class="card-sub">Day ${PERIOD.daysElapsed} of ${PERIOD.daysTotal} — burn vs the active plan.</p>
        </div>
        ${paceChip(tone === 'over' ? 'over_plan' : tone === 'hot' ? 'hot' : 'on_plan')}
      </div>

      <div class="budget-summary-grid">
        <div class="budget-stat">
          <span class="mono budget-stat-label">SPENT</span>
          <span class="budget-stat-value">${EUR(totalActual)}</span>
          <span class="budget-stat-sub">of ${EUR(totalPlanned)} planned</span>
        </div>
        <div class="budget-stat">
          <span class="mono budget-stat-label">% USED</span>
          <span class="budget-stat-value">${PCT(pctUsed)}</span>
          <span class="budget-stat-sub">vs ${PCT(pacePct)} of period elapsed</span>
        </div>
        <div class="budget-stat">
          <span class="mono budget-stat-label">RUNWAY</span>
          <span class="budget-stat-value">${runwayMonths != null ? runwayMonths.toFixed(1) + ' mo' : '—'}</span>
          <span class="budget-stat-sub">at ${EUR(MONTHLY_BURN_3MO)}/mo (3-mo avg)</span>
        </div>
      </div>

      <div class="budget-summary-bar-wrap">
        <div class="budget-summary-bar">
          <div class="budget-summary-fill budget-summary-fill-${tone}" style="width:${Math.min(100, pctUsed).toFixed(1)}%"></div>
          <div class="budget-summary-pace-marker" style="left:${pacePct.toFixed(1)}%" title="Pace: ${PCT(pacePct)} of period elapsed"></div>
        </div>
        <div class="budget-summary-axis mono">
          <span>€0</span>
          <span>${EUR(totalPlanned)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderCategoriesCard() {
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Categories</span>
          <p class="card-sub">Planned vs actual spend, by area.</p>
        </div>
      </div>
      <div class="budget-cat-list">
        ${CATEGORIES.map(renderCategoryRow).join('')}
      </div>
    </div>
  `;
}

function renderCategoryRow(cat) {
  const pace = paceFor(cat, PERIOD);
  const pct = cat.planned > 0 ? (cat.actual / cat.planned) * 100 : 0;
  const fillCls = pct > 100 ? 'budget-cat-fill-over' : pct > (PERIOD.daysElapsed / PERIOD.daysTotal) * 100 + 5 ? 'budget-cat-fill-hot' : 'budget-cat-fill-on';
  return `
    <div class="budget-cat-row">
      <div class="budget-cat-row-head">
        <span class="budget-cat-name">${escapeHtml(cat.name)}</span>
        ${paceChip(pace)}
      </div>
      <div class="budget-cat-bar">
        <div class="budget-cat-fill ${fillCls}" style="width:${Math.min(100, pct).toFixed(1)}%"></div>
      </div>
      <div class="budget-cat-row-foot mono">
        <span>${EUR(cat.actual)} <span class="budget-cat-foot-faint">/ ${EUR(cat.planned)}</span></span>
        <span>${PCT(pct)}</span>
      </div>
      ${cat.note ? `<p class="budget-cat-note">${escapeHtml(cat.note)}</p>` : ''}
    </div>
  `;
}

function renderBurnCard() {
  // Compact monthly burn series; real data lands with the Finance module.
  // For v1 we surface the 3-month rolling average + the cash-on-hand line so
  // the operator sees runway derivation, not just the headline number.
  const series = [
    { month: 'Apr', burn: 2880 },
    { month: 'May', burn: 3100 },
    { month: 'Jun', burn: 3380 },
  ];
  const max = Math.max(...series.map(s => s.burn)) * 1.1;
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Burn</span>
          <p class="card-sub">Last 3 months. 3-month average drives the runway number above.</p>
        </div>
        <span class="mono budget-burn-avg">avg ${EUR(MONTHLY_BURN_3MO)}/mo</span>
      </div>
      <div class="budget-burn-chart">
        ${series.map(s => `
          <div class="budget-burn-col">
            <div class="budget-burn-bar-wrap">
              <div class="budget-burn-bar" style="height:${((s.burn / max) * 100).toFixed(1)}%" title="${EUR(s.burn)}"></div>
            </div>
            <span class="mono budget-burn-month">${s.month}</span>
            <span class="mono budget-burn-val">${EUR(s.burn)}</span>
          </div>
        `).join('')}
      </div>
      <div class="budget-cash-row">
        <span class="mono budget-cash-label">CASH ON HAND</span>
        <span class="budget-cash-value">${EUR(CASH_ON_HAND)}</span>
      </div>
    </div>
  `;
}
