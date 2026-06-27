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
let editPlanOpen = false;
let cycleBusy = false;  // disables buttons while a plan-cycle mutation is in flight
let showArchive = false;  // Backlog kanban: toggle Promoted + Discarded columns (GEN-50)

export function renderPlanning(ctx, { onChange }) {
  // Read sub-tab from URL query (#planning?tab=backlog). Router now strips
  // the query before validating, so this is safe.
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const tab = params.get('tab');
  if (['active', 'backlog', 'retrospective'].includes(tab)) activeSubTab = tab;

  const root = (document.getElementById('subtab-host') || document.getElementById('route-planning'));
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

  // Wire plan-cycle controls on the active plan card
  wirePlanCycleControls(body, ctx, onChange);

  // Wire Backlog kanban triage buttons + archive toggle (GEN-50)
  if (activeSubTab === 'backlog') wireBacklogActions(body, ctx, onChange);

  if (openInitiativeId) renderInitiativeDetailOverlay(ctx, onChange);
  if (editPlanOpen) renderEditPlanOverlay(ctx, onChange);
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
      <div class="plan-card-controls" data-plan-id="${escapeHtml(activePlan.id)}">
        <button type="button" class="plan-cycle-btn" data-cycle-action="complete">Mark cycle complete</button>
        <button type="button" class="plan-cycle-btn" data-cycle-action="propose">Ask Stewart for 3 plan proposals</button>
        <button type="button" class="plan-cycle-btn plan-cycle-btn-primary" data-cycle-action="edit">Edit current plan</button>
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

// ============ Sub-tab: Backlog (GEN-50 — restored from legacy parity audit) ============
//
// 4-column kanban (Untriaged / Ready / Promoted / Discarded) with per-card
// triage buttons that POST to /api/update-backlog-item. Both goals + initiatives
// surface as cards, tagged with a GOAL/INIT badge. "Show Promoted + Discarded"
// toggle hides the archive columns by default. See GEN-39 audit + GEN-50.

function renderBacklogSubTab(ctx) {
  const allItems = [
    ...(ctx.goals || []).map(g => ({ ...g, _type: 'goal' })),
    ...(ctx.initiatives || []).map(i => ({ ...i, _type: 'initiative' })),
  ];

  const cols = {
    untriaged: allItems.filter(x => (x.backlog_state || 'untriaged') === 'untriaged'),
    ready: allItems.filter(x => x.backlog_state === 'ready'),
    promoted_to_plan: allItems.filter(x => x.backlog_state === 'promoted_to_plan'),
    discarded: allItems.filter(x => x.backlog_state === 'discarded'),
  };

  return `
    <div class="card">
      <div class="backlog-header">
        <div class="backlog-tagline">
          Candidate pool. Memos + agent scans feed <strong>Untriaged</strong>. Vet → <strong>Ready</strong>.
          Promote to a Plan from the Active tab.
        </div>
        <label class="backlog-archive-toggle">
          <input type="checkbox" id="backlog-show-archive" ${showArchive ? 'checked' : ''}>
          Show Promoted + Discarded
        </label>
      </div>
      <div class="kanban">
        ${renderBacklogColumn('Untriaged', '🆕', cols.untriaged, 'untriaged')}
        ${renderBacklogColumn('Ready', '✓', cols.ready, 'ready')}
        ${showArchive ? renderBacklogColumn('Promoted', '➤', cols.promoted_to_plan, 'promoted_to_plan') : ''}
        ${showArchive ? renderBacklogColumn('Discarded', '✗', cols.discarded, 'discarded') : ''}
      </div>
    </div>
  `;
}

function renderBacklogColumn(label, icon, items, state) {
  return `
    <div class="kanban-col" data-state="${escapeHtml(state)}">
      <div class="kanban-col-h">
        <span>${icon} ${escapeHtml(label)}</span>
        <span class="kanban-count">${items.length}</span>
      </div>
      <div class="kanban-col-body">
        ${items.length ? items.map(renderBacklogCard).join('') : '<div class="kanban-empty">—</div>'}
      </div>
    </div>
  `;
}

function renderBacklogCard(it) {
  const typeBadge = it._type === 'goal'
    ? '<span class="b-type b-type-goal">GOAL</span>'
    : '<span class="b-type b-type-init">INIT</span>';
  const state = it.backlog_state || 'untriaged';

  let actions = '';
  if (state === 'untriaged') {
    actions = `
      <button class="b-action b-ready" data-action="move_to_ready" data-item-type="${it._type}" data-item-id="${escapeHtml(it.id)}">→ Ready</button>
      <button class="b-action b-discard" data-action="discard" data-item-type="${it._type}" data-item-id="${escapeHtml(it.id)}">Discard</button>
    `;
  } else if (state === 'ready') {
    actions = `
      <button class="b-action" data-action="move_to_untriaged" data-item-type="${it._type}" data-item-id="${escapeHtml(it.id)}">← Untriaged</button>
      <button class="b-action b-discard" data-action="discard" data-item-type="${it._type}" data-item-id="${escapeHtml(it.id)}">Discard</button>
    `;
  } else if (state === 'discarded') {
    actions = `
      <button class="b-action" data-action="restore" data-item-type="${it._type}" data-item-id="${escapeHtml(it.id)}">Restore</button>
    `;
  } else if (state === 'promoted_to_plan') {
    actions = `<span class="b-promoted-note">in plan ${escapeHtml((it.promoted_to_plan_id || '').slice(0, 22))}</span>`;
  }

  const desc = it._type === 'goal'
    ? (it.description ? `<div class="b-desc">${escapeHtml(it.description)}</div>` : '')
    : (it.active_hypothesis ? `<div class="b-desc"><strong>Hypothesis:</strong> ${escapeHtml(it.active_hypothesis.slice(0, 240))}${it.active_hypothesis.length > 240 ? '…' : ''}</div>` : '');

  return `
    <div class="b-card b-card-${escapeHtml(state)}">
      <div class="b-card-head">
        ${typeBadge}
        ${it.from_memo ? `<span class="b-from-memo">memo ${escapeHtml(it.from_memo.slice(0, 22))}</span>` : ''}
      </div>
      <div class="b-title">${escapeHtml(it.title || 'Untitled')}</div>
      ${desc}
      ${it.discarded_reason ? `<div class="b-discarded-reason">Reason: ${escapeHtml(it.discarded_reason)}</div>` : ''}
      <div class="b-actions">${actions}</div>
    </div>
  `;
}

function wireBacklogActions(scope, ctx, onChange) {
  // Archive toggle
  const archiveToggle = scope.querySelector('#backlog-show-archive');
  if (archiveToggle) {
    archiveToggle.addEventListener('change', e => {
      showArchive = e.target.checked;
      renderPlanning(ctx, { onChange });
    });
  }

  // Per-card action buttons
  scope.querySelectorAll('button.b-action[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemType = btn.dataset.itemType;
      const itemId = btn.dataset.itemId;
      const action = btn.dataset.action;

      let discardedReason = null;
      if (action === 'discard') {
        discardedReason = window.prompt('Reason for discarding (optional):') || null;
      }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const resp = await fetch('/api/update-backlog-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: BU,
            item_type: itemType,
            item_id: itemId,
            action,
            discarded_reason: discardedReason,
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        onChange();  // re-fetches ctx + re-renders
      } catch (e) {
        btn.disabled = false;
        btn.textContent = originalText;
        alert(`Failed: ${e.message}`);
        console.error('[planning] backlog action failed:', e);
      }
    });
  });
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

      ${renderGatewayApprovalPanel(init, ms)}

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

  wireGatewayApprovalPanel(host, init, onChange);
}

