// Roster — unified registry view (Direction A: tabs).
//
// Replaces the standalone Agents / People / Modules views in the sidebar.
// Each entity type stays its own tab (with type-specific cards) but lives
// under one top-level surface. Per the Genus Roster design handoff.
//
// State shape (persisted in URL hash query):
//   #roster?tab=<all|people|agents|modules|tools|external>
//
// Data sources (read-only; CRUD lives in tab-specific overlays):
//   /api/admin-state — users + runtimes + agent bindings (BU-scoped)
//   bus/<bu>/business_areas.json — tools per area
//   bus/<bu>/external_access.json — external instances (substrate)
//   bus/<bu>/_registry.json — modules catalog + installed list

import { escapeHtml } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';
import { fetchSubstrateJson } from '../substrate-client.js';
import { getQueryParam } from '../router.js';
import { openAddAgentOverlay } from './agents.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

const TINTS = {
  genus:    { color: '#0e9f6e', soft: 'rgba(14,159,110,.10)', pill: 'GENUS AGENT' },
  stewart:  { color: '#2f6bff', soft: 'rgba(47,107,255,.10)', pill: 'STEWART' },
  mason:    { color: '#e0683a', soft: 'rgba(224,104,58,.10)', pill: 'TASK AGENT' },
  custom:   { color: '#7a4dff', soft: 'rgba(122,77,255,.10)', pill: 'CUSTOM' },
  external: { color: '#0e9aa0', soft: 'rgba(14,154,160,.10)', pill: 'EXTERNAL' },
};

const ROLE_TINTS = {
  owner:    { fg: '#7a4dff', bg: 'rgba(122,77,255,.12)' },
  admin:    { fg: '#2f6bff', bg: 'rgba(47,107,255,.12)' },
  member:   { fg: '#0e9f6e', bg: 'rgba(14,159,110,.12)' },
  observer: { fg: '#9aa1ae', bg: 'rgba(154,161,174,.16)' },
};

const STATUS = {
  running: { color: '#0e9f6e', anim: 'pulseDot 1.6s infinite', label: 'Running' },
  idle:    { color: '#9aa1ae', anim: 'none', label: 'Idle' },
  paused:  { color: '#c98a16', anim: 'none', label: 'Paused' },
};

const ARCH_BLURBS = {
  genus:   'Models your business areas and proposes how the venture is split. Auto-installed, one per BU.',
  stewart: 'A domain owner that plans, recommends and learns over time. One per module.',
  mason:   'A stateless task runner delegated by a Stewart. No memory, no opinions.',
  custom:  'Your own agent on your own runtime. The escape hatch for anything else.',
};

let CACHED_VIEWER = null;

function archetypeForBinding(b) {
  const raw = (b.archetype || '').toLowerCase();
  if (raw === 'mason' || raw === 'task agent') return 'mason';
  if (raw === 'custom') return 'custom';
  if (raw === 'admin' || raw === 'genus' || raw === 'genus agent') return 'genus';
  return 'stewart';
}

function moduleDisplayLabel(b, modulesCatalog) {
  if (!b.module_id) return '—';
  const m = modulesCatalog.find(m => m.id === b.module_id);
  return m ? m.display_name : b.module_id;
}

function agentDisplayName(b, modulesCatalog) {
  if (b.display_name) return b.display_name;
  const arch = archetypeForBinding(b);
  // Masons: derive the actual mason type from agent_id (pattern
  // "<type>-mason-of-<bu>") rather than just labelling every Mason with
  // its module name. Otherwise all Masons under Development show as
  // "Development Agent", which is what the operator flagged.
  if (arch === 'mason' && b.agent_id) {
    const m = String(b.agent_id).match(/^(.+?)-mason(?:-of-.+)?$/i);
    if (m && m[1]) {
      const words = m[1].split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1));
      return `${words.join(' ')} Mason`;
    }
  }
  if (b.module_id) {
    const m = modulesCatalog.find(mm => mm.id === b.module_id);
    const mod = m ? m.display_name : b.module_id;
    if (arch === 'genus') return 'Genus Agent';
    if (arch === 'mason') return `${mod} Agent`;
    return `${mod} Stewart`;
  }
  if (arch === 'genus') return 'Genus Agent';
  return b.agent_id;
}

function statusOf(b) {
  // No live status from substrate yet — default idle. Future: pull from Paperclip.
  return STATUS[b.status || 'idle'] || STATUS.idle;
}

