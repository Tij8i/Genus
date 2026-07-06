// Roadmap i46 — shared component.
// The 4-up (or N-up) stat-tile row used on every module Overview and many
// content pages. Each tile: EYEBROW label + big number + optional sub-line,
// colour-coded, optional deep-link.
//
// Usage:
//   import { renderStatTiles } from '../components/stat-tiles.js';
//   const html = renderStatTiles([
//     { label: 'OPEN', value: 12, sub: '3 overdue', color: '#c12525', href: '#tasks' },
//     ...
//   ]);

import { escapeHtml } from '../utils.js';

export function renderStatTiles(tiles, { gap = 12, columns = null } = {}) {
  const n = tiles.length;
  const cols = columns || (n <= 3 ? n : (n === 7 ? 4 : Math.min(4, n)));
  return `<div style="display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:${gap}px;margin-bottom:18px;">
    ${tiles.map(renderTile).join('')}
  </div>`;
}

function renderTile(t) {
  const value = t.value == null ? '—' : t.value;
  const color = t.color || 'var(--text,#16181e)';
  const inner = `
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--text-faint,#aab0bb);text-transform:uppercase;">${escapeHtml(t.label || '')}</div>
    <div style="font-size:22px;font-weight:800;color:${color};margin-top:4px;line-height:1.1;">${escapeHtml(String(value))}</div>
    ${t.sub ? `<div style="font-size:11.5px;color:var(--text-dim,#4a4e58);margin-top:3px;">${escapeHtml(t.sub)}</div>` : ''}
  `;
  const wrap = 'background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:11px;padding:14px 18px;box-shadow:0 1px 3px rgba(20,22,28,.03);';
  if (t.href) {
    return `<a href="${escapeHtml(t.href)}" style="${wrap}text-decoration:none;display:block;transition:transform .12s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='none'">${inner}</a>`;
  }
  return `<div style="${wrap}">${inner}</div>`;
}
