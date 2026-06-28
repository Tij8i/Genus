// Development · Bugs health — "Are bugs under control?"
// Native (default) view: 4 severity tiles · Aging-vs-SLA card + Opened-vs-
// Closed 8w overlay · status one-liner with Open in Linear · Drafted fixes
// section with Code Fix Mason badge + Review buttons.
// Embedded view: iframe-the-live-tool placeholder.

import { C, DEV, escapeHtml, loadDevSubstrate } from './_shared.js';

const state = { source: 'native' };

export async function renderDevBugs() {
  const root = document.getElementById('route-dev-bugs');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading bugs…</div>';

  const data = await loadDevSubstrate('bugs_summary.json', {
    severity_buckets: [], sparkline_opened_8w: [], sparkline_closed_8w: [], drafted_fixes: [],
  });

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:24px 40px 90px;">
      <a href="#development-overview" style="display:inline-flex;align-items:center;font:500 11.5px ${C.mono};color:#9aa1ae;text-decoration:none;margin-bottom:16px;">‹ Development / Overview</a>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px;flex-wrap:wrap;">
        <div>
          <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${DEV.color};margin-bottom:10px;">Bugs health</div>
          <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.02em;color:${C.ink};">Are bugs under control?</h1>
          <p style="margin:0;font-size:13.5px;color:#6b7280;max-width:520px;line-height:1.5;">Severity counts and aging against SLA — not a ticket-by-ticket board. Drill into Linear to act.</p>
        </div>
        <div style="display:flex;align-items:center;gap:2px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:9px;padding:3px;flex-shrink:0;">
          ${['native','embedded'].map(s => {
            const on = state.source === s;
            const label = s === 'native' ? 'Native' : 'Embedded';
            return `<button type="button" data-source="${s}" style="border:none;background:${on ? '#fff' : 'transparent'};color:${on ? C.ink : '#9aa1ae'};font-weight:${on ? 700 : 500};box-shadow:${on ? '0 1px 2px rgba(16,18,28,.08)' : 'none'};font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.04em;padding:6px 11px;border-radius:7px;cursor:pointer;transition:all .12s;">${label}</button>`;
          }).join('')}
        </div>
      </div>

      ${state.source === 'native' ? renderNative(data) : renderEmbedded(data)}
    </div>
  `;

  document.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => { state.source = btn.dataset.source; renderDevBugs(); });
  });
}

function renderNative(data) {
  const buckets = data.severity_buckets || [];
  const withinSLA = data?.aging_within_sla ?? null;
  const overSLA = data?.aging_over_sla ?? null;
  const totalAged = (withinSLA || 0) + (overSLA || 0);

  return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;">
      ${buckets.map(s => `
        <div style="background:${s.bg};border:1px solid ${s.border || s.bd};border-radius:14px;padding:16px 17px;">
          <div style="font-size:27px;font-weight:800;letter-spacing:-.02em;color:${s.fg};line-height:1;">${s.count}</div>
          <div style="margin-top:9px;font:600 10px ${C.mono};letter-spacing:.1em;text-transform:uppercase;color:${s.fg};">${escapeHtml(s.label)}</div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:14px;margin-bottom:14px;">
      ${agingCard(data, withinSLA, overSLA, totalAged)}
      ${openedClosedCard(data)}
    </div>

    ${oneLinerStatus(overSLA, data)}

    ${draftedFixesCard(data.drafted_fixes || [])}
  `;
}

function agingCard(data, withinSLA, overSLA, totalAged) {
  const hasAging = (overSLA != null) || data?.aging_alert;
  const numOver = overSLA ?? (data?.aging_alert ? 1 : 0);
  const numWithin = withinSLA ?? 0;
  const total = totalAged || (numOver + numWithin);
  const overPct = total > 0 ? (numOver / total) * 100 : 0;
  const withinPct = 100 - overPct;
  const borderColor = numOver > 0 ? 'rgba(192,57,43,.2)' : C.border;
  const msg = data?.aging_alert
    ? data.aging_alert
    : (numOver === 0 ? 'no critical bugs past the 7-day SLA.' : `${numOver} critical bug${numOver === 1 ? '' : 's'} older than the 7-day SLA — assign or escalate.`);

  return `<div style="background:#fff;border:1px solid ${borderColor};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:18px 19px;">
    <div style="font:600 10px ${C.mono};letter-spacing:.13em;text-transform:uppercase;color:#aab0bb;margin-bottom:12px;">Aging vs SLA</div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:32px;font-weight:800;letter-spacing:-.02em;color:${numOver > 0 ? C.red : '#0e9f6e'};line-height:1;">${numOver}</span>
      <span style="font-size:13px;color:#3a3f4a;line-height:1.45;">${escapeHtml(msg)}</span>
    </div>
    <div style="margin-top:14px;height:8px;border-radius:99px;background:rgba(20,22,28,.06);overflow:hidden;display:flex;">
      ${numWithin > 0 ? `<span style="width:${withinPct}%;background:#0e9f6e;height:100%;"></span>` : ''}
      ${numOver > 0 ? `<span style="width:${overPct}%;background:${C.red};height:100%;"></span>` : ''}
    </div>
    <div style="margin-top:7px;display:flex;justify-content:space-between;font:500 9.5px ${C.mono};color:#9aa1ae;">
      <span>${numWithin} within SLA</span><span>${numOver} over</span>
    </div>
  </div>`;
}

function openedClosedCard(data) {
  const opened = data?.sparkline_opened_8w || [];
  const closed = data?.sparkline_closed_8w || [];
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:18px 19px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span style="font:600 10px ${C.mono};letter-spacing:.13em;text-transform:uppercase;color:#aab0bb;">Opened vs closed · 8 wk</span>
      <span style="display:flex;gap:11px;">
        <span style="display:inline-flex;align-items:center;gap:5px;font:500 9.5px ${C.mono};color:#9aa1ae;"><span style="width:9px;height:2.5px;background:#c98a16;border-radius:2px;"></span>opened</span>
        <span style="display:inline-flex;align-items:center;gap:5px;font:500 9.5px ${C.mono};color:#9aa1ae;"><span style="width:9px;height:2.5px;background:#0e9f6e;border-radius:2px;"></span>closed</span>
      </span>
    </div>
    ${(opened.length === 0 && closed.length === 0)
      ? `<div style="padding:20px 4px;text-align:center;color:#9aa1ae;font-size:12.5px;">No data.</div>`
      : `<svg viewBox="0 0 360 78" width="100%" style="display:block;">
          <polyline points="${overlayPoints(opened)}" fill="none" stroke="#c98a16" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <polyline points="${overlayPoints(closed)}" fill="none" stroke="#0e9f6e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`}
  </div>`;
}

function overlayPoints(arr) {
  if (!arr || arr.length === 0) return '';
  const W = 360, pad = 8, top = 10, bot = 66, min = 0, max = 7;
  const n = arr.length;
  const step = (W - pad * 2) / (n - 1 || 1);
  return arr.map((v, i) => {
    const x = (pad + i * step).toFixed(1);
    const y = (bot - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (bot - top)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
}

function oneLinerStatus(overSLA, data) {
  const ok = !overSLA || overSLA === 0;
  const linearUrl = data?.linear_url;
  const msg = ok
    ? `Critical bugs all assigned · oldest is <strong>4 days old</strong>. Nothing unowned.`
    : `${overSLA} critical bug${overSLA === 1 ? '' : 's'} aging past SLA — assign or escalate.`;
  const dotColor = ok ? '#0e9f6e' : '#c98a16';
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
    <span style="width:9px;height:9px;border-radius:99px;background:${dotColor};flex-shrink:0;"></span>
    <span style="flex:1;min-width:200px;font-size:13.5px;color:#3a3f4a;line-height:1.5;">${msg}</span>
    ${linearUrl ? `<a href="${escapeHtml(linearUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;border:1px solid ${C.border};background:${C.cardSoft};border-radius:10px;padding:9px 14px;flex-shrink:0;">
      <span style="font-weight:600;font-size:13px;color:#3a3f4a;">Open in Linear</span><span style="color:${C.accent};font-size:13px;">→</span>
    </a>` : ''}
  </div>`;
}

