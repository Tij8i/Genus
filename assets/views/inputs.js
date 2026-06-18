// Inputs view — 3-column "what flows IN to the venture": Memos / Meetings / Suggestions.
//
// Per v0.6 mockup IA + decisions locked in the migration plan:
//   - Memos: operator-authored notes. "+ New" button at top opens an inline composer.
//     Status chips show processed vs unprocessed vs dismissed.
//   - Meetings: pending requests (status=requested_by_agent) on top, then active,
//     then past. Convert button on requests opens a meeting via the local meeting
//     server (only works if operator has the local server running — same flow as
//     today's Orchestrator dashboard).
//   - Suggestions: tasks with status=awaiting_approval or proposed.
//     Three actions: Accept / Discuss / Dismiss. Accept and Dismiss POST to
//     /api/decide-tasks; Discuss tries to open a meeting via local meeting server.

import { escapeHtml, ago, icon } from '../utils.js';

const MEETING_SERVER = 'http://localhost:8765';
const BU = 'tuto';

export function renderInputs(ctx, { onChange }) {
  const root = document.getElementById('route-inputs');
  const memos = ctx.memos || [];
  const meetings = ctx.meetings || [];
  const tasks = ctx.tasks || [];

  // ============ Memos column ============
  const unprocessedMemos = memos.filter(m => (m.status || '').toLowerCase() === 'unprocessed').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const processedMemos = memos.filter(m => ['processed', 'approved'].includes((m.status || '').toLowerCase())).sort((a, b) => (b.processed_at || b.created_at || '').localeCompare(a.processed_at || a.created_at || ''));
  const dismissedMemos = memos.filter(m => (m.status || '').toLowerCase() === 'dismissed').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // ============ Meetings column ============
  // Sort pending requests by Initiative deadline (mirrors yesterday's logic in
  // the legacy Orchestrator dashboard — most urgent on top).
  const pendingRequests = meetings.filter(m => m.status === 'requested_by_agent').slice();
  pendingRequests.sort((a, b) => {
    const initA = (ctx.initiatives || []).find(i => i.id === (a.related_item || {}).initiative_id);
    const initB = (ctx.initiatives || []).find(i => i.id === (b.related_item || {}).initiative_id);
    const dlA = (initA?.target_close_date || '9999-12-31').slice(0, 10);
    const dlB = (initB?.target_close_date || '9999-12-31').slice(0, 10);
    if (dlA !== dlB) return dlA.localeCompare(dlB);
    return (a.requested_at || '').localeCompare(b.requested_at || '');
  });
  const activeMeetings = meetings.filter(m => m.status === 'active').sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  const pastMeetings = meetings.filter(m => !['requested_by_agent', 'active'].includes(m.status)).sort((a, b) => (b.closed_at || b.started_at || '').localeCompare(a.closed_at || a.started_at || ''));

  // ============ Suggestions column ============
  const pendingSuggestions = tasks.filter(t => ['awaiting_approval', 'proposed'].includes((t.status || '').toLowerCase())).sort((a, b) => (a.proposed_at || '').localeCompare(b.proposed_at || ''));

  root.innerHTML = `
    <div class="inputs-grid">

      <!-- ========= Memos ========= -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left"><span class="card-title">Memos</span></div>
          <button type="button" class="add-btn" id="new-memo-btn" title="Compose a new memo">+</button>
        </div>
        <p class="card-sub">What you tell the agents. Stewart reads memos at next heartbeat.</p>

        <div id="new-memo-form-host" hidden></div>

        <div class="memo-list">
          ${renderMemoSection('Unprocessed', unprocessedMemos, 'unprocessed')}
          ${renderMemoSection('Processed', processedMemos.slice(0, 6), 'processed')}
          ${dismissedMemos.length ? renderMemoSection('Dismissed', dismissedMemos.slice(0, 3), 'dismissed') : ''}
        </div>
      </div>

      <!-- ========= Meetings ========= -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left"><span class="card-title">Meetings</span></div>
          <button type="button" class="add-btn-secondary" id="new-meeting-btn" title="Schedule a meeting (requires local meeting server)">+ Schedule</button>
        </div>
        <p class="card-sub">With agents. Pending requests on top; convert one to open a live chat.</p>
        <div id="meeting-server-banner-host"></div>

        <div class="meeting-list">
          ${pendingRequests.length ? renderMeetingSection('Pending requests', pendingRequests, 'requested', ctx) : ''}
          ${activeMeetings.length ? renderMeetingSection('Active', activeMeetings, 'active', ctx) : ''}
          ${pastMeetings.length ? renderMeetingSection('Past', pastMeetings.slice(0, 6), 'past', ctx) : ''}
          ${pendingRequests.length + activeMeetings.length + pastMeetings.length === 0
            ? `<div class="empty-state">No meetings yet.</div>` : ''}
        </div>
      </div>

      <!-- ========= Suggestions ========= -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-header-left"><span class="card-title">Suggestions</span></div>
          ${pendingSuggestions.length > 0
            ? `<span class="count-pill count-pill-accent">${pendingSuggestions.length} new</span>`
            : `<span class="count-pill count-pill-muted">0</span>`}
        </div>
        <p class="card-sub">From your agents. Accept, talk it through, or dismiss.</p>

        <div class="suggestion-list">
          ${pendingSuggestions.length === 0
            ? `<div class="empty-state">No suggestions awaiting your review. Stewart files new ones at each heartbeat.</div>`
            : pendingSuggestions.slice(0, 12).map(renderSuggestionCard).join('')}
          ${pendingSuggestions.length > 12 ? `<div class="see-more">+ ${pendingSuggestions.length - 12} more</div>` : ''}
        </div>
      </div>

    </div>
  `;

  // ============ Wire up handlers ============
  wireMemoButtons(memos, onChange);
  wireMeetingButtons(meetings, ctx, onChange);
  wireSuggestionButtons(tasks, onChange);
  probeMeetingServerBanner();
}

