// Costs view — Medivara Finance Module v1 (GEN-133).
//
// Substrate-backed cost surface per SPEC_v1 §3 (Costs tab). Reads materialized
// snapshots from bus/medivara/finance/snapshots/costs.json (written by the
// Orchestrator-side Python heartbeat) and ONBOARDING_STATE.json. Same
// substrate pattern as budget.js.
//
// Acceptance (GEN-133):
//   1. Ledger lines for current BU.
//   2. Recurring chip visible inline on repeat-vendor lines (every row tagged
//      `recurring` or `ad-hoc`).
//   3. Anomalies surface in a "Needs attention" strip with confidence badge —
//      uses the protocol-level renderClaim from assets/confidence.js (silent
//      mode per module.json `confidence_frame.mode`).
//   4. Drill into vendor / category via #costs?vendor=…&category=… filters.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson } from '../../../assets/substrate-client.js';
import { renderClaim } from '../../../assets/confidence.js';

const BU = 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${BU}/finance/${file}`;
const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const PCT = (n) => `${Math.round(n)}%`;

// Per module.json `confidence_frame.mode = silent_low_only` and SPEC_v1 §7.
const CONFIDENCE_SURFACE = { mode: 'silent' };

export async function renderCosts(_ctx) {
  const root = document.getElementById('route-costs');
  if (!root) return;
  root.innerHTML = '<div class="card"><div class="card-body">Loading Costs…</div></div>';

  const [snap, _conf, onboarding] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/costs.json'), null),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {} }),
    fetchSubstrateJson(baseRel('ONBOARDING_STATE.json'), null),
  ]);

  if (!onboarding || onboarding.status !== 'passed') {
    root.innerHTML = renderOnboardingBlock(onboarding);
    return;
  }
  if (!snap) {
    root.innerHTML = '<div class="card"><div class="card-body">No costs snapshot. Run the heartbeat.</div></div>';
    return;
  }

  const filters = parseHashFilters();
  const lines = buildLines(snap);
  const anomalies = lines.filter((l) => l.anomaly);
  const filtered = applyFilters(lines, filters);

  root.innerHTML = `
    <div class="finance-shell">
      <header class="finance-header">
        <h1>🪙 Finance — Medivara <span class="finance-tab-chip">Costs</span></h1>
        <div class="finance-meta">Snapshot: ${escapeHtml(snap.generated_at || '—')} · ${lines.length} line${lines.length === 1 ? '' : 's'}</div>
      </header>

      ${anomalies.length ? renderAttentionStrip(anomalies) : ''}

      <section class="finance-section costs-overview-grid">
        ${renderTotalsCard(lines)}
        ${renderSalariesCard(snap)}
        ${renderDrawsCard(snap)}
      </section>

      <section class="finance-section">
        <h2>Ledger ${renderFilterChips(filters)}</h2>
        ${renderLedgerCard(filtered, lines)}
      </section>

      ${renderOneOffHistory(snap)}
    </div>
  `;

  bindInteractions(root, filters);
}

// ============ Data shaping ============

// Project the snapshot's `recurring[]` array into the view's row shape.
// Per moneybird.md §5.3 the connector keeps categorization out — the bound
// agent attaches vendor/category/recurring/anomaly. The snapshot is the
// already-projected view of that overlay so the renderer stays presentation-
// only. v1 surfaces recurring lines only (recurring is the §3 first-class
// concept); ad-hoc journal lines extend this list once the agent flows them
// through.
function buildLines(snap) {
  return (snap.recurring || []).map((r) => {
    const amount = typeof r.monthly_amount === 'number' ? r.monthly_amount : null;
    const amountLabel = amount != null
      ? EUR(amount)
      : (typeof r.variable_pct_of_revenue === 'number'
        ? `${(r.variable_pct_of_revenue * 100).toFixed(2)}% of revenue`
        : '—');
    const anomaly = (r.confidence_marker === 'low' || r._anomaly_note)
      ? buildAnomalyClaim(r)
      : null;
    return {
      vendor: r.vendor,
      category: r.category,
      amount,
      amountLabel,
      recurring: true,
      note: r._anomaly_note || '',
      anomaly,
    };
  });
}

function buildAnomalyClaim(r) {
  const overall = r.confidence_marker || 'medium';
  const summary = r._anomaly_note
    || `${r.vendor} jumped out — review.`;
  const action = inferAnomalyAction(r);
  return {
    value: r.vendor,
    confidence: {
      overall,
      concerns: [{ summary, action }],
    },
  };
}

function inferAnomalyAction(r) {
  if (r._anomaly_recategorization_target) {
    return {
      kind: 'recategorize',
      label: `Move to ${r._anomaly_recategorization_target}`,
      href: `#costs?vendor=${encodeURIComponent(r.vendor)}`,
    };
  }
  return {
    kind: 'audit-data',
    label: 'Review line',
    href: `#costs?vendor=${encodeURIComponent(r.vendor)}`,
  };
}

