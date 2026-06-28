// Development · Tests health — "Are the tests passing?"
// Big area chart with healthy band + grid lines + last-point dot ·
// 3 stat tiles (Pass rate now / Avg duration / Recent flakies) ·
// attention strip with "Open in GitHub Actions".

import { C, DEV, escapeHtml, loadDevSubstrate } from './_shared.js';

const state = { horizon: '30' };
const HORIZONS = [
  { k: '30', label: '30 days', long: 'last 30 days' },
  { k: '90', label: '90 days', long: 'last 90 days' },
];

export async function renderDevTests() {
  const root = document.getElementById('route-dev-tests');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading tests…</div>';

  const data = await loadDevSubstrate('tests_history.json', {
    current_pass_rate_7d: null, horizons: { '30': [], '90': [] }, last_failure: null,
  });

  const series = (data?.horizons?.[state.horizon] || []).slice();
  const passNow = data?.current_pass_rate_7d ?? (series.length ? series[series.length - 1] : null);
  const trend = data?.trend_vs_last_week || 'flat';
  const horizonLabel = HORIZONS.find(h => h.k === state.horizon)?.long || '';
  const ciUrl = data?.ci_url;
  const passColor = passNow == null ? C.ink3 : passNow >= 95 ? '#0e9f6e' : passNow >= 85 ? '#c98a16' : C.red;

  const avgDur = data?.avg_duration_label || '—';
  const avgDurDelta = data?.avg_duration_delta_label || '';
  const flakies = data?.recent_flakies ?? null;
  const flakyColor = flakies == null ? C.ink3 : flakies <= 1 ? '#0e9f6e' : flakies <= 4 ? '#c98a16' : C.red;

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:24px 40px 90px;">
      <a href="#development-overview" style="display:inline-flex;align-items:center;font:500 11.5px ${C.mono};color:#9aa1ae;text-decoration:none;margin-bottom:16px;">‹ Development / Overview</a>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px;flex-wrap:wrap;">
        <div>
          <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:10px;">Tests health</div>
          <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.02em;color:${C.ink};">Are the tests passing?</h1>
          <p style="margin:0;font-size:13.5px;color:#6b7280;max-width:520px;line-height:1.5;">The pass-rate trend and the latest failure — the management read. Run-by-run detail lives in CI.</p>
        </div>
        <div style="display:flex;align-items:center;gap:2px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:9px;padding:3px;flex-shrink:0;">
          ${HORIZONS.map(h => {
            const on = state.horizon === h.k;
            return `<button type="button" data-horizon="${h.k}" style="border:none;background:${on ? '#fff' : 'transparent'};color:${on ? C.ink : '#9aa1ae'};font-weight:${on ? 700 : 500};box-shadow:${on ? '0 1px 2px rgba(16,18,28,.08)' : 'none'};font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.04em;padding:6px 11px;border-radius:7px;cursor:pointer;transition:all .12s;">${escapeHtml(h.label)}</button>`;
          }).join('')}
        </div>
      </div>

      <div style="background:#fff;border:1px solid ${C.border};border-radius:15px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:20px 22px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
          <span style="font-size:15px;font-weight:700;letter-spacing:-.01em;color:${C.ink};">Pass rate · ${escapeHtml(horizonLabel)}</span>
          <span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:16px;height:9px;border-radius:3px;background:rgba(14,159,110,.18);"></span><span style="font:500 10px ${C.mono};color:#9aa1ae;">healthy ≥ 95%</span></span>
        </div>
        ${renderAreaChart(series, horizonLabel)}
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;">
        ${miniTile('Pass rate now', passNow == null ? '—' : `${passNow}%`, passColor, trendBadge(trend))}
        ${miniTile('Avg duration', avgDur, C.ink, avgDurDelta ? `<span style="font-size:12px;color:#0e9f6e;font-weight:600;">${escapeHtml(avgDurDelta)}</span>` : '')}
        ${miniTile('Recent flakies', flakies == null ? '—' : String(flakies), flakyColor, `<span style="font-size:12px;color:#9aa1ae;font-weight:500;">last 7 days</span>`)}
      </div>

      ${renderAttentionStrip(data?.last_failure, ciUrl)}
    </div>
  `;

  document.querySelectorAll('[data-horizon]').forEach(btn => {
    btn.addEventListener('click', () => { state.horizon = btn.dataset.horizon; renderDevTests(); });
  });
}

function trendBadge(trend) {
  if (trend === 'up')   return `<span style="font-size:12px;color:#0e9f6e;font-weight:600;">↑ vs last week</span>`;
  if (trend === 'down') return `<span style="font-size:12px;color:${C.red};font-weight:600;">↓ vs last week</span>`;
  return `<span style="font-size:12px;color:#9aa1ae;font-weight:500;">flat vs last week</span>`;
}

function miniTile(label, value, valueColor, sideBadge) {
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:16px 17px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.13em;text-transform:uppercase;color:#aab0bb;margin-bottom:10px;">${escapeHtml(label)}</div>
    <div style="display:flex;align-items:baseline;gap:7px;">
      <span style="font-size:25px;font-weight:800;letter-spacing:-.02em;color:${valueColor};line-height:1;">${escapeHtml(value)}</span>
      ${sideBadge || ''}
    </div>
  </div>`;
}

