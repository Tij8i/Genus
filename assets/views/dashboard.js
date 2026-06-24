// Dashboard view — the operator's landing page.
//
// Four sections (per v0.6 mockup IA):
//   01 · Progress — cycle progress vs. plan + velocity (tasks/day, 7d sparkline)
//   02 · Activity — Waiting on you + Recently shipped
//   03 · Historical — Upcoming milestones + Decisions made
//   04 · Snapshot — health chips (Execution / Approvals / Budget) + narrative + what would help
//
// Per [[v06-mockup-interpretation]]: visual style + IA from mockup, data
// from real substrate. "Points" in the mockup → tasks completed (we don't
// have story points). "Snapshot narrative" deferred to v2 (needs LLM call).
//
// Per decisions locked in the migration plan:
//   - Meeting requests on Dashboard "Waiting on you" (not Inputs page)
//   - Cycle health = Snapshot chips (replaces dedicated cycle-health tab)

import { escapeHtml, ago, dateLabel, icon, isoDay, daysBetween, cycleTimeProgress } from '../utils.js';

const MEETING_SERVER = 'http://localhost:8765';

export function renderDashboard(ctx) {
  const { identity, plans, initiatives, tasks, meetings, memos } = ctx;

  // ============ HEADER ============
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greeting = document.getElementById('dash-greeting');
  const subtitle = document.getElementById('dash-subtitle');
  const cycleMeta = document.getElementById('dash-cycle-meta');
  greeting.textContent = `${greet}, Alessio`;
  subtitle.innerHTML = `${icon('spark', {color: 'var(--accent)', size: 17, stroke: 1.8})} Here's what's on autopilot today for ${escapeHtml(identity?.name || 'this venture')}.`;

  // Active plan + time progress
  const activePlan = plans.find(p => p.status === 'active');
  const timeProg = cycleTimeProgress(activePlan);
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const planLabel = activePlan
    ? `CYCLE · ${escapeHtml((activePlan.title || '').toUpperCase().slice(0, 28))}`
    : 'NO ACTIVE CYCLE';
  const daysLeftLabel = timeProg
    ? `${timeProg.remainingDays} day${timeProg.remainingDays === 1 ? '' : 's'} left`
    : '—';
  cycleMeta.innerHTML = `
    <div class="page-cycle-meta">
      <span class="mono" style="font-size:12px;color:var(--text-faint);letter-spacing:.02em">${planLabel}</span>
      <span style="font-size:13.5px;color:var(--text);font-weight:600">${escapeHtml(daysLeftLabel)}</span>
    </div>
    <div class="date-chip">
      <span class="mono" style="font-size:9px;color:var(--red);font-weight:600;letter-spacing:.06em">${monthNames[now.getMonth()]}</span>
      <span style="font-weight:800;font-size:16px;margin-top:1px">${now.getDate()}</span>
    </div>
  `;

  // ============ BODY ============
  const root = document.getElementById('route-dashboard');
  root.innerHTML = `
    ${renderProgressSection(activePlan, initiatives, tasks, timeProg)}
    ${renderActivitySection(tasks, meetings, initiatives)}
    ${renderHistoricalSection(initiatives, memos)}
    ${renderSnapshotSection(activePlan, tasks, meetings, timeProg)}
    ${renderDoctorNoteSection(identity)}
    ${renderCycleHealthSection(activePlan, initiatives, tasks, meetings, timeProg)}
  `;

  wireAdapterRunButton();
}

// ============ Section 1 — Progress ============