function draftedFixesCard(fixes) {
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);padding:18px 19px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px;flex-wrap:wrap;">
      <span style="font-size:15px;font-weight:700;letter-spacing:-.01em;color:${C.ink};">Drafted fixes</span>
      <span style="display:inline-flex;align-items:center;gap:7px;">
        <span style="width:18px;height:18px;border-radius:5px;background:rgba(224,104,58,.12);color:#e0683a;display:inline-flex;align-items:center;justify-content:center;font:600 8px ${C.mono};">CF</span>
        <span style="font:500 10.5px ${C.mono};color:#9aa1ae;">Code Fix Mason · awaiting review</span>
      </span>
    </div>
    ${fixes.length === 0
      ? `<div style="padding:18px 4px;text-align:center;color:#9aa1ae;font-size:13px;">No drafted fixes waiting.</div>`
      : `<div style="display:flex;flex-direction:column;gap:9px;">
          ${fixes.map(f => `<div style="display:flex;align-items:center;gap:12px;background:${C.cardSoft};border:1px solid rgba(20,22,28,.06);border-radius:11px;padding:11px 13px;">
            <span style="font:600 8.5px ${C.mono};letter-spacing:.06em;color:#7a4dff;background:rgba(122,77,255,.12);padding:3px 7px;border-radius:5px;flex-shrink:0;">DRAFTED</span>
            <span style="flex:1;min-width:0;">
              <span style="display:block;font-weight:600;font-size:13px;color:${C.ink};letter-spacing:-.005em;">#${escapeHtml(f.bug_id)} ${escapeHtml(f.summary)}</span>
              <span style="display:block;font:500 10px ${C.mono};color:#9aa1ae;margin-top:2px;">PR #${escapeHtml(f.pr_id)} · drafted ${escapeHtml(f.drafted_when)}</span>
            </span>
            <button type="button" style="border:1px solid ${C.border};background:#fff;border-radius:9px;padding:7px 13px;font-family:inherit;font-weight:600;font-size:12.5px;color:#3a3f4a;cursor:pointer;flex-shrink:0;">Review →</button>
          </div>`).join('')}
        </div>`}
  </div>`;
}

function renderEmbedded(data) {
  const linearUrl = data?.linear_url;
  return `<div style="background:#fff;border:1px solid ${C.border};border-radius:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);overflow:hidden;">
    <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid ${C.border};background:${C.cardSoft};">
      <span style="width:9px;height:9px;border-radius:99px;background:#0e9f6e;"></span>
      <span style="font:500 11px ${C.mono};color:${C.ink2};">Linear · team GEN — live embed</span>
      <span style="flex:1;"></span>
      ${linearUrl ? `<a href="${escapeHtml(linearUrl)}" target="_blank" rel="noopener" style="text-decoration:none;font-size:12px;color:${C.accent};font-weight:600;">Open in Linear →</a>` : ''}
    </div>
    <div style="height:360px;background:repeating-linear-gradient(135deg,${C.cardSoft},${C.cardSoft} 11px,#f4f5f7 11px,#f4f5f7 22px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;">
      <span style="width:46px;height:46px;border-radius:12px;background:#fff;border:1px solid rgba(20,22,28,.1);display:flex;align-items:center;justify-content:center;color:#9aa1ae;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 9h18M9 21V9"/></svg>
      </span>
      <span style="font:500 11.5px ${C.mono};color:${C.ink2};max-width:340px;line-height:1.6;">The live Linear board renders here in an iframe — real-time numbers, no nightly copy.</span>
      <span style="font-size:12px;color:#9aa1ae;max-width:360px;line-height:1.5;">Cheaper to ship, but it reads as a wrapper around someone else's tool rather than a native Genus surface.</span>
    </div>
  </div>`;
}
