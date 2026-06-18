// Outputs view — what the venture has put into the world.
//
// Per v0.6 mockup IA:
//   - Range selector (this cycle / last 30d / all time)
//   - Trajectory narrative (rule-based for v1, LLM in v2)
//   - Work shipped grid (cards for each artifact)
//   - Milestones reached (timeline list of completed Initiative milestones)
//
// Sources:
//   - tasks where status=done → work shipped (recent first)
//   - initiative.milestones where status=done → milestones reached
//   - memos with level=deliverable → artifacts that match shipped work

import { escapeHtml, ago, dateLabel, icon, isoDay } from '../utils.js';

let activeRange = 'cycle'; // 'cycle' | '30d' | 'all'

export function renderOutputs(ctx) {
  const root = document.getElementById('route-outputs');
  const tasks = ctx.tasks || [];
  const initiatives = ctx.initiatives || [];
  const memos = ctx.memos || [];
  const plans = ctx.plans || [];
  const activePlan = plans.find(p => p.status === 'active');

  const rangeStart = computeRangeStart(activeRange, activePlan);
  const inRange = (iso) => iso && iso >= rangeStart;

  // Work shipped = tasks with status=done in range
  const shipped = tasks.filter(t => {
    const done = (t.execution || {}).completed_at;
    return t.status === 'done' && inRange(done);
  }).sort((a, b) => {
    const ad = (a.execution || {}).completed_at || '';
    const bd = (b.execution || {}).completed_at || '';
    return bd.localeCompare(ad);
  });

  // Milestones reached = milestones with status=done across all initiatives, in range
  const milestonesReached = [];
  for (const init of initiatives) {
    for (const m of (init.milestones || [])) {
      if ((m.status || '').toLowerCase() === 'done' && inRange(m.closed_at)) {
        milestonesReached.push({
          initId: init.id,
          initTitle: init.title,
          msName: m.name,
          criticality: m.criticality,
          closedAt: m.closed_at,
          closedBy: m.closed_by,
        });
      }
    }
  }
  milestonesReached.sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));

  // Deliverable memos (artifacts produced) — operator-shareable docs
  const deliverables = memos.filter(m => (m.level || '').toLowerCase() === 'deliverable')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  root.innerHTML = `
    ${renderRangeBar(activePlan)}
    ${renderTrajectoryCard(shipped, milestonesReached, activePlan)}
    ${renderWorkShippedSection(shipped, deliverables)}
    ${renderMilestonesReachedSection(milestonesReached)}
  `;

  root.querySelectorAll('.range-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeRange = btn.dataset.range;
      renderOutputs(ctx);
    });
  });
}

function computeRangeStart(range, activePlan) {
  if (range === 'all') return '0000-01-01';
  if (range === '30d') {
    return new Date(Date.now() - 30 * 86400000).toISOString();
  }
  // 'cycle' — use active plan's period_start, fallback to 30d
  if (activePlan?.period_start) return activePlan.period_start;
  return new Date(Date.now() - 30 * 86400000).toISOString();
}

function renderRangeBar(activePlan) {
  const cycleLabel = activePlan
    ? `THIS CYCLE · ${escapeHtml((activePlan.title || '').slice(0, 30))}`
    : 'THIS CYCLE';
  return `
    <div class="range-bar">
      <span class="card-section-label" style="margin-right:8px">RANGE</span>
      <button type="button" class="range-pill ${activeRange === 'cycle' ? 'current' : ''}" data-range="cycle">${escapeHtml(cycleLabel)}</button>
      <button type="button" class="range-pill ${activeRange === '30d' ? 'current' : ''}" data-range="30d">Last 30d</button>
      <button type="button" class="range-pill ${activeRange === 'all' ? 'current' : ''}" data-range="all">All time</button>
    </div>
  `;
}

