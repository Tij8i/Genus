// Roadmap i108 — persistent chat dock (three sizes per locked design).
//
// Gmail-grammar floating conversations docked bottom-right.
// - Genus tab pinned leftmost (dark).
// - Steward + topic chats spawn as sibling tabs.
// - Three sizes: minimised tab ↔ open panel (340px × 460px, live chat) ↔ full page
//   (opens the existing meeting overlay against the same meeting_id).
// - Panel is a real chat surface: mounts meeting.js's mountChatSurface so the
//   operator can send/receive while the widget stays docked.
// - meeting_id is persisted per tab in localStorage so closing + reopening
//   (or minimising + restoring) resumes the same conversation.

import { createMeeting, resumeMeeting, openMeetingChat, mountChatSurface } from './meeting.js';
import { escapeHtml, currentBu } from './views/workflows/_shared.js';

const STORE_KEY = 'genus.chat-dock.state';

let dockState = { tabs: [{ id: 'genus', label: 'Genus', kind: 'genus', minimised: true, unread: 0, meeting_id: null }] };

// Per-tab live-meeting objects (kept in memory only — meeting_id + bu round-trip
// to localStorage; the meeting body is refetched via resumeMeeting on reopen).
const tabMeetings = new Map();       // tabId → meeting
const tabUnmounts = new Map();       // tabId → unmount() from mountChatSurface
const tabPending = new Map();        // tabId → true (mount in flight, avoid dupes)

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.tabs?.length > 0) dockState = parsed;
    }
  } catch (_) {}
  // Always keep exactly one genus tab, pinned leftmost
  if (!dockState.tabs.find(t => t.kind === 'genus')) {
    dockState.tabs.unshift({ id: 'genus', label: 'Genus', kind: 'genus', minimised: true, unread: 0, meeting_id: null });
  }
  // Migrate: ensure every tab has meeting_id field
  dockState.tabs.forEach(t => { if (!('meeting_id' in t)) t.meeting_id = null; });
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(dockState)); } catch (_) {}
}

export function mountChatDock() {
  loadState();
  let host = document.getElementById('chat-dock-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'chat-dock-host';
    host.style.cssText = 'position:fixed;bottom:0;right:16px;z-index:60;display:flex;align-items:flex-end;gap:8px;pointer-events:none;';
    document.body.appendChild(host);
  }
  renderDock();
}

function unmountAll() {
  tabUnmounts.forEach((fn) => { try { fn(); } catch (_) {} });
  tabUnmounts.clear();
}

function renderDock() {
  const host = document.getElementById('chat-dock-host');
  if (!host) return;
  // Tear down any live chat surfaces before wiping innerHTML — otherwise
  // their poll timers keep running against orphaned DOM (leaks + noise).
  unmountAll();
  host.innerHTML = dockState.tabs.map(t => t.minimised ? renderTab(t) : renderPanel(t)).join('');

  dockState.tabs.forEach(t => {
    if (t.minimised) {
      document.getElementById(`chat-tab-${t.id}`)?.addEventListener('click', () => setSize(t.id, 'panel'));
    } else {
      document.getElementById(`chat-min-${t.id}`)?.addEventListener('click', (e) => { e.stopPropagation(); setSize(t.id, 'tab'); });
      document.getElementById(`chat-full-${t.id}`)?.addEventListener('click', (e) => { e.stopPropagation(); openFullPage(t); });
      document.getElementById(`chat-close-${t.id}`)?.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
      // Click anywhere on the header (outside the buttons) minimises the panel —
      // standard Gmail-style behaviour. stopPropagation on the buttons above
      // prevents this from firing when they were the actual target.
      document.getElementById(`chat-header-${t.id}`)?.addEventListener('click', () => setSize(t.id, 'tab'));
      // Kick off the chat surface for open panels
      ensureChatMounted(t);
    }
  });
}

function renderTab(t) {
  const isGenus = t.kind === 'genus';
  const bg = isGenus ? '#16181e' : '#fbfbfa';
  const fg = isGenus ? '#fbfbfa' : '#16181e';
  const border = isGenus ? '#16181e' : 'rgba(20,22,28,.14)';
  const unread = (t.unread || 0) > 0 ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:#d69a2b;color:#fff;font-size:10px;font-weight:700;border-radius:99px;padding:0 6px;min-width:16px;height:16px;margin-left:6px;">${t.unread}</span>` : '';
  return `<button type="button" id="chat-tab-${escapeHtml(t.id)}" style="pointer-events:auto;display:inline-flex;align-items:center;gap:6px;background:${bg};color:${fg};border:1px solid ${border};border-bottom:none;padding:8px 14px;border-radius:10px 10px 0 0;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;box-shadow:0 -4px 12px rgba(20,22,28,.10);">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    ${escapeHtml(t.label)}${unread}
  </button>`;
}