// 840×210 viewBox area chart with 85–100% domain, healthy band 95–100%,
// grid lines at 100/95/90/85, area fill + polyline + last-point circle.
function renderAreaChart(series, horizonLabel) {
  if (!series || series.length === 0) {
    return `<div style="padding:36px 4px;text-align:center;color:#9aa1ae;font-size:13px;">No data in this horizon yet.</div>`;
  }
  const W = 840, H = 210, padL = 46, padR = 46, top = 24, bot = 188;
  const innerW = W - padL - padR;
  const min = 85, max = 100;
  const n = series.length;
  const xAt = (i) => (padL + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1))).toFixed(1);
  const yAt = (v) => (bot - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (bot - top)).toFixed(1);
  const pts = series.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
  const lastX = xAt(n - 1), lastY = yAt(series[n - 1]);
  const areaD = `M${xAt(0)},${bot} L${series.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L')} L${xAt(n - 1)},${bot} Z`;
  const bandTop = yAt(100), bandBot = yAt(95), bandH = (parseFloat(bandBot) - parseFloat(bandTop)).toFixed(1);

  return `<div style="position:relative;">
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible;">
      <rect x="${padL}" y="${bandTop}" width="${innerW}" height="${bandH}" fill="rgba(14,159,110,.07)"/>
      <line x1="${padL}" y1="${yAt(100)}" x2="${padL + innerW}" y2="${yAt(100)}" stroke="rgba(20,22,28,.05)" stroke-width="1"/>
      <line x1="${padL}" y1="${yAt(95)}"  x2="${padL + innerW}" y2="${yAt(95)}"  stroke="rgba(14,159,110,.3)" stroke-width="1" stroke-dasharray="4 4"/>
      <line x1="${padL}" y1="${yAt(90)}"  x2="${padL + innerW}" y2="${yAt(90)}"  stroke="rgba(20,22,28,.05)" stroke-width="1"/>
      <line x1="${padL}" y1="${yAt(85)}"  x2="${padL + innerW}" y2="${yAt(85)}"  stroke="rgba(20,22,28,.08)" stroke-width="1"/>
      <text x="${padL - 8}" y="${parseFloat(yAt(100)) + 3}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#bcc1cb">100</text>
      <text x="${padL - 8}" y="${parseFloat(yAt(95)) + 3}"  text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#bcc1cb">95</text>
      <text x="${padL - 8}" y="${parseFloat(yAt(90)) + 3}"  text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#bcc1cb">90</text>
      <text x="${padL - 8}" y="${parseFloat(yAt(85)) + 3}"  text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#bcc1cb">85</text>
      <path d="${areaD}" fill="rgba(13,138,142,.10)"/>
      <polyline points="${pts}" fill="none" stroke="${DEV.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="4.5" fill="${DEV.color}" stroke="#fff" stroke-width="2"/>
    </svg>
    <div style="display:flex;justify-content:space-between;padding:8px 0 0 ${padL}px;font:500 9.5px ${C.mono};color:#bcc1cb;">
      <span>${escapeHtml(horizonLabel)}</span><span>today</span>
    </div>
  </div>`;
}

function renderAttentionStrip(lastFailure, ciUrl) {
  const dotColor = lastFailure ? '#c98a16' : '#0e9f6e';
  const msg = lastFailure
    ? `Last failure <strong>${escapeHtml(lastFailure.when)}</strong> — ${escapeHtml(lastFailure.summary || '')}.`
    : 'No recent failures in the recorded horizon. Green all the way.';
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <span style="width:9px;height:9px;border-radius:99px;background:${dotColor};flex-shrink:0;"></span>
    <span style="flex:1;min-width:200px;font-size:13.5px;color:#3a3f4a;line-height:1.5;">${msg}</span>
    ${ciUrl ? `<a href="${escapeHtml(ciUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;border:1px solid ${C.border};background:${C.cardSoft};border-radius:10px;padding:9px 14px;flex-shrink:0;">
      <span style="font-weight:600;font-size:13px;color:#3a3f4a;">Open in GitHub Actions</span><span style="color:${C.accent};font-size:13px;">→</span>
    </a>` : ''}
  </div>`;
}