function renderTrajectoryCard(shipped, milestonesReached, activePlan) {
  const totalShipped = shipped.length;
  const criticalDone = milestonesReached.filter(m => (m.criticality || '').toLowerCase() === 'critical').length;
  const narrative = composeTrajectoryNarrative(shipped, milestonesReached, activePlan);

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

function composeTrajectoryNarrative(shipped, milestones, activePlan) {
  // Rule-based composition (LLM narrative deferred to v2).
  if (shipped.length === 0 && milestones.length === 0) {
    return {
      tone: 'gray',
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-quiet">Quiet</span>`,
      html: `Nothing shipped in this range yet. Either the cycle is young, the work is still in flight, or the system is idle.`,
    };
  }
  if (milestones.length > 0 && shipped.length > 0) {
    const lastMs = milestones[0];
    return {
      tone: 'green',
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-converging">Converging</span>`,
      html: `Direction is real. <strong>${shipped.length}</strong> task${shipped.length === 1 ? '' : 's'} shipped and <strong>${milestones.length}</strong> milestone${milestones.length === 1 ? '' : 's'} closed (most recent: «${escapeHtml(lastMs.msName)}» on ${escapeHtml(dateLabel(lastMs.closedAt))}). Momentum is forward; keep the gate tight on the next critical milestone.`,
    };
  }
  if (shipped.length > 0) {
    return {
      tone: 'yellow',
      toneChip: `<span class="trajectory-tone-chip trajectory-tone-active">Active</span>`,
      html: `<strong>${shipped.length}</strong> task${shipped.length === 1 ? '' : 's'} shipped in this range, but no milestone closures yet. Output is flowing but not yet locked into a checkpoint. Risk: shipping volume without closure = busy but not progressing. Worth reviewing whether the in-flight work is converging on a milestone you can mark done.`,
    };
  }
  return {
    tone: 'yellow',
    toneChip: `<span class="trajectory-tone-chip trajectory-tone-quiet">Patchy</span>`,
    html: `<strong>${milestones.length}</strong> milestone${milestones.length === 1 ? '' : 's'} closed but no operational tasks shipped in this range — either offline decisions or manual mark-dones. Worth a glance to confirm everything reads consistent.`,
  };
}

function renderWorkShippedSection(shipped, deliverables) {
  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">Work shipped · ${shipped.length} task${shipped.length === 1 ? '' : 's'}${deliverables.length ? ` · ${deliverables.length} deliverable${deliverables.length === 1 ? '' : 's'}` : ''}</span>
        <div class="rule-line"></div>
      </div>
      ${shipped.length === 0
        ? `<div class="card"><div class="empty-state">No tasks completed in this range.</div></div>`
        : `<div class="work-grid">
            ${shipped.slice(0, 18).map(renderWorkCard).join('')}
          </div>`}
      ${shipped.length > 18 ? `<div class="see-more">+ ${shipped.length - 18} more — adjust range to see all</div>` : ''}
    </section>
  `;
}

function renderWorkCard(t) {
  const category = (t.category || '').toLowerCase();
  // Pick a placeholder "thumbnail" by category — diagonal-line pattern + label
  const labelByCategory = {
    build: 'feature',
    documentation: 'docs',
    operations: 'ops',
    research: 'research',
    outreach: 'outreach',
    housekeeping: 'cleanup',
    substrate_fix: 'fix',
    decision_capture: 'decision',
    conversation: 'meeting',
  };
  const thumbLabel = labelByCategory[category] || (category || 'task');
  const closedAt = (t.execution || {}).completed_at;
  const executor = (t.target || {}).executor || 'tuto-stewart';
  return `
    <div class="work-card">
      <div class="work-thumb">
        <span class="mono work-thumb-label">${escapeHtml(thumbLabel)}</span>
      </div>
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

function renderMilestonesReachedSection(milestones) {
  if (milestones.length === 0) return '';
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Milestones reached</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">behind you</span>
      </div>
      <div class="milestones-reached-list">
        ${milestones.slice(0, 12).map(m => `
          <div class="ms-reached-row">
            ${icon('check-circle', {color: 'var(--green)', size: 18, stroke: 2.4})}
            <div class="ms-reached-body">
              <div class="ms-reached-title">${escapeHtml(m.msName)}</div>
              <div class="ms-reached-init mono">${escapeHtml(m.initTitle.slice(0, 80))}${m.criticality === 'critical' ? ' · CRITICAL' : ''}${m.closedBy ? ` · closed by ${escapeHtml(m.closedBy)}` : ''}</div>
            </div>
            <span class="ms-reached-when mono">${escapeHtml(ago(m.closedAt))}</span>
          </div>
        `).join('')}
        ${milestones.length > 12 ? `<div class="see-more">+ ${milestones.length - 12} more</div>` : ''}
      </div>
    </div>
  `;
}
