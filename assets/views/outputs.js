// Outputs view — sub-tabs: Trajectory / Shipped / Milestones.
//
// Per operator's "submenus as a general rule" feedback (2026-06-19):
// each section is its own simple screen, no long scroll.

import { escapeHtml, ago, dateLabel, icon } from '../utils.js';

let activeSubTab = 'trajectory';
let activeRange = 'cycle';

export function renderOutputs(ctx) {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(queryStr).get('tab');
  if (['trajectory', 'shipped', 'tasks', 'milestones'].includes(tab)) activeSubTab = tab;

  const tasks = ctx.tasks || [];
  const initiatives = ctx.initiatives || [];
  const memos = ctx.memos || [];
  const plans = ctx.plans || [];
  const activePlan = plans.find(p => p.status === 'active');
  const rangeStart = computeRangeStart(activeRange, activePlan);
  const inRange = (iso) => iso && iso >= rangeStart;

  const shipped = tasks.filter(t => t.status === 'done' && inRange((t.execution || {}).completed_at))
    .sort((a, b) => ((b.execution || {}).completed_at || '').localeCompare((a.execution || {}).completed_at || ''));

  const milestonesReached = [];
  for (const init of initiatives) {
    for (const m of (init.milestones || [])) {
      if ((m.status || '').toLowerCase() === 'done' && inRange(m.closed_at)) {
        milestonesReached.push({
          initId: init.id, initTitle: init.title,
          msName: m.name, criticality: m.criticality,
          closedAt: m.closed_at, closedBy: m.closed_by,
        });
      }
    }
  }
  milestonesReached.sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));

  const deliverables = memos.filter(m => (m.level || '').toLowerCase() === 'deliverable')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const root = document.getElementById('route-outputs');
  root.innerHTML = `
    <nav class="subtab-nav">
      ${renderSubTab('trajectory', 'Trajectory')}
      ${renderSubTab('shipped', 'Shipped', shipped.length)}
      ${renderSubTab('tasks', 'Tasks', tasks.filter(t => ['pushed', 'executing', 'in_review', 'blocked'].includes((t.status || '').toLowerCase())).length)}
      ${renderSubTab('milestones', 'Milestones reached', milestonesReached.length)}
    </nav>
    ${renderRangeBar(activePlan)}
    <div id="outputs-subtab-body"></div>
  `;

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#outputs?tab=${activeSubTab}`;
      renderOutputs(ctx);
    });
  });
  root.querySelectorAll('.range-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeRange = btn.dataset.range;
      renderOutputs(ctx);
    });
  });

  const body = document.getElementById('outputs-subtab-body');
  if (activeSubTab === 'trajectory') body.innerHTML = renderTrajectoryCard(shipped, milestonesReached, activePlan);
  else if (activeSubTab === 'shipped') body.innerHTML = renderShipped(shipped, deliverables);
  else if (activeSubTab === 'tasks') body.innerHTML = renderTasks(tasks);
  else if (activeSubTab === 'milestones') body.innerHTML = renderMilestones(milestonesReached);
}