// ============ Rendering ============

function renderAttentionStrip(anomalies) {
  const items = anomalies.map((l) => `
    <li class="costs-attention-item">
      <div class="costs-attention-head">
        <span class="costs-attention-vendor">${escapeHtml(l.vendor)}</span>
        <span class="costs-attention-amount mono">${escapeHtml(l.amountLabel)}</span>
      </div>
      <div class="costs-attention-claim">
        ${renderClaim(l.anomaly, CONFIDENCE_SURFACE, { formatValue: (v) => `Why ${v} is flagged` })}
      </div>
    </li>
  `).join('');
  return `
    <section class="finance-section">
      <div class="card costs-attention-card">
        <div class="costs-attention-card-head">
          <h2>Needs attention</h2>
          <span class="finance-pill costs-attention-count">${anomalies.length} flag${anomalies.length === 1 ? '' : 's'}</span>
        </div>
        <p class="finance-note">Cost lines the agent flagged. Confidence is per-line — open the badge to see why.</p>
        <ul class="costs-attention-list">${items}</ul>
      </div>
    </section>
  `;
}

function renderTotalsCard(lines) {
  const t = totals(lines);
  const recPct = t.fixed_total > 0 ? (t.fixed_total / (t.fixed_total || 1)) * 100 : 0;
  return `
    <div class="costs-overview-cell">
      <div class="finance-factor-label">RECURRING (FIXED)</div>
      <div class="finance-bignum">${EUR(t.fixed_total)}<span class="finance-bignum-sub">/mo</span></div>
      <div class="finance-note">${t.fixed_count} fixed line${t.fixed_count === 1 ? '' : 's'}${t.variable_count ? ` · ${t.variable_count} variable` : ''}</div>
    </div>
  `;
}

function renderSalariesCard(snap) {
  return `
    <div class="costs-overview-cell">
      <div class="finance-factor-label">SALARIES</div>
      <div class="finance-bignum">${EUR(snap.salaries_monthly_total)}<span class="finance-bignum-sub">/mo</span></div>
      <div class="finance-note">incl. variable comp</div>
    </div>
  `;
}

function renderDrawsCard(snap) {
  return `
    <div class="costs-overview-cell">
      <div class="finance-factor-label">FOUNDER DRAWS</div>
      <div class="finance-bignum">${EUR(snap.founder_draws_monthly)}<span class="finance-bignum-sub">/mo</span></div>
      <div class="finance-note">total across founders</div>
    </div>
  `;
}

function renderFilterChips(filters) {
  const chips = [];
  if (filters.vendor) chips.push(`<button type="button" class="costs-filter-chip" data-clear-vendor="1">vendor: ${escapeHtml(filters.vendor)} <span aria-hidden="true">×</span></button>`);
  if (filters.category) chips.push(`<button type="button" class="costs-filter-chip" data-clear-category="1">category: ${escapeHtml(filters.category)} <span aria-hidden="true">×</span></button>`);
  return chips.length ? `<span class="costs-filter-chips">${chips.join('')}</span>` : '';
}

function renderLedgerCard(rows, allRows) {
  if (rows.length === 0) {
    return `<div class="card"><div class="card-body finance-note">No lines match the current filter — ${allRows.length} total in the snapshot.</div></div>`;
  }
  const items = rows.map(renderLedgerRow).join('');
  return `
    <table class="finance-table costs-ledger-table">
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Category</th>
          <th>Cadence</th>
          <th>Monthly</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>
  `;
}