function renderProgressSection(activePlan, initiatives, tasks, timeProg) {
  // Cycle-progress percent = done tasks / total tasks in active cycle.
  // (Story points in the mockup → task counts here.)
  const cycleTasks = (tasks || []).filter(t =>
    !['rejected', 'cancelled'].includes((t.status || '').toLowerCase())
  );
  const doneCount = cycleTasks.filter(t => (t.status || '').toLowerCase() === 'done').length;
  const totalCount = cycleTasks.length;
  const percentDone = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const expectedPercent = timeProg ? timeProg.percentElapsed : null;
  const gap = expectedPercent != null ? percentDone - expectedPercent : null;
  const onPace = gap == null ? null : gap >= 0;
  const paceChip = onPace == null
    ? ''
    : onPace
      ? `<span class="pace-chip pace-chip-good"><span class="pace-dot pace-dot-good"></span>On pace</span>`
      : `<span class="pace-chip pace-chip-warn"><span class="pace-dot pace-dot-warn"></span>Behind pace</span>`;

  const periodEndLabel = activePlan?.period_target_end
    ? dateLabel(activePlan.period_target_end).replace(' · ', ' · ').toUpperCase()
    : '—';

  // Velocity: tasks completed in last 24h + 7-day sparkline
  const velocity = computeVelocity(tasks);

  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">01 · Progress</span>
        <div class="rule-line"></div>
      </div>
      <div class="progress-grid">

        <!-- Pace card -->
        <div class="card pace-card">
          <div class="pace-header">
            <div>
              <div class="kpi-label">Cycle progress vs. plan</div>
              <div class="kpi-big-row">
                <span class="kpi-big">${percentDone}<span class="kpi-big-unit">%</span></span>
                <span class="kpi-big-sub">${doneCount} of ${totalCount} tasks done</span>
              </div>
            </div>
            ${paceChip}
          </div>
          <div class="pace-track">
            <div class="pace-fill" style="width:${percentDone}%"></div>
            ${expectedPercent != null ? `
              <div class="pace-marker" style="left:${expectedPercent}%"></div>
              <div class="pace-marker-label" style="left:${expectedPercent}%">PLAN ${expectedPercent}%</div>
            ` : ''}
          </div>
          <div class="pace-track-foot">
            <span>CYCLE START</span><span>${escapeHtml(periodEndLabel)}</span>
          </div>
          <div class="pace-divider"></div>
          <div class="pace-stats">
            <div class="pace-stat">
              <div class="pace-stat-label">DAYS LEFT</div>
              <div class="pace-stat-value">${timeProg ? timeProg.remainingDays : '—'} <span class="pace-stat-unit">of ${timeProg ? timeProg.totalDays : '—'}</span></div>
            </div>
            <div class="pace-stat">
              <div class="pace-stat-label">SHIPPED</div>
              <div class="pace-stat-value">${doneCount} <span class="pace-stat-unit">/ ${totalCount} tasks</span></div>
            </div>
            <div class="pace-stat">
              <div class="pace-stat-label">GAP TO PLAN</div>
              <div class="pace-stat-value ${gap != null && gap < 0 ? 'gap-warn' : ''}">${gap == null ? '—' : (gap >= 0 ? '+' : '') + gap + '%'} <span class="pace-stat-unit">vs today</span></div>
            </div>
          </div>
        </div>

        <!-- Velocity card -->
        <div class="card velocity-card">
          <div class="kpi-label">Velocity</div>
          <div class="kpi-big-row">
            <span class="kpi-big" style="font-size:40px">${velocity.last24h}</span>
            <span class="kpi-big-sub">task${velocity.last24h === 1 ? '' : 's'} last 24h</span>
          </div>
          <div class="sparkline">
            ${velocity.spark.map((v, i) => {
              const max = Math.max(1, ...velocity.spark);
              const pct = Math.round((v / max) * 100);
              const isToday = i === velocity.spark.length - 1;
              return `<div class="spark-bar${isToday ? ' spark-bar-today' : ''}" style="height:${Math.max(8, pct)}%" title="${v} task${v === 1 ? '' : 's'} ${isToday ? 'today' : (velocity.spark.length - 1 - i) + 'd ago'}"></div>`;
            }).join('')}
          </div>
          <div class="kpi-label" style="font-size:10px;letter-spacing:.04em">LAST 7 DAYS</div>
          <div class="pace-divider"></div>
          <div class="vel-stat-row"><span class="vel-stat-label">Cycle average</span><span class="vel-stat-value">${velocity.avgCycle.toFixed(1)}<span class="vel-stat-unit"> /day</span></span></div>
          <div class="vel-stat-row"><span class="vel-stat-label">All-time average</span><span class="vel-stat-value">${velocity.avgAll.toFixed(1)}<span class="vel-stat-unit"> /day</span></span></div>
          <div class="vel-actions">
            <button type="button" id="run-adapter-btn" class="vel-actions-btn">🔄 Push approved tasks to Paperclip</button>
            <div id="run-adapter-status" class="vel-actions-status"></div>
          </div>
        </div>

      </div>
    </section>
  `;
}

function computeVelocity(tasks) {
  // Buckets: tasks where execution.completed_at falls in each of the last 7 days.
  // Today is bucket index 6, oldest day is index 0.
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const spark = new Array(7).fill(0);
  const allDoneDates = [];
  for (const t of tasks) {
    const completed = (t.execution || {}).completed_at;
    if (!completed) continue;
    allDoneDates.push(completed);
    const d = new Date(completed);
    d.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((now - d) / 86400000);
    if (dayDiff >= 0 && dayDiff < 7) {
      spark[6 - dayDiff] += 1;
    }
  }
  // last24h = how many tasks completed in the rolling 24h window (more precise than today bucket)
  const cutoff24h = Date.now() - 86400000;
  const last24h = allDoneDates.filter(iso => new Date(iso).getTime() >= cutoff24h).length;
  const totalLast7 = spark.reduce((a, b) => a + b, 0);
  const avgCycle = totalLast7 / 7;
  // All-time: total done / span days
  let avgAll = 0;
  if (allDoneDates.length > 0) {
    const oldest = allDoneDates.sort()[0];
    const spanDays = Math.max(1, Math.round((Date.now() - new Date(oldest).getTime()) / 86400000));
    avgAll = allDoneDates.length / spanDays;
  }
  return { last24h, spark, avgCycle, avgAll };
}

// ============ Section 2 — Activity ============

function renderActivitySection(tasks, meetings, initiatives) {
  // "Waiting on you" = meeting requests (status=requested_by_agent) + tasks awaiting_approval.
  // Both block downstream work. Sorted by oldest first (most urgent).
  const pendingMeetings = (meetings || [])
    .filter(m => m.status === 'requested_by_agent')
    .map(m => ({
      kind: 'meeting',
      id: m.id,
      title: m.title || 'Untitled meeting request',
      from: ((m.related_item || {}).type === 'initiative_milestone'
        ? `Milestone · ${(m.related_item || {}).milestone_name || ''}`
        : `Tuto Stewart`),
      at: m.requested_at || m.started_at || m.created_at,
    }));
  const pendingTasks = (tasks || [])
    .filter(t => (t.status || '').toLowerCase() === 'awaiting_approval')
    .map(t => ({
      kind: 'task',
      id: t.id,
      title: t.title || 'Untitled task',
      from: `Tuto Stewart · ${t.category || 'task'}`,
      at: t.proposed_at || t.created_at,
      risk: t.risk_level,
    }));
  const waiting = [...pendingMeetings, ...pendingTasks].sort((a, b) =>
    (a.at || '').localeCompare(b.at || '')
  );

  // Recently shipped = tasks done in last 7 days, newest first.
  const cutoff7d = Date.now() - 7 * 86400000;
  const recentlyShipped = (tasks || [])
    .filter(t => (t.status || '').toLowerCase() === 'done')
    .map(t => ({
      id: t.id,
      title: t.title || 'Untitled task',
      from: `Tuto Stewart · ${t.category || 'task'}`,
      at: (t.execution || {}).completed_at || (t.approval || {}).decided_at,
    }))
    .filter(x => x.at && new Date(x.at).getTime() >= cutoff7d)
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">02 · Activity</span>
        <div class="rule-line"></div>
      </div>
      <div class="activity-grid">

        <!-- Waiting on you -->
        <div class="card">
          <div class="card-header-row">
            <div class="card-header-left">
              <span class="card-title">Waiting on you</span>
              ${waiting.length > 0
                ? `<span class="count-pill count-pill-red">${waiting.length}</span>`
                : `<span class="count-pill count-pill-muted">0</span>`}
            </div>
            ${waiting.length > 0
              ? `<span class="muted-emph">blocking forward work</span>`
              : `<span class="muted-emph-good">inbox zero</span>`}
          </div>
          <p class="card-sub">Things paused until you approve, decide, or join a meeting.</p>
          <div class="waiting-list">
            ${waiting.length === 0
              ? `<div class="empty-state">Nothing's waiting on you. The cycle is yours to advance.</div>`
              : waiting.slice(0, 8).map(w => renderWaitingRow(w)).join('')}
            ${waiting.length > 8 ? `<div class="see-more">+ ${waiting.length - 8} more — see <a href="#inputs">Inputs</a></div>` : ''}
          </div>
        </div>

        <!-- Recently shipped -->
        <div class="card">
          <div class="card-header-row">
            <div class="card-header-left"><span class="card-title">Recently shipped</span></div>
            <span class="muted-emph-good">${recentlyShipped.length} closed last 7d</span>
          </div>
          <p class="card-sub">Latest work completed by your agents.</p>
          <div class="shipped-list">
            ${recentlyShipped.length === 0
              ? `<div class="empty-state">No tasks completed in the last 7 days.</div>`
              : recentlyShipped.slice(0, 6).map(s => `
                <div class="shipped-row">
                  ${icon('check-circle', {color: 'var(--green)', size: 17, stroke: 2.4})}
                  <div class="shipped-body">
                    <div class="shipped-title">${escapeHtml(s.title)}</div>
                    <div class="shipped-from">${escapeHtml(s.from)}</div>
                  </div>
                  <span class="shipped-when mono">${escapeHtml(ago(s.at))}</span>
                </div>
              `).join('')}
          </div>
        </div>

      </div>
    </section>
  `;
}

function renderWaitingRow(w) {
  const ageHours = w.at ? Math.floor((Date.now() - new Date(w.at).getTime()) / 3600000) : null;
  const ageClass = ageHours == null ? 'age-fresh'
    : ageHours >= 24 ? 'age-old'
    : ageHours >= 6 ? 'age-aging'
    : 'age-fresh';
  const ageLabel = w.at ? ago(w.at) : '';
  const dotClass = w.kind === 'meeting' ? 'wait-dot-meeting' : (w.risk === 'high' ? 'wait-dot-high' : 'wait-dot-med');
  const reviewHref = w.kind === 'meeting' ? '#inputs' : '#inputs';
  return `
    <div class="waiting-row">
      <span class="wait-dot ${dotClass}"></span>
      <div class="wait-body">
        <div class="wait-title">${escapeHtml(w.title)}</div>
        <div class="wait-from">${escapeHtml(w.from)}</div>
      </div>
      <span class="wait-age mono ${ageClass}">${escapeHtml(ageLabel)}</span>
      <a href="${reviewHref}" class="wait-review">Review</a>
    </div>
  `;
}

// ============ Section 3 — Historical ============

function renderHistoricalSection(initiatives, memos) {
  // Upcoming milestones = next pending critical milestone per active Initiative,
  // sorted by Initiative target_close_date. Includes meeting state if any.
  const upcoming = [];
  for (const init of (initiatives || [])) {
    const status = (init.status || '').toLowerCase();
    if (['completed', 'abandoned', 'discarded'].includes(status)) continue;
    const ms = (init.milestones || []).find(m => (m.status || 'pending').toLowerCase() !== 'done');
    if (ms) {
      upcoming.push({
        date: init.target_close_date,
        title: ms.name,
        initId: init.id,
        initTitle: init.title,
      });
    } else if (init.target_close_date) {
      upcoming.push({
        date: init.target_close_date,
        title: `${init.title} — final delivery`,
        initId: init.id,
        initTitle: init.title,
      });
    }
  }
  upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcomingTop = upcoming.slice(0, 5);

  // Decisions made = recent memos with level=strategic OR level=initiative.
  // These are "we decided X" records vs operational tasks.
  const decisions = (memos || [])
    .filter(m => ['strategic', 'initiative', 'decision', 'deliverable'].includes((m.level || '').toLowerCase()))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5);

  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">03 · Historical</span>
        <div class="rule-line"></div>
      </div>
      <div class="activity-grid">

        <!-- Upcoming milestones -->
        <div class="card">
          <div class="card-header-row">
            <div class="card-header-left"><span class="card-title">Upcoming milestones</span></div>
            <a href="#planning" class="see-link">Planning →</a>
          </div>
          <div class="timeline-mini">
            ${upcomingTop.length === 0
              ? `<div class="empty-state">No upcoming milestones. Add an active plan to see them here.</div>`
              : upcomingTop.map((m, idx) => `
                <div class="tl-mini-row">
                  <span class="tl-mini-dot ${idx === 0 ? 'tl-mini-dot-active' : ''}"></span>
                  <div class="tl-mini-body">
                    <div class="tl-mini-date mono">${escapeHtml(dateLabel(m.date))}</div>
                    <div class="tl-mini-title">${escapeHtml(m.title)}</div>
                    <div class="tl-mini-owner">Initiative · ${escapeHtml(m.initTitle)}</div>
                  </div>
                </div>
              `).join('')}
          </div>
        </div>

        <!-- Decisions made -->
        <div class="card">
          <div class="card-header-row">
            <div class="card-header-left"><span class="card-title">Decisions made</span></div>
            <a href="#inputs" class="see-link">All →</a>
          </div>
          <div class="decisions-list">
            ${decisions.length === 0
              ? `<div class="empty-state">No strategic decisions recorded yet. Strategic memos surface here.</div>`
              : decisions.map((d, idx) => `
                <div class="decision-row ${idx === 0 ? 'decision-row-fresh' : ''}">
                  <div class="decision-title">${escapeHtml(d.title)}</div>
                  <div class="decision-body">${escapeHtml((d.body || '').slice(0, 160))}${(d.body || '').length > 160 ? '…' : ''}</div>
                  <div class="decision-meta mono">${escapeHtml((d.created_by || 'unknown').toUpperCase())} · ${escapeHtml(d.level || 'strategic')} · ${escapeHtml(ago(d.created_at))}</div>
                </div>
              `).join('')}
          </div>
        </div>

      </div>
    </section>
  `;
}

