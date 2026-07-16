// Meeting chat — extracted helper used by views that need to start a meeting
// with an agent (Layers → Genus Agent, chat dock, future surfaces too). The
// legacy copy in views/inputs.js predates this module and is left intact; this
// file is the canonical reuse point going forward.
//
// Public API:
//   startMeeting({bu, agent_id, title, purpose, opening_prompt})
//     → creates a new meeting on the local server and opens the full overlay.
//   resumeMeeting({bu, meeting_id})
//     → fetches an existing meeting from the local server. Returns the meeting
//       object (or null if not found / server offline).
//   openMeetingChat(meeting, {bu})
//     → opens the full-page overlay for a meeting.
//   mountChatSurface(hostEl, meeting, {bu, mode})
//     → renders the chat surface (thread + input + send + hydrate + wire)
//       into hostEl. mode: 'overlay' | 'panel'. Multiple mounted surfaces for
//       the same meeting share an in-memory registry and re-render on turn.
//     Returns an unmount() function that stops polling + removes subscription.

import { escapeHtml, ago } from './utils.js';
import { openOverlay, closeOverlay } from './overlay.js';
import { showAlert, showConfirm } from './dialog.js';
import { meetingServerHealth, meetingServerUrl, meetingServerLabel } from './meeting-endpoint.js';

let meetingServerUp = null;

async function checkMeetingServer() {
  const r = await meetingServerHealth();
  meetingServerUp = !!r.ok;
  return meetingServerUp;
}

// In-memory registry so that a mini-panel and a full-page overlay showing the
// same meeting stay in sync when either sends a turn.
//   key = `${bu}:${meeting_id}`
//   value = { meeting, subscribers: Set<() => void> }
const activeMeetings = new Map();

function meetingKey(bu, meeting_id) { return `${bu}:${meeting_id}`; }

function registerMeeting(bu, meeting) {
  const key = meetingKey(bu, meeting.id);
  const existing = activeMeetings.get(key);
  if (existing) {
    // Merge fresh fields into the shared object so all mounted surfaces see them
    Object.assign(existing.meeting, meeting);
    return existing;
  }
  const entry = { meeting, subscribers: new Set() };
  activeMeetings.set(key, entry);
  return entry;
}

function notifyMeetingChanged(bu, meeting_id) {
  const entry = activeMeetings.get(meetingKey(bu, meeting_id));
  if (!entry) return;
  entry.subscribers.forEach(fn => { try { fn(); } catch (_) {} });
}

