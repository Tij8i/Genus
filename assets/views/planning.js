// Planning view — locked-in plan, its initiatives, the commands you run on it.
//
// Sub-tabs: Active / Backlog / Retrospective (locked in decision 9 of the
// migration plan: Backlog as a Planning sub-tab).
//
// Active sub-tab layout (locked in decision 7 — compact rows + Initiative
// detail overlay, and decision 8 — Roadmap timeline at top):
//   1. Roadmap timeline (Gantt-style, cross-Initiative)
//   2. Active plan summary card
//   3. Compact Initiative rows (click → opens detail overlay)
//
// Initiative detail overlay (per decision 7):
//   - milestone strip + per-milestone mark-done button
//   - hypothesis + success criterion
//   - linked tasks list
//   - close button

import { escapeHtml, ago, dateLabel, daysBetween, cycleTimeProgress, isoDay } from '../utils.js';

const BU = 'tuto';

// Module-level: which Initiative's detail is currently shown (null = none).
let openInitiativeId = null;
// Which sub-tab is active. Persisted in URL hash query param.
let activeSubTab = 'active';

export function renderPlanning(ctx, { onChange }) {
  // Read sub-tab from URL: #planning?tab=backlog
  const hashParts = (window.location.hash || '').split('?');
  if (hashParts[1]) {
    const params = new URLSearchParams(hashParts[1]);
    const tab = params.get('tab');
    if (['active', 'backlog', 'retrospective'].includes(tab)) activeSubTab = tab;
  }

  const root = document.getElementById('route-planning');
  root.innerHTML = `
    <nav class="subtab-nav">
      ${['active', 'backlog', 'retrospective'].map(tab => `
        <button type="button" class="subtab-link ${activeSubTab === tab ? 'current' : ''}" data-subtab="${tab}">
          ${tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      `).join('')}
    </nav>
    <div id="planning-subtab-body"></div>
    <div id="initiative-detail-host"></div>
  `;

  // Wire sub-tab clicks
  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      const baseHash = (window.location.hash || '#planning').split('?')[0];
      window.location.hash = `${baseHash}?tab=${activeSubTab}`;
      renderPlanning(ctx, { onChange });
    });
  });

  // Render sub-tab body
  const body = document.getElementById('planning-subtab-body');
  if (activeSubTab === 'active') body.innerHTML = renderActiveSubTab(ctx);
  else if (activeSubTab === 'backlog') body.innerHTML = renderBacklogSubTab(ctx);
  else if (activeSubTab === 'retrospective') body.innerHTML = renderRetrospectiveSubTab(ctx);

  // Wire Initiative-row click → open detail overlay
  body.querySelectorAll('.init-row[data-init-id]').forEach(row => {
    row.addEventListener('click', () => {
      openInitiativeId = row.dataset.initId;
      renderInitiativeDetailOverlay(ctx, onChange);
    });
  });

  // If an initiative was already open (e.g., re-render after action), keep it open
  if (openInitiativeId) renderInitiativeDetailOverlay(ctx, onChange);
}

// ============ Sub-tab: Active ============

function renderActiveSubTab(ctx) {
  const activePlan = ctx.plans.find(p => p.status === 'active');
  const planInits = activePlan
    ? (activePlan.initiative_ids || []).map(iid => ctx.initiatives.find(i => i.id === iid)).filter(Boolean)
    : [];

  return `
    ${renderTimeline(ctx, planInits)}
    ${renderActivePlanCard(activePlan, planInits)}
    ${renderInitiativeRowsCard(planInits, ctx)}
  `;
}