// ============ Section 4 — Snapshot ============

function renderSnapshotSection(activePlan, tasks, meetings, timeProg) {
  // Health chips computed from real substrate:
  //   Execution: fast (avg tasks/day above all-time avg) / steady / slow
  //   Approvals: healthy (0-2 waiting) / aging (3-5 OR oldest > 24h) / slow (5+ OR oldest > 48h)
  //   Budget: ok (no telemetry today — placeholder)
  const executionHealth = computeExecutionHealth(tasks);
  const approvalsHealth = computeApprovalsHealth(tasks, meetings);
  const budgetHealth = { label: 'Healthy', tone: 'good', why: 'No budget signals wired yet' };

  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">04 · Snapshot</span>
        <div class="rule-line"></div>
      </div>
      <div class="card snapshot-card">
        <div class="snapshot-header">
          <span class="snapshot-icon">${icon('spark', {color: '#fff', size: 22, stroke: 1.9})}</span>
          <div class="snapshot-header-text">
            <span class="snapshot-title">Snapshot</span>
            <span class="mono" style="font-size:11px;color:var(--text-faint)">from Tuto Stewart · ${escapeHtml(ago(activePlan?.last_edited_at || activePlan?.activated_at || activePlan?.created_at))}</span>
            <span class="snapshot-tag">CYCLE HEALTH</span>
          </div>
        </div>
        <div class="snapshot-chips">
          ${renderHealthChip('Execution', executionHealth)}
          ${renderHealthChip('Approvals', approvalsHealth)}
          ${renderHealthChip('Budget', budgetHealth)}
        </div>
        <p class="snapshot-narrative">
          ${renderSnapshotNarrative(executionHealth, approvalsHealth, timeProg)}
        </p>
      </div>
    </section>
  `;
}

function renderHealthChip(label, h) {
  return `
    <span class="health-chip health-chip-${h.tone}" title="${escapeHtml(h.why)}">
      <span class="health-chip-dot health-chip-dot-${h.tone}"></span>
      <strong>${escapeHtml(label)}</strong> · ${escapeHtml(h.label)}
    </span>
  `;
}

function computeExecutionHealth(tasks) {
  const cutoff7d = Date.now() - 7 * 86400000;
  const recent = (tasks || []).filter(t => {
    const c = (t.execution || {}).completed_at;
    return c && new Date(c).getTime() >= cutoff7d;
  }).length;
  if (recent >= 7) return { tone: 'good', label: 'Fast', why: `${recent} tasks shipped in last 7 days` };
  if (recent >= 3) return { tone: 'good', label: 'Steady', why: `${recent} tasks shipped in last 7 days` };
  if (recent >= 1) return { tone: 'warn', label: 'Slow', why: `Only ${recent} task${recent === 1 ? '' : 's'} shipped in last 7 days` };
  return { tone: 'bad', label: 'Stalled', why: 'No tasks completed in the last 7 days' };
}

function computeApprovalsHealth(tasks, meetings) {
  const waitingTasks = (tasks || []).filter(t => (t.status || '').toLowerCase() === 'awaiting_approval');
  const waitingMeetings = (meetings || []).filter(m => m.status === 'requested_by_agent');
  const total = waitingTasks.length + waitingMeetings.length;
  if (total === 0) return { tone: 'good', label: 'Healthy', why: 'Nothing waiting on you' };
  // Oldest age across both
  const allWaiting = [...waitingTasks.map(t => t.proposed_at), ...waitingMeetings.map(m => m.requested_at)];
  const oldest = allWaiting.filter(Boolean).sort()[0];
  const oldestHours = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 3600000) : 0;
  if (total >= 5 || oldestHours > 48) {
    return { tone: 'bad', label: 'Slow', why: `${total} item${total === 1 ? '' : 's'} waiting · oldest ${oldestHours}h` };
  }
  if (total >= 3 || oldestHours > 24) {
    return { tone: 'warn', label: 'Aging', why: `${total} item${total === 1 ? '' : 's'} waiting · oldest ${oldestHours}h` };
  }
  return { tone: 'good', label: 'Healthy', why: `${total} item${total === 1 ? '' : 's'} waiting · oldest ${oldestHours}h` };
}

function renderSnapshotNarrative(exec, approvals, timeProg) {
  // Composed from health states, not LLM-generated (deferred to v2).
  const bits = [];
  if (approvals.tone === 'bad') {
    bits.push(`<strong>The approval queue is the constraint right now.</strong> ${escapeHtml(approvals.why)}.`);
  } else if (approvals.tone === 'warn') {
    bits.push(`Approvals are aging — ${escapeHtml(approvals.why.toLowerCase())}.`);
  } else if (exec.tone === 'good') {
    bits.push(`Execution is ${escapeHtml(exec.label.toLowerCase())} and the approval queue is clear.`);
  } else {
    bits.push(`${escapeHtml(exec.why)}. ${escapeHtml(approvals.why)}.`);
  }
  if (timeProg && timeProg.percentElapsed > 50 && timeProg.remainingDays < 7) {
    bits.push(`<strong>Cycle nearing its target end</strong> — ${timeProg.remainingDays} days left of ${timeProg.totalDays}.`);
  }
  return bits.join(' ');
}

// ============ Velocity card — adapter-run button ============
//
// Triggers the local Paperclip adapter (push approved tasks → pull updates →
// sync) via the meeting server's /adapter/run endpoint. Inline status shows
// running / success / failure. On success, reloads after a moment so the
// fresh substrate is visible. Disabled if the meeting server isn't reachable.

function wireAdapterRunButton() {
  const btn = document.getElementById('run-adapter-btn');
  const statusEl = document.getElementById('run-adapter-status');
  if (!btn || !statusEl) return;

  fetch(`${MEETING_SERVER}/health`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(j => {
      if (!j.ok) {
        btn.disabled = true;
        btn.title = 'Meeting server reachable but reports not-OK';
      }
    })
    .catch(() => {
      btn.disabled = true;
      btn.title = `Local meeting server unreachable (${MEETING_SERVER})`;
    });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    statusEl.textContent = 'Running adapter (push + pull + sync)…';
    statusEl.className = 'vel-actions-status vel-actions-running';
    try {
      const r = await fetch(`${MEETING_SERVER}/adapter/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu: 'tuto' }),
      });
      const j = await r.json();
      if (j.ok) {
        const lastLine = (j.stdout_tail || '').trim().split('\n').slice(-1)[0] || 'sync complete';
        statusEl.textContent = `✓ ${lastLine.slice(0, 200)}`;
        statusEl.className = 'vel-actions-status vel-actions-ok';
        setTimeout(() => window.location.reload(), 2200);
      } else {
        const errMsg = j.message || (j.stderr_tail || '').trim().split('\n').slice(-1)[0] || `HTTP ${r.status}`;
        statusEl.textContent = `✗ failed: ${errMsg.slice(0, 200)}`;
        statusEl.className = 'vel-actions-status vel-actions-fail';
        btn.disabled = false;
      }
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
      statusEl.className = 'vel-actions-status vel-actions-fail';
      btn.disabled = false;
    }
  });
}


