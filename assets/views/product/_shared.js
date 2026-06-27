// Shared tokens + helpers used across all Product-module views.
// Pulled from the design handoff ~/Desktop/Genus Product.dc.html so all views
// stay visually consistent without each view re-declaring tokens.

import { fetchSubstrateJson } from '../../substrate-client.js';

export const STATUS = {
  planned:     { c: '#9aa1ae', l: 'Planned' },
  in_progress: { c: '#2f6bff', l: 'In progress' },
  shipped:     { c: '#0e9f6e', l: 'Shipped' },
  cut:         { c: '#c0392b', l: 'Cut' },
};

export const VSTATE = {
  shipped:     { c: '#0e9f6e', glyph: '✓', l: 'shipped' },
  in_progress: { c: '#2f6bff', glyph: '◗', l: 'in progress' },
  planned:     { c: '#9aa1ae', glyph: '◌', l: 'planned' },
  ideation:    { c: '#b3b9c4', glyph: '◌', l: 'ideation' },
};

export const VSTATE_SOFT = {
  '#0e9f6e': 'rgba(14,159,110,.10)',
  '#2f6bff': 'rgba(47,107,255,.10)',
  '#9aa1ae': 'rgba(154,161,174,.14)',
  '#b3b9c4': 'rgba(179,185,196,.16)',
};

export const TAG = {
  core:   { c: '#2f6bff', b: 'rgba(47,107,255,.10)', label: 'core' },
  module: { c: '#7a4dff', b: 'rgba(122,77,255,.10)', label: 'module' },
  infra:  { c: '#0e9aa0', b: 'rgba(14,154,160,.10)', label: 'infra' },
};

export const DSTATUS = {
  accepted:   { fg: '#0e9f6e', bg: 'rgba(14,159,110,.10)' },
  proposed:   { fg: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
  superseded: { fg: '#c98a16', bg: 'rgba(201,138,22,.13)' },
  deprecated: { fg: '#9aa1ae', bg: 'rgba(154,161,174,.16)' },
};

export const RSTATUS = {
  shipped:   { fg: '#0e9f6e', bg: 'rgba(14,159,110,.10)', l: 'shipped' },
  partial:   { fg: '#c98a16', bg: 'rgba(201,138,22,.13)', l: 'partially shipped' },
  cancelled: { fg: '#c0392b', bg: 'rgba(192,57,43,.08)',  l: 'cancelled' },
};

export const REL_META = {
  'supersedes':    { fg: '#0e9f6e', bg: 'rgba(14,159,110,.10)' },
  'superseded by': { fg: '#c98a16', bg: 'rgba(201,138,22,.13)' },
  'related':       { fg: '#2f6bff', bg: 'rgba(47,107,255,.10)' },
};

export function currentBu() {
  return new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
}

// Substrate readers — graceful fallback to null so a brand-new BU shows
// empty states instead of breaking. The product module's empty states are
// the "first install" experience.
export async function loadProductFile(bu, file) {
  try {
    return await fetchSubstrateJson(`dashboard/public/data/bus/${bu}/product/${file}`, null);
  } catch (_) {
    return null;
  }
}

export function pageHeader({ eyebrow, title, sub, action }) {
  return `
    <header style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px;">
      <div>
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:8px;">${eyebrow || ''}</div>
        <h1 style="font-size:30px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">${title}</h1>
        ${sub ? `<p style="margin:7px 0 0;color:#6b7280;font-size:14.5px;max-width:620px;">${sub}</p>` : ''}
      </div>
      ${action || ''}
    </header>
  `;
}

export function emptyPanel({ icon, color, title, copy, ctaLabel, ctaHash }) {
  const tintBg = `${color}1a`;
  return `
    <div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;background:#fbfbfc;">
      <span style="width:54px;height:54px;border-radius:14px;background:${tintBg};color:${color};display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">${icon}</span>
      <h3 style="font-size:17px;font-weight:700;letter-spacing:-.01em;margin:0;">${title}</h3>
      <p style="margin:7px 0 0;font-size:13.5px;color:#6b7280;max-width:420px;line-height:1.5;">${copy}</p>
      ${ctaLabel ? `<a href="${ctaHash || '#'}" style="margin-top:18px;display:inline-flex;align-items:center;gap:8px;padding:10px 17px;border:none;border-radius:11px;background:${color};color:#fff;font-family:inherit;font-size:13.5px;font-weight:600;text-decoration:none;">${ctaLabel}</a>` : ''}
    </div>
  `;
}

export function ownerAvatar(owner, size = 26) {
  if (!owner) {
    return `<span style="width:${size}px;height:${size}px;flex:none;border-radius:99px;background:#e5e7eb;color:#9aa1ae;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.42)}px;">?</span>`;
  }
  return `<span title="${escapeHtml(owner.name || '')}" style="width:${size}px;height:${size}px;flex:none;border-radius:99px;background:${owner.grad};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.42)}px;">${escapeHtml(owner.av || '?')}</span>`;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pulls the route segment after the slash (e.g. #release-detail/r07 → 'r07').
export function pathSegment() {
  const raw = (window.location.hash || '').replace(/^#/, '').split('?')[0];
  const parts = raw.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : '';
}