// ============ Gateway-approval panel (GEN-40) ============
// Renders only when Initiative status is `gateways_pending_approval`. Shows the
// proposed gateway list with per-row inline edits (title + criticality) plus
// Approve / Reject buttons. Schema for `init.gateways[]` documented in
// dashboard/public/data/bus/tuto/initiatives.schema.md.
function renderGatewayApprovalPanel(init, milestones) {
  if ((init.status || '').toLowerCase() !== 'gateways_pending_approval') return '';

  const gateways = Array.isArray(init.gateways) ? init.gateways : [];
  if (!gateways.length) {
    return `
      <div class="overlay-section gateway-panel">
        <div class="card-section-label" style="margin-bottom:8px">Gateways — awaiting approval</div>
        <div class="empty-state">Initiative is in <strong>gateways_pending_approval</strong> but no <code>gateways</code> array is populated. Stewart will propose the list at next heartbeat.</div>
      </div>
    `;
  }

  const msById = new Map((milestones || []).map(m => [m.id, m]));

  return `
    <div class="overlay-section gateway-panel">
      <div class="card-section-label" style="margin-bottom:8px">Gateways — awaiting your approval</div>
      <p class="overlay-prose" style="margin-top:0;margin-bottom:14px">
        Stewart proposed <strong>${gateways.length}</strong> gateway${gateways.length === 1 ? '' : 's'} for this Initiative. Approve to unblock task emission, edit titles/criticality in place, or reject with a reason to send it back to scoping.
      </p>
      <div class="gateway-list">
        ${gateways.map(gw => {
          const ms = msById.get(gw.gates_milestone_id);
          const msName = ms ? ms.name : (gw.gates_milestone_id || '—');
          const crit = (gw.criticality || 'tactical').toLowerCase();
          const reasoning = gw.reasoning || '';
          return `
            <div class="gateway-row" data-gateway-id="${escapeHtml(gw.id)}">
              <div class="gateway-row-main">
                <input type="text" class="gateway-title-input" data-field="title" value="${escapeHtml(gw.title || '')}" placeholder="Gateway title">
                <select class="gateway-crit-select" data-field="criticality">
                  <option value="critical" ${crit === 'critical' ? 'selected' : ''}>critical</option>
                  <option value="tactical" ${crit === 'tactical' ? 'selected' : ''}>tactical</option>
                </select>
              </div>
              <div class="gateway-row-meta">
                <span class="gateway-gates-ms">gates: <span class="mono">${escapeHtml(msName)}</span></span>
                ${reasoning ? `
                  <button type="button" class="gateway-reasoning-toggle" aria-expanded="false">why?</button>
                ` : ''}
              </div>
              ${reasoning ? `
                <div class="gateway-reasoning" hidden>${escapeHtml(reasoning)}</div>
              ` : ''}
              <div class="gateway-row-status" aria-live="polite"></div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="gateway-actions">
        <button type="button" class="plan-cycle-btn" data-gateway-action="reject">Reject (back to scoping)</button>
        <button type="button" class="plan-cycle-btn plan-cycle-btn-primary" data-gateway-action="approve">Approve · unblock emit</button>
      </div>
    </div>
  `;
}

function wireGatewayApprovalPanel(host, init, onChange) {
  const panel = host.querySelector('.gateway-panel');
  if (!panel) return;

  panel.querySelectorAll('.gateway-row').forEach(row => {
    const gatewayId = row.dataset.gatewayId;
    const titleInput = row.querySelector('.gateway-title-input');
    const critSelect = row.querySelector('.gateway-crit-select');
    const statusEl = row.querySelector('.gateway-row-status');

    const baselineTitle = titleInput?.value ?? '';
    const baselineCrit = critSelect?.value ?? '';

    async function commit(field, value, controlEl) {
      const edits = { [field]: value };
      controlEl.disabled = true;
      statusEl.textContent = 'saving…';
      try {
        const resp = await fetch('/api/update-initiative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU, init_id: init.id, action: 'edit_gateway', gateway_id: gatewayId, edits, actor: 'operator' }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        statusEl.textContent = '✓ saved';
        setTimeout(() => { if (statusEl.textContent === '✓ saved') statusEl.textContent = ''; }, 1500);
      } catch (e) {
        statusEl.textContent = `✗ ${e.message?.slice(0, 80) || 'failed'}`;
      } finally {
        controlEl.disabled = false;
      }
    }

    if (titleInput) {
      titleInput.addEventListener('blur', () => {
        const v = titleInput.value.trim();
        if (!v) { titleInput.value = baselineTitle; return; }
        if (v === baselineTitle) return;
        commit('title', v, titleInput);
      });
    }
    if (critSelect) {
      critSelect.addEventListener('change', () => {
        if (critSelect.value === baselineCrit) return;
        commit('criticality', critSelect.value, critSelect);
      });
    }

    const toggle = row.querySelector('.gateway-reasoning-toggle');
    const reasoning = row.querySelector('.gateway-reasoning');
    if (toggle && reasoning) {
      toggle.addEventListener('click', () => {
        const open = reasoning.hidden === false;
        reasoning.hidden = open;
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        toggle.textContent = open ? 'why?' : 'hide';
      });
    }
  });

  const actions = panel.querySelector('.gateway-actions');
  if (!actions) return;
  const buttons = actions.querySelectorAll('[data-gateway-action]');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.gatewayAction;
      const body = { bu: BU, init_id: init.id, action: 'set_status', actor: 'operator' };
      let successPhrase;

      if (action === 'approve') {
        if (!window.confirm('Approve this gateway list? Initiative moves to in_progress and task emission unblocks at the next heartbeat.')) return;
        body.status = 'in_progress';
        body.rationale = 'operator approved gateway list (GEN-40 panel)';
        successPhrase = '✓ approved';
      } else if (action === 'reject') {
        const reason = window.prompt('Reject — send Initiative back to scoping. Reason (Stewart re-proposes on next heartbeat):', '');
        if (reason === null) return;
        const trimmed = reason.trim();
        if (!trimmed) { alert('A rejection reason is required so Stewart knows how to re-propose.'); return; }
        body.status = 'scoping';
        body.rationale = trimmed;
        successPhrase = '✓ rejected';
      } else {
        return;
      }

      buttons.forEach(b => { b.disabled = true; });
      const original = btn.textContent;
      btn.textContent = 'working…';
      try {
        const resp = await fetch('/api/update-initiative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        btn.textContent = successPhrase;
        onChange();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `✗ ${e.message?.slice(0, 80) || 'failed'}`;
        setTimeout(() => { btn.textContent = original; }, 4000);
        buttons.forEach(b => { b.disabled = false; });
      }
    });
  });
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
    case 'gateways_pending_approval': return 'yellow';
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

// ============ Plan-cycle controls (GEN-38) ============

function wirePlanCycleControls(scope, ctx, onChange) {
  const controls = scope.querySelector('.plan-card-controls');
  if (!controls) return;
  const planId = controls.dataset.planId;
  const buttons = controls.querySelectorAll('.plan-cycle-btn');
  if (cycleBusy) buttons.forEach(b => { b.disabled = true; });

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.cycleAction;
      if (action === 'complete') return onCompleteCycle(planId, btn, ctx, onChange);
      if (action === 'propose') return onRequestProposals(planId, btn, ctx, onChange);
      if (action === 'edit') { editPlanOpen = true; renderEditPlanOverlay(ctx, onChange); }
    });
  });
}

async function onCompleteCycle(planId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === planId);
  if (!plan) return;
  const inits = (plan.initiative_ids || [])
    .map(iid => (ctx.initiatives || []).find(i => i.id === iid))
    .filter(Boolean);
  const stillOpen = inits.filter(i => !['completed', 'abandoned', 'discarded'].includes((i.status || '').toLowerCase())).length;
  const msg = stillOpen > 0
    ? `Mark cycle "${plan.title}" complete?\n\n${stillOpen} of ${inits.length} initiatives are still open — they will be auto-archived as completed. A retrospective stub will be written.\n\nThis is reversible only by editing data files directly.`
    : `Mark cycle "${plan.title}" complete?\n\nA retrospective stub will be written.`;
  const notes = window.prompt(msg + '\n\nOptional closing note (blank → default stub):', '');
  if (notes === null) return;  // cancelled
  await runCycleAction(btn, async () => {
    const resp = await fetch('/api/update-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU, plan_id: planId, action: 'complete_cycle', closing_notes: notes.trim() || undefined, actor: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    return json;
  }, onChange);
}

async function onRequestProposals(planId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === planId);
  if (!plan) return;
  if (!window.confirm(`File a task asking the ${BU}-stewart to draft 3 alternative next-cycle plans?\n\nThe Stewart will produce 3 different shapes/priorities at next heartbeat. You pick ONE to activate.`)) return;
  await runCycleAction(btn, async () => {
    const body = {
      bu: BU,
      title: `Draft 3 alternative next-cycle plans (after ${plan.id})`,
      description: `Operator requested 3 alternative next-cycle plan proposals from the dashboard. Produce them in dashboard/public/data/bus/${BU}/plan_proposals.json. Each proposal should be a DIFFERENT SHAPE: different goal mix, different priorities, different cadence — not three near-duplicates. Reference the just-closed cycle "${plan.title}" (${plan.id}) when grounding the proposals. After they appear, the operator picks one in the dashboard and it gets activated.`,
      category: 'plan_proposal',
      target: { type: 'json_file', scope: `dashboard/public/data/bus/${BU}/plan_proposals.json`, executor: `${BU}-stewart` },
      estimated_minutes: 90,
      risk_level: 'low',
      reversibility: 'high',
      source: 'planning_view_ask_proposals',
    };
    const resp = await fetch('/api/file-stewart-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    return json;
  }, onChange);
}

async function runCycleAction(btn, fn, onChange) {
  cycleBusy = true;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'working…';
  try {
    await fn();
    btn.textContent = '✓ done';
    onChange();  // re-fetches ctx + re-renders
  } catch (e) {
    cycleBusy = false;
    btn.disabled = false;
    btn.textContent = `✗ ${e.message?.slice(0, 80) || 'failed'}`;
    setTimeout(() => { btn.textContent = original; }, 4000);
  }
}

function renderEditPlanOverlay(ctx, onChange) {
  const host = document.getElementById('initiative-detail-host');
  if (!host) return;
  const plan = (ctx.plans || []).find(p => p.status === 'active');
  if (!plan) { editPlanOpen = false; host.innerHTML = ''; return; }

  // All Initiatives that are eligible to be IN a plan: anything not closed
  // (completed/abandoned/discarded). Currently-in-plan ones come pre-checked.
  const allInits = (ctx.initiatives || []).filter(i =>
    !['completed', 'abandoned', 'discarded'].includes((i.status || '').toLowerCase())
  );
  const currentIds = new Set(plan.initiative_ids || []);

  host.innerHTML = `
    <div class="overlay-backdrop" id="edit-plan-backdrop"></div>
    <div class="overlay-panel" role="dialog" aria-labelledby="edit-plan-title">
      <div class="overlay-head">
        <div>
          <div class="mono" style="font-size:10.5px;color:var(--text-faint);letter-spacing:.1em">${escapeHtml(plan.id)}</div>
          <h2 id="edit-plan-title" class="overlay-title">Edit current plan</h2>
        </div>
        <button type="button" class="overlay-close" id="edit-plan-close" aria-label="Close">✕</button>
      </div>

      <div class="overlay-section">
        <label class="edit-plan-label">Title</label>
        <input type="text" id="edit-plan-input-title" class="edit-plan-input" value="${escapeHtml(plan.title || '')}">
      </div>

      <div class="overlay-section">
        <label class="edit-plan-label">Rationale</label>
        <textarea id="edit-plan-input-rationale" class="edit-plan-textarea" rows="5">${escapeHtml(plan.rationale || '')}</textarea>
      </div>

      <div class="overlay-section">
        <label class="edit-plan-label">Target end date</label>
        <input type="date" id="edit-plan-input-end" class="edit-plan-input" value="${escapeHtml((plan.period_target_end || '').slice(0, 10))}">
      </div>

      <div class="overlay-section">
        <label class="edit-plan-label">Initiatives in this plan (${currentIds.size} selected)</label>
        <p class="card-sub" style="margin:4px 0 10px">Toggle initiatives in or out of the active plan. Currently-closed initiatives are not shown.</p>
        <div class="edit-plan-init-list">
          ${allInits.length ? allInits.map(i => `
            <label class="edit-plan-init-row">
              <input type="checkbox" data-init-id="${escapeHtml(i.id)}" ${currentIds.has(i.id) ? 'checked' : ''}>
              <div class="edit-plan-init-row-body">
                <div class="edit-plan-init-row-title">${escapeHtml(i.title)}</div>
                <div class="mono" style="font-size:10.5px;color:var(--text-faint)">${escapeHtml(i.id)} · ${escapeHtml((i.status || 'not_started').replace(/_/g, ' '))}</div>
              </div>
            </label>
          `).join('') : '<div class="empty-state">No open initiatives. Create one from Backlog first.</div>'}
        </div>
      </div>

      <div class="overlay-section edit-plan-actions">
        <button type="button" class="plan-cycle-btn" id="edit-plan-cancel">Cancel</button>
        <button type="button" class="plan-cycle-btn plan-cycle-btn-primary" id="edit-plan-save">Save changes</button>
      </div>
    </div>
  `;

  const close = () => { editPlanOpen = false; host.innerHTML = ''; };
  document.getElementById('edit-plan-backdrop').addEventListener('click', close);
  document.getElementById('edit-plan-close').addEventListener('click', close);
  document.getElementById('edit-plan-cancel').addEventListener('click', close);
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });

  const saveBtn = document.getElementById('edit-plan-save');
  saveBtn.addEventListener('click', async () => {
    const titleVal = document.getElementById('edit-plan-input-title').value.trim();
    const rationaleVal = document.getElementById('edit-plan-input-rationale').value.trim();
    const endVal = document.getElementById('edit-plan-input-end').value.trim();
    const newInitIds = Array.from(host.querySelectorAll('[data-init-id]'))
      .filter(cb => cb.checked).map(cb => cb.dataset.initId);

    const edits = {};
    if (titleVal && titleVal !== (plan.title || '')) edits.title = titleVal;
    if (rationaleVal !== (plan.rationale || '')) edits.rationale = rationaleVal;
    if (endVal && endVal !== (plan.period_target_end || '').slice(0, 10)) edits.period_target_end = endVal;
    const oldIds = (plan.initiative_ids || []).slice().sort().join(',');
    const newIds = newInitIds.slice().sort().join(',');
    if (oldIds !== newIds) edits.initiative_ids = newInitIds;

    if (!Object.keys(edits).length) { close(); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'saving…';
    try {
      const resp = await fetch('/api/update-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu: BU, plan_id: plan.id, action: 'edit_plan', edits, actor: 'operator' }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);

      // Structural change → offer Stewart resync
      const structural = edits.initiative_ids || edits.period_target_end;
      if (structural && window.confirm('These edits change the plan structure — should the Stewart re-evaluate existing tasks against the new structure?\n\nIf yes, a Stewart task will be filed to re-sync open tasks against the edited plan at the next heartbeat.')) {
        const resyncResp = await fetch('/api/file-stewart-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: BU,
            title: `Re-sync open tasks against edited plan ${plan.id}`,
            description: `Operator edited the active plan ${plan.id} structure (${Object.keys(edits).join(', ')}). Re-evaluate all open / awaiting_approval / approved tasks: do any now point at archived initiatives, contradict the new initiative roster, or no longer fit the cycle end date? Reconcile by closing / re-pointing / re-prioritizing as appropriate. Surface anything ambiguous as a memo for operator review.`,
            category: 'plan_resync',
            target: { type: 'json_file', scope: `dashboard/public/data/bus/${BU}/tasks.json`, executor: `${BU}-stewart` },
            estimated_minutes: 45,
            risk_level: 'low',
            reversibility: 'high',
            source: 'planning_view_edit_resync',
          }),
        });
        const rjson = await resyncResp.json().catch(() => ({}));
        if (!resyncResp.ok || !rjson.ok) throw new Error(`Edit saved, but resync task failed: ${rjson.message || resyncResp.status}`);
      }
      close();
      onChange();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = `✗ ${(e.message || 'failed').slice(0, 80)}`;
    }
  });
}