function renderTimeline(ctx, planInits) {
  // Cross-Initiative Gantt — bars span started_at → target_close_date.
  // Includes overdue marker + today line. Skipped if no plan + no initiatives.
  const active = planInits.filter(i =>
    !['completed', 'discarded', 'abandoned'].includes((i.status || '').toLowerCase())
  );
  if (!active.length) return '';

  const todayISO = new Date().toISOString().slice(0, 10);
  const startsArr = active.map(i => isoDay(i.started_at || i.created_at) || todayISO);
  const endsArr = active.map(i => isoDay(i.target_close_date || i.closed_at) || todayISO);
  const rangeStart = startsArr.concat([todayISO]).sort()[0];
  const rangeEnd = endsArr.concat([todayISO]).sort().slice(-1)[0];
  const startTs = new Date(rangeStart + 'T00:00:00Z').getTime();
  const endTs = new Date(rangeEnd + 'T00:00:00Z').getTime();
  const todayTs = new Date(todayISO + 'T00:00:00Z').getTime();
  const span = Math.max(1, endTs - startTs);
  const pct = ts => Math.max(0, Math.min(100, ((ts - startTs) / span) * 100));

  // Weekly axis ticks
  const weekTicks = [];
  for (let cur = startTs; cur <= endTs; cur += 7 * 86400000) {
    weekTicks.push({ date: new Date(cur).toISOString().slice(0, 10), pct: pct(cur) });
  }
  if (weekTicks[weekTicks.length - 1]?.date !== rangeEnd) {
    weekTicks.push({ date: rangeEnd, pct: 100 });
  }
  const todayPct = pct(todayTs);

  // Sort initiatives by deadline
  const sorted = active.slice().sort((a, b) =>
    ((a.target_close_date || '9999-12-31').slice(0, 10)).localeCompare(
      (b.target_close_date || '9999-12-31').slice(0, 10),
    )
  );

  const rows = sorted.map(init => {
    const start = isoDay(init.started_at || init.created_at) || todayISO;
    const end = isoDay(init.target_close_date) || todayISO;
    const startPct = pct(new Date(start + 'T00:00:00Z').getTime());
    const endPctVal = pct(new Date(end + 'T00:00:00Z').getTime());
    const widthPct = Math.max(2, endPctVal - startPct);
    const status = (init.status || 'not_started').toLowerCase();
    const stateColor = initStateColor(status);
    const overdue = end < todayISO && !['completed', 'done'].includes(status);

    // Milestone ticks — evenly spaced (real per-milestone dates is v2)
    const milestones = init.milestones || [];
    const firstPendingIdx = milestones.findIndex(m => (m.status || 'pending').toLowerCase() !== 'done');
    const ticks = milestones.map((ms, idx) => {
      const tickPos = milestones.length === 1 ? 50 : (idx / (milestones.length - 1)) * 100;
      const msState = (ms.status || 'pending').toLowerCase();
      let tickClass = 'tl2-tick-waiting';
      if (msState === 'done') tickClass = 'tl2-tick-done';
      else if (firstPendingIdx === idx) tickClass = 'tl2-tick-current';
      const critClass = (ms.criticality || '').toLowerCase() === 'critical' ? ' tl2-tick-critical' : '';
      return `<div class="tl2-tick ${tickClass}${critClass}" style="left:${tickPos.toFixed(1)}%" title="${escapeHtml(ms.name)} (${ms.criticality || 'tactical'} · ${msState})"></div>`;
    }).join('');

    return `
      <div class="tl2-row">
        <div class="tl2-label">
          <div class="tl2-title">${escapeHtml(init.title)}</div>
          <div class="tl2-meta mono">${escapeHtml(init.id)}${overdue ? ' · <span class="tl2-overdue">OVERDUE</span>' : ''}</div>
        </div>
        <div class="tl2-track">
          <div class="tl2-bar tl2-bar-${stateColor}${overdue ? ' tl2-bar-overdue' : ''}" style="left:${startPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%" title="${escapeHtml(start)} → ${escapeHtml(end)} · ${escapeHtml(status)}">
            ${ticks}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Initiative timeline</span></div>
        <span class="muted-emph">${sorted.length} active · ${rangeStart} → ${rangeEnd}</span>
      </div>
      <p class="card-sub">Bars span start → target close. Ticks inside = milestones (green=done, accent=current, faint=waiting; red ring=critical). Vertical line = today.</p>
      <div class="tl2-grid">
        <div class="tl2-axis">
          ${weekTicks.map(t => `
            <div class="tl2-axis-tick" style="left:${t.pct.toFixed(1)}%">
              <div class="tl2-axis-tick-line"></div>
              <div class="tl2-axis-tick-label mono">${escapeHtml(t.date.slice(5))}</div>
            </div>
          `).join('')}
          <div class="tl2-today-line" style="left:${todayPct.toFixed(1)}%" title="today · ${todayISO}"></div>
        </div>
        ${rows}
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
    </div>
  `;
}

function renderInitiativeRowsCard(planInits, ctx) {
  if (!planInits.length) {
    return `
      <div class="card">
        <div class="card-title">Initiatives in this plan</div>
        <p class="card-sub">None yet. Add Initiatives via the planning workflow.</p>
      </div>
    `;
  }
  // Sort by status (in_progress first, then scoping, etc.) then by target_close_date
  const order = { in_progress: 1, review: 2, scoping: 3, blocked: 4, not_started: 5, completed: 6, abandoned: 7, discarded: 8 };
  const sorted = planInits.slice().sort((a, b) => {
    const sa = order[(a.status || '').toLowerCase()] || 9;
    const sb = order[(b.status || '').toLowerCase()] || 9;
    if (sa !== sb) return sa - sb;
    return ((a.target_close_date || '9999-12-31')).localeCompare((b.target_close_date || '9999-12-31'));
  });

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Initiatives in this plan</span></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint)">${planInits.length} locked</span>
      </div>
      <div class="init-row-list">
        ${sorted.map(init => renderInitiativeRow(init, ctx)).join('')}
      </div>
    </div>
  `;
}

function renderInitiativeRow(init, ctx) {
  const status = (init.status || 'not_started').toLowerCase();
  const stateColor = initStateColor(status);
  // Progress: % of milestones done (if milestones exist) else % of linked tasks done
  const ms = init.milestones || [];
  let pct = 0;
  let progressLabel = '—';
  if (ms.length > 0) {
    const doneMs = ms.filter(m => (m.status || '').toLowerCase() === 'done').length;
    pct = Math.round((doneMs / ms.length) * 100);
    progressLabel = `${doneMs}/${ms.length} ms`;
  } else {
    const linked = (ctx.tasks || []).filter(t => t.advances_initiative === init.id);
    if (linked.length > 0) {
      const doneT = linked.filter(t => (t.status || '').toLowerCase() === 'done').length;
      pct = Math.round((doneT / linked.length) * 100);
      progressLabel = `${doneT}/${linked.length} tasks`;
    }
  }
  const dlLabel = init.target_close_date ? dateLabel(init.target_close_date) : '';

  return `
    <div class="init-row" data-init-id="${escapeHtml(init.id)}" role="button" tabindex="0">
      <span class="init-row-id mono">${escapeHtml(init.id.replace('init-', ''))}</span>
      <div class="init-row-body">
        <div class="init-row-title">${escapeHtml(init.title)}</div>
        <div class="init-row-meta mono">${escapeHtml(dlLabel)}${progressLabel !== '—' ? ` · ${progressLabel}` : ''}</div>
      </div>
      <div class="init-row-bar-container">
        <div class="init-row-bar"><div class="init-row-bar-fill init-row-bar-fill-${stateColor}" style="width:${pct}%"></div></div>
      </div>
      <span class="init-state-chip init-state-chip-${stateColor}">${escapeHtml(status.replace(/_/g, ' '))}</span>
    </div>
  `;
}

// ============ Sub-tab: Backlog ============

function renderBacklogSubTab(ctx) {
  // Backlog = Initiatives NOT in the active plan + Initiatives with backlog_state="untriaged"
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

  // Wire close
  const close = () => {
    openInitiativeId = null;
    host.innerHTML = '';
  };
  document.getElementById('overlay-backdrop').addEventListener('click', close);
  document.getElementById('overlay-close').addEventListener('click', close);
  // Esc to close
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escClose);
    }
  });

  // Wire mark-done
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
          body: JSON.stringify({
            bu: BU, init_id: initId,
            action: 'mark_milestone_done',
            milestone_id: msId, actor: 'operator',
          }),
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
