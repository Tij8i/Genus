// Inputs view — sub-tabs: Memos / Meetings / Suggestions.
//
// Per operator feedback 2026-06-19: the 3-column grid groups things visually
// but operator wants them as proper sub-tabs (one full-width column per tab)
// to reduce horizontal density and let each section breathe.

import { escapeHtml, ago, icon } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

const MEETING_SERVER = 'http://localhost:8765';
// Legacy hardcode — memos + meetings were pinned to 'tuto' from the pre-
// multi-BU era. Now resolves from the current BU dynamically. Using a getter
// so nothing calls this at module load (before localStorage is populated).
function BU() {
  return new URLSearchParams(location.search).get('bu')
    || localStorage.getItem('genus.currentBu')
    || 'tuto';
}

let activeSubTab = 'suggestions';  // default to the most-engaged surface

// Suggestion-decision queue state (module-level so it survives re-renders).
// stagedDecisions: card is hidden while we're persisting. failedDecisions: persist
// genuinely failed (not a 409 "already not pending"), card is restored, banner shown.
const stagedDecisions = new Map(); // task_id → 'approved' | 'rejected'
const failedDecisions = new Map(); // task_id → {decision, message, at}

// Meeting server liveness — set by probeMeetingServerBanner. Used to gate
// the chat input + Send button + new-meeting button (offline server = no chat).
let meetingServerUp = false;

// In-flight /meeting/new POSTs keyed by from_request_id. Prevents a flurry of
// clicks on the same Start-meeting → button from spawning duplicate meetings
// before the first POST returns and ctx.meetings is refreshed.
const inFlightMeetingStarts = new Set();

// Meeting-dismiss queue state — same vanish-on-action pattern as suggestion
// decisions above. Row is hidden the instant the operator clicks Dismiss; if
// the /meeting/close call fails the row is restored and a red banner appears.
const stagedMeetingDismissals = new Set(); // meeting_id
const failedMeetingDismissals = new Map(); // meeting_id → {message, at}

// Past-section close_reasons that are noise (housekeeping, not operator-driven).
// Hidden by default so duplicate-cleanup sweeps don't bury the meetings the
// operator actually closed; toggled via the "Show N hidden" link.
const HIDDEN_PAST_CLOSE_REASONS = new Set(['duplicate_cleanup', 'system_archive']);
let showHiddenPastMeetings = false;

export function renderInputs(ctx, { onChange }) {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const tab = params.get('tab');
  if (['memos', 'meetings', 'suggestions'].includes(tab)) activeSubTab = tab;

  const memos = ctx.memos || [];
  const meetings = ctx.meetings || [];
  const tasks = ctx.tasks || [];

  // Badges per sub-tab so operator sees counts at a glance
  const memosBadge = memos.filter(m => (m.status || '').toLowerCase() === 'unprocessed').length;
  const meetingsBadge = meetings.filter(m => m.status === 'requested_by_agent').length;
  const suggestionsBadge = tasks.filter(t => ['awaiting_approval', 'proposed'].includes((t.status || '').toLowerCase())).length;

  const root = (document.getElementById('subtab-host') || document.getElementById('route-inputs'));
  root.innerHTML = `
    <nav class="subtab-nav">
      ${renderSubTab('suggestions', 'Suggestions', suggestionsBadge)}
      ${renderSubTab('meetings', 'Meetings', meetingsBadge)}
      ${renderSubTab('memos', 'Memos', memosBadge)}
    </nav>
    <div id="inputs-subtab-body"></div>
  `;

  root.querySelectorAll('.subtab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubTab = btn.dataset.subtab;
      window.location.hash = `#inputs?tab=${activeSubTab}`;
      renderInputs(ctx, { onChange });
    });
  });

  const body = document.getElementById('inputs-subtab-body');
  if (activeSubTab === 'suggestions') body.innerHTML = renderSuggestionsSubTab(tasks, ctx);
  else if (activeSubTab === 'meetings') body.innerHTML = renderMeetingsSubTab(meetings, ctx);
  else if (activeSubTab === 'memos') body.innerHTML = renderMemosSubTab(memos);

  if (activeSubTab === 'meetings') probeMeetingServerBanner();
  wireMemoButtons(memos, onChange);
  wireMeetingButtons(meetings, ctx, onChange);
  wireSuggestionButtons(tasks, onChange, ctx);
  wireMemoRowClick(memos, ctx);
}

function wireMemoRowClick(memos, ctx) {
  document.querySelectorAll('.memo-row-clickable').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't open overlay if click was on the Dismiss button
      if (e.target.closest('.memo-dismiss-btn')) return;
      const memoId = row.dataset.memoId;
      const memo = memos.find(m => m.id === memoId);
      if (memo) openMemoOverlay(memo, ctx);
    });
  });
}

function renderSubTab(name, label, badge) {
  return `
    <button type="button" class="subtab-link ${activeSubTab === name ? 'current' : ''}" data-subtab="${name}">
      ${escapeHtml(label)}
      ${badge > 0 ? `<span class="subtab-badge">${badge}</span>` : ''}
    </button>
  `;
}

// ============ Suggestions sub-tab ============

