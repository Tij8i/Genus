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
import { showAlert, showConfirm, showPrompt } from '../dialog.js';
import { openOverlay, closeOverlay } from '../overlay.js';
import { fetchSubstrateJson, substrateBase } from '../substrate-client.js';

// Legacy hardcode — planning was pinned to 'tuto' from the pre-multi-BU
// era. Now resolves the current BU dynamically. Function shape so nothing
// captures the value at module load.
function BU() {
  return new URLSearchParams(location.search).get('bu')
    || localStorage.getItem('genus.currentBu')
    || 'tuto';
}

// Operator-facing label. Uses the display_name resolved by app.js into the
// sidebar #bu-name element (e.g. "Acme Roastery" for the synthetic BU).
// Falls back to the raw internal id if the DOM isn't populated yet.
function buLabel() {
  const el = document.getElementById('bu-name');
  const t = el && el.textContent ? el.textContent.trim() : '';
  return (t && t !== '…' && t !== 'loading' && t !== BU()) ? t : BU();
}

let openInitiativeId = null;
let activeSubTab = 'active';
let editPlanOpen = false;
let cycleBusy = false;  // disables buttons while a plan-cycle mutation is in flight
let showArchive = false;  // Backlog kanban: toggle Promoted + Discarded columns (GEN-50)

// Sub-tab visibility. Backlog + Retrospective render functions stay (see
// below) but are hidden from nav per operator ask 2026-07-30. Restore either
// by adding its name back to VISIBLE_SUBTABS.
const VISIBLE_SUBTABS = ['active'];

export function renderPlanning(ctx, { onChange }) {
  // Read sub-tab from URL query (#planning?tab=backlog). Router strips the
  // query before validating, so this is safe. Only honor tabs still visible.
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const tab = params.get('tab');
  if (VISIBLE_SUBTABS.includes(tab)) activeSubTab = tab;
  else if (!VISIBLE_SUBTABS.includes(activeSubTab)) activeSubTab = VISIBLE_SUBTABS[0];

  const root = (document.getElementById('subtab-host') || document.getElementById('route-planning'));
  const showSubtabNav = VISIBLE_SUBTABS.length > 1;
  root.innerHTML = `
    <div id="plan-proposals-banner"></div>
    <div class="planning-page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;">
      ${showSubtabNav ? `
        <nav class="subtab-nav" style="margin:0;">
          ${VISIBLE_SUBTABS.map(t => `
            <button type="button" class="subtab-link ${activeSubTab === t ? 'current' : ''}" data-subtab="${t}">
              ${t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          `).join('')}
        </nav>
      ` : `<div></div>`}
      <button type="button" id="new-plan-btn" class="plan-cycle-btn plan-cycle-btn-primary">+ New plan</button>
    </div>
    <div id="planning-subtab-body"></div>
    <div id="initiative-detail-host"></div>
  `;

  // Recovery Step 1: async-fetch plan_proposals.json + render banner if any proposals await picking.
  checkAndRenderProposalsBanner(onChange);

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      // Set query param (router treats #planning?tab=X as route 'planning')
      window.location.hash = `#planning?tab=${activeSubTab}`;
      renderPlanning(ctx, { onChange });
    });
  });

  const newPlanBtn = document.getElementById('new-plan-btn');
  if (newPlanBtn) newPlanBtn.addEventListener('click', () => openNewPlanOverlay(ctx, onChange));

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
  const drafts = (ctx.plans || []).filter(p => p.status === 'draft');
  const queued = (ctx.plans || [])
    .filter(p => p.status === 'queued')
    .sort((a, b) => (a.queued_at || a.created_at || '').localeCompare(b.queued_at || b.created_at || ''));
  return `
    ${renderActivePlanCard(activePlan, planInits)}
    ${renderQueuedList(queued, activePlan)}
    ${renderDraftsList(drafts, ctx, activePlan)}
    ${renderCoreKpisStrip(ctx)}
    ${renderGroupedTimeline(ctx, activePlan, planInits)}
  `;
}

