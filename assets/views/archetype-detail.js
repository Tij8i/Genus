// Archetype reference page — orientation for what an archetype family
// does + doesn't, plus the instances currently bound in this BU.
//
// Route: #archetype/<key>  where key ∈ genus | stewart | mason | custom

import { escapeHtml } from '../utils.js';
import { fetchSubstrateJson } from '../substrate-client.js';
import { getPathSegment } from '../router.js';
import { openAddAgentOverlay } from './agents.js';

const TINTS = {
  genus:    { color: '#0e9f6e', soft: 'rgba(14,159,110,.10)', pill: 'GENUS AGENT', title: 'Genus Agent',
              blurb: 'The auto-installed agent that models how a venture is divided into business areas.',
              family: 'Models the venture\'s business areas · proposes splits, renames and merges · meeting-driven · keeps coverage healthy. It is the only archetype that edits the shape of the business itself.',
              does: ['Propose new business areas', 'Merge or rename drifting areas', 'Run modelling meetings on request'],
              doesnt: ['Execute domain tasks', 'Hold a planning loop', 'Touch tools directly'] },
  stewart:  { color: '#2f6bff', soft: 'rgba(47,107,255,.10)', pill: 'STEWART', title: 'Stewart',
              blurb: 'A domain owner that plans, recommends and learns over time — one per module.',
              family: 'Owns a planning loop · ConfidenceFrame-native recommendations · weekly heartbeat · a learning loop that writes into memos.jsonl. A Stewart thinks about a domain over time and proposes; it doesn\'t execute the small stuff.',
              does: ['Own a weekly planning loop', 'Write ConfidenceFrame recommendations', 'Learn into memos.jsonl', 'Delegate execution to Task agents'],
              doesnt: ['Run raw tasks itself', 'Edit the business model', 'Act without a human in the loop'] },
  mason:    { color: '#e0683a', soft: 'rgba(224,104,58,.10)', pill: 'TASK AGENT', title: 'Task agent (Mason)',
              blurb: 'A stateless executor that runs typed tasks handed to it by a Stewart.',
              family: 'Stateless executor · runs tasks delegated by a Stewart · no planning, no memory beyond run logs. Fast and disposable: hand it a typed task and it does exactly that.',
              does: ['Run delegated tasks', 'Use the tools in its area', 'Log every run'],
              doesnt: ['Plan or strategise', 'Keep memory between runs', 'Make recommendations'] },
  custom:   { color: '#7a4dff', soft: 'rgba(122,77,255,.10)', pill: 'CUSTOM', title: 'Custom agent',
              blurb: 'Your own agent on your own runtime — the escape hatch for anything the standard families don\'t cover.',
              family: 'Operator-defined agent · behaviour described by you · runs on whatever runtime you point it at. The escape hatch for anything the standard families don\'t cover.',
              does: ['Run on any runtime you point to', 'Do whatever you describe', 'Cover the areas you assign'],
              doesnt: ['Come with a built-in methodology', 'Auto-update with the platform', 'Guarantee a heartbeat'] },
};

