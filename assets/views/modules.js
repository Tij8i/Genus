// Modules view — lists available modules from bus/_registry.json and lets the
// operator install / uninstall them for the current BU.
//
// Substrate-backed per Session #18 Initiative #2 v2: registry's `available_modules`
// declares what's shippable; each BU's `modules_installed` tracks what's wired.

import { escapeHtml } from '../utils.js';
import { fetchSubstrateJson } from '../substrate-client.js';
import { openOverlay, closeOverlay } from '../overlay.js';

const REGISTRY_PATH = 'dashboard/public/data/bus/_registry.json';

export async function renderModules(_ctx) {
  const root = document.getElementById('route-modules');
  if (!root) return;
  root.innerHTML = '<div class="card"><div class="card-body">Loading modules…</div></div>';

  const registry = await fetchSubstrateJson(REGISTRY_PATH, null);
  if (!registry) {
    root.innerHTML = '<div class="card"><div class="card-body">Could not load module registry.</div></div>';
    return;
  }

  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || registry.default_bu;
  const buEntry = (registry.business_units || []).find(b => b.id === currentBu);
  const installed = new Set(buEntry?.modules_installed || []);
  const available = registry.available_modules || [];

  if (available.length === 0) {
    root.innerHTML = `
      <div class="card">
        <div class="empty-cactus">
          <div class="empty-cactus-icon">🌵</div>
          <div class="empty-cactus-title">No modules in registry</div>
          <div class="empty-cactus-body">Add module entries to <code>bus/_registry.json</code> → <code>available_modules</code>.</div>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Modules</span>
          <p class="card-sub">Showing for <strong>${escapeHtml(buEntry?.display_name || currentBu)}</strong> — ${installed.size} of ${available.length} installed.</p>
        </div>
      </div>
    </div>
    <div class="modules-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      ${available.map(m => renderModuleCard(m, installed.has(m.id))).join('')}
    </div>
  `;

  // Wire buttons
  root.querySelectorAll('[data-mod-install]').forEach(btn => {
    btn.addEventListener('click', () => installModuleFlow(btn.dataset.modInstall, currentBu, true));
  });
  root.querySelectorAll('[data-mod-uninstall]').forEach(btn => {
    btn.addEventListener('click', () => installModuleFlow(btn.dataset.modUninstall, currentBu, false));
  });
  root.querySelectorAll('[data-mod-preview]').forEach(btn => {
    btn.addEventListener('click', () => openModulePreview(btn.dataset.modPreview, available, installed.has(btn.dataset.modPreview), currentBu));
  });
}

function renderModuleCard(m, isInstalled) {
  const installedTag = isInstalled
    ? '<span class="finance-pill" style="background:var(--green);">INSTALLED</span>'
    : '';
  const actionBtn = isInstalled
    ? `<button type="button" class="onboard-cancel" data-mod-uninstall="${escapeHtml(m.id)}">Uninstall</button>`
    : `<button type="button" class="onboard-begin" data-mod-install="${escapeHtml(m.id)}">Install</button>`;
  return `
    <div class="card" style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:start;gap:14px;">
        <span style="font-size:30px;line-height:1;">${m.icon || '📦'}</span>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;">
            <strong style="font-size:15px;">${escapeHtml(m.display_name)}</strong>
            ${installedTag}
          </div>
          <div style="font-size:11px;color:var(--text-faint);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;margin-top:2px;">${escapeHtml(m.id)} · v${escapeHtml(m.version || '0')}</div>
        </div>
      </div>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.55;margin:0;">${escapeHtml(m.summary || '')}</p>
      <div style="display:flex;gap:8px;margin-top:6px;justify-content:flex-end;">
        <button type="button" class="onboard-cancel" data-mod-preview="${escapeHtml(m.id)}">Details</button>
        ${actionBtn}
      </div>
    </div>
  `;
}

function openModulePreview(modId, available, isInstalled, currentBu) {
  const m = available.find(x => x.id === modId);
  if (!m) return;
  openOverlay({
    title: m.display_name,
    subtitle: `Module · v${m.version || '0'}`,
    iconHtml: m.icon || '📦',
    iconTint: m.color || 'var(--accent)',
    bodyHtml: `
      <p style="font-size:14px;color:var(--text);line-height:1.6;margin:0 0 18px;">${escapeHtml(m.summary || '')}</p>
      <div class="onboard-section-label mono">What you'd get</div>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.6;margin:0;">${escapeHtml(m.detail || '')}</p>
    `,
    footerHtml: isInstalled
      ? `<button type="button" class="onboard-cancel" id="modal-uninstall-btn">Uninstall</button>
         <button type="button" class="onboard-begin" disabled style="opacity:.6;cursor:default;">Already installed</button>`
      : `<button type="button" class="onboard-cancel" id="modal-cancel-btn">Close</button>
         <button type="button" class="onboard-begin" id="modal-install-btn">Install for ${escapeHtml(currentBu)}</button>`,
  });
  document.getElementById('modal-cancel-btn')?.addEventListener('click', closeOverlay);
  document.getElementById('modal-install-btn')?.addEventListener('click', () => { closeOverlay(); installModuleFlow(modId, currentBu, true); });
  document.getElementById('modal-uninstall-btn')?.addEventListener('click', () => { closeOverlay(); installModuleFlow(modId, currentBu, false); });
}

async function installModuleFlow(modId, bu, install) {
  try {
    const res = await fetch('/api/install-module', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, module_id: modId, action: install ? 'install' : 'uninstall' }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      alert((install ? 'Install' : 'Uninstall') + ' failed: ' + (result.message || `HTTP ${res.status}`));
      return;
    }
    if (install) {
      // Genus Agent onboarding overlay — drives the post-install setup.
      openGenusAgentOnboarding(modId, bu);
    } else {
      // Uninstall: just reload so nav filter re-applies.
      location.reload();
    }
  } catch (e) {
    alert('Network error: ' + (e.message || e));
  }
}

