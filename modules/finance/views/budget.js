// Cash view — Finance Module v1, GEN-132.
//
// Multi-tab headline view per SPEC_v1.md §3: Cash · Revenue · Costs · Runway.
// Dual rolling window per spec: 30d tactical (default) + 90d strategic toggle
// that applies to every tab.
//
// Architecture (per SPEC §5):
//   - Moneybird (via MCP) is the data source. Read path runs server-side
//     through the Genus agent (Orchestrator's `dashboard.scripts.finance.heartbeat`)
//     which materializes snapshots into `bus/medivara/finance/snapshots/*.json`.
//   - This view reads those snapshots through the substrate proxy. It never
//     calls Moneybird directly.
//
// L1 onboarding gate: refuses to render figures unless ONBOARDING_STATE.status
// is 'passed' (PLAYBOOK §4 — Finance Stewart will not surface numbers from
// an unverified install).
//
// ConfidenceFrame integration (GEN-110 protocol):
//   - Every figure is wrapped in a claim payload and rendered through
//     renderClaim, so badges follow the protocol contract — not ad-hoc markers.
//   - L1 (mental_model) — CONFIDENCE_STATE.layer_states.services_should_exist
//   - L2 (data_grounding) — CONFIDENCE_STATE.layer_states.invoices_present +
//     connector staleness window (cash.generated_at age)
//   - L3 (coherence) — CONFIDENCE_STATE.layer_states.anomalies +
//     per_figure low markers
//
// Composite Health headline (per [[sage-confidence-ui-single-headline]]):
//   ONE figure at the top — weakest-link across the four tabs. Per-tab
//   breakdown lives in the hover tooltip, not as separate headlines.

import { escapeHtml } from '../../../assets/utils.js';
import { renderClaim } from '../../../assets/confidence.js';
import { fetchSubstrateJson, fetchSubstrateJsonl } from '../../../assets/substrate-client.js';

