// Agent detail page — opens when clicking an agent or external row in Roster.
// Answers "why is this agent installed and not something else?" rather than
// "what is it doing right now" — operational control lives in Paperclip
// (we link out to it via the Open in Paperclip button).
//
// Route: #agent-detail/<agent_id> — id resolves from agent_bindings.json OR
// from external_access.json#entries (External variant).

import { escapeHtml } from '../utils.js';
import { fetchSubstrateJson } from '../substrate-client.js';
import { getPathSegment } from '../router.js';
import { openEditAgentOverlay } from './agents.js';

const GH_BASE = 'https://github.com/Tij8i/Orchestrator/blob/main/';

const TINTS = {
  genus:    { color: '#0e9f6e', soft: 'rgba(14,159,110,.10)', pill: 'GENUS AGENT', familyTitle: 'Genus-family', kindWord: 'agent' },
  stewart:  { color: '#2f6bff', soft: 'rgba(47,107,255,.10)', pill: 'STEWART', familyTitle: 'Stewart-family', kindWord: 'agent' },
  mason:    { color: '#e0683a', soft: 'rgba(224,104,58,.10)', pill: 'TASK AGENT', familyTitle: 'Task-agent', kindWord: 'agent' },
  custom:   { color: '#7a4dff', soft: 'rgba(122,77,255,.10)', pill: 'CUSTOM', familyTitle: 'Custom', kindWord: 'agent' },
  external: { color: '#0e9aa0', soft: 'rgba(14,154,160,.10)', pill: 'EXTERNAL', familyTitle: 'External-instance', kindWord: 'instance' },
};

const STATUS = {
  running: { color: '#0e9f6e', anim: 'pulseDot 1.6s infinite', label: 'Running' },
  idle:    { color: '#9aa1ae', anim: 'none', label: 'Idle' },
  paused:  { color: '#c98a16', anim: 'none', label: 'Paused' },
  healthy: { color: '#0e9f6e', anim: 'none', label: 'Healthy' },
};

const MAT = {
  Solid:    { c: '#0e9f6e', b: 'rgba(14,159,110,.12)' },
  Drafted:  { c: '#c98a16', b: 'rgba(201,138,22,.13)' },
  Untested: { c: '#9aa1ae', b: 'rgba(154,161,174,.16)' },
};

const FAMILY_COPY = {
  genus:    'Models the venture\'s business areas · proposes splits, renames and merges · meeting-driven · keeps coverage healthy. It is the only archetype that edits the shape of the business itself.',
  stewart:  'Owns a planning loop · ConfidenceFrame-native recommendations · weekly heartbeat · a learning loop that writes into memos.jsonl. A Stewart thinks about a domain over time and proposes; it doesn\'t execute the small stuff.',
  mason:    'Stateless executor · runs tasks delegated by a Stewart · no planning, no memory beyond run logs. Fast and disposable: hand it a typed task and it does exactly that.',
  custom:   'Operator-defined agent · behaviour described by you · runs on whatever runtime you point it at. The escape hatch for anything the standard families don\'t cover.',
  external: 'An outside Claude instance with scoped API access · reads and writes the substrate through tokens · runs on its own infrastructure. Makes Genus a shared source of truth, not just a dashboard.',
};

// Recipes per archetype (informational — actual logic lives in methodology docs)
const RECIPES_BY_ARCH = {
  genus: [
    { name: 'Area-split proposal', mat: 'Solid' },
    { name: 'Coverage drift scan', mat: 'Drafted' },
  ],
  stewart: [
    { name: 'Pattern #12 campaign loop', mat: 'Solid' },
    { name: 'BUDGET-ALLOCATION recipe', mat: 'Solid' },
    { name: 'Trust Cycle', mat: 'Drafted' },
    { name: 'Weekly heartbeat', mat: 'Solid' },
  ],
  mason: [
    { name: 'send-invoice', mat: 'Solid' },
    { name: 'chase-overdue', mat: 'Drafted' },
    { name: 'reconcile-payment', mat: 'Untested' },
  ],
  custom: [],
};

const KPIS_PER_MODULE = {
  finance: ['Runway (months)', 'Burn multiple', 'Gross margin %'],
  strategy: ['Active ventures', 'Weekly velocity', 'Insight → action rate'],
  operations: ['Cycle time', 'Pending tasks', 'Backlog growth'],
};