// Genus Agent onboarding flow — fires after a module install completes.
// Per Session #18 v0.7: Genus Agent is the Admin archetype that walks the
// operator through wiring connectors + agent setup for newly installed modules.
function openGenusAgentOnboarding(modId, bu) {
  // Per-module step content. Generic shape; module-specific copy.
  const flows = {
    finance: {
      title: 'Finance installed for ' + bu,
      subtitle: 'Genus Agent — module onboarding',
      iconHtml: '🪙',
      iconTint: '#0e9f6e',
      steps: [
        { title: '1. Substrate seeded', detail: 'Empty per-BU finance state created (ONBOARDING_STATE, CONFIDENCE_STATE, THRESHOLDS, RECOMMENDATION_LEDGER, DOMAIN_MODEL). The Finance Stewart of ' + bu + ' has a place to remember.', done: true },
        { title: '2. Wire Moneybird connector', detail: 'Go to Settings → Wiring → Moneybird and provide the API key (or stay in fixture mode for now). Without this, the L1 onboarding check fails and views show "module not active".', done: false },
        { title: '3. Run the first heartbeat', detail: 'Once the connector is wired, the Finance Stewart\'s first heartbeat seeds Cash / Runway / Costs / Revenue snapshots + fires the first recommendation pass.', done: false },
        { title: '4. Review + tune thresholds', detail: 'Default thresholds (runway 90d, variance 15%, draw-vs-runway 60d) are seeded. Adjust them in Settings → Modules → Finance once you see the first heartbeat.', done: false },
      ],
    },
    strategy: {
      title: 'Strategy installed for ' + bu,
      subtitle: 'Genus Agent — module onboarding',
      iconHtml: '🎯',
      iconTint: '#2f6bff',
      steps: [
        { title: '1. Strategy Stewart bound', detail: 'A Strategy Stewart instance now owns this BU. They\'ll run the universal planning loop: goals → initiatives → packages → tasks.', done: true },
        { title: '2. Set the first goal', detail: 'Go to Planning to declare the first goal. The Stewart will draft an Initiative breakdown for your approval.', done: false },
        { title: '3. Wire KPIs', detail: 'Each goal needs at least one KPI. Wire them in KPIs once goals are set.', done: false },
      ],
    },
  };

  const flow = flows[modId];
  if (!flow) {
    location.reload();
    return;
  }

  const stepsHtml = flow.steps.map((s, i) => `
    <div class="onboard-step">
      <span class="onboard-step-num mono" style="background:${s.done ? 'var(--green)' : 'var(--surface2)'};color:${s.done ? '#fff' : 'var(--text-faint)'};">${s.done ? '✓' : (i + 1)}</span>
      <div class="onboard-step-text" style="display:flex;flex-direction:column;gap:4px;">
        <strong style="font-size:13px;color:var(--text);">${escapeHtml(s.title)}</strong>
        <span style="font-size:12px;color:var(--text-dim);line-height:1.55;">${escapeHtml(s.detail)}</span>
      </div>
    </div>
  `).join('');

  const bodyHtml = `
    <p style="font-size:13px;color:var(--text-dim);line-height:1.6;margin:0 0 18px;">
      Walking you through what's done and what's next. Skip if you'd rather wire things up later — the module is installed either way.
    </p>
    <div class="onboard-steps">${stepsHtml}</div>
  `;
  const footerHtml = `
    <button type="button" class="onboard-cancel" id="genus-agent-skip">Set up later</button>
    <button type="button" class="onboard-begin" id="genus-agent-continue">Go to Settings → Wiring</button>
  `;

  openOverlay({
    title: flow.title,
    subtitle: flow.subtitle,
    iconHtml: flow.iconHtml,
    iconTint: flow.iconTint,
    bodyHtml,
    footerHtml,
  });

  document.getElementById('genus-agent-skip')?.addEventListener('click', () => {
    closeOverlay();
    location.reload();
  });
  document.getElementById('genus-agent-continue')?.addEventListener('click', () => {
    closeOverlay();
    // Reload to apply nav, then jump to Settings
    const url = new URL(location.href);
    url.hash = '#settings';
    location.href = url.toString();
  });
}
