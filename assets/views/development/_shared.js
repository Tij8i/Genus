// Shared bits for Development module views.
// Tokens come from the workflows _shared so we stay aligned with the rest of
// the dashboard. Module color is teal #0d8a8e per ADR / design handoff.

import { C, escapeHtml, currentBu } from '../workflows/_shared.js';
import { fetchSubstrateJson } from '../../substrate-client.js';

export { C, escapeHtml, currentBu };

export const DEV = {
  name: 'Development',
  color: '#0d8a8e',
  bg: 'rgba(13,138,142,.10)',
};

// Tabs at the top of every Development surface (Overview / Workflows / Tasks).
// Sub-surfaces (Tests / Bugs / Deploys / Synthetic) are reached as Information
// tiles inside Overview, not from the top bar — same grammar as Finance.
export function devHeader({ activeTab }) {
  const tabs = [
    { key: 'overview',  label: 'Overview',  hash: '#development-overview' },
    { key: 'workflows', label: 'Workflows', hash: '#development-workflows' },
    { key: 'tasks',     label: 'Tasks',     hash: '#development-tasks' },
  ];
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px;">
      <div>
        <div style="font:600 10.5px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:8px;">${DEV.name} · function</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">${DEV.name}</h1>
      </div>
      <button type="button" id="add-workflow-btn" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:none;border-radius:11px;background:${C.accent};color:#fff;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(47,107,255,.28);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Add workflow
      </button>
    </div>
    <nav style="display:flex;gap:22px;border-bottom:1px solid ${C.border};margin-bottom:24px;">
      ${tabs.map(t => {
        const on = activeTab === t.key;
        return `<a href="${t.hash}" style="padding:10px 0;font-size:13.5px;color:${on ? C.ink : C.ink3};font-weight:${on ? 700 : 500};border-bottom:${on ? `2px solid ${C.accent}` : '2px solid transparent'};margin-bottom:-1px;text-decoration:none;">${t.label}</a>`;
      }).join('')}
    </nav>
  `;
}

// Header for a Development leaf surface (Tests / Bugs / Deploys / Synthetic).
// Breadcrumb back to Overview + title + optional external "Open in" link.
export function leafHeader({ title, kicker, externalLabel, externalHref }) {
  return `
    <a href="#development-overview" style="display:inline-flex;align-items:center;gap:6px;font:500 12px ${C.mono};color:${C.ink3};text-decoration:none;margin-bottom:14px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      Development · Overview
    </a>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px;">
      <div>
        <div style="font:600 10.5px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:8px;">${escapeHtml(kicker || (DEV.name + ' · surface'))}</div>
        <h1 style="font-size:24px;font-weight:800;letter-spacing:-.022em;margin:0;line-height:1.05;">${escapeHtml(title)}</h1>
      </div>
      ${externalHref ? `<a href="${escapeHtml(externalHref)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:${C.accent};text-decoration:none;font-weight:600;">
        ${escapeHtml(externalLabel || 'Open in tool of record')}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>` : ''}
    </div>
  `;
}

// Simple sparkline svg generator.
export function sparklineSvg(points, opts = {}) {
  if (!points || points.length === 0) return '';
  const w = opts.width  || 120;
  const h = opts.height || 28;
  const stroke = opts.color || C.ink2;
  const fill = opts.fill || 'none';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const step = w / (points.length - 1 || 1);
  const coords = points.map((v, i) => {
    const x = (i * step).toFixed(1);
    const y = (h - ((v - min) / range) * (h - 4) - 2).toFixed(1);
    return `${x},${y}`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;">
    <polyline fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(' ')}"/>
  </svg>`;
}

// Vertical bar chart.
export function barsSvg(points, opts = {}) {
  if (!points || points.length === 0) return '';
  const w = opts.width || 280;
  const h = opts.height || 96;
  const color = opts.color || DEV.color;
  const max = Math.max(...points, 1);
  const slot = w / points.length;
  const bw = Math.max(4, slot * 0.62);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;">
    ${points.map((v, i) => {
      const bh = (v / max) * (h - 4);
      const x = i * slot + (slot - bw) / 2;
      const y = h - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}" opacity="${0.5 + (v / max) * 0.5}"/>`;
    }).join('')}
  </svg>`;
}

export async function loadDevSubstrate(file, fallback) {
  const bu = currentBu();
  try {
    return await fetchSubstrateJson(`dashboard/public/data/bus/${bu}/development/${file}`, fallback);
  } catch {
    return fallback;
  }
}
