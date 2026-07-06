// Function · Tasks tab — Needs you now + Coming up groups with task rows.
// Checkbox toggle is optimistic + local — drives strike-through, due-pill
// swap, and updates the sidebar badge live.

import { C, MODULES, escapeHtml, currentBu, loadWorkflows, loadWorkflowTasks, functionHeader, dueStyle, updateTaskBadges } from './_shared.js';

const DONE = {}; // taskId → bool (in-memory; clears on reload, per design "local/optimistic")

export async function renderFunctionTasks(mod) {
  const root = document.getElementById(`route-${mod}-tasks`);
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading tasks…</div>';

  const [wfData, taskData] = await Promise.all([loadWorkflows(bu), loadWorkflowTasks(bu)]);
  const allTasks = taskData?.tasks || [];
  // i65: filter by owner_module (new) with fallback to legacy mod field so
  // existing task substrate keeps working during the migration.
  const tasks = allTasks.filter(t => t.owner_module === mod || t.mod === mod);
  // Filter out done so the badge + groups reflect optimistic state
  const liveTasks = allTasks.filter(t => !DONE[t.id]);
  updateTaskBadges(liveTasks);

  const modMeta = MODULES[mod];
  const nowTasks = tasks.filter(t => t.group === 'now' && !DONE[t.id]);
  const soonTasks = tasks.filter(t => t.group !== 'now' || DONE[t.id]);

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'tasks' })}
      <p style="font-size:13.5px;color:${C.ink2};margin:0 0 22px;max-width:620px;">The live queue for <strong>${escapeHtml(modMeta.name)}</strong> — every manual step, approval, and overdue run waiting on a person. Each task comes from a workflow.</p>

      ${tasks.length === 0
        ? `<div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;text-align:center;background:#fbfbfc;">
            <h3 style="font-size:17px;font-weight:700;margin:0 0 8px;color:${C.ink};">Nothing in the queue</h3>
            <p style="font-size:13.5px;color:${C.ink2};margin:0;">All ${escapeHtml(modMeta.name)} workflows are running cleanly.</p>
          </div>`
        : `
          ${nowTasks.length > 0 ? renderTaskGroup('Needs you now', nowTasks.length, C.red, nowTasks) : ''}
          ${soonTasks.length > 0 ? renderTaskGroup('Coming up', soonTasks.length, C.ink3, soonTasks) : ''}
        `}
    </div>
  `;

  wireTaskHandlers(mod);
}

function renderTaskGroup(label, count, dotColor, tasks) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin:18px 0 11px;">
      <span style="width:8px;height:8px;border-radius:99px;background:${dotColor};"></span>
      <strong style="font-size:13.5px;color:${C.ink};">${escapeHtml(label)}</strong>
      <span style="font:600 11px ${C.mono};color:${C.ink3};">· ${count}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${tasks.map(taskRow).join('')}
    </div>
  `;
}

function taskRow(t) {
  const done = !!DONE[t.id];
  const d = dueStyle(t.urgency);
  const overdue = t.urgency === 'overdue';
  const boxBorder = done ? C.green : (overdue ? C.red : 'rgba(20,22,28,.3)');
  const boxFill = done ? C.green : 'transparent';
  const check = done ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : '';
  const rowBorder = overdue && !done ? 'rgba(192,57,43,.3)' : C.border;
  const titleStyle = done ? `text-decoration:line-through;color:${C.ink3};` : `color:${C.ink};`;
  const dueBg = done ? 'rgba(14,159,110,.12)' : d.bg;
  const dueColor = done ? C.green : d.color;
  const dueLabel = done ? 'done' : t.due;
  const owner = t.owner || {};

  return `<div class="task-row" data-task-id="${escapeHtml(t.id)}" data-wf-id="${escapeHtml(t.wf_id)}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:${C.card};border:1px solid ${rowBorder};border-radius:13px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <button type="button" class="task-check" style="width:22px;height:22px;border-radius:7px;border:1.8px solid ${boxBorder};background:${boxFill};cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;padding:0;">${check}</button>
    <div style="flex:1;min-width:0;">
      <div style="font-size:14px;font-weight:700;${titleStyle}">${escapeHtml(t.title)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
        <a href="#workflow-detail/${escapeHtml(t.wf_id)}?from=tasks-${escapeHtml(t.mod)}" class="task-wf-chip" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;background:#f3f4f6;text-decoration:none;font:500 11.5px ${C.mono};color:${C.ink2};">
          <span style="width:5px;height:5px;border-radius:99px;background:${escapeHtml(t.kind_dot || C.ink2)};"></span>
          ${escapeHtml(t.wf_title)}
        </a>
        <span style="font:500 10.5px ${C.mono};color:${C.ink3};">step ${escapeHtml(t.step_no)}</span>
        ${t.drafted_fix ? `<span style="font:600 9.5px ${C.mono};letter-spacing:.10em;color:#7a4dff;background:rgba(122,77,255,.12);padding:2px 7px;border-radius:5px;">DRAFTED FIX</span>` : ''}
      </div>
    </div>
    <span style="font:600 11px ${C.mono};color:${dueColor};background:${dueBg};padding:3px 9px;border-radius:6px;flex:none;">${escapeHtml(dueLabel)}</span>
    <span style="width:28px;height:28px;flex:none;border-radius:99px;background:${owner.bg || 'rgba(20,22,28,.08)'};color:${owner.color || C.ink2};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">${escapeHtml(owner.initials || '?')}</span>
  </div>`;
}

function wireTaskHandlers(mod) {
  document.querySelectorAll('.task-check').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.task-row');
      const id = row?.dataset.taskId;
      if (!id) return;
      DONE[id] = !DONE[id];
      renderFunctionTasks(mod);
    });
  });
  document.getElementById('add-workflow-btn')?.addEventListener('click', () => alert('+ Add workflow — overlay ships in the follow-up slice.'));
}