function archetypeForBinding(b) {
  const raw = (b.archetype || '').toLowerCase();
  if (raw === 'mason' || raw === 'task agent') return 'mason';
  if (raw === 'custom') return 'custom';
  if (raw === 'admin' || raw === 'genus' || raw === 'genus agent') return 'genus';
  return 'stewart';
}

function agentDisplayName(b, modulesCatalog) {
  if (b.display_name) return b.display_name;
  if (b.module_id) {
    const m = modulesCatalog.find(mm => mm.id === b.module_id);
    const mod = m ? m.display_name : b.module_id;
    const arch = archetypeForBinding(b);
    if (arch === 'genus') return 'Genus Agent';
    if (arch === 'mason') return `${mod} Agent`;
    return `${mod} Stewart`;
  }
  if (archetypeForBinding(b) === 'genus') return 'Genus Agent';
  return b.agent_id;
}

function methodologyFiles(b) {
  const arch = archetypeForBinding(b);
  if (arch === 'genus') {
    return [
      { name: 'IDENTITY.md', path: 'docs/agents/genus_agent/IDENTITY.md' },
      { name: 'PLAYBOOK.md', path: 'docs/agents/genus_agent/PLAYBOOK.md' },
    ];
  }
  if (arch === 'stewart' && b.module_id) {
    return [
      { name: 'PLAYBOOK.md', path: `docs/agents/${b.module_id}_stewart/PLAYBOOK.md` },
      { name: 'memos.jsonl', path: `dashboard/public/data/bus/${b.bu}/${b.module_id}/memos.jsonl` },
    ];
  }
  if (arch === 'custom') {
    return b.source_url ? [{ name: 'README.md', path: b.source_url, external: true }] : [];
  }
  return [];
}