// ============ Section 5 — Doctor's Note (GEN-52) ============
//
// Restored from legacy renderDoctor (tuto.js). Source data is identity.health,
// an operator/Stewart-authored block in identity.json with shape:
//   { verdict: 'green'|'yellow'|'red'|'gray', summary, rationale,
//     last_assessed_at, assessed_by }
//
// Distinct from Snapshot's substrate-computed chips: this is the Stewart's
// own qualitative read on the BU — verdict + why, not derived from task counts.
function renderDoctorNoteSection(identity) {
  const h = (identity || {}).health;
  if (!h) {
    return `
      <section>
        <div class="section-rule">
          <span class="card-section-label">05 · Doctor's Note</span>
          <div class="rule-line"></div>
        </div>
        <div class="card doctor-card doctor-card-gray">
          <div class="doctor-empty">
            No health assessment yet. The Stewart hasn't recorded a verdict for this BU.
          </div>
        </div>
      </section>
    `;
  }
  const rawVerdict = (h.verdict || 'gray').toLowerCase();
  const verdict = ['green', 'yellow', 'red', 'gray'].includes(rawVerdict) ? rawVerdict : 'gray';
  const verdictLabel = verdict.charAt(0).toUpperCase() + verdict.slice(1);
  const assessedBy = h.assessed_by || 'unknown';
  const assessedAt = h.last_assessed_at;
  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">05 · Doctor's Note</span>
        <div class="rule-line"></div>
      </div>
      <div class="card doctor-card doctor-card-${verdict}">
        <div class="doctor-header">
          <span class="doctor-verdict doctor-verdict-${verdict}">
            <span class="doctor-verdict-dot doctor-verdict-dot-${verdict}"></span>
            ${escapeHtml(verdictLabel)}
          </span>
          <span class="doctor-meta mono">
            ${assessedAt ? `last assessed ${escapeHtml(ago(assessedAt))} · ` : ''}by ${escapeHtml(assessedBy)}
          </span>
        </div>
        <div class="doctor-summary">${escapeHtml(h.summary || '—')}</div>
        ${h.rationale ? `<div class="doctor-rationale">${escapeHtml(h.rationale)}</div>` : ''}
      </div>
    </section>
  `;
}


// ============ Section 5 — Cycle health (restored from legacy renderCycle, GEN-51) ============
//
// Three legacy views from `tuto.js#renderCycle` (GEN-39 parity audit):
//   - 4-tile phase strip (Cycle phase / Operator queue / Throughput / Last activity)
//   - Initiatives table with Dwell column + ⚠ stuck-Xh badge
//   - Task funnel (counts by status)
//
// Data is derived client-side from existing substrate (initiatives.status_history,
// tasks.status, etc.) rather than reading the legacy cycle_state.json — the v0.6
// Genus app talks directly to substrate, no diagnostic-script intermediate.

const TERMINAL_INITIATIVE_STATES = new Set([
  'completed', 'done', 'discarded', 'abandoned', 'cancelled', 'rejected',
]);

// Stuck threshold per-state, in hours. Mirrors the legacy heuristic in
// renderInitiativeRow (tuto.js): review_required is allowed to dwell longer
// because human review naturally takes days; in-flight states should not
// idle past 24h without movement.
const STUCK_THRESHOLD_H = {
  review_required: 72,
  not_started: 72,
  default: 24,
};

function renderCycleHealthSection(activePlan, initiatives, tasks, meetings, timeProg) {
  const phase = computeCyclePhase(activePlan, timeProg);
  const queue = computeOperatorQueue(tasks, meetings);
  const throughput = computeThroughput(tasks);
  const lastActivity = computeLastActivity(tasks, initiatives, meetings);

  const initRows = computeInitiativeDwell(initiatives);
  const funnel = computeTaskFunnel(tasks);

  return `
    <section>
      <div class="section-rule">
        <span class="card-section-label">06 · Cycle health</span>
        <div class="rule-line"></div>
      </div>

      <div class="card cyc-card">
        <div class="cyc-tile-grid">
          ${cycleTile('Cycle phase', phase)}
          ${cycleTile('Operator queue', queue)}
          ${cycleTile('Throughput', throughput)}
          ${cycleTile('Last activity', lastActivity)}
        </div>

        <div class="cyc-block">
          <div class="cyc-block-head">
            <span class="card-title">Initiatives — dwell time</span>
            <span class="muted-emph">${initRows.filter(r => r.stuck).length} stuck · ${initRows.length} tracked</span>
          </div>
          <p class="card-sub">Hours in current state. ⚠ flag fires past ${STUCK_THRESHOLD_H.default}h for in-flight states, ${STUCK_THRESHOLD_H.review_required}h for review/idle states.</p>
          <table class="cyc-table">
            <thead><tr>
              <th>Initiative</th>
              <th>State</th>
              <th>Linked tasks</th>
              <th class="cyc-th-right">Dwell</th>
            </tr></thead>
            <tbody>
              ${initRows.length === 0
                ? `<tr><td colspan="4" class="cyc-na">No initiatives in this BU.</td></tr>`
                : initRows.map(renderInitDwellRow).join('')}
            </tbody>
          </table>
        </div>

        <div class="cyc-block">
          <div class="cyc-block-head">
            <span class="card-title">Task funnel</span>
            <span class="muted-emph">${funnel.total} task${funnel.total === 1 ? '' : 's'} total</span>
          </div>
          <p class="card-sub">Throughput visualization — counts per status stage.</p>
          ${renderTaskFunnel(funnel)}
        </div>
      </div>
    </section>
  `;
}

function cycleTile(label, t) {
  return `
    <div class="cyc-tile cyc-tile-${t.tone}">
      <div class="cyc-tile-label">${escapeHtml(label)}</div>
      <div class="cyc-tile-value">${escapeHtml(t.value)}</div>
      ${t.sub ? `<div class="cyc-tile-sub">${escapeHtml(t.sub)}</div>` : ''}
    </div>
  `;
}

function computeCyclePhase(activePlan, timeProg) {
  if (!activePlan) {
    return { value: 'No active cycle', sub: 'create a plan to begin', tone: 'gray' };
  }
  if (!timeProg) {
    return { value: 'Planning', sub: 'plan dates not set', tone: 'gray' };
  }
  const { percentElapsed, remainingDays } = timeProg;
  if (percentElapsed >= 100) {
    return { value: 'Overdue', sub: `${-remainingDays}d past target`, tone: 'bad' };
  }
  if (percentElapsed >= 80) {
    return { value: 'Closing', sub: `${remainingDays}d remaining`, tone: 'warn' };
  }
  if (percentElapsed >= 20) {
    return { value: 'In flight', sub: `${percentElapsed}% elapsed`, tone: 'good' };
  }
  return { value: 'Kicking off', sub: `${percentElapsed}% elapsed`, tone: 'good' };
}

function computeOperatorQueue(tasks, meetings) {
  const waitingTasks = (tasks || []).filter(t => (t.status || '').toLowerCase() === 'awaiting_approval');
  const waitingMeetings = (meetings || []).filter(m => m.status === 'requested_by_agent');
  const total = waitingTasks.length + waitingMeetings.length;
  if (total === 0) {
    return { value: 'Inbox zero', sub: 'nothing waiting', tone: 'good' };
  }
  const allAt = [
    ...waitingTasks.map(t => t.proposed_at),
    ...waitingMeetings.map(m => m.requested_at),
  ].filter(Boolean).sort();
  const oldest = allAt[0];
  const oldestH = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 3600000) : 0;
  const tone = (total >= 5 || oldestH > 48) ? 'bad' : (total >= 3 || oldestH > 24) ? 'warn' : 'good';
  return {
    value: `${total} waiting`,
    sub: oldest ? `oldest ${oldestH}h` : '',
    tone,
  };
}

