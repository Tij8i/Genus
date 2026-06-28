// Development · Deploys
// 12-week deploy-cadence bar chart + 30d stability + last deploy fact box.
// External link goes to GitHub Actions / the CI workflow of record.

import { C, DEV, escapeHtml, leafHeader, loadDevSubstrate, barsSvg } from './_shared.js';

export async function renderDevDeploys() {
  const root = document.getElementById('route-dev-deploys');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading deploys…</div>';

  const data = await loadDevSubstrate('deploys_history.json', {
    deploys_per_week_12w: [], stability_pct_30d: null, last_deploy: null, deploys_this_week: 0, rollbacks_this_week: 0,
  });

  const series = data?.deploys_per_week_12w || [];
  const stability = data?.stability_pct_30d ?? null;
  const last = data?.last_deploy;
  const stabilityColor = stability == null ? C.ink3 : stability >= 90 ? '#0e9f6e' : stability >= 75 ? '#c98a16' : C.red;
  const lastColor = last?.status === 'stable' ? '#0e9f6e' : last?.status === 'rolled-back' ? C.red : '#c98a16';

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:22px 28px 80px;">
      ${leafHeader({ title: 'Deploys', kicker: 'Development · surface', externalLabel: 'Open in CI', externalHref: data?.ci_url })}

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px;">
        ${tile('THIS WEEK', data.deploys_this_week ?? 0, `${data.rollbacks_this_week ?? 0} rollback${(data.rollbacks_this_week ?? 0) === 1 ? '' : 's'}`, C.ink)}
        ${tile('STABILITY · 30d', stability == null ? '—' : `${stability}%`, stability == null ? 'no data' : 'healthy deploys / total', stabilityColor)}
        ${tile('LAST DEPLOY', last?.version || '—', last ? `${escapeHtml(last.when)} · ${escapeHtml(last.status)}` : 'no data', lastColor)}
      </div>

      <div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
        <strong style="font-size:14.5px;color:${C.ink};">Deploys per week · 12w</strong>
        ${series.length === 0
          ? `<div style="font-size:13px;color:${C.ink3};padding:24px 4px;text-align:center;">No data.</div>`
          : `<div style="margin-top:14px;display:flex;align-items:flex-end;gap:14px;">
              <div style="flex:1;">${barsSvg(series, { width: 640, height: 130, color: DEV.color })}</div>
              <div style="font:500 11px ${C.mono};color:${C.ink3};white-space:nowrap;">avg ${avg(series).toFixed(1)} / wk · max ${Math.max(...series)}</div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;font:500 10.5px ${C.mono};color:${C.ink3};">
              <span>12w ago</span><span>now</span>
            </div>`}
      </div>

      ${last?.commit_range ? `<div style="margin-top:14px;font:500 12px ${C.mono};color:${C.ink3};">Last deploy commit range · <span style="color:${C.ink2};">${escapeHtml(last.commit_range)}</span></div>` : ''}
    </div>
  `;
}

function tile(label, num, sub, numColor) {
  return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:13px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">${escapeHtml(label)}</div>
    <div style="font-size:27px;font-weight:800;letter-spacing:-.02em;color:${numColor};">${escapeHtml(String(num))}</div>
    <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:5px;">${escapeHtml(sub)}</div>
  </div>`;
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