function renderSuggestionsSubTab(tasks, ctx) {
  // Hide cards that are mid-persist; they only reappear if persist fails.
  const pending = tasks
    .filter(t => ['awaiting_approval', 'proposed'].includes((t.status || '').toLowerCase()))
    .filter(t => !stagedDecisions.has(t.id))
    .sort((a, b) => (a.proposed_at || '').localeCompare(b.proposed_at || ''));
  const banner = renderDecisionFailureBanner(tasks);
  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Suggestions</span></div>
        <span class="card-sub" style="margin-top:0">${pending.length} awaiting your review</span>
      </div>
      <p class="card-sub">From your agents. Accept, talk it through, or dismiss.</p>
      ${banner}
      <div class="suggestion-list" style="margin-top:14px">
        ${pending.length === 0
          ? `<div class="empty-state">No suggestions awaiting your review. Stewart files new ones at each heartbeat.</div>`
          : pending.map(t => renderSuggestionCard(t, ctx)).join('')}
      </div>
    </div>
  `;
}

function renderDecisionFailureBanner(tasks) {
  if (failedDecisions.size === 0) return '';
  const items = [...failedDecisions.entries()].map(([taskId, info]) => {
    const t = (tasks || []).find(x => x.id === taskId);
    const title = t ? t.title : taskId;
    return `<li>✗ <strong>${escapeHtml(info.decision)}</strong> «${escapeHtml(title)}» — ${escapeHtml(info.message)}</li>`;
  }).join('');
  const plural = failedDecisions.size === 1 ? '' : 's';
  return `
    <div class="suggestion-failures" style="background:rgba(220,80,80,0.08);border:1px solid var(--red,#c33);border-radius:6px;padding:10px 12px;margin-top:14px;color:var(--red,#c33)">
      <div style="font-weight:600;margin-bottom:4px">${failedDecisions.size} decision${plural} could not be saved — card${plural} restored below. Click Accept/Dismiss again to retry.</div>
      <ul style="margin:4px 0 0 16px;padding:0">${items}</ul>
    </div>
  `;
}

function renderSuggestionCard(t, ctx) {
  const oa = t.operator_action;
  // If operator_action is present, render the new v1 format.
  // Otherwise, fall back to the legacy free-text rendering.
  if (oa && typeof oa === 'object' && Array.isArray(oa.blocks)) {
    return renderSuggestionCardV1(t, oa, ctx);
  }
  return renderSuggestionCardLegacy(t);
}

function renderSuggestionCardLegacy(t) {
  const meta = [];
  if (t.category) meta.push(t.category);
  if (t.risk_level) meta.push(`risk: ${t.risk_level}`);
  if (t.target?.executor) meta.push(t.target.executor);
  if (t.tier) meta.push(`tier: ${t.tier}`);
  return `
    <div class="suggestion-card suggestion-card-legacy" data-task-id="${escapeHtml(t.id)}">
      <div class="suggestion-legacy-tag mono" title="This task pre-dates the v1 operator-action format. Stewart will re-emit it in the new shape on next heartbeat.">legacy format</div>
      <div class="suggestion-title">${escapeHtml(t.title)}</div>
      ${t.description ? `<div class="suggestion-detail">${escapeHtml((t.description || '').slice(0, 320))}${(t.description || '').length > 320 ? '…' : ''}</div>` : ''}
      <div class="suggestion-meta mono">${escapeHtml(meta.join(' · ') || 'task')}</div>
      <div class="suggestion-actions">
        <button type="button" class="sugg-accept" data-task-id="${escapeHtml(t.id)}">Accept</button>
        <button type="button" class="sugg-discuss" data-task-id="${escapeHtml(t.id)}">Discuss</button>
        <button type="button" class="sugg-dismiss" data-task-id="${escapeHtml(t.id)}">Dismiss</button>
        <span class="sugg-status mono"></span>
      </div>
    </div>
  `;
}

function renderSuggestionCardV1(t, oa, ctx) {
  const breadcrumb = computeBreadcrumb(t, ctx);
  const chips = [];
  if (oa.nature) chips.push({ label: oa.nature, kind: oa.nature === 'decision' ? 'decision' : 'execution' });
  if (oa.domain) chips.push({ label: oa.domain, kind: 'domain' });
  if (oa.exposure) chips.push({ label: oa.exposure, kind: 'exposure' });
  if (oa.runs_on) chips.push({ label: `runs on: ${oa.runs_on}`, kind: 'runs' });
  const blocks = oa.blocks || [];

  return `
    <div class="suggestion-card suggestion-card-v1" data-task-id="${escapeHtml(t.id)}">
      ${breadcrumb ? `<div class="oa-breadcrumb mono">${breadcrumb}</div>` : ''}
      <div class="oa-chips">
        ${chips.map(c => `<span class="oa-chip oa-chip-${c.kind}">${escapeHtml(c.label)}</span>`).join('')}
      </div>
      <div class="suggestion-title oa-title">${escapeHtml(t.title)}</div>
      ${oa.what_you_approve ? `
        <div class="oa-approve">
          <div class="oa-approve-label mono">WHAT YOU'RE APPROVING</div>
          <p class="oa-approve-body">${escapeHtml(oa.what_you_approve)}</p>
        </div>
      ` : ''}
      <div class="oa-blocks">
        ${blocks.map(b => renderActorBlock(b)).join('')}
      </div>
      <div class="suggestion-actions">
        <button type="button" class="sugg-accept" data-task-id="${escapeHtml(t.id)}">Accept</button>
        <button type="button" class="sugg-discuss" data-task-id="${escapeHtml(t.id)}">Discuss</button>
        <button type="button" class="sugg-dismiss" data-task-id="${escapeHtml(t.id)}">Dismiss</button>
        <span class="sugg-status mono"></span>
      </div>
    </div>
  `;
}

function renderActorBlock(b) {
  const actorLabel = b.actor === 'you' ? 'YOU' : (b.actor === 'me' ? 'ME (Stewart)' : escapeHtml(b.actor || ''));
  const meta = [];
  if (b.when) meta.push(b.when);
  if (b.estimate) meta.push(b.estimate);
  const steps = Array.isArray(b.steps) ? b.steps : [];
  return `
    <div class="oa-block oa-block-${escapeHtml(b.actor || 'unknown')}">
      <div class="oa-block-head">
        <span class="oa-block-actor mono">▸ ${actorLabel}</span>
        ${meta.length ? `<span class="oa-block-meta mono">${escapeHtml(meta.join(' · '))}</span>` : ''}
      </div>
      <ol class="oa-block-steps">
        ${steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>
    </div>
  `;
}

function computeBreadcrumb(t, ctx) {
  const initId = t.advances_initiative;
  if (!initId || initId === 'unrelated') return '';
  const inits = ctx.initiatives || [];
  const init = inits.find(i => i.id === initId);
  if (!init) return '';

  // Task position within the initiative — count tasks by proposed_at order
  const allTasks = ctx.tasks || [];
  const initTasks = allTasks.filter(x => x.advances_initiative === initId)
    .slice()
    .sort((a, b) => (a.proposed_at || '').localeCompare(b.proposed_at || ''));
  const idx = initTasks.findIndex(x => x.id === t.id);
  const total = initTasks.length;
  const remaining = initTasks.filter(x => !['done', 'closed', 'completed'].includes((x.status || '').toLowerCase())).length;
  const taskPos = idx >= 0 ? `task ${idx + 1} of ${total} (${remaining} left)` : `task in ${initId}`;

  // Milestone position
  let msPart = '';
  const msId = t.advances_milestone;
  if (msId && Array.isArray(init.milestones)) {
    const msIdx = init.milestones.findIndex(m => m.id === msId);
    if (msIdx >= 0) {
      const ms = init.milestones[msIdx];
      msPart = ` · milestone ${msIdx + 1} of ${init.milestones.length} «${escapeHtml(ms.title || '')}»`;
    }
  }
  return `${escapeHtml(init.title || init.id)} · ${taskPos}${msPart}`;
}

function wireSuggestionButtons(tasks, onChange, ctx) {
  document.querySelectorAll('.sugg-accept').forEach(btn => {
    btn.addEventListener('click', () => decideTask(btn, 'approved', onChange, tasks, ctx));
  });
  document.querySelectorAll('.sugg-dismiss').forEach(btn => {
    btn.addEventListener('click', () => decideTask(btn, 'rejected', onChange, tasks, ctx));
  });
  document.querySelectorAll('.sugg-discuss').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.taskId;
      const t = tasks.find(x => x.id === id);
      if (!t) return;
      const opening = `Operator opened a discussion on task ${t.id}: «${t.title}».\n\nDescription: ${t.description || '(none)'}\n\nWhat would you like to reshape or clarify? I can edit the scope/risk/executor, split it, or replace it. Once we agree on the new shape, I'll update tasks.json and you can approve the new form from the Suggestions list.`;
      startMeeting({
        title: `Discuss: ${(t.title || '').slice(0, 80)}`,
        purpose: 'task_discussion',
        related_item: { type: 'task', task_id: t.id, task_title: t.title, advances_initiative: t.advances_initiative || null },
        opening_prompt: opening,
      });
    });
  });
}