function computeThroughput(tasks) {
  const cutoff24h = Date.now() - 86400000;
  const cutoff7d = Date.now() - 7 * 86400000;
  let last24 = 0;
  let last7 = 0;
  for (const t of tasks || []) {
    const c = (t.execution || {}).completed_at;
    if (!c) continue;
    const ts = new Date(c).getTime();
    if (isNaN(ts)) continue;
    if (ts >= cutoff7d) last7++;
    if (ts >= cutoff24h) last24++;
  }
  const avgPerDay = (last7 / 7).toFixed(1);
  const tone = last24 >= 3 ? 'good' : last24 >= 1 ? 'warn' : 'bad';
  return {
    value: `${last24}/24h`,
    sub: `${avgPerDay}/day · 7d avg`,
    tone,
  };
}

function computeLastActivity(tasks, initiatives, meetings) {
  let latest = null;
  const consider = (iso) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return;
    if (latest == null || t > latest) latest = t;
  };
  for (const t of tasks || []) {
    consider((t.execution || {}).completed_at);
    consider(t.last_edited_at);
  }
  for (const i of initiatives || []) {
    consider(i.last_edited_at);
    const sh = i.status_history || [];
    if (sh.length) consider(sh[sh.length - 1].at);
  }
  for (const m of meetings || []) {
    consider(m.last_edited_at);
    consider(m.requested_at);
  }
  if (latest == null) {
    return { value: '—', sub: 'no activity logged', tone: 'gray' };
  }
  const hoursAgo = (Date.now() - latest) / 3600000;
  const tone = hoursAgo < 6 ? 'good' : hoursAgo < 24 ? 'warn' : 'bad';
  return {
    value: ago(new Date(latest).toISOString()),
    sub: hoursAgo < 1 ? 'just now' : `${Math.floor(hoursAgo)}h ago`,
    tone,
  };
}

