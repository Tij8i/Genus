// Settings view — sub-tabs: Profile / Governance / Modules / Wiring / Appearance.
//
// Per operator feedback 2026-06-19:
//   - Use sub-menus (sub-tabs) instead of one long scroll-down page
//   - Wiring should match the v0.6 mockup layout (Primary surface card +
//     Surfaces list + Infrastructure + Operating stack), not the simple
//     key-value list I had
//   - Modules should match the mockup's card/list idiom, not my dense
//     proto-module dump

import { escapeHtml, ago, icon } from '../utils.js';
import { ACCENT_OPTIONS, DENSITY_OPTIONS, loadAppearance, saveAppearance } from '../appearance.js';

let activeSubTab = 'profile';

export function renderSettings(ctx, opts = {}) {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(queryStr).get('tab');
  // Modules moved out of Settings — it's a top-level nav route now per v0.7 IA.
  if (['profile', 'governance', 'wiring', 'appearance'].includes(tab)) activeSubTab = tab;
  if (activeSubTab === 'modules') activeSubTab = 'profile';  // legacy URL → profile

  const root = document.getElementById('route-settings');
  root.innerHTML = `
    <nav class="subtab-nav">
      ${renderSubTab('profile', 'BU profile')}
      ${renderSubTab('governance', 'Governance')}
      ${renderSubTab('wiring', 'Wiring')}
      ${renderSubTab('appearance', 'Appearance')}
    </nav>
    <div id="settings-subtab-body"></div>
  `;

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#settings?tab=${activeSubTab}`;
      renderSettings(ctx, opts);
    });
  });

  const body = document.getElementById('settings-subtab-body');
  if (activeSubTab === 'profile') body.innerHTML = renderProfileSubTab(ctx);
  else if (activeSubTab === 'governance') {
    body.innerHTML = renderGovernanceSubTab(ctx);
    wireGovernanceControls(ctx, opts.onChange);
  }
  else if (activeSubTab === 'wiring') body.innerHTML = renderWiringSubTab(ctx);
  else if (activeSubTab === 'appearance') {
    body.innerHTML = renderAppearanceSubTab(ctx);
    wireAppearanceControls(ctx);
  }
}

function wireAppearanceControls(ctx) {
  document.querySelectorAll('.appearance-color').forEach(btn => {
    btn.addEventListener('click', () => {
      saveAppearance({ accent: btn.dataset.accent });
      renderSettings(ctx);  // re-render to update current selection ring
    });
  });
  document.querySelectorAll('.density-seg').forEach(btn => {
    btn.addEventListener('click', () => {
      saveAppearance({ density: btn.dataset.density });
      renderSettings(ctx);
    });
  });
}

function renderSubTab(name, label) {
  return `<button type="button" class="subtab-link ${activeSubTab === name ? 'current' : ''}" data-subtab="${name}">${escapeHtml(label)}</button>`;
}

// ============ Profile ============

function renderProfileSubTab(ctx) {
  const i = ctx.identity || {};
  return `
    <div class="card">
      <div class="card-section-label">BU profile</div>
      <p class="card-sub" style="margin-bottom:14px">Identity for this venture. Stewart reads this on every heartbeat.</p>
      <div class="settings-rows">
        ${row('Name', i.name)}
        ${row('Category', i.category)}
        ${row('Tagline', i.tagline)}
        ${row('Mission', i.mission, 'prose')}
        ${row('Vision', i.vision, 'prose')}
        ${row('Current stage', i.current_stage)}
        ${row('Legal entity', i.legal_entity)}
        ${row('Live surface', i.live_surface, 'link')}
        ${i.health ? row('Health', `${(i.health.verdict || 'gray').toUpperCase()} — ${i.health.summary || ''}`, 'prose') : ''}
      </div>
      <div class="settings-foot mono">📖 Read-only · inline editing ships in v0.8 · edit via <code>identity.json</code> in the substrate repo for now</div>
    </div>
  `;
}

