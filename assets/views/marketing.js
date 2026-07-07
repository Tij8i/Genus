// Roadmap i52 — Marketing module.
// Route: #marketing-overview + #marketing-campaigns + #marketing-content

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { moduleMetaFor, renderModuleShell, renderListSection, newButton, fetchModuleData, createModuleItem, openStewardChat } from './module-scaffold.js';
import { showAlert, showConfirm, showPrompt } from '../dialog.js';

const STATUS_COLOR = { draft: '#9aa1ae', live: '#238c46', paused: '#c78500', closed: '#5b6270' };

export async function renderMarketingOverview() {
  const root = document.getElementById('route-marketing-overview');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading Marketing…</div>';

  const [meta, campaigns, content] = await Promise.all([
    moduleMetaFor('marketing'),
    fetchModuleData(bu, 'marketing', 'campaigns.json'),
    fetchModuleData(bu, 'marketing', 'content.json'),
  ]);
  const campaigns_list = campaigns?.campaigns || [];
  const content_list = content?.items || [];

  const active = campaigns_list.filter(c => c.status === 'live').length;
  const inflight = content_list.filter(c => ['draft','scheduled'].includes(c.status)).length;
  const spend = campaigns_list.reduce((s, c) => s + (c.spent || 0), 0);
  const topCampaign = campaigns_list.slice().sort((a,b) => (b.spent || 0) - (a.spent || 0))[0];

  const stats = [
    { label: 'ACTIVE', value: active, sub: `${campaigns_list.length} campaigns total` },
    { label: 'CONTENT IN FLIGHT', value: inflight, sub: 'draft or scheduled' },
    { label: 'SPEND', value: spend.toLocaleString('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), sub: 'this month' },
    { label: 'TOP CAMPAIGN', value: topCampaign ? topCampaign.name.slice(0, 20) : '—', sub: topCampaign ? `${(topCampaign.spent || 0).toLocaleString('en-US')}€ spent` : 'no campaigns yet' },
  ];

  const campaignCard = (c) => `<div style="padding:12px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${STATUS_COLOR[c.status] || '#5b6270'};border-radius:11px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:${STATUS_COLOR[c.status]}22;color:${STATUS_COLOR[c.status]};">${escapeHtml(c.status || 'draft')}</span>
      <span style="font-size:13.5px;font-weight:600;color:#16181e;flex:1;">${escapeHtml(c.name || 'Untitled')}</span>
      ${c.channel ? `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;">${escapeHtml(c.channel)}</span>` : ''}
    </div>
    ${c.goal ? `<div style="font-size:12px;color:#5b6270;">Goal: ${escapeHtml(c.goal)}</div>` : ''}
  </div>`;

  const body = renderListSection({ title: 'Campaigns', items: campaigns_list.slice(0, 10), emptyCopy: 'No campaigns yet. Every campaign is an experiment by default — Learning module links back.', itemRenderer: campaignCard });

  root.innerHTML = renderModuleShell({
    mod: 'marketing', meta, stats,
    headerRight: `<div style="display:flex;gap:8px;">
      <button type="button" id="chat-steward-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">💬 Steward</button>
      <button type="button" id="import-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">Import</button>
      ${newButton(meta?.color)}
    </div>`,
    bodyHtml: body,
  });

  document.getElementById('chat-steward-btn')?.addEventListener('click', () => openStewardChat('marketing'));
  document.getElementById('mod-new-btn')?.addEventListener('click', async () => {
    const name = await showPrompt('Campaign name:'); if (!name) return;
    const channel = await showPrompt('Channel (e.g. LinkedIn / Email / Content):') || '';
    const goal = await showPrompt('Goal (one sentence):') || '';
    try {
      await createModuleItem({ bu, module: 'marketing', file: 'campaigns.json', item: { name, channel, goal, status: 'draft', budget: 0, spent: 0, started_at: null, closed_at: null, linked_experiment_id: null, notes: '' } });
      await renderMarketingOverview();
    } catch (e) { await showAlert(`Could not create campaign: ${e.message}`); }
  });
  document.getElementById('import-btn')?.addEventListener('click', async () => {
    const paste = await showPrompt('Paste unstructured campaign/content data. Marketing Stewart will decompose on its next run.');
    if (paste) await showAlert('Import queued. Marketing Stewart will process on its next heartbeat.');
  });
}