export async function renderRoster(ctx) {
  const root = document.getElementById('route-roster');
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

  root.innerHTML = '<div class="card"><div class="card-body" style="padding:30px;text-align:center;color:#9aa1ae;font-size:13.5px;">Loading roster…</div></div>';

  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';

  let state, registry, areasFile, externalsFile;
  try {
    const [stateRes, registryFile, areasJson, extJson] = await Promise.all([
      fetch('/api/admin-state?bu=' + encodeURIComponent(currentBu)).then(r => r.json()).catch(() => ({ ok: false })),
      fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null).catch(() => null),
      fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/business_areas.json`, null).catch(() => null),
      fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/external_access.json`, null).catch(() => null),
    ]);
    if (!stateRes.ok) throw new Error(stateRes.message || 'admin-state failed');
    state = stateRes;
    registry = registryFile;
    areasFile = areasJson;
    externalsFile = extJson;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="card-body" style="padding:30px;color:#c12525;">Could not load roster: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }

  const users = state.users || [];
  const runtimes = state.runtimes || [];
  const allBindings = state.bindings || [];
  const bindings = allBindings.filter(b => b.bu === currentBu);
  const areas = (areasFile && areasFile.areas) || [];
  const availableModules = (registry && registry.available_modules) || [];
  const buEntry = (registry?.business_units || []).find(b => b.id === currentBu);
  const installedModuleIds = new Set(buEntry?.modules_installed || []);
  const installedModules = availableModules.filter(m => installedModuleIds.has(m.id));
  const externals = (externalsFile && externalsFile.entries) || [];

  // Tools: derive from business_areas.json — a flat list of {tool, area, resources}.
  const tools = [];
  for (const a of areas) {
    for (const t of (a.tools || [])) {
      tools.push({
        tool: t.tool,
        area_id: a.id,
        area_name: a.display_name,
        resources: t.resources || [],
      });
    }
  }

  const currentBuName = buEntry?.display_name || currentBu;
  const isAdminLike = viewer.role === 'owner' || viewer.role === 'admin';

  // Active tab from URL hash query (#roster?tab=people). Defaults to 'all'.
  const activeTab = getQueryParam('tab') || 'all';

  const counts = {
    all: bindings.length + users.length + installedModules.length + tools.length + externals.length,
    people: users.length,
    agents: bindings.length,
    modules: installedModules.length,
    tools: tools.length,
    external: externals.length,
  };

  root.innerHTML = renderShell(currentBuName, activeTab, counts, isAdminLike) + renderTabContent(activeTab, {
    bu: currentBu,
    buName: currentBuName,
    bindings, users, installedModules, availableModules, tools, externals,
    runtimes, areas, isAdminLike,
  });

  wireRoster({
    bu: currentBu,
    buName: currentBuName,
    bindings, users, runtimes, areas, installedModuleIds, availableModules, externals, isAdminLike,
    ctx,
  });
}

// ============ Shell ============

function renderShell(buName, activeTab, counts, isAdminLike) {
  const tabDefs = [
    ['all', 'All'],
    ['people', 'People'],
    ['agents', 'Agents'],
    ['modules', 'Modules'],
    ['tools', 'Tools'],
    ['external', 'External'],
  ];
  return `
    <header style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px;">
      <div>
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:8px;">${escapeHtml(buName)} · Connected entities</div>
        <h1 style="font-size:30px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">Roster</h1>
        <p style="margin:7px 0 0;color:#6b7280;font-size:14.5px;max-width:560px;">Everyone and everything with access to this venture — people, agents, modules, tools and outside instances, in one place.</p>
      </div>
      ${isAdminLike ? `
        <button type="button" id="roster-add-btn" class="primary-btn-pill" style="display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(47,107,255,.28);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Add
        </button>` : ''}
    </header>

    <div class="roster-tabs" style="display:flex;gap:4px;border-bottom:1px solid rgba(20,22,28,.09);margin-bottom:24px;">
      ${tabDefs.map(([k, label]) => {
        const on = k === activeTab;
        const fg = on ? '#16181d' : '#9aa1ae';
        const weight = on ? 700 : 500;
        const border = on ? '#2f6bff' : 'transparent';
        const cntFg = on ? '#fff' : '#9aa1ae';
        const cntBg = on ? '#2f6bff' : 'rgba(20,22,28,.06)';
        return `<button type="button" data-tab="${k}" style="position:relative;display:flex;align-items:center;gap:7px;padding:10px 14px 12px;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:${weight};color:${fg};border-bottom:2px solid ${border};margin-bottom:-1px;">
          ${label}
          <span style="font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${cntFg};background:${cntBg};border-radius:99px;padding:1px 7px;">${counts[k]}</span>
        </button>`;
      }).join('')}
    </div>
  `;
}

function renderTabContent(activeTab, data) {
  const sections = [];
  if (activeTab === 'all' || activeTab === 'people')   sections.push(renderPeopleSection(data));
  if (activeTab === 'all' || activeTab === 'agents')   sections.push(renderAgentsSection(data));
  if (activeTab === 'all' || activeTab === 'modules')  sections.push(renderModulesSection(data));
  if (activeTab === 'all' || activeTab === 'tools')    sections.push(renderToolsSection(data));
  if (activeTab === 'all' || activeTab === 'external') sections.push(renderExternalSection(data));
  return sections.join('<div style="height:24px;"></div>');
}

// ============ Per-tab sections (read views) ============

function renderPeopleSection({ users, buName, isAdminLike }) {
  if (users.length === 0) {
    return renderEmptyPanel({
      icon: '👤',
      iconColor: '#2f6bff',
      iconBg: 'rgba(47,107,255,.10)',
      title: 'No people yet',
      copy: `Invite the humans who own and review this venture.`,
      cta: isAdminLike ? { label: '+ Add a person', action: 'add-person' } : null,
    });
  }
  return `<div style="display:flex;flex-direction:column;gap:9px;">
    ${users.map(u => renderPersonRow(u)).join('')}
  </div>`;
}