function renderTasks(tasks) {
  // Paperclip execution view per v0.7 README: running/awaiting-finalization
  // (status in pushed/executing/in_review/blocked) + recently closed
  // (status=done, last 7d). Top 5 of recently closed shown, rest greyed.
  const inFlight = tasks.filter(t => ['pushed', 'executing', 'in_review', 'blocked'].includes((t.status || '').toLowerCase()))
    .sort((a, b) => ((b.execution || {}).started_at || '').localeCompare((a.execution || {}).started_at || ''));
  const cutoff7d = Date.now() - 7 * 86400000;
  const recentlyClosed = tasks.filter(t => (t.status || '').toLowerCase() === 'done')
    .filter(t => {
      const c = (t.execution || {}).completed_at;
      return c && new Date(c).getTime() >= cutoff7d;
    })
    .sort((a, b) => ((b.execution || {}).completed_at || '').localeCompare((a.execution || {}).completed_at || ''));

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">In flight</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${inFlight.length} task${inFlight.length === 1 ? '' : 's'} · Paperclip execution</span>
      </div>
      <p class="card-sub">Running, awaiting finalization, or blocked. Lives in Paperclip; status syncs every 10 min.</p>
      <div class="task-rows" style="margin-top:14px">
        ${inFlight.length === 0
          ? `<div class="empty-state">Nothing in flight. Approve a suggestion to queue more work.</div>`
          : inFlight.map(t => renderTaskRow(t, 'in-flight')).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Recently closed</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${recentlyClosed.length} in last 7 days</span>
      </div>
      <div class="task-rows" style="margin-top:14px">
        ${recentlyClosed.length === 0
          ? `<div class="empty-state">No tasks closed in the last 7 days.</div>`
          : recentlyClosed.slice(0, 5).map(t => renderTaskRow(t, 'closed')).join('') +
            (recentlyClosed.length > 5
              ? `<div class="task-rows-extra">${recentlyClosed.slice(5, 20).map(t => renderTaskRow(t, 'closed-faded')).join('')}</div>${recentlyClosed.length > 20 ? `<div class="see-more">+ ${recentlyClosed.length - 20} more</div>` : ''}`
              : '')}
      </div>
    </div>
  `;
}

function renderTaskRow(t, kind) {
  const status = (t.status || '').toLowerCase();
  const stateColor = taskStateColor(status);
  const dateField = kind === 'in-flight' ? (t.execution || {}).started_at : (t.execution || {}).completed_at;
  const executor = (t.target || {}).executor || 'tuto-stewart';
  return `
    <div class="task-row task-row-${kind}">
      <span class="task-row-status-chip task-row-status-${stateColor}">${escapeHtml(status.replace(/_/g, ' '))}</span>
      <div class="task-row-body">
        <div class="task-row-title">${escapeHtml(t.title || 'Untitled task')}</div>
        <div class="task-row-meta mono">${escapeHtml(executor)}${t.category ? ` · ${escapeHtml(t.category)}` : ''}${t.advances_initiative && t.advances_initiative !== 'unrelated' ? ` · → ${escapeHtml(t.advances_initiative)}` : ''}</div>
      </div>
      <span class="task-row-when mono">${escapeHtml(ago(dateField))}</span>
    </div>
  `;
}

function taskStateColor(s) {
  switch (s) {
    case 'pushed': case 'executing': case 'in_review': return 'blue';
    case 'done': return 'green';
    case 'blocked': case 'failed': case 'rejected': return 'red';
    case 'awaiting_approval': return 'yellow';
    default: return 'gray';
  }
}

function renderSubTab(name, label, count) {
  return `
    <button type="button" class="subtab-link ${activeSubTab === name ? 'current' : ''}" data-subtab="${name}">
      ${escapeHtml(label)}
      ${count > 0 ? `<span class="subtab-badge">${count}</span>` : ''}
    </button>
  `;
}

function computeRangeStart(range, activePlan) {
  if (range === 'all') return '0000-01-01';
  if (range === '30d') return new Date(Date.now() - 30 * 86400000).toISOString();
  if (activePlan?.period_start) return activePlan.period_start;
  return new Date(Date.now() - 30 * 86400000).toISOString();
}

function renderRangeBar(activePlan) {
  const cycleLabel = activePlan ? `This cycle` : 'This cycle';
  return `
    <div class="range-bar">
      <span class="card-section-label" style="margin-right:8px">RANGE</span>
      <button type="button" class="range-pill ${activeRange === 'cycle' ? 'current' : ''}" data-range="cycle">${escapeHtml(cycleLabel)}</button>
      <button type="button" class="range-pill ${activeRange === '30d' ? 'current' : ''}" data-range="30d">Last 30d</button>
      <button type="button" class="range-pill ${activeRange === 'all' ? 'current' : ''}" data-range="all">All time</button>
    </div>
  `;
}

// ============ Trajectory sub-tab ============

function renderTrajectoryCard(shipped, milestonesReached, activePlan) {
  const totalShipped = shipped.length;
  const criticalDone = milestonesReached.filter(m => (m.criticality || '').toLowerCase() === 'critical').length;
  const narrative = composeNarrative(shipped, milestonesReached, activePlan);

  return `
    <div class="card trajectory-card">
      <div class="trajectory-header">
        <span class="trajectory-icon">${icon('arrow-trend-up', {color: '#fff', size: 18, stroke: 1.9})}</span>
        <span class="trajectory-title">Trajectory</span>
        <span class="mono" style="font-size:11px;color:var(--text-faint)">${totalShipped} tasks · ${milestonesReached.length} milestones (${criticalDone} critical)</span>
        ${narrative.toneChip}
      </div>
      <p class="trajectory-narrative">${narrative.html}</p>
    </div>
  `;
}

function composeNarrative(shipped, milestones, activePlan) {
  if (shipped.length === 0 && milestones.length === 0) {
    return {
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-quiet">Quiet</span>`,
      html: `Nothing shipped in this range yet. Either the cycle is young, the work is still in flight, or the system is idle.`,
    };
  }
  if (milestones.length > 0 && shipped.length > 0) {
    const lastMs = milestones[0];
    return {
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-converging">Converging</span>`,
      html: `Direction is real. <strong>${shipped.length}</strong> task${shipped.length === 1 ? '' : 's'} shipped and <strong>${milestones.length}</strong> milestone${milestones.length === 1 ? '' : 's'} closed (most recent: «${escapeHtml(lastMs.msName)}» on ${escapeHtml(dateLabel(lastMs.closedAt))}). Momentum is forward; keep the gate tight on the next critical milestone.`,
    };
  }
  if (shipped.length > 0) {
    return {
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-active">Active</span>`,
      html: `<strong>${shipped.length}</strong> task${shipped.length === 1 ? '' : 's'} shipped in this range, but no milestone closures yet. Output is flowing but not locked into a checkpoint. Worth reviewing whether in-flight work is converging on a milestone you can mark done.`,
    };
  }
  return {
    toneChip: `<span class="trajectory-tone-chip trajectory-tone-quiet">Patchy</span>`,
    html: `<strong>${milestones.length}</strong> milestone${milestones.length === 1 ? '' : 's'} closed but no operational tasks shipped in this range — either offline decisions or manual mark-dones. Worth a glance to confirm everything reads consistent.`,
  };
}

