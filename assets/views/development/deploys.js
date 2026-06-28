// Development · Deploy cadence — "Are deploys landing safely?"
// 2-col layout: 12-week bar chart on the left (1.7fr), Stability 30d +
// This week tiles on the right (1fr). Status one-liner with "Open in
// GitHub Actions" below.

import { C, DEV, escapeHtml, loadDevSubstrate } from './_shared.js';

export async function renderDevDeploys() {
  const root = document.getElementById('route-dev-deploys');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading deploys…</div>';

  const data = await loadDevSubstrate('deploys_history.json', {
    deploys_per_week_12w: [], stability_pct_30d: null, last_deploy: null, deploys_this_week: 0, rollbacks_this_week: 0,
  });

  const series = data?.deploys_per_week_12w || [];
  const stability = data?.stability_pct_30d ?? null;
  const stabilityColor = stability == null ? C.ink3 : stability >= 90 ? '#0e9f6e' : stability >= 75 ? '#c98a16' : C.red;
  const last = data?.last_deploy;
  const ciUrl = data?.ci_url;
  const thisWeek = data?.deploys_this_week ?? 0;
  const rollbacks = data?.rollbacks_this_week ?? 0;

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:24px 40px 90px;">
      <a href="#development-overview" style="display:inline-flex;align-items:center;font:500 11.5px ${C.mono};color:#9aa1ae;text-decoration:none;margin-bottom:16px;">‹ Development / Overview</a>

      <div style="margin-bottom:20px;">
        <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:10px;">Deploy cadence</div>
        <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.02em;color:${C.ink};">Are deploys landing safely?</h1>
        <p style="margin:0;font-size:13.5px;color:#6b7280;max-width:520px;line-height:1.5;">How often we ship and how often it holds. Commit-by-commit detail lives in GitHub Actions.</p>
      </div>

      <div style="display:grid;grid-template-columns:1.7fr 1fr;gap:14px;margin-bottom:14px;">
        <div style="background:#fff;border:1px solid ${C.border};border-radius:15px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:20px 22px;">
          <div style="font-size:15px;font-weight:700;letter-spacing:-.01em;color:${C.ink};margin-bottom:14px;">Deploys per week · last 12 weeks</div>
          ${renderDeployBars(series)}
          <div style="display:flex;justify-content:space-between;padding-top:8px;font:500 9.5px ${C.mono};color:#bcc1cb;"><span>12 wk ago</span><span>this week</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:18px 19px;">
            <div style="font:600 10px ${C.mono};letter-spacing:.13em;text-transform:uppercase;color:#aab0bb;margin-bottom:11px;">Stability · 30d</div>
            <div style="font-size:32px;font-weight:800;letter-spacing:-.02em;color:${stabilityColor};line-height:1;">${stability == null ? '—' : `${stability}%`}</div>
            <div style="margin-top:9px;font-size:12.5px;color:${C.ink2};line-height:1.45;">of deploys with no rollback or hotfix within 24h</div>
          </div>
          <div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:18px 19px;">
            <div style="font:600 10px ${C.mono};letter-spacing:.13em;text-transform:uppercase;color:#aab0bb;margin-bottom:11px;">This week</div>
            <div style="font-size:32px;font-weight:800;letter-spacing:-.02em;color:${C.ink};line-height:1;">${thisWeek}</div>
            <div style="margin-top:9px;font-size:12.5px;color:${C.ink2};">deploys · ${rollbacks} rollback${rollbacks === 1 ? '' : 's'}</div>
          </div>
        </div>
      </div>

      ${renderStatusStrip(last, ciUrl)}
    </div>
  `;
}

function renderDeployBars(series) {
  if (!series || series.length === 0) {
    return `<div style="padding:36px 4px;text-align:center;color:#9aa1ae;font-size:13px;">No data.</div>`;
  }
  const W = 820, H = 172, dLeft = 12, dBot = 150, dTop = 14;
  const max = Math.max(...series, 1);
  const n = series.length;
  const step = (W - 2 * dLeft) / n;
  const barW = Math.min(34, step - 14);
  const bars = series.map((v, i) => {
    const h = (v / max) * (dBot - dTop);
    const x = (dLeft + i * step + (step - barW) / 2).toFixed(1);
    const y = (dBot - h).toFixed(1);
    return `<rect x="${x}" y="${y}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="rgba(13,138,142,.85)"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">
    <line x1="12" y1="${dBot}" x2="${W - 12}" y2="${dBot}" stroke="rgba(20,22,28,.1)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function renderStatusStrip(last, ciUrl) {
  if (!last) {
    return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <span style="width:9px;height:9px;border-radius:99px;background:#9aa1ae;flex-shrink:0;"></span>
      <span style="flex:1;min-width:200px;font-size:13.5px;color:#3a3f4a;line-height:1.5;">No deploys in the recorded window.</span>
    </div>`;
  }
  const stable = last.status === 'stable';
  const dotColor = stable ? '#0e9f6e' : last.status === 'rolled-back' ? C.red : '#c98a16';
  const statusColor = stable ? '#0e9f6e' : last.status === 'rolled-back' ? C.red : '#c98a16';
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <span style="width:9px;height:9px;border-radius:99px;background:${dotColor};flex-shrink:0;"></span>
    <span style="flex:1;min-width:200px;font-size:13.5px;color:#3a3f4a;line-height:1.5;">Last deploy <span style="font:500 12.5px ${C.mono};color:${C.ink2};">${escapeHtml(last.version)}</span> · ${escapeHtml(last.when)} · <strong style="color:${statusColor};">${escapeHtml(last.status)}</strong>.</span>
    ${ciUrl ? `<a href="${escapeHtml(ciUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;border:1px solid ${C.border};background:${C.cardSoft};border-radius:10px;padding:9px 14px;flex-shrink:0;">
      <span style="font-weight:600;font-size:13px;color:#3a3f4a;">Open in GitHub Actions</span><span style="color:${C.accent};font-size:13px;">→</span>
    </a>` : ''}
  </div>`;
}
