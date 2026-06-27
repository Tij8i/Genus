// Function · Workflows tab — wide WorkflowRow list with a column header.

import { C, MODULES, escapeHtml, currentBu, loadWorkflows, loadWorkflowTasks, functionHeader, workflowRow, updateTaskBadges } from './_shared.js';

export async function renderFunctionWorkflows(mod) {
  const root = document.getElementById(`route-${mod}-workflows`);
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading workflows…</div>';

  const [wfData, taskData] = await Promise.all([loadWorkflows(bu), loadWorkflowTasks(bu)]);
  const workflows = (wfData?.workflows || []).filter(w => w.mod === mod);
  updateTaskBadges(taskData?.tasks || []);

  const modMeta = MODULES[mod];

  root.innerHTML = `
    <div style="max-width:1180px;margin:0 auto;padding:22px 28px 80px;">
      ${functionHeader({ mod, modName: modMeta.name, modColor: modMeta.color, activeTab: 'workflows' })}
      ${workflows.length === 0
        ? `<div style="border:1.5px dashed rgba(20,22,28,.14);border-radius:16px;padding:48px 32px;text-align:center;background:#fbfbfc;">
            <h3 style="font-size:17px;font-weight:700;margin:0 0 8px;color:${C.ink};">No workflows in ${escapeHtml(modMeta.name)} yet</h3>
            <p style="font-size:13.5px;color:${C.ink2};margin:0 0 16px;">Add the first recurring operation — invoicing, a compliance filing, an onboarding flow.</p>
            <button type="button" id="empty-add-btn" style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border:none;border-radius:11px;background:${C.accent};color:#fff;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;">+ Add workflow</button>
          </div>`
        : `
          <div style="display:grid;grid-template-columns:minmax(0, 2.3fr) minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 1.4fr) 80px minmax(0, 1.5fr);gap:18px;padding:0 18px 10px;font:600 9.5px ${C.mono};letter-spacing:.12em;text-transform:uppercase;color:${C.ink3};">
            <span>Workflow</span><span>Trigger / cadence</span><span>Owner</span><span>Automation</span><span style="text-align:center;">90d</span><span>Last · next</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:9px;">
            ${workflows.map(w => workflowRow(w, false)).join('')}
          </div>`}
    </div>
  `;
  document.getElementById('add-workflow-btn')?.addEventListener('click', () => alert('+ Add workflow — overlay ships in the follow-up slice.'));
  document.getElementById('empty-add-btn')?.addEventListener('click', () => alert('+ Add workflow — overlay ships in the follow-up slice.'));
}