function renderPersonRow(u) {
  const role = (u.role || 'observer').toLowerCase();
  const tint = ROLE_TINTS[role] || ROLE_TINTS.observer;
  const initials = (u.display_name || u.email || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const ventures = Array.isArray(u.ventures) ? u.ventures : [];
  const scope = ventures.includes('*') ? 'All ventures' : ventures.join(' · ') || 'Read-only';
  return `<div style="display:flex;align-items:center;gap:15px;padding:15px 17px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <span style="width:42px;height:42px;flex:none;border-radius:99px;background:linear-gradient(135deg,#2f6bff,#7a4dff);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">${escapeHtml(initials)}</span>
    <span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
      <span style="font-weight:700;font-size:15px;">${escapeHtml(u.display_name || u.email)}</span>
      <span style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(u.email)}</span>
    </span>
    <span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:${tint.fg};background:${tint.bg};border-radius:6px;padding:4px 9px;flex:none;">${role}</span>
    <span style="width:200px;flex:none;font-size:13px;color:#5b6270;">${escapeHtml(scope)}</span>
  </div>`;
}

function renderAgentsSection({ bindings, runtimes, users, availableModules, areas }) {
  const orderArch = ['genus', 'stewart', 'mason', 'custom'];
  const ordered = [...bindings].sort((a, b) => orderArch.indexOf(archetypeForBinding(a)) - orderArch.indexOf(archetypeForBinding(b)));

  const agentRows = ordered.length === 0
    ? renderEmptyPanel({
        icon: '⌬',
        iconColor: '#2f6bff',
        iconBg: 'rgba(47,107,255,.10)',
        title: 'No agents bound yet',
        copy: 'Install a module — its Stewart appears here automatically.',
        cta: { label: '+ Add an agent', action: 'add-agent' },
      })
    : `<div style="display:flex;flex-direction:column;gap:9px;">
        ${ordered.map(b => renderAgentRow(b, runtimes, users, availableModules)).join('')}
      </div>`;

  // Archetype catalog (always shown — orientation, not data-dependent)
  const catalog = ['genus', 'stewart', 'mason', 'custom'].map(k => {
    const tint = TINTS[k];
    const title = k === 'genus' ? 'Genus Agent' : k === 'stewart' ? 'Stewart' : k === 'mason' ? 'Agent (Mason)' : 'Custom agent';
    const count = ordered.filter(b => archetypeForBinding(b) === k).length;
    const countLabel = (count === 1 ? '1 instance' : `${count} instances`) + ' · Learn more';
    return `<button type="button" data-arch="${k}" class="arch-card" style="display:flex;flex-direction:column;gap:11px;text-align:left;padding:17px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:14px;cursor:pointer;box-shadow:0 1px 2px rgba(16,18,28,.04);font-family:inherit;transition:all .15s;">
      <span style="width:38px;height:38px;border-radius:10px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;">${archetypeIconSvg(k, tint.color)}</span>
      <span style="font-weight:700;font-size:14.5px;">${title}</span>
      <span style="font-size:12.5px;color:#6b7280;line-height:1.45;min-height:54px;">${escapeHtml(ARCH_BLURBS[k])}</span>
      <span style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:${tint.color};margin-top:2px;">${countLabel}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      </span>
    </button>`;
  }).join('');

  return `
    ${agentRows}
    <div style="margin-top:34px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">
        <h2 style="font-size:17px;font-weight:700;letter-spacing:-.01em;margin:0;">Archetype catalog</h2>
        <span style="font-size:13px;color:#9aa1ae;">Learn what a family is before you add one</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:13px;margin-top:14px;">
        ${catalog}
      </div>
    </div>
  `;
}

function renderAgentRow(b, runtimes, users, modulesCatalog) {
  const arch = archetypeForBinding(b);
  const tint = TINTS[arch];
  const runtime = runtimes.find(r => r.id === b.runtime_id);
  const human = users.find(u => (u.email || '').toLowerCase() === (b.hitl_owner_email || '').toLowerCase());
  const st = statusOf(b);
  const name = agentDisplayName(b, modulesCatalog);
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return `<button type="button" data-agent-id="${escapeHtml(b.agent_id)}" class="agent-row" style="display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;cursor:pointer;box-shadow:0 1px 2px rgba(16,18,28,.04);font-family:inherit;transition:all .15s;">
    <span style="width:42px;height:42px;flex:none;border-radius:11px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;letter-spacing:-.02em;">${escapeHtml(initials)}</span>
    <span style="display:flex;flex-direction:column;gap:5px;min-width:0;flex:1;">
      <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:15px;letter-spacing:-.01em;white-space:nowrap;">${escapeHtml(name)}</span>
        <span style="font:600 9px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${tint.color};background:${tint.soft};border-radius:5px;padding:2px 6px;">${tint.pill}</span>
      </span>
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(runtime?.display_name || b.runtime_id || '—')}</span>
    </span>
    <span style="display:flex;flex-direction:column;align-items:flex-start;gap:5px;width:150px;flex:none;">
      <span style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#5b6270;"><span style="font:500 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#bcc1cb;letter-spacing:.06em;">MOD</span><span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(moduleDisplayLabel(b, modulesCatalog))}</span></span>
      <span style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#5b6270;"><span style="font:500 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#bcc1cb;letter-spacing:.06em;">HITL</span><span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(human?.display_name || b.hitl_owner_email || '—')}</span></span>
    </span>
    <span style="display:flex;align-items:center;gap:7px;width:88px;flex:none;">
      <span style="width:8px;height:8px;flex:none;border-radius:99px;background:${st.color};animation:${st.anim};"></span>
      <span style="font-size:12.5px;font-weight:500;color:#5b6270;">${st.label}</span>
    </span>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c2c7d0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="m9 6 6 6-6 6"/></svg>
  </button>`;
}

function renderModulesSection({ installedModules, bindings, availableModules, buName, isAdminLike }) {
  if (installedModules.length === 0) {
    return renderEmptyPanel({
      icon: '▣',
      iconColor: '#5b6270',
      iconBg: 'rgba(20,22,28,.06)',
      title: 'No modules installed',
      copy: 'Install a module to bring a Stewart and the views it provides.',
      cta: isAdminLike ? { label: '+ Install a module', action: 'install-module' } : null,
    });
  }
  return `<div style="display:flex;flex-direction:column;gap:9px;">
    ${installedModules.map(m => {
      const binding = bindings.find(b => b.module_id === m.id);
      const stewart = binding ? agentDisplayName(binding, availableModules) : `${m.display_name} Stewart`;
      const manifest = `${m.id}.module.json`;
      return `<div style="display:flex;align-items:center;gap:15px;padding:15px 17px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
        <span style="width:42px;height:42px;flex:none;border-radius:11px;background:rgba(20,22,28,.05);color:#5b6270;display:flex;align-items:center;justify-content:center;">${m.icon || '▣'}</span>
        <span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
          <span style="display:flex;align-items:center;gap:9px;"><span style="font-weight:700;font-size:15px;">${escapeHtml(m.display_name)}</span><span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">v${escapeHtml(m.version || '0')}</span></span>
          <span style="font-size:12.5px;color:#9aa1ae;">Binds → <span style="color:#2f6bff;font-weight:600;">${escapeHtml(stewart)}</span></span>
        </span>
        <span style="width:200px;flex:none;font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(manifest)}</span>
        <span style="display:flex;align-items:center;gap:7px;flex:none;"><span style="width:8px;height:8px;border-radius:99px;background:#0e9f6e;"></span><span style="font-size:13px;font-weight:500;color:#5b6270;">Installed</span></span>
      </div>`;
    }).join('')}
  </div>`;
}

function renderToolsSection({ tools, isAdminLike }) {
  if (tools.length === 0) {
    return renderEmptyPanel({
      icon: '🔧',
      iconColor: '#5b6270',
      iconBg: 'rgba(20,22,28,.06)',
      title: 'No tools connected',
      copy: 'Tools wire to business areas. Connect them inside Layers area detail.',
      cta: { label: 'Open Layers', action: 'goto-layers' },
    });
  }
  return `
    <div style="font-size:13px;color:#9aa1ae;margin-bottom:14px;">Tools are connected inside Layers areas — the Roster lists them; coverage still lives in <span style="color:#2f6bff;font-weight:600;cursor:pointer;" id="roster-goto-layers">Layers</span>.</div>
    <div style="display:flex;flex-direction:column;gap:9px;">
      ${tools.map(t => {
        const initials = (t.tool || '?').slice(0, 2).toUpperCase();
        const resources = (t.resources || []).map(r => r.kind || r.name).filter(Boolean).slice(0, 3);
        return `<div style="display:flex;align-items:center;gap:15px;padding:15px 17px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
          <span style="width:42px;height:42px;flex:none;border-radius:11px;background:rgba(20,22,28,.05);color:#5b6270;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">${escapeHtml(initials)}</span>
          <span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
            <span style="font-weight:700;font-size:15px;">${escapeHtml(t.tool)}</span>
            <span style="font-size:12.5px;color:#9aa1ae;">in <span style="color:#5b6270;font-weight:600;">${escapeHtml(t.area_name)}</span></span>
          </span>
          <span style="display:flex;gap:6px;flex:none;flex-wrap:wrap;">
            ${resources.map(r => `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;background:rgba(20,22,28,.05);border-radius:6px;padding:3px 8px;">${escapeHtml(r)}</span>`).join('')}
          </span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderExternalSection({ externals, isAdminLike }) {
  if (externals.length === 0) {
    return renderEmptyPanel({
      icon: '🌐',
      iconColor: '#0e9aa0',
      iconBg: 'rgba(14,154,160,.10)',
      title: 'No outside instances yet',
      copy: `Give another Claude instance scoped access to this venture's substrate — it can read and write through its own setup, no dashboard login required.`,
      cta: isAdminLike ? { label: '+ Grant external access', action: 'grant-external', color: '#0e9aa0' } : null,
    });
  }
  return `<div style="display:flex;flex-direction:column;gap:9px;">
    ${externals.map(e => `<button type="button" data-external-id="${escapeHtml(e.id)}" class="external-row" style="display:flex;align-items:center;gap:15px;width:100%;text-align:left;padding:15px 17px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;cursor:pointer;box-shadow:0 1px 2px rgba(16,18,28,.04);font-family:inherit;transition:all .15s;">
      <span style="width:42px;height:42px;flex:none;border-radius:11px;background:rgba(14,154,160,.10);color:#0e9aa0;display:flex;align-items:center;justify-content:center;">${globeIconSvg('#0e9aa0')}</span>
      <span style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
        <span style="display:flex;align-items:center;gap:9px;"><span style="font-weight:700;font-size:15px;">${escapeHtml(e.display_name)}</span><span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;color:#0e9aa0;background:rgba(14,154,160,.10);border-radius:5px;padding:2px 7px;">EXTERNAL</span></span>
        <span style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(e.url || `https://genus.app/api/bus/${e.bu}`)}</span>
      </span>
      <span style="display:flex;gap:6px;flex:none;flex-wrap:wrap;">
        ${(e.scopes || []).map(s => `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;background:rgba(20,22,28,.05);border-radius:6px;padding:3px 8px;">${escapeHtml(s)}</span>`).join('')}
      </span>
      <span style="width:120px;flex:none;font-size:12.5px;color:#9aa1ae;">Last seen ${escapeHtml(e.last_seen || '—')}</span>
      <span data-revoke="${escapeHtml(e.id)}" style="font-size:12.5px;font-weight:600;color:#c0392b;background:rgba(192,57,43,.07);border-radius:8px;padding:6px 12px;flex:none;cursor:pointer;">Revoke</span>
    </button>`).join('')}
  </div>`;
}

function renderEmptyPanel({ icon, iconColor, iconBg, title, copy, cta }) {
  return `<div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;background:#fbfbfc;">
    <span style="width:54px;height:54px;border-radius:14px;background:${iconBg};color:${iconColor};display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">${icon}</span>
    <h3 style="font-size:17px;font-weight:700;letter-spacing:-.01em;margin:0;">${escapeHtml(title)}</h3>
    <p style="margin:7px 0 0;font-size:13.5px;color:#6b7280;max-width:380px;line-height:1.5;">${escapeHtml(copy)}</p>
    ${cta ? `<button type="button" data-empty-cta="${cta.action}" style="margin-top:18px;display:flex;align-items:center;gap:8px;padding:10px 17px;border:none;border-radius:11px;background:${cta.color || '#2f6bff'};color:#fff;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;">${escapeHtml(cta.label)}</button>` : ''}
  </div>`;
}

// ============ Icons ============

function archetypeIconSvg(kind, color) {
  if (kind === 'genus') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;
  if (kind === 'stewart') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="${color}"/></svg>`;
  if (kind === 'mason') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 14 2 2 4-4"/></svg>`;
  if (kind === 'custom') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/><path d="M9.5 12l2 2 3.5-4"/></svg>`;
  return '';
}

function globeIconSvg(color) {
  return `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c2.5 2.7 3.8 6.3 3.8 10S14.5 19.3 12 22M12 2C9.5 4.7 8.2 8.3 8.2 12s1.3 7.3 3.8 10"/></svg>`;
}

// ============ Wiring ============

function wireRoster({ bu, buName, bindings, users, runtimes, areas, installedModuleIds, availableModules, externals, isAdminLike, ctx }) {
  // Tab switching: writes ?tab=... into hash so back/forward + reload remember
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      const next = tab === 'all' ? '#roster' : `#roster?tab=${tab}`;
      // Replace hash without triggering a full route re-resolution (same route),
      // then manually re-render the roster contents.
      history.replaceState(null, '', next);
      renderRoster(ctx);
    });
  });

  // + Add → type picker
  document.getElementById('roster-add-btn')?.addEventListener('click', () => {
    openAddTypePicker({ bu, buName, runtimes, users, areas, installedModuleIds, availableModules, ctx });
  });

  // Agent row click → agent detail
  document.querySelectorAll('.agent-row').forEach(row => {
    row.addEventListener('click', () => {
      const agent_id = row.dataset.agentId;
      location.hash = `#agent-detail/${encodeURIComponent(agent_id)}`;
    });
    rowHover(row);
  });

  // Archetype card click → archetype reference
  document.querySelectorAll('.arch-card').forEach(card => {
    card.addEventListener('click', () => {
      const arch = card.dataset.arch;
      location.hash = `#archetype/${arch}`;
    });
    card.addEventListener('mouseenter', () => {
      const arch = card.dataset.arch;
      const tint = TINTS[arch];
      card.style.borderColor = tint.color;
      card.style.boxShadow = '0 6px 18px rgba(16,18,28,.08)';
      card.style.transform = 'translateY(-2px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'rgba(20,22,28,.08)';
      card.style.boxShadow = '0 1px 2px rgba(16,18,28,.04)';
      card.style.transform = '';
    });
  });

  // External row click → external detail; revoke chip inside row stops propagation
  document.querySelectorAll('.external-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-revoke]')) return;
      const id = row.dataset.externalId;
      location.hash = `#agent-detail/${encodeURIComponent(id)}`;
    });
    rowHover(row);
  });

  document.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.revoke;
      const ent = externals.find(x => x.id === id);
      if (!ent) return;
      if (!await showConfirm(`Revoke access for ${ent.display_name}? Their token stops working immediately.`)) return;
      btn.textContent = '…';
      try {
        const r = await fetch('/api/external-access-edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu, action: 'remove', id }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
        renderRoster(ctx);
      } catch (err) {
        await showAlert(`Revoke failed: ${err.message}`);
        btn.textContent = 'Revoke';
      }
    });
  });

  // Empty-state CTAs
  document.querySelectorAll('[data-empty-cta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.emptyCta;
      if (act === 'add-person') openAddTypePicker({ bu, buName, runtimes, users, areas, installedModuleIds, availableModules, ctx, preset: 'person' });
      else if (act === 'add-agent') openAddAgentOverlay({ bu, runtimes, users, areas, installedModuleIds, availableModules, ctx });
      else if (act === 'install-module') location.hash = '#modules';
      else if (act === 'goto-layers') location.hash = '#layers';
      else if (act === 'grant-external') openGrantExternalOverlay({ bu, users, areas, ctx });
    });
  });

  document.getElementById('roster-goto-layers')?.addEventListener('click', () => { location.hash = '#layers'; });

  // Re-render when an agents-changed event fires (e.g. after Add overlay closes)
  if (!window.__rosterListener) {
    window.addEventListener('genus:agents-changed', () => {
      if (location.hash.replace(/^#/, '').split('/')[0].split('?')[0] === 'roster') renderRoster(ctx);
    });
    window.__rosterListener = true;
  }
}

function rowHover(row) {
  row.addEventListener('mouseenter', () => {
    row.style.borderColor = 'rgba(20,22,28,.18)';
    row.style.boxShadow = '0 4px 14px rgba(16,18,28,.07)';
  });
  row.addEventListener('mouseleave', () => {
    row.style.borderColor = 'rgba(20,22,28,.08)';
    row.style.boxShadow = '0 1px 2px rgba(16,18,28,.04)';
  });
}

// ============ Add type picker overlay ============

function openAddTypePicker({ bu, buName, runtimes, users, areas, installedModuleIds, availableModules, ctx, preset }) {
  const types = [
    { kind: 'person', color: '#2f6bff', soft: 'rgba(47,107,255,.10)', title: 'Person', desc: 'A human with a role + email', action: 'person' },
    { kind: 'agent', color: '#2f6bff', soft: 'rgba(47,107,255,.10)', title: 'Agent', desc: 'Bind a Stewart, Task agent or Custom', action: 'agent' },
    { kind: 'module', color: '#5b6270', soft: 'rgba(20,22,28,.06)', title: 'Module', desc: 'Install a module — creates a Stewart', action: 'module' },
    { kind: 'tool', color: '#5b6270', soft: 'rgba(20,22,28,.06)', title: 'Tool', desc: 'Connect a tool inside an area', action: 'tool' },
    { kind: 'external', color: '#0e9aa0', soft: 'rgba(14,154,160,.10)', title: 'External access', desc: 'Give an outside Claude scoped access', action: 'external' },
  ];
  const bodyHtml = `
    <div style="padding:4px 0;display:flex;flex-direction:column;gap:8px;">
      ${types.map(t => `<button type="button" data-add-type="${t.action}" style="display:flex;align-items:center;gap:14px;text-align:left;padding:14px 15px;background:#fbfbfc;border:1px solid rgba(20,22,28,.08);border-radius:12px;cursor:pointer;font-family:inherit;transition:all .12s;">
        <span style="width:40px;height:40px;flex:none;border-radius:11px;background:${t.soft};color:${t.color};display:flex;align-items:center;justify-content:center;">${typeIconSvg(t.kind, t.color)}</span>
        <span style="display:flex;flex-direction:column;gap:2px;flex:1;">
          <span style="font-weight:700;font-size:14.5px;">${escapeHtml(t.title)}</span>
          <span style="font-size:12.5px;color:#9aa1ae;">${escapeHtml(t.desc)}</span>
        </span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c2c7d0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      </button>`).join('')}
    </div>
  `;
  openOverlay({
    title: `Add to ${buName}`,
    subtitle: 'What do you want to connect to this venture?',
    iconHtml: '+',
    iconTint: '#2f6bff',
    bodyHtml,
  });
  document.querySelectorAll('[data-add-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.addType;
      closeOverlay();
      if (act === 'person') {
        history.replaceState(null, '', '#roster?tab=people');
        location.hash = '#people'; // existing add-person flow
      } else if (act === 'agent') {
        openAddAgentOverlay({ bu, runtimes, users, areas, installedModuleIds, availableModules, ctx });
      } else if (act === 'module') {
        location.hash = '#modules';
      } else if (act === 'tool') {
        location.hash = '#layers';
      } else if (act === 'external') {
        openGrantExternalOverlay({ bu, users, areas, ctx });
      }
    });
  });
}

