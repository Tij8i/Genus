// Development · Bugs
// Severity buckets (Critical / High / Medium / Low) · 8w opened-vs-closed
// sparklines · Drafted-fixes list (Code Fix Mason) · Source toggle (Native vs
// Embedded). Native = bugs filed in Genus directly; Embedded = mirrored from
// Linear / GitHub. Management altitude — links out for per-ticket detail.

import { C, DEV, escapeHtml, leafHeader, loadDevSubstrate, sparklineSvg } from './_shared.js';

const state = { source: 'embedded' };

export async function renderDevBugs() {
  const root = document.getElementById('route-dev-bugs');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading bugs…</div>';

  const data = await loadDevSubstrate('bugs_summary.json', {
    severity_buckets: [], sparkline_opened_8w: [], sparkline_closed_8w: [], drafted_fixes: [],
  });

  const linearUrl = data?.linear_url;
  const ghUrl = data?.github_issues_url;
  const externalLabel = state.source === 'native' ? 'Open Genus issues' : 'Open in Linear';
  const externalHref = state.source === 'native' ? ghUrl : linearUrl;

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:22px 28px 80px;">
      ${leafHeader({ title: 'Bugs', kicker: 'Development · surface', externalLabel, externalHref })}

      <div id="source-tabs" style="display:inline-flex;background:${C.bg};border-radius:9px;padding:3px;gap:2px;margin-bottom:18px;">
        ${['embedded','native'].map(s => {
          const on = state.source === s;
          const label = s === 'embedded' ? 'Embedded (Linear)' : 'Native (Genus)';
          return `<button type="button" data-source="${s}" style="background:${on ? C.card : 'transparent'};border:none;padding:6px 12px;border-radius:7px;font:600 11.5px ${C.mono};color:${on ? C.ink : C.ink3};cursor:pointer;${on ? 'box-shadow:0 1px 2px rgba(16,18,28,.06);' : ''}">${label}</button>`;
        }).join('')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;">
        ${(data.severity_buckets || []).map(b => `
          <div style="background:${b.bg || C.card};border:1px solid ${b.border || C.border};border-radius:13px;padding:16px 18px;">
            <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${b.fg || C.ink3};margin-bottom:8px;">${escapeHtml(b.label)}</div>
            <div style="font-size:27px;font-weight:800;letter-spacing:-.02em;color:${b.fg || C.ink};">${b.count}</div>
            <div style="font:500 11.5px ${C.mono};color:${C.ink3};margin-top:5px;">open · severity</div>
          </div>
        `).join('')}
      </div>

      ${data.aging_alert ? `<div style="display:flex;align-items:center;gap:11px;padding:13px 16px;background:rgba(192,57,43,.06);border:1px solid rgba(192,57,43,.22);border-radius:13px;margin-bottom:18px;">
        <span style="width:8px;height:8px;border-radius:99px;background:${C.red};flex:none;"></span>
        <span style="font-size:13.5px;color:${C.ink};font-weight:600;">${escapeHtml(data.aging_alert)}</span>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
        ${sparklineCard('Opened · 8 weeks', data.sparkline_opened_8w, '#c98a16')}
        ${sparklineCard('Closed · 8 weeks', data.sparkline_closed_8w, '#0e9f6e')}
      </div>

      <div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <strong style="font-size:14.5px;color:${C.ink};">Drafted fixes (Code Fix Mason)</strong>
          <span style="font:500 11px ${C.mono};color:${C.ink3};">${(data.drafted_fixes || []).length} awaiting review</span>
        </div>
        ${(data.drafted_fixes || []).length === 0
          ? `<div style="font-size:13px;color:${C.ink3};padding:18px 4px;text-align:center;">No drafted fixes waiting.</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px;">
              ${(data.drafted_fixes || []).map(f => `<div style="display:flex;align-items:center;gap:12px;padding:11px 13px;background:${C.cardSoft};border:1px solid ${C.border};border-radius:11px;">
                <span style="font:600 9.5px ${C.mono};letter-spacing:.10em;color:#7a4dff;background:rgba(122,77,255,.12);padding:2px 7px;border-radius:5px;">DRAFTED FIX</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13.5px;font-weight:600;color:${C.ink};">bug #${escapeHtml(f.bug_id)} · ${escapeHtml(f.summary)}</div>
                  <div style="font:500 11px ${C.mono};color:${C.ink3};margin-top:3px;">PR #${escapeHtml(f.pr_id)} · drafted ${escapeHtml(f.drafted_when)}</div>
                </div>
              </div>`).join('')}
            </div>`}
      </div>
    </div>
  `;

  document.querySelectorAll('#source-tabs [data-source]').forEach(btn => {
    btn.addEventListener('click', () => { state.source = btn.dataset.source; renderDevBugs(); });
  });
}

function sparklineCard(label, points, color) {
  const safe = points || [];
  return `<div style="background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="font:600 10px ${C.mono};letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:10px;">${escapeHtml(label)}</div>
    ${safe.length === 0
      ? `<div style="font-size:13px;color:${C.ink3};padding:14px 4px;text-align:center;">No data.</div>`
      : `<div style="display:flex;align-items:flex-end;gap:12px;">
          <div style="flex:1;">${sparklineSvg(safe, { width: 320, height: 64, color })}</div>
          <div style="font:600 16px ${C.mono};color:${C.ink};">${safe[safe.length - 1]}</div>
        </div>`}
  </div>`;
}
