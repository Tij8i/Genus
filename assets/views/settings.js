// Settings view — Identity / Governance / Wiring.
//
// Per decisions locked in the migration plan:
//   - Decision 10: Identity/BU profile lives at top of Settings (not its own tab).
//   - Mockup's Settings tab structure (Governance + Wiring) preserved underneath.
//   - Documentation + Connectors fold in here too (per the smaller-things batch).

import { escapeHtml, icon } from '../utils.js';

export function renderSettings(ctx) {
  const root = document.getElementById('route-settings');
  const i = ctx.identity || {};
  const g = ctx.governance?.gauges || {};

  root.innerHTML = `
    ${renderBuProfileCard(i)}
    ${renderGovernanceCard(g)}
    ${renderModulesCard(ctx)}
    ${renderWiringCard(ctx)}
  `;
}

function renderModulesCard(ctx) {
  // Per docs/system/MODULES.md (in Orchestrator) — modules are optional
  // extensions. Today there's no formal module registry; what looks
  // module-shaped (paperclip adapter, meeting server, Notion connector
  // for legacy Stewarts) lives as proto-module code. This card shows
  // the spec contract + a placeholder "no formal modules installed yet".
  return `
    <div class="card">
      <div class="card-section-label">Modules</div>
      <p class="card-sub" style="margin-bottom:14px">Optional extensions: connectors, alternate substrates, runtime adapters, surfaces, policies, observability, quality. Genus core stays opinionated; modules expand the surface area without touching core.</p>
      <div class="settings-rows">
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Installed modules</div>
            <div class="settings-row-sub">Modules with a valid <code>module.json</code> manifest registered for this BU.</div>
          </div>
          <div class="settings-row-value settings-row-empty">none yet — module loader spec'd in v0.7</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Proto-modules in use</div>
            <div class="settings-row-sub">Code that's effectively a module but predates the manifest. Tracked here so the formal module loader knows what to retrofit.</div>
          </div>
          <div class="settings-row-value">
            <div class="proto-module-row"><span class="proto-mod-cat mono">RUNTIME</span> Paperclip adapter <span class="mono" style="color:var(--text-faint);font-size:11px">· dashboard/scripts/paperclip_adapter.py</span></div>
            <div class="proto-module-row"><span class="proto-mod-cat mono">SURFACE</span> Meeting server <span class="mono" style="color:var(--text-faint);font-size:11px">· dashboard/scripts/genus_meeting_server.py</span></div>
            <div class="proto-module-row"><span class="proto-mod-cat mono">QUALITY</span> Meeting extractor <span class="mono" style="color:var(--text-faint);font-size:11px">· dashboard/scripts/genus_meeting_extract.py</span></div>
            <div class="proto-module-row"><span class="proto-mod-cat mono">OBSERVABILITY</span> Cycle diagnostic <span class="mono" style="color:var(--text-faint);font-size:11px">· dashboard/scripts/genus_cycle_diagnostic.py</span></div>
            <div class="proto-module-row"><span class="proto-mod-cat mono">CONNECTOR</span> GitHub substrate <span class="mono" style="color:var(--text-faint);font-size:11px">· functions/api/_gh.js (built-in)</span></div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Module categories</div>
            <div class="settings-row-sub">Seven kinds per MODULES.md. Each module declares one (or two) in its manifest.</div>
          </div>
          <div class="settings-row-value">
            <div class="module-cat-grid">
              <div class="module-cat-chip">Connector</div>
              <div class="module-cat-chip">Substrate</div>
              <div class="module-cat-chip">Runtime</div>
              <div class="module-cat-chip">Surface</div>
              <div class="module-cat-chip">Policy</div>
              <div class="module-cat-chip">Observability</div>
              <div class="module-cat-chip">Quality</div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-foot mono">Spec: <code>docs/system/MODULES.md</code> in the substrate repo. Install + enablement UI ships in v0.7.</div>
    </div>
  `;
}

function renderBuProfileCard(i) {
  return `
    <div class="card">
      <div class="card-section-label">BU profile</div>
      <p class="card-sub" style="margin-bottom:14px">Identity for this venture. Stewart reads this on every heartbeat.</p>
      <div class="settings-rows">
        ${settingsReadOnlyRow('Name', i.name)}
        ${settingsReadOnlyRow('Category', i.category)}
        ${settingsReadOnlyRow('Tagline', i.tagline)}
        ${settingsReadOnlyRow('Mission', i.mission, 'prose')}
        ${settingsReadOnlyRow('Vision', i.vision, 'prose')}
        ${settingsReadOnlyRow('Current stage', i.current_stage)}
        ${settingsReadOnlyRow('Legal entity', i.legal_entity)}
        ${settingsReadOnlyRow('Live surface', i.live_surface, 'link')}
        ${i.health ? settingsReadOnlyRow('Health', `${(i.health.verdict || 'gray').toUpperCase()} — ${i.health.summary || ''}`, 'prose') : ''}
      </div>
      <div class="settings-foot mono">Edit via <code>dashboard/public/data/bus/tuto/identity.json</code> in the substrate repo. Inline editing ships in v0.7.</div>
    </div>
  `;
}