async function decideTask(btn, decision, onChange, tasks, ctx) {
  const taskId = btn.dataset.taskId;

  // Queue the decision — card vanishes from the list immediately.
  stagedDecisions.set(taskId, decision);
  failedDecisions.delete(taskId); // this click is the retry; clear any prior failure
  rerenderSuggestionsSubTab(tasks, ctx, onChange);

  try {
    const resp = await fetch('/api/decide-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), decisions: [{ task_id: taskId, decision }], decided_by: 'operator' }),
    });
    const json = await resp.json().catch(() => ({}));

    // 409 = server says task is already not-pending. That's the "ghost card" case
    // (stale render, prior approve already committed). Keep card gone, no error.
    if (resp.status === 409) {
      const task = (tasks || []).find(t => t.id === taskId);
      if (task) {
        const reason = (Array.isArray(json.skipped) && json.skipped[0] && json.skipped[0].reason) || '';
        const m = reason.match(/^status_is_(.+)$/);
        task.status = m ? m[1] : decision;
      }
      stagedDecisions.delete(taskId);
      if (typeof onChange === 'function') setTimeout(onChange, 0); // refresh from disk
      return;
    }

    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);

    // Success — task is now approved/rejected on the server
    const task = (tasks || []).find(t => t.id === taskId);
    if (task) task.status = decision;
    stagedDecisions.delete(taskId);
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  } catch (e) {
    console.error('[inputs] decide-tasks failed:', e);
    stagedDecisions.delete(taskId);
    failedDecisions.set(taskId, { decision, message: e.message || 'failed', at: Date.now() });
    rerenderSuggestionsSubTab(tasks, ctx, onChange);
  }
}

function rerenderSuggestionsSubTab(tasks, ctx, onChange) {
  const body = document.getElementById('inputs-subtab-body');
  if (!body || activeSubTab !== 'suggestions') return;
  body.innerHTML = renderSuggestionsSubTab(tasks, ctx);
  wireSuggestionButtons(tasks, onChange, ctx);
}

// ============ Meetings sub-tab ============

