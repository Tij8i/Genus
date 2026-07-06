// Roadmap i47 — A/B orchestration UI.
// Route: #ab-runs

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { renderStatTiles } from '../components/stat-tiles.js';

export async function renderAbRuns() {
  const root = document.getElementById('route-ab-runs');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading A/B runs…</div>';

  let payload;
  try {
    const res = await fetch(`/api/ab-run?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.message);
  } catch (e) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:40px 28px;color:#c12525;">Could not load A/B runs: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const runs = payload.runs || [];
  const open = runs.filter(r => !r.winner).length;
  const closed = runs.filter(r => r.winner).length;

  const stats = [
    { label: 'TOTAL RUNS', value: runs.length, sub: 'all-time' },
    { label: 'OPEN', value: open, sub: 'awaiting verdict', color: open > 0 ? '#c78500' : '#238c46' },
    { label: 'CLOSED', value: closed, sub: 'winner picked' },
    { label: 'MODE', value: '2-way', sub: 'N-way ships v1.0' },
  ];

  const runCard = (r) => {
    const isOpen = !r.winner;
    return `<div style="padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${isOpen ? '#c78500' : '#238c46'};border-radius:11px;margin-bottom:10px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:${isOpen ? '#f3e9d6' : '#e3ede2'};color:${isOpen ? '#9a6320' : '#356845'};">${isOpen ? 'AWAITING VERDICT' : 'WINNER PICKED'}</span>
        <span style="font-size:13px;color:#16181e;flex:1;">${escapeHtml((r.task_body || '').slice(0, 120))}${(r.task_body || '').length > 120 ? '…' : ''}</span>
        <span style="font:500 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml((r.started_at || '').slice(0,10))}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${(r.contestants || []).map(c => `<div style="padding:10px 12px;background:#fbfbfa;border:1px solid rgba(20,22,28,.06);border-radius:8px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            ${r.winner === c.agent_id ? `<span style="font:700 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#238c46;text-transform:uppercase;">★ WINNER</span>` : ''}
            <span style="font-size:12.5px;font-weight:600;color:#16181e;">${escapeHtml(c.agent_id)}</span>
          </div>
          <div style="font-size:11px;color:${c.status === 'completed' ? '#238c46' : '#c78500'};">${escapeHtml(c.status)}${c.latency_ms ? ` · ${(c.latency_ms/1000).toFixed(1)}s` : ''}</div>
          ${c.output ? `<div style="margin-top:6px;font-size:12px;color:#5b6270;line-height:1.5;max-height:80px;overflow:auto;">${escapeHtml((c.output || '').slice(0, 300))}${c.output.length > 300 ? '…' : ''}</div>` : ''}
        </div>`).join('')}
      </div>
      ${isOpen ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        ${(r.contestants || []).map(c => `<button type="button" class="ab-pick" data-run="${escapeHtml(r.id)}" data-winner="${escapeHtml(c.agent_id)}" style="padding:5px 10px;font-size:11.5px;background:#3468d6;color:#fff;border:none;border-radius:6px;cursor:pointer;">Pick ${escapeHtml(c.agent_id)}</button>`).join('')}
      </div>` : `<div style="margin-top:8px;font-size:11.5px;color:#9aa1ae;">Picked by ${escapeHtml(r.verdict_by || '?')} on ${escapeHtml((r.verdict_at || '').slice(0,10))}${r.verdict_notes ? ` — "${escapeHtml(r.verdict_notes)}"` : ''}</div>`}
    </div>`;
  };

  root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:20px;">
      <div>
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#3468d6;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(bu.toUpperCase())} · CORE · A/B</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">A/B agent runs</h1>
        <div style="font-size:13.5px;color:#5b6270;margin-top:4px;">Fire the same task at 2 agents, compare outputs, pick a winner.</div>
      </div>
      <button type="button" id="ab-new-btn" style="padding:9px 16px;background:#3468d6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">+ New A/B</button>
    </div>
    ${renderStatTiles(stats)}
    ${runs.length === 0 ? `<div style="padding:32px;text-align:center;color:#9aa1ae;background:#fff;border:1.5px dashed rgba(20,22,28,.14);border-radius:12px;">No A/B runs yet. Click New A/B to compare two agents on the same task.</div>` : runs.map(runCard).join('')}
  </div>`;

  document.getElementById('ab-new-btn')?.addEventListener('click', async () => {
    const task_body = prompt('Task to run at both agents:');
    if (!task_body) return;
    const a = prompt('Agent A id (e.g. product-stewart-of-genus):');
    if (!a) return;
    const b = prompt('Agent B id:');
    if (!b) return;
    try {
      await fetch('/api/ab-run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, action: 'start', task_body, contestants: [a, b] }),
      });
      await renderAbRuns();
    } catch (e) { alert(`Could not start A/B: ${e.message}`); }
  });

  document.querySelectorAll('.ab-pick').forEach(btn => btn.addEventListener('click', async () => {
    const notes = prompt('Winner rationale (optional):') || '';
    await fetch('/api/ab-run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'pick_winner', run_id: btn.dataset.run, winner_agent_id: btn.dataset.winner, notes }),
    });
    await renderAbRuns();
  }));
}