// Create a meeting server-side without opening any UI. Prefer this over
// startMeeting when the caller manages its own surface (e.g. chat-dock
// wants to render the panel itself and does not want the full overlay
// to flash open). Returns the meeting, or null on failure (alert surfaced).
export async function createMeeting({ bu, agent_id, title, purpose, opening_prompt, related_item }) {
  const ok = await checkMeetingServer();
  if (!ok) {
    await showAlert('No meeting server found. On Docker, the container should expose /api/meetings/*; on macOS with the launchd install, run `launchctl kickstart -k gui/$(id -u)/com.tij8i.genus-meetings` and try again.', { subtitle: 'Meeting server', tone: 'danger' });
    return null;
  }
  try {
    const body = {
      bu,
      agent_id,
      title: title || 'Meeting',
      purpose: purpose || 'general',
      opening_prompt: opening_prompt || null,
    };
    if (related_item) body.related_item = related_item;
    const r = await fetch(meetingServerUrl('new'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
    registerMeeting(bu, j.meeting);
    return j.meeting;
  } catch (e) {
    await showAlert(`Could not start meeting: ${e.message}`, { subtitle: 'Meeting', tone: 'danger' });
    return null;
  }
}

// Backward-compat: create the meeting AND open the full overlay. Prefer
// openChatDocked (from chat-dock.js) for new callers so chats default
// to the small docked panel instead of taking over the screen.
export async function startMeeting(opts) {
  const meeting = await createMeeting(opts);
  if (meeting) openMeetingChat(meeting, { bu: opts.bu });
  return meeting;
}

// Fetch an existing meeting by id. Used by the chat dock to resume a
// conversation when the operator reopens a minimised panel.
export async function resumeMeeting({ bu, meeting_id }) {
  const ok = await checkMeetingServer();
  if (!ok) return null;
  try {
    const r = await fetch(meetingServerUrl('list', `bu=${encodeURIComponent(bu)}`), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.meetings)) return null;
    const found = j.meetings.find(x => x.id === meeting_id);
    if (!found) return null;
    registerMeeting(bu, found);
    return found;
  } catch (_) {
    return null;
  }
}

// Find the most recent still-active meeting for (bu, agent_id). Used by the
// chat dock when a tab was previously removed (✕) and the operator reopens
// the same chat — we resume the existing thread rather than spawning a new
// one, so no conversation is silently lost.
export async function findRecentActiveMeeting({ bu, agent_id }) {
  const ok = await checkMeetingServer();
  if (!ok) return null;
  try {
    const r = await fetch(meetingServerUrl('list', `bu=${encodeURIComponent(bu)}`), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.meetings)) return null;
    // Match either the full agent_id or its short form
    // ('product-stewart-of-genus' ↔ 'product-stewart') since the server aliases
    // them in AGENT_DIRS.
    const short = String(agent_id || '').replace(/-of-[a-z0-9]+$/, '');
    const candidates = j.meetings.filter(m =>
      (m.agent_id === agent_id || m.agent_id === short) && m.status === 'active'
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    const picked = candidates[0];
    registerMeeting(bu, picked);
    return picked;
  } catch (_) {
    return null;
  }
}

export function openMeetingChat(meeting, { bu }) {
  const subtitle = `${meeting.agent_id || 'agent'} · ${meeting.purpose || 'meeting'} · started ${ago(meeting.started_at || meeting.requested_at)}`;
  openOverlay({
    title: meeting.title || 'Meeting',
    subtitle,
    iconHtml: '💬',
    iconTint: '#2f6bff',
    bodyHtml: `<div id="chat-overlay-host" style="height:100%;"></div>`,
  });
  const host = document.getElementById('chat-overlay-host');
  if (host) mountChatSurface(host, meeting, { bu, mode: 'overlay' });
}

// Render the chat surface into hostEl. Returns an unmount() function.
export function mountChatSurface(hostEl, meeting, { bu, mode = 'overlay' } = {}) {
  if (!hostEl) return () => {};
  const entry = registerMeeting(bu, meeting);
  const shared = entry.meeting;

  const isPanel = mode === 'panel';
  hostEl.innerHTML = `
    <div class="chat-host chat-mode-${escapeHtml(mode)}">
      <div class="chat-bar">
        <span class="chat-status mono" data-role="status">status: ${escapeHtml(shared.status || 'unknown')}</span>
        ${shared.status === 'active' && !isPanel
          ? `<button type="button" class="chat-close-btn" data-role="close-meeting">Close meeting</button>`
          : ''}
      </div>
      <div class="chat-thread" data-role="thread">
        ${renderChatTurns(shared.transcript || [])}
      </div>
      <div class="chat-input-row">
        <textarea data-role="input" placeholder="${chatPlaceholder(shared)}" rows="${isPanel ? '1' : '2'}" ${chatInputDisabled(shared) ? 'disabled' : ''}></textarea>
        <button type="button" class="chat-send-btn" data-role="send" ${chatInputDisabled(shared) ? 'disabled' : ''}>Send</button>
      </div>
      ${isPanel ? '' : '<div class="chat-hint mono">Cmd/Ctrl + Enter to send</div>'}
    </div>
  `;

  const thread = hostEl.querySelector('[data-role="thread"]');
  scrollToBottom(thread);

  // Subscribe this surface to shared-meeting changes so a turn sent from
  // another mounted surface (e.g. overlay while panel is also visible)
  // re-renders here.
  const rerender = () => {
    if (!thread) return;
    thread.innerHTML = renderChatTurns(shared.transcript || []);
    scrollToBottom(thread);
    // Refresh status + disabled state
    const statusEl = hostEl.querySelector('[data-role="status"]');
    if (statusEl) statusEl.textContent = `status: ${shared.status || 'unknown'}`;
    const input = hostEl.querySelector('[data-role="input"]');
    const sendBtn = hostEl.querySelector('[data-role="send"]');
    const disabled = chatInputDisabled(shared);
    if (input) { input.disabled = disabled; input.placeholder = chatPlaceholder(shared); }
    if (sendBtn) sendBtn.disabled = disabled;
  };
  entry.subscribers.add(rerender);

  // Kick off one hydrate + a lightweight poll while this surface is mounted.
  // Polling only runs when the tab is visible (Page Visibility API), so
  // background tabs don't hammer the local server.
  let pollTimer = null;
  const doHydrate = () => hydrateSharedMeeting(bu, shared.id);
  doHydrate();
  const startPoll = () => {
    if (pollTimer || document.hidden) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      doHydrate();
    }, 4000);
  };
  const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  const visHandler = () => { document.hidden ? stopPoll() : startPoll(); };
  document.addEventListener('visibilitychange', visHandler);
  startPoll();

  wireChatSurface(hostEl, shared, { bu, isPanel });

  return function unmount() {
    entry.subscribers.delete(rerender);
    stopPoll();
    document.removeEventListener('visibilitychange', visHandler);
  };
}