const STATUS = {
  running: { color: '#0e9f6e', label: 'Running' },
  idle:    { color: '#9aa1ae', label: 'Idle' },
  paused:  { color: '#c98a16', label: 'Paused' },
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

export async function renderArchetype(ctx) {
  const root = document.getElementById('route-archetype');
  if (!root) return;
  const key = getPathSegment().toLowerCase();
  const tint = TINTS[key];
  if (!tint) {
    root.innerHTML = `<div style="padding:30px;">
      <button type="button" id="back-roster" style="background:none;border:none;color:#9aa1ae;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;cursor:pointer;display:flex;align-items:center;gap:7px;padding:6px 0;margin-bottom:14px;">‹ Back to Roster</button>
      <h2 style="font-size:21px;font-weight:800;">Unknown archetype</h2>
      <p style="color:#9aa1ae;">Try one of: ${Object.keys(TINTS).join(', ')}.</p>
    </div>`;
    document.getElementById('back-roster')?.addEventListener('click', () => location.hash = '#roster?tab=agents');
    return;
  }

  root.innerHTML = '<div style="padding:30px;color:#9aa1ae;text-align:center;font-size:13.5px;">Loading…</div>';

  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
  let state, registry;
  try {
    const [stateRes, registryFile] = await Promise.all([
      fetch('/api/admin-state?bu=' + encodeURIComponent(currentBu)).then(r => r.json()).catch(() => ({ ok: false })),
      fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null).catch(() => null),
    ]);
    if (!stateRes.ok) throw new Error(stateRes.message || 'admin-state failed');
    state = stateRes;
    registry = registryFile;
  } catch (e) {
    root.innerHTML = `<div style="padding:30px;color:#c12525;">Could not load: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }

  const users = state.users || [];
  const runtimes = state.runtimes || [];
  const allBindings = state.bindings || [];
  const bindings = allBindings.filter(b => b.bu === currentBu && archetypeForBinding(b) === key);
  const availableModules = (registry && registry.available_modules) || [];
  const buEntry = (registry?.business_units || []).find(b => b.id === currentBu);
  const installedModuleIds = new Set(buEntry?.modules_installed || []);
  const buName = buEntry?.display_name || currentBu;

  const areasFile = await fetchSubstrateJson(`dashboard/public/data/bus/${currentBu}/business_areas.json`, null).catch(() => null);
  const areas = (areasFile && areasFile.areas) || [];

  root.innerHTML = `
    <div style="max-width:920px;margin:0 auto;padding:24px 8px 80px;">
      <button type="button" id="back-roster" style="display:flex;align-items:center;gap:7px;border:none;background:transparent;cursor:pointer;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;padding:6px 0;margin-bottom:16px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Roster / Archetype catalog
      </button>

      <div style="display:flex;align-items:flex-start;gap:18px;margin-bottom:8px;">
        <span style="width:60px;height:60px;flex:none;border-radius:15px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;">${archetypeIconSvg(key, tint.color, 26)}</span>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:11px;margin-bottom:6px;flex-wrap:wrap;">
            <h1 style="font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0;">${escapeHtml(tint.title)}</h1>
            <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.1em;color:${tint.color};background:${tint.soft};border-radius:6px;padding:3px 9px;">${tint.pill}</span>
          </div>
          <p style="font-size:15px;color:#5b6270;line-height:1.55;max-width:600px;margin:0;">${escapeHtml(tint.blurb)}</p>
        </div>
        <button type="button" id="add-instance-btn" style="flex:none;display:flex;align-items:center;gap:8px;padding:10px 16px;border:none;border-radius:11px;background:${tint.color};color:#fff;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Add an instance
        </button>
      </div>

      <section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:24px 26px;margin-top:20px;">
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:12px;">How this family works</div>
        <p style="font-size:15px;color:#3a3f4a;line-height:1.65;">${escapeHtml(tint.family)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px;">
          <div style="background:rgba(14,159,110,.06);border:1px solid rgba(14,159,110,.16);border-radius:12px;padding:16px 18px;">
            <div style="font-size:12px;font-weight:700;color:#0e9f6e;margin-bottom:10px;">Does</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${tint.does.map(d => `<span style="display:flex;gap:8px;font-size:13.5px;color:#3a3f4a;line-height:1.4;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0e9f6e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:2px;"><path d="m5 12 4.5 4.5L19 7"/></svg>${escapeHtml(d)}</span>`).join('')}
            </div>
          </div>
          <div style="background:rgba(192,57,43,.05);border:1px solid rgba(192,57,43,.15);border-radius:12px;padding:16px 18px;">
            <div style="font-size:12px;font-weight:700;color:#c0392b;margin-bottom:10px;">Doesn't</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${tint.doesnt.map(d => `<span style="display:flex;gap:8px;font-size:13.5px;color:#3a3f4a;line-height:1.4;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:2px;"><path d="M18 6 6 18M6 6l12 12"/></svg>${escapeHtml(d)}</span>`).join('')}
            </div>
          </div>
        </div>
      </section>

      <section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:24px 26px;margin-top:16px;">
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:14px;">Instances in ${escapeHtml(buName)}</div>
        ${bindings.length === 0 ? `
          <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 20px;">
            <p style="font-size:14px;color:#9aa1ae;">No instances of this archetype in ${escapeHtml(buName)} yet.</p>
            <button type="button" id="empty-add-instance" style="margin-top:14px;padding:9px 16px;border:1px solid ${tint.color};border-radius:10px;background:${tint.soft};color:${tint.color};font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">+ Add the first one</button>
          </div>` : `
          <div style="display:flex;flex-direction:column;gap:9px;">
            ${bindings.map(b => {
              const name = agentDisplayName(b, availableModules);
              const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              const st = STATUS[b.status || 'idle'] || STATUS.idle;
              return `<button type="button" data-instance="${escapeHtml(b.agent_id)}" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:13px 15px;background:#fbfbfc;border:1px solid rgba(20,22,28,.07);border-radius:12px;cursor:pointer;font-family:inherit;">
                <span style="width:36px;height:36px;flex:none;border-radius:10px;background:${tint.soft};color:${tint.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">${escapeHtml(initials)}</span>
                <span style="font-weight:700;font-size:14.5px;flex:1;">${escapeHtml(name)}</span>
                <span style="display:flex;align-items:center;gap:7px;"><span style="width:7px;height:7px;border-radius:99px;background:${st.color};"></span><span style="font-size:12.5px;color:#9aa1ae;">${st.label}</span></span>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c2c7d0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
              </button>`;
            }).join('')}
          </div>`}
      </section>
    </div>
  `;

  document.getElementById('back-roster')?.addEventListener('click', () => location.hash = '#roster?tab=agents');
  document.querySelectorAll('[data-instance]').forEach(b => b.addEventListener('click', () => {
    location.hash = `#agent-detail/${encodeURIComponent(b.dataset.instance)}`;
  }));
  const addHandler = () => {
    openAddAgentOverlay({ bu: currentBu, runtimes, users, areas, installedModuleIds, availableModules, ctx });
  };
  document.getElementById('add-instance-btn')?.addEventListener('click', addHandler);
  document.getElementById('empty-add-instance')?.addEventListener('click', addHandler);
}

function archetypeIconSvg(kind, color, size = 20) {
  if (kind === 'genus') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;
  if (kind === 'stewart') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="${color}"/></svg>`;
  if (kind === 'mason') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 14 2 2 4-4"/></svg>`;
  if (kind === 'custom') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z"/><path d="M9.5 12l2 2 3.5-4"/></svg>`;
  return '';
}