function renderQueuedList(queued, activePlan) {
  if (!queued || queued.length === 0) return '';
  return `
    <div class="card" style="margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div class="mono" style="font-size:11px;color:var(--text-faint);letter-spacing:.12em;text-transform:uppercase;">Queued</div>
          <div style="font-size:13px;color:var(--text-faint);">${queued.length} plan${queued.length === 1 ? '' : 's'} waiting${activePlan ? ` for "${escapeHtml((activePlan.title || activePlan.id).slice(0, 40))}" to finish` : ''}.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${queued.map((q, i) => {
          const goalCount = (q.goal_ids || []).length;
          const initCount = (q.initiative_ids || []).length;
          const period = `${q.period_start || '?'} → ${q.period_target_end || 'open'}`;
          const pos = queued.length > 1 ? ` · #${i + 1} in queue` : '';
          return `
            <div class="draft-row" data-draft-id="${escapeHtml(q.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:14px;color:var(--text);">${escapeHtml(q.title || 'Untitled')}</div>
                <div class="mono" style="font-size:11px;color:var(--text-faint);margin-top:2px;">${escapeHtml(period)} · ${goalCount} goal${goalCount === 1 ? '' : 's'} · ${initCount} initiative${initCount === 1 ? '' : 's'}${pos} · queued ${agoFromISO(q.queued_at)}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="plan-cycle-btn" data-draft-action="unqueue" data-draft-id="${escapeHtml(q.id)}" title="Move back to Drafts so it won't auto-activate next.">Unqueue</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
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

// Drafts list (2026-08-11). Shows every plan with status=draft. Each row:
// title · period · goals count · initiatives count · Finalize (stub) · Discard.
// Finalize + Activate wire in follow-up PRs.
function renderDraftsList(drafts, ctx, activePlan) {
  if (!drafts || drafts.length === 0) return '';
  return `
    <div class="card" style="margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div class="mono" style="font-size:11px;color:var(--text-faint);letter-spacing:.12em;text-transform:uppercase;">Drafts</div>
          <div style="font-size:13px;color:var(--text-faint);">${drafts.length} plan${drafts.length === 1 ? '' : 's'} waiting to be finalized${activePlan ? ' + queued or activated' : ' + activated'}.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${drafts.map(d => renderDraftRow(d, ctx, activePlan)).join('')}
      </div>
    </div>
  `;
}

// TERMINAL_TASK_STATUSES + inFlightTaskFor: general in-flight detector
// per [[feedback_button_intermediate_state]]. Read substrate to know if
// a matching runtime task is still in flight — never rely on local state.
const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled']);

function inFlightTaskFor(ctx, predicate) {
  return (ctx.tasks || []).find(t => predicate(t) && !TERMINAL_TASK_STATUSES.has(t.status));
}

function agoFromISO(iso) {
  if (!iso) return '';
  try {
    const then = new Date(iso).getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  } catch { return ''; }
}

function renderDraftRow(draft, ctx, activePlan) {
  const goalCount = (draft.goal_ids || []).length;
  const initCount = (draft.initiative_ids || []).length;
  const period = `${draft.period_start || '?'} → ${draft.period_target_end || 'open'}`;
  const finalized = !!draft.finalized_at;

  // In-flight detection: is a planning_finalize task for THIS draft still running?
  const inFlightFinalize = !finalized && inFlightTaskFor(ctx, t =>
    t.advances_plan === draft.id && t.category === 'planning_finalize'
  );

  let primaryBtn;
  if (finalized) {
    // Feature (d): if there's already an active plan, the button queues; otherwise it activates now.
    const activeTitle = activePlan ? (activePlan.title || activePlan.id) : '';
    const btnLabel = activePlan
      ? `Queue after «${escapeHtml(activeTitle.length > 22 ? activeTitle.slice(0, 20) + '…' : activeTitle)}»`
      : 'Activate now';
    const btnTitle = activePlan
      ? `Waits behind "${escapeHtml(activeTitle)}"; auto-activates when that plan is marked complete.`
      : 'No active plan — this becomes the active plan immediately.';
    primaryBtn = `<button type="button" class="plan-cycle-btn plan-cycle-btn-primary" data-draft-action="activate" data-draft-id="${escapeHtml(draft.id)}" title="${btnTitle}">${btnLabel}</button>`;
  } else if (inFlightFinalize) {
    const started = inFlightFinalize.proposed_at || inFlightFinalize.created_at;
    const label = `Finalizing… ${agoFromISO(started)}`.trim();
    primaryBtn = `<button type="button" class="plan-cycle-btn" disabled title="Stewart is finalizing this draft. Refresh in a few minutes.">${escapeHtml(label)}</button>`;
  } else {
    primaryBtn = `<button type="button" class="plan-cycle-btn" data-draft-action="finalize" data-draft-id="${escapeHtml(draft.id)}">Finalize with Stewart</button>`;
  }

  const finalizedNote = finalized ? ' · finalized' : (inFlightFinalize ? ' · finalizing' : '');

  return `
    <div class="draft-row" data-draft-id="${escapeHtml(draft.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;color:var(--text);">${escapeHtml(draft.title || 'Untitled draft')}</div>
        <div class="mono" style="font-size:11px;color:var(--text-faint);margin-top:2px;">${escapeHtml(period)} · ${goalCount} goal${goalCount === 1 ? '' : 's'} · ${initCount} initiative${initCount === 1 ? '' : 's'}${finalizedNote}</div>
      </div>
      <div style="display:flex;gap:6px;">
        ${primaryBtn}
        <button type="button" class="plan-cycle-btn" data-draft-action="discard" data-draft-id="${escapeHtml(draft.id)}">Discard</button>
      </div>
    </div>
  `;
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
        discardedReason = await showPrompt('Reason for discarding (optional):') || null;
      }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const resp = await fetch('/api/update-backlog-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: BU(),
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
        await showAlert(`Failed: ${e.message}`);
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
  // Recovery Step 3: gate mark-done on task completion. Tasks that advance this
  // milestone must all be terminal (done/closed/completed/cancelled/rejected).
  const TERMINAL_MS_TASK = new Set(['done', 'closed', 'completed', 'cancelled', 'rejected']);
  const openTasksForMs = currentMs
    ? (ctx.tasks || []).filter(t =>
        t.advances_milestone === currentMs.id && !TERMINAL_MS_TASK.has((t.status || '').toLowerCase())
      )
    : [];
  const totalTasksForMs = currentMs
    ? (ctx.tasks || []).filter(t => t.advances_milestone === currentMs.id).length
    : 0;
  const canMarkMsDone = currentMs && openTasksForMs.length === 0;

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
              <button type="button" class="overlay-mark-done-btn"
                      data-init-id="${escapeHtml(init.id)}"
                      data-ms-id="${escapeHtml(currentMs.id)}"
                      ${canMarkMsDone ? '' : 'disabled'}
                      title="${canMarkMsDone
                        ? `Mark this milestone done — the next becomes current`
                        : `${openTasksForMs.length} of ${totalTasksForMs} linked task(s) still open. Close them first, or shift-click to force.`}">
                ✓ Mark «${escapeHtml(currentMs.name || currentMs.title || currentMs.id)}» done
              </button>
              ${canMarkMsDone
                ? (totalTasksForMs > 0
                    ? `<span class="overlay-mark-hint">All ${totalTasksForMs} linked task(s) closed.</span>`
                    : `<span class="overlay-mark-hint">No linked tasks — closing manually.</span>`)
                : `<span class="overlay-mark-hint overlay-mark-hint-blocked">${openTasksForMs.length} of ${totalTasksForMs} linked task(s) still open · shift-click to force</span>`}
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
    // Force-override binding: shift-click bypasses the disabled state AND sends
    // force=true to the endpoint. Lets operator retroactively close milestones
    // whose tasks were settled offline.
    markBtn.addEventListener('click', async (e) => {
      const force = e.shiftKey === true;
      if (markBtn.disabled && !force) return;
      const initId = markBtn.dataset.initId;
      const msId = markBtn.dataset.msId;
      const msName = currentMs.name || currentMs.title || currentMs.id;
      const prompt = force
        ? `Force-close milestone «${msName}» despite ${openTasksForMs.length} open task(s)?`
        : `Mark milestone «${msName}» done? The next milestone becomes current.`;
      if (!await showConfirm(prompt)) return;
      markBtn.disabled = true;
      const origText = markBtn.textContent;
      markBtn.textContent = force ? 'force-marking…' : 'marking…';
      try {
        const resp = await fetch('/api/update-initiative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: BU(),
            init_id: initId,
            action: 'mark_milestone_done',
            milestone_id: msId,
            actor: 'operator',
            ...(force ? { force: true } : {}),
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        onChange();
      } catch (err) {
        markBtn.disabled = false;
        markBtn.textContent = `✗ ${err.message || err}`;
        setTimeout(() => { markBtn.textContent = origText; }, 4000);
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
          body: JSON.stringify({ bu: BU(), init_id: init.id, action: 'edit_gateway', gateway_id: gatewayId, edits, actor: 'operator' }),
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
      const body = { bu: BU(), init_id: init.id, action: 'set_status', actor: 'operator' };
      let successPhrase;

      if (action === 'approve') {
        if (!await showConfirm('Approve this gateway list? Initiative moves to in_progress and task emission unblocks at the next heartbeat.')) return;
        body.status = 'in_progress';
        body.rationale = 'operator approved gateway list (GEN-40 panel)';
        successPhrase = '✓ approved';
      } else if (action === 'reject') {
        const reason = await showPrompt('Reject — send Initiative back to scoping. Reason (Stewart re-proposes on next heartbeat):', '');
        if (reason === null) return;
        const trimmed = reason.trim();
        if (!trimmed) { await showAlert('A rejection reason is required so Stewart knows how to re-propose.'); return; }
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
  if (controls) {
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
  // Draft rows (2026-08-11): Finalize / Activate / Discard / Unqueue buttons.
  scope.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.draftAction;
      const draftId = btn.dataset.draftId;
      if (action === 'discard') return onDiscardDraft(draftId, btn, ctx, onChange);
      if (action === 'finalize') return onFinalizeDraft(draftId, btn, ctx, onChange);
      if (action === 'activate') return onActivateDraft(draftId, btn, ctx, onChange);
      if (action === 'unqueue') return onUnqueueDraft(draftId, btn, ctx, onChange);
    });
  });
}

async function onUnqueueDraft(draftId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === draftId);
  if (!plan) return;
  if (!await showConfirm(`Remove "${plan.title || draftId}" from the queue?\n\nIt goes back to Drafts. You can re-activate it later.`)) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'unqueuing…';
  try {
    const resp = await fetch('/api/update-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), plan_id: draftId, action: 'unqueue', actor: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    if (onChange) onChange();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    await showAlert(`Unqueue failed: ${e.message || 'unknown'}`);
  }
}

async function onActivateDraft(draftId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === draftId);
  if (!plan) return;
  const activeNow = (ctx.plans || []).find(p => p.status === 'active');
  // Feature (d): the button either queues (active exists) or activates immediately.
  const msg = activeNow
    ? `Queue "${plan.title}" after "${activeNow.title}"?\n\nIt sits in the Queued list until you mark "${activeNow.title}" complete, then auto-activates. You can unqueue any time.`
    : `Activate "${plan.title}"?\n\nNo other plan is active. This becomes the active plan for ${buLabel()} immediately.`;
  if (!await showConfirm(msg)) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = activeNow ? 'queuing…' : 'activating…';
  try {
    const resp = await fetch('/api/update-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), plan_id: draftId, action: 'activate', actor: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    if (onChange) onChange();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    await showAlert(`${activeNow ? 'Queue' : 'Activate'} failed: ${e.message || 'unknown'}`);
  }
}

async function onFinalizeDraft(draftId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === draftId);
  if (!plan) return;
  if (!await showConfirm(`Ask the Strategy Stewart of ${buLabel()} to finalize draft "${plan.title || draftId}"?\n\nStewart adds milestones under each initiative + proposes tasks that advance them. Takes ~3-5 min. When done, this draft shows an [Activate] button instead of [Finalize].`)) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'queuing…';
  try {
    const resp = await fetch('/api/finalize-plan-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), plan_id: draftId }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    btn.textContent = '✓ queued';
    setTimeout(() => { if (onChange) onChange(); }, 800);
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    await showAlert(`Finalize failed: ${e.message || 'unknown'}`);
  }
}

async function onDiscardDraft(draftId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === draftId);
  if (!plan) return;
  if (!await showConfirm(`Discard draft "${plan.title || draftId}"?\n\nGoals + initiatives created for this draft stay in substrate (backlog_state=promoted_to_plan). The plan itself flips to status=discarded.`)) return;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'discarding…';
  try {
    const resp = await fetch('/api/update-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), plan_id: draftId, action: 'discard', closing_notes: 'Discarded from Drafts list', actor: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    if (onChange) onChange();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    await showAlert(`Discard failed: ${e.message || 'unknown'}`);
  }
}

async function onCompleteCycle(planId, btn, ctx, onChange) {
  const plan = (ctx.plans || []).find(p => p.id === planId);
  if (!plan) return;
  const inits = (plan.initiative_ids || [])
    .map(iid => (ctx.initiatives || []).find(i => i.id === iid))
    .filter(Boolean);
  const stillOpen = inits.filter(i => !['completed', 'abandoned', 'discarded'].includes((i.status || '').toLowerCase())).length;
  // Feature (d): warn if a queued plan will auto-promote.
  const queuedCount = (ctx.plans || []).filter(p => p.status === 'queued').length;
  const queueLine = queuedCount > 0 ? `\n\n${queuedCount} queued plan${queuedCount === 1 ? '' : 's'} in line — the earliest will auto-activate.` : '';
  const msg = stillOpen > 0
    ? `Mark cycle "${plan.title}" complete?\n\n${stillOpen} of ${inits.length} initiatives are still open — they will be auto-archived as completed. A retrospective stub will be written.${queueLine}\n\nThis is reversible only by editing data files directly.`
    : `Mark cycle "${plan.title}" complete?\n\nA retrospective stub will be written.${queueLine}`;
  const notes = await showPrompt(msg + '\n\nOptional closing note (blank → default stub):', '');
  if (notes === null) return;  // cancelled
  let promotedId = null;
  await runCycleAction(btn, async () => {
    const resp = await fetch('/api/update-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), plan_id: planId, action: 'complete_cycle', closing_notes: notes.trim() || undefined, actor: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    promotedId = json.auto_promoted_plan_id || null;
    return json;
  }, onChange);
  if (promotedId) {
    await showAlert(`Cycle closed. Plan "${promotedId}" was queued behind it — it's now the active plan.`);
  }
}

