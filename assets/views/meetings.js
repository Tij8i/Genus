// Roadmap i107 — Meetings view.
// Route: #meetings

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { renderStatTiles } from '../components/stat-tiles.js';

export async function renderMeetings() {
  const root = document.getElementById('route-meetings');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading meetings…</div>';

  let payload;
  try {
    const res = await fetch(`/api/meetings?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.message);
  } catch (e) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:40px 28px;color:#c12525;">Could not load meetings: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const meetings = payload.meetings || [];
  const live = meetings.filter(m => !m.adjourned_at).length;
  const withDecisions = meetings.filter(m => (m.outcomes || []).some(o => o.kind === 'decision')).length;

  const stats = [
    { label: 'TOTAL', value: meetings.length, sub: 'all-time' },
    { label: 'LIVE', value: live, sub: 'in progress', color: live > 0 ? '#238c46' : '#9aa1ae' },
    { label: 'ADJOURNED', value: meetings.length - live, sub: 'closed' },
    { label: 'W/ DECISIONS', value: withDecisions, sub: 'filed to Decisions' },
  ];

  const meetingCard = (m) => {
    const isLive = !m.adjourned_at;
    return `<a href="#meetings/${escapeHtml(m.id)}" style="display:block;text-decoration:none;color:inherit;padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${isLive ? '#238c46' : '#5b6270'};border-radius:11px;transition:transform .12s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        ${isLive ? `<span style="font:700 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#e3ede2;color:#238c46;">● LIVE</span>` : `<span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#eef0f4;color:#5b6270;">ADJOURNED</span>`}
        <span style="font-size:14px;font-weight:600;color:#16181e;flex:1;">${escapeHtml(m.title)}</span>
        ${m.module_id ? `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(m.module_id)}</span>` : ''}
      </div>
      ${m.goal ? `<div style="font-size:12.5px;color:#5b6270;line-height:1.5;margin-bottom:8px;">${escapeHtml(m.goal)}</div>` : ''}
      <div style="display:flex;gap:12px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">
        <span>👥 ${(m.attendees || []).length}</span>
        <span>📝 ${(m.agenda || []).length} agenda</span>
        <span>✓ ${(m.outcomes || []).length} outcomes</span>
      </div>
    </a>`;
  };

  root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:20px;">
      <div>
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#3468d6;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(bu.toUpperCase())} · CORE</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">Meetings</h1>
        <div style="font-size:13.5px;color:#5b6270;margin-top:4px;">Multi-agent, agenda-driven. Escalation home for stalling chats. Adjourn files minutes to the module, decisions to Decisions, tasks to the pool.</div>
      </div>
      <button type="button" id="meeting-new-btn" style="padding:9px 16px;background:#3468d6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">+ Convene</button>
    </div>
    ${renderStatTiles(stats)}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${meetings.length === 0 ? `<div style="padding:32px;text-align:center;color:#9aa1ae;background:#fff;border:1.5px dashed rgba(20,22,28,.14);border-radius:12px;">No meetings yet. Convene one when a chat needs to become a decision.</div>` : meetings.map(meetingCard).join('')}
    </div>
  </div>`;

  document.getElementById('meeting-new-btn')?.addEventListener('click', async () => {  // eslint-disable-line
    return _createMeetingHandler(bu);
  });
}

async function _createMeetingHandler(bu) {
    const title = prompt('Meeting title:'); if (!title) return;
    const goal = prompt('Goal (what needs to be decided?):') || '';
    const agendaStr = prompt('Agenda (comma-separated items):') || '';
    const agenda = agendaStr.split(',').map(s => s.trim()).filter(Boolean);
    const module_id = prompt('Module (optional — leave blank for core):') || null;
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, action: 'start', title, goal, agenda, module_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        alert(`Could not convene (HTTP ${res.status}): ${j.message || 'unknown error — check DevTools Network tab for details'}`);
        return;
      }
      await renderMeetings();
    } catch (e) { alert(`Could not convene: ${e.message}`); }
}

