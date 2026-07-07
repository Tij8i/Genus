// Roadmap Phase 2 — shared module Overview scaffold.
// Each new module (Learning, HR, Sales, Marketing) uses this to render its
// Overview page with a consistent shape: eyebrow + title + purpose line +
// stat tiles + primary list + "+ New" action.
//
// Usage:
//   renderModuleOverview({
//     mod: 'learning',
//     bu, moduleMeta, // from registry
//     endpoint: '/api/learning?bu=<bu>' | function
//     primaryList: { title, items: [{id, title, sub, chip?}], emptyCopy },
//     onCreate: async () => { title = await showPrompt(...) ... POST create ... }
//   })

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { renderStatTiles } from '../components/stat-tiles.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

export async function loadRegistry() {
  try {
    const res = await fetch('/data/bus/_registry.json', { credentials: 'include' });
    return await res.json();
  } catch { return null; }
}

export async function moduleMetaFor(id) {
  const reg = await loadRegistry();
  return (reg?.available_modules || []).find(m => m.id === id) || null;
}

export function renderModuleShell({ mod, meta, stats, headerRight, bodyHtml }) {
  const color = meta?.color || '#5b6270';
  return `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px;">
      <div style="flex:1;">
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:${color};text-transform:uppercase;margin-bottom:6px;">${escapeHtml((meta?.display_name || mod).toUpperCase())} · MODULE</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0 0 6px;color:#16181d;">${escapeHtml(meta?.display_name || mod)}</h1>
        <div style="font-size:13.5px;color:#5b6270;line-height:1.5;">${escapeHtml(meta?.purpose_line || meta?.summary || '')}</div>
      </div>
      ${headerRight || ''}
    </div>
    ${stats ? renderStatTiles(stats) : ''}
    ${bodyHtml || ''}
  </div>`;
}

export function renderListSection({ title, items, emptyCopy, itemRenderer }) {
  return `<div style="margin-bottom:24px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:10px;">${escapeHtml(title || '')}</div>
    ${items.length === 0
      ? `<div style="padding:28px;text-align:center;background:#fff;border:1.5px dashed rgba(20,22,28,.14);border-radius:12px;color:#9aa1ae;font-size:13px;">${escapeHtml(emptyCopy || 'Empty for now.')}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;">${items.map(itemRenderer).join('')}</div>`}
  </div>`;
}

export function newButton(color = 'var(--accent)') {
  return `<button type="button" id="mod-new-btn" style="display:inline-flex;align-items:center;gap:7px;padding:9px 16px;background:${color};color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;box-shadow:0 2px 8px ${color}44;flex-shrink:0;">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    New
  </button>`;
}

export async function fetchModuleData(bu, module, file) {
  try {
    const res = await fetch(`/data/bus/${bu}/${module}/${file}`, { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function createModuleItem({ bu, module, file, item }) {
  const res = await fetch('/api/module-edit', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bu, module, file, action: 'create', item }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
  return j;
}

// Chat with Steward — spawns a Steward tab in the chat dock (i108)
export async function openStewardChat(mod) {
  try {
    const { openStewardTab } = await import('../chat-dock.js');
    const meta = await moduleMetaFor(mod);
    openStewardTab({
      id: `${mod}-steward`,
      label: `${meta?.display_name || mod} Stewart`,
      agent_id: meta?.stewart_archetype || `${mod}-stewart`,
    });
  } catch (e) { console.warn('steward chat open', e); }
}
