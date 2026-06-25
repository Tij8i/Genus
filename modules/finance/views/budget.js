// Budget (Cash + Runway) view — Medivara Finance Module v1 (GEN-132).
// Dummy data baked in so the page renders without substrate dependency.
// Replaces the GEN-99 venture-budget mock with Medivara-shape SaaS bookkeeping.

import { escapeHtml } from '../../../assets/utils.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));

// ============ Medivara dummy data ============

const SNAPSHOT_AT = '2026-06-25T20:00:00Z';

const ACCOUNTS = [
  { name: 'Operating', currency: 'EUR', current_balance: 184350 },
  { name: 'Tax Reserve', currency: 'EUR', current_balance: 28400 },
];

const TOTAL_CASH = ACCOUNTS.reduce((s, a) => s + a.current_balance, 0);
const RUNWAY_DAYS = 365; // Cash-positive operations; effectively long runway
const RUNWAY_WITH_PLANNED_DRAW = 320; // After Joost's planned €8K draw
const THRESHOLDS = { runway_alert_days: 90, draw_vs_runway_block_days: 60 };

const HEADLINE_FACTORS = [
  { id: 'revenue', label: 'Incoming revenue (this month)', value_eur: 60100, confidence: 'high' },
  { id: 'recurring', label: 'Fixed recurring costs', value_eur: 41750, confidence: 'high' },
  { id: 'adhoc', label: 'Ad-hoc / one-off spend', value_eur: 0, confidence: 'high' },
  { id: 'draws', label: 'Founder draws (this month)', value_eur: 6000, confidence: 'high' },
  { id: 'runway', label: 'Days of runway', value_days: RUNWAY_DAYS, confidence: 'high' },
  { id: 'variance', label: 'Variance vs. budget', value_pct: -1.2, confidence: 'low' },
];

// 30-day projection (linear, starting from current cash)
const PROJECTION_30 = [
  { day: 0, cash: 212750 },
  { day: 5, cash: 213100 },
  { day: 10, cash: 213450 },
  { day: 15, cash: 213800 },
  { day: 20, cash: 214150 },
  { day: 25, cash: 214500 },
  { day: 30, cash: 214900 },
];

const PROJECTION_90 = [
  { day: 0, cash: 212750 },
  { day: 15, cash: 213800 },
  { day: 30, cash: 214900 },
  { day: 45, cash: 215850 },
  { day: 60, cash: 217000 },
  { day: 75, cash: 218100 },
  { day: 90, cash: 219250 },
];

const PENDING_RECOMMENDATIONS = [
  {
    recommendation_id: 'rec-fin-2026-06-25-001',
    category: 'expense-recategorization',
    confidence: 'high',
    target_ref: {
      current_state: { vendor: 'ChurnZero', category: 'office-supplies', monthly_amount: 2400 },
      proposed_state: { vendor: 'ChurnZero', category: 'saas-customer-success', monthly_amount: 2400 },
    },
    reasoning: 'Categorized as office-supplies in Moneybird; should be saas-customer-success. Cleans up reporting accuracy.',
    runway_impact_days: 0,
  },
  {
    recommendation_id: 'rec-fin-2026-06-25-002',
    category: 'founder-draw-adjustment',
    confidence: 'high',
    target_ref: {
      current_state: { founder_name: 'Joost Cornelissen', requested_amount_eur: 8000, requested_month: '2026-07' },
      proposed_state: { founder_name: 'Joost Cornelissen', suggested_amount_eur: 3000, requested_month: '2026-07' },
    },
    reasoning: 'Joost requested €8K personal draw next month (vs. usual €3K). At current burn projection, ending cash would touch ~€175K → ~89-day runway at month-end. Crosses runway_alert_days=90 threshold.',
    runway_impact_days: -45,
  },
];

// ============ Render ============

export function renderBudget(_ctx) {
  const root = document.getElementById('route-budget');
  if (!root) return;

  root.innerHTML = `
    <div class="finance-shell">
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Cash + Runway — Medivara</span>
            <p class="card-sub">L1 onboarding: <strong>passed</strong> · Connector: <code>moneybird_medivara</code> (fixture) · Snapshot: ${escapeHtml(SNAPSHOT_AT)}</p>
          </div>
        </div>
        ${renderHeadlineStrip()}
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Cash position</span></div></div>
        ${renderCashCard()}
      </div>

      <div class="card">
        <div class="card-header-row"><div class="card-header-left"><span class="card-title">Runway</span></div></div>
        ${renderRunwayCard()}
      </div>

      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">Recommendations <span class="finance-pill">${PENDING_RECOMMENDATIONS.length} pending</span></span>
            <p class="card-sub">Filed by Finance Stewart of Medivara per the 2 allowed categories (SPEC §4). Forbidden actions rejected at 3 layers.</p>
          </div>
        </div>
        ${PENDING_RECOMMENDATIONS.map(renderRecCard).join('')}
      </div>
    </div>
  `;
}

