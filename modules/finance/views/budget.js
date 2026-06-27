// Budget (Cash + Runway) view — Finance Module per-BU instance.
// Reads materialized snapshots from bus/<CURRENT_BU>/finance/snapshots/*.json.
// Each BU has its OWN Finance Stewart instance — own memory, ledger, recommendations.

import { escapeHtml } from '../../../assets/utils.js';
import { fetchSubstrateJson, fetchSubstrateJsonl } from '../../../assets/substrate-client.js';

const EUR = (n) => '€' + (Math.round(n || 0).toLocaleString('en-US'));
const CURRENT_BU = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'medivara';
const baseRel = (file) => `dashboard/public/data/bus/${CURRENT_BU}/finance/${file}`;

export async function renderBudget(_ctx) {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-budget'));
  if (!root) return;
  root.innerHTML = '<div class="card"><div class="card-body">Loading Finance Stewart of ' + escapeHtml(CURRENT_BU) + '…</div></div>';

  // Note: fetchSubstrateJson throws when fallback is null and file is missing.
  // Wrap each with .catch(()=>null) so Promise.all always resolves even if
  // the substrate hasn't been seeded yet (newly-installed Finance for this BU).
  const [cash, runway, recs, conf, onboarding] = await Promise.all([
    fetchSubstrateJson(baseRel('snapshots/cash.json'), null).catch(() => null),
    fetchSubstrateJson(baseRel('snapshots/runway.json'), null).catch(() => null),
    fetchSubstrateJsonl(baseRel('RECOMMENDATION_LEDGER.jsonl')).catch(() => []),
    fetchSubstrateJson(baseRel('CONFIDENCE_STATE.json'), { per_figure: {} }).catch(() => ({ per_figure: {} })),
    fetchSubstrateJson(baseRel('ONBOARDING_STATE.json'), null).catch(() => null),
  ]);

  if (!cash && !runway) {
    root.innerHTML = renderModuleNotActive();
    return;
  }
  if (!onboarding || onboarding.status !== 'passed') {
    root.innerHTML = renderOnboardingBlock(onboarding);
    return;
  }

  const pending = (recs || []).filter(r => r.outcome === 'pending');
  root.innerHTML = `
    <div class="finance-shell">
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">🪙 Cash + Runway — ${escapeHtml(CURRENT_BU)}</span>
            <p class="card-sub">L1 onboarding: <strong>passed</strong> · Heartbeat: ${escapeHtml(cash?.generated_at || '—')}</p>
          </div>
        </div>
      </div>
      ${cash ? renderCashCard(cash, conf) : ''}
      ${runway ? renderRunwayCard(runway, conf) : ''}
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left">
            <span class="card-title">Recommendations <span class="finance-pill">${pending.length} pending</span></span>
            <p class="card-sub">Filed by Finance Stewart of ${escapeHtml(CURRENT_BU)} per the 2 allowed categories (SPEC §4).</p>
          </div>
        </div>
        ${pending.length === 0 ? '<div class="card-body finance-note">No open recommendations.</div>' : pending.map(renderRecCard).join('')}
      </div>
    </div>
  `;
}

function renderModuleNotActive() {
  return `
    <div class="card">
      <div class="card-body">
        <h2>🪙 Finance — not active for ${escapeHtml(CURRENT_BU)}</h2>
        <p>No Finance Stewart instance is provisioned for this BU yet.</p>
        <p>To activate: <code>python -m dashboard.scripts.finance.heartbeat --bu ${escapeHtml(CURRENT_BU)}</code> (after wiring the BU's connector + per-BU substrate seed).</p>
      </div>
    </div>`;
}

function renderOnboardingBlock(state) {
  const checks = state?.checks || {};
  return `
    <div class="card">
      <div class="card-body">
        <h2>🪙 Finance — L1 onboarding incomplete</h2>
        <p>Finance Stewart of ${escapeHtml(CURRENT_BU)} refuses to render numbers until onboarding completeness check passes (PLAYBOOK §4).</p>
        <ul>
          <li>Connector probe: ${checks.connector_probe?.pass ? '✅' : '❌'} — ${escapeHtml(checks.connector_probe?.detail || '—')}</li>
          <li>Category coverage: ${checks.category_coverage?.pass ? '✅' : '❌'} — missing: ${(checks.category_coverage?.missing || []).join(', ') || 'none'}</li>
          <li>Data freshness: ${checks.data_freshness?.pass ? '✅' : '❌'} — last sync ${escapeHtml(checks.data_freshness?.last_sync_at || '—')}</li>
          <li>Identity binding: ${checks.identity_binding?.pass ? '✅' : '❌'} — ${escapeHtml(checks.identity_binding?.detail || '—')}</li>
        </ul>
      </div>
    </div>`;
}