function renderMeetingsSubTab(meetings, ctx) {
  const all = meetings.slice().filter(m => !stagedMeetingDismissals.has(m.id));
  const hiddenCount = all.filter(m => HIDDEN_PAST_CLOSE_REASONS.has(m.close_reason)).length;
  const visible = showHiddenPastMeetings
    ? all
    : all.filter(m => !HIDDEN_PAST_CLOSE_REASONS.has(m.close_reason));
  const failureBanner = renderMeetingDismissFailureBanner(meetings);

  const deadlineKey = (m) => {
    // Scheduled meetings use their own scheduled_at as the sort key so they
    // slot into the timeline at their intended time.
    if (m.scheduled_at) return m.scheduled_at.slice(0, 10);
    const init = (ctx.initiatives || []).find(i => i.id === (m.related_item || {}).initiative_id);
    return (init?.target_close_date || '9999-12-31').slice(0, 10);
  };
  visible.sort((a, b) => {
    const ka = deadlineKey(a);
    const kb = deadlineKey(b);
    if (ka !== kb) return ka.localeCompare(kb);
    // Tie-break: most recent activity first (active beats requested beats closed when same deadline).
    const tA = a.started_at || a.requested_at || a.scheduled_at || a.closed_at || '';
    const tB = b.started_at || b.requested_at || b.scheduled_at || b.closed_at || '';
    return tB.localeCompare(tA);
  });

  const toggle = hiddenCount > 0
    ? `<button type="button" class="meeting-toggle-hidden-btn" id="meeting-toggle-hidden-btn">
         ${showHiddenPastMeetings ? `Hide ${hiddenCount} system-closed` : `Show ${hiddenCount} hidden`}
       </button>`
    : '';

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Meetings</span></div>
        <button type="button" class="add-btn-secondary" id="new-meeting-btn" title="Schedule a meeting (requires local meeting server)">+ Schedule</button>
      </div>
      <p class="card-sub">Sorted by deadline. Color shows status — green active · amber pending · red overdue · gray closed.</p>
      <div id="meeting-server-banner-host"></div>
      ${failureBanner}

      <div class="meeting-list" style="margin-top:14px">
        ${toggle}
        ${visible.length
          ? visible.map(m => renderMeetingRow(m, ctx)).join('')
          : `<div class="empty-state">No meetings yet.</div>`}
      </div>
    </div>
  `;
}

function renderMeetingDismissFailureBanner(meetings) {
  if (failedMeetingDismissals.size === 0) return '';
  const items = [...failedMeetingDismissals.entries()].map(([id, info]) => {
    const m = (meetings || []).find(x => x.id === id);
    const title = m ? (m.title || 'Untitled meeting') : id;
    return `<li>✗ <strong>Dismiss</strong> «${escapeHtml(title)}» — ${escapeHtml(info.message)}</li>`;
  }).join('');
  const plural = failedMeetingDismissals.size === 1 ? '' : 's';
  return `
    <div class="meeting-dismiss-failures" style="background:rgba(220,80,80,0.08);border:1px solid var(--red,#c33);border-radius:6px;padding:10px 12px;margin-top:14px;color:var(--red,#c33)">
      <div style="font-weight:600;margin-bottom:4px">${failedMeetingDismissals.size} dismissal${plural} could not be saved — row${plural} restored below. Click Dismiss again to retry.</div>
      <ul style="margin:4px 0 0 16px;padding:0">${items}</ul>
    </div>
  `;
}

const MONTH_ABBREV = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function renderDateBox(iso) {
  if (!iso) {
    return `
      <div class="meeting-date-box meeting-date-box-empty">
        <div class="meeting-date-day">—</div>
        <div class="meeting-date-month">no&nbsp;date</div>
      </div>
    `;
  }
  const parts = iso.split('-');
  const month = MONTH_ABBREV[(parseInt(parts[1], 10) - 1)] || '';
  const day = parseInt(parts[2], 10);
  return `
    <div class="meeting-date-box">
      <div class="meeting-date-day">${escapeHtml(Number.isFinite(day) ? String(day) : '—')}</div>
      <div class="meeting-date-month">${escapeHtml(month)}</div>
    </div>
  `;
}

function rerenderMeetingsSubTab(meetings, ctx, onChange) {
  const body = document.getElementById('inputs-subtab-body');
  if (!body || activeSubTab !== 'meetings') return;
  body.innerHTML = renderMeetingsSubTab(meetings, ctx);
  probeMeetingServerBanner();
  wireMeetingButtons(meetings, ctx, onChange);
}

function renderMeetingRow(m, ctx) {
  const init = (ctx.initiatives || []).find(i => i.id === (m.related_item || {}).initiative_id);
  const deadline = init?.target_close_date ? init.target_close_date.slice(0, 10) : null;

  const agoPhrase = (iso) => {
    const a = ago(iso);
    if (a === '—' || a === 'just now') return a;
    return `${a} ago`;
  };
  let statusClass;
  let initiatedLine;
  // Scheduled meetings (created via the '+ Schedule for later' flow) have a
  // scheduled_at ISO but no started_at yet. Show them as pending with a
  // 'scheduled for …' line + a Start button that kicks off the meeting-server
  // session inline (reuses the same startMeeting path as '+ Start now').
  const isScheduled = m.status === 'scheduled' || (!!m.scheduled_at && !m.started_at);
  const scheduledIso = m.scheduled_at || null;

  if (isScheduled) {
    statusClass = 'pending';
    const scheduledDate = scheduledIso ? new Date(scheduledIso) : null;
    if (scheduledDate && !Number.isNaN(scheduledDate.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      const dayLabel = `${scheduledDate.getFullYear()}-${pad(scheduledDate.getMonth()+1)}-${pad(scheduledDate.getDate())} ${pad(scheduledDate.getHours())}:${pad(scheduledDate.getMinutes())}`;
      initiatedLine = `scheduled for ${dayLabel}`;
    } else {
      initiatedLine = 'scheduled (no time set)';
    }
  } else if (m.status === 'requested_by_agent') {
    statusClass = 'pending';
    initiatedLine = `requested ${agoPhrase(m.requested_at)}`;
  } else if (m.status === 'active') {
    statusClass = 'active';
    initiatedLine = `started ${agoPhrase(m.started_at)}`;
  } else {
    statusClass = 'past';
    initiatedLine = `closed ${agoPhrase(m.closed_at || m.started_at)}`;
  }
  // Overdue = a still-open meeting (pending or active) whose deadline already passed.
  // Closed meetings keep the gray "past" treatment regardless of deadline.
  if (statusClass !== 'past' && deadline) {
    const today = new Date().toISOString().slice(0, 10);
    if (deadline < today) statusClass = 'overdue';
  }

  // Scheduled meetings show the scheduled_at date in the date box; other
  // rows keep the initiative-deadline treatment.
  const dateBoxIso = isScheduled && scheduledIso ? scheduledIso.slice(0, 10) : deadline;

  return `
    <div class="meeting-row meeting-row-${statusClass}" data-meeting-id="${escapeHtml(m.id)}" data-meeting-status="${statusClass}">
      ${renderDateBox(dateBoxIso)}
      <div class="meeting-row-body">
        <div class="meeting-row-title">${escapeHtml(m.title || 'Untitled meeting')}</div>
        <div class="meeting-row-initiated mono">${escapeHtml(initiatedLine)}</div>
        ${m.purpose ? `<div class="meeting-row-purpose">${escapeHtml(m.purpose)}</div>` : ''}
      </div>
      ${isScheduled ? `
        <div class="meeting-row-actions">
          <button type="button" class="meeting-scheduled-start-btn" data-meeting-id="${escapeHtml(m.id)}" data-meeting-title="${escapeHtml(m.title || '')}" data-meeting-goal="${escapeHtml(m.goal || '')}">Start now →</button>
          <button type="button" class="meeting-dismiss-btn" data-meeting-id="${escapeHtml(m.id)}">Dismiss</button>
        </div>
      ` : m.status === 'requested_by_agent' ? `
        <div class="meeting-row-actions">
          <button type="button" class="meeting-convert-btn" data-meeting-id="${escapeHtml(m.id)}">Start meeting →</button>
          <button type="button" class="meeting-dismiss-btn" data-meeting-id="${escapeHtml(m.id)}">Dismiss</button>
        </div>
      ` : ''}
    </div>
  `;
}

function wireMeetingButtons(meetings, ctx, onChange) {
  const newBtn = document.getElementById('new-meeting-btn');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      // In-app modal (was two chained await showPrompt()s — replaced 2026-07-07
      // per operator direction to use proper in-app UI). Per MEETING_PROTOCOL.md
      // every meeting still needs a one-sentence expected-output; asked in the
      // same modal.
      const host = document.getElementById('overlay-host');
      if (!host) return;
      // Default the "later" datetime input to 15 minutes from now so operators
      // can just tap Schedule without typing a time when the picker opens.
      const in15 = new Date(Date.now() + 15 * 60 * 1000);
      const pad = n => String(n).padStart(2, '0');
      const defaultLater = `${in15.getFullYear()}-${pad(in15.getMonth()+1)}-${pad(in15.getDate())}T${pad(in15.getHours())}:${pad(in15.getMinutes())}`;

      host.innerHTML = `
        <div id="msc-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:60;"></div>
        <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,94vw);background:#fff;border-radius:16px;box-shadow:0 30px 90px rgba(16,18,28,.28);z-index:61;overflow:hidden;">
          <div style="padding:20px 24px 14px;border-bottom:1px solid rgba(20,22,28,.08);display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#3468d6;text-transform:uppercase;">New meeting</div>
              <div style="font-size:13px;color:#5b6270;margin-top:4px;">Live operator↔agent session — start immediately or schedule for later.</div>
            </div>
            <button type="button" id="msc-close" style="background:none;border:none;font-size:26px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
          </div>
          <div style="padding:18px 24px;display:flex;flex-direction:column;gap:14px;">
            <!-- Mode segmented toggle -->
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:6px;">When</label>
              <div id="msc-mode-wrap" style="display:inline-flex;background:#f5f6f8;border-radius:8px;padding:3px;">
                <button type="button" data-mode="now"   class="msc-mode-btn" style="padding:7px 14px;border:none;border-radius:6px;background:#fff;color:#16181e;font:600 12.5px inherit;cursor:pointer;box-shadow:0 1px 3px rgba(20,22,28,.06);">Start now</button>
                <button type="button" data-mode="later" class="msc-mode-btn" style="padding:7px 14px;border:none;border-radius:6px;background:transparent;color:#5b6270;font:500 12.5px inherit;cursor:pointer;">Schedule for later</button>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:4px;">Title</label>
              <input type="text" id="msc-title" value="Working session" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:13.5px;color:#16181e;box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:4px;">Expected output <span style="color:#9aa1ae;font-weight:400;">— one sentence, what success looks like at close</span></label>
              <input type="text" id="msc-expected" placeholder="e.g. Decided pricing tiers; drafted 3 marketing headlines; …" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:13.5px;color:#16181e;box-sizing:border-box;">
            </div>
            <div id="msc-when-row" style="display:none;">
              <label style="display:block;font-size:12px;font-weight:600;color:#5b6270;margin-bottom:4px;">Date &amp; time</label>
              <input type="datetime-local" id="msc-when" value="${defaultLater}" style="width:100%;padding:9px 12px;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:13.5px;color:#16181e;box-sizing:border-box;">
            </div>
          </div>
          <div style="padding:14px 24px;border-top:1px solid rgba(20,22,28,.08);display:flex;justify-content:flex-end;gap:10px;">
            <button type="button" id="msc-cancel" style="padding:9px 16px;border:1px solid rgba(20,22,28,.14);background:#fff;color:#5b6270;border-radius:9px;font:600 12.5px inherit;cursor:pointer;">Cancel</button>
            <button type="button" id="msc-submit" style="padding:9px 18px;background:#3468d6;color:#fff;border:none;border-radius:9px;font:600 12.5px inherit;cursor:pointer;">Start now →</button>
          </div>
        </div>
      `;
      const close = () => { host.innerHTML = ''; };
      let mode = 'now';
      const setMode = (m) => {
        mode = m;
        document.querySelectorAll('.msc-mode-btn').forEach(b => {
          const on = b.dataset.mode === m;
          b.style.background = on ? '#fff' : 'transparent';
          b.style.color = on ? '#16181e' : '#5b6270';
          b.style.fontWeight = on ? '600' : '500';
          b.style.boxShadow = on ? '0 1px 3px rgba(20,22,28,.06)' : 'none';
        });
        document.getElementById('msc-when-row').style.display = m === 'later' ? '' : 'none';
        document.getElementById('msc-submit').textContent = m === 'later' ? 'Schedule →' : 'Start now →';
      };
      document.querySelectorAll('.msc-mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
      document.getElementById('msc-scrim')?.addEventListener('click', close);
      document.getElementById('msc-close')?.addEventListener('click', close);
      document.getElementById('msc-cancel')?.addEventListener('click', close);
      setTimeout(() => document.getElementById('msc-title')?.focus(), 50);
      document.getElementById('msc-submit').addEventListener('click', async () => {
        const title = document.getElementById('msc-title').value.trim();
        if (!title) { document.getElementById('msc-title').focus(); return; }
        const expected_output = document.getElementById('msc-expected').value.trim();
        if (mode === 'now') {
          close();
          startMeeting(
            { title, purpose: 'general', expected_output: expected_output || undefined },
            ctx, onChange, newBtn
          );
          return;
        }
        // Schedule for later: persist as substrate meeting with scheduled_at.
        const whenLocal = document.getElementById('msc-when').value;
        if (!whenLocal) { document.getElementById('msc-when').focus(); return; }
        // datetime-local returns 'YYYY-MM-DDTHH:MM' (no seconds, no zone) — treat
        // as operator-local, convert to ISO for storage.
        const whenIso = new Date(whenLocal).toISOString();
        const btn = document.getElementById('msc-submit');
        btn.disabled = true; btn.textContent = 'Scheduling…';
        try {
          const res = await fetch('/api/meetings', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bu: BU(),
              action: 'start',
              title,
              goal: expected_output || '',
              agenda: [],
              module_id: null,
              scheduled_at: whenIso,
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.ok) {
            btn.disabled = false; btn.textContent = 'Schedule →';
            await showAlert(`Could not schedule (HTTP ${res.status}): ${j.message || 'unknown error'}`);
            return;
          }
          close();
          onChange?.();
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Schedule →';
          await showAlert(`Could not schedule: ${e.message}`);
        }
      });
    });
  }
  document.querySelectorAll('.meeting-convert-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.meetingId;
      const req = meetings.find(m => m.id === id);
      if (!req) return;
      startMeeting({
        title: req.title,
        purpose: req.purpose || 'milestone_co_creation',
        from_request_id: req.id,
        related_item: req.related_item || null,
        opening_prompt: req.opening_prompt || null,
      }, ctx, onChange, btn);
    });
  });
  // Kick off a scheduled meeting (created via '+ Schedule for later'): fires
  // the same meeting-server startMeeting path used by '+ Start now'. The
  // scheduled substrate row stays for now — operator can Dismiss it once the
  // live meeting has replaced it.
  document.querySelectorAll('.meeting-scheduled-start-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.meetingId;
      const req = meetings.find(m => m.id === id);
      if (!req) return;
      startMeeting({
        title: req.title,
        purpose: req.purpose || 'general',
        expected_output: req.goal || undefined,
      }, ctx, onChange, btn);
    });
  });
  document.querySelectorAll('.meeting-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.meetingId;
      dismissMeetingRequest(id, meetings, ctx, onChange);
    });
  });
  // Click any non-pending meeting row → open its chat overlay.
  // (Pending rows route through the Start-meeting button above, which
  // creates the live meeting then opens the chat.)
  document.querySelectorAll('.meeting-row').forEach(row => {
    // Rows that carry a Start-meeting button (requested_by_agent, including
    // requested-but-overdue) are not directly clickable — the button starts
    // the meeting which then opens the chat.
    if (row.querySelector('.meeting-convert-btn')) return;
    row.addEventListener('click', () => {
      const id = row.dataset.meetingId;
      const m = meetings.find(x => x.id === id);
      if (m) openMeetingChat(m, ctx, onChange);
    });
    row.style.cursor = 'pointer';
  });
  const toggleHiddenBtn = document.getElementById('meeting-toggle-hidden-btn');
  if (toggleHiddenBtn) {
    toggleHiddenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showHiddenPastMeetings = !showHiddenPastMeetings;
      rerenderMeetingsSubTab(meetings, ctx, onChange);
    });
  }
}

async function dismissMeetingRequest(meetingId, meetings, ctx, onChange) {
  if (!meetingId) return;
  // Optimistic: hide the row immediately so the operator sees the click landed.
  // This is the GEN-7 vanish-on-action pattern — same UX guarantee for meetings.
  stagedMeetingDismissals.add(meetingId);
  failedMeetingDismissals.delete(meetingId);  // this click is the retry; clear prior failure
  rerenderMeetingsSubTab(meetings, ctx, onChange);

  try {
    const r = await fetch(`${MEETING_SERVER}/meeting/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), meeting_id: meetingId }),
    });
    const j = await r.json().catch(() => ({}));
    // 404 = server doesn't know this meeting (already gone, or never persisted).
    // Treat as a successful dismissal — keep the row hidden, refresh from disk.
    if (r.status === 404) {
      stagedMeetingDismissals.delete(meetingId);
      if (typeof onChange === 'function') setTimeout(onChange, 0);
      return;
    }
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    // Success — mutate the in-memory meeting so until the substrate reload lands
    // (onChange below), the row stays out of Pending and shows up in Past.
    const m = (meetings || []).find(x => x.id === meetingId);
    if (m) {
      if (j.meeting) Object.assign(m, j.meeting);
      else { m.status = 'closed'; m.closed_at = new Date().toISOString(); }
    }
    stagedMeetingDismissals.delete(meetingId);
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  } catch (e) {
    console.error('[inputs] dismiss-meeting failed:', e);
    stagedMeetingDismissals.delete(meetingId);
    failedMeetingDismissals.set(meetingId, { message: e.message || 'failed', at: Date.now() });
    rerenderMeetingsSubTab(meetings, ctx, onChange);
  }
}