function typeIconSvg(kind, color) {
  if (kind === 'person') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`;
  if (kind === 'agent') return archetypeIconSvg('stewart', color);
  if (kind === 'module') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/><path d="M6.5 14v7M3 17.5h7"/></svg>`;
  if (kind === 'tool') return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1.5 1.5 0 0 0 2 2l6-6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2z"/></svg>`;
  if (kind === 'external') return globeIconSvg(color);
  return '';
}

// ============ Grant external access overlay ============

const SCOPE_META = [
  { key: 'read', desc: 'read any substrate file' },
  { key: 'write-recommendations', desc: 'append recommendations' },
  { key: 'write-tasks', desc: 'create tasks' },
  { key: 'write-areas', desc: 'edit business areas' },
];

let GRANT_STATE = { proto: 'rest', scopes: { read: true, 'write-recommendations': true, 'write-tasks': false, 'write-areas': false } };

export function openGrantExternalOverlay({ bu, users, areas, ctx }) {
  GRANT_STATE = { proto: 'rest', scopes: { read: true, 'write-recommendations': true, 'write-tasks': false, 'write-areas': false } };
  renderGrantOverlay({ bu, users, areas, ctx });
}

function renderGrantOverlay({ bu, users, areas, ctx }) {
  const teal = '#0e9aa0';
  const purple = '#7a4dff';
  const proto = GRANT_STATE.proto;
  const restBorder = proto === 'rest' ? teal : 'rgba(20,22,28,.1)';
  const restBg = proto === 'rest' ? 'rgba(14,154,160,.05)' : '#fff';
  const mcpBorder = proto === 'mcp' ? purple : 'rgba(20,22,28,.1)';
  const mcpBg = proto === 'mcp' ? 'rgba(122,77,255,.05)' : '#fff';
  const ownerOptions = users.map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.display_name || u.email)}</option>`).join('');

  const restForm = `
    <div style="margin-top:18px;display:flex;flex-direction:column;gap:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#aab0bb;">Display name</span>
          <input id="grant-name" type="text" placeholder="Partner Claude · Acme" style="margin-top:7px;padding:11px 13px;border:1px solid rgba(20,22,28,.12);border-radius:10px;font-size:13.5px;color:#16181d;width:100%;outline:none;font-family:inherit;" />
        </div>
        <div>
          <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#aab0bb;">Accountable owner</span>
          <select id="grant-owner" style="margin-top:7px;padding:11px 13px;border:1px solid rgba(20,22,28,.12);border-radius:10px;font-size:13.5px;color:#16181d;width:100%;outline:none;background:#fff;font-family:inherit;">${ownerOptions}</select>
        </div>
      </div>
      <div>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#aab0bb;">Scope</span>
        <div id="grant-scopes" style="display:flex;flex-direction:column;gap:8px;margin-top:9px;">
          ${SCOPE_META.map(({ key, desc }) => {
            const on = !!GRANT_STATE.scopes[key];
            const border = on ? 'rgba(14,154,160,.4)' : 'rgba(20,22,28,.1)';
            const bg = on ? 'rgba(14,154,160,.05)' : '#fff';
            const boxBorder = on ? teal : 'rgba(20,22,28,.2)';
            const boxBg = on ? teal : '#fff';
            const check = on ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>' : '';
            return `<button type="button" data-scope="${key}" style="display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid ${border};border-radius:10px;background:${bg};cursor:pointer;font-family:inherit;text-align:left;">
              <span style="width:19px;height:19px;flex:none;border-radius:6px;border:1.5px solid ${boxBorder};background:${boxBg};display:flex;align-items:center;justify-content:center;">${check}</span>
              <span style="font:600 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;flex:1;">${key}</span>
              <span style="font-size:12px;color:#9aa1ae;">${desc}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
      <div>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#aab0bb;">Generated token (preview)</span>
        <div style="margin-top:9px;display:flex;align-items:center;gap:8px;padding:11px 13px;background:#16181d;border-radius:10px;">
          <span style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#7fd9c4;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(`gns_${bu.slice(0,3)}_…(generated server-side)`)}</span>
        </div>
        <div style="font-size:11.5px;color:#9aa1ae;margin-top:6px;">The real token is generated when you click Grant; shown once on success — store it then.</div>
      </div>
      <div>
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#aab0bb;">Paste into the external setup</span>
        <pre style="margin-top:9px;padding:14px;background:#fbfbfc;border:1px solid rgba(20,22,28,.1);border-radius:11px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#3a3f4a;line-height:1.6;overflow-x:auto;white-space:pre;">curl https://genus.app/api/bus/${escapeHtml(bu)} \\
  -H "Authorization: Bearer &lt;your-token&gt;"</pre>
      </div>
      <div id="grant-error" style="display:none;padding:8px 12px;background:#fdebe9;color:#c12525;border-radius:8px;font-size:12px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px;">
        <button type="button" id="grant-cancel" class="onboard-cancel" style="padding:10px 18px;font-size:13.5px;font-weight:600;">Cancel</button>
        <button type="button" id="grant-submit" style="padding:10px 20px;border:none;border-radius:10px;background:${teal};color:#fff;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;">Grant access</button>
      </div>
    </div>
  `;

  const mcpNote = `
    <div style="margin-top:14px;padding:14px 16px;background:rgba(122,77,255,.06);border:1px solid rgba(122,77,255,.18);border-radius:12px;font-size:13px;color:#5b6270;line-height:1.5;">
      MCP server is a <strong style="color:#7a4dff;">v2 follow-up</strong> (separate brief). Ship REST tokens first; reserve MCP for when the server is stood up.
    </div>
  `;

  const bodyHtml = `
    <div style="padding:2px 0;">
      <div style="margin-top:8px;">
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#aab0bb;">Connection protocol</span>
        <div style="display:flex;gap:8px;margin-top:9px;">
          <button type="button" data-proto="rest" style="flex:1;text-align:left;padding:13px 15px;border:1.5px solid ${restBorder};border-radius:12px;background:${restBg};cursor:pointer;font-family:inherit;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:#16181d;">REST token<span style="font:600 9px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#0e9f6e;background:rgba(14,159,110,.12);border-radius:5px;padding:2px 6px;">SHIPS NOW</span></div>
            <div style="font-size:12px;color:#9aa1ae;margin-top:4px;">Scoped bearer token + REST endpoints. Simplest to stand up.</div>
          </button>
          <button type="button" data-proto="mcp" style="flex:1;text-align:left;padding:13px 15px;border:1.5px solid ${mcpBorder};border-radius:12px;background:${mcpBg};cursor:pointer;font-family:inherit;opacity:.92;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;color:#16181d;">MCP server<span style="font:600 9px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#7a4dff;background:rgba(122,77,255,.12);border-radius:5px;padding:2px 6px;">V2</span></div>
            <div style="font-size:12px;color:#9aa1ae;margin-top:4px;">Native tool access for Claude. Cleaner — requires the MCP stand-up.</div>
          </button>
        </div>
      </div>
      ${proto === 'mcp' ? mcpNote : restForm}
    </div>
  `;
  openOverlay({
    title: 'Grant external access',
    subtitle: `Let an outside Claude instance read & write ${bu}'s substrate.`,
    iconHtml: globeIconSvg('#0e9aa0'),
    iconTint: '#0e9aa0',
    bodyHtml,
  });

  document.querySelectorAll('[data-proto]').forEach(btn => {
    btn.addEventListener('click', () => {
      GRANT_STATE.proto = btn.dataset.proto;
      renderGrantOverlay({ bu, users, areas, ctx });
    });
  });
  document.querySelectorAll('[data-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.scope;
      GRANT_STATE.scopes[key] = !GRANT_STATE.scopes[key];
      renderGrantOverlay({ bu, users, areas, ctx });
    });
  });
  document.getElementById('grant-cancel')?.addEventListener('click', closeOverlay);
  document.getElementById('grant-submit')?.addEventListener('click', async () => {
    if (GRANT_STATE.proto !== 'rest') return; // MCP is v2 stub
    const name = (document.getElementById('grant-name')?.value || '').trim();
    const owner = document.getElementById('grant-owner')?.value;
    const errEl = document.getElementById('grant-error');
    const scopes = Object.keys(GRANT_STATE.scopes).filter(k => GRANT_STATE.scopes[k]);
    if (!name) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Display name is required.'; }
      return;
    }
    if (scopes.length === 0) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Pick at least one scope.'; }
      return;
    }
    const btn = document.getElementById('grant-submit');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await fetch('/api/external-access-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, action: 'add', display_name: name, owner_email: owner, protocol: 'rest', scopes }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      closeOverlay();
      // Show the one-time token reveal
      showTokenReveal(j.entry, ctx);
    } catch (e) {
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = e.message; }
      btn.disabled = false; btn.textContent = 'Grant access';
    }
  });
}