// Live-meeting three-column detail view. Route: #meetings/{id}
export async function renderMeetingDetail() {
  const root = document.getElementById('route-meetings');
  if (!root) return;
  const bu = currentBu();
  const id = (window.location.hash || '').replace(/^#meetings\//, '').trim();
  if (!id) { await renderMeetings(); return; }

  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading meeting…</div>';
  let payload;
  try {
    const res = await fetch(`/api/meetings?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    payload = await res.json();
  } catch (e) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:40px 28px;color:#c12525;">Could not load meeting: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const meeting = (payload?.meetings || []).find(m => m.id === id);
  if (!meeting) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:40px 28px;color:#9aa1ae;">Meeting not found. <a href="#meetings" style="color:#3468d6;">Back to list</a></div>`;
    return;
  }

  const isLive = !meeting.adjourned_at;
  const attendees = meeting.attendees || [];
  const agenda = meeting.agenda || [];
  const outcomes = meeting.outcomes || [];

  root.innerHTML = `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:0;min-height:calc(100vh - 120px);">
      <!-- Meeting rail -->
      <aside style="background:#fbfbfa;border-right:1px solid rgba(20,22,28,.08);padding:22px 20px;overflow-y:auto;">
        <a href="#meetings" style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;text-decoration:none;">← Meetings</a>
        <h1 style="font-size:18px;font-weight:800;margin:12px 0 4px;line-height:1.3;">${escapeHtml(meeting.title)}</h1>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          ${isLive ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;background:rgba(35,140,70,.10);color:#238c46;border-radius:99px;font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.06em;"><span style="width:7px;height:7px;border-radius:99px;background:#238c46;animation:pulseDot 1.6s infinite;"></span>LIVE</span>` : `<span style="padding:3px 10px;background:#eef0f4;color:#5b6270;border-radius:99px;font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;">ADJOURNED</span>`}
        </div>
        ${meeting.goal ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:6px;">Goal</div><div style="font-size:12.5px;color:#3a3f4a;line-height:1.5;margin-bottom:16px;">${escapeHtml(meeting.goal)}</div>` : ''}
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:8px;">Agenda</div>
        <ol style="margin:0;padding-left:0;list-style:none;font-size:12.5px;">
          ${agenda.map(a => `<li style="padding:6px 0;color:${a.status === 'done' ? '#9aa1ae' : (a.status === 'current' ? '#238c46' : '#5b6270')};${a.status === 'done' ? 'text-decoration:line-through;' : ''}">${a.status === 'done' ? '✓' : (a.status === 'current' ? '▸' : '·')} ${escapeHtml(a.title)}</li>`).join('')}
        </ol>
        ${outcomes.length > 0 ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin:16px 0 8px;">Outcomes</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${outcomes.map(o => `<div style="padding:8px 10px;background:#fff;border-left:3px solid ${o.kind === 'decision' ? '#238c46' : '#3468d6'};border-radius:6px;font-size:12px;color:#3a3f4a;line-height:1.4;"><span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.10em;text-transform:uppercase;color:${o.kind === 'decision' ? '#238c46' : '#3468d6'};">${escapeHtml(o.kind)}</span><br>${escapeHtml(o.title || o.body || '')}</div>`).join('')}
          </div>` : ''}
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px;">
          ${isLive ? `<button type="button" id="meet-advance" style="padding:8px 12px;background:#3468d6;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">Advance agenda ↓</button>
            <button type="button" id="meet-add-decision" style="padding:8px 12px;background:#238c46;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">+ Decision</button>
            <button type="button" id="meet-add-task" style="padding:8px 12px;background:#7a4dff;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">+ Task</button>
            <button type="button" id="meet-adjourn" style="padding:8px 12px;background:#fbfbfa;color:#5b6270;border:1px solid rgba(20,22,28,.14);border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;margin-top:6px;">Adjourn → file minutes</button>` : ''}
        </div>
      </aside>

      <!-- Thread -->
      <main style="padding:22px 30px;overflow-y:auto;background:#fff;">
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:10px;">Attendees</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px;">
          ${attendees.map(a => `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#f5f6f8;border-radius:99px;font-size:12px;color:#3a3f4a;"><span style="width:22px;height:22px;border-radius:99px;background:#3468d6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${escapeHtml(a.charAt(0).toUpperCase())}</span>${escapeHtml(a)}</span>`).join('')}
        </div>
        <div style="padding:20px 24px;background:#fbfbfa;border-radius:12px;border:1px dashed rgba(20,22,28,.12);text-align:center;color:#9aa1ae;">
          <div style="font-size:13.5px;margin-bottom:6px;color:#5b6270;">Live thread wire-up is v0.9 minimal.</div>
          <div style="font-size:12.5px;">Multi-agent messages will render here in v1.0. For now, use the persistent chat dock (bottom-right) to talk to Genus about this meeting. Advance / capture outcomes / adjourn via the rail on the left.</div>
        </div>
      </main>
    </div>
  `;

  // Wire actions
  document.getElementById('meet-advance')?.addEventListener('click', async () => {
    await fetch('/api/meetings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'advance_agenda', meeting_id: id }),
    });
    await renderMeetingDetail();
  });
  document.getElementById('meet-add-decision')?.addEventListener('click', async () => {
    const title = prompt('Decision:'); if (!title) return;
    await fetch('/api/meetings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'add_outcome', meeting_id: id, kind: 'decision', title }),
    });
    await renderMeetingDetail();
  });
  document.getElementById('meet-add-task')?.addEventListener('click', async () => {
    const title = prompt('Task:'); if (!title) return;
    await fetch('/api/meetings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'add_outcome', meeting_id: id, kind: 'task', title }),
    });
    await renderMeetingDetail();
  });
  document.getElementById('meet-adjourn')?.addEventListener('click', async () => {
    if (!confirm('Adjourn this meeting? Minutes/decisions/tasks will be filed to their homes.')) return;
    await fetch('/api/meetings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'adjourn', meeting_id: id }),
    });
    await renderMeetingDetail();
  });
}
