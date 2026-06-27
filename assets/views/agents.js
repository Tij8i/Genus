// Agents registry — per-BU list of installed agents, with archetype, module,
// runtime, HITL, covered areas. Sister surface to People (humans) and
// Modules (packages). Operator's stated next step toward a unified registry
// section (humans / agents / tools / modules) — keeping these split for now
// to ship cleanly; consolidate later.
//
// Backed by /api/admin-state (returns bindings + users + runtimes) + the
// per-BU substrate (business_areas.json for covers_areas picker;
// _registry.json for module catalog).

import { escapeHtml } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';
import { fetchSubstrateJson } from '../substrate-client.js';

let CACHED_VIEWER = null;

const ARCHETYPE_TINTS = {
  Stewart: '#7a4dff',
  Mason:   '#2f6bff',
  Virgil:  '#0e9f6e',
  Admin:   '#16181d',
};

export async function renderAgents(ctx) {
  const root = document.getElementById('route-agents');
  if (!root) return;
  let viewer = ctx?.viewer && Object.keys(ctx.viewer).length ? ctx.viewer : CACHED_VIEWER;
  if (!viewer) {
    try {
      const r = await fetch('/api/identity', { cache: 'no-store' });
      const j = await r.json();
      viewer = j.ok && j.viewer ? j.viewer : {};
    } catch { viewer = {}; }
  }
  CACHED_VIEWER = viewer;
  root.innerHTML = '<div class="card"><div class="card-body">Loading agents…</div></div>';

  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';

  let state, registry, areasFile;
  try {
    const [stateRes, registryFile, areasJson] = await Promise.all([
      fetch('/api/admin-state?bu=' + encodeURIComponent(currentBu)).then(r => r.json()),
      fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null).catch(() => null),
      fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/business_areas.json`, null).catch(() => null),
    ]);
    if (!stateRes.ok) throw new Error(stateRes.message || 'admin-state failed');
    state = stateRes;
    registry = registryFile;
    areasFile = areasJson;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="card-body">Could not load agents: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }

  const users = state.users || [];
  const runtimes = state.runtimes || [];
  const allBindings = state.bindings || [];
  const bindings = allBindings.filter(b => b.bu === currentBu);
  const areas = (areasFile && areasFile.areas) || [];
  const availableModules = (registry && registry.available_modules) || [];
  const installedModuleIds = new Set(
    (registry?.business_units || []).find(b => b.id === currentBu)?.modules_installed || []
  );

  const currentBuName = (registry?.business_units || []).find(b => b.id === currentBu)?.display_name || currentBu;
  const isAdminLike = viewer.role === 'owner' || viewer.role === 'admin';

  root.innerHTML = `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Agents — ${escapeHtml(currentBuName)}</span>
          <p class="card-sub">${bindings.length} ${bindings.length === 1 ? 'agent' : 'agents'} bound to this venture. Each binding declares runtime (= whose Claude account runs it) + HITL owner (= human reviewer) + business areas covered.</p>
        </div>
        ${isAdminLike ? `<button type="button" class="add-btn" id="add-agent-btn" title="Add an agent">+</button>` : ''}
      </div>
      <div class="agents-list" style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
        ${bindings.length === 0
          ? `<div style="padding:30px 0;color:#9aa1ae;text-align:center;font-size:13.5px;">No agents bound to ${escapeHtml(currentBuName)} yet. ${isAdminLike ? 'Click + above to add one, or install a module from <a href="#modules" style="color:#2f6bff;">Modules</a>.' : ''}</div>`
          : bindings.map(b => renderAgentRow(b, runtimes, users, areas, availableModules, isAdminLike)).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="card-header-row">
        <div class="card-header-left">
          <span class="card-title">Archetype catalog</span>
          <p class="card-sub">Templates for what kinds of agent can be added.</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:10px;margin-top:14px;">
        ${renderArchetypeCard('Genus Agent', 'Admin (auto)', 'Models the business + proposes area changes. One per BU, auto-instantiated.', ARCHETYPE_TINTS.Admin)}
        ${renderArchetypeCard('Stewart', 'Operating steward', 'One per BU per module. Owns the planning loop + recommendations for that domain.', ARCHETYPE_TINTS.Stewart)}
        ${renderArchetypeCard('Mason', 'Task executor', 'Generic executor agent. Does not plan — runs tasks delegated by a Stewart. Bind to any area.', ARCHETYPE_TINTS.Mason)}
        ${renderArchetypeCard('Custom agent', 'Bring your own', 'Import an agent built elsewhere (your own Claude instance, a Mason from another fork). Registers a runtime + auth scope.', '#475569')}
      </div>
    </div>
  `;

  // Wiring
  document.getElementById('add-agent-btn')?.addEventListener('click', () => {
    openAddAgentOverlay({ bu: currentBu, runtimes, users, areas, installedModuleIds, availableModules, ctx });
  });

  document.querySelectorAll('[data-agent-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const agent_id = btn.dataset.agentEdit;
      const binding = bindings.find(b => b.agent_id === agent_id);
      if (!binding) return;
      openEditAgentOverlay({ bu: currentBu, binding, runtimes, users, areas, ctx });
    });
  });

  document.querySelectorAll('[data-agent-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const agent_id = btn.dataset.agentRemove;
      const binding = bindings.find(b => b.agent_id === agent_id);
      const label = binding ? agentDisplayName(binding) : agent_id;
      if (!window.confirm(`Remove ${label} from ${currentBuName}?\n\nThe agent's substrate (memos, tasks) stays; only the binding is dropped.`)) return;
      btn.disabled = true;
      try {
        const r = await fetch('/api/agent-binding-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: currentBu, action: 'remove', agent_id }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
        renderAgents(ctx);
      } catch (e) {
        alert(`Remove failed: ${e.message}`);
        btn.disabled = false;
      }
    });
  });
}

