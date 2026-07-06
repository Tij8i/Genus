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
    return `<div style="padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${isLive ? '#238c46' : '#5b6270'};border-radius:11px;">
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
    </div>`;
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

  document.getElementById('meeting-new-btn')?.addEventListener('click', async () => {
    const title = prompt('Meeting title:'); if (!title) return;
    const goal = prompt('Goal (what needs to be decided?):') || '';
    const agendaStr = prompt('Agenda (comma-separated items):') || '';
    const agenda = agendaStr.split(',').map(s => s.trim()).filter(Boolean);
    const module_id = prompt('Module (optional — leave blank for core):') || null;
    try {
      await fetch('/api/meetings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, action: 'start', title, goal, agenda, module_id }),
      });
      await renderMeetings();
    } catch (e) { alert(`Could not convene: ${e.message}`); }
  });
}
