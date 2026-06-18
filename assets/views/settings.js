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
    ${renderWiringCard(ctx)}
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