function renderHeadlineStrip() {
  const factors = HEADLINE_FACTORS.map(f => {
    let value = '—';
    if (typeof f.value_eur === 'number') value = EUR(f.value_eur);
    else if (typeof f.value_days === 'number') value = `${f.value_days} d`;
    else if (typeof f.value_pct === 'number') value = `${f.value_pct.toFixed(1)}%`;
    const conf = f.confidence === 'low' ? ' <span class="conf-marker" title="Source data partial — see Invoices for the missing-invoice details">⚠ low</span>' : '';
    return `
      <div class="finance-factor">
        <div class="finance-factor-label">${escapeHtml(f.label)}</div>
        <div class="finance-factor-value">${value}${conf}</div>
      </div>`;
  }).join('');
  return `<div class="finance-headline-strip">${factors}</div>`;
}

function renderCashCard() {
  const accounts = ACCOUNTS.map(a => `<li><strong>${escapeHtml(a.name)}</strong>: ${EUR(a.current_balance)}</li>`).join('');
  const proj30 = PROJECTION_30.map(p => `<div class="proj-point">d+${p.day}<br><strong>${EUR(p.cash)}</strong></div>`).join('');
  const proj90 = PROJECTION_90.map(p => `<div class="proj-point">d+${p.day}<br><strong>${EUR(p.cash)}</strong></div>`).join('');
  return `
    <div class="finance-bignum">${EUR(TOTAL_CASH)} <span class="finance-bignum-sub">current cash</span></div>
    <ul>${accounts}</ul>
    <h3>30-day projection (tactical)</h3>
    <div class="proj-row">${proj30}</div>
    <h3>90-day projection (strategic)</h3>
    <div class="proj-row">${proj90}</div>
  `;
}

function renderRunwayCard() {
  const healthy = RUNWAY_DAYS >= THRESHOLDS.runway_alert_days;
  return `
    <div class="finance-bignum">${RUNWAY_DAYS} d <span class="finance-bignum-sub">runway estimate</span></div>
    <div>Threshold: <strong>${THRESHOLDS.runway_alert_days} d</strong> — status: ${healthy ? '🟢 healthy' : '🟡 watch'}</div>
    <div class="runway-conflict">
      ⚠ If Joost's planned €8K draw next month goes through: runway drops to <strong>${RUNWAY_WITH_PLANNED_DRAW} d</strong>
      (threshold: ${THRESHOLDS.draw_vs_runway_block_days} d). See active draw-adjust recommendation below.
    </div>
  `;
}

function renderRecCard(r) {
  const cur = r.target_ref.current_state || {};
  const prop = r.target_ref.proposed_state || {};
  const confTag = r.confidence === 'low' ? '⚠ low' : '✅ high';
  let body = '';
  if (r.category === 'expense-recategorization') {
    body = `
      <div class="rec-row"><strong>Vendor:</strong> ${escapeHtml(cur.vendor)}</div>
      <div class="rec-row"><strong>Current category:</strong> <code>${escapeHtml(cur.category)}</code></div>
      <div class="rec-row"><strong>Proposed:</strong> <code>${escapeHtml(prop.category)}</code></div>`;
  } else if (r.category === 'founder-draw-adjustment') {
    body = `
      <div class="rec-row"><strong>Founder:</strong> ${escapeHtml(cur.founder_name)}</div>
      <div class="rec-row"><strong>Requested:</strong> ${EUR(cur.requested_amount_eur)} for ${escapeHtml(cur.requested_month)}</div>
      <div class="rec-row"><strong>Suggested:</strong> ${EUR(prop.suggested_amount_eur)}</div>`;
  }
  return `
    <div class="card rec-card">
      <div class="rec-head">
        <span class="rec-id mono">${escapeHtml(r.recommendation_id)}</span>
        <span class="rec-cat">${escapeHtml(r.category)}</span>
        <span class="rec-conf">${confTag}</span>
      </div>
      ${body}
      <div class="rec-reasoning">${escapeHtml(r.reasoning)}</div>
      ${r.runway_impact_days ? `<div class="rec-impact">Runway impact: ${r.runway_impact_days > 0 ? '+' : ''}${r.runway_impact_days} days</div>` : ''}
    </div>`;
}
