// Roadmap i51 — Sales module.
// Route: #sales-overview + #sales-pipeline + #sales-contacts

import { escapeHtml, currentBu } from './workflows/_shared.js';
import { moduleMetaFor, renderModuleShell, renderListSection, newButton, fetchModuleData, createModuleItem, openStewardChat } from './module-scaffold.js';

const STAGE_COLOR = { Lead: '#5b6270', Qualified: '#3468d6', Proposal: '#c78500', Won: '#238c46', Lost: '#9aa1ae' };

export async function renderSalesOverview() {
  const root = document.getElementById('route-sales-overview');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading Sales…</div>';

  const [meta, deals, contacts] = await Promise.all([
    moduleMetaFor('sales'),
    fetchModuleData(bu, 'sales', 'deals.json'),
    fetchModuleData(bu, 'sales', 'contacts.json'),
  ]);
  const deals_list = deals?.deals || [];
  const contacts_list = contacts?.contacts || [];

  const openDeals = deals_list.filter(d => !['Won','Lost'].includes(d.stage));
  const value = deals_list.filter(d => d.stage === 'Won').reduce((s, d) => s + (d.value || 0), 0);
  const overdue = deals_list.filter(d => d.next_step_due && new Date(d.next_step_due) < new Date() && !['Won','Lost'].includes(d.stage)).length;

  const stats = [
    { label: 'OPEN DEALS', value: openDeals.length, sub: `${deals_list.length} lifetime` },
    { label: 'PIPELINE VALUE', value: openDeals.reduce((s,d) => s + (d.value || 0), 0).toLocaleString('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), sub: 'open only' },
    { label: 'WON', value: value.toLocaleString('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), sub: 'all-time', color: '#238c46' },
    { label: 'OVERDUE', value: overdue, sub: 'next-step past due', color: overdue > 0 ? '#c12525' : '#238c46' },
  ];

  const dealCard = (d) => `<div style="padding:12px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-left:4px solid ${STAGE_COLOR[d.stage] || '#5b6270'};border-radius:11px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:2px 8px;border-radius:5px;background:${STAGE_COLOR[d.stage]}22;color:${STAGE_COLOR[d.stage]};">${escapeHtml(d.stage || 'Lead')}</span>
      <span style="font-size:13.5px;font-weight:600;color:#16181e;flex:1;">${escapeHtml(d.company || d.contact || 'Untitled deal')}</span>
      ${d.value ? `<span style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;">${d.value.toLocaleString('en-US', { style: 'currency', currency: d.currency || 'EUR', maximumFractionDigits: 0 })}</span>` : ''}
    </div>
    ${d.next_step ? `<div style="font-size:12px;color:#5b6270;">Next: ${escapeHtml(d.next_step)}${d.next_step_due ? ` · due ${escapeHtml(d.next_step_due.slice(0,10))}` : ''}</div>` : ''}
  </div>`;

  const body = renderListSection({ title: 'Recent deals', items: deals_list.slice(0, 10), emptyCopy: 'No deals yet. Click New or use Import to bring in existing pipeline.', itemRenderer: dealCard })
    + `<div style="margin-top:8px;"><a href="#sales-pipeline" style="font-size:13px;color:#3468d6;text-decoration:none;font-weight:600;">See full pipeline →</a> · <a href="#sales-contacts" style="font-size:13px;color:#3468d6;text-decoration:none;font-weight:600;margin-left:10px;">${contacts_list.length} contact${contacts_list.length === 1 ? '' : 's'} →</a></div>`;

  root.innerHTML = renderModuleShell({
    mod: 'sales', meta, stats,
    headerRight: `<div style="display:flex;gap:8px;">
      <button type="button" id="chat-steward-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">💬 Steward</button>
      <button type="button" id="import-btn" class="onboard-cancel" style="padding:8px 12px;font-size:12px;">Import</button>
      ${newButton(meta?.color)}
    </div>`,
    bodyHtml: body,
  });

  document.getElementById('chat-steward-btn')?.addEventListener('click', () => openStewardChat('sales'));
  document.getElementById('mod-new-btn')?.addEventListener('click', async () => {
    const company = prompt('Company / contact:'); if (!company) return;
    const stage = prompt("Stage — 'Lead', 'Qualified', 'Proposal':", 'Lead') || 'Lead';
    const valueStr = prompt('Value (number, no currency symbol):') || '0';
    const value = parseFloat(valueStr) || 0;
    try {
      await createModuleItem({ bu, module: 'sales', file: 'deals.json', item: { company, stage, value, currency: 'EUR', opened_at: new Date().toISOString(), next_step: '', notes: '' } });
      await renderSalesOverview();
    } catch (e) { alert(`Could not create deal: ${e.message}`); }
  });
  document.getElementById('import-btn')?.addEventListener('click', () => {
    const paste = prompt('Paste unstructured pipeline data. Sales Stewart will decompose on its next run.\n\n(v0.9 dev: files a task on Sales Stewart with the raw paste.)');
    if (paste) alert('Import queued. Sales Stewart will process on its next heartbeat.');
  });
}