function renderCashCard(cash, conf) {
  const confTag = (key) => conf?.per_figure?.[key] === 'low' ? ' <span class="conf-marker" title="Source data partial">⚠ low</span>' : '';
  const accounts = (cash.accounts || []).map(a => `<li><strong>${escapeHtml(a.name)}</strong>: ${EUR(a.current_balance)}</li>`).join('');
  const proj30 = (cash.projection_30d || []).map(p => `<div class="proj-point">d+${p.day}<br><strong>${EUR(p.cash)}</strong></div>`).join('');
  const proj90 = (cash.projection_90d || []).map(p => `<div class="proj-point">d+${p.day}<br><strong>${EUR(p.cash)}</strong></div>`).join('');
  return `
    <div class="card">
      <div class="card-header-row"><div class="card-header-left"><span class="card-title">Cash position</span></div></div>
      <div class="finance-bignum">${EUR(cash.current_balance_eur)} <span class="finance-bignum-sub">current cash${confTag('cash_position')}</span></div>
      <ul>${accounts}</ul>
      <h3>30-day projection (tactical)</h3>
      <div class="proj-row">${proj30}</div>
      <h3>90-day projection (strategic)</h3>
      <div class="proj-row">${proj90}</div>
    </div>`;
}

function renderRunwayCard(runway, conf) {
  const days = runway.runway_days >= 9999 ? '∞' : runway.runway_days;
  const draw = runway.runway_with_planned_draw;
  const th = runway.thresholds || {};
  const confTag = conf?.per_figure?.runway_days === 'low' ? ' <span class="conf-marker">⚠ low</span>' : '';
  const drawNote = draw !== null && draw !== undefined ? `
      <div class="runway-conflict">⚠ If planned founder draw goes through: runway drops to <strong>${draw} d</strong> (threshold: ${th.draw_vs_runway_block_days} d).</div>` : '';
  return `
    <div class="card">
      <div class="card-header-row"><div class="card-header-left"><span class="card-title">Runway</span></div></div>
      <div class="finance-bignum">${days} d <span class="finance-bignum-sub">runway estimate${confTag}</span></div>
      <div>Threshold: <strong>${th.runway_alert_days} d</strong> — status: ${runway.runway_days >= (th.runway_alert_days || 90) ? '🟢 healthy' : '🟡 watch'}</div>
      ${drawNote}
    </div>`;
}

function renderRecCard(r) {
  const cur = r.target_ref?.current_state || {};
  const prop = r.target_ref?.proposed_state || {};
  const confTag = r.confidence === 'low' ? '⚠ low' : '✅ high';
  let body = '';
  if (r.category === 'expense-recategorization') {
    body = `
      <div class="rec-row"><strong>Vendor:</strong> ${escapeHtml(cur.vendor || '—')}</div>
      <div class="rec-row"><strong>Current:</strong> <code>${escapeHtml(cur.category || '—')}</code></div>
      <div class="rec-row"><strong>Proposed:</strong> <code>${escapeHtml(prop.category || '—')}</code></div>`;
  } else if (r.category === 'founder-draw-adjustment') {
    body = `
      <div class="rec-row"><strong>Founder:</strong> ${escapeHtml(cur.founder_name || '—')}</div>
      <div class="rec-row"><strong>Requested:</strong> ${EUR(cur.requested_amount_eur)} for ${escapeHtml(cur.requested_month || '')}</div>
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
      <div class="rec-reasoning">${escapeHtml(r.reasoning || '')}</div>
      ${r.runway_impact_days ? `<div class="rec-impact">Runway impact: ${r.runway_impact_days > 0 ? '+' : ''}${r.runway_impact_days} days</div>` : ''}
    </div>`;
}