async function hydrateSharedMeeting(bu, meeting_id) {
  const entry = activeMeetings.get(meetingKey(bu, meeting_id));
  if (!entry) return;
  try {
    const r = await fetch(meetingServerUrl('list', `bu=${encodeURIComponent(bu)}`), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.meetings)) return;
    const fresh = j.meetings.find(x => x.id === meeting_id);
    if (!fresh) return;
    const prevLen = (entry.meeting.transcript || []).length;
    const freshLen = (fresh.transcript || []).length;
    const statusChanged = fresh.status && fresh.status !== entry.meeting.status;
    if (freshLen <= prevLen && !statusChanged) return;
    Object.assign(entry.meeting, fresh);
    notifyMeetingChanged(bu, meeting_id);
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

// Whitelist: bare relative in-app URLs (?bu=..., #route, ?bu=...#route) and
// absolute http/https. Everything else (javascript:, data:, file:, custom
// schemes) is left as literal text — never rendered as a clickable anchor.
function isSafeChatUrl(u) {
  if (!u) return false;
  const trimmed = u.trim();
  if (trimmed.startsWith('?') || trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  return false;
}

// Render markdown [label](url) links + bare http(s) URLs as clickable anchors.
// Runs AFTER escapeHtml — the escaped text still contains literal [, ], (, )
// characters we can pattern-match on.
function linkifyEscaped(text) {
  // Markdown links first (they may embed a URL that would otherwise auto-link).
  let out = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    if (!isSafeChatUrl(url)) return m;
    const external = url.startsWith('http');
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${url}" class="chat-link"${attrs}>${label}</a>`;
  });
  // Then bare absolute URLs that weren't already wrapped.
  out = out.replace(/(?<!["'>])(https?:\/\/[^\s<]+[^\s<.,:;!?)\]])/g, (m) => {
    return `<a href="${m}" class="chat-link" target="_blank" rel="noopener">${m}</a>`;
  });
  return out;
}

function escapeAndLinebreak(s) {
  return linkifyEscaped(escapeHtml(s || '')).replace(/\n/g, '<br>');
}

function scrollToBottom(el) { if (el) el.scrollTop = el.scrollHeight; }

function chatPlaceholder(meeting) {
  if (meeting.status !== 'active' && meeting.status !== 'requested_by_agent') return 'Meeting closed — no new messages';
  if (meetingServerUp === false) return 'Local meeting server offline — start it to send';
  return `Message ${meeting.agent_id || 'agent'}… (Cmd/Ctrl+Enter to send)`;
}

function chatInputDisabled(meeting) {
  return meeting.status !== 'active' || meetingServerUp === false;
}

function wireChatSurface(hostEl, meeting, { bu, isPanel }) {
  const input = hostEl.querySelector('[data-role="input"]');
  const sendBtn = hostEl.querySelector('[data-role="send"]');
  const closeBtn = hostEl.querySelector('[data-role="close-meeting"]');

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      if (!(await showConfirm('Close this meeting?', { subtitle: 'Meeting', okLabel: 'Close meeting', tone: 'danger' }))) return;
      closeBtn.disabled = true;
      closeBtn.textContent = 'closing…';
      try {
        const r = await fetch(meetingServerUrl('close'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu, meeting_id: meeting.id }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
        if (j.meeting) Object.assign(meeting, j.meeting);
        notifyMeetingChanged(bu, meeting.id);
        if (!isPanel) closeOverlay();
      } catch (e) {
        closeBtn.disabled = false;
        closeBtn.textContent = 'Close meeting';
        await showAlert(`Close failed: ${e.message}`, { subtitle: 'Meeting', tone: 'danger' });
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
    const thread = hostEl.querySelector('[data-role="thread"]');
    if (thread && thread.querySelector('.chat-empty')) thread.innerHTML = '';
    const optimisticTurn = { role: 'operator', content: text, at: new Date().toISOString() };
    meeting.transcript = meeting.transcript || [];
    meeting.transcript.push(optimisticTurn);
    if (thread) {
      thread.insertAdjacentHTML('beforeend', renderChatTurn(optimisticTurn));
      thread.insertAdjacentHTML('beforeend', '<div class="chat-thinking" data-role="thinking">thinking…</div>');
      scrollToBottom(thread);
    }
    // Also notify other mounted surfaces so they show the optimistic turn
    notifyMeetingChanged(bu, meeting.id);
    input.value = '';
    try {
      const r = await fetch(meetingServerUrl('turn'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, meeting_id: meeting.id, message: text }),
      });
      const j = await r.json();
      hostEl.querySelector('[data-role="thinking"]')?.remove();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      const fullTranscript = (j.meeting && j.meeting.transcript) || meeting.transcript;
      meeting.transcript = fullTranscript;
      if (j.meeting && j.meeting.status) meeting.status = j.meeting.status;
      notifyMeetingChanged(bu, meeting.id);
    } catch (e) {
      hostEl.querySelector('[data-role="thinking"]')?.remove();
      if (thread) {
        thread.insertAdjacentHTML('beforeend', `<div class="chat-error">Error: ${escapeHtml(e.message || 'failed')}</div>`);
        scrollToBottom(thread);
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
    // In panel mode, plain Enter also sends (no multi-line for the compact widget)
    if (isPanel && e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      send();
    }
  });
  input.focus();
}