// ============ Shipped sub-tab ============

function renderShipped(shipped, deliverables) {
  if (shipped.length === 0) {
    return `<div class="card"><div class="card-title">Work shipped</div><div class="empty-state">No tasks completed in this range.</div></div>`;
  }
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Work shipped</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${shipped.length} task${shipped.length === 1 ? '' : 's'}${deliverables.length ? ` · ${deliverables.length} deliverable${deliverables.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div class="work-grid" style="margin-top:14px">
        ${shipped.slice(0, 24).map(renderWorkCard).join('')}
      </div>
      ${shipped.length > 24 ? `<div class="see-more">+ ${shipped.length - 24} more — switch range to "All time"</div>` : ''}
    </div>
  `;
}

function renderWorkCard(t) {
  const category = (t.category || '').toLowerCase();
  const labelByCategory = {
    build: 'feature', documentation: 'docs', operations: 'ops', research: 'research',
    outreach: 'outreach', housekeeping: 'cleanup', substrate_fix: 'fix',
    decision_capture: 'decision', conversation: 'meeting',
  };
  const thumbLabel = labelByCategory[category] || (category || 'task');
  const closedAt = (t.execution || {}).completed_at;
  const executor = (t.target || {}).executor || 'tuto-stewart';
  return `
    <div class="work-card">
      <div class="work-thumb"><span class="mono work-thumb-label">${escapeHtml(thumbLabel)}</span></div>
      <div class="work-body">
        <div class="work-head">
          <span class="work-cat mono">${escapeHtml((category || '').toUpperCase())}</span>
          <span class="work-when mono">${escapeHtml(ago(closedAt))}</span>
        </div>
        <div class="work-title">${escapeHtml(t.title || 'Untitled task')}</div>
        <div class="work-from mono">${escapeHtml(executor)} · ${escapeHtml(t.id.replace('task-', ''))}</div>
      </div>
    </div>
  `;
}

// ============ Milestones sub-tab ============

function renderMilestones(milestones) {
  if (milestones.length === 0) {
    return `<div class="card"><div class="card-title">Milestones reached</div><div class="empty-state">No milestones closed in this range.</div></div>`;
  }
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Milestones reached</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${milestones.length} closed</span>
      </div>
      <div class="milestones-reached-list">
        ${milestones.map(m => `
          <div class="ms-reached-row">
            ${icon('check-circle', {color: 'var(--green)', size: 18, stroke: 2.4})}
            <div class="ms-reached-body">
              <div class="ms-reached-title">${escapeHtml(m.msName)}</div>
              <div class="ms-reached-init mono">${escapeHtml(m.initTitle.slice(0, 80))}${m.criticality === 'critical' ? ' · CRITICAL' : ''}${m.closedBy ? ` · closed by ${escapeHtml(m.closedBy)}` : ''}</div>
            </div>
            <span class="ms-reached-when mono">${escapeHtml(ago(m.closedAt))}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