// ============ Governance ============
//
// Interactive gauges restored in v0.7 per GEN-46 (legacy parity audit GEN-39).
// Mirrors the legacy Orchestrator dashboard idiom (tuto.js renderGovernance):
//   - 5-dot ordinal track per axis (Off / Cautious / Balanced / Bold / Autonomous)
//   - Per-gauge maturity backdrop overlay (dashed ring on the dot at observed maturity)
//   - Daily recommendation badge (↑ raise / = hold / ↓ lower + one-line rationale)
//   - Override-with-warning confirm when operator dials above current maturity
// Writes go through POST /api/update-governance (functions/api/update-governance.js).

const GOV_LEVELS = ['off', 'cautious', 'balanced', 'bold', 'autonomous'];
const GOV_LEVEL_LABELS = ['Off', 'Cautious', 'Balanced', 'Bold', 'Autonomous'];

function govLevelIndex(v) {
  const i = GOV_LEVELS.indexOf((v || '').toString().toLowerCase());
  return i < 0 ? 0 : i;
}

function renderGovernanceSubTab(ctx) {
  const g = ctx.governance || {};
  const hasData = g && g.gauges;
  return `
    <div class="card">
      <div class="card-section-label">Governance</div>
      <p class="card-sub" style="margin-bottom:14px">How much rope the agents have, and how fast they move. Click any dot to change a gauge — a confirm dialog warns if you dial above current maturity.</p>
      ${hasData ? `
        <div class="gov-gauges-stack">
          ${interactiveGauge('delegation', 'Delegation', 'How far Stewart goes before checking with you.', g)}
          ${interactiveGauge('trust', 'Trust', 'How much auto-approval Stewart can apply to its own emissions.', g)}
          ${interactiveGauge('speed', 'Speed', 'How aggressively stale items get surfaced as meeting requests.', g)}
        </div>
      ` : `
        <div class="empty-state-sm" style="padding:18px 0;text-align:center">governance.json not loaded.</div>
      `}
      <div class="settings-foot mono">Writes <code>governance.json</code> + appends an <code>audit_log</code> entry. See <code>docs/system/GOVERNANCE_GAUGES.md</code> for the spec.</div>
    </div>
  `;
}

function interactiveGauge(key, label, sub, gov) {
  const gaugeData = gov.gauges?.[key] || {};
  const matData = gov.maturity?.[key] || {};
  const recData = gov.recommendations?.[key] || {};
  const setIdx = govLevelIndex(gaugeData.current);
  const matIdx = govLevelIndex(matData.level);
  const recVerdict = (recData.verdict || 'hold').toLowerCase();
  const recArrow = recVerdict === 'raise' ? '↑' : recVerdict === 'lower' ? '↓' : '=';

  const dots = GOV_LEVELS.map((lv, i) => {
    const classes = ['gov-dot'];
    if (i <= setIdx) classes.push('gov-dot-trail');
    if (i === setIdx) classes.push('gov-dot-set');
    if (i === matIdx) classes.push('gov-dot-maturity');
    if (i === setIdx && i === matIdx) classes.push('gov-dot-set-at-maturity');
    const wouldOverride = i > matIdx;
    const isCurrent = i === setIdx;
    const title = isCurrent
      ? `Current setting (${GOV_LEVEL_LABELS[i]})`
      : (wouldOverride ? `Click to set — will warn (above maturity ${GOV_LEVEL_LABELS[matIdx]})` : `Click to set (${GOV_LEVEL_LABELS[i]})`);
    return `
      <button type="button" class="${classes.join(' ')}"
        data-gauge="${key}" data-level="${lv}" data-level-label="${GOV_LEVEL_LABELS[i]}"
        data-current="${isCurrent ? '1' : '0'}" data-would-override="${wouldOverride ? '1' : '0'}"
        title="${escapeHtml(title)}">
        <span class="gov-dot-circle"></span>
        <span class="gov-dot-label">${escapeHtml(GOV_LEVEL_LABELS[i])}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="gov-gauge">
      <div class="gov-gauge-head">
        <div class="gov-gauge-name">${escapeHtml(label)}</div>
        <div class="gov-gauge-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="gov-gauge-track">${dots}</div>
      <div class="gov-gauge-meta">
        <span class="gov-gauge-meta-pill"><span class="gov-gauge-meta-label">Current</span><strong>${escapeHtml(GOV_LEVEL_LABELS[setIdx])}</strong></span>
        <span class="gov-gauge-meta-pill gov-gauge-meta-pill-maturity"><span class="gov-gauge-meta-label">Maturity</span><strong>${escapeHtml(GOV_LEVEL_LABELS[matIdx])}</strong></span>
        ${gaugeData.set_with_override_warning ? `<span class="gov-gauge-meta-warn" title="Current setting is above observed maturity. Override is in the audit log.">⚠ override</span>` : ''}
      </div>
      <div class="gov-gauge-rec gov-gauge-rec-${recVerdict}">
        <span class="gov-gauge-rec-badge">${recArrow} ${escapeHtml(recVerdict)}</span>
        <span class="gov-gauge-rec-text">${escapeHtml(recData.rationale || '—')}</span>
        ${recData.computed_at ? `<span class="gov-gauge-rec-time mono">${escapeHtml(ago(recData.computed_at))}</span>` : ''}
      </div>
    </div>
  `;
}

function wireGovernanceControls(ctx, onChange) {
  const root = document.getElementById('settings-subtab-body');
  if (!root) return;
  root.querySelectorAll('.gov-dot[data-gauge]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.current === '1' || btn.disabled) return;
      const gauge = btn.dataset.gauge;
      const level = btn.dataset.level;
      const levelLabel = btn.dataset.levelLabel;
      const wouldOverride = btn.dataset.wouldOverride === '1';
      const matNow = ((ctx.governance?.maturity || {})[gauge] || {}).level || 'off';
      const matLabel = matNow.charAt(0).toUpperCase() + matNow.slice(1);

      const warning = wouldOverride
        ? `\n\n⚠ This dials ${gauge} ABOVE its current maturity (${matLabel}). Expect rougher output until evidence catches up. The override is logged in the audit trail.`
        : '';
      const msg = `Set ${gauge} → ${levelLabel}?${warning}\n\nThis writes governance.json + appends an audit_log entry.`;
      if (!window.confirm(msg)) return;

      updateGovernanceGauge(btn, gauge, level, onChange);
    });
  });
}

