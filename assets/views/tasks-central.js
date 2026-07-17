// Roadmap i65 — central tasks view for the whole venture.
// Route: #tasks (top-level, under Core in the new sidebar).
//
// Shows every task in the venture, grouped by owner_module. Filter chips at
// top (all / by module). Card click → detail drawer with history, parent,
// spawned children, spawn/handoff actions.

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { renderStatTiles } from '../components/stat-tiles.js';
import { openDrawer } from '../components/decision-drawer.js';
import { showPrompt } from '../dialog.js';

const STATUS_COLOR = {
  proposed: '#5b6270', awaiting_approval: '#c78500', in_progress: '#3468d6',
  blocked: '#c12525', done: '#238c46', abandoned: '#9aa1ae',
};

let ACTIVE_MODULE_FILTER = null;

export async function renderTasksCentral() {
  const root = document.getElementById('route-tasks');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading tasks…</div>';

  let payload;
  try {
    const res = await fetch(`/api/tasks-layered?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.message || `HTTP ${res.status}`);
  } catch (e) {
    root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:40px 28px;color:#c12525;">Could not load tasks: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const tasks = payload.tasks || [];
  const byModule = new Map();
  for (const t of tasks) {
    const key = t.owner_module || 'unassigned';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(t);
  }

  const total = tasks.length;
  const open = tasks.filter(t => !['done','abandoned'].includes(t.status)).length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const spawned = tasks.filter(t => t.parent_task_id).length;

  const filterChips = ['all', ...byModule.keys()].map(k => {
    const active = (k === 'all' && !ACTIVE_MODULE_FILTER) || k === ACTIVE_MODULE_FILTER;
    const count = k === 'all' ? total : (byModule.get(k) || []).length;
    return `<button type="button" data-module-filter="${escapeHtml(k)}" style="padding:6px 12px;border:1px solid ${active ? 'var(--accent)' : 'rgba(20,22,28,.12)'};border-radius:99px;background:${active ? 'var(--accent-bg,rgba(47,107,255,.08))' : '#fff'};color:${active ? 'var(--accent)' : '#5b6270'};font-family:inherit;font-size:12.5px;font-weight:${active ? 600 : 500};cursor:pointer;">${escapeHtml(k)} · ${count}</button>`;
  }).join('');

  const visible = ACTIVE_MODULE_FILTER ? (byModule.get(ACTIVE_MODULE_FILTER) || []) : tasks;

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:22px 28px 80px;">
      <div style="margin-bottom:18px;">
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;">${escapeHtml(bu.toUpperCase())} · CORE</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">Tasks</h1>
        <div style="font-size:13.5px;color:#5b6270;margin-top:4px;">Every task in this venture. Modules filter this pool — they don't own it.</div>
      </div>

      ${renderStatTiles([
        { label: 'TOTAL', value: total, sub: `${byModule.size} modules` },
        { label: 'OPEN', value: open, sub: `${blocked} blocked`, color: open > 0 ? '#16181e' : '#238c46' },
        { label: 'SPAWNED', value: spawned, sub: 'from parent tasks' },
        { label: 'ATTENTION', value: blocked, sub: 'blocked or overdue', color: blocked > 0 ? '#c12525' : '#238c46' },
      ])}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">${filterChips}</div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        ${visible.length === 0
          ? `<div style="padding:32px;text-align:center;color:#9aa1ae;background:#fff;border:1.5px dashed rgba(20,22,28,.14);border-radius:12px;">No tasks in this filter.</div>`
          : visible.map(renderCard).join('')}
      </div>
    </div>
  `;

  document.querySelectorAll('[data-module-filter]').forEach(btn => btn.addEventListener('click', () => {
    const f = btn.dataset.moduleFilter;
    ACTIVE_MODULE_FILTER = (f === 'all' || f === ACTIVE_MODULE_FILTER) ? null : f;
    renderTasksCentral();
  }));
  document.querySelectorAll('[data-task-card]').forEach(card => card.addEventListener('click', () => openTaskDetail(bu, card.dataset.taskCard, tasks)));
}

function renderCard(t) {
  const color = STATUS_COLOR[t.status] || '#9aa1ae';
  const moduleChip = t.owner_module ? `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.10em;text-transform:uppercase;padding:2px 7px;border-radius:5px;background:#f5f6f8;color:#5b6270;">${escapeHtml(t.owner_module)}</span>` : '';
  const parentBadge = t.parent_task_id ? `<span style="font:500 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">↳ ${escapeHtml(t.parent_task_id)}</span>` : '';
  return `<button type="button" data-task-card="${escapeHtml(t.id)}" style="display:flex;align-items:center;gap:12px;padding:12px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${color};border-radius:11px;text-align:left;cursor:pointer;font-family:inherit;">
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
        ${moduleChip}
        ${parentBadge}
        <span style="font:500 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${color};text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(t.status || 'unknown')}</span>
      </div>
      <div style="font-size:13.5px;color:#16181e;font-weight:600;line-height:1.35;">${escapeHtml(t.title || '')}</div>
    </div>
    ${(t.spawned_task_ids || []).length > 0 ? `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#3468d6;flex-shrink:0;">${t.spawned_task_ids.length} child${t.spawned_task_ids.length === 1 ? '' : 'ren'}</span>` : ''}
  </button>`;
}

function openTaskDetail(bu, taskId, allTasks) {
  const t = allTasks.find(x => x.id === taskId);
  if (!t) return;
  const parent = t.parent_task_id ? allTasks.find(x => x.id === t.parent_task_id) : null;
  const children = (t.spawned_task_ids || []).map(id => allTasks.find(x => x.id === id)).filter(Boolean);
  const history = (t.history || []).slice(-12);

  const body = `
    <div style="font-size:12.5px;color:#5b6270;line-height:1.55;margin-bottom:14px;">${escapeHtml(t.description || 'No description.')}</div>
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:6px;">Owner</div>
    <div style="font-size:13px;color:#16181e;margin-bottom:14px;">${escapeHtml(t.owner_module || '—')} · ${escapeHtml((t.target || {}).executor || '—')}</div>
    ${parent ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:6px;">Parent</div><div style="font-size:12.5px;color:#3468d6;margin-bottom:14px;">${escapeHtml(parent.title)}</div>` : ''}
    ${children.length > 0 ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:6px;">Spawned children (${children.length})</div><ul style="margin:0 0 14px 0;padding-left:18px;font-size:12.5px;color:#3468d6;">${children.map(c => `<li>${escapeHtml(c.title)}</li>`).join('')}</ul>` : ''}
    ${history.length > 0 ? `<div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:6px;">History</div><ul style="margin:0;padding-left:16px;font-size:12px;color:#5b6270;line-height:1.6;">${history.map(h => `<li><span style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml((h.at||'').slice(0,10))}</span> — ${escapeHtml(h.action)}${h.from && h.to ? ` (${escapeHtml(h.from)} → ${escapeHtml(h.to)})` : ''}</li>`).join('')}</ul>` : ''}
  `;

  // "Run now" — synchronous in-Node execution via /api/execute-task. Shows
  // when the task isn't already done. Fresh-install operators use this to
  // close the task→execute→done loop without Paperclip.
  const canRun = t.status !== 'done' && t.status !== 'cancelled';
  const outcomeBlock = (t.execution?.outcome_artifact) ? `
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin:14px 0 6px 0;">Execution outcome</div>
    <div style="font-size:12px;color:#5b6270;line-height:1.55;">${escapeHtml((t.execution.outcome_summary || '').slice(0, 500))}${(t.execution.outcome_summary || '').length > 500 ? '…' : ''}</div>
    <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-top:6px;">artifact: ${escapeHtml(t.execution.outcome_artifact.memo_id || '(none)')}</div>
  ` : '';

  const footer = `<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;">
    <span id="task-run-status" style="font-size:12px;color:#5b6270;margin-right:auto;"></span>
    ${canRun ? `<button type="button" id="task-run-now-btn" class="onboard-begin" style="padding:6px 14px;font-size:12px;background:#0e9f6e;">▶ Run now</button>` : ''}
    <button type="button" id="task-spawn-btn" class="onboard-cancel" style="padding:6px 12px;font-size:12px;">+ Spawn child</button>
    <button type="button" id="task-handoff-btn" class="onboard-begin" style="padding:6px 14px;font-size:12px;">Handoff →</button>
  </div>`;

  openDrawer({
    eyebrow: 'TASK',
    title: t.title,
    bodyHtml: body + outcomeBlock,
    footerHtml: footer,
  });

  document.getElementById('task-run-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('task-run-now-btn');
    const status = document.getElementById('task-run-status');
    if (!btn || !status) return;
    btn.disabled = true;
    btn.textContent = 'Running…';
    status.textContent = 'Calling agent — this can take up to a minute.';
    status.style.color = '#5b6270';
    try {
      const r = await fetch('/api/execute-task', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bu, task_id: t.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      status.textContent = `✓ Done — executed by ${j.executor}. Artifact: ${j.artifact?.id || 'saved'}. Refreshing…`;
      status.style.color = '#0e9f6e';
      setTimeout(() => renderTasksCentral(), 900);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '▶ Run now';
      status.textContent = `✗ ${e.message || 'Failed. Task status unchanged.'}`;
      status.style.color = '#df4b3f';
    }
  });

  document.getElementById('task-spawn-btn')?.addEventListener('click', async () => {
    const title = await showPrompt('Child task title:', { subtitle: 'Spawn task' });
    if (!title) return;
    await fetch('/api/tasks-layered', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'spawn', parent_task_id: t.id, child: { title, description: '', owner_module: t.owner_module } }),
    });
    await renderTasksCentral();
  });

  document.getElementById('task-handoff-btn')?.addEventListener('click', async () => {
    const to = await showPrompt('Handoff to module (product / finance / strategy / development / learning / hr / sales / marketing):', { subtitle: 'Handoff' });
    if (!to) return;
    await fetch('/api/tasks-layered', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, action: 'handoff', task_id: t.id, to_module: to }),
    });
    await renderTasksCentral();
  });
}
