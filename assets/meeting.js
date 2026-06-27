// Meeting chat — extracted helper used by views that need to start a meeting
// with an agent (Layers → Genus Agent, future surfaces too). The legacy copy
// in views/inputs.js predates this module and is left intact; this file is
// the canonical reuse point going forward.

import { escapeHtml, ago } from './utils.js';
import { openOverlay, closeOverlay } from './overlay.js';

const MEETING_SERVER = 'http://localhost:8765';

let meetingServerUp = null;

async function checkMeetingServer() {
  try {
    const r = await fetch(`${MEETING_SERVER}/health`, { cache: 'no-store' });
    const j = await r.json();
    meetingServerUp = !!j.ok;
    return meetingServerUp;
  } catch (_) {
    meetingServerUp = false;
    return false;
  }
}

// Start a meeting with an agent. opts:
//   bu       — BU id ('genus' | 'medivara' | ...)
//   agent_id — agent id ('genus-agent' | 'tuto-stewart' | ...)
//   title    — meeting title shown in chat overlay header
//   purpose  — short purpose tag (used in ownership directive)
//   opening_prompt — optional seed message the agent will reply to first
// Returns the started meeting, or null on failure (alert is surfaced).
export async function startMeeting({ bu, agent_id, title, purpose, opening_prompt }) {
  const ok = await checkMeetingServer();
  if (!ok) {
    alert(`Local meeting server unreachable at ${MEETING_SERVER}. Start it (launchctl kickstart -k gui/$(id -u)/com.tij8i.genus-meetings) and try again.`);
    return null;
  }
  try {
    const r = await fetch(`${MEETING_SERVER}/meeting/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bu,
        agent_id,
        title: title || 'Meeting',
        purpose: purpose || 'general',
        opening_prompt: opening_prompt || null,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    openMeetingChat(j.meeting, { bu });
    return j.meeting;
  } catch (e) {
    alert(`Could not start meeting: ${e.message}`);
    return null;
  }
}

export function openMeetingChat(meeting, { bu }) {
  const subtitle = `${meeting.agent_id || 'agent'} · ${meeting.purpose || 'meeting'} · started ${ago(meeting.started_at || meeting.requested_at)}`;
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
  });
  scrollChatToBottom();
  wireChatHandlers(meeting, { bu });
  hydrateMeetingTranscript(meeting, bu);
}

async function hydrateMeetingTranscript(meeting, bu) {
  try {
    const r = await fetch(`${MEETING_SERVER}/meetings?bu=${encodeURIComponent(bu)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.meetings)) return;
    const fresh = j.meetings.find(x => x.id === meeting.id);
    if (!fresh) return;
    if (fresh.status && fresh.status !== meeting.status) meeting.status = fresh.status;
    const freshTurns = fresh.transcript || [];
    if (freshTurns.length <= (meeting.transcript || []).length) return;
    meeting.transcript = freshTurns;
    const thread = document.getElementById('chat-thread');
    if (thread) {
      thread.innerHTML = renderChatTurns(freshTurns);
      scrollChatToBottom();
    }
  } catch (_) { /* keep in-memory */ }
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
  if (meetingServerUp === false) return 'Local meeting server offline — start it to send';
  return `Message ${meeting.agent_id || 'agent'}… (Cmd/Ctrl+Enter to send)`;
}

function chatInputDisabled(meeting) {
  return meeting.status !== 'active' || meetingServerUp === false;
}

function wireChatHandlers(meeting, { bu }) {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const closeBtn = document.getElementById('chat-close-meeting-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!window.confirm('Close this meeting?')) return;
      closeBtn.disabled = true;
      closeBtn.textContent = 'closing…';
      try {
        const r = await fetch(`${MEETING_SERVER}/meeting/close`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu, meeting_id: meeting.id }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
        if (j.meeting) Object.assign(meeting, j.meeting);
        closeOverlay();
      } catch (e) {
        closeBtn.disabled = false;
        closeBtn.textContent = 'Close meeting';
        alert(`Close failed: ${e.message}`);
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
    if (thread && thread.querySelector('.chat-empty')) thread.innerHTML = '';
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
        body: JSON.stringify({ bu, meeting_id: meeting.id, message: text }),
      });
      const j = await r.json();
      document.getElementById('chat-thinking')?.remove();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
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
