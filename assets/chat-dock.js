// Roadmap i108 — persistent chat dock (three sizes per locked design).
//
// Gmail-grammar floating conversations docked bottom-right.
// - Genus tab pinned leftmost (dark).
// - Steward + topic chats spawn as sibling tabs.
// - Three sizes: minimised tab ↔ open panel (340px × 460px) ↔ full page
//   (opens the existing meeting-server overlay).
// - State persists in localStorage across reloads.

import { startMeeting } from './meeting.js';
import { escapeHtml, currentBu } from './views/workflows/_shared.js';

const STORE_KEY = 'genus.chat-dock.state';

let dockState = { tabs: [{ id: 'genus', label: 'Genus', kind: 'genus', minimised: true, unread: 0 }] };

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
    dockState.tabs.unshift({ id: 'genus', label: 'Genus', kind: 'genus', minimised: true, unread: 0 });
  }
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

function renderDock() {
  const host = document.getElementById('chat-dock-host');
  if (!host) return;
  host.innerHTML = dockState.tabs.map(t => t.minimised ? renderTab(t) : renderPanel(t)).join('');
  // Wire tab clicks (open panel)
  dockState.tabs.forEach(t => {
    if (t.minimised) {
      document.getElementById(`chat-tab-${t.id}`)?.addEventListener('click', () => setSize(t.id, 'panel'));
    } else {
      document.getElementById(`chat-min-${t.id}`)?.addEventListener('click', () => setSize(t.id, 'tab'));
      document.getElementById(`chat-full-${t.id}`)?.addEventListener('click', () => openFullPage(t));
      document.getElementById(`chat-close-${t.id}`)?.addEventListener('click', () => closeTab(t.id));
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
  const inputPlaceholder = isGenus ? 'Ask Genus…' : `Ask ${escapeHtml(t.label)}…`;
  return `<div style="pointer-events:auto;width:340px;height:460px;background:#fff;border:1px solid rgba(20,22,28,.14);border-radius:12px 12px 0 0;box-shadow:0 -8px 32px rgba(20,22,28,.18);display:flex;flex-direction:column;overflow:hidden;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${headerBg};color:${headerFg};border-bottom:1px solid rgba(20,22,28,.08);">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ${escapeHtml(t.label)}
      </div>
      <div style="display:flex;gap:4px;">
        <button type="button" id="chat-min-${escapeHtml(t.id)}" title="Minimise to tab" style="background:none;border:none;color:${headerFg};font-size:16px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">▁</button>
        <button type="button" id="chat-full-${escapeHtml(t.id)}" title="Open full page" style="background:none;border:none;color:${headerFg};font-size:14px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">⤢</button>
        ${isGenus ? '' : `<button type="button" id="chat-close-${escapeHtml(t.id)}" title="Close" style="background:none;border:none;color:${headerFg};font-size:16px;line-height:1;padding:2px 6px;cursor:pointer;opacity:.75;">✕</button>`}
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:14px 16px;font-size:13px;color:#5b6270;line-height:1.55;background:#fbfbfa;">
      <div style="text-align:center;padding:20px 0;color:#9aa1ae;">
        <div style="font-size:12.5px;margin-bottom:6px;">Ready when you are.</div>
        <div style="font-size:11.5px;">Click ⤢ to open the full chat window with ${escapeHtml(t.label)}.</div>
      </div>
    </div>
    <div style="padding:10px 14px;border-top:1px solid rgba(20,22,28,.08);background:#fff;">
      <button type="button" id="chat-full-${escapeHtml(t.id)}-bottom" onclick="document.getElementById('chat-full-${escapeHtml(t.id)}').click()" style="width:100%;padding:9px 14px;background:${isGenus ? '#16181e' : '#3468d6'};color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;">Open full chat →</button>
    </div>
  </div>`;
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
  // Never close the Genus tab; just minimise it.
  if (dockState.tabs[idx].kind === 'genus') {
    dockState.tabs[idx].minimised = true;
  } else {
    dockState.tabs.splice(idx, 1);
  }
  saveState();
  renderDock();
}

function openFullPage(t) {
  const bu = currentBu();
  if (t.kind === 'genus') {
    startMeeting({
      bu,
      agent_id: 'genus-agent',
      title: 'Genus',
      purpose: 'chat-dock',
      opening_prompt: 'The operator opened the Genus chat. Greet briefly, ask what they want to work on. Chat context is the whole venture.',
    });
  } else if (t.kind === 'steward') {
    startMeeting({
      bu,
      agent_id: t.agent_id,
      title: t.label,
      purpose: 'steward-chat',
      opening_prompt: `Operator opened chat with you (${t.label}), scoped to your module.`,
    });
  }
}

// Public helper for spawning a Steward tab from a module page.
export function openStewardTab({ id, label, agent_id }) {
  loadState();
  if (!dockState.tabs.find(t => t.id === id)) {
    dockState.tabs.push({ id, label, kind: 'steward', agent_id, minimised: false, unread: 0 });
  } else {
    const t = dockState.tabs.find(tt => tt.id === id);
    t.minimised = false;
  }
  saveState();
  renderDock();
}
