// Roadmap i49 + i50 — HR / Resource module (with Plan Optimiser sub-view).
// Routes: #hr-overview, #hr-catalog, #hr-plan-optimizer

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { moduleMetaFor, renderModuleShell, renderListSection, newButton, fetchModuleData, createModuleItem, openStewardChat } from './module-scaffold.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

export async function renderHrOverview() {
  const root = document.getElementById('route-hr-overview');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading HR…</div>';

  const [meta, openings, usage, catalog] = await Promise.all([
    moduleMetaFor('hr'),
    fetchModuleData(bu, 'hr', 'openings.json'),
    fetchModuleData(bu, 'hr', 'agent_usage.json'),
    (await fetch('/data/system/agent_catalog.json', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null)),
  ]);

  const openings_list = openings?.openings || [];
  const catalog_list = catalog?.archetypes || [];
  const usage_list = usage?.usage || [];

  const open = openings_list.filter(o => o.status === 'open').length;
  const filled = openings_list.filter(o => o.status === 'filled').length;

  const stats = [
    { label: 'OPEN REQS', value: open, sub: `${filled} filled all-time`, color: open > 0 ? '#c78500' : '#238c46' },
    { label: 'CATALOG', value: catalog_list.length, sub: 'available archetypes' },
    { label: 'AGENTS RUNNING', value: usage_list.length, sub: 'in this venture' },
    { label: 'PLAN', value: 'Max', sub: 'See optimiser →', href: '#hr-plan-optimizer' },
  ];

  const openingCard = (o) => `<div style="padding:12px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${o.status === 'open' ? '#c78500' : '#238c46'};border-radius:11px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;color:${o.status === 'open' ? '#c78500' : '#238c46'};">${escapeHtml(o.status)}</span>
      <span style="font-size:13.5px;font-weight:600;color:#16181e;flex:1;">${escapeHtml(o.title || '')}</span>
      ${o.module_id ? `<span style="font:500 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">→ ${escapeHtml(o.module_id)}</span>` : ''}
    </div>
    <div style="font-size:12.5px;color:#5b6270;line-height:1.5;">${escapeHtml(o.need || '')}</div>
  </div>`;

  const body = renderListSection({ title: 'Open Reqs', items: openings_list, emptyCopy: 'No agent openings today. Click New to open one when a Stewart seat needs filling.', itemRenderer: openingCard })
    + `<div style="margin-top:22px;">
        <a href="#hr-catalog" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#3468d6;text-decoration:none;font-weight:600;">Browse full catalog →</a>
      </div>`;

  root.innerHTML = renderModuleShell({
    mod: 'hr', meta, stats,
    headerRight: `<div style="display:flex;gap:8px;">
      <button type="button" id="chat-steward-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">💬 Steward</button>
      ${newButton(meta?.color)}
    </div>`,
    bodyHtml: body,
  });

  document.getElementById('chat-steward-btn')?.addEventListener('click', () => openStewardChat('hr'));
  document.getElementById('mod-new-btn')?.addEventListener('click', async () => {
    const title = await showPrompt('Opening title (e.g. "Sales Stewart for Sensible Trade"):'); if (!title) return;
    const need = await showPrompt('What need does this Stewart cover?'); if (!need) return;
    const module_id = await showPrompt('Which module will this Stewart own? (optional)') || null;
    try {
      await createModuleItem({ bu, module: 'hr', file: 'openings.json', item: { title, need, module_id, status: 'open', candidates: [], opened_at: new Date().toISOString() } });
      await renderHrOverview();
    } catch (e) { await showAlert(`Could not open req: ${e.message}`); }
  });
}

