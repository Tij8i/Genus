// Development · Synthetic data
// One row per demo BU. FRESH / DUE pill + last refresh + Refresh now button
// (stubbed — surfaces an alert + would dispatch Synthetic Data Mason).

import { C, DEV, escapeHtml, leafHeader, loadDevSubstrate } from './_shared.js';

export async function renderDevSynthetic() {
  const root = document.getElementById('route-dev-synthetic');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading synthetic data status…</div>';

  const data = await loadDevSubstrate('synthetic_status.json', { bus: [] });
  const bus = data?.bus || [];

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:22px 28px 80px;">
      ${leafHeader({ title: 'Synthetic data', kicker: 'Development · surface' })}

      <p style="font-size:13.5px;color:${C.ink2};margin:0 0 18px;max-width:620px;">Demo-BU fixtures that ship with the dashboard. The Synthetic Data Mason refreshes them weekly. If a refresh slips, it shows here as <strong>DUE</strong> — never as a per-file diff.</p>

      ${bus.length === 0
        ? `<div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;text-align:center;background:#fbfbfc;">
            <h3 style="font-size:17px;font-weight:700;margin:0 0 8px;color:${C.ink};">No demo BUs registered</h3>
            <p style="font-size:13.5px;color:${C.ink2};margin:0;">Add a synthetic BU to start dogfooding.</p>
          </div>`
        : `<div style="display:flex;flex-direction:column;gap:10px;">
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
  const color = b.color || DEV.color;
  const fg = b.tag === 'DUE' ? '#c98a16' : b.tag === 'STALE' ? C.red : '#0e9f6e';
  return `<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:${C.card};border:1px solid ${C.border};border-radius:13px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <span style="width:34px;height:34px;flex:none;border-radius:9px;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${escapeHtml((b.name || '?').slice(0,1))}</span>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="font-size:13.5px;color:${C.ink};">${escapeHtml(b.name)}</strong>
        <span style="font:600 9.5px ${C.mono};letter-spacing:.10em;color:${fg};background:${fg}14;padding:2px 7px;border-radius:5px;">${escapeHtml(b.tag)}</span>
      </div>
      <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:4px;">${escapeHtml(b.summary || '')}</div>
    </div>
    <button type="button" data-refresh-bu="${escapeHtml(b.name)}" style="padding:7px 12px;border:1px solid ${C.border};border-radius:8px;background:${C.cardSoft};font-family:inherit;font-size:12px;font-weight:600;color:${C.ink2};cursor:pointer;">Refresh now</button>
  </div>`;
}