function renderLedgerRow(l) {
  const recurringChip = l.recurring
    ? `<span class="costs-chip costs-chip-recurring" title="Same vendor + similar amount, repeated monthly.">recurring</span>`
    : `<span class="costs-chip costs-chip-adhoc">ad-hoc</span>`;
  const anomalyMark = l.anomaly
    ? ` <span class="conf-marker" title="See Needs attention strip">⚠ flagged</span>`
    : '';
  return `
    <tr class="costs-ledger-row${l.anomaly ? ' costs-ledger-row--flagged' : ''}">
      <td><button type="button" class="costs-row-vendor" data-vendor="${escapeHtml(l.vendor)}">${escapeHtml(l.vendor)}</button></td>
      <td><button type="button" class="costs-row-category" data-category="${escapeHtml(l.category)}"><code>${escapeHtml(l.category)}</code></button>${anomalyMark}</td>
      <td>${recurringChip}</td>
      <td class="mono">${escapeHtml(l.amountLabel)}</td>
      <td class="finance-note">${escapeHtml(l.note)}</td>
    </tr>
  `;
}

function renderOneOffHistory(snap) {
  const items = (snap.one_off_history || []).map((o) =>
    `<li><span class="mono">${escapeHtml(o.month)}</span> · ${EUR(o.amount)}${o.note ? ` · <span class="finance-note">${escapeHtml(o.note)}</span>` : ''}</li>`,
  ).join('');
  if (!items) return '';
  return `
    <section class="finance-section">
      <h2>One-off spend (history)</h2>
      <ul class="costs-one-off-list">${items}</ul>
    </section>
  `;
}

function renderOnboardingBlock(state) {
  const checks = state?.checks || {};
  return `
    <div class="card">
      <div class="card-body">
        <h2>🪙 Finance — L1 onboarding incomplete</h2>
        <p>Finance Stewart of Medivara refuses to render numbers until onboarding completeness check passes (PLAYBOOK §4).</p>
        <ul>
          <li>Connector probe: ${checks.connector_probe?.pass ? '✅' : '❌'} — ${escapeHtml(checks.connector_probe?.detail || '—')}</li>
          <li>Category coverage: ${checks.category_coverage?.pass ? '✅' : '❌'} — missing: ${(checks.category_coverage?.missing || []).join(', ') || 'none'}</li>
          <li>Data freshness: ${checks.data_freshness?.pass ? '✅' : '❌'} — last sync ${escapeHtml(checks.data_freshness?.last_sync_at || '—')}</li>
          <li>Identity binding: ${checks.identity_binding?.pass ? '✅' : '❌'} — ${escapeHtml(checks.identity_binding?.detail || '—')}</li>
        </ul>
        <p>Run the heartbeat: <code>python -m dashboard.scripts.finance.heartbeat --bu medivara</code></p>
      </div>
    </div>`;
}

// ============ Helpers ============

function applyFilters(lines, { vendor, category }) {
  return lines.filter((l) => {
    if (vendor && l.vendor !== vendor) return false;
    if (category && l.category !== category) return false;
    return true;
  });
}

function totals(lines) {
  let fixed_total = 0, variable_total = 0, fixed_count = 0, variable_count = 0;
  for (const l of lines) {
    if (l.amount != null) { fixed_total += l.amount; fixed_count += 1; }
    else { variable_count += 1; }
  }
  return { fixed_total, variable_total, fixed_count, variable_count };
}

function parseHashFilters() {
  const hash = (typeof window !== 'undefined' && window.location && window.location.hash) || '';
  const qIndex = hash.indexOf('?');
  if (qIndex < 0) return { vendor: null, category: null };
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return {
    vendor: params.get('vendor'),
    category: params.get('category'),
  };
}

function setFilters({ vendor, category }) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (vendor) params.set('vendor', vendor);
  if (category) params.set('category', category);
  const qs = params.toString();
  window.location.hash = qs ? `#costs?${qs}` : '#costs';
}

function bindInteractions(root, filters) {
  root.querySelectorAll('[data-vendor]').forEach((el) => {
    el.addEventListener('click', () => setFilters({ vendor: el.dataset.vendor, category: filters.category }));
  });
  root.querySelectorAll('[data-category]').forEach((el) => {
    el.addEventListener('click', () => setFilters({ vendor: filters.vendor, category: el.dataset.category }));
  });
  const clearV = root.querySelector('[data-clear-vendor]');
  if (clearV) clearV.addEventListener('click', () => setFilters({ vendor: null, category: filters.category }));
  const clearC = root.querySelector('[data-clear-category]');
  if (clearC) clearC.addEventListener('click', () => setFilters({ vendor: filters.vendor, category: null }));
}

export const _testHooks = { buildLines, applyFilters, totals };
