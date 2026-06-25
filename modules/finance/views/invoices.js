// Invoices view — GEN-134 (child F of GEN-123 v0.7 Finance build).
//
// Renders the three-state founder Invoices surface defined in
// docs/genus/modules/finance/SPEC_v1.md: To-Issue / Issued / Paid, plus the
// operator-defined "needs to be issued" flag on draft rows. Read-only v1 —
// no Moneybird write-back per SPEC §8.
//
// Data path:
//   1. Try fetching the normalized snapshot at `<bu>/finance/invoices.json`
//      (the shape declared by modules/finance/connectors/schemas/invoice.schema.json).
//   2. Fall back to an in-file Medivara-shaped fixture so the IA + interactions
//      ship before the Phase 3 snapshot writer + module loader (GEN-113) land.
//
// The view is agent-agnostic: it never talks to the Moneybird MCP directly.
// The Genus agent + bound Finance agent are responsible for materializing the
// snapshot file. When that lands, this view "goes live" with no code change.
//
// ConfidenceFrame: silent-low-only (per SPEC §7). The ingestion-completeness
// KPI in the header uses the shell renderer's `badge` affordance and surfaces
// a LOW marker only when material — never refuses to render the number.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson, substrateBase } from '../../../assets/substrate-client.js';
import { renderClaim } from '../../../assets/confidence.js';

// ============ Constants ============

const TAB_KEYS = ['to_issue', 'issued', 'paid'];
const TAB_LABELS = {
  to_issue: 'To issue',
  issued: 'Issued',
  paid: 'Paid',
};
const SORT_KEYS = ['age', 'amount', 'client'];
const SORT_LABELS = {
  age: 'Age',
  amount: 'Amount',
  client: 'Client',
};

// ============ Public entry ============

export function renderInvoices(ctx) {
  const root = document.getElementById('route-invoices');
  if (!root) return;

  const bu = (ctx && ctx.bu) || 'medivara';
  root.innerHTML = renderLoading();

  loadInvoiceState(bu).then((state) => {
    const initial = pickInitialTab(state.buckets);
    mount(root, { ...state, bu, tab: initial, sort: 'age', clientFilter: '' });
  }).catch((err) => {
    console.warn('[finance/invoices] failed to load state', err);
    mount(root, { ...EMPTY_STATE, bu, error: err && err.message ? err.message : String(err), tab: 'to_issue', sort: 'age', clientFilter: '' });
  });
}

// ============ Data loading ============

async function loadInvoiceState(bu) {
  const base = substrateBase(bu);
  const path = `${base}/finance/invoices.json`;
  // Fixture fallback ships with the shape contract — view stays useful even
  // before the snapshot writer ships.
  const snapshot = await fetchSubstrateJson(path, FIXTURE_SNAPSHOT);
  return normalizeSnapshot(snapshot);
}

function normalizeSnapshot(snapshot) {
  const generatedAt = snapshot.generated_at || null;
  const source = snapshot.source || 'fixture';
  const invoices = Array.isArray(snapshot.invoices) ? snapshot.invoices : [];

  // Bucket assignment per the normalized `status` enum
  // (modules/finance/connectors/schemas/invoice.schema.json):
  //   draft                          → to_issue
  //   unpaid | unpaid_overdue        → issued
  //   paid                           → paid
  //   written_off | other            → silently excluded from the three core
  //                                    buckets (the surface stays narrow per
  //                                    SPEC §1).
  const buckets = { to_issue: [], issued: [], paid: [] };
  for (const inv of invoices) {
    if (!inv || typeof inv !== 'object') continue;
    const bucket = bucketFor(inv.status);
    if (bucket) buckets[bucket].push(inv);
  }

  // Header KPI — ingestion completeness. Pulled from the snapshot envelope
  // when present (the Phase 3 writer fills it from CONFIDENCE_STATE);
  // otherwise synthesized from row-level signals so the renderer always has
  // a claim to draw.
  const completeness = snapshot.ingestion_completeness || synthesizeCompleteness(invoices);

  return { generatedAt, source, buckets, completeness, total: invoices.length };
}

function bucketFor(status) {
  if (status === 'draft') return 'to_issue';
  if (status === 'unpaid' || status === 'unpaid_overdue') return 'issued';
  if (status === 'paid') return 'paid';
  return null;
}

