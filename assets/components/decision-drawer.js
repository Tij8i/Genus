// Roadmap i46 — shared component.
// Right-side detail drawer with scrim + panel. Used by roadmap card detail,
// decision (ADR) detail, KPI detail, task detail, and any future
// "click a card, see the details" pattern.
//
// Usage:
//   import { openDrawer, closeDrawer } from '../components/decision-drawer.js';
//   openDrawer({
//     eyebrow: 'PRODUCT · ROADMAP',
//     title: 'i14 Genus Agent area modelling',
//     headerRight: statusChip,
//     bodyHtml: '<p>...</p>',
//     footerHtml: '<button>...</button>' (optional),
//     width: 480 (default),
//     onClose: () => ...
//   });

import { escapeHtml } from '../utils.js';

const HOST_ID = 'overlay-host';

export function openDrawer({ eyebrow, title, headerRight, bodyHtml, footerHtml, width = 480, onClose }) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  host.innerHTML = `
    <div id="dd-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:50;"></div>
    <aside id="dd-panel" style="position:fixed;top:0;right:0;height:100%;width:${width}px;max-width:92vw;background:#fbfbfc;border-left:1px solid rgba(20,22,28,.1);box-shadow:-20px 0 50px rgba(16,18,28,.16);z-index:51;display:flex;flex-direction:column;">
      <div style="padding:20px 22px 16px;border-bottom:1px solid rgba(20,22,28,.06);">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:10px;">
          <div style="flex:1;">
            ${eyebrow ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;">${escapeHtml(eyebrow)}</div>` : ''}
          </div>
          <button type="button" id="dd-close" style="background:none;border:none;font-size:24px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="display:flex;align-items:baseline;gap:12px;">
          <h2 style="font-size:21px;font-weight:800;margin:0;color:#16181d;flex:1;line-height:1.2;">${escapeHtml(title || '')}</h2>
          ${headerRight ? `<div>${headerRight}</div>` : ''}
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 22px 20px;">
        ${bodyHtml || ''}
      </div>
      ${footerHtml ? `<div style="padding:14px 22px;border-top:1px solid rgba(20,22,28,.06);background:#fbfbfc;">${footerHtml}</div>` : ''}
    </aside>
  `;
  const close = () => {
    host.innerHTML = '';
    if (typeof onClose === 'function') onClose();
  };
  document.getElementById('dd-scrim')?.addEventListener('click', close);
  document.getElementById('dd-close')?.addEventListener('click', close);
}

export function closeDrawer() {
  const host = document.getElementById(HOST_ID);
  if (host) host.innerHTML = '';
}