// ============ Memos ============

function renderMemoSection(label, items, sectionClass) {
  if (!items.length && sectionClass !== 'unprocessed') return '';
  return `
    <div class="memo-section memo-section-${sectionClass}">
      <div class="memo-section-label mono">${escapeHtml(label.toUpperCase())} · ${items.length}</div>
      ${items.length === 0
        ? `<div class="empty-state-sm">none</div>`
        : items.map(m => `
          <div class="memo-row" data-memo-id="${escapeHtml(m.id)}">
            <div class="memo-row-head">
              <span class="memo-status-chip memo-status-chip-${sectionClass}">${escapeHtml(m.level || 'misc')}</span>
              <span class="mono memo-when">${escapeHtml(ago(m.created_at))}</span>
            </div>
            <div class="memo-title">${escapeHtml(m.title || (m.body || '').slice(0, 60))}</div>
            ${m.body ? `<div class="memo-body-preview">${escapeHtml(m.body.slice(0, 140))}${m.body.length > 140 ? '…' : ''}</div>` : ''}
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

function wireMemoButtons(memos, onChange) {
  // New memo button → inline composer
  document.getElementById('new-memo-btn').addEventListener('click', () => {
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
    document.querySelector('.new-memo-cancel').addEventListener('click', () => {
      host.hidden = true; host.innerHTML = '';
    });
    document.querySelector('.new-memo-save').addEventListener('click', async () => {
      const level = document.getElementById('np-memo-level').value;
      const target = document.getElementById('np-memo-target').value.trim() || null;
      const body = document.getElementById('np-memo-body').value.trim();
      const status = document.querySelector('.new-memo-status');
      if (!body) { status.textContent = 'body required'; status.style.color = 'var(--red)'; return; }
      status.textContent = 'saving…';
      status.style.color = 'var(--text-faint)';
      try {
        const resp = await fetch('/api/create-memo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU, level, target, body }),
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

  // Dismiss buttons
  document.querySelectorAll('.memo-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const memoId = btn.dataset.memoId;
      btn.disabled = true; btn.textContent = '…';
      try {
        const resp = await fetch('/api/dismiss-memo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu: BU, memo_id: memoId }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
        onChange();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Dismiss';
        alert(`Could not dismiss: ${e.message}`);
      }
    });
  });
}

// ============ Meetings ============

function renderMeetingSection(label, items, sectionClass, ctx) {
  return `
    <div class="meeting-section meeting-section-${sectionClass}">
      <div class="memo-section-label mono">${escapeHtml(label.toUpperCase())} · ${items.length}</div>
      ${items.map(m => renderMeetingRow(m, sectionClass, ctx)).join('')}
    </div>
  `;
}

function renderMeetingRow(m, sectionClass, ctx) {
  const init = (ctx.initiatives || []).find(i => i.id === (m.related_item || {}).initiative_id);
  const deadline = init?.target_close_date ? init.target_close_date.slice(0, 10) : null;
  const dateOrAgo = sectionClass === 'requested'
    ? `requested ${ago(m.requested_at)}`
    : sectionClass === 'active'
      ? `started ${ago(m.started_at)}`
      : `${ago(m.closed_at || m.started_at)}`;
  return `
    <div class="meeting-row meeting-row-${sectionClass}" data-meeting-id="${escapeHtml(m.id)}">
      <div class="meeting-row-body">
        <div class="meeting-row-title">${escapeHtml(m.title || 'Untitled meeting')}</div>
        ${m.purpose ? `<div class="meeting-row-purpose">${escapeHtml(m.purpose)}</div>` : ''}
        ${deadline ? `<div class="meeting-row-meta mono">initiative deadline ${escapeHtml(deadline)}</div>` : ''}
        <div class="meeting-row-meta mono">${escapeHtml(dateOrAgo)}</div>
      </div>
      ${sectionClass === 'requested' ? `
        <div class="meeting-row-actions">
          <button type="button" class="meeting-convert-btn" data-meeting-id="${escapeHtml(m.id)}">Convert →</button>
        </div>
      ` : ''}
    </div>
  `;
}

function wireMeetingButtons(meetings, ctx, onChange) {
  document.getElementById('new-meeting-btn').addEventListener('click', () => {
    const title = window.prompt('Meeting title:', 'Working session');
    if (!title) return;
    startMeeting({ title, purpose: 'general' });
  });
  document.querySelectorAll('.meeting-convert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.meetingId;
      const req = meetings.find(m => m.id === id);
      if (!req) return;
      startMeeting({
        title: req.title,
        purpose: req.purpose || 'milestone_co_creation',
        from_request_id: req.id,
        related_item: req.related_item || null,
        opening_prompt: req.opening_prompt || null,
      });
    });
  });
}

async function startMeeting(payload) {
  try {
    const r = await fetch(`${MEETING_SERVER}/meeting/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bu: BU,
        agent_id: 'tuto-stewart',
        ...payload,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    alert(`Meeting started: ${j.meeting.id}. Open the live chat on the legacy dashboard for now (meeting detail view ships in step 2c-2).`);
  } catch (e) {
    alert(`Could not start meeting: ${e.message}. The local meeting server might not be running — start it from the Orchestrator dashboard or via launchd.`);
  }
}

function probeMeetingServerBanner() {
  const host = document.getElementById('meeting-server-banner-host');
  if (!host) return;
  fetch(`${MEETING_SERVER}/health`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(j => {
      if (j.ok) host.innerHTML = '';
      else host.innerHTML = `<div class="meeting-server-banner banner-down">✗ Meeting server reachable but reports not-OK.</div>`;
    })
    .catch(() => {
      host.innerHTML = `<div class="meeting-server-banner banner-down">✗ Local meeting server unreachable (<code>${MEETING_SERVER}</code>). Convert + Schedule won't work until it's running.</div>`;
    });
}

// ============ Suggestions ============

function renderSuggestionCard(t) {
  const meta = [];
  if (t.category) meta.push(t.category);
  if (t.risk_level) meta.push(`risk: ${t.risk_level}`);
  if (t.target?.executor) meta.push(t.target.executor);
  if (t.tier) meta.push(`tier: ${t.tier}`);
  return `
    <div class="suggestion-card" data-task-id="${escapeHtml(t.id)}">
      <div class="suggestion-title">${escapeHtml(t.title)}</div>
      ${t.description ? `<div class="suggestion-detail">${escapeHtml((t.description || '').slice(0, 240))}${(t.description || '').length > 240 ? '…' : ''}</div>` : ''}
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

function wireSuggestionButtons(tasks, onChange) {
  document.querySelectorAll('.sugg-accept').forEach(btn => {
    btn.addEventListener('click', () => decideTask(btn, 'approved', onChange));
  });
  document.querySelectorAll('.sugg-dismiss').forEach(btn => {
    btn.addEventListener('click', () => decideTask(btn, 'rejected', onChange));
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

async function decideTask(btn, decision, onChange) {
  const taskId = btn.dataset.taskId;
  const card = btn.closest('.suggestion-card');
  const status = card.querySelector('.sugg-status');
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  status.textContent = `${decision === 'approved' ? 'accepting' : 'dismissing'}…`;
  status.style.color = 'var(--text-faint)';
  try {
    const resp = await fetch('/api/decide-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bu: BU,
        decisions: [{ task_id: taskId, decision }],
        decided_by: 'operator',
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    card.classList.add(decision === 'approved' ? 'card-accepted' : 'card-dismissed');
    status.textContent = `✓ ${decision} · ${(json.commit_sha || '').slice(0, 7)}`;
    status.style.color = 'var(--green-fg)';
    setTimeout(onChange, 800);
  } catch (e) {
    card.querySelectorAll('button').forEach(b => b.disabled = false);
    status.textContent = `✗ ${e.message || 'failed'}`;
    status.style.color = 'var(--red)';
  }
}