async function startMeeting(payload, ctx, onChange, btn) {
  // Idempotency for requests originating from a pending agent request:
  // 1) if a sibling POST is already in flight for the same from_request_id, no-op
  // 2) if the substrate already has an active meeting for this request, open it
  //    instead of POSTing a second time. Cures the double-click duplication
  //    where the second click fires before ctx.meetings refreshes.
  const reqId = payload.from_request_id || null;
  if (reqId && inFlightMeetingStarts.has(reqId)) return;
  if (reqId && Array.isArray(ctx?.meetings)) {
    const existing = ctx.meetings.find(m => m.status === 'active' && m.from_request_id === reqId);
    if (existing) {
      openMeetingChat(existing, ctx, onChange);
      return;
    }
  }
  if (reqId) inFlightMeetingStarts.add(reqId);

  // Disable the originating button and show loading state until the overlay
  // opens or the server returns an error. Also blocks re-entry from rapid clicks
  // for the generic "+ Schedule" path that has no from_request_id.
  let originalLabel = null;
  if (btn) {
    btn.disabled = true;
    originalLabel = btn.textContent;
    btn.textContent = 'starting…';
  }

  try {
    const r = await fetch(`${MEETING_SERVER}/meeting/new`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu: BU(), agent_id: 'tuto-stewart', ...payload }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    // Open the chat overlay on the just-created meeting so the operator
    // can start typing immediately. onChange refreshes the meetings list
    // in the background; the overlay holds a live reference to j.meeting.
    if (typeof onChange === 'function') setTimeout(onChange, 0);
    openMeetingChat(j.meeting, ctx, onChange);
  } catch (e) {
    await showAlert(`Could not start meeting: ${e.message}. The local meeting server might not be running.`);
  } finally {
    if (reqId) inFlightMeetingStarts.delete(reqId);
    if (btn) {
      btn.disabled = false;
      if (originalLabel !== null) btn.textContent = originalLabel;
    }
  }
}

