// Planning view — locked-in plan, grouped Initiative timeline, sub-tabs for
// Active / Backlog / Retrospective.
//
// Per operator feedback 2026-06-19:
//   1. Active plan card on TOP
//   2. Initiative timeline BELOW (one merged view, no separate "rows" list)
//   3. Timeline bars are CLICKABLE → open detail overlay (same overlay as before)
//   4. Initiatives GROUPED BY GOAL (one timeline section per goal in active plan)
//   5. Sub-tab nav must NOT clobber the route hash (fixed in router.js)

import { escapeHtml, ago, dateLabel, isoDay, cycleTimeProgress } from '../utils.js';

const BU = 'tuto';

let openInitiativeId = null;
let activeSubTab = 'active';

export function renderPlanning(ctx, { onChange }) {
  // Read sub-tab from URL query (#planning?tab=backlog). Router now strips
  // the query before validating, so this is safe.
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const tab = params.get('tab');
  if (['active', 'backlog', 'retrospective'].includes(tab)) activeSubTab = tab;

  const root = document.getElementById('route-planning');
  root.innerHTML = `
    <nav class="subtab-nav">
      ${['active', 'backlog', 'retrospective'].map(t => `
        <button type="button" class="subtab-link ${activeSubTab === t ? 'current' : ''}" data-subtab="${t}">
          ${t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      `).join('')}
    </nav>
    <div id="planning-subtab-body"></div>
    <div id="initiative-detail-host"></div>
  `;

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      // Set query param (router treats #planning?tab=X as route 'planning')
      window.location.hash = `#planning?tab=${activeSubTab}`;
      renderPlanning(ctx, { onChange });
    });
  });

  const body = document.getElementById('planning-subtab-body');
  if (activeSubTab === 'active') body.innerHTML = renderActiveSubTab(ctx);
  else if (activeSubTab === 'backlog') body.innerHTML = renderBacklogSubTab(ctx);
  else if (activeSubTab === 'retrospective') body.innerHTML = renderRetrospectiveSubTab(ctx);

  // Wire clickable Initiative bars in the timeline (replaces the old row click)
  body.querySelectorAll('[data-init-id]').forEach(el => {
    el.addEventListener('click', () => {
      openInitiativeId = el.dataset.initId;
      renderInitiativeDetailOverlay(ctx, onChange);
    });
  });

  if (openInitiativeId) renderInitiativeDetailOverlay(ctx, onChange);
}

// ============ Sub-tab: Active ============

function renderActiveSubTab(ctx) {
  const activePlan = ctx.plans.find(p => p.status === 'active');
  const planInits = activePlan
    ? (activePlan.initiative_ids || []).map(iid => ctx.initiatives.find(i => i.id === iid)).filter(Boolean)
    : [];
  return `
    ${renderActivePlanCard(activePlan, planInits)}
    ${renderCoreKpisStrip(ctx)}
    ${renderGroupedTimeline(ctx, activePlan, planInits)}
  `;
}

