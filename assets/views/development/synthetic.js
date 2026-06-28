// Development · Synthetic data — "Is demo data fresh?"
// Single card with rows: dot + name + tag pill + summary + latest-PR link
// + blue Refresh now button.

import { C, DEV, escapeHtml, loadDevSubstrate } from './_shared.js';

export async function renderDevSynthetic() {
  const root = document.getElementById('route-dev-synthetic');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading synthetic data status…</div>';

  const data = await loadDevSubstrate('synthetic_status.json', { bus: [] });
  const bus = data?.bus || [];

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:24px 40px 90px;">
      <a href="#development-overview" style="display:inline-flex;align-items:center;font:500 11.5px ${C.mono};color:#9aa1ae;text-decoration:none;margin-bottom:16px;">‹ Development / Overview</a>

      <div style="margin-bottom:20px;">
        <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:10px;">Synthetic data</div>
        <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.02em;color:${C.ink};">Is demo data fresh?</h1>
        <p style="margin:0;font-size:13.5px;color:#6b7280;max-width:540px;line-height:1.5;">Fixtures the Synthetic Data Mason seeds for demo BUs. The one leaf surface you can act on — refresh from here.</p>
      </div>

      ${bus.length === 0
        ? `<div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;text-align:center;background:${C.cardSoft};">
            <h3 style="font-size:17px;font-weight:700;margin:0 0 8px;color:${C.ink};">No demo BUs registered</h3>
            <p style="font-size:13.5px;color:${C.ink2};margin:0;">Add a synthetic BU to start dogfooding.</p>
          </div>`
        : `<div style="background:#fff;border:1px solid ${C.border};border-radius:15px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:8px 19px;margin-bottom:14px;">
            ${bus.map(synthRow).join('')}
          </div>`}
    </div>
  `;

  document.querySelectorAll('[data-refresh-bu]').forEach(btn => {
    btn.addEventListener('click', () => {
      const buName = btn.dataset.refreshBu;
      alert(`Refresh now — Synthetic Data Mason would regenerate fixtures for ${buName}. (Stub — wires up in the next slice.)`);
    });
  });
}

function synthRow(b) {
  const dotColor = b.dot || b.color || (b.tag === 'DUE' ? '#c98a16' : b.tag === 'STALE' ? C.red : '#0e9f6e');
  const tagFg = b.tagFg || (b.tag === 'DUE' ? '#c98a16' : b.tag === 'STALE' ? C.red : '#0e9f6e');
  const tagBg = b.tagBg || (b.tag === 'DUE' ? 'rgba(201,138,22,.13)' : b.tag === 'STALE' ? 'rgba(192,57,43,.12)' : 'rgba(14,159,110,.12)');
  const prUrl = b.latest_pr_url;
  return `<div style="display:flex;align-items:center;gap:14px;padding:15px 4px;border-bottom:1px solid rgba(20,22,28,.05);flex-wrap:wrap;">
    <span style="width:10px;height:10px;border-radius:99px;background:${dotColor};flex-shrink:0;"></span>
    <span style="flex:1;min-width:160px;">
      <span style="display:flex;align-items:center;gap:9px;">
        <span style="font-weight:700;font-size:14.5px;color:${C.ink};letter-spacing:-.005em;">${escapeHtml(b.name)}</span>
        <span style="font:600 8.5px ${C.mono};letter-spacing:.07em;color:${tagFg};background:${tagBg};padding:2px 6px;border-radius:5px;">${escapeHtml(b.tag)}</span>
      </span>
      <span style="display:block;font-size:12.5px;color:${C.ink2};margin-top:4px;">${escapeHtml(b.summary || b.line || '')}</span>
    </span>
    ${prUrl ? `<a href="${escapeHtml(prUrl)}" target="_blank" rel="noopener" style="text-decoration:none;font:500 11px ${C.mono};color:${C.accent};flex-shrink:0;">latest PR →</a>` : ''}
    <button type="button" data-refresh-bu="${escapeHtml(b.name)}" style="border:none;border-radius:10px;padding:8px 14px;background:${C.accent};color:#fff;font-family:inherit;font-weight:600;font-size:12.5px;cursor:pointer;box-shadow:0 2px 8px rgba(47,107,255,.28);flex-shrink:0;">Refresh now</button>
  </div>`;
}