function showTokenReveal(entry, ctx) {
  const teal = '#0e9aa0';
  const bodyHtml = `
    <div style="padding:6px 0;display:flex;flex-direction:column;gap:14px;">
      <p style="font-size:13.5px;color:#5b6270;line-height:1.6;margin:0;">
        Token generated for <strong>${escapeHtml(entry.display_name)}</strong>. Copy it now — you won't see it again.
      </p>
      <div style="padding:13px 14px;background:#16181d;border-radius:10px;display:flex;align-items:center;gap:8px;">
        <span id="token-text" style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#7fd9c4;flex:1;overflow-wrap:anywhere;">${escapeHtml(entry.token || '')}</span>
        <button type="button" id="token-copy" style="font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#fff;background:rgba(255,255,255,.12);border:none;border-radius:7px;padding:5px 10px;cursor:pointer;">Copy</button>
      </div>
      <pre style="padding:14px;background:#fbfbfc;border:1px solid rgba(20,22,28,.1);border-radius:11px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#3a3f4a;line-height:1.6;overflow-x:auto;white-space:pre;margin:0;">curl https://genus.app/api/bus/${escapeHtml(entry.bu)} \\
  -H "Authorization: Bearer ${escapeHtml(entry.token || '')}"</pre>
      <div style="display:flex;justify-content:flex-end;">
        <button type="button" id="token-done" class="primary-btn-pill" style="background:${teal};">Done</button>
      </div>
    </div>
  `;
  openOverlay({
    title: 'Token generated — copy it now',
    subtitle: 'It will not be shown again. The token is stored only as a hash on the server.',
    iconHtml: '🔑',
    iconTint: teal,
    bodyHtml,
  });
  document.getElementById('token-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entry.token || '');
      document.getElementById('token-copy').textContent = 'Copied';
    } catch {}
  });
  document.getElementById('token-done')?.addEventListener('click', () => {
    closeOverlay();
    // Switch to external tab
    history.replaceState(null, '', '#roster?tab=external');
    renderRoster(ctx);
  });
}