async function onRequestProposals(planId, btn, ctx, onChange) {
  // Recovery Step 1 (2026-07-31): rewired to /api/request-plan-proposals.
  // Previously used /api/file-stewart-task with executor=`${BU()}-stewart` — a name
  // that doesn't resolve to any real agent, so it silently fell back to genus-agent.
  // The new endpoint resolves the Strategy Stewart from agent_bindings.json.
  if (!await showConfirm(`Ask the Strategy Stewart of ${buLabel()} to draft 3 alternative plan proposals?\n\nThe Stewart will read the current plan + backlog + memos, then produce 3 genuinely different plan shapes. You pick ONE to promote into a draft plan.`)) return;
  await runCycleAction(btn, async () => {
    const resp = await fetch('/api/request-plan-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU() }),
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
        body: JSON.stringify({ bu: BU(), plan_id: plan.id, action: 'edit_plan', edits, actor: 'operator' }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);

      // Structural change → offer Stewart resync
      const structural = edits.initiative_ids || edits.period_target_end;
      if (structural && await showConfirm('These edits change the plan structure — should the Stewart re-evaluate existing tasks against the new structure?\n\nIf yes, a Stewart task will be filed to re-sync open tasks against the edited plan at the next heartbeat.')) {
        const resyncResp = await fetch('/api/file-stewart-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bu: BU(),
            title: `Re-sync open tasks against edited plan ${plan.id}`,
            description: `Operator edited the active plan ${plan.id} structure (${Object.keys(edits).join(', ')}). Re-evaluate all open / awaiting_approval / approved tasks: do any now point at archived initiatives, contradict the new initiative roster, or no longer fit the cycle end date? Reconcile by closing / re-pointing / re-prioritizing as appropriate. Surface anything ambiguous as a memo for operator review.`,
            category: 'plan_resync',
            target: { type: 'json_file', scope: `dashboard/public/data/bus/${BU()}/tasks.json`, executor: `${BU()}-stewart` },
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

// ============ + New plan overlay (recovery A2 restore, 2026-07-30) ============
// Opens a modal for creating a new active Plan. Writes to bus/<bu>/plans.json
// via POST /api/create-plan. Per operator ask: one active plan at a time —
// endpoint refuses if an active plan already exists (returns 409). User
// completes/discards current via Plan card cycle controls first.
//
// Under the plan, user adds Initiatives via the plan-edit overlay. Under each
// Initiative, tasks + milestones are agent-drafted (via the Ask Stewart
// button on the Initiative detail overlay).

// Rich draft-plan overlay (2026-07-31 Step 1 revamp). Operator fills in
// title + period + rationale + inline goals + inline initiatives. Saves as
// status=draft. Drafts show in the Drafts list on the Planning view; agent
// finalizes them (adds tasks/milestones/gateways) then operator activates.

const NP_FIELD_STYLE = 'padding:10px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--surface);color:var(--text);';
const NP_LABEL_STYLE = 'font-size:12px;font-weight:600;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em;';
const NP_SUBLABEL_STYLE = 'font-size:11px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;font-weight:600;';

function openNewPlanOverlay(ctx, onChange) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultEnd = (() => {
    const d = new Date(); d.setDate(d.getDate() + 56); return d.toISOString().slice(0, 10);
  })();

  // In-memory arrays for the dynamic goal + initiative rows. Ids are local
  // (goal_1, goal_2 …) — the endpoint reifies with real substrate ids.
  const draft = { goals: [], initiatives: [] };
  let nextGoalIdx = 1, nextInitIdx = 1;

  openOverlay({
    title: 'New plan (draft)',
    subtitle: 'Draft your plan here. It saves as a draft — agent finalizes it into a runnable plan (adds tasks + milestones), then you activate.',
    bodyHtml: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label for="np-title" style="${NP_LABEL_STYLE}">Title</label>
          <input id="np-title" type="text" placeholder="e.g. Launch the revised MVP by end of August" style="${NP_FIELD_STYLE}" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label for="np-start" style="${NP_LABEL_STYLE}">Period start</label>
            <input id="np-start" type="date" value="${today}" style="${NP_FIELD_STYLE}" />
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label for="np-end" style="${NP_LABEL_STYLE}">Target end date</label>
            <input id="np-end" type="date" value="${defaultEnd}" style="${NP_FIELD_STYLE}" />
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label for="np-rationale" style="${NP_LABEL_STYLE}">Rationale <span style="text-transform:none;font-weight:400;">(optional)</span></label>
          <textarea id="np-rationale" placeholder="Why now? What outcome makes this cycle successful?" style="${NP_FIELD_STYLE}min-height:70px;resize:vertical;font-family:inherit;"></textarea>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);padding-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="${NP_SUBLABEL_STYLE}">Goals</span>
            <button type="button" id="np-add-goal" class="plan-cycle-btn" style="padding:4px 10px;font-size:12px;">+ Add goal</button>
          </div>
          <div id="np-goals-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border);padding-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="${NP_SUBLABEL_STYLE}">Initiatives</span>
            <button type="button" id="np-add-init" class="plan-cycle-btn" style="padding:4px 10px;font-size:12px;">+ Add initiative</button>
          </div>
          <div id="np-inits-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        </div>

        <div class="new-plan-status mono" style="font-size:12px;min-height:16px;"></div>
      </div>
    `,
    footerHtml: `
      <button type="button" class="plan-cycle-btn" id="np-cancel">Cancel</button>
      <button type="button" class="plan-cycle-btn plan-cycle-btn-primary" id="np-save">Save draft</button>
    `,
  });

  const goalsList = document.getElementById('np-goals-list');
  const initsList = document.getElementById('np-inits-list');

  function renderGoalRow(goal) {
    const row = document.createElement('div');
    row.dataset.goalId = goal._id;
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);';
    row.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="text" placeholder="Goal title (e.g. Get 100 signups)" value="${escapeHtml(goal.title || '')}" data-field="title" style="${NP_FIELD_STYLE}flex:1;" />
        <button type="button" class="plan-cycle-btn" data-remove-goal="${goal._id}" style="padding:6px 10px;font-size:12px;">✕</button>
      </div>
      <textarea placeholder="Description (optional)" data-field="description" style="${NP_FIELD_STYLE}min-height:44px;resize:vertical;font-family:inherit;font-size:13px;">${escapeHtml(goal.description || '')}</textarea>
    `;
    row.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => { goal[el.dataset.field] = el.value; refreshInitiativeGoalPickers(); });
    });
    row.querySelector('[data-remove-goal]').addEventListener('click', () => {
      draft.goals = draft.goals.filter(g => g._id !== goal._id);
      row.remove(); refreshInitiativeGoalPickers();
    });
    goalsList.appendChild(row);
  }

  function goalOptionsHtml(selectedGoalId) {
    const opts = ['<option value="">— unassigned —</option>']
      .concat(draft.goals.map((g, i) => `<option value="${g._id}"${g._id === selectedGoalId ? ' selected' : ''}>${escapeHtml(g.title || `Goal ${i + 1}`)}</option>`));
    return opts.join('');
  }

  function renderInitRow(init) {
    const row = document.createElement('div');
    row.dataset.initId = init._id;
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);';
    row.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="text" placeholder="Initiative title" value="${escapeHtml(init.title || '')}" data-field="title" style="${NP_FIELD_STYLE}flex:1;" />
        <select data-field="goal_id" data-select-goal="${init._id}" style="${NP_FIELD_STYLE}max-width:160px;">${goalOptionsHtml(init.goal_id)}</select>
        <button type="button" class="plan-cycle-btn" data-remove-init="${init._id}" style="padding:6px 10px;font-size:12px;">✕</button>
      </div>
      <input type="text" placeholder="Hypothesis (what we're testing)" value="${escapeHtml(init.active_hypothesis || '')}" data-field="active_hypothesis" style="${NP_FIELD_STYLE}font-size:13px;" />
      <input type="text" placeholder="Success criterion (measurable)" value="${escapeHtml(init.success_criterion || '')}" data-field="success_criterion" style="${NP_FIELD_STYLE}font-size:13px;" />
    `;
    row.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => { init[el.dataset.field] = el.value; });
      if (el.tagName === 'SELECT') el.addEventListener('change', () => { init[el.dataset.field] = el.value; });
    });
    row.querySelector('[data-remove-init]').addEventListener('click', () => {
      draft.initiatives = draft.initiatives.filter(x => x._id !== init._id);
      row.remove();
    });
    initsList.appendChild(row);
  }

  function refreshInitiativeGoalPickers() {
    initsList.querySelectorAll('[data-select-goal]').forEach(sel => {
      const initId = sel.dataset.selectGoal;
      const init = draft.initiatives.find(i => i._id === initId);
      sel.innerHTML = goalOptionsHtml(init?.goal_id);
    });
  }

  document.getElementById('np-add-goal').addEventListener('click', () => {
    const g = { _id: `g${nextGoalIdx++}`, title: '', description: '' };
    draft.goals.push(g); renderGoalRow(g);
  });
  document.getElementById('np-add-init').addEventListener('click', () => {
    const i = { _id: `i${nextInitIdx++}`, title: '', active_hypothesis: '', success_criterion: '', goal_id: '' };
    draft.initiatives.push(i); renderInitRow(i);
  });

  document.getElementById('np-cancel').addEventListener('click', () => closeOverlay());

  const save = async () => {
    const title = document.getElementById('np-title').value.trim();
    const rationale = document.getElementById('np-rationale').value.trim();
    const period_start = document.getElementById('np-start').value;
    const period_target_end = document.getElementById('np-end').value;
    const statusEl = document.querySelector('.new-plan-status');
    if (!title) { statusEl.textContent = 'title required'; statusEl.style.color = 'var(--red)'; return; }
    // Build payload — strip local _id, resolve goal_id via index reference
    const goalsOut = draft.goals.map(g => ({ title: g.title.trim(), description: (g.description || '').trim() })).filter(g => g.title);
    const goalIndexById = {};
    draft.goals.forEach((g, i) => { goalIndexById[g._id] = i; });
    const initsOut = draft.initiatives.map(x => ({
      title: (x.title || '').trim(),
      active_hypothesis: (x.active_hypothesis || '').trim(),
      success_criterion: (x.success_criterion || '').trim(),
      goal_index: x.goal_id && goalIndexById[x.goal_id] != null ? goalIndexById[x.goal_id] : null,
    })).filter(x => x.title);

    statusEl.textContent = 'saving…'; statusEl.style.color = 'var(--text-faint)';
    const saveBtn = document.getElementById('np-save');
    saveBtn.disabled = true;
    try {
      const resp = await fetch('/api/create-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu: BU(), title, rationale, period_start, period_target_end, goals: goalsOut, initiatives: initsOut }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
      statusEl.textContent = `✓ saved draft ${json.plan.id} (${(json.goal_ids || []).length} goals · ${(json.initiative_ids || []).length} initiatives)`;
      statusEl.style.color = 'var(--green-fg, #12b76a)';
      setTimeout(() => { closeOverlay(); if (onChange) onChange(); }, 900);
    } catch (e) {
      statusEl.textContent = `✗ ${e.message || 'failed'}`;
      statusEl.style.color = 'var(--red)';
      saveBtn.disabled = false;
    }
  };
  document.getElementById('np-save').addEventListener('click', save);

  const titleInput = document.getElementById('np-title');
  if (titleInput) setTimeout(() => titleInput.focus(), 50);
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('np-rationale').focus(); }
  });
}

// ============ Plan-proposals banner + picker (Recovery Step 1, 2026-07-31) ============
// When the Strategy Stewart has drafted proposals in response to
// /api/request-plan-proposals, they land in bus/<bu>/plan_proposals.json with
// status='proposed'. This block detects them + surfaces a banner at the top of
// the Planning view. Click → picker modal → operator selects one → posts to
// /api/select-plan-proposal which promotes the choice into a draft plan.

async function checkAndRenderProposalsBanner(onChange) {
  const host = document.getElementById('plan-proposals-banner');
  if (!host) return;
  // Fetch via the /api/substrate proxy (substrate lives cross-repo in
  // Tij8i/Orchestrator; a plain fetch to /data/... would 404). fetchSubstrateJson
  // returns the fallback [] on 404 so we don't surface as a boot error.
  let data = [];
  try {
    data = await fetchSubstrateJson(`${substrateBase(BU())}/plan_proposals.json`, []);
  } catch { host.innerHTML = ''; return; }
  if (!Array.isArray(data)) { host.innerHTML = ''; return; }
  const proposals = data.filter(p => p && p.status === 'proposed');
  if (proposals.length === 0) { host.innerHTML = ''; return; }

  // Group by proposal_set_id — show a single banner per set.
  const bySet = {};
  proposals.forEach(p => {
    const sid = p.proposal_set_id || p.id;
    (bySet[sid] = bySet[sid] || []).push(p);
  });
  const sets = Object.entries(bySet).sort((a, b) => {
    const ta = a[1][0]?.proposed_at || ''; const tb = b[1][0]?.proposed_at || '';
    return tb.localeCompare(ta);
  });
  const [latestSetId, latestSet] = sets[0];
  host.innerHTML = `
    <div style="background:linear-gradient(135deg,#fef8dc,#fff);border:2px solid #af7e02;border-radius:10px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div>
        <div style="font-weight:600;color:#1a1a1a;font-size:14px;margin-bottom:2px;">Stewart has drafted ${latestSet.length} plan ${latestSet.length === 1 ? 'proposal' : 'proposals'}.</div>
        <div style="font-size:12px;color:#6b7280;">Set <span class="mono">${escapeHtml(latestSetId)}</span> · proposed ${escapeHtml((latestSet[0]?.proposed_at || '').slice(0, 16))}</div>
      </div>
      <button type="button" id="review-proposals-btn" class="plan-cycle-btn plan-cycle-btn-primary">Review proposals</button>
    </div>
  `;
  const btn = document.getElementById('review-proposals-btn');
  if (btn) btn.addEventListener('click', () => openProposalsPickerOverlay(latestSet, onChange));
}

function openProposalsPickerOverlay(proposals, onChange) {
  const bodyHtml = `
    <div style="display:grid;grid-template-columns:repeat(${proposals.length}, 1fr);gap:14px;">
      ${proposals.map((p, idx) => `
        <div data-proposal-idx="${idx}" style="border:2px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fefefe;">
          <div>
            <div style="font-size:11px;color:var(--text-faint);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px;">Proposal ${idx + 1}</div>
            <div style="font-size:15px;font-weight:600;color:var(--text);">${escapeHtml(p.title || 'Untitled')}</div>
          </div>
          <div style="font-size:12px;color:var(--text-faint);">
            <div>${escapeHtml((p.period_start || '') + ' → ' + (p.period_target_end || ''))}</div>
            <div>${(p.proposed_goals || []).length} goals · ${(p.proposed_initiatives || []).length} initiatives</div>
          </div>
          ${p.rationale ? `<div style="font-size:13px;color:var(--text);border-left:3px solid #af7e02;padding-left:10px;">${escapeHtml(p.rationale)}</div>` : ''}
          ${p.reasoning ? `<details style="font-size:12px;color:var(--text-faint);"><summary style="cursor:pointer;font-weight:600;color:var(--text);">Reasoning</summary><div style="padding-top:6px;line-height:1.5;">${escapeHtml(p.reasoning)}</div></details>` : ''}
          <details style="font-size:12px;color:var(--text-faint);"><summary style="cursor:pointer;font-weight:600;color:var(--text);">Goals + initiatives</summary>
            <div style="padding-top:6px;">
              <div style="font-weight:600;color:var(--text);margin-bottom:2px;">Goals:</div>
              <ul style="margin:0 0 8px 18px;padding:0;">${(p.proposed_goals || []).map(g => `<li>${escapeHtml(g.title || '')}</li>`).join('') || '<li>—</li>'}</ul>
              <div style="font-weight:600;color:var(--text);margin-bottom:2px;">Initiatives:</div>
              <ul style="margin:0 0 4px 18px;padding:0;">${(p.proposed_initiatives || []).map(i => `<li>${escapeHtml(i.title || '')}</li>`).join('') || '<li>—</li>'}</ul>
            </div>
          </details>
          <button type="button" class="plan-cycle-btn plan-cycle-btn-primary" data-pick-id="${escapeHtml(p.id)}" style="margin-top:auto;">Pick this one</button>
        </div>
      `).join('')}
    </div>
    <div class="proposals-pick-status mono" style="font-size:12px;min-height:16px;margin-top:12px;text-align:center;"></div>
  `;

  openOverlay({
    title: 'Pick a plan',
    subtitle: `Stewart drafted ${proposals.length} alternative ${proposals.length === 1 ? 'plan' : 'plans'}. Picking one promotes it into a draft — activate via the plan card controls when ready.`,
    bodyHtml,
    footerHtml: `<button type="button" class="plan-cycle-btn" id="proposals-cancel">Cancel</button>`,
  });

  document.getElementById('proposals-cancel').addEventListener('click', () => closeOverlay());

  document.querySelectorAll('[data-pick-id]').forEach(pickBtn => {
    pickBtn.addEventListener('click', async () => {
      const proposalId = pickBtn.dataset.pickId;
      const status = document.querySelector('.proposals-pick-status');
      status.textContent = 'promoting…'; status.style.color = 'var(--text-faint)';
      document.querySelectorAll('[data-pick-id]').forEach(b => b.disabled = true);
      try {
        const resp = await fetch('/api/select-plan-proposal', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU(), proposal_id: proposalId }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        status.textContent = `✓ activated ${json.plan?.id || 'plan'} (${(json.goal_ids || []).length} goals · ${(json.initiative_ids || []).length} initiatives)`;
        status.style.color = 'var(--green-fg, #12b76a)';
        setTimeout(() => { closeOverlay(); if (onChange) onChange(); }, 900);
      } catch (e) {
        status.textContent = `✗ ${e.message || 'failed'}`;
        status.style.color = 'var(--red)';
        document.querySelectorAll('[data-pick-id]').forEach(b => b.disabled = false);
      }
    });
  });
}