function pickInitialTab(buckets) {
  // Land the operator on the bucket that's likely most actionable first.
  if ((buckets.to_issue || []).some(needsIssueFlag)) return 'to_issue';
  if ((buckets.to_issue || []).length > 0) return 'to_issue';
  if ((buckets.issued || []).length > 0) return 'issued';
  return 'paid';
}

const EMPTY_STATE = {
  generatedAt: null,
  source: 'unavailable',
  buckets: { to_issue: [], issued: [], paid: [] },
  completeness: null,
  total: 0,
};

// ============ Mount + rerender ============

function mount(root, state) {
  root.innerHTML = renderBody(state);
  wireInteractions(root, state);
}

function wireInteractions(root, state) {
  root.querySelectorAll('[data-invoice-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-invoice-tab');
      if (!tab || tab === state.tab) return;
      mount(root, { ...state, tab });
    });
  });
  root.querySelectorAll('[data-invoice-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.getAttribute('data-invoice-sort');
      if (!sort || sort === state.sort) return;
      mount(root, { ...state, sort });
    });
  });
  const clientInput = root.querySelector('[data-invoice-client-filter]');
  if (clientInput) {
    clientInput.addEventListener('input', (e) => {
      const next = (e.target.value || '').trim();
      if (next === state.clientFilter) return;
      mount(root, { ...state, clientFilter: next });
      // Restore focus + caret position after re-render.
      const refocus = root.querySelector('[data-invoice-client-filter]');
      if (refocus) {
        refocus.focus();
        const v = refocus.value;
        refocus.setSelectionRange(v.length, v.length);
      }
    });
  }
}

// ============ Render ============