// ============ Meeting chat overlay ============

function openMeetingChat(meeting, ctx, onChange) {
  const subtitle = `${meeting.agent_id || 'agent'} · ${meeting.purpose || 'meeting'} · started ${ago(meeting.started_at || meeting.requested_at)}`;
  // Everything in the body: the overlay footer is right-aligned flex,
  // which doesn't suit a chat thread + full-width input row.
  const bodyHtml = `
    <div class="chat-host">
      <div class="chat-bar">
        <span class="chat-status mono">status: ${escapeHtml(meeting.status || 'unknown')}</span>
        ${meeting.status === 'active'
          ? `<button type="button" class="chat-close-btn" id="chat-close-meeting-btn">Close meeting</button>`
          : ''}
      </div>
      <div class="chat-thread" id="chat-thread">
        ${renderChatTurns(meeting.transcript || [])}
      </div>
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="${chatPlaceholder(meeting)}" rows="2" ${chatInputDisabled(meeting) ? 'disabled' : ''}></textarea>
        <button type="button" class="chat-send-btn" id="chat-send-btn" ${chatInputDisabled(meeting) ? 'disabled' : ''}>Send</button>
      </div>
      <div class="chat-hint mono">Cmd/Ctrl + Enter to send</div>
    </div>
  `;
  openOverlay({
    title: meeting.title || 'Meeting',
    subtitle,
    iconHtml: '💬',
    iconTint: '#2f6bff',
    bodyHtml,
    onClose: () => {
      // Refresh the parent inputs view so any new turns / status changes appear.
      if (typeof onChange === 'function') onChange();
    },
  });
  scrollChatToBottom();
  wireChatHandlers(meeting, ctx, onChange);
  // The `meeting` reference comes from the inputs view's array, which is loaded
  // from substrate meetings.json at app boot and not refreshed per turn — so on
  // reopen the transcript can be empty or behind. Hydrate from the local server.
  hydrateMeetingTranscript(meeting);
}

