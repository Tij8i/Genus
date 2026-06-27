// Function Overview — the landing for a function (Finance, Strategy,
// Product, Operations).
//
// Layout:
//   Function header (eyebrow + page title + + Add workflow primary button)
//   Top tabs: Overview · Workflows · Tasks
//   Attention banner (workflows health)
//   Sub-tab bar (per-module: Budget/Costs/Invoices, Planning/KPIs/Learning,
//     Products/Vision/Roadmap/..., Inputs/Outputs)
//   Sub-tab content rendered into <div id="subtab-host"> by delegating to
//   the existing leaf view's render function (each leaf view now prefers
//   #subtab-host over its original route element).

import { C, MODULES, escapeHtml, currentBu, loadWorkflows, loadWorkflowTasks, functionHeader, dueStyle, updateTaskBadges } from './_shared.js';

// Per-module sub-tab definition. The `key` matches the dispatch table
// registered on window.__renderLeaf by app.js (which has the right ctx
// — identity / viewer / substrate slices — pre-loaded).
const SUBTABS = {
  finance: [
    { key: 'budget',   label: 'Budget' },
    { key: 'costs',    label: 'Costs' },
    { key: 'invoices', label: 'Invoices' },
  ],
  strategy: [
    { key: 'planning', label: 'Planning' },
    { key: 'kpis',     label: 'KPIs' },
    { key: 'learning', label: 'Learning' },
  ],
  product: [
    { key: 'products',      label: 'Products' },
    { key: 'vision',        label: 'Vision' },
    { key: 'roadmap',       label: 'Roadmap' },
    { key: 'backlog',       label: 'Backlog' },
    { key: 'releases',      label: 'Releases' },
    { key: 'design-system', label: 'Design system' },
    { key: 'decisions',     label: 'Decisions' },
  ],
  operations: [
    { key: 'inputs',  label: 'Inputs' },
    { key: 'outputs', label: 'Outputs' },
  ],
};

// Operations isn't a real "function" with module metadata in MODULES.finance/strategy/cs.
// Add it as a virtual module here.
const FN_META = {
  finance:    MODULES.finance,
  strategy:   MODULES.strategy,
  product:    { name: 'Product',    color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  operations: { name: 'Operations', color: '#5b6270', bg: 'rgba(91,98,112,.10)' },
};

function readSubtab(defaultKey) {
  const qs = (window.location.hash || '').split('?')[1] || '';
  return new URLSearchParams(qs).get('subtab') || defaultKey;
}

function writeSubtab(mod, subtab) {
  history.replaceState(null, '', `#${mod}-overview?subtab=${subtab}`);
}

export async function renderFunctionOverview(mod) {
  const root = document.getElementById(`route-${mod}-overview`);
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading…</div>';

  const [wfData, taskData] = await Promise.all([loadWorkflows(bu), loadWorkflowTasks(bu)]);
  const workflows = (wfData?.workflows || []).filter(w => w.mod === mod);
  const tasks = (taskData?.tasks || []).filter(t => t.mod === mod);
  updateTaskBadges(taskData?.tasks || []);

  const modMeta = FN_META[mod];
  const subtabs = SUBTABS[mod] || [];
  const activeSubtab = readSubtab(subtabs[0]?.key);

  const nowTasks = tasks.filter(t => t.group === 'now');
  const overdueTasks = tasks.filter(t => t.urgency === 'overdue');
  const banner = renderAttentionBanner(workflows.length, nowTasks.length, overdueTasks.length, mod);

  root.innerHTML = `
    <div style="max-width:1180px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'overview' })}
      ${banner}
      ${subtabs.length > 0 ? `
        <div style="display:flex;gap:4px;border-bottom:1px solid ${C.border};margin-bottom:22px;flex-wrap:wrap;">
          ${subtabs.map(s => {
            const on = s.key === activeSubtab;
            return `<button type="button" data-subtab="${escapeHtml(s.key)}" style="padding:10px 14px 12px;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:${on ? 700 : 500};color:${on ? C.ink : C.ink3};border-bottom:${on ? `2px solid ${C.accent}` : '2px solid transparent'};margin-bottom:-1px;">${escapeHtml(s.label)}</button>`;
          }).join('')}
        </div>
        <div id="subtab-host"></div>` : `
        <div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;text-align:center;background:#fbfbfc;">
          <h3 style="font-size:17px;font-weight:700;margin:0 0 7px;">${escapeHtml(modMeta.name)} — no module surfaces yet</h3>
          <p style="font-size:13.5px;color:${C.ink2};margin:0;">Install the ${escapeHtml(modMeta.name.toLowerCase())} module on this BU to populate the Overview.</p>
        </div>`}
    </div>
  `;

  // Wire sub-tab buttons
  document.querySelectorAll('[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.subtab;
      writeSubtab(mod, key);
      renderFunctionOverview(mod);
    });
  });
  document.getElementById('add-workflow-btn')?.addEventListener('click', () => alert('+ Add workflow — overlay ships in the follow-up slice.'));

  // Render the active sub-tab's content into #subtab-host via app.js's
  // dispatcher, which passes the right ctx (identity, viewer, substrate
  // slices) the leaf view expects.
  if (subtabs.length > 0) {
    const sub = subtabs.find(s => s.key === activeSubtab) || subtabs[0];
    const host = document.getElementById('subtab-host');
    if (host) host.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading…</div>';
    if (typeof window.__renderLeaf === 'function') {
      window.__renderLeaf(sub.key);
    } else if (host) {
      host.innerHTML = `<div style="padding:30px;color:#c12525;">Leaf dispatcher not ready yet — retry?</div>`;
    }
  }
}

function renderAttentionBanner(wfCount, nowCount, overdueCount, mod) {
  if (wfCount === 0 && nowCount === 0) return ''; // suppress for modules without workflows yet
  let bg, border, dot, msg;
  if (nowCount === 0) {
    bg = 'rgba(14,159,110,.06)'; border = 'rgba(14,159,110,.22)'; dot = C.green;
    msg = 'All caught up — no tasks need you right now.';
  } else if (overdueCount > 0) {
    bg = 'rgba(192,57,43,.06)'; border = 'rgba(192,57,43,.22)'; dot = C.red;
    msg = `${nowCount} task${nowCount === 1 ? ' needs' : 's need'} you now — including an overdue run.`;
  } else {
    bg = 'rgba(14,159,110,.06)'; border = 'rgba(14,159,110,.22)'; dot = C.green;
    msg = `${nowCount} task${nowCount === 1 ? ' needs' : 's need'} you now. Everything else is on track.`;
  }
  return `<div style="display:flex;align-items:center;gap:11px;padding:13px 16px;background:${bg};border:1px solid ${border};border-radius:13px;margin-bottom:18px;">
    <span style="width:8px;height:8px;border-radius:99px;background:${dot};flex:none;"></span>
    <span style="font-size:13.5px;color:${C.ink};font-weight:600;flex:1;">${escapeHtml(msg)}</span>
    <a href="#${mod}-tasks" style="font-size:12.5px;color:${C.ink2};text-decoration:none;font-weight:500;">Go to tasks ›</a>
  </div>`;
}