// Compact 4-card KPI strip for the Planning page (per v0.7 mockup line 39).
// Picks top 4 KPIs by priority (primary > secondary) + category (north_star
// + lagging first). Shows value, target, color status.
function renderCoreKpisStrip(ctx) {
  const kpis = ctx.kpis || [];
  if (!kpis.length) return '';
  const priorityOrder = { primary: 1, secondary: 2 };
  const categoryOrder = { north_star: 1, lagging: 2, leading: 3, milestone: 4, operational: 5 };
  const top4 = kpis.slice().sort((a, b) => {
    const pa = priorityOrder[a.priority] || 9;
    const pb = priorityOrder[b.priority] || 9;
    if (pa !== pb) return pa - pb;
    return (categoryOrder[a.category] || 9) - (categoryOrder[b.category] || 9);
  }).slice(0, 4);
  return `
    <div class="core-kpi-strip">
      ${top4.map(k => {
        const value = k.last_value != null ? formatKpiValue(k.last_value, k.unit) : '—';
        const target = k.target != null ? formatKpiValue(k.target, k.unit) : '';
        return `
          <div class="core-kpi-card">
            <div class="core-kpi-label">${escapeHtml(k.name.length > 32 ? k.name.slice(0, 30) + '…' : k.name)}</div>
            <div class="core-kpi-value mono">${escapeHtml(value)}</div>
            <div class="core-kpi-sub mono">${target ? `target ${escapeHtml(target)}` : (k.area || '').replace(/_/g, ' ')}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function formatKpiValue(v, unit) {
  if (typeof v === 'number') {
    const formatted = Number.isInteger(v) ? v.toString() : v.toFixed(1);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(v);
}

function renderActivePlanCard(activePlan, planInits) {
  if (!activePlan) {
    return `
      <div class="card empty-plan-card">
        <div class="card-title">No active plan</div>
        <p class="card-sub">Tuto can only react without an active plan. Create one to lock this cycle's goals + initiatives.</p>
      </div>
    `;
  }
  const total = planInits.length;
  const done = planInits.filter(i => ['completed'].includes((i.status || '').toLowerCase())).length;
  const inProgress = planInits.filter(i => ['in_progress', 'review', 'scoping'].includes((i.status || '').toLowerCase())).length;
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const timeProg = cycleTimeProgress(activePlan);
  return `
    <div class="card">
      <div class="plan-card-header">
        <div>
          <div class="mono" style="font-size:11px;color:var(--text-faint);letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Active plan</div>
          <div class="plan-card-title-row">
            <span class="plan-card-title">${escapeHtml(activePlan.title || 'Untitled plan')}</span>
            <span class="plan-card-version mono">${escapeHtml(activePlan.period_start || '')} → ${escapeHtml(activePlan.period_target_end || 'open')}</span>
            <span class="plan-card-locked"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Locked ${escapeHtml(activePlan.activated_at ? activePlan.activated_at.slice(0, 10) : '')}</span>
          </div>
          ${activePlan.rationale ? `<p class="plan-card-rationale">${escapeHtml(activePlan.rationale)}</p>` : ''}
        </div>
        <div class="plan-card-stats">
          <div class="plan-card-pct mono">${completionPct}%</div>
          <div class="plan-card-pct-sub">${done} of ${total} done · ${inProgress} active</div>
          ${timeProg ? `<div class="plan-card-time mono">${timeProg.remainingDays} days left / ${timeProg.totalDays}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderGroupedTimeline(ctx, activePlan, planInits) {
  // Group active Initiatives by goal_id. Each group is its own timeline section.
  // Initiative bars are clickable (replaces the old separate "Initiatives in this plan" list).
  if (!planInits.length) {
    return `<div class="card"><div class="card-title">Initiative timeline</div><p class="card-sub">No initiatives in this plan.</p></div>`;
  }
  const goals = ctx.goals || [];
  // Determine timeline date range from ALL active initiatives in plan
  const today = new Date().toISOString().slice(0, 10);
  const startsArr = planInits.map(i => isoDay(i.started_at || i.created_at) || today);
  const endsArr = planInits.map(i => isoDay(i.target_close_date || i.closed_at) || today);
  const rangeStart = startsArr.concat([today]).sort()[0];
  const rangeEnd = endsArr.concat([today]).sort().slice(-1)[0];
  const startTs = new Date(rangeStart + 'T00:00:00Z').getTime();
  const endTs = new Date(rangeEnd + 'T00:00:00Z').getTime();
  const todayTs = new Date(today + 'T00:00:00Z').getTime();
  const span = Math.max(1, endTs - startTs);
  const pct = ts => Math.max(0, Math.min(100, ((ts - startTs) / span) * 100));
  const todayPct = pct(todayTs);

  // Weekly axis ticks (shared across all goal groups)
  const weekTicks = [];
  for (let cur = startTs; cur <= endTs; cur += 7 * 86400000) {
    weekTicks.push({ date: new Date(cur).toISOString().slice(0, 10), pct: pct(cur) });
  }
  if (weekTicks[weekTicks.length - 1]?.date !== rangeEnd) {
    weekTicks.push({ date: rangeEnd, pct: 100 });
  }

  // Group by goal_id
  const byGoal = {};
  for (const init of planInits) {
    const gid = init.goal_id || '__no_goal__';
    (byGoal[gid] = byGoal[gid] || []).push(init);
  }

  // Render each group as its own section, in goal order (active plan's goal_ids
  // first, then any orphan-goal-id last).
  const orderedGoalIds = (activePlan?.goal_ids || []).filter(gid => byGoal[gid]);
  Object.keys(byGoal).forEach(gid => {
    if (gid !== '__no_goal__' && !orderedGoalIds.includes(gid)) orderedGoalIds.push(gid);
  });
  if (byGoal['__no_goal__']) orderedGoalIds.push('__no_goal__');

  const sections = orderedGoalIds.map(gid => {
    const goal = goals.find(g => g.id === gid);
    const inits = byGoal[gid].slice().sort((a, b) =>
      ((a.target_close_date || '9999-12-31').slice(0, 10)).localeCompare(
        (b.target_close_date || '9999-12-31').slice(0, 10),
      )
    );
    const goalLabel = gid === '__no_goal__'
      ? 'Unaligned initiatives'
      : (goal?.title || `Goal · ${gid}`);
    const goalSub = goal?.description ? `<div class="tl3-goal-sub">${escapeHtml(goal.description)}</div>` : '';
    return `
      <div class="tl3-goal-section">
        <div class="tl3-goal-header">
          <span class="tl3-goal-marker"></span>
          <div>
            <div class="tl3-goal-title">${escapeHtml(goalLabel)}</div>
            ${goalSub}
          </div>
          <span class="tl3-goal-count mono">${inits.length} initiative${inits.length === 1 ? '' : 's'}</span>
        </div>
        <div class="tl3-rows">
          ${inits.map(init => renderTimelineRow(init, ctx, pct, today)).join('')}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Initiatives</span></div>
        <span class="muted-emph">${planInits.length} active · ${rangeStart} → ${rangeEnd}</span>
      </div>
      <p class="card-sub">Grouped by goal. Click any bar to open the initiative detail.</p>
      <div class="tl3-axis-wrap">
        <div class="tl3-axis">
          ${weekTicks.map(t => `
            <div class="tl3-axis-tick" style="left:${t.pct.toFixed(1)}%">
              <div class="tl3-axis-tick-line"></div>
              <div class="tl3-axis-tick-label mono">${escapeHtml(t.date.slice(5))}</div>
            </div>
          `).join('')}
          <div class="tl3-today-line" style="left:${todayPct.toFixed(1)}%" title="today · ${today}"></div>
        </div>
      </div>
      ${sections}
    </div>
  `;
}

function renderTimelineRow(init, ctx, pct, today) {
  const start = isoDay(init.started_at || init.created_at) || today;
  const end = isoDay(init.target_close_date) || today;
  const startPct = pct(new Date(start + 'T00:00:00Z').getTime());
  const endPctVal = pct(new Date(end + 'T00:00:00Z').getTime());
  const widthPct = Math.max(2, endPctVal - startPct);
  const status = (init.status || 'not_started').toLowerCase();
  const stateColor = initStateColor(status);
  const overdue = end < today && !['completed', 'done'].includes(status);

  // Milestone ticks
  const ms = init.milestones || [];
  const firstPendingIdx = ms.findIndex(m => (m.status || 'pending').toLowerCase() !== 'done');
  const ticks = ms.map((m, idx) => {
    const tickPos = ms.length === 1 ? 50 : (idx / (ms.length - 1)) * 100;
    const msState = (m.status || 'pending').toLowerCase();
    let tickClass = 'tl3-tick-waiting';
    if (msState === 'done') tickClass = 'tl3-tick-done';
    else if (firstPendingIdx === idx) tickClass = 'tl3-tick-current';
    const critClass = (m.criticality || '').toLowerCase() === 'critical' ? ' tl3-tick-critical' : '';
    return `<div class="tl3-tick ${tickClass}${critClass}" style="left:${tickPos.toFixed(1)}%" title="${escapeHtml(m.name)} (${m.criticality || 'tactical'} · ${msState})"></div>`;
  }).join('');

  // Compact stats summary
  const linked = (ctx.tasks || []).filter(t => t.advances_initiative === init.id);
  const doneCount = linked.filter(t => (t.status || '').toLowerCase() === 'done').length;
  const dlLabel = init.target_close_date ? dateLabel(init.target_close_date) : '';

  const hypothesisHtml = init.active_hypothesis
    ? `<div class="tl3-row-hypothesis"><span class="tl3-hypothesis-label mono">HYPOTHESIS</span>${escapeHtml((init.active_hypothesis || '').slice(0, 180))}${(init.active_hypothesis || '').length > 180 ? '…' : ''}</div>`
    : '';
  return `
    <div class="tl3-row" data-init-id="${escapeHtml(init.id)}" role="button" tabindex="0">
      <div class="tl3-row-label">
        <div class="tl3-row-title">${escapeHtml(init.title)}</div>
        ${hypothesisHtml}
        <div class="tl3-row-meta mono">
          ${escapeHtml(dlLabel)}
          ${linked.length ? ` · ${doneCount}/${linked.length} tasks` : ''}
          ${overdue ? ' · <span class="tl3-overdue">OVERDUE</span>' : ''}
        </div>
      </div>
      <div class="tl3-row-track">
        <div class="tl3-bar tl3-bar-${stateColor}${overdue ? ' tl3-bar-overdue' : ''}" style="left:${startPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%" title="${escapeHtml(start)} → ${escapeHtml(end)} · ${escapeHtml(status)} · click to open">
          ${ticks}
        </div>
      </div>
      <span class="init-state-chip init-state-chip-${stateColor}">${escapeHtml(status.replace(/_/g, ' '))}</span>
    </div>
  `;
}

// ============ Sub-tab: Backlog ============

function renderBacklogSubTab(ctx) {
  const activePlan = ctx.plans.find(p => p.status === 'active');
  const planInitIds = new Set(activePlan?.initiative_ids || []);
  const backlogInits = (ctx.initiatives || []).filter(i =>
    !planInitIds.has(i.id) &&
    !['completed', 'abandoned', 'discarded'].includes((i.status || '').toLowerCase()) &&
    (i.backlog_state === 'untriaged' || !i.backlog_state || i.backlog_state === 'pending_review')
  );
  const backlogGoals = (ctx.goals || []).filter(g => g.backlog_state === 'untriaged' || !g.promoted_to_plan_id);

  return `
    <div class="card">
      <div class="card-title">Backlog</div>
      <p class="card-sub">Goals + Initiatives not in the active plan. The staging area before promoting to a cycle.</p>
      ${backlogGoals.length ? `
        <div class="backlog-section">
          <div class="mono" style="font-size:10px;color:var(--text-faint);letter-spacing:.1em;margin:14px 0 8px">GOALS · ${backlogGoals.length}</div>
          ${backlogGoals.map(g => `
            <div class="backlog-row">
              <div class="backlog-row-body">
                <div class="backlog-row-title">${escapeHtml(g.title || 'Untitled goal')}</div>
                ${g.description ? `<div class="backlog-row-desc">${escapeHtml(g.description)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${backlogInits.length ? `
        <div class="backlog-section">
          <div class="mono" style="font-size:10px;color:var(--text-faint);letter-spacing:.1em;margin:14px 0 8px">INITIATIVES · ${backlogInits.length}</div>
          ${backlogInits.map(i => `
            <div class="backlog-row" role="button" tabindex="0" data-init-id="${escapeHtml(i.id)}">
              <div class="backlog-row-body">
                <div class="backlog-row-title">${escapeHtml(i.title)}</div>
                ${i.active_hypothesis ? `<div class="backlog-row-desc"><strong>Hypothesis:</strong> ${escapeHtml((i.active_hypothesis || '').slice(0, 200))}</div>` : ''}
                <div class="mono" style="font-size:10px;color:var(--text-faint);margin-top:6px">${escapeHtml(i.id)} · ${escapeHtml(i.backlog_state || 'untriaged')}${i.from_memo ? ` · from ${escapeHtml(i.from_memo)}` : ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${(!backlogGoals.length && !backlogInits.length) ? `
        <div class="empty-state">Backlog is empty. Strategic memos auto-create Backlog items at next heartbeat.</div>
      ` : ''}
    </div>
  `;
}

// ============ Sub-tab: Retrospective ============

function renderRetrospectiveSubTab(ctx) {
  const completedPlans = (ctx.plans || []).filter(p => ['completed', 'superseded'].includes(p.status))
    .sort((a, b) => (b.completed_at || b.superseded_at || '').localeCompare(a.completed_at || a.superseded_at || ''));
  if (!completedPlans.length) {
    return `<div class="card"><div class="card-title">Retrospective</div><p class="card-sub">Past plans + their outcomes will appear here as cycles close.</p><div class="empty-state">No completed cycles yet.</div></div>`;
  }
  return `
    <div class="card">
      <div class="card-title">Past cycles</div>
      <p class="card-sub">Completed + superseded plans. Click into one to see actual outcomes vs hypotheses.</p>
      <div class="retro-list">
        ${completedPlans.map(p => `
          <div class="retro-row">
            <div class="retro-row-body">
              <div class="retro-row-title">${escapeHtml(p.title || 'Untitled plan')}</div>
              <div class="mono" style="font-size:10.5px;color:var(--text-faint);margin-top:3px">
                ${p.status === 'completed' ? 'completed' : 'superseded'} ${ago(p.completed_at || p.superseded_at)} ·
                ${(p.initiative_ids || []).length} initiative${(p.initiative_ids || []).length === 1 ? '' : 's'}${p.closure_status ? ` · ${escapeHtml(p.closure_status)}` : ''}
              </div>
              ${p.closing_notes ? `<div class="retro-notes">${escapeHtml(p.closing_notes.slice(0, 240))}${p.closing_notes.length > 240 ? '…' : ''}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============ Initiative detail overlay ============

function renderInitiativeDetailOverlay(ctx, onChange) {
  const init = (ctx.initiatives || []).find(i => i.id === openInitiativeId);
  if (!init) { openInitiativeId = null; return; }
  const host = document.getElementById('initiative-detail-host');
  if (!host) return;

  const status = (init.status || 'not_started').toLowerCase();
  const stateColor = initStateColor(status);
  const linked = (ctx.tasks || []).filter(t => t.advances_initiative === init.id);
  const ms = init.milestones || [];
  const firstPendingIdx = ms.findIndex(m => (m.status || 'pending').toLowerCase() !== 'done');
  const currentMs = firstPendingIdx >= 0 ? ms[firstPendingIdx] : null;

  host.innerHTML = `
    <div class="overlay-backdrop" id="overlay-backdrop"></div>
    <div class="overlay-panel" role="dialog" aria-labelledby="overlay-title">
      <div class="overlay-head">
        <div>
          <div class="mono" style="font-size:10.5px;color:var(--text-faint);letter-spacing:.1em">${escapeHtml(init.id)}</div>
          <h2 id="overlay-title" class="overlay-title">${escapeHtml(init.title)}</h2>
          <div class="overlay-meta">
            <span class="init-state-chip init-state-chip-${stateColor}">${escapeHtml(status.replace(/_/g, ' '))}</span>
            ${init.target_close_date ? `<span class="mono" style="font-size:11px;color:var(--text-faint)">target ${escapeHtml(init.target_close_date.slice(0, 10))}</span>` : ''}
            ${init.priority_in_plan ? `<span class="mono" style="font-size:11px;color:var(--text-faint)">${escapeHtml(init.priority_in_plan)}</span>` : ''}
          </div>
        </div>
        <button type="button" class="overlay-close" id="overlay-close" aria-label="Close">✕</button>
      </div>

      ${ms.length ? `
        <div class="overlay-section">
          <div class="card-section-label" style="margin-bottom:14px">Milestones</div>
          ${renderMilestoneStrip(ms, currentMs)}
          ${currentMs ? `
            <div class="overlay-mark-done-row">
              <button type="button" class="overlay-mark-done-btn" data-init-id="${escapeHtml(init.id)}" data-ms-id="${escapeHtml(currentMs.id)}">✓ Mark «${escapeHtml(currentMs.name)}» done</button>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="overlay-section">
          <div class="empty-state">No milestones defined. Tuto's next heartbeat will improvise one if the Initiative has an active_hypothesis.</div>
        </div>
      `}

      ${init.active_hypothesis ? `
        <div class="overlay-section">
          <div class="card-section-label">Active hypothesis</div>
          <p class="overlay-prose">${escapeHtml(init.active_hypothesis)}</p>
        </div>
      ` : ''}

      ${init.success_criterion ? `
        <div class="overlay-section">
          <div class="card-section-label">Success criterion</div>
          <p class="overlay-prose">${escapeHtml(init.success_criterion)}</p>
        </div>
      ` : ''}

      ${linked.length ? `
        <div class="overlay-section">
          <div class="card-section-label" style="margin-bottom:12px">Linked tasks · ${linked.length}</div>
          <div class="overlay-task-list">
            ${linked.slice(0, 10).map(t => `
              <div class="overlay-task-row">
                <span class="init-state-chip init-state-chip-${initTaskColor(t.status)}">${escapeHtml((t.status || '').replace(/_/g, ' '))}</span>
                <div class="overlay-task-title">${escapeHtml(t.title)}</div>
                <span class="mono" style="font-size:10.5px;color:var(--text-faint)">${escapeHtml(t.id.replace('task-', ''))}</span>
              </div>
            `).join('')}
            ${linked.length > 10 ? `<div class="see-more">+ ${linked.length - 10} more — see Outputs</div>` : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const close = () => { openInitiativeId = null; host.innerHTML = ''; };
  document.getElementById('overlay-backdrop').addEventListener('click', close);
  document.getElementById('overlay-close').addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });

  const markBtn = host.querySelector('.overlay-mark-done-btn');
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      const initId = markBtn.dataset.initId;
      const msId = markBtn.dataset.msId;
      if (!window.confirm(`Mark milestone «${currentMs.name}» done? The next milestone becomes current.`)) return;
      markBtn.disabled = true;
      markBtn.textContent = 'marking…';
      try {
        const resp = await fetch('/api/update-initiative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU, init_id: initId, action: 'mark_milestone_done', milestone_id: msId, actor: 'operator' }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        onChange();
      } catch (e) {
        markBtn.disabled = false;
        markBtn.textContent = `✗ ${e.message}`;
      }
    });
  }
}

function renderMilestoneStrip(milestones, currentMs) {
  return `
    <div class="ms-strip">
      ${milestones.map((m, idx) => {
        const isCurrent = m.id === currentMs?.id;
        const status = (m.status || 'pending').toLowerCase();
        let state = 'waiting';
        if (status === 'done') state = 'done';
        else if (isCurrent) state = 'current';
        const crit = (m.criticality || 'tactical').toLowerCase() === 'critical' ? ' ms-critical' : '';
        return `
          ${idx > 0 ? `<div class="ms-conn"></div>` : ''}
          <div class="ms-node ms-node-${state}${crit}" title="${escapeHtml(m.name)} (${m.criticality || 'tactical'} · ${status})">
            <div class="ms-dot"></div>
            <div class="ms-name">${escapeHtml(m.name)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ============ Helpers ============

function initStateColor(status) {
  switch ((status || '').toLowerCase()) {
    case 'not_started': return 'gray';
    case 'scoping': return 'yellow';
    case 'in_progress': return 'green';
    case 'review': return 'blue';
    case 'blocked': return 'red';
    case 'completed':
    case 'discarded':
    case 'abandoned': return 'dim';
    default: return 'gray';
  }
}

function initTaskColor(status) {
  switch ((status || '').toLowerCase()) {
    case 'awaiting_approval': return 'yellow';
    case 'approved':
    case 'pushed':
    case 'executing': return 'blue';
    case 'done': return 'green';
    case 'rejected':
    case 'cancelled':
    case 'failed': return 'red';
    default: return 'gray';
  }
}