async function hydrateMeetingTranscript(meeting) {
  try {
    const r = await fetch(`${MEETING_SERVER}/meetings?bu=${encodeURIComponent(BU())}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.meetings)) return;
    const fresh = j.meetings.find(x => x.id === meeting.id);
    if (!fresh) return;
    if (fresh.status && fresh.status !== meeting.status) meeting.status = fresh.status;
    const freshTurns = fresh.transcript || [];
    const localTurns = meeting.transcript || [];
    // Only replace when the server has more turns than memory — protects any
    // optimistic operator turn appended between overlay-open and hydrate-completion.
    if (freshTurns.length <= localTurns.length) return;
    meeting.transcript = freshTurns;
    const thread = document.getElementById('chat-thread');
    if (thread) {
      thread.innerHTML = renderChatTurns(freshTurns);
      scrollChatToBottom();
    }
  } catch (_) {
    // Local server unreachable — keep the in-memory transcript.
  }
}

function renderChatTurns(turns) {
  if (!turns || turns.length === 0) {
    return `<div class="chat-empty">No messages yet. Type below to start the conversation.</div>`;
  }
  return turns.map(renderChatTurn).join('');
}

function renderChatTurn(t) {
  const isOperator = t.role === 'operator';
  const roleLabel = isOperator ? 'you' : escapeHtml(t.role || 'agent');
  return `
    <div class="chat-turn chat-turn-${isOperator ? 'operator' : 'agent'}">
      <div class="chat-bubble">${escapeAndLinebreak(t.content || '')}</div>
      <div class="chat-meta mono">${roleLabel} · ${escapeHtml(ago(t.at))}</div>
    </div>
  `;
}

function escapeAndLinebreak(s) {
  return escapeHtml(s || '').replace(/\n/g, '<br>');
}

function scrollChatToBottom() {
  const t = document.getElementById('chat-thread');
  if (t) t.scrollTop = t.scrollHeight;
}

function chatPlaceholder(meeting) {
  if (meeting.status !== 'active' && meeting.status !== 'requested_by_agent') return 'Meeting closed — no new messages';
  if (!meetingServerUp) return 'Local meeting server offline — start it to send';
  return `Message ${meeting.agent_id || 'agent'}… (Cmd/Ctrl+Enter to send)`;
}

function chatInputDisabled(meeting) {
  return meeting.status !== 'active' || !meetingServerUp;
}

function wireChatHandlers(meeting, ctx, onChange) {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const closeBtn = document.getElementById('chat-close-meeting-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!await showConfirm('Close this meeting?')) return;
      closeBtn.disabled = true;
      closeBtn.textContent = 'closing…';
      try {
        const r = await fetch(`${MEETING_SERVER}/meeting/close`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU(), meeting_id: meeting.id }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
        // Reflect new status in-overlay, then close after a moment
        if (j.meeting) Object.assign(meeting, j.meeting);
        if (typeof onChange === 'function') setTimeout(onChange, 0);
        closeOverlay();
      } catch (e) {
        closeBtn.disabled = false;
        closeBtn.textContent = 'Close meeting';
        await showAlert(`Close failed: ${e.message}`);
      }
    });
  }

  if (!input || !sendBtn) return;

  const send = async () => {
    const text = (input.value || '').trim();
    if (!text || sendBtn.disabled) return;
    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '…';
    const thread = document.getElementById('chat-thread');
    // Strip empty-state placeholder if present
    if (thread && thread.querySelector('.chat-empty')) thread.innerHTML = '';
    // Optimistic operator bubble
    const optimisticTurn = { role: 'operator', content: text, at: new Date().toISOString() };
    meeting.transcript = meeting.transcript || [];
    meeting.transcript.push(optimisticTurn);
    if (thread) {
      thread.insertAdjacentHTML('beforeend', renderChatTurn(optimisticTurn));
      thread.insertAdjacentHTML('beforeend', '<div class="chat-thinking" id="chat-thinking">thinking…</div>');
      scrollChatToBottom();
    }
    input.value = '';
    try {
      const r = await fetch(`${MEETING_SERVER}/meeting/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu: BU(), meeting_id: meeting.id, message: text }),
      });
      const j = await r.json();
      document.getElementById('chat-thinking')?.remove();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      // Server returns the full updated meeting; sync the agent's reply (last turn)
      const fullTranscript = (j.meeting && j.meeting.transcript) || meeting.transcript;
      const agentTurn = fullTranscript[fullTranscript.length - 1];
      meeting.transcript = fullTranscript;
      if (thread && agentTurn && agentTurn.role !== 'operator') {
        thread.insertAdjacentHTML('beforeend', renderChatTurn(agentTurn));
        scrollChatToBottom();
      }
    } catch (e) {
      document.getElementById('chat-thinking')?.remove();
      if (thread) {
        thread.insertAdjacentHTML('beforeend', `<div class="chat-error">Error: ${escapeHtml(e.message || 'failed')}</div>`);
        scrollChatToBottom();
      }
    } finally {
      input.disabled = chatInputDisabled(meeting);
      sendBtn.disabled = chatInputDisabled(meeting);
      sendBtn.textContent = 'Send';
      input.focus();
    }
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  input.focus();
}

