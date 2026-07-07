// Roadmap i48 — Testing & Learning as a first-class module.
// Route: #learning-overview (new, distinct from #learning which is the
// Strategy → Learning info-tile view).

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { moduleMetaFor, renderModuleShell, renderListSection, newButton, fetchModuleData, createModuleItem, openStewardChat } from './module-scaffold.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

const RESULT_COLOR = { confirmed: '#238c46', refuted: '#c12525', inconclusive: '#c78500' };

export async function renderLearningOverview() {
  const root = document.getElementById('route-learning-overview');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading Learning…</div>';

  const [meta, payload] = await Promise.all([moduleMetaFor('learning'), fetchModuleData(bu, 'learning', 'experiments.json')]);
  const experiments = payload?.experiments || [];

  const open = experiments.filter(e => e.status === 'in_progress').length;
  const confirmed = experiments.filter(e => e.result === 'confirmed').length;
  const refuted = experiments.filter(e => e.result === 'refuted').length;
  const inconclusive = experiments.filter(e => e.result === 'inconclusive').length;

  const stats = [
    { label: 'OPEN', value: open, sub: 'in progress' },
    { label: 'CONFIRMED', value: confirmed, sub: 'hypothesis held', color: RESULT_COLOR.confirmed },
    { label: 'REFUTED', value: refuted, sub: 'hypothesis broken', color: RESULT_COLOR.refuted },
    { label: 'INCONCLUSIVE', value: inconclusive, sub: 'need more signal', color: RESULT_COLOR.inconclusive },
  ];

  const renderCard = (e) => {
    const resultChip = e.result
      ? `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:${RESULT_COLOR[e.result]}22;color:${RESULT_COLOR[e.result]};">${escapeHtml(e.result)}</span>`
      : `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:#eef0f4;color:#5b6270;">${escapeHtml(e.status || 'pending')}</span>`;
    return `<div style="padding:14px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${e.result ? RESULT_COLOR[e.result] : '#7a4dff'};border-radius:11px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        ${resultChip}
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.10em;text-transform:uppercase;color:#9aa1ae;">${escapeHtml(e.test_type || 'general')}</span>
      </div>
      <div style="font-size:14px;color:#16181e;font-weight:600;margin-bottom:4px;">${escapeHtml(e.title || '')}</div>
      <div style="font-size:12.5px;color:#5b6270;line-height:1.5;">${escapeHtml(e.hypothesis || '')}</div>
    </div>`;
  };

  const body = renderListSection({ title: 'Experiments', items: experiments, emptyCopy: 'No experiments yet — hypothesis + measurement = a good place to start.', itemRenderer: renderCard });

  root.innerHTML = renderModuleShell({
    mod: 'learning', meta, stats,
    headerRight: `<div style="display:flex;gap:8px;">
      <button type="button" id="chat-steward-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">💬 Steward</button>
      ${newButton(meta?.color)}
    </div>`,
    bodyHtml: body,
  });

  document.getElementById('chat-steward-btn')?.addEventListener('click', () => openStewardChat('learning'));
  document.getElementById('mod-new-btn')?.addEventListener('click', async () => {
    const title = await showPrompt('Experiment title:'); if (!title) return;
    const hypothesis = await showPrompt('Hypothesis (one sentence):'); if (!hypothesis) return;
    const test_type = await showPrompt("Test type — 'commercial', 'infra', or 'agent-interaction':", 'commercial') || 'commercial';
    try {
      await createModuleItem({ bu, module: 'learning', file: 'experiments.json', item: { title, hypothesis, test_type, status: 'in_progress', started_at: new Date().toISOString(), owner_agent_id: 'strategy-stewart', result: null, measured_delta: null, learnings: [] } });
      await renderLearningOverview();
    } catch (e) { await showAlert(`Could not create experiment: ${e.message}`); }
  });
}
