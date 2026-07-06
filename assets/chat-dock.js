// Roadmap i108 — persistent chat dock.
// Gmail-grammar floating conversations docked bottom-right. Genus pinned
// leftmost. Steward + topic chats spawn as sibling tabs. Three sizes:
// minimised tab → open panel → full page.
//
// v0.9 ships the shell + Genus tab wired to the existing meeting server.
// Multi-Steward tabs + full-page mode + persistence-across-reload wire in
// via the same primitives; scope kept tight for v0.9.

import { startMeeting } from './meeting.js';
import { escapeHtml, currentBu } from './views/workflows/_shared.js';

const STORE_KEY = 'genus.chat-dock.state';

let dockState = { tabs: [{ id: 'genus', label: 'Genus', kind: 'genus', minimised: true, unread: 0 }] };

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) dockState = JSON.parse(raw);
  } catch (_) {}
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
    host.style.cssText = 'position:fixed;bottom:0;right:16px;z-index:60;display:flex;align-items:flex-end;gap:6px;pointer-events:none;';
    document.body.appendChild(host);
  }
  renderDock();
}

function renderDock() {
  const host = document.getElementById('chat-dock-host');
  if (!host) return;
  host.innerHTML = dockState.tabs.map(renderTab).join('');
  dockState.tabs.forEach(t => {
    document.getElementById(`chat-tab-${t.id}`)?.addEventListener('click', () => openTab(t.id));
  });
}

function renderTab(t) {
  const isGenus = t.kind === 'genus';
  const bg = isGenus ? '#16181e' : '#fbfbfa';
  const fg = isGenus ? '#fbfbfa' : '#16181e';
  const border = isGenus ? '#16181e' : 'rgba(20,22,28,.12)';
  const unread = (t.unread || 0) > 0 ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:#d69a2b;color:#fff;font-size:10px;font-weight:700;border-radius:99px;padding:0 6px;min-width:16px;height:16px;margin-left:6px;">${t.unread}</span>` : '';
  return `<button type="button" id="chat-tab-${escapeHtml(t.id)}" style="pointer-events:auto;display:inline-flex;align-items:center;gap:6px;background:${bg};color:${fg};border:1px solid ${border};border-bottom:none;padding:8px 14px;border-radius:10px 10px 0 0;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;box-shadow:0 -4px 12px rgba(20,22,28,.08);">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    ${escapeHtml(t.label)}${unread}
  </button>`;
}

function openTab(id) {
  const tab = dockState.tabs.find(t => t.id === id);
  if (!tab) return;
  tab.unread = 0;
  tab.minimised = false;
  saveState();

  const bu = currentBu();
  if (tab.kind === 'genus') {
    // v0.9: reuse meeting-server chat as the vehicle. The dock triggers a
    // persistent Genus meeting; conversation continuity is at the server layer.
    startMeeting({
      bu,
      agent_id: 'genus-agent',
      title: 'Genus',
      purpose: 'chat-dock',
      opening_prompt: 'The operator opened the Genus chat dock. Greet briefly, ask what they want to work on. Chat context is the whole venture.',
    });
  } else if (tab.kind === 'steward') {
    startMeeting({
      bu,
      agent_id: tab.agent_id,
      title: tab.label,
      purpose: 'steward-chat',
      opening_prompt: `Operator opened chat with you (${tab.label}), scoped to your module. Answer their questions or wait for a prompt.`,
    });
  }
  renderDock();
}

// Public helper for spawning a Steward tab from a module page.
export function openStewardTab({ id, label, agent_id }) {
  loadState();
  if (!dockState.tabs.find(t => t.id === id)) {
    dockState.tabs.push({ id, label, kind: 'steward', agent_id, minimised: false, unread: 0 });
  }
  saveState();
  renderDock();
  openTab(id);
}