function renderPanel(t) {
  const isGenus = t.kind === 'genus';
  const headerBg = isGenus ? '#16181e' : '#fbfbfa';
  const headerFg = isGenus ? '#fbfbfa' : '#16181e';
  return `<div id="chat-panel-${escapeHtml(t.id)}" style="pointer-events:auto;width:340px;height:460px;background:#fff;border:1px solid rgba(20,22,28,.14);border-radius:12px 12px 0 0;box-shadow:0 -8px 32px rgba(20,22,28,.18);display:flex;flex-direction:column;overflow:hidden;">
    <div id="chat-header-${escapeHtml(t.id)}" title="Click to minimise" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${headerBg};color:${headerFg};border-bottom:1px solid rgba(20,22,28,.08);flex:0 0 auto;cursor:pointer;user-select:none;">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ${escapeHtml(t.label)}
      </div>
      <div style="display:flex;gap:4px;">
        <button type="button" id="chat-min-${escapeHtml(t.id)}" title="Minimise to tab" style="background:none;border:none;color:${headerFg};font-size:16px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">▁</button>
        <button type="button" id="chat-full-${escapeHtml(t.id)}" title="Open full page" style="background:none;border:none;color:${headerFg};font-size:14px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">⤢</button>
        <button type="button" id="chat-close-${escapeHtml(t.id)}" title="Close" style="background:none;border:none;color:${headerFg};font-size:16px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">✕</button>
      </div>
    </div>
    <div id="chat-panel-body-${escapeHtml(t.id)}" class="chat-panel-body" style="flex:1;min-height:0;display:flex;flex-direction:column;background:#fbfbfa;">
      <div class="chat-panel-loading" style="flex:1;display:flex;align-items:center;justify-content:center;color:#9aa1ae;font-size:12px;">connecting…</div>
    </div>
  </div>`;
}

async function ensureChatMounted(t) {
  if (tabPending.get(t.id)) return;
  tabPending.set(t.id, true);
  try {
    const host = document.getElementById(`chat-panel-body-${t.id}`);
    if (!host) return;
    const bu = currentBu();
    let meeting = tabMeetings.get(t.id);

    // If we already have a live meeting in memory, mount straight away.
    if (meeting) {
      mountInto(host, meeting, bu, t.id);
      return;
    }

    // Try to resume by meeting_id first
    if (t.meeting_id) {
      meeting = await resumeMeeting({ bu, meeting_id: t.meeting_id });
    }

    // Fresh start if resume failed or no prior meeting_id
    if (!meeting) {
      meeting = await createMeetingForTab(t, bu);
      if (meeting) {
        t.meeting_id = meeting.id;
        saveState();
      }
    }

    if (!meeting) {
      // Local server offline or start failed — show a fallback CTA
      renderOfflineFallback(host, t);
      return;
    }

    tabMeetings.set(t.id, meeting);
    mountInto(host, meeting, bu, t.id);
  } finally {
    tabPending.delete(t.id);
  }
}

function mountInto(host, meeting, bu, tabId) {
  host.innerHTML = '';
  const unmount = mountChatSurface(host, meeting, { bu, mode: 'panel' });
  tabUnmounts.set(tabId, unmount);
}

async function createMeetingForTab(t, bu) {
  // If the tab carries a caller-supplied prompt (from openChatDocked), use
  // that. Otherwise fall back to the archetype default.
  if (t.opening_prompt || t.purpose) {
    return await createMeeting({
      bu,
      agent_id: t.agent_id || (t.kind === 'genus' ? 'genus-agent' : null),
      title: t.label,
      purpose: t.purpose || (t.kind === 'genus' ? 'chat-dock' : 'steward-chat'),
      opening_prompt: t.opening_prompt || null,
      related_item: t.related_item || null,
    });
  }
  if (t.kind === 'genus') {
    return await createMeeting({
      bu,
      agent_id: 'genus-agent',
      title: 'Genus',
      purpose: 'chat-dock',
      opening_prompt: 'The operator opened the Genus chat. Greet briefly, ask what they want to work on. Chat context is the whole venture.',
    });
  }
  if (t.kind === 'steward') {
    return await createMeeting({
      bu,
      agent_id: t.agent_id,
      title: t.label,
      purpose: 'steward-chat',
      opening_prompt: `Operator opened chat with you (${t.label}), scoped to your module.`,
    });
  }
  return null;
}