function renderLoading() {
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Invoices</span>
          <p class="card-sub">Loading from Moneybird…</p>
        </div>
      </div>
    </div>
  `;
}

function renderBody(state) {
  return `
    ${renderSourceHint(state)}
    ${renderKpiHeader(state)}
    ${renderTabBar(state)}
    ${renderControls(state)}
    ${renderList(state)}
  `;
}

function renderSourceHint(state) {
  // Be honest with the operator about whether figures are live or fixture.
  if (state.source === 'live' || state.source === 'snapshot') return '';
  const msg = state.source === 'unavailable'
    ? 'Snapshot unavailable — falling back to the fixture shape.'
    : 'Demo data shape — wires to live Moneybird once the snapshot writer lands (GEN-104 / Phase 3).';
  return `
    <div class="budget-hint mono">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
      ${escapeHtml(msg)}
    </div>
  `;
}

function renderKpiHeader(state) {
  const c = state.completeness;
  // ConfidenceFrame claim — value is the % completeness; confidence is the
  // structured wire payload per assets/confidence.js. The shell renderer
  // attaches the LOW badge only when material (silent-low-only).
  const claim = {
    value: c && typeof c.percent === 'number' ? c.percent : null,
    confidence: c && c.confidence ? c.confidence : { overall: 'unknown', concerns: [] },
  };
  const surface = { mode: 'silent' };
  const formatValue = (v) => (v == null ? '—' : `${Math.round(v)}%`);

  const generatedAtLabel = state.generatedAt
    ? `Last sync: ${formatTimestamp(state.generatedAt)}`
    : 'Last sync: —';

  return `
    <div class="card invoices-kpi-card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-section-label">INGESTION COMPLETENESS</span>
          <div class="invoices-kpi-value">
            ${renderClaim(claim, surface, { formatValue })}
          </div>
          <p class="card-sub">Share of expected invoices the agent could pull from Moneybird this period. Silent unless LOW per ConfidenceFrame.</p>
        </div>
        <span class="mono invoices-kpi-meta">${escapeHtml(generatedAtLabel)}</span>
      </div>
    </div>
  `;
}

function renderTabBar(state) {
  const items = TAB_KEYS.map((key) => {
    const count = (state.buckets[key] || []).length;
    const current = key === state.tab;
    const needsIssueCount = key === 'to_issue'
      ? (state.buckets.to_issue || []).filter(needsIssueFlag).length
      : 0;
    const flagDot = needsIssueCount > 0
      ? `<span class="invoices-tab-flagdot" title="${needsIssueCount} flagged 'needs to issue'"></span>`
      : '';
    return `
      <button type="button" class="subtab-link ${current ? 'current' : ''}" data-invoice-tab="${escapeHtml(key)}">
        ${flagDot}${escapeHtml(TAB_LABELS[key])}
        <span class="subtab-badge">${count}</span>
      </button>
    `;
  }).join('');
  return `<div class="subtab-nav invoices-tab-nav">${items}</div>`;
}

function renderControls(state) {
  const sortBtns = SORT_KEYS.map((key) => {
    const current = key === state.sort;
    return `
      <button type="button" class="task-filter-chip ${current ? 'current' : ''}" data-invoice-sort="${escapeHtml(key)}">
        Sort: ${escapeHtml(SORT_LABELS[key])}
      </button>
    `;
  }).join('');
  return `
    <div class="invoices-controls">
      <input type="search"
             class="invoices-client-filter mono"
             placeholder="Filter by client…"
             value="${escapeHtml(state.clientFilter)}"
             data-invoice-client-filter
             aria-label="Filter invoices by client name" />
      <div class="task-filter-bar invoices-sort-bar">${sortBtns}</div>
    </div>
  `;
}

function renderList(state) {
  const rows = applyFilters(state.buckets[state.tab] || [], state);
  if (rows.length === 0) {
    return renderEmptyForTab(state);
  }
  const headerExtra = state.tab === 'to_issue'
    ? '<span class="invoices-row-needsissue-head">FLAG</span>'
    : '';
  const cards = rows.map((inv) => renderRow(inv, state.tab)).join('');
  return `
    <div class="card invoices-list-card">
      <div class="invoices-row invoices-row-head mono">
        <span class="invoices-row-counterparty">CLIENT</span>
        <span class="invoices-row-ref">REF</span>
        <span class="invoices-row-issued">ISSUED</span>
        <span class="invoices-row-due">DUE</span>
        <span class="invoices-row-amount">AMOUNT</span>
        ${headerExtra}
      </div>
      ${cards}
    </div>
  `;
}

function renderEmptyForTab(state) {
  const tabLabel = TAB_LABELS[state.tab] || 'this view';
  const totalInTab = (state.buckets[state.tab] || []).length;
  const reason = totalInTab === 0
    ? `No invoices in <strong>${escapeHtml(tabLabel)}</strong> right now.`
    : `No invoices match the current filter in <strong>${escapeHtml(tabLabel)}</strong>.`;
  return `
    <div class="card">
      <div class="empty-cactus">
        <div class="empty-cactus-icon">🧾</div>
        <div class="empty-cactus-title">Nothing to show</div>
        <div class="empty-cactus-body">${reason}</div>
      </div>
    </div>
  `;
}

function renderRow(inv, tab) {
  const counterparty = (inv.counterparty && inv.counterparty.name) || '—';
  const ref = inv.external_ref || '—';
  const issuedLabel = formatDate(inv.issued_at);
  const dueLabel = inv.due_at ? formatDate(inv.due_at) : '—';
  const ageDays = daysAgo(inv.issued_at);
  const ageLabel = ageDays == null ? '' : `<span class="invoices-row-age-sub mono">${ageDays}d ago</span>`;
  const amountLabel = formatMoney(inv.amount_gross);
  const flagCell = tab === 'to_issue'
    ? `<span class="invoices-row-needsissue">${needsIssueFlag(inv) ? `<span class="invoices-flag-chip" title="${escapeHtml(needsIssueReason(inv) || 'Operator-flagged: needs to be issued.')}">NEEDS TO ISSUE</span>` : ''}</span>`
    : '';
  const overdueCls = inv.status === 'unpaid_overdue' ? ' invoices-row--overdue' : '';
  const directionCls = inv.direction === 'incoming' ? ' invoices-row--incoming' : '';
  const directionTag = inv.direction === 'incoming'
    ? '<span class="row-tag-mono invoices-row-direction" title="Purchase invoice (we owe a vendor)">IN</span>'
    : '';

  return `
    <div class="invoices-row${overdueCls}${directionCls}">
      <span class="invoices-row-counterparty">
        ${directionTag}<span class="invoices-row-counterparty-name">${escapeHtml(counterparty)}</span>
      </span>
      <span class="invoices-row-ref mono">${escapeHtml(ref)}</span>
      <span class="invoices-row-issued">
        <span>${escapeHtml(issuedLabel)}</span>
        ${ageLabel}
      </span>
      <span class="invoices-row-due">${escapeHtml(dueLabel)}</span>
      <span class="invoices-row-amount mono">${escapeHtml(amountLabel)}</span>
      ${flagCell}
    </div>
  `;
}

// ============ Filter + sort ============

function applyFilters(rows, state) {
  let out = rows.slice();
  if (state.clientFilter) {
    const needle = state.clientFilter.toLowerCase();
    out = out.filter((inv) => {
      const name = (inv.counterparty && inv.counterparty.name) || '';
      return name.toLowerCase().includes(needle);
    });
  }
  out.sort((a, b) => compareInvoices(a, b, state.sort));
  return out;
}

function compareInvoices(a, b, sort) {
  if (sort === 'amount') {
    return amountValue(b) - amountValue(a);
  }
  if (sort === 'client') {
    const an = ((a.counterparty && a.counterparty.name) || '').toLowerCase();
    const bn = ((b.counterparty && b.counterparty.name) || '').toLowerCase();
    return an.localeCompare(bn);
  }
  // 'age' — oldest first (highest age).
  const at = dateToMs(a.issued_at);
  const bt = dateToMs(b.issued_at);
  return at - bt;
}

// ============ Helpers ============

function needsIssueFlag(inv) {
  // The operator-defined trigger is set externally (typically: draft past
  // intended-issue date, or marked by the bound agent during the monthly
  // close). v1 accepts a few field names so the writer can pick whichever
  // fits the agent's memory schema without forcing a schema rev.
  return Boolean(
    inv && (
      inv.needs_to_issue === true
      || (inv.flags && inv.flags.needs_to_issue === true)
      || inv._needs_to_issue === true
    )
  );
}

function needsIssueReason(inv) {
  if (!inv) return null;
  if (typeof inv.needs_to_issue_reason === 'string') return inv.needs_to_issue_reason;
  if (inv.flags && typeof inv.flags.needs_to_issue_reason === 'string') return inv.flags.needs_to_issue_reason;
  return null;
}

function synthesizeCompleteness(invoices) {
  // Honest fallback when the snapshot envelope doesn't carry an explicit
  // completeness figure. Looks for invoices marked _missing or with a low
  // confidence rollup tag on the row itself.
  const total = invoices.length || 1;
  const missing = invoices.filter((inv) => inv && (inv._missing === true || inv.confidence === 'low')).length;
  const percent = Math.max(0, Math.min(100, Math.round(((total - missing) / total) * 100)));
  if (percent >= 95) {
    return { percent, confidence: { overall: 'high', concerns: [] } };
  }
  return {
    percent,
    confidence: {
      overall: 'low',
      concerns: [
        {
          summary: `${missing} expected invoice${missing === 1 ? '' : 's'} not found in the last sync window — the figure understates revenue if these are real.`,
          action: { kind: 'audit-data', label: 'Audit ingestion', href: '#settings' },
        },
      ],
    },
  };
}

function amountValue(inv) {
  const raw = inv && inv.amount_gross && inv.amount_gross.value;
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(money) {
  if (!money || money.value == null) return '—';
  const n = Number(money.value);
  if (!Number.isFinite(n)) return '—';
  const ccy = money.currency || 'EUR';
  const symbol = ccy === 'EUR' ? '€' : ccy === 'USD' ? '$' : ccy === 'GBP' ? '£' : '';
  const rounded = Math.round(n).toLocaleString('en-US');
  return symbol ? `${symbol}${rounded}` : `${rounded} ${ccy}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}`;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function dateToMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function daysAgo(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// ============ Fixture ============
//
// Medivara-shaped fixture matching modules/finance/connectors/schemas/invoice.schema.json.
// Used when the snapshot writer hasn't materialized `bus/<bu>/finance/invoices.json` yet.
// Mirrors the May/June 2026 window the operator has been working in.

const FIXTURE_SNAPSHOT = {
  source: 'fixture',
  generated_at: '2026-06-25T16:00:00Z',
  ingestion_completeness: {
    percent: 92,
    confidence: {
      overall: 'low',
      concerns: [
        {
          summary: 'May invoice from one recurring SaaS vendor missing — expected by the 5th of each month; today is past that.',
          action: { kind: 'audit-data', label: 'Audit ingestion', href: '#settings' },
        },
      ],
    },
  },
  invoices: [
    // ---- To-Issue (drafts; some flagged "needs to issue") ----
    {
      source: { system: 'moneybird', id: 'si-2026-0042' },
      external_ref: '2026-0042',
      direction: 'outgoing',
      counterparty: { ref: 'cust-001', name: 'Clinica Verde NL' },
      issued_at: '2026-06-22',
      due_at: '2026-07-22',
      status: 'draft',
      amount_gross: { value: '3630.00', currency: 'EUR' },
      amount_net: { value: '3000.00', currency: 'EUR' },
      needs_to_issue: true,
      needs_to_issue_reason: 'Draft from June close — not yet sent to client.',
    },
    {
      source: { system: 'moneybird', id: 'si-2026-0043' },
      external_ref: '2026-0043',
      direction: 'outgoing',
      counterparty: { ref: 'cust-004', name: 'Praktijk Boomgaard' },
      issued_at: '2026-06-24',
      due_at: '2026-07-24',
      status: 'draft',
      amount_gross: { value: '1815.00', currency: 'EUR' },
      amount_net: { value: '1500.00', currency: 'EUR' },
    },
    // ---- Issued (sent, awaiting payment; one overdue) ----
    {
      source: { system: 'moneybird', id: 'si-2026-0040' },
      external_ref: '2026-0040',
      direction: 'outgoing',
      counterparty: { ref: 'cust-002', name: 'NoorderlichtZorg' },
      issued_at: '2026-05-30',
      due_at: '2026-06-29',
      status: 'unpaid',
      amount_gross: { value: '5445.00', currency: 'EUR' },
      amount_net: { value: '4500.00', currency: 'EUR' },
    },
    {
      source: { system: 'moneybird', id: 'si-2026-0039' },
      external_ref: '2026-0039',
      direction: 'outgoing',
      counterparty: { ref: 'cust-003', name: 'GezondheidsHub Utrecht' },
      issued_at: '2026-05-15',
      due_at: '2026-06-14',
      status: 'unpaid_overdue',
      amount_gross: { value: '2420.00', currency: 'EUR' },
      amount_net: { value: '2000.00', currency: 'EUR' },
    },
    {
      source: { system: 'moneybird', id: 'pi-vendor-saas-may' },
      external_ref: 'INV-9912',
      direction: 'incoming',
      counterparty: { ref: 'vend-saas', name: 'Telematica Tools BV' },
      issued_at: '2026-06-01',
      due_at: '2026-06-30',
      status: 'unpaid',
      amount_gross: { value: '249.00', currency: 'EUR' },
      amount_net: { value: '205.79', currency: 'EUR' },
    },
    // ---- Paid (recent settlements) ----
    {
      source: { system: 'moneybird', id: 'si-2026-0037' },
      external_ref: '2026-0037',
      direction: 'outgoing',
      counterparty: { ref: 'cust-001', name: 'Clinica Verde NL' },
      issued_at: '2026-05-22',
      due_at: '2026-06-21',
      status: 'paid',
      amount_gross: { value: '3630.00', currency: 'EUR' },
      amount_net: { value: '3000.00', currency: 'EUR' },
    },
    {
      source: { system: 'moneybird', id: 'si-2026-0036' },
      external_ref: '2026-0036',
      direction: 'outgoing',
      counterparty: { ref: 'cust-005', name: 'Eerstelijns Zorgpark' },
      issued_at: '2026-05-18',
      due_at: '2026-06-17',
      status: 'paid',
      amount_gross: { value: '4235.00', currency: 'EUR' },
      amount_net: { value: '3500.00', currency: 'EUR' },
    },
    {
      source: { system: 'moneybird', id: 'pi-rent-may' },
      external_ref: 'HUUR-2026-05',
      direction: 'incoming',
      counterparty: { ref: 'vend-landlord', name: 'Vastgoed Amsterdam' },
      issued_at: '2026-05-01',
      due_at: '2026-05-31',
      status: 'paid',
      amount_gross: { value: '1200.00', currency: 'EUR' },
      amount_net: { value: '1200.00', currency: 'EUR' },
    },
  ],
};

// Exported for inline self-checks / future module-loader probes.
export { FIXTURE_SNAPSHOT as _testFixtureSnapshot, normalizeSnapshot as _testNormalizeSnapshot, bucketFor as _testBucketFor };