export async function renderAgentDetail(ctx) {
  const root = document.getElementById('route-agent-detail');
  if (!root) return;
  const agentId = getPathSegment();
  if (!agentId) {
    root.innerHTML = '<div class="card"><div class="card-body" style="padding:30px;">No agent id in URL. <a href="#roster">Back to Roster</a></div></div>';
    return;
  }

  root.innerHTML = '<div style="padding:30px;color:#9aa1ae;text-align:center;font-size:13.5px;">Loading agent…</div>';

  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
  let state, registry, externalsFile;
  try {
    const [stateRes, registryFile, extJson] = await Promise.all([
      fetch('/api/admin-state?bu=' + encodeURIComponent(currentBu)).then(r => r.json()).catch(() => ({ ok: false })),
      fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null).catch(() => null),
      fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/external_access.json`, null).catch(() => null),
    ]);
    if (!stateRes.ok) throw new Error(stateRes.message || 'admin-state failed');
    state = stateRes;
    registry = registryFile;
    externalsFile = extJson;
  } catch (e) {
    root.innerHTML = `<div class="card"><div class="card-body" style="padding:30px;">Could not load: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }

  const users = state.users || [];
  const runtimes = state.runtimes || [];
  const allBindings = state.bindings || [];
  const bindings = allBindings.filter(b => b.bu === currentBu);
  const availableModules = (registry && registry.available_modules) || [];
  const externals = (externalsFile && externalsFile.entries) || [];

  // Resolve agent: try bindings first, then external.
  const binding = bindings.find(b => b.agent_id === agentId);
  const external = externals.find(e => e.id === agentId);

  if (!binding && !external) {
    root.innerHTML = `<div style="padding:30px;color:#5b6270;">
      <button type="button" id="back-to-roster" style="background:none;border:none;color:#9aa1ae;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11.5px;cursor:pointer;display:flex;align-items:center;gap:7px;padding:6px 0;margin-bottom:14px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Back to Roster
      </button>
      <h2 style="font-size:21px;font-weight:800;">Agent not found</h2>
      <p style="color:#9aa1ae;font-size:14px;margin-top:8px;">No agent or external instance with id <code>${escapeHtml(agentId)}</code> in BU <code>${escapeHtml(currentBu)}</code>.</p>
    </div>`;
    document.getElementById('back-to-roster')?.addEventListener('click', () => location.hash = '#roster?tab=agents');
    return;
  }

  // Areas for the Edit binding overlay's covers_areas picker
  const areasFile = await fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/business_areas.json`, null).catch(() => null);
  const areas = (areasFile && areasFile.areas) || [];

  if (external) {
    root.innerHTML = renderExternalDetail(external, users, currentBu);
  } else {
    root.innerHTML = renderBindingDetail(binding, runtimes, users, availableModules);
  }

  document.querySelectorAll('.detail-back-btn').forEach(b => b.addEventListener('click', () => {
    location.hash = external ? '#roster?tab=external' : '#roster?tab=agents';
  }));
  document.querySelectorAll('[data-area-chip]').forEach(c => c.addEventListener('click', () => location.hash = '#layers'));

  // Edit binding → reuses the overlay from the legacy Agents view
  if (binding) {
    document.getElementById('edit-binding-btn')?.addEventListener('click', () => {
      openEditAgentOverlay({ bu: currentBu, binding, runtimes, users, areas, ctx });
    });

    document.getElementById('pause-btn')?.addEventListener('click', () => {
      // Pause/resume requires Paperclip runtime control — surface intent
      // until the API integration ships.
      alert(`${binding.status === 'paused' ? 'Resume' : 'Pause'} would wire through the Paperclip runtime API. Not connected yet.`);
    });

    // Turn on cron: fires the local trigger daemon with mode='add-cron-trigger'
    // filtered to this agent. Reconciler adds a cron trigger to the heartbeat
    // routine using the module-family default schedule (roadmap i32).
    document.getElementById('enable-cron-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const agentId = btn.dataset.agentId;
      const origLabel = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Enabling…`;
      try {
        const res = await fetch('http://127.0.0.1:3101/reconcile-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, mode: 'add-cron-trigger', timeout_ms: 40000 }),
          signal: AbortSignal.timeout(45000),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          alert(`Turning on cron failed: ${json?.message || `HTTP ${res.status}`}\n\nIs the trigger daemon running? See scripts/paperclip_sync/install_daemon.sh in Orchestrator.`);
          btn.disabled = false;
          btn.innerHTML = origLabel;
          return;
        }
        const applied = (json.envelope?.actions || []).filter(a => a.status === 'trigger_added' || a.status === 'added_trigger' || (a.finding?.fix_action === 'add_routine_trigger'));
        const alreadyOn = (json.envelope?.by_category?.routine_missing_trigger || 0) === 0;
        if (alreadyOn) {
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Cron already on`;
        } else {
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Cron on`;
        }
        btn.style.background = 'var(--green-bg)';
        btn.style.color = 'var(--green-fg)';
        btn.style.borderColor = 'var(--green-border)';
      } catch (err) {
        alert(`Turning on cron failed: ${err.message || err}\n\nIs the trigger daemon running on http://127.0.0.1:3101 ?`);
        btn.disabled = false;
        btn.innerHTML = origLabel;
      }
    });
  }

  // External: wire the Revoke button in the right rail
  if (external) {
    document.querySelectorAll('[data-ext-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.extRevoke;
        if (!window.confirm(`Revoke access for ${external.display_name}? Their token stops working immediately.`)) return;
        btn.disabled = true;
        try {
          const r = await fetch('/api/external-access-edit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bu: currentBu, action: 'remove', id }),
          });
          const j = await r.json();
          if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
          location.hash = '#roster?tab=external';
        } catch (e) {
          alert(`Revoke failed: ${e.message}`);
          btn.disabled = false;
        }
      });
    });
  }
}