export async function renderHrCatalog() {
  const root = document.getElementById('route-hr-catalog');
  if (!root) return;
  const [meta, catalog] = await Promise.all([
    moduleMetaFor('hr'),
    fetch('/data/system/agent_catalog.json', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  const list = catalog?.archetypes || [];

  const KIND_COLOR = { stewart: '#3468d6', mason: '#7a4dff', external: '#d69a2b' };
  const card = (a) => `<div style="padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${KIND_COLOR[a.kind] || '#5b6270'};border-radius:11px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;color:${KIND_COLOR[a.kind] || '#5b6270'};">${escapeHtml(a.kind)}</span>
      <span style="font-size:14px;font-weight:700;color:#16181e;">${escapeHtml(a.display_name)}</span>
      ${a.cost_signal ? `<span style="margin-left:auto;font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">cost: ${escapeHtml(a.cost_signal)}</span>` : ''}
    </div>
    <div style="font-size:12.5px;color:#5b6270;line-height:1.5;">${escapeHtml(a.purpose || '')}</div>
    ${(a.tags || []).length > 0 ? `<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">${a.tags.map(t => `<span style="font:500 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;background:#f5f6f8;padding:2px 7px;border-radius:5px;">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
  </div>`;

  root.innerHTML = renderModuleShell({
    mod: 'hr', meta,
    stats: [{ label: 'CATALOG SIZE', value: list.length, sub: 'archetypes available' }],
    bodyHtml: renderListSection({ title: 'Archetype catalog', items: list, emptyCopy: 'Catalog empty.', itemRenderer: card }),
  });
}

export async function renderPlanOptimizer() {
  const root = document.getElementById('route-hr-plan-optimizer');
  if (!root) return;
  const bu = currentBu();
  const [meta, plans, usage] = await Promise.all([
    moduleMetaFor('hr'),
    fetch('/data/system/claude_plans.json', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetchModuleData(bu, 'hr', 'agent_usage.json'),
  ]);

  const currentPlan = (plans?.plans || [])[0] || { plan: '—', message_limit_5h: 0 };
  const usage_list = usage?.usage || [];
  const total5h = usage_list.reduce((s, u) => s + (u.runs_last_5h || 0), 0);
  const pct = currentPlan.message_limit_5h > 0 ? Math.round(total5h / currentPlan.message_limit_5h * 100) : 0;
  const color = pct < 60 ? '#238c46' : (pct < 85 ? '#c78500' : '#c12525');

  const suggestions = [];
  if (pct < 20) suggestions.push('You have plenty of headroom — this would be a good time to fire any queued A/B runs.');
  if (pct > 80) suggestions.push('Utilisation is high. Consider deferring low-priority Stewart heartbeats to the next window.');
  if (usage_list.length === 0) suggestions.push('No usage data yet — plan optimiser needs Paperclip execution logs to compute per-agent burn.');

  const body = `
    <div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:12px;padding:20px 24px;margin-bottom:18px;">
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:8px;">Current plan · ${escapeHtml(currentPlan.plan)}</div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px;">
        <span style="font-size:36px;font-weight:800;color:${color};line-height:1;">${pct}%</span>
        <span style="font-size:14px;color:#5b6270;">of 5h message limit · ${total5h} / ${currentPlan.message_limit_5h}</span>
      </div>
      <div style="height:8px;background:#eef0f4;border-radius:99px;overflow:hidden;"><div style="height:100%;background:${color};width:${Math.min(100, pct)}%;"></div></div>
    </div>
    ${renderListSection({ title: 'Suggestions', items: suggestions.map((s, i) => ({ id: i, body: s })), emptyCopy: 'No suggestions.', itemRenderer: s => `<div style="padding:12px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:11px;font-size:13px;color:#3a3f4a;line-height:1.55;">${escapeHtml(s.body)}</div>` })}
    ${renderListSection({ title: 'Agents by 5-hour usage', items: usage_list, emptyCopy: 'No agent usage data captured yet.', itemRenderer: u => `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:9px;font-size:13px;"><span style="flex:1;color:#16181e;">${escapeHtml(u.agent_id || '?')}</span><span style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;">${u.runs_last_5h || 0} runs · ${u.tokens_last_5h || 0} tokens</span></div>` })}
  `;

  root.innerHTML = renderModuleShell({ mod: 'hr', meta, bodyHtml: body });
}
