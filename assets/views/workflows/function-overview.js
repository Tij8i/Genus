// Function Overview — the landing for a function (Finance / Strategy /
// Product / Operations).
//
// Per the design handoff:
//   Function header (eyebrow + page title + + Add workflow primary button)
//   Top tabs (level 1): Overview · Workflows · Tasks
//   Body of Overview:
//     1. Attention banner (workflows health)
//     2. 4-up stat tiles (Workflows / Automated / Open tasks / Adherence)
//     3. 2-up rollups (Workflows preview · Open tasks preview)
//     4. Information · <Function> — 3+ reference tiles linking to the
//        legacy module surfaces (Budget / Costs / Invoices for Finance, etc).
//
// The "Information tiles" REPLACE having those surfaces in the sidebar.
// Clicking a tile navigates to the legacy route which still works standalone.

import { C, MODULES, escapeHtml, currentBu, loadWorkflows, loadWorkflowTasks, functionHeader, workflowRow, dueStyle, adherenceColor, updateTaskBadges } from './_shared.js';
import { showAlert, showConfirm, showPrompt } from '../../dialog.js';

const FN_META = {
  finance:    MODULES.finance,
  strategy:   MODULES.strategy,
  product:    { name: 'Product',    color: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  operations: { name: 'Operations', color: '#5b6270', bg: 'rgba(91,98,112,.10)' },
};

// Per-module reference-tile grid. Title + metric + sub + chevron, linking
// to the legacy route for that surface.
const INFO_TILES = {
  finance: [
    { name: 'Budget',   metric: '€1.24M',       sub: '68% utilised',    href: '#budget' },
    { name: 'Costs',    metric: '€812k YTD',    sub: '+4% vs plan',     href: '#costs' },
    { name: 'Invoices', metric: '42 sent',      sub: '3 overdue',       href: '#invoices' },
  ],
  strategy: [
    { name: 'Planning', metric: 'Q3 roadmap',   sub: '14 initiatives',  href: '#planning' },
    { name: 'KPIs',     metric: '12 tracked',   sub: '9 on target',     href: '#kpis' },
    { name: 'Learning', metric: '6 experiments',sub: '2 active',        href: '#learning' },
  ],
  product: [
    { name: 'Products',      metric: '3 active',      sub: 'platform + agents', href: '#products' },
    { name: 'Vision',        metric: 'v0.8 horizon',  sub: 'reviewed 2w ago',   href: '#vision' },
    { name: 'Roadmap',       metric: '15 items',      sub: '7 shipped',         href: '#roadmap' },
    { name: 'Backlog',       metric: '6 ideas',       sub: 'oldest 1mo',        href: '#backlog' },
    { name: 'Releases',      metric: '3 shipped',     sub: 'latest v0.7',       href: '#releases' },
    { name: 'Design system', metric: '5 token groups',sub: 'last edit 1w',      href: '#design-system' },
    { name: 'Decisions',     metric: '9 ADRs',        sub: '7 accepted',        href: '#decisions' },
  ],
  operations: [
    { name: 'Inputs',  metric: '—', sub: 'incoming surfaces',  href: '#inputs' },
    { name: 'Outputs', metric: '—', sub: 'outgoing surfaces',  href: '#outputs' },
  ],
};

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
  const totalSteps = workflows.reduce((s, w) => s + (w.total_steps || 0), 0);
  const autoSteps  = workflows.reduce((s, w) => s + (w.automated_steps || 0), 0);
  const autoPct = totalSteps > 0 ? Math.round(autoSteps / totalSteps * 100) : 0;
  const adhValues = workflows.map(w => w.adherence_pct_90d).filter(v => v != null);
  const avgAdh = adhValues.length > 0 ? Math.round(adhValues.reduce((s, v) => s + v, 0) / adhValues.length) : null;
  const adhColor = adherenceColor(avgAdh);
  const nowTasks = tasks.filter(t => t.group === 'now');
  const overdueTasks = tasks.filter(t => t.urgency === 'overdue');
  const openCount = tasks.length;
  const openColor = overdueTasks.length > 0 ? C.red : C.ink;

  const tiles = INFO_TILES[mod] || [];
  const tilesColCount = tiles.length <= 3 ? tiles.length : (tiles.length === 7 ? 4 : 3);

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'overview' })}
      ${renderAttentionBanner(nowTasks.length, overdueTasks.length, mod)}
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:18px;">
        ${statTile('WORKFLOWS', workflows.length, `${tasks.length} open tasks`, C.ink, `#${mod}-workflows`)}
        ${statTile('AUTOMATED', `${autoPct}%`, `${autoSteps}/${totalSteps} steps`, C.green)}
        ${statTile('OPEN TASKS', openCount, `${nowTasks.length} needs you now`, openColor, `#${mod}-tasks`)}
        ${statTile('ADHERENCE', avgAdh == null ? '—' : `${avgAdh}%`, '90-day average', adhColor)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
        ${rollupCard('Workflows', `#${mod}-workflows`,
          workflows.length === 0
            ? '<div style="font-size:13px;color:#9aa1ae;padding:18px 4px;text-align:center;">No workflows yet.</div>'
            : workflows.slice(0, 3).map(w => workflowRow(w, true)).join(''))}
        ${rollupCard('Open tasks', `#${mod}-tasks`,
          tasks.length === 0
            ? '<div style="font-size:13px;color:#9aa1ae;padding:18px 4px;text-align:center;">All caught up.</div>'
            : tasks.slice(0, 3).map(taskPreviewRow).join(''))}
      </div>

      ${tiles.length > 0 ? `
        <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:10px;">Information · ${escapeHtml(modMeta.name)}</div>
        <div style="display:grid;grid-template-columns:repeat(${tilesColCount}, 1fr);gap:12px;">
          ${tiles.map(infoTile).join('')}
        </div>` : ''}
    </div>
  `;
  document.getElementById('add-workflow-btn')?.addEventListener('click', async () => {
    await showAlert('+ Add workflow — overlay ships in the follow-up slice.');
  });
}

function renderAttentionBanner(nowCount, overdueCount, mod) {
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

function statTile(label, num, sub, numColor, href) {
  const inner = `<div style="background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,18,28,.04);${href ? 'cursor:pointer;' : ''}">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">${escapeHtml(label)}</div>
    <div style="font-size:27px;font-weight:800;letter-spacing:-.02em;color:${numColor};">${escapeHtml(String(num))}</div>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:5px;">${escapeHtml(sub)}</div>
  </div>`;
  return href ? `<a href="${href}" style="text-decoration:none;color:inherit;">${inner}</a>` : inner;
}

function rollupCard(title, viewAllHash, body) {
  return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <strong style="font-size:14.5px;color:${C.ink};">${escapeHtml(title)}</strong>
      <a href="${viewAllHash}" style="font-size:12px;color:${C.accent};text-decoration:none;font-weight:600;">View all ›</a>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">${body}</div>
  </div>`;
}

function taskPreviewRow(t) {
  const d = dueStyle(t.urgency);
  return `<a href="#workflow-detail/${escapeHtml(t.wf_id)}?from=overview" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:11px;text-decoration:none;color:inherit;">
    <span style="width:18px;height:18px;flex:none;border-radius:6px;border:1.6px solid rgba(20,22,28,.3);"></span>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:600;color:${C.ink};">${escapeHtml(t.title)}</div>
      <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:2px;">${escapeHtml(t.wf_title)}</div>
    </div>
    <span style="font:600 11px ${C.mono};color:${d.color};background:${d.bg};padding:2px 8px;border-radius:6px;">${escapeHtml(t.due)}</span>
  </a>`;
}

function infoTile(info) {
  return `<a href="${info.href}" style="display:flex;align-items:center;justify-content:space-between;background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:16px 18px;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div>
      <div style="font-size:14px;font-weight:700;color:${C.ink};">${escapeHtml(info.name)}</div>
      <div style="font-size:18px;font-weight:800;color:${C.ink};margin-top:5px;letter-spacing:-.01em;">${escapeHtml(info.metric)}</div>
      <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:3px;">${escapeHtml(info.sub)}</div>
    </div>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.ink3}" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
  </a>`;
}