function renderBindingDetail(b, runtimes, users, availableModules) {
  const arch = archetypeForBinding(b);
  const tint = TINTS[arch];
  const runtime = runtimes.find(r => r.id === b.runtime_id);
  const human = users.find(u => (u.email || '').toLowerCase() === (b.hitl_owner_email || '').toLowerCase());
  const module = availableModules.find(m => m.id === b.module_id);
  const name = agentDisplayName(b, availableModules);
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const st = STATUS[b.status || 'idle'] || STATUS.idle;
  const isPaperclip = (runtime?.kind || '').includes('paperclip') || (b.runtime_id || '').includes('paperclip');
  const unique = b.unique_note || defaultUniqueNote(b, module);
  const kpis = arch === 'stewart' && b.module_id ? (KPIS_PER_MODULE[b.module_id] || []) : [];
  const files = methodologyFiles(b);
  const recipes = (b.recipes && b.recipes.length) ? b.recipes : RECIPES_BY_ARCH[arch] || [];
  const recipesLabel = arch === 'mason' ? 'Task types' : 'Recipes & skills';
  const coversAreas = b.covers_areas || [];

  return `
    <div style="max-width:1000px;margin:0 auto;padding:24px 8px 80px;">
      <button type="button" class="detail-back-btn" style="display:flex;align-items:center;gap:7px;border:none;background:transparent;cursor:pointer;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;padding:6px 0;margin-bottom:14px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Roster / Agents
      </button>

      <div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:17px;padding:18px 20px;background:#fff;border:1px solid rgba(20,22,28,.09);border-radius:15px;box-shadow:0 2px 10px rgba(16,18,28,.05);">
        <span style="width:54px;height:54px;flex:none;border-radius:13px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;letter-spacing:-.02em;">${escapeHtml(initials)}</span>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h1 style="font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0;">${escapeHtml(name)}</h1>
            <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;color:${tint.color};background:${tint.soft};border-radius:6px;padding:3px 9px;">${tint.pill}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:99px;background:${st.color};animation:${st.anim};"></span><span style="font-size:13px;color:#6b7280;">${st.label}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex:none;">
          ${isPaperclip ? `<a href="http://127.0.0.1:3100" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:7px;padding:9px 14px;border:1px solid rgba(20,22,28,.12);border-radius:10px;background:#fff;color:#16181d;font-size:13px;font-weight:600;text-decoration:none;">Open in Paperclip <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : ''}
          ${isPaperclip ? `<button type="button" id="enable-cron-btn" data-agent-id="${escapeHtml(b.agent_id)}" title="Add a scheduled trigger to this Stewart's heartbeat routine so it fires on cron (i32). Uses the default cron for this agent family." style="display:flex;align-items:center;gap:7px;padding:9px 14px;border:1px solid rgba(47,107,255,.28);border-radius:10px;background:rgba(47,107,255,.06);color:#2f6bff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            Turn on cron
          </button>` : ''}
          <button type="button" id="edit-binding-btn" style="padding:9px 14px;border:1px solid rgba(20,22,28,.12);border-radius:10px;background:#fff;color:#16181d;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">Edit binding</button>
          <button type="button" id="pause-btn" title="${b.status === 'paused' ? 'Resume' : 'Pause'}" style="width:38px;height:38px;border:1px solid rgba(20,22,28,.12);border-radius:10px;background:#fff;color:#5b6270;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            ${b.status === 'paused'
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4v16l13-8z"/></svg>'
              : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'}
          </button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;margin-top:16px;align-items:start;">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">

          ${renderCard({
            eyebrow: `What this ${tint.kindWord} is`,
            body: `
              <div style="display:flex;flex-direction:column;gap:7px;">
                <span style="font:600 12.5px Hanken Grotesk,system-ui,sans-serif;color:${tint.color};">${tint.familyTitle} characteristics</span>
                <p style="font-size:14.5px;color:#3a3f4a;line-height:1.6;margin:0;">${escapeHtml(FAMILY_COPY[arch])}</p>
              </div>
              <div style="height:1px;background:rgba(20,22,28,.07);margin:18px 0;"></div>
              <div style="display:flex;flex-direction:column;gap:7px;">
                <span style="font:600 12.5px Hanken Grotesk,system-ui,sans-serif;color:#16181d;">What makes this instance unique</span>
                <p style="font-size:14.5px;color:#3a3f4a;line-height:1.6;margin:0;">${escapeHtml(unique)}</p>
              </div>
              ${kpis.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:14px;">
                ${kpis.map(k => `<span style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:#5b6270;background:rgba(20,22,28,.045);border-radius:8px;padding:5px 11px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9aa1ae" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 3-3 3 3 5-6"/></svg>${escapeHtml(k)}</span>`).join('')}
              </div>` : ''}
            `,
          })}

          ${renderCard({
            eyebrow: 'Wired to',
            body: `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 28px;">
                ${renderField('MODULE', module ? module.display_name : (b.module_id || '—'))}
                ${renderField('RUNTIME', runtime ? runtime.display_name : (b.runtime_id || '—'), true)}
                ${renderField('HITL OWNER', human ? human.display_name : (b.hitl_owner_email || '—'))}
                ${renderField('STATUS', st.label)}
              </div>
              <div style="height:1px;background:rgba(20,22,28,.07);margin:18px 0 16px;"></div>
              <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">COVERED BUSINESS AREAS</span>
              <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;">
                ${coversAreas.length === 0 ? '<span style="font-size:12.5px;color:#9aa1ae;">(none — set in Edit binding)</span>' : coversAreas.map(a => `<span data-area-chip="${escapeHtml(a)}" style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#2f6bff;background:rgba(47,107,255,.08);border-radius:9px;padding:6px 11px;cursor:pointer;">${escapeHtml(a)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>`).join('')}
              </div>
            `,
          })}

          ${recipes.length > 0 ? renderCard({
            eyebrow: recipesLabel,
            eyebrowExtra: 'informational — edited in the methodology docs',
            body: `<div style="display:flex;flex-direction:column;gap:2px;">
              ${recipes.map(r => {
                const m = MAT[r.mat] || MAT.Untested;
                return `<div style="display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(20,22,28,.05);">
                  <span style="width:7px;height:7px;border-radius:99px;background:${m.c};flex:none;"></span>
                  <span style="font-size:14px;font-weight:600;flex:1;">${escapeHtml(r.name)}</span>
                  <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${m.c};background:${m.b};border-radius:6px;padding:3px 9px;">${escapeHtml(r.mat)}</span>
                </div>`;
              }).join('')}
            </div>`,
          }) : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;position:sticky;top:96px;">
          ${renderLiveStateCard(b, arch, isPaperclip)}
          ${files.length > 0 ? renderFilesCard(files) : ''}
        </div>
      </div>
    </div>
  `;
}

function renderExternalDetail(e, users, bu) {
  const tint = TINTS.external;
  const initials = e.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const owner = users.find(u => (u.email || '').toLowerCase() === (e.owner_email || '').toLowerCase());
  const st = STATUS.healthy;
  const scopes = e.scopes || [];
  const audit = (e.audit || []).slice(0, 8);

  return `
    <div style="max-width:1000px;margin:0 auto;padding:24px 8px 80px;">
      <button type="button" class="detail-back-btn" style="display:flex;align-items:center;gap:7px;border:none;background:transparent;cursor:pointer;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;padding:6px 0;margin-bottom:14px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Roster / External
      </button>

      <div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:17px;padding:18px 20px;background:#fff;border:1px solid rgba(20,22,28,.09);border-radius:15px;box-shadow:0 2px 10px rgba(16,18,28,.05);">
        <span style="width:54px;height:54px;flex:none;border-radius:13px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;letter-spacing:-.02em;">${escapeHtml(initials)}</span>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h1 style="font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0;">${escapeHtml(e.display_name)}</h1>
            <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;color:${tint.color};background:${tint.soft};border-radius:6px;padding:3px 9px;">${tint.pill}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:99px;background:${st.color};"></span><span style="font-size:13px;color:#6b7280;">Token healthy · last seen ${escapeHtml(e.last_seen || '—')}</span></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;margin-top:16px;align-items:start;">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">

          ${renderCard({
            eyebrow: `What this ${tint.kindWord} is`,
            body: `
              <div style="display:flex;flex-direction:column;gap:7px;">
                <span style="font:600 12.5px Hanken Grotesk,system-ui,sans-serif;color:${tint.color};">${tint.familyTitle} characteristics</span>
                <p style="font-size:14.5px;color:#3a3f4a;line-height:1.6;margin:0;">${escapeHtml(FAMILY_COPY.external)}</p>
              </div>
              ${e.description ? `<div style="height:1px;background:rgba(20,22,28,.07);margin:18px 0;"></div>
              <div style="display:flex;flex-direction:column;gap:7px;">
                <span style="font:600 12.5px Hanken Grotesk,system-ui,sans-serif;color:#16181d;">What this instance does</span>
                <p style="font-size:14.5px;color:#3a3f4a;line-height:1.6;margin:0;">${escapeHtml(e.description)}</p>
              </div>` : ''}
            `,
          })}

          ${renderCard({
            eyebrow: 'Wired to',
            body: `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 28px;">
                ${renderField('ACCESS', e.protocol === 'mcp' ? 'MCP server' : 'REST API')}
                ${renderField('URL', e.url || `https://genus.app/api/bus/${bu}`, true)}
                ${renderField('OWNER', owner ? owner.display_name : (e.owner_email || '—'))}
                ${renderField('STATUS', 'Healthy')}
              </div>
              <div style="height:1px;background:rgba(20,22,28,.07);margin:18px 0 16px;"></div>
              <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">SCOPED TO AREAS</span>
              <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;">
                ${(e.scoped_areas || []).length === 0 ? '<span style="font-size:12.5px;color:#9aa1ae;">All areas (no area scope set)</span>' : (e.scoped_areas || []).map(a => `<span data-area-chip="${escapeHtml(a)}" style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#2f6bff;background:rgba(47,107,255,.08);border-radius:9px;padding:6px 11px;cursor:pointer;">${escapeHtml(a)}</span>`).join('')}
              </div>
            `,
          })}

          ${renderCard({
            eyebrow: 'Audit log',
            body: audit.length === 0
              ? '<div style="font-size:13px;color:#9aa1ae;padding:8px 0;">No recorded calls yet.</div>'
              : `<div style="display:flex;flex-direction:column;gap:0;">
                  ${audit.map(a => `<div style="display:flex;align-items:baseline;gap:13px;padding:10px 4px;border-bottom:1px solid rgba(20,22,28,.05);">
                    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;width:90px;flex:none;">${escapeHtml(a.when || '—')}</span>
                    <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${a.verb === 'WRITE' ? '#c98a16' : '#0e9aa0'};background:${a.verb === 'WRITE' ? 'rgba(201,138,22,.13)' : 'rgba(14,154,160,.12)'};border-radius:5px;padding:2px 7px;flex:none;">${escapeHtml(a.verb || 'READ')}</span>
                    <span style="font:500 13.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#3a3f4a;">${escapeHtml(a.target || '')}</span>
                  </div>`).join('')}
                </div>`,
          })}
        </div>

        <div style="display:flex;flex-direction:column;gap:16px;position:sticky;top:96px;">
          ${renderLiveStateCard({ status: 'healthy', counters: { done: 0, pending: 0, success: '—' } }, 'external', false)}
          ${renderScopeOwnerCard(e, owner, bu)}
        </div>
      </div>
    </div>
  `;
}

function renderCard({ eyebrow, eyebrowExtra, body }) {
  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;">${eyebrow}</div>
      ${eyebrowExtra ? `<span style="font-size:12px;color:#c2c7d0;">${eyebrowExtra}</span>` : ''}
    </div>
    ${body}
  </section>`;
}

function renderField(label, value, mono = false) {
  return `<div style="display:flex;flex-direction:column;gap:4px;">
    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${label}</span>
    <span style="font-size:14px;font-weight:600;${mono ? `font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;` : ''}">${escapeHtml(value)}</span>
  </div>`;
}

function renderLiveStateCard(b, arch, isPaperclip) {
  // Stub: real numbers come from Paperclip API integration (not yet wired).
  const liveTop = arch === 'external' ? 'Token status' : 'Latest run';
  const liveCta = arch === 'external' ? 'Full audit in logs' : 'See in Paperclip';
  const stat1Label = arch === 'external' ? 'requests / 7d' : 'done / 7d';
  const stat2Label = arch === 'external' ? 'errors' : 'pending';
  const stat3Label = 'success';
  const runStatus = b.status === 'running' ? 'Running' : (arch === 'external' ? 'Healthy' : 'No recent run');
  const runColor = b.status === 'running' ? '#0e9f6e' : (arch === 'external' ? '#0e9f6e' : '#9aa1ae');
  const runAnim = b.status === 'running' ? 'pulseDot 1.6s infinite' : 'none';
  const runId = b.run_id || '—';
  const done = b.counters?.done ?? '—';
  const pend = b.counters?.pending ?? '—';
  const success = b.counters?.success ?? '—';
  const writeFile = b.latest_write?.file || '(no recorded writes)';
  const writeWhen = b.latest_write?.when || '—';

  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:20px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:15px;">Live state</div>
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px;">
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${liveTop}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:7px;height:7px;border-radius:99px;background:${runColor};animation:${runAnim};"></span>
        <span style="font-size:14px;font-weight:600;">${runStatus}</span>
      </div>
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(String(runId))}</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <div style="flex:1;background:#fbfbfc;border:1px solid rgba(20,22,28,.06);border-radius:11px;padding:11px 10px;text-align:center;">
        <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;">${escapeHtml(String(done))}</div>
        <div style="font-size:10.5px;color:#9aa1ae;margin-top:2px;">${stat1Label}</div>
      </div>
      <div style="flex:1;background:#fbfbfc;border:1px solid rgba(20,22,28,.06);border-radius:11px;padding:11px 10px;text-align:center;">
        <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;">${escapeHtml(String(pend))}</div>
        <div style="font-size:10.5px;color:#9aa1ae;margin-top:2px;">${stat2Label}</div>
      </div>
      <div style="flex:1;background:#fbfbfc;border:1px solid rgba(20,22,28,.06);border-radius:11px;padding:11px 10px;text-align:center;">
        <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;color:#0e9f6e;">${escapeHtml(String(success))}</div>
        <div style="font-size:10.5px;color:#9aa1ae;margin-top:2px;">${stat3Label}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;padding-top:13px;border-top:1px solid rgba(20,22,28,.07);">
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">Latest substrate write</span>
      <span style="font:600 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#3a3f4a;word-break:break-all;">${escapeHtml(writeFile)}</span>
      <span style="font-size:12px;color:#9aa1ae;">${escapeHtml(writeWhen)}</span>
    </div>
    ${isPaperclip ? `<a href="http://127.0.0.1:3100" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:15px;padding:9px;border-radius:10px;background:rgba(20,22,28,.045);color:#16181d;font-size:12.5px;font-weight:600;text-decoration:none;">${liveCta} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : `<div style="margin-top:15px;padding:9px;border-radius:10px;background:rgba(20,22,28,.045);color:#9aa1ae;font-size:12px;text-align:center;">Live counters wire when Paperclip API is connected</div>`}
  </section>`;
}

function renderFilesCard(files) {
  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:20px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:13px;">Methodology files</div>
    <div style="display:flex;flex-direction:column;gap:7px;">
      ${files.map(f => {
        const href = f.external ? f.path : `${GH_BASE}${f.path}`;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid rgba(20,22,28,.08);border-radius:10px;text-decoration:none;color:#16181d;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa1ae" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span style="display:flex;flex-direction:column;min-width:0;flex:1;">
            <span style="font:600 13px 'JetBrains Mono',ui-monospace,Menlo,monospace;">${escapeHtml(f.name)}</span>
            <span style="font:500 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.path)}</span>
          </span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c2c7d0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M7 17 17 7M9 7h8v8"/></svg>
        </a>`;
      }).join('')}
    </div>
  </section>`;
}

function renderScopeOwnerCard(e, owner, bu) {
  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:20px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:13px;">Scope &amp; owner</div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:13px;">
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">OWNER</span>
      <span style="font-size:14px;font-weight:600;">${escapeHtml(owner ? owner.display_name : (e.owner_email || '—'))}</span>
    </div>
    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">PERMISSIONS</span>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;">
      ${(e.scopes || []).map(s => `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#0e9aa0;background:rgba(14,154,160,.10);border-radius:6px;padding:4px 9px;">${escapeHtml(s)}</span>`).join('')}
    </div>
    <button type="button" data-ext-revoke="${escapeHtml(e.id)}" style="width:100%;margin-top:16px;padding:9px;border:1px solid rgba(192,57,43,.25);border-radius:10px;background:rgba(192,57,43,.05);color:#c0392b;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">Revoke access</button>
  </section>`;
}

function defaultUniqueNote(b, module) {
  const arch = archetypeForBinding(b);
  if (arch === 'genus') return 'Watches how this venture is split into areas. When coverage drifts — an area with no Stewart, two modules fighting over one area — it proposes a split, merge or rename in a meeting.';
  if (arch === 'stewart' && module) {
    return `Domain: ${module.display_name}. Methodology pinned to the ${module.display_name} PLAYBOOK; every recommendation is written with a ConfidenceFrame.`;
  }
  if (arch === 'mason') return 'A task agent delegated by a Stewart. Configured to handle a narrow set of task types — it holds no opinion about the domain, it just runs what it\'s handed.';
  if (arch === 'custom') return b.unique_note || 'Operator-defined agent running on a custom runtime. See the source link for behavior details.';
  return '';
}
