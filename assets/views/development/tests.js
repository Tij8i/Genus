// Development · Tests
// Pass-rate trend across 30d / 90d horizons + last failure note + "Open in CI"
// breadcrumb. Management altitude — no per-test drilldown.

import { C, DEV, escapeHtml, leafHeader, loadDevSubstrate, sparklineSvg } from './_shared.js';

const state = { horizon: '30' };

export async function renderDevTests() {
  const root = document.getElementById('route-dev-tests');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading tests…</div>';

  const data = await loadDevSubstrate('tests_history.json', {
    current_pass_rate_7d: null, horizons: { '30': [], '90': [] }, last_failure: null,
  });

  const passRate = data?.current_pass_rate_7d ?? null;
  const trend = data?.trend_vs_last_week || null;
  const series = data?.horizons?.[state.horizon] || [];
  const ciUrl = data?.ci_url;

  const passColor = passRate == null ? C.ink3 : passRate >= 95 ? '#0e9f6e' : passRate >= 85 ? '#c98a16' : C.red;
  const trendLabel = trend === 'up' ? 'up vs last week' : trend === 'down' ? 'down vs last week' : 'flat vs last week';

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:22px 28px 80px;">
      ${leafHeader({ title: 'Tests health', kicker: 'Development · surface', externalLabel: 'Open in CI', externalHref: ciUrl })}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
        <div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
          <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">PASS RATE · 7d</div>
          <div style="font-size:36px;font-weight:800;letter-spacing:-.025em;color:${passColor};line-height:1;">${passRate == null ? '—' : `${passRate}%`}</div>
          <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:6px;">${escapeHtml(trendLabel)}</div>
        </div>
        <div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
          <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px;">LAST FAILURE</div>
          ${data?.last_failure ? `
            <div style="font-size:14.5px;font-weight:700;color:${C.ink};">${escapeHtml(data.last_failure.when)}</div>
            <div style="font:500 12px ${C.mono};color:${C.ink2};margin-top:5px;">${escapeHtml(data.last_failure.summary)}</div>
          ` : `<div style="font-size:13px;color:${C.ink3};">No failures in the recorded horizon.</div>`}
        </div>
      </div>

      <div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
          <strong style="font-size:14.5px;color:${C.ink};">Pass-rate trend</strong>
          <div id="horizon-tabs" style="display:inline-flex;background:${C.bg};border-radius:9px;padding:3px;gap:2px;">
            ${['30','90'].map(h => {
              const on = state.horizon === h;
              return `<button type="button" data-horizon="${h}" style="background:${on ? C.card : 'transparent'};border:none;padding:6px 12px;border-radius:7px;font:600 11.5px ${C.mono};color:${on ? C.ink : C.ink3};cursor:pointer;${on ? 'box-shadow:0 1px 2px rgba(16,18,28,.06);' : ''}">${h}d</button>`;
            }).join('')}
          </div>
        </div>
        ${series.length === 0
          ? `<div style="font-size:13px;color:${C.ink3};padding:24px 4px;text-align:center;">No data in this horizon yet.</div>`
          : `<div style="display:flex;align-items:flex-end;gap:14px;">
              <div style="flex:1;">${sparklineSvg(series, { width: 640, height: 110, color: DEV.color })}</div>
              <div style="font:500 11px ${C.mono};color:${C.ink3};white-space:nowrap;">min ${Math.min(...series)}% · max ${Math.max(...series)}%</div>
            </div>`}
      </div>
    </div>
  `;

  document.querySelectorAll('#horizon-tabs [data-horizon]').forEach(btn => {
    btn.addEventListener('click', () => { state.horizon = btn.dataset.horizon; renderDevTests(); });
  });
}