async function updateGovernanceGauge(btn, gauge, level, onChange) {
  const allBtns = document.querySelectorAll('.gov-dot[data-gauge]');
  allBtns.forEach(b => { b.disabled = true; });
  btn.classList.add('gov-dot-pending');
  try {
    const r = await fetch('/api/update-governance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bu: 'tuto', gauge, new_level: level, actor: 'operator',
        rationale: 'Set via Genus dashboard governance card',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    if (typeof onChange === 'function') {
      await onChange();
    } else {
      window.location.reload();
    }
  } catch (e) {
    btn.classList.remove('gov-dot-pending');
    allBtns.forEach(b => { b.disabled = false; });
    alert(`Could not update ${gauge}: ${e.message}`);
  }
}

// ============ Modules ============

function renderModulesSubTab(ctx) {
  // Same idiom as the Wiring lists in the mockup: rows with letter icon +
  // name + sub + status indicator on the right.
  const protoModules = [
    { cat: 'runtime', letter: 'P', name: 'Paperclip adapter', sub: 'Executes agent work via Paperclip', file: 'dashboard/scripts/paperclip_adapter.py', status: 'active' },
    { cat: 'surface', letter: 'M', name: 'Meeting server', sub: 'Local server for live operator↔agent chat', file: 'dashboard/scripts/genus_meeting_server.py', status: 'active' },
    { cat: 'quality', letter: 'X', name: 'Meeting extractor', sub: 'Post-meeting memos + tasks extraction', file: 'dashboard/scripts/genus_meeting_extract.py', status: 'active' },
    { cat: 'observability', letter: 'D', name: 'Cycle diagnostic', sub: 'Pipeline health snapshot', file: 'dashboard/scripts/genus_cycle_diagnostic.py', status: 'active' },
    { cat: 'connector', letter: 'G', name: 'GitHub substrate', sub: 'Cross-repo read/write via PAT', file: 'functions/api/_gh.js', status: 'active' },
  ];
  return `
    <div class="card">
      <div class="wiring-header">
        <div>
          <div class="card-section-label">Modules</div>
          <p class="card-sub" style="margin-top:5px;max-width:560px">Optional extensions: connectors, substrates, runtimes, surfaces, policies, observability, quality. The core stays opinionated; modules expand the surface area.</p>
        </div>
        <div class="status-chip-card">
          <span class="status-dot status-dot-good"></span>
          <span class="status-chip-card-label">${protoModules.length} active</span>
          <span class="status-chip-card-sub">· proto</span>
        </div>
      </div>

      <div class="card-section-label" style="margin:18px 0 6px">Installed modules</div>
      <p class="card-sub" style="margin-bottom:10px">Modules with a <code>module.json</code> manifest. Install flow ships in v0.7.</p>
      <div class="empty-state-sm" style="padding:18px 0;text-align:center">No formal modules installed yet.</div>

      <div class="card-section-label" style="margin:22px 0 6px">Proto-modules in use</div>
      <p class="card-sub" style="margin-bottom:10px">Code that's effectively a module but predates the manifest. Tracked here so the formal loader knows what to retrofit.</p>
      <div class="row-list">
        ${protoModules.map(m => `
          <div class="row-with-icon">
            <span class="row-icon-letter">${escapeHtml(m.letter)}</span>
            <div class="row-body">
              <div class="row-title">${escapeHtml(m.name)}</div>
              <div class="row-sub mono">${escapeHtml(m.file)}</div>
            </div>
            <span class="row-tag-accent mono">${escapeHtml(m.cat)}</span>
            <span class="status-dot status-dot-good" title="active"></span>
          </div>
        `).join('')}
      </div>

      <div class="card-section-label" style="margin:22px 0 6px">Module categories</div>
      <p class="card-sub" style="margin-bottom:10px">Per <code>docs/system/MODULES.md</code>. Each module declares one (or two) in its manifest.</p>
      <div class="module-cat-grid">
        ${['Connector', 'Substrate', 'Runtime', 'Surface', 'Policy', 'Observability', 'Quality']
          .map(c => `<span class="module-cat-chip">${escapeHtml(c)}</span>`).join('')}
      </div>
    </div>
  `;
}

// ============ Wiring (mockup layout) ============

function renderWiringSubTab(ctx) {
  const i = ctx.identity || {};
  const connectors = ctx.connectors || [];
  const docs = ctx.documentation || [];

  // Map connectors → categorized lists for Infrastructure + Operating stack
  // (per Tuto today, all connectors are MCP-type → mostly "Operating stack")
  const healthy = connectors.filter(c => (c.status || '').toLowerCase() === 'working').length;
  const total = connectors.length;

  // Primary surface from identity
  const primaryUrl = i.live_surface || 'not set';
  const primaryName = primaryUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const primaryLive = i.live_surface ? 'Live' : 'Not deployed';
  const primaryLiveClass = i.live_surface ? 'good' : 'warn';

  return `
    <div class="wiring-header-bar">
      <div>
        <div class="card-section-label">Wiring</div>
        <p class="card-sub" style="max-width:560px;margin-top:5px">The footprint of the venture — its surfaces, the infrastructure beneath them, and the stack Genus runs on.</p>
      </div>
      <div class="status-chip-card">
        <span class="status-dot status-dot-${healthy === total ? 'good' : 'warn'}"></span>
        <span class="status-chip-card-label">${healthy === total ? 'Production' : 'Mixed'}</span>
        <span class="status-chip-card-sub">· ${healthy} healthy / ${total}</span>
      </div>
    </div>

    <!-- Primary surface -->
    <div class="card primary-surface-card">
      <div class="primary-surface-body">
        <div class="card-section-label">Primary surface</div>
        <div class="primary-surface-title-row">
          <span class="primary-surface-name">${escapeHtml(primaryName)}</span>
          <span class="status-chip-pill status-chip-pill-${primaryLiveClass}">
            <span class="status-dot status-dot-${primaryLiveClass}"></span>${escapeHtml(primaryLive)}
          </span>
        </div>
        ${i.live_surface ? `
          <a href="${escapeHtml(i.live_surface)}" target="_blank" rel="noopener" class="primary-surface-url mono">
            ${icon('arrow-right', {color: 'var(--text-faint)', size: 14, stroke: 2})}
            ${escapeHtml(i.live_surface)}
          </a>
        ` : ''}
        <div class="primary-surface-stats">
          <div class="primary-stat"><div class="primary-stat-label mono">PUBLISHED ON</div><div class="primary-stat-value">${escapeHtml(i.live_surface?.includes('cloudflare') || i.live_surface?.includes('.pages.dev') ? 'Cloudflare Pages' : 'External')}</div></div>
          ${i.last_updated_at ? `<div class="primary-stat"><div class="primary-stat-label mono">LAST UPDATED</div><div class="primary-stat-value">${escapeHtml(ago(i.last_updated_at))}</div></div>` : ''}
          ${i.current_stage ? `<div class="primary-stat"><div class="primary-stat-label mono">STAGE</div><div class="primary-stat-value" style="color:var(--accent)">${escapeHtml(i.current_stage)}</div></div>` : ''}
        </div>
      </div>
      <div class="primary-surface-thumb">
        <div class="thumb-chrome">
          <span class="thumb-dot thumb-dot-red"></span>
          <span class="thumb-dot thumb-dot-yellow"></span>
          <span class="thumb-dot thumb-dot-green"></span>
        </div>
        <span class="thumb-label mono">${escapeHtml(primaryName)}</span>
      </div>
    </div>

    <div class="wiring-grid">
      <!-- Infrastructure -->
      <div class="card">
        <div class="card-section-label">Infrastructure</div>
        <p class="card-sub" style="margin-bottom:8px">What keeps the surfaces running.</p>
        <div class="row-list">
          ${renderInfraRow('C', 'Hosting & CDN', 'Cloudflare', 'good')}
          ${renderInfraRow('G', 'Substrate repo', 'github.com/Tij8i/Orchestrator', 'good')}
          ${renderInfraRow('G', 'Dashboard repo', 'github.com/Tij8i/Genus', 'good')}
          ${renderInfraRow('D', 'Documentation', 'Google Drive · Tuto_2026/', 'good')}
        </div>
      </div>

      <!-- Operating stack -->
      <div class="card">
        <div class="card-section-label">Operating stack</div>
        <p class="card-sub" style="margin-bottom:8px">How Genus runs the venture.</p>
        <div class="row-list">
          ${renderOpRow('P', 'Runtime · Paperclip', 'Executes agent work · localhost:3100', 'accent', 'good')}
          ${renderOpRow('C', 'LLM · Claude', 'via claude --print + meeting server', 'dark', 'good')}
          ${renderOpRow('S', 'Meeting server', 'Local · localhost:8765 · launchd', 'gray', 'good')}
          ${renderOpRow('T', 'Ticker (10-min loop)', 'launchd · adapter + emit + cycle diag', 'gray', 'good')}
          ${renderOpRow('M', 'MCP connectors', `${connectors.length} total · ${healthy} healthy`, 'gray', healthy === total ? 'good' : 'warn')}
        </div>
      </div>
    </div>

    ${connectors.length ? `
      <!-- Connectors detail -->
      <div class="card">
        <div class="card-section-label">Connectors</div>
        <p class="card-sub" style="margin-bottom:8px">External services Stewart reaches into.</p>
        <div class="row-list">
          ${connectors.map(c => `
            <div class="row-with-icon">
              <span class="row-icon-letter">${escapeHtml((c.provider || c.id || '?').charAt(0).toUpperCase())}</span>
              <div class="row-body">
                <div class="row-title">${escapeHtml(c.provider || c.id)}</div>
                <div class="row-sub">${escapeHtml((c.scope || '').slice(0, 80))}${(c.scope || '').length > 80 ? '…' : ''}</div>
              </div>
              <span class="row-tag-mono mono">${escapeHtml(c.type || '?')}</span>
              <span class="status-dot status-dot-${statusToColor(c.status)}" title="${escapeHtml(c.status || 'unknown')}"></span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderInfraRow(letter, name, sub, status) {
  return `
    <div class="row-with-icon">
      <span class="row-icon-letter">${escapeHtml(letter)}</span>
      <div class="row-body">
        <div class="row-title">${escapeHtml(name)}</div>
        <div class="row-sub">${escapeHtml(sub)}</div>
      </div>
      <span class="status-dot status-dot-${status}" title="${escapeHtml(status)}"></span>
    </div>
  `;
}

function renderOpRow(letter, name, sub, iconStyle, status) {
  const iconClass = iconStyle === 'accent' ? 'row-icon-letter-accent'
    : iconStyle === 'dark' ? 'row-icon-letter-dark'
    : '';
  return `
    <div class="row-with-icon">
      <span class="row-icon-letter ${iconClass}">${escapeHtml(letter)}</span>
      <div class="row-body">
        <div class="row-title">${escapeHtml(name)}</div>
        <div class="row-sub">${escapeHtml(sub)}</div>
      </div>
      <span class="status-dot status-dot-${status}" title="${escapeHtml(status)}"></span>
    </div>
  `;
}

function statusToColor(s) {
  switch ((s || '').toLowerCase()) {
    case 'working': case 'healthy': case 'ok': case 'active': return 'good';
    case 'degraded': case 'warning': case 'stale': return 'warn';
    case 'broken': case 'down': case 'error': return 'bad';
    default: return 'gray';
  }
}

// ============ Appearance ============

function renderAppearanceSubTab(ctx) {
  const i = ctx.identity || {};
  const buLetter = (i.name || 'T').charAt(0).toUpperCase();
  const { accent, density } = loadAppearance();
  return `
    <div class="card">
      <div class="card-section-label">Appearance</div>
      <p class="card-sub" style="margin-bottom:14px">How Genus looks. Saved per-browser; applies instantly.</p>

      <div class="settings-row">
        <div class="settings-row-label">
          <div class="settings-row-name">Venture name & logo</div>
          <div class="settings-row-sub">Shown across the workspace.</div>
        </div>
        <div class="settings-row-value">
          <div class="appearance-name-preview">
            <span class="appearance-logo">${escapeHtml(buLetter)}</span>
            <span class="appearance-name">${escapeHtml(i.name || 'Untitled BU')}</span>
          </div>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row-label">
          <div class="settings-row-name">Accent color</div>
          <div class="settings-row-sub">Used across the dashboard for highlights + active states. Saved per-browser.</div>
        </div>
        <div class="settings-row-value">
          <div class="appearance-color-row">
            ${ACCENT_OPTIONS.map(opt => `
              <button type="button" class="appearance-color ${accent === opt.key ? 'appearance-color-current' : ''}" data-accent="${escapeHtml(opt.key)}" style="background:${opt.color}" title="${escapeHtml(opt.name)}" aria-label="${escapeHtml(opt.name)}"></button>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-row-label">
          <div class="settings-row-name">Density</div>
          <div class="settings-row-sub">Comfortable = roomier padding + gaps. Compact = tighter, more on screen.</div>
        </div>
        <div class="settings-row-value">
          <div class="density-segments">
            ${DENSITY_OPTIONS.map(opt => `
              <button type="button" class="density-seg ${density === opt.key ? 'density-seg-current' : ''}" data-density="${escapeHtml(opt.key)}">${escapeHtml(opt.name)}</button>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="settings-foot mono">Per-browser preference. Cross-device sync ships in v0.8.</div>
    </div>
  `;
}

// ============ Row helpers ============

function row(label, value, kind) {
  if (value == null || value === '') {
    return `
      <div class="settings-row">
        <div class="settings-row-label"><div class="settings-row-name">${escapeHtml(label)}</div></div>
        <div class="settings-row-value settings-row-empty">—</div>
      </div>
    `;
  }
  let valueHtml;
  if (kind === 'prose') valueHtml = `<div class="settings-row-prose">${escapeHtml(value)}</div>`;
  else if (kind === 'link') valueHtml = `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" class="settings-row-link mono">${escapeHtml(value)}</a>`;
  else valueHtml = `<div class="settings-row-value">${escapeHtml(value)}</div>`;
  return `
    <div class="settings-row">
      <div class="settings-row-label"><div class="settings-row-name">${escapeHtml(label)}</div></div>
      ${valueHtml}
    </div>
  `;
}
