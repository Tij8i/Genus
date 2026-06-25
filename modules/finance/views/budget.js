// Budget (Cash + Runway) view — Medivara Finance Module v1.
//
// Reads materialized snapshots from bus/medivara/finance/snapshots/cash.json
// and runway.json (written by the Orchestrator-side Python heartbeat).
//
// Renders SPEC §3 "Cash" tab content + the six always-visible factors strip
// + the active Recommendations card surface (filed by CAP-FIN-RECOMMEND-*).
//
// Substrate is fetched via the /api/substrate Pages Function which proxies
// to the Orchestrator repo. Per Session #18 shipping plan (Phase 3, GEN-132).

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson, fetchSubstrateJsonl } from '../../../assets/substrate-client.js';

const BU = 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${BU}/finance/${file}`;
const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));

export async function renderBudget(ctx) {
  const root = document.getElementById('route-budget');
  root.innerHTML = '<div class="card"><div class="card-body">Loading Finance snapshots…</div></div>';

  const [cash, runway, headline, recs, conf, onboarding] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/cash.json'), null),
    fetchSubstrateJson(baseRel('snapshots/runway.json'), null),
    fetchSubstrateJson(baseRel('snapshots/headline.json'), null),
    fetchSubstrateJsonl(baseRel('RECOMMENDATION_LEDGER.jsonl')),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {} }),
    fetchSubstrateJson(baseRel('ONBOARDING_STATE.json'), null),
  ]);

  if (!onboarding || onboarding.status !== 'passed') {
    root.innerHTML = renderOnboardingBlock(onboarding);
    return;
  }

  const pending = (recs || []).filter(r => r.outcome === 'pending');
  root.innerHTML = `
    <div class="finance-shell">
      <header class="finance-header">
        <h1>🪙 Finance — Medivara <span class="finance-tab-chip">Cash · Runway</span></h1>
        <div class="finance-meta">L1 onboarding: <strong>passed</strong> · Connector: <code>moneybird_medivara</code> (fixture) · Heartbeat: ${escapeHtml(cash?.generated_at || '—')}</div>
      </header>

      ${headline ? renderHeadlineStrip(headline) : ''}

      <section class="finance-section">
        <h2>Cash position</h2>
        ${renderCashCard(cash, conf)}
      </section>

      <section class="finance-section">
        <h2>Runway</h2>
        ${renderRunwayCard(runway, conf)}
      </section>

      <section class="finance-section">
        <h2>Recommendations <span class="finance-pill">${pending.length} pending</span></h2>
        ${pending.length === 0
          ? '<div class="card"><div class="card-body">No open recommendations.</div></div>'
          : pending.map(renderRecCard).join('')}
      </section>
    </div>
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

function renderHeadlineStrip(h) {
  const factor = (f) => {
    const label = escapeHtml(f.label);
    let value = '—';
    if (typeof f.value_eur === 'number') value = EUR(f.value_eur);
    else if (typeof f.value_days === 'number') value = `${f.value_days} d`;
    else if (typeof f.value_pct === 'number') value = `${f.value_pct.toFixed(1)}%`;
    const conf = f.confidence === 'low' ? ' <span class="conf-marker" title="Why this might be wrong">⚠ low</span>' : '';
    return `<div class="finance-factor"><div class="finance-factor-label">${label}</div><div class="finance-factor-value">${value}${conf}</div></div>`;
  };
  return `<div class="finance-headline-strip">${(h.factors || []).map(factor).join('')}</div>`;
}

function renderCashCard(cash, conf) {
  if (!cash) return '<div class="card"><div class="card-body">No cash snapshot.</div></div>';
  const confTag = (key) => conf?.per_figure?.[key] === 'low' ? ' <span class="conf-marker" title="Source data partial">⚠ low</span>' : '';
  const accounts = (cash.accounts || []).map(a => `<li><strong>${escapeHtml(a.name)}</strong>: ${EUR(a.current_balance)}</li>`).join('');
  const proj30 = (cash.projection_30d || []).map(p => `<div class="proj-point">d+${p.day}: ${EUR(p.cash)}</div>`).join('');
  const proj90 = (cash.projection_90d || []).map(p => `<div class="proj-point">d+${p.day}: ${EUR(p.cash)}</div>`).join('');
  return `
    <div class="card">
      <div class="card-body">
        <div class="finance-bignum">${EUR(cash.current_balance_eur)} <span class="finance-bignum-sub">current cash${confTag('cash_position')}</span></div>
        <ul>${accounts}</ul>
        <h3>30-day projection (tactical)</h3>
        <div class="proj-row">${proj30}</div>
        <h3>90-day projection (strategic)</h3>
        <div class="proj-row">${proj90}</div>
      </div>
    </div>`;
}

function renderRunwayCard(runway, conf) {
  if (!runway) return '<div class="card"><div class="card-body">No runway snapshot.</div></div>';
  const days = runway.runway_days >= 9999 ? '∞' : runway.runway_days;
  const draw = runway.runway_with_planned_draw;
  const th = runway.thresholds || {};
  const confTag = conf?.per_figure?.runway_days === 'low' ? ' <span class="conf-marker">⚠ low</span>' : '';
  const drawNote = draw !== null && draw !== undefined ? `
      <div class="runway-conflict">
        If planned founder draw goes through: runway drops to <strong>${draw} d</strong> (threshold: ${th.draw_vs_runway_block_days} d).
      </div>` : '';
  return `
    <div class="card">
      <div class="card-body">
        <div class="finance-bignum">${days} d <span class="finance-bignum-sub">runway${confTag}</span></div>
        <div>Threshold: <strong>${th.runway_alert_days} d</strong> — status:
          ${runway.runway_days >= th.runway_alert_days ? '🟢 healthy' : '🟡 watch'}</div>
        ${drawNote}
      </div>
    </div>`;
}

function renderRecCard(r) {
  const meta = r.target_ref || {};
  const cur = meta.current_state || {};
  const prop = meta.proposed_state || {};
  const conf = r.confidence === 'low' ? '⚠ low' : '✅ high';
  let body = '';
  if (r.category === 'expense-recategorization') {
    body = `
      <div class="rec-row"><strong>Vendor:</strong> ${escapeHtml(cur.vendor || '—')}</div>
      <div class="rec-row"><strong>Current category:</strong> <code>${escapeHtml(cur.category || '—')}</code></div>
      <div class="rec-row"><strong>Proposed:</strong> <code>${escapeHtml(prop.category || '—')}</code></div>`;
  } else if (r.category === 'founder-draw-adjustment') {
    body = `
      <div class="rec-row"><strong>Founder:</strong> ${escapeHtml(cur.founder_name || '—')}</div>
      <div class="rec-row"><strong>Requested:</strong> ${EUR(cur.requested_amount_eur)} for ${escapeHtml(cur.requested_month || '')}</div>
      <div class="rec-row"><strong>Suggested:</strong> ${EUR(prop.suggested_amount_eur)}</div>`;
  }
  return `
    <div class="card rec-card">
      <div class="card-body">
        <div class="rec-head">
          <span class="rec-id mono">${escapeHtml(r.recommendation_id)}</span>
          <span class="rec-cat">${escapeHtml(r.category)}</span>
          <span class="rec-conf">${conf}</span>
        </div>
        ${body}
        <div class="rec-reasoning">${escapeHtml(r.reasoning || '')}</div>
        ${r.runway_impact_days ? `<div class="rec-impact">Runway impact: ${r.runway_impact_days} days</div>` : ''}
      </div>
    </div>`;
}