function computeInitiativeDwell(initiatives) {
  return (initiatives || [])
    .filter(i => !TERMINAL_INITIATIVE_STATES.has((i.status || '').toLowerCase()))
    .map(i => {
      const status = (i.status || 'unknown').toLowerCase();
      const sh = i.status_history || [];
      const lastChange = sh.length ? sh[sh.length - 1].at : (i.last_edited_at || i.created_at);
      let dwellH = null;
      if (lastChange) {
        const ms = Date.now() - new Date(lastChange).getTime();
        if (!isNaN(ms)) dwellH = Math.floor(ms / 3600000);
      }
      const threshold = STUCK_THRESHOLD_H[status] ?? STUCK_THRESHOLD_H.default;
      const stuck = dwellH != null && dwellH >= threshold;
      return { id: i.id, title: i.title || 'Untitled', status, dwellH, stuck, threshold };
    })
    .sort((a, b) => (b.dwellH || 0) - (a.dwellH || 0));
}

function renderInitDwellRow(r) {
  const stateClass = r.stuck ? 'cyc-state-stuck' : r.dwellH != null && r.dwellH >= 6 ? 'cyc-state-aging' : 'cyc-state-fresh';
  const dwellLabel = r.dwellH == null ? '—' : `${r.dwellH}h`;
  const badge = r.stuck
    ? `<span class="cyc-stuck-badge">⚠ stuck ${r.dwellH}h</span>`
    : r.dwellH != null && r.dwellH >= 6
      ? `<span class="cyc-stuck-badge cyc-stuck-badge-soft">in ${escapeHtml(r.status.replace(/_/g, ' '))} for ${r.dwellH}h</span>`
      : '';
  return `
    <tr>
      <td>
        <div class="cyc-init-id mono">${escapeHtml(r.id)}</div>
        <div class="cyc-init-title">${escapeHtml(r.title)}</div>
      </td>
      <td><span class="cyc-state-pill ${stateClass}">${escapeHtml(r.status.replace(/_/g, ' '))}</span></td>
      <td class="cyc-na">—</td>
      <td class="cyc-th-right">
        <div class="cyc-dwell-cell">
          <span class="cyc-dwell-val mono">${dwellLabel}</span>
          ${badge}
        </div>
      </td>
    </tr>
  `;
}