function renderGovernanceCard(g) {
  return `
    <div class="card">
      <div class="card-section-label">Governance</div>
      <p class="card-sub" style="margin-bottom:14px">How much rope the agents have, and how fast they move.</p>
      <div class="settings-rows">
        ${renderGauge('Delegation level', g.delegation, ['off', 'cautious', 'balanced', 'bold', 'autonomous'], 'How far Stewart goes before checking with you.')}
        ${renderGauge('Trust level', g.trust, ['off', 'cautious', 'balanced', 'bold', 'autonomous'], 'How much auto-approval Stewart can apply to its own emissions.')}
        ${renderGauge('Speed level', g.speed, ['off', 'cautious', 'balanced', 'bold', 'autonomous'], 'How aggressively stale items get surfaced as meeting requests.')}
      </div>
      <div class="settings-foot mono">Edit via the legacy dashboard's gauge sliders, or directly in <code>governance.json</code>. Inline editing ships in v0.7.</div>
    </div>
  `;
}

function renderGauge(label, gaugeObj, levels, sub) {
  const current = (gaugeObj?.current || 'off').toLowerCase();
  return `
    <div class="settings-row settings-row-gauge">
      <div class="settings-row-label">
        <div class="settings-row-name">${escapeHtml(label)}</div>
        <div class="settings-row-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="gauge-segments">
        ${levels.map(lvl => `
          <span class="gauge-seg ${lvl === current ? 'gauge-seg-current' : ''}">${escapeHtml(lvl)}</span>
        `).join('')}
      </div>
    </div>
  `;
}

function renderWiringCard(ctx) {
  const connectors = ctx.connectors || [];
  const docs = ctx.documentation || [];
  // Local infra status (computed at boot — we don't probe here to avoid loops)
  return `
    <div class="card">
      <div class="card-section-label">Wiring</div>
      <p class="card-sub" style="margin-bottom:14px">The footprint of the venture — surfaces, infrastructure, and the stack Genus runs on.</p>
      <div class="settings-rows">
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Substrate repo</div>
            <div class="settings-row-sub">Where the venture's data lives. Cross-repo read via Pages Functions.</div>
          </div>
          <div class="settings-row-value mono">Tij8i/Orchestrator</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Dashboard repo</div>
            <div class="settings-row-sub">This dashboard's code. Deploys via Cloudflare Pages.</div>
          </div>
          <div class="settings-row-value mono">Tij8i/Genus</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Runtime adapter</div>
            <div class="settings-row-sub">Where agents execute tasks. Heartbeats + Mason work happens here.</div>
          </div>
          <div class="settings-row-value mono">Paperclip · localhost:3100</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="settings-row-name">Meeting server</div>
            <div class="settings-row-sub">Local server for live operator↔agent chat. Required for Convert + Discuss buttons.</div>
          </div>
          <div class="settings-row-value mono">localhost:8765</div>
        </div>
      </div>
      <div class="settings-foot mono">
        Connectors (${connectors.length}) · Documentation (${docs.length}) details ship in v0.7.
      </div>
    </div>
  `;
}

function settingsReadOnlyRow(label, value, kind) {
  if (value == null || value === '') {
    return `
      <div class="settings-row">
        <div class="settings-row-label">
          <div class="settings-row-name">${escapeHtml(label)}</div>
        </div>
        <div class="settings-row-value settings-row-empty">—</div>
      </div>
    `;
  }
  let valueHtml = '';
  if (kind === 'prose') {
    valueHtml = `<div class="settings-row-prose">${escapeHtml(value)}</div>`;
  } else if (kind === 'link') {
    valueHtml = `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" class="settings-row-link mono">${escapeHtml(value)}</a>`;
  } else {
    valueHtml = `<div class="settings-row-value">${escapeHtml(value)}</div>`;
  }
  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <div class="settings-row-name">${escapeHtml(label)}</div>
      </div>
      ${valueHtml}
    </div>
  `;
}
