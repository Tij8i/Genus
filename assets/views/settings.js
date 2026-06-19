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

export function renderSettings(ctx) {
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
      renderSettings(ctx);
    });
  });

  const body = document.getElementById('settings-subtab-body');
  if (activeSubTab === 'profile') body.innerHTML = renderProfileSubTab(ctx);
  else if (activeSubTab === 'governance') body.innerHTML = renderGovernanceSubTab(ctx);
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
      <div class="settings-foot mono">Inline editing ships in v0.7. Edit via <code>identity.json</code> in the substrate repo for now.</div>
    </div>
  `;
}

// ============ Governance ============

function renderGovernanceSubTab(ctx) {
  const g = ctx.governance?.gauges || {};
  return `
    <div class="card">
      <div class="card-section-label">Governance</div>
      <p class="card-sub" style="margin-bottom:14px">How much rope the agents have, and how fast they move.</p>
      <div class="settings-rows">
        ${gauge('Delegation level', g.delegation, 'How far Stewart goes before checking with you.')}
        ${gauge('Trust level', g.trust, 'How much auto-approval Stewart can apply to its own emissions.')}
        ${gauge('Speed level', g.speed, 'How aggressively stale items get surfaced as meeting requests.')}
      </div>
      <div class="settings-foot mono">Inline sliders ship in v0.7. Edit via <code>governance.json</code> for now.</div>
    </div>
  `;
}

function gauge(label, g, sub) {
  const cur = (g?.current || 'off').toLowerCase();
  const levels = ['off', 'cautious', 'balanced', 'bold', 'autonomous'];
  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-name">${escapeHtml(label)}</div>
        <div class="settings-row-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="gauge-segments">
        ${levels.map(l => `<span class="gauge-seg ${l === cur ? 'gauge-seg-current' : ''}">${escapeHtml(l)}</span>`).join('')}
      </div>
    </div>
  `;
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