const BU = 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${BU}/finance/${file}`;
const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const SURFACE = { mode: 'silent', label: 'cash-view' };
const STALE_AGE_S = 24 * 3600;

const TABS = [
  { id: 'cash',    label: 'Cash' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'costs',   label: 'Costs' },
  { id: 'runway',  label: 'Runway' },
];

const state = {
  data: null,
  health: null,
  tab: 'cash',
  window: '30d',
};

// ============ Entrypoint ============

export async function renderBudget(_ctx) {
  const root = document.getElementById('route-budget');
  if (!root) return;
  syncStateFromUrl();

  if (state.data) {
    paint(root);
    return;
  }

  root.innerHTML = renderSkeleton();
  try {
    state.data = await loadAll();
    if (state.data.onboarding?.status !== 'passed') {
      root.innerHTML = renderOnboardingBlock(state.data.onboarding);
      return;
    }
    state.health = composeHealth(state.data);
    paint(root);
  } catch (err) {
    root.innerHTML = renderError(err);
  }
}

async function loadAll() {
  const [cash, revenue, costs, runway, headline, recs, conf, onboarding] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/cash.json'), null),
    fetchSubstrateJson(baseRel('snapshots/revenue.json'), null),
    fetchSubstrateJson(baseRel('snapshots/costs.json'), null),
    fetchSubstrateJson(baseRel('snapshots/runway.json'), null),
    fetchSubstrateJson(baseRel('snapshots/headline.json'), null),
    fetchSubstrateJsonl(baseRel('RECOMMENDATION_LEDGER.jsonl')),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {}, layer_states: {} }),
    fetchSubstrateJson(baseRel('ONBOARDING_STATE.json'), null),
  ]);
  return { cash, revenue, costs, runway, headline, recs: recs || [], conf, onboarding };
}

// ============ Paint + interactions ============

function paint(root) {
  root.innerHTML = `
    <div class="finance-shell cash-shell">
      ${renderHeader(state.health, state.data)}
      ${renderTabs(state.tab)}
      <div class="cash-tab-body">
        ${renderActiveTab()}
      </div>
    </div>
  `;
  wireInteractions(root);
}

function wireInteractions(root) {
  root.querySelectorAll('[data-cash-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.cashTab;
      if (next === state.tab) return;
      state.tab = next;
      writeStateToUrl();
      paint(root);
    });
  });
  root.querySelectorAll('[data-cash-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.cashWindow;
      if (next === state.window) return;
      state.window = next;
      writeStateToUrl();
      paint(root);
    });
  });
}

// ============ ConfidenceFrame helpers ============

function isConnectorStale(data) {
  if (!data?.cash?.generated_at) return false;
  try {
    const ageS = Math.floor((Date.now() - new Date(data.cash.generated_at).getTime()) / 1000);
    return ageS > STALE_AGE_S;
  } catch {
    return false;
  }
}

function staleConcerns(data) {
  if (!isConnectorStale(data)) return [];
  return [{
    summary: 'Bookkeeping snapshot is over 24 hours old — figures may not reflect the latest activity.',
    action: { kind: 'connect-source', label: 'Check connector', href: '#settings' },
  }];
}

function confidenceFor(figureKey, data, extraConcerns = []) {
  const perFigure = data?.conf?.per_figure || {};
  let level = perFigure[figureKey] || 'high';
  const concerns = [...extraConcerns, ...staleConcerns(data)];
  if (isConnectorStale(data)) level = 'low';
  return concerns.length > 0
    ? { overall: level, concerns }
    : level;
}

function figure(value, formatter, figureKey, extraConcerns = []) {
  const claim = {
    value,
    confidence: confidenceFor(figureKey, state.data, extraConcerns),
  };
  return renderClaim(claim, SURFACE, { formatValue: formatter });
}

// ============ Health composite (single weakest-link headline) ============

function composeHealth(data) {
  const byTab = {
    cash:    computeCashHealth(data),
    revenue: computeRevenueHealth(data),
    costs:   computeCostsHealth(data),
    runway:  computeRunwayHealth(data),
  };
  const overall = worstOf(Object.values(byTab).map((b) => b.status));
  return { overall, byTab };
}

function worstOf(statuses) {
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

function computeCashHealth(data) {
  if (isConnectorStale(data)) {
    return { status: 'red', reason: 'Connector stale > 24h — cash figure may not match reality.' };
  }
  if (!data.cash?.accounts?.length) {
    return { status: 'red', reason: 'No accounts read from Moneybird.' };
  }
  const lvl = data.conf?.per_figure?.cash_position;
  if (lvl === 'low') return { status: 'yellow', reason: 'Cash position confidence low.' };
  return { status: 'green', reason: 'Cash position freshly synced.' };
}

function computeRevenueHealth(data) {
  const flagged = (data.revenue?.history || []).find((h) => h.missing_invoice);
  if (flagged) {
    const m = flagged.missing_invoice;
    return {
      status: 'yellow',
      reason: `${m.vendor} ${monthLabel(m.month)} invoice missing in Moneybird — affects net revenue.`,
    };
  }
  return { status: 'green', reason: 'Revenue series reconciles against bookings.' };
}

function computeCostsHealth(data) {
  const flagged = (data.costs?.recurring || []).filter((r) => r.confidence_marker === 'low' || r._anomaly_recategorization_target);
  if (flagged.length === 0) {
    return { status: 'green', reason: 'No recategorization candidates flagged.' };
  }
  const r = flagged[0];
  const target = r._anomaly_recategorization_target;
  if (target) {
    return { status: 'yellow', reason: `${r.vendor} categorized as ${r.category} — likely ${target}.` };
  }
  return { status: 'yellow', reason: `${r.vendor} flagged for review.` };
}

function computeRunwayHealth(data) {
  const days = data.runway?.runway_days;
  const drawDays = data.runway?.runway_with_planned_draw;
  const alertAt = data.runway?.thresholds?.runway_alert_days ?? 90;
  const blockAt = data.runway?.thresholds?.draw_vs_runway_block_days ?? 60;
  if (days != null && days < alertAt) {
    return { status: 'red', reason: `Runway ${days}d below ${alertAt}d alert threshold.` };
  }
  if (drawDays != null && drawDays < alertAt) {
    return {
      status: drawDays < blockAt ? 'red' : 'yellow',
      reason: `Planned draw would drop runway to ${drawDays}d — crosses ${alertAt}d threshold.`,
    };
  }
  return { status: 'green', reason: 'Runway projection within thresholds.' };
}

// ============ Header (Health + window toggle) ============

function renderHeader(health, data) {
  if (!health) return '';
  const overall = health.overall;
  const toneCls = `cash-health-${overall}`;
  const label = ({ green: 'Healthy', yellow: 'Caution', red: 'Action needed' })[overall];
  const reasons = TABS
    .map((t) => ({ label: t.label, ...health.byTab[t.id] }))
    .filter((r) => r.status !== 'green');

  const tipBody = reasons.length === 0
    ? '<li class="cash-health-reason cash-health-reason-ok">All four tabs healthy.</li>'
    : reasons.map((r) => `
        <li class="cash-health-reason">
          <span class="mono cash-health-reason-tab cash-health-${r.status}">${escapeHtml(r.label.toUpperCase())}</span>
          <span class="cash-health-reason-text">${escapeHtml(r.reason)}</span>
        </li>
      `).join('');

  const generatedAt = data?.cash?.generated_at || '—';

  return `
    <div class="card cash-header-card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Cash flow · Medivara</span>
          <p class="card-sub">Multi-tab headline view · Moneybird connector · synced ${escapeHtml(generatedAt)}</p>
        </div>
        ${renderWindowToggle(state.window)}
      </div>

      <div class="cash-health-row">
        <span class="cash-health-dot cash-health-dot-${overall}" aria-hidden="true"></span>
        <span class="cash-health-label ${toneCls}">Health · ${escapeHtml(label)}</span>
        <span class="cash-health-tip-anchor" tabindex="0" aria-describedby="cash-health-tip">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
          <span id="cash-health-tip" role="tooltip" class="cash-health-tip">
            <span class="cash-health-tip-title">Weakest-link across the four tabs</span>
            <ul class="cash-health-reasons">${tipBody}</ul>
          </span>
        </span>
      </div>
    </div>
  `;
}

function renderWindowToggle(current) {
  const opts = [['30d', '30 days'], ['90d', '90 days']];
  return `
    <div class="cash-window-toggle" role="tablist" aria-label="Projection window">
      ${opts.map(([id, label]) => `
        <button type="button" role="tab" aria-selected="${id === current}"
                class="cash-window-btn${id === current ? ' is-current' : ''}"
                data-cash-window="${id}">${label}</button>
      `).join('')}
    </div>
  `;
}

function renderTabs(current) {
  return `
    <div class="subtab-nav cash-tab-nav" role="tablist" aria-label="Cash view tabs">
      ${TABS.map((t) => `
        <button type="button" role="tab" aria-selected="${t.id === current}"
                class="subtab-link${t.id === current ? ' current' : ''}"
                data-cash-tab="${t.id}">${escapeHtml(t.label)}</button>
      `).join('')}
    </div>
  `;
}

// ============ Tab bodies ============

function renderActiveTab() {
  switch (state.tab) {
    case 'cash':    return renderCashTab(state.data);
    case 'revenue': return renderRevenueTab(state.data);
    case 'costs':   return renderCostsTab(state.data);
    case 'runway':  return renderRunwayTab(state.data);
    default:        return '';
  }
}

function renderCashTab(d) {
  const cash = d.cash || {};
  const accounts = cash.accounts || [];
  const proj = (state.window === '30d' ? cash.projection_30d : cash.projection_90d) || [];
  const endingPoint = proj[proj.length - 1];
  const startPoint  = proj[0];
  const delta = endingPoint && startPoint ? (endingPoint.cash - startPoint.cash) : 0;

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Cash on hand</span>
          <p class="card-sub">Across configured accounts, current snapshot.</p>
        </div>
      </div>
      <div class="cash-figure-grid">
        ${renderFigureCard('CASH ON HAND', figure(cash.current_balance_eur, EUR, 'cash_position'),
          `across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`)}
        ${renderFigureCard(`PROJECTED · ${state.window.toUpperCase()}`,
          figure(endingPoint?.cash, EUR, 'cash_position'),
          `${delta >= 0 ? '+' : ''}${EUR(delta)} over window`)}
      </div>

      <div class="cash-accounts-list">
        ${accounts.map((a) => `
          <div class="cash-account-row">
            <span class="cash-account-name">${escapeHtml(a.name)}</span>
            <span class="mono cash-account-balance">${figure(a.current_balance, EUR, 'cash_position')}</span>
          </div>
        `).join('')}
      </div>

      <h3 class="cash-section-sub">Forward projection · ${state.window === '30d' ? '30 days' : '90 days'}</h3>
      <div class="cash-proj-strip">
        ${proj.map((p) => `
          <div class="cash-proj-point" title="${EUR(p.cash)}">
            <span class="mono cash-proj-day">d+${p.day}</span>
            <span class="mono cash-proj-val">${EUR(p.cash)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderRevenueTab(d) {
  const rev = d.revenue || {};
  const history = rev.history || [];
  const months = state.window === '30d' ? 1 : 3;
  const window = history.slice(-months);
  const invoiced = window.reduce((s, m) => s + (m.revenue_gross || 0), 0);

  const flagged = window.find((m) => m.missing_invoice);
  const missingConcerns = flagged ? [{
    summary: `${flagged.missing_invoice.vendor} ${monthLabel(flagged.missing_invoice.month)} invoice not in Moneybird (expected ${EUR(flagged.missing_invoice.expected_amount_eur)}).`,
    action: { kind: 'audit-data', label: 'Open audit' },
  }] : [];

  const trailingAvg = avgRevenue(history, 3);
  const expected = trailingAvg * months;

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Revenue</span>
          <p class="card-sub">Invoiced + expected, separated. ${labelForWindow(state.window)}.</p>
        </div>
        <div class="cash-pill mono">MRR ${EUR(rev.mrr_eur)}</div>
      </div>
      <div class="cash-figure-grid">
        ${renderFigureCard(`INVOICED (${state.window.toUpperCase()})`,
          renderClaim({
            value: invoiced,
            confidence: missingConcerns.length
              ? { overall: 'medium', concerns: missingConcerns }
              : confidenceFor('cash_position', d),
          }, SURFACE, { formatValue: EUR }),
          `across ${window.length} month${window.length === 1 ? '' : 's'}`)}
        ${renderFigureCard(`EXPECTED NEXT ${state.window.toUpperCase()}`,
          renderClaim({ value: expected, confidence: { overall: 'medium', concerns: [] } },
            SURFACE, { formatValue: EUR }),
          'trailing 3-mo avg × window')}
        ${renderFigureCard('ACTIVE CUSTOMERS',
          renderClaim({ value: rev.active_customers, confidence: 'high' }, SURFACE),
          'customers paying MRR')}
      </div>

      <h3 class="cash-section-sub">By tier</h3>
      <div class="cash-tier-grid">
        ${Object.entries(rev.by_tier || {}).map(([tier, info]) => `
          <div class="cash-tier-cell">
            <span class="mono cash-tier-label">${escapeHtml(tier.toUpperCase())}</span>
            <span class="cash-tier-value">${EUR(info.mrr)}</span>
            <span class="cash-tier-sub">${info.count} customers</span>
          </div>
        `).join('')}
      </div>

      <h3 class="cash-section-sub">Monthly revenue · trailing</h3>
      <div class="cash-month-series-grid">
        ${renderRevenueSeries(history)}
      </div>
    </div>
  `;
}

function renderCostsTab(d) {
  const costs = d.costs || {};
  const recurring = costs.recurring || [];
  const months = state.window === '30d' ? 1 : 3;
  const fixedRecurring = recurring.reduce((s, r) => s + (r.monthly_amount || 0), 0);
  const salariesWindow = (costs.salaries_monthly_total || 0) * months;
  const drawsWindow = (costs.founder_draws_monthly || 0) * months;
  const adhocWindow = (costs.one_off_history || [])
    .slice(-months)
    .reduce((s, o) => s + (o.amount || 0), 0);

  const recatRows = recurring.filter((r) => r._anomaly_recategorization_target);
  const recatConcerns = recatRows.map((r) => ({
    summary: `${r.vendor} is in ${r.category} — looks like ${r._anomaly_recategorization_target}.`,
    action: { kind: 'recategorize', label: 'Recategorize' },
  }));

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Costs</span>
          <p class="card-sub">Fixed recurring · salaries · founder draws · ad-hoc. ${labelForWindow(state.window)}.</p>
        </div>
      </div>
      <div class="cash-figure-grid">
        ${renderFigureCard('FIXED RECURRING / MO',
          renderClaim({
            value: fixedRecurring,
            confidence: recatConcerns.length
              ? { overall: 'medium', concerns: recatConcerns }
              : confidenceFor('recurring_costs_map', d),
          }, SURFACE, { formatValue: EUR }),
          `${recurring.length} subscriptions + services`)}
        ${renderFigureCard(`SALARIES (${state.window.toUpperCase()})`,
          figure(salariesWindow, EUR, 'recurring_costs_map'),
          `${EUR(costs.salaries_monthly_total)}/mo posted`)}
        ${renderFigureCard(`FOUNDER DRAWS (${state.window.toUpperCase()})`,
          figure(drawsWindow, EUR, 'recurring_costs_map'),
          `${EUR(costs.founder_draws_monthly)}/mo`)}
        ${renderFigureCard(`AD-HOC (${state.window.toUpperCase()})`,
          figure(adhocWindow, EUR, 'recurring_costs_map'),
          'one-off spend posted')}
      </div>

      <h3 class="cash-section-sub">Recurring breakdown</h3>
      <div class="cash-cat-list">
        ${recurring.map((r) => {
          const flagged = !!r._anomaly_recategorization_target;
          const amount = r.monthly_amount > 0
            ? EUR(r.monthly_amount)
            : '<span class="cash-cat-faint mono">variable</span>';
          return `
            <div class="cash-cat-row${flagged ? ' is-flagged' : ''}">
              <span class="cash-cat-vendor">${escapeHtml(r.vendor)}</span>
              <span class="cash-cat-cat mono">${escapeHtml(r.category)}</span>
              <span class="mono cash-cat-amount">${amount}</span>
              ${flagged
                ? `<span class="cash-cat-flag mono" title="${escapeHtml(r._anomaly_note || '')}">RECAT → ${escapeHtml(r._anomaly_recategorization_target)}</span>`
                : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderRunwayTab(d) {
  const runway = d.runway || {};
  const days = runway.runway_days;
  const drawDays = runway.runway_with_planned_draw;
  const th = runway.thresholds || {};
  const burnHistory = runway.history_burn || [];
  const lookback = state.window === '30d' ? 1 : 3;
  const burnSeries = burnHistory.slice(-lookback);
  const avgBurn = burnSeries.length
    ? burnSeries.reduce((s, m) => s + Math.abs(m.net_eur || 0), 0) / burnSeries.length
    : 0;

  const drawConcerns = drawDays != null && drawDays < (th.runway_alert_days ?? 90) ? [{
    summary: `Planned founder draw would drop runway to ${drawDays}d — crosses the ${th.runway_alert_days}d alert threshold.`,
    action: { kind: 'operator-confirm', label: 'Review draw' },
  }] : [];

  const daysFmt = (n) => n == null ? '—' : n >= 9999 ? '∞' : `${n} d`;
  const status = days != null && days >= (th.runway_alert_days ?? 90) ? '🟢 healthy' : '🟡 watch';

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Runway</span>
          <p class="card-sub">Days of cash at current burn. ${labelForWindow(state.window)}.</p>
        </div>
        <span class="mono cash-pill">${status}</span>
      </div>
      <div class="cash-figure-grid">
        ${renderFigureCard('DAYS REMAINING',
          renderClaim({
            value: days,
            confidence: drawConcerns.length
              ? { overall: 'medium', concerns: drawConcerns }
              : confidenceFor('runway_days', d),
          }, SURFACE, { formatValue: daysFmt }),
          `alert at ${th.runway_alert_days ?? 90}d, block at ${th.draw_vs_runway_block_days ?? 60}d`)}
        ${renderFigureCard(`WITH PLANNED DRAW`,
          renderClaim({
            value: drawDays,
            confidence: drawConcerns.length
              ? { overall: 'medium', concerns: drawConcerns }
              : 'high',
          }, SURFACE, { formatValue: daysFmt }),
          'if planned draw goes through')}
        ${renderFigureCard(`BURN (${state.window.toUpperCase()})`,
          figure(avgBurn, EUR, 'runway_days'),
          'avg monthly net burn over window')}
      </div>

      ${drawConcerns.length ? `
        <div class="runway-conflict">
          ⚠ Planned founder draw would push runway to <strong>${drawDays}d</strong> (threshold: ${th.draw_vs_runway_block_days}d block / ${th.runway_alert_days}d alert).
          See the Suggestions panel for the recommended adjustment.
        </div>
      ` : ''}

      <h3 class="cash-section-sub">Monthly net burn · trailing</h3>
      <div class="cash-burn-series">
        ${renderBurnSeries(burnHistory)}
      </div>
    </div>
  `;
}

// ============ Sub-blocks ============

function renderFigureCard(label, valueHtml, sub) {
  return `
    <div class="cash-figure">
      <span class="mono cash-figure-label">${escapeHtml(label)}</span>
      <span class="cash-figure-value">${valueHtml}</span>
      <span class="cash-figure-sub">${sub}</span>
    </div>
  `;
}

function renderRevenueSeries(history) {
  if (!history.length) return '';
  const max = Math.max(...history.map((m) => m.revenue_gross || 0)) * 1.1;
  return history.map((m) => `
    <div class="cash-month-col">
      <div class="cash-month-bar-wrap" title="${EUR(m.revenue_gross || 0)}">
        <div class="cash-month-bar cash-month-bar-rev${m.confidence === 'low' ? ' cash-month-bar-low' : ''}" style="height:${((m.revenue_gross || 0) / max * 100).toFixed(1)}%"></div>
      </div>
      <span class="mono cash-month-label">${escapeHtml(monthLabel(m.month))}</span>
      <span class="mono cash-month-val">${EUR(m.revenue_gross || 0)}</span>
    </div>
  `).join('');
}

function renderBurnSeries(history) {
  if (!history.length) return '';
  const max = Math.max(...history.map((m) => Math.abs(m.net_eur || 0))) * 1.1;
  return `
    <div class="cash-month-series-grid">
      ${history.map((m) => {
        const burn = Math.abs(m.net_eur || 0);
        const isPositive = (m.net_eur || 0) > 0;
        return `
          <div class="cash-month-col">
            <div class="cash-month-bar-wrap" title="${EUR(m.net_eur || 0)}">
              <div class="cash-month-bar cash-month-bar-${isPositive ? 'rev' : 'burn'}" style="height:${(burn / max * 100).toFixed(1)}%"></div>
            </div>
            <span class="mono cash-month-label">${escapeHtml(monthLabel(m.month))}</span>
            <span class="mono cash-month-val">${EUR(m.net_eur || 0)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ============ Projections / helpers ============

function avgRevenue(history, n) {
  const window = history.slice(-n);
  if (!window.length) return 0;
  return window.reduce((s, m) => s + (m.revenue_gross || 0), 0) / window.length;
}

function monthLabel(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function labelForWindow(w) {
  return w === '30d' ? 'Last 30 days, projected forward' : 'Last 90 days, projected forward';
}

// ============ Skeleton, error, onboarding ============

function renderSkeleton() {
  return `
    <div class="card cash-skeleton">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Cash flow</span>
          <p class="card-sub">Loading Moneybird snapshots…</p>
        </div>
      </div>
      <div class="cash-skeleton-bars">
        <div class="cash-skeleton-bar"></div>
        <div class="cash-skeleton-bar"></div>
        <div class="cash-skeleton-bar"></div>
      </div>
    </div>
  `;
}

function renderError(err) {
  return `
    <div class="card cash-error">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Cash view unavailable</span>
          <p class="card-sub">Could not read the Moneybird substrate.</p>
        </div>
      </div>
      <pre class="cash-error-pre mono">${escapeHtml(String(err && err.message || err))}</pre>
    </div>
  `;
}

function renderOnboardingBlock(state) {
  const checks = state?.checks || {};
  return `
    <div class="card cash-onboarding">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Finance — L1 onboarding incomplete</span>
          <p class="card-sub">Finance Stewart refuses to render numbers until onboarding completeness passes (PLAYBOOK §4).</p>
        </div>
      </div>
      <ul class="cash-onboarding-checks">
        <li>Connector probe: ${checks.connector_probe?.pass ? '✅' : '❌'} — ${escapeHtml(checks.connector_probe?.detail || '—')}</li>
        <li>Category coverage: ${checks.category_coverage?.pass ? '✅' : '❌'} — missing: ${(checks.category_coverage?.missing || []).join(', ') || 'none'}</li>
        <li>Data freshness: ${checks.data_freshness?.pass ? '✅' : '❌'} — last sync ${escapeHtml(checks.data_freshness?.last_sync_at || '—')}</li>
        <li>Identity binding: ${checks.identity_binding?.pass ? '✅' : '❌'} — ${escapeHtml(checks.identity_binding?.detail || '—')}</li>
      </ul>
      <p class="cash-onboarding-cta mono">Run the heartbeat: <code>python -m dashboard.scripts.finance.heartbeat --bu medivara</code></p>
    </div>
  `;
}

// ============ URL state ============

function syncStateFromUrl() {
  const raw = window.location.hash || '';
  const q = raw.split('?')[1];
  if (!q) return;
  const params = new URLSearchParams(q);
  const tab = params.get('tab');
  const win = params.get('window');
  if (TABS.some((t) => t.id === tab)) state.tab = tab;
  if (win === '30d' || win === '90d') state.window = win;
}

function writeStateToUrl() {
  const baseRoute = (window.location.hash || '#budget').split('?')[0] || '#budget';
  const params = new URLSearchParams({ tab: state.tab, window: state.window });
  const next = `${baseRoute}?${params.toString()}`;
  if (next !== window.location.hash) {
    history.replaceState(null, '', next);
  }
}