function probeMeetingServerBanner() {
  const host = document.getElementById('meeting-server-banner-host');
  fetch(`${MEETING_SERVER}/health`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(j => {
      meetingServerUp = !!j.ok;
      if (host) host.innerHTML = j.ok ? '' : `<div class="meeting-server-banner banner-down">✗ Meeting server reachable but reports not-OK.</div>`;
    })
    .catch(() => {
      meetingServerUp = false;
      if (host) host.innerHTML = `<div class="meeting-server-banner banner-down">✗ Local meeting server unreachable (<code>${MEETING_SERVER}</code>). Start meeting + Schedule won't work until it's running.</div>`;
    });
}

// ============ Memos sub-tab ============

function renderMemosSubTab(memos) {
  const unprocessed = memos.filter(m => (m.status || '').toLowerCase() === 'unprocessed').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const processed = memos.filter(m => ['processed', 'approved'].includes((m.status || '').toLowerCase())).sort((a, b) => (b.processed_at || b.created_at || '').localeCompare(a.processed_at || a.created_at || ''));
  const dismissed = memos.filter(m => (m.status || '').toLowerCase() === 'dismissed').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  return `
    <div class="card">
      <div class="card-header-row">
        <div class="card-header-left"><span class="card-title">Memos</span></div>
        <button type="button" class="add-btn" id="new-memo-btn" title="Compose a new memo">+</button>
      </div>
      <p class="card-sub">What you tell the agents. Stewart reads memos at next heartbeat.</p>

      <div id="new-memo-form-host" hidden></div>

      <div class="memo-list" style="margin-top:14px">
        ${renderMemoSection('Unprocessed', unprocessed, 'unprocessed')}
        ${processed.length ? renderMemoSection('Processed', processed.slice(0, 12), 'processed') : ''}
        ${dismissed.length ? renderMemoSection('Dismissed', dismissed.slice(0, 6), 'dismissed') : ''}
      </div>
    </div>
  `;
}

function renderMemoSection(label, items, sectionClass) {
  if (!items.length && sectionClass !== 'unprocessed') return '';
  return `
    <div class="memo-section memo-section-${sectionClass}">
      <div class="memo-section-label mono">${escapeHtml(label.toUpperCase())} · ${items.length}</div>
      ${items.length === 0
        ? `<div class="empty-state-sm">none</div>`
        : items.map(m => `
          <div class="memo-row memo-row-clickable" data-memo-id="${escapeHtml(m.id)}" role="button" tabindex="0">
            <div class="memo-row-head">
              <span class="memo-status-chip memo-status-chip-${sectionClass}">${escapeHtml(m.level || 'misc')}</span>
              <span class="mono memo-when">${escapeHtml(ago(m.created_at))}</span>
            </div>
            <div class="memo-title">${escapeHtml(m.title || (m.body || '').slice(0, 60))}</div>
            ${m.body ? `<div class="memo-body-preview">${escapeHtml(m.body.slice(0, 220))}${m.body.length > 220 ? '…' : ''}</div>` : ''}
            ${sectionClass === 'unprocessed' ? `
              <div class="memo-row-actions">
                <button type="button" class="memo-dismiss-btn" data-memo-id="${escapeHtml(m.id)}">Dismiss</button>
              </div>
            ` : ''}
            ${(m.applied_to || []).length ? `<div class="memo-applied mono">→ ${(m.applied_to || []).map(escapeHtml).join(', ')}</div>` : ''}
          </div>
        `).join('')}
    </div>
  `;
}

function openMemoOverlay(memo, ctx) {
  // What it resulted in — find tasks + initiatives whose id is in applied_to,
  // or that reference from_memo back to this memo.
  const appliedIds = memo.applied_to || [];
  const linkedTasks = (ctx.tasks || []).filter(t =>
    appliedIds.includes(t.id) || t.from_memo === memo.id
  );
  const linkedInits = (ctx.initiatives || []).filter(i =>
    appliedIds.includes(i.id) || i.from_memo === memo.id
  );

  const bodyHtml = `
    <div class="memo-overlay-meta-row">
      <span class="memo-status-chip memo-status-chip-${(memo.status || 'unprocessed').toLowerCase()}">${escapeHtml(memo.level || 'misc')}</span>
      <span class="mono memo-overlay-when">${escapeHtml(memo.id)} · created ${escapeHtml(ago(memo.created_at))}</span>
    </div>
    ${memo.target ? `<div class="memo-overlay-to mono">→ ${escapeHtml(memo.target)}</div>` : ''}
    <div class="memo-overlay-body">${escapeHtml(memo.body || '(no body)')}</div>

    ${memo.processed_at ? `
      <div class="memo-overlay-section-label mono">PROCESSED</div>
      <p class="memo-overlay-processed-meta">By ${escapeHtml(memo.processed_by || 'unknown')} on ${escapeHtml((memo.processed_at || '').slice(0, 10))}.</p>
    ` : ''}

    ${(linkedTasks.length || linkedInits.length) ? `
      <div class="memo-overlay-section-label mono">WHAT IT RESULTED IN</div>
      ${linkedInits.length ? `
        <div class="memo-results-group">
          <div class="memo-results-group-label mono">Initiatives</div>
          ${linkedInits.map(i => `
            <div class="memo-result-row">
              <span class="memo-result-pill mono">init</span>
              <span class="memo-result-title">${escapeHtml(i.title)}</span>
              <span class="mono memo-result-id">${escapeHtml(i.id)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${linkedTasks.length ? `
        <div class="memo-results-group">
          <div class="memo-results-group-label mono">Tasks</div>
          ${linkedTasks.map(t => `
            <div class="memo-result-row">
              <span class="memo-result-pill mono">task</span>
              <span class="memo-result-title">${escapeHtml(t.title)}</span>
              <span class="mono memo-result-id">${escapeHtml(t.status || '?')}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    ` : memo.status === 'processed' ? `
      <div class="memo-overlay-section-label mono">WHAT IT RESULTED IN</div>
      <p class="empty-state-sm">Processed without spawning a downstream task or initiative. Tuto absorbed it as context.</p>
    ` : ''}
  `;
  openOverlay({
    title: memo.title || (memo.body || '').slice(0, 60),
    iconTint: 'var(--accent)',
    bodyHtml,
  });
}

function wireMemoButtons(memos, onChange) {
  const newBtn = document.getElementById('new-memo-btn');
  if (!newBtn) return;
  newBtn.addEventListener('click', () => {
    const host = document.getElementById('new-memo-form-host');
    if (!host.hidden) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `
      <div class="new-memo-form">
        <div class="new-memo-row">
          <select id="np-memo-level">
            <option value="misc">misc</option>
            <option value="task">task</option>
            <option value="initiative">initiative</option>
            <option value="system">system</option>
            <option value="strategic">strategic</option>
          </select>
          <input id="np-memo-target" type="text" placeholder="target id (optional)">
        </div>
        <textarea id="np-memo-body" placeholder="Drop a thought. Stewart reads memos at next heartbeat."></textarea>
        <div class="new-memo-actions">
          <button type="button" class="new-memo-cancel">Cancel</button>
          <button type="button" class="new-memo-save">Save memo</button>
          <span class="new-memo-status mono"></span>
        </div>
      </div>
    `;
    document.querySelector('.new-memo-cancel').addEventListener('click', () => { host.hidden = true; host.innerHTML = ''; });
    document.querySelector('.new-memo-save').addEventListener('click', async () => {
      const level = document.getElementById('np-memo-level').value;
      const target = document.getElementById('np-memo-target').value.trim() || null;
      const body = document.getElementById('np-memo-body').value.trim();
      const status = document.querySelector('.new-memo-status');
      if (!body) { status.textContent = 'body required'; status.style.color = 'var(--red)'; return; }
      status.textContent = 'saving…'; status.style.color = 'var(--text-faint)';
      try {
        const resp = await fetch('/api/create-memo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU(), level, target, body }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        status.textContent = `✓ saved ${json.memo.id}`;
        status.style.color = 'var(--green-fg)';
        setTimeout(() => { host.hidden = true; host.innerHTML = ''; onChange(); }, 800);
      } catch (e) {
        status.textContent = `✗ ${e.message || 'failed'}`;
        status.style.color = 'var(--red)';
      }
    });
  });

  document.querySelectorAll('.memo-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const memoId = btn.dataset.memoId;
      btn.disabled = true; btn.textContent = '…';
      try {
        const resp = await fetch('/api/dismiss-memo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU(), memo_id: memoId }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        onChange();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Dismiss';
        await showAlert(`Could not dismiss: ${e.message}`);
      }
    });
  });
}