function renderOfflineFallback(host, t) {
  host.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;color:#5b6270;font-size:12.5px;line-height:1.55;gap:10px;">
      <div style="font-weight:600;color:#16181e;">Local chat server offline</div>
      <div style="font-size:11.5px;color:#9aa1ae;">Start it to chat with ${escapeHtml(t.label)}.</div>
      <button type="button" id="chat-retry-${escapeHtml(t.id)}" style="margin-top:6px;padding:8px 14px;background:#3468d6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;">Retry</button>
    </div>
  `;
  document.getElementById(`chat-retry-${t.id}`)?.addEventListener('click', () => ensureChatMounted(t));
}

function setSize(id, size) {
  const tab = dockState.tabs.find(t => t.id === id);
  if (!tab) return;
  tab.minimised = (size === 'tab');
  tab.unread = 0;
  saveState();
  renderDock();
}

function closeTab(id) {
  const idx = dockState.tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  // Never close the Genus tab; just minimise it. Keep meeting_id so resume works.
  if (dockState.tabs[idx].kind === 'genus') {
    dockState.tabs[idx].minimised = true;
  } else {
    // For steward tabs: clear the in-memory meeting; leave the server-side
    // meeting alive so a reopen with the same tab id could still resume it.
    // Removing the tab also clears the tab record entirely.
    tabMeetings.delete(id);
    const unmount = tabUnmounts.get(id);
    if (unmount) { try { unmount(); } catch (_) {} tabUnmounts.delete(id); }
    dockState.tabs.splice(idx, 1);
  }
  saveState();
  renderDock();
}

async function openFullPage(t) {
  const bu = currentBu();
  let meeting = tabMeetings.get(t.id);
  // If we don't have a live one in memory but a meeting_id is on the tab,
  // resume it so the full page opens the same conversation.
  if (!meeting && t.meeting_id) {
    meeting = await resumeMeeting({ bu, meeting_id: t.meeting_id });
    if (meeting) tabMeetings.set(t.id, meeting);
  }
  if (!meeting) {
    meeting = await createMeetingForTab(t, bu);
    if (meeting) {
      tabMeetings.set(t.id, meeting);
      t.meeting_id = meeting.id;
      saveState();
    }
  }
  if (meeting) openMeetingChat(meeting, { bu });
}

// Public helper for spawning a Steward tab from a module page.
export function openStewardTab({ id, label, agent_id }) {
  loadState();
  if (!dockState.tabs.find(t => t.id === id)) {
    dockState.tabs.push({ id, label, kind: 'steward', agent_id, minimised: false, unread: 0, meeting_id: null });
  } else {
    const t = dockState.tabs.find(tt => tt.id === id);
    t.minimised = false;
  }
  saveState();
  renderDock();
}

// Rich entry point for callers that want to open a chat with a specific
// starting prompt / purpose / related item, always docked as a small panel
// (not the full-screen overlay). Replaces direct startMeeting() calls from
// views that used to take over the screen.
//
// opts:
//   bu, agent_id, label         — required
//   kind                        — 'steward' | 'genus' | 'agent'  (default: 'agent')
//   purpose, opening_prompt     — passed through to the meeting server
//   related_item                — passed through to the meeting server
//   tab_id                      — override the auto-generated tab id
//   fresh                       — if true, start a new conversation even if a
//                                 tab already exists for this id (drops the
//                                 in-memory meeting; server-side history stays)
export function openChatDocked({
  bu, agent_id, label,
  kind = 'agent',
  purpose = null, opening_prompt = null, related_item = null,
  tab_id = null, fresh = false,
} = {}) {
  loadState();
  const id = tab_id || `${kind}-${agent_id}-${bu}`;
  const existing = dockState.tabs.find(t => t.id === id);
  if (existing) {
    existing.minimised = false;
    existing.label = label || existing.label;
    if (fresh) {
      existing.meeting_id = null;
      tabMeetings.delete(id);
    }
    // Only set caller-supplied prompt/purpose on a fresh meeting — mid-thread
    // resumption should keep whatever prompt seeded the current transcript.
    if (fresh || !existing.meeting_id) {
      existing.purpose = purpose;
      existing.opening_prompt = opening_prompt;
      existing.related_item = related_item;
    }
  } else {
    dockState.tabs.push({
      id, label, kind, agent_id,
      minimised: false, unread: 0, meeting_id: null,
      purpose, opening_prompt, related_item,
    });
  }
  saveState();
  renderDock();
}