// Funnel stage order matches the natural left-to-right flow of work through
// statuses. Statuses outside this list get bucketed under "other" at the end.
const FUNNEL_ORDER = [
  'not_started',
  'work_ready',
  'awaiting_approval',
  'approved',
  'executing',
  'in_progress',
  'pushed',
  'done',
  'blocked',
  'failed',
];

function computeTaskFunnel(tasks) {
  const counts = {};
  let total = 0;
  for (const t of tasks || []) {
    const s = (t.status || 'unknown').toLowerCase();
    // Exclude cancelled/rejected from the funnel — they're not in-flight work.
    if (s === 'cancelled' || s === 'rejected') continue;
    counts[s] = (counts[s] || 0) + 1;
    total++;
  }
  const stages = [];
  for (const k of FUNNEL_ORDER) {
    if (counts[k]) stages.push({ key: k, count: counts[k] });
  }
  for (const k of Object.keys(counts)) {
    if (!FUNNEL_ORDER.includes(k)) stages.push({ key: k, count: counts[k] });
  }
  return { stages, total };
}

function renderTaskFunnel(funnel) {
  if (funnel.total === 0) {
    return `<div class="empty-state">No tasks tracked in this BU yet.</div>`;
  }
  const max = Math.max(1, ...funnel.stages.map(s => s.count));
  return `
    <div class="cyc-funnel">
      ${funnel.stages.map(s => {
        const widthPct = Math.round((s.count / max) * 100);
        return `
          <div class="cyc-funnel-row">
            <div class="cyc-funnel-key">${escapeHtml(s.key.replace(/_/g, ' '))}</div>
            <div class="cyc-funnel-track">
              <div class="cyc-funnel-fill cyc-funnel-fill-${s.key}" style="width:${Math.max(2, widthPct)}%"></div>
            </div>
            <div class="cyc-funnel-count mono">${s.count}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
