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

  // Pull admin state for bindings + runtimes + users (best-effort — admin-gated).
  // Scope by current BU so the HITL-owner picker only lists users authorized
  // for this venture.
  let adminState = { runtimes: [], bindings: [], users: [] };
  try {
    const res = await fetch('/api/admin-state?bu=' + encodeURIComponent(currentBu));
    const j = await res.json();
    if (j.ok) adminState = j;
  } catch (_) { /* viewer not admin — skip binding chips */ }

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
      ${available.map(m => renderModuleCard(m, installed.has(m.id), bindingFor(adminState, currentBu, m.id), adminState)).join('')}
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
    btn.addEventListener('click', () => openModulePreview(btn.dataset.modPreview, available, installed.has(btn.dataset.modPreview), currentBu, adminState));
  });
  root.querySelectorAll('[data-mod-binding]').forEach(btn => {
    btn.addEventListener('click', () => openBindingEdit(btn.dataset.modBinding, currentBu, adminState));
  });
}

function bindingFor(adminState, bu, module_id) {
  return (adminState.bindings || []).find(b => b.bu === bu && b.module_id === module_id) || null;
}

function renderModuleCard(m, isInstalled, binding, adminState) {
  const installedTag = isInstalled
    ? '<span class="finance-pill" style="background:var(--green);">INSTALLED</span>'
    : '';
  const actionBtn = isInstalled
    ? `<button type="button" class="onboard-cancel" data-mod-uninstall="${escapeHtml(m.id)}">Uninstall</button>`
    : `<button type="button" class="onboard-begin" data-mod-install="${escapeHtml(m.id)}">Install</button>`;

  let bindingChip = '';
  if (isInstalled && binding) {
    const runtime = (adminState.runtimes || []).find(r => r.id === binding.runtime_id);
    const hitl = (adminState.users || []).find(u => (u.email || '').toLowerCase() === (binding.hitl_owner_email || '').toLowerCase());
    bindingChip = `
      <div style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;background:var(--surface2);border-radius:6px;font-size:12px;">
        <div><span style="color:var(--text-faint);">Runtime:</span> <strong>${escapeHtml(runtime?.display_name || binding.runtime_id || 'unbound')}</strong></div>
        <div><span style="color:var(--text-faint);">HITL owner:</span> <strong>${escapeHtml(hitl?.display_name || binding.hitl_owner_email || 'unbound')}</strong></div>
        <button type="button" data-mod-binding="${escapeHtml(m.id)}" style="align-self:flex-start;margin-top:4px;padding:4px 10px;font-size:11px;background:none;border:1px solid var(--border);border-radius:4px;color:var(--accent);cursor:pointer;">Edit binding</button>
      </div>`;
  }
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
      ${bindingChip}
      <div style="display:flex;gap:8px;margin-top:6px;justify-content:flex-end;">
        <button type="button" class="onboard-cancel" data-mod-preview="${escapeHtml(m.id)}">Details</button>
        ${actionBtn}
      </div>
    </div>
  `;
}

function openBindingEdit(modId, bu, adminState) {
  const binding = bindingFor(adminState, bu, modId);
  if (!binding) { alert('No binding found for this module on this BU.'); return; }
  const runtimes = adminState.runtimes || [];
  const users = adminState.users || [];
  const bodyHtml = `
    <p style="font-size:13px;color:var(--text-dim);line-height:1.6;margin:0 0 18px;">
      Determines which Paperclip instance executes the agent (= whose Claude account is billed) + who reviews approvals.
    </p>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Runtime</span>
        <select id="bind-runtime" style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;">
          ${runtimes.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === binding.runtime_id ? 'selected' : ''}>${escapeHtml(r.display_name)} (${escapeHtml(r.kind)})</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-faint);">Cloud Paperclip + multi-runtime CRUD = follow-up. v1 lists local Paperclip only.</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Human-in-the-loop owner</span>
        <select id="bind-hitl" style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;">
          ${users.map(u => `<option value="${escapeHtml(u.email)}" ${(u.email || '').toLowerCase() === (binding.hitl_owner_email || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(u.display_name || u.email)} · ${escapeHtml(u.email)}</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-faint);">Reviews approvals + gets surfacing for this agent.</span>
      </label>
      <div style="padding:10px 12px;background:var(--surface2);border-radius:6px;font-size:11px;color:var(--text-faint);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;">
        Installed by: ${escapeHtml(binding.installer_email)} · Installed at: ${escapeHtml(binding.installed_at)}
      </div>
      <div id="bind-error" style="display:none;padding:10px 12px;background:var(--red-bg);color:var(--red-fg);border-radius:6px;font-size:12px;"></div>
    </div>
  `;
  openOverlay({
    title: `Edit binding — ${modId} for ${bu}`,
    subtitle: 'Runtime + Human-in-the-loop owner',
    iconHtml: '🔗',
    iconTint: '#8a5cf6',
    bodyHtml,
    footerHtml: `
      <button type="button" class="onboard-cancel" id="bind-cancel">Cancel</button>
      <button type="button" class="onboard-begin" id="bind-save">Save</button>
    `,
  });
  document.getElementById('bind-cancel').addEventListener('click', closeOverlay);
  document.getElementById('bind-save').addEventListener('click', async () => {
    const runtime_id = document.getElementById('bind-runtime').value;
    const hitl_owner_email = document.getElementById('bind-hitl').value;
    const $err = document.getElementById('bind-error');
    $err.style.display = 'none';
    try {
      const res = await fetch('/api/agent-binding-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, module_id: modId, runtime_id, hitl_owner_email }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        $err.textContent = result.message || `HTTP ${res.status}`; $err.style.display = 'block';
        return;
      }
      closeOverlay();
      renderModules({});
    } catch (e) {
      $err.textContent = 'Network error: ' + (e.message || e); $err.style.display = 'block';
    }
  });
}

function openModulePreview(modId, available, isInstalled, currentBu, _adminState) {
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
  // Two-phase: install-module is fast (registry write only), then module-init
  // does the slow follow-up (substrate seed + agent binding) in the background.
  // Splitting prevents Pages Function timeouts.
  try {
    const res = await fetchJsonOrText('/api/install-module', {
      bu, module_id: modId, action: install ? 'install' : 'uninstall',
    });
    if (!res.ok) {
      alert((install ? 'Install' : 'Uninstall') + ' failed: ' + (res.message || 'unknown'));
      return;
    }
    // Fire-and-forget the second-phase init (substrate seed + binding). Don't
    // block the user on it — if it fails, they can re-trigger via re-install.
    // After it resolves, kick the local reconcile-now trigger so the Paperclip
    // agent + heartbeat routine get created in seconds instead of ≤5 min
    // (roadmap i26). Trigger is optional: if it's not running (e.g. operator
    // hasn't installed the trigger daemon), we silently fall back to the
    // periodic reconcile cycle.
    fetchJsonOrText('/api/module-init', {
      bu, module_id: modId, action: install ? 'install' : 'uninstall',
    })
      .then(res => {
        const agentId = res?.binding?.agent_id;
        if (install) return kickReconcileNow(agentId || bu);
      })
      .catch(() => { /* best-effort */ });
    if (install) {
      openGenusAgentOnboarding(modId, bu);
    } else {
      location.reload();
    }
  } catch (e) {
    alert((install ? 'Install' : 'Uninstall') + ' failed: ' + (e.message || e));
  }
}

// Fire the local reconcile-now trigger (roadmap i26). Runs on the operator's
// Mac at http://127.0.0.1:3101 via a launchd daemon (see
// Orchestrator/scripts/paperclip_sync/trigger.mjs). Best-effort: if the
// trigger daemon isn't running, or the browser blocks the private-network
// fetch, we silently no-op — the periodic 5-min reconciler will pick up
// the install anyway. When it does work, the Paperclip agent + heartbeat
// routine are created within ~2-8 seconds instead of up to 5 minutes.
async function kickReconcileNow(filter) {
  const TRIGGER_URL = 'http://127.0.0.1:3101/reconcile-now';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(TRIGGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: filter || null, timeout_ms: 40000 }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn('[reconcile-now] trigger returned', res.status);
      return { ok: false };
    }
    const json = await res.json().catch(() => ({}));
    console.info('[reconcile-now]', json.ok ? 'ok' : 'fail', `${json.elapsed_ms || '?'}ms`);
    return json;
  } catch (e) {
    clearTimeout(t);
    // Common cases: trigger daemon not installed, blocked by PNA, or Paperclip
    // itself unreachable. All fall back gracefully to the periodic reconcile.
    console.info('[reconcile-now] not available — falling back to periodic reconcile:', e.message || e);
    return { ok: false, fallback: true };
  }
}

// Helper: POST JSON and parse the response, but tolerate HTML error pages
// (Cloudflare timeout/error pages) by returning a graceful error object.
async function fetchJsonOrText(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, message: 'network: ' + (e.message || e) };
  }
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    return {
      ok: res.ok,
      message: res.ok
        ? null
        : `server returned ${res.status} (non-JSON, likely Cloudflare timeout — but the write may still have succeeded; reload to confirm)`,
      _raw: text.slice(0, 200),
    };
  }
  return parsed;
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
