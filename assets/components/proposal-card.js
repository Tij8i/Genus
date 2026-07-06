// Roadmap i46 — shared component.
// A proposal card with kind badge, title/body, evidence timeline, and
// accept/reject/dismiss buttons. Same shape used by i14 (area-modelling
// proposals) and i41 (discipline rule proposals).
//
// Usage:
//   import { renderProposalCard, wireProposalCards } from '../components/proposal-card.js';
//   const html = renderProposalCard({
//     id, kind, kindLabel, title, body, evidence: [...],
//     createdAt, statusChip
//   });
//   // in wire step:
//   wireProposalCards({
//     onAccept: (id) => ..., onReject: (id) => ..., onDismiss: (id) => ...
//   });

import { escapeHtml } from '../utils.js';

const KIND_STYLE = {
  rename:  { bg: '#e6ebef', fg: '#4a5a67', label: 'RENAME' },
  split:   { bg: '#f3e9d6', fg: '#9a6320', label: 'SPLIT' },
  merge:   { bg: '#e3ede2', fg: '#356845', label: 'MERGE' },
  add:     { bg: 'var(--accent-bg)', fg: 'var(--accent)', label: 'ADD' },
  retire:  { bg: '#fdebe9', fg: '#c12525', label: 'RETIRE' },
  rule:    { bg: '#f5f0ff', fg: '#7a4dff', label: 'RULE' },
};

export function kindPill(kind, override) {
  const s = KIND_STYLE[kind] || { bg: '#eef0f4', fg: '#5b6270', label: (override || kind || '?').toUpperCase() };
  const label = override || s.label;
  return `<span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:${s.bg};color:${s.fg};font-weight:600;">${label}</span>`;
}

export function renderProposalCard({ id, kind, kindLabel, title, body, evidence, createdAt, actionsHtml, borderAccent }) {
  const evList = (evidence || []).slice(0, 6);
  const borderColor = borderAccent || 'var(--accent)';
  return `
    <div class="prop-card" data-prop-id="${escapeHtml(id)}" style="background:#fff;border:1px solid #e0e6f2;border-left:4px solid ${borderColor};border-radius:11px;padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        ${kindPill(kind, kindLabel)}
        <span style="font-size:13.5px;color:var(--text,#16181e);flex:1;line-height:1.4;">${title}</span>
        ${createdAt ? `<span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:10px;color:var(--text-faint,#aab0bb);">${escapeHtml(String(createdAt).slice(0,10))}</span>` : ''}
      </div>
      ${body ? `<div style="font-size:12.5px;color:var(--text-dim,#4a4e58);line-height:1.55;margin-bottom:10px;">${body}</div>` : ''}
      ${evList.length > 0 ? `
        <details style="margin-bottom:12px;">
          <summary style="cursor:pointer;font-size:11.5px;color:var(--accent);font-weight:600;user-select:none;list-style:none;">▸ ${evList.length} signal${evList.length === 1 ? '' : 's'}</summary>
          <ul style="margin:6px 0 0 0;padding-left:16px;font-size:12px;color:var(--text-dim,#4a4e58);line-height:1.5;">
            ${evList.map(e => `<li style="margin-bottom:2px;"><span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:var(--text-faint,#aab0bb);">${escapeHtml(e.t || '?')}</span> — ${escapeHtml(e.signal || '')}</li>`).join('')}
          </ul>
        </details>
      ` : ''}
      ${actionsHtml || ''}
    </div>
  `;
}

// Standard 3-button footer: Dismiss | Reject | Accept
export function standardActions(id, { acceptLabel = 'Accept ↗', rejectLabel = 'Reject', dismissLabel = 'Dismiss' } = {}) {
  return `
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" class="prop-dismiss onboard-cancel" data-prop-id="${escapeHtml(id)}" style="padding:6px 12px;font-size:12px;">${escapeHtml(dismissLabel)}</button>
      <button type="button" class="prop-reject onboard-cancel" data-prop-id="${escapeHtml(id)}" style="padding:6px 12px;font-size:12px;color:#c12525;border-color:#f6cfca;">${escapeHtml(rejectLabel)}</button>
      <button type="button" class="prop-accept onboard-begin" data-prop-id="${escapeHtml(id)}" style="padding:6px 14px;font-size:12px;">${escapeHtml(acceptLabel)}</button>
    </div>
  `;
}

export function wireProposalCards({ onAccept, onReject, onDismiss, rejectPrompt }) {
  if (onAccept) document.querySelectorAll('.prop-accept').forEach(btn => btn.addEventListener('click', () => onAccept(btn.dataset.propId)));
  if (onReject) document.querySelectorAll('.prop-reject').forEach(btn => btn.addEventListener('click', () => {
    const reason = prompt(rejectPrompt || 'Reason for rejection?');
    if (reason === null) return;
    onReject(btn.dataset.propId, reason);
  }));
  if (onDismiss) document.querySelectorAll('.prop-dismiss').forEach(btn => btn.addEventListener('click', () => onDismiss(btn.dataset.propId)));
}