function agentDisplayName(b) {
  if (b.display_name) return b.display_name;
  // Within the current BU instance, "of <bu>" is implicit — it's the
  // installation. Drop it for legibility. Used by both Agents list rows and
  // Layers detail panel.
  if (b.module_id) return `${capitalize(b.module_id)} ${b.archetype || 'Stewart'}`;
  return `${b.archetype || 'Agent'}`;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function renderAgentRow(b, runtimes, users, areas, availableModules, isAdminLike) {
  const archetype = b.archetype || 'Stewart';
  const tint = ARCHETYPE_TINTS[archetype] || '#475569';
  const runtime = runtimes.find(r => r.id === b.runtime_id);
  const human = users.find(u => (u.email || '').toLowerCase() === (b.hitl_owner_email || '').toLowerCase());
  const mod = availableModules.find(m => m.id === b.module_id);
  const coveredAreaChips = (b.covers_areas || []).map(aid => {
    const area = areas.find(a => a.id === aid);
    return `<span style="display:inline-flex;align-items:center;padding:2px 8px;background:#f0f1f4;color:#475569;border-radius:99px;font-size:11px;font-weight:600;">${escapeHtml(area ? area.display_name : aid)}</span>`;
  }).join('');
  return `
    <div class="agent-row" style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:13px 16px;display:flex;align-items:center;gap:14px;">
      <span style="width:36px;height:36px;border-radius:50%;background:${tint}22;color:${tint};display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex:none;">⌬</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="font-size:14px;color:#1d2026;">${escapeHtml(agentDisplayName(b))}</strong>
          <span style="font:700 9px 'JetBrains Mono',ui-monospace,Menlo,monospace;background:${tint};color:#fff;padding:1px 7px;border-radius:99px;letter-spacing:.04em;">${escapeHtml(archetype.toUpperCase())}</span>
          ${b.lead ? '<span style="font:700 9px \'JetBrains Mono\',ui-monospace,Menlo,monospace;background:#7a4dff;color:#fff;padding:1px 7px;border-radius:99px;">LEAD</span>' : ''}
        </div>
        <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-top:3px;">
          ${b.module_id ? `${escapeHtml(mod?.display_name || b.module_id)} · ` : ''}runtime: ${escapeHtml(runtime?.display_name || b.runtime_id || '—')} · HITL: ${escapeHtml(human?.display_name || b.hitl_owner_email || '—')}
        </div>
        ${coveredAreaChips ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">${coveredAreaChips}</div>` : ''}
      </div>
      ${isAdminLike ? `
        <div style="display:flex;gap:6px;flex:none;">
          <button type="button" class="onboard-cancel" data-agent-edit="${escapeHtml(b.agent_id)}" style="padding:5px 11px;font-size:11px;">Edit</button>
          <button type="button" class="onboard-cancel" data-agent-remove="${escapeHtml(b.agent_id)}" style="padding:5px 11px;font-size:11px;color:#c12525;border-color:#f6cfca;">Remove</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderArchetypeCard(name, label, desc, tint) {
  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:13px 14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:24px;height:24px;border-radius:50%;background:${tint}22;color:${tint};display:inline-flex;align-items:center;justify-content:center;font-size:13px;">⌬</span>
        <strong style="font-size:13.5px;color:#1d2026;">${escapeHtml(name)}</strong>
      </div>
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;letter-spacing:.05em;margin-bottom:6px;">${escapeHtml(label.toUpperCase())}</div>
      <div style="font-size:12px;color:#5b6270;line-height:1.5;">${escapeHtml(desc)}</div>
    </div>
  `;
}

// ============ Add agent overlay ============

export function openAddAgentOverlay({ bu, runtimes, users, areas, installedModuleIds, availableModules, ctx, presetArea }) {
  // Build archetype options: Stewart of each installed module + generic Mason.
  const stewartOptions = (availableModules || [])
    .filter(m => installedModuleIds && installedModuleIds.has(m.id))
    .map(m => ({ key: `stewart-${m.id}`, label: `${m.icon || '⌬'} Stewart of ${m.display_name}`, archetype: 'Stewart', module_id: m.id }));
  const masonOption = { key: 'mason', label: '⌬ Mason — task executor', archetype: 'Mason', module_id: null };
  const archetypeOptions = [...stewartOptions, masonOption];

  const bodyHtml = `
    <div style="padding:6px 0;display:flex;flex-direction:column;gap:14px;">
      <label style="display:block;">
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">ARCHETYPE</span>
        <select id="agent-archetype" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;background:#fff;">
          ${archetypeOptions.map(opt => `<option value="${escapeHtml(opt.key)}">${escapeHtml(opt.label)}</option>`).join('')}
        </select>
      </label>
      <label id="agent-name-row" style="display:none;">
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">DISPLAY NAME</span>
        <input id="agent-name" type="text" placeholder="e.g. Pricing Mason" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;" />
      </label>
      <label>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">RUNTIME</span>
        <select id="agent-runtime" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;background:#fff;">
          ${runtimes.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.display_name)} (${escapeHtml(r.kind)})</option>`).join('')}
        </select>
      </label>
      <label>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">HITL OWNER</span>
        <select id="agent-hitl" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;background:#fff;">
          ${users.map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.display_name || u.email)} (${escapeHtml(u.email)})</option>`).join('')}
        </select>
      </label>
      <div>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">COVERS BUSINESS AREAS</span>
        <div id="agent-areas-grid" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${areas.map(a => `<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#f7f8fb;border:1.5px solid var(--border);border-radius:99px;cursor:pointer;font-size:12.5px;color:#3f4654;"><input type="checkbox" data-area-id="${escapeHtml(a.id)}" ${presetArea === a.id ? 'checked' : ''} style="accent-color:#2f6bff;"> ${escapeHtml(a.display_name)}</label>`).join('') || '<span style="color:#9aa1ae;font-size:12px;">No areas defined yet — add some in Layers first.</span>'}
        </div>
      </div>
      <div id="agent-error" style="display:none;padding:8px 12px;background:#fdebe9;color:#c12525;border-radius:8px;font-size:12px;"></div>
    </div>
  `;
  const footerHtml = `
    <button type="button" class="onboard-cancel" id="agent-cancel">Cancel</button>
    <button type="button" class="onboard-begin" id="agent-create">Add agent</button>
  `;
  openOverlay({
    title: 'Add an agent',
    subtitle: `${bu} · will write to agent_bindings.json`,
    iconHtml: '⌬',
    iconTint: '#7a4dff',
    bodyHtml,
    footerHtml,
  });

  const archetypeSel = document.getElementById('agent-archetype');
  const nameRow = document.getElementById('agent-name-row');
  const updateNameVisibility = () => {
    const opt = archetypeOptions.find(o => o.key === archetypeSel.value);
    nameRow.style.display = opt && opt.archetype === 'Mason' ? 'block' : 'none';
  };
  archetypeSel?.addEventListener('change', updateNameVisibility);
  updateNameVisibility();

  document.getElementById('agent-cancel')?.addEventListener('click', closeOverlay);
  document.getElementById('agent-create')?.addEventListener('click', async () => {
    const opt = archetypeOptions.find(o => o.key === archetypeSel.value);
    const runtime_id = document.getElementById('agent-runtime')?.value;
    const hitl_owner_email = document.getElementById('agent-hitl')?.value;
    const display_name = (document.getElementById('agent-name')?.value || '').trim();
    const covers_areas = Array.from(document.querySelectorAll('#agent-areas-grid input[type=checkbox]:checked')).map(el => el.dataset.areaId);
    const errEl = document.getElementById('agent-error');
    const showErr = (msg) => { if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg; } };
    if (!opt) return showErr('Pick an archetype.');
    if (opt.archetype === 'Mason' && !display_name) return showErr('Display name is required for a Mason.');
    if (!runtime_id) return showErr('Pick a runtime.');
    if (!hitl_owner_email) return showErr('Pick a HITL owner.');

    const agent_id = opt.archetype === 'Stewart'
      ? `${opt.module_id}-stewart-of-${bu}`
      : `mason-${slug(display_name)}-${bu}`;

    const payload = {
      bu, action: 'add', agent_id, archetype: opt.archetype,
      module_id: opt.module_id || null,
      runtime_id, hitl_owner_email, covers_areas,
      display_name: opt.archetype === 'Mason' ? display_name : null,
    };

    const btn = document.getElementById('agent-create');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch('/api/agent-binding-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      closeOverlay();
      // If we were invoked from the Layers view, re-render whatever route is current.
      if (location.hash.replace(/^#/, '') === 'agents') renderAgents(ctx);
      else if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('genus:agents-changed', { detail: { bu } }));
    } catch (e) {
      showErr(e.message);
      btn.disabled = false; btn.textContent = 'Add agent';
    }
  });
}

function openEditAgentOverlay({ bu, binding, runtimes, users, areas, ctx }) {
  const bodyHtml = `
    <div style="padding:6px 0;display:flex;flex-direction:column;gap:14px;">
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;letter-spacing:.06em;">${escapeHtml(binding.agent_id)}</div>
      <label>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">RUNTIME</span>
        <select id="edit-agent-runtime" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;background:#fff;">
          ${runtimes.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === binding.runtime_id ? 'selected' : ''}>${escapeHtml(r.display_name)} (${escapeHtml(r.kind)})</option>`).join('')}
        </select>
      </label>
      <label>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">HITL OWNER</span>
        <select id="edit-agent-hitl" style="width:100%;padding:9px 12px;font-size:14px;border:1px solid var(--border);border-radius:8px;outline:none;background:#fff;">
          ${users.map(u => `<option value="${escapeHtml(u.email)}" ${(u.email || '').toLowerCase() === (binding.hitl_owner_email || '').toLowerCase() ? 'selected' : ''}>${escapeHtml(u.display_name || u.email)} (${escapeHtml(u.email)})</option>`).join('')}
        </select>
      </label>
      <div>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;letter-spacing:.06em;display:block;margin-bottom:5px;">COVERS BUSINESS AREAS</span>
        <div id="edit-agent-areas" style="display:flex;flex-wrap:wrap;gap:6px;">
          ${areas.map(a => `<label style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#f7f8fb;border:1.5px solid var(--border);border-radius:99px;cursor:pointer;font-size:12.5px;color:#3f4654;"><input type="checkbox" data-area-id="${escapeHtml(a.id)}" ${(binding.covers_areas || []).includes(a.id) ? 'checked' : ''} style="accent-color:#2f6bff;"> ${escapeHtml(a.display_name)}</label>`).join('') || '<span style="color:#9aa1ae;font-size:12px;">No areas defined yet.</span>'}
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#1d2026;">
        <input id="edit-agent-lead" type="checkbox" ${binding.lead ? 'checked' : ''} />
        Lead agent for resolved overlaps
      </label>
      <div id="edit-agent-error" style="display:none;padding:8px 12px;background:#fdebe9;color:#c12525;border-radius:8px;font-size:12px;"></div>
    </div>
  `;
  const footerHtml = `
    <button type="button" class="onboard-cancel" id="edit-agent-cancel">Cancel</button>
    <button type="button" class="onboard-begin" id="edit-agent-save">Save</button>
  `;
  openOverlay({
    title: `Edit ${agentDisplayName(binding)}`,
    subtitle: `${bu} · ${binding.archetype || 'Stewart'}`,
    iconHtml: '⌬',
    iconTint: ARCHETYPE_TINTS[binding.archetype || 'Stewart'] || '#475569',
    bodyHtml,
    footerHtml,
  });
  document.getElementById('edit-agent-cancel')?.addEventListener('click', closeOverlay);
  document.getElementById('edit-agent-save')?.addEventListener('click', async () => {
    const runtime_id = document.getElementById('edit-agent-runtime')?.value;
    const hitl_owner_email = document.getElementById('edit-agent-hitl')?.value;
    const covers_areas = Array.from(document.querySelectorAll('#edit-agent-areas input[type=checkbox]:checked')).map(el => el.dataset.areaId);
    const lead = !!document.getElementById('edit-agent-lead')?.checked;
    const errEl = document.getElementById('edit-agent-error');
    const btn = document.getElementById('edit-agent-save');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch('/api/agent-binding-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, action: 'edit', agent_id: binding.agent_id, runtime_id, hitl_owner_email, covers_areas, lead }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      closeOverlay();
      if (location.hash.replace(/^#/, '') === 'agents') renderAgents(ctx);
      else if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('genus:agents-changed', { detail: { bu } }));
    } catch (e) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = e.message; }
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
}

function slug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}
