// Backlog — roadmap ideas not yet versioned. Simple list.

import { currentBu, loadProductFile, pageHeader, emptyPanel, ownerAvatar, escapeHtml, TAG } from './_shared.js';

const OWNERS = {
  alessio: { name: 'Alessio Tixi', av: 'A',  grad: 'linear-gradient(135deg,#2f6bff,#7a4dff)' },
  sage:    { name: 'Sage',         av: 'SG', grad: 'linear-gradient(135deg,#0e9f6e,#2fb7a0)' },
  jordan:  { name: 'Jordan Lee',   av: 'JL', grad: 'linear-gradient(135deg,#e0683a,#f0a04b)' },
  sam:     { name: 'Sam Okafor',   av: 'SO', grad: 'linear-gradient(135deg,#7a4dff,#a07bff)' },
};

export async function renderBacklog() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-backlog'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading backlog…</div>';

  const data = await loadProductFile(bu, 'backlog.json');
  const items = data?.items || [];

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:0 8px 80px;">
      ${pageHeader({
        eyebrow: `${bu.toUpperCase()} · PRODUCT`,
        title: 'Backlog',
        sub: 'Ideas that aren\'t yet on a version. Promote into the roadmap when they have a home.',
        action: `<a href="#roadmap" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid rgba(20,22,28,.12);border-radius:10px;background:#fff;color:#16181d;font-size:13px;font-weight:600;text-decoration:none;">View roadmap →</a>`,
      })}

      ${items.length === 0 ? emptyPanel({
        icon: '◇',
        color: '#5b6270',
        title: 'No backlog items yet',
        copy: 'Add ideas, observations, asks — anything that should one day join the roadmap.',
        ctaLabel: '+ Add an idea',
      }) : `
        <div style="display:flex;flex-direction:column;gap:9px;">
          ${items.map(renderBacklogRow).join('')}
        </div>`}
    </div>
  `;
}

function renderBacklogRow(item) {
  const owner = OWNERS[item.owner];
  const tags = (item.tags || []).map(t => TAG[t]).filter(Boolean);
  return `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:15px 17px;display:flex;align-items:center;gap:14px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="flex:1;min-width:0;">
      <strong style="font-size:14.5px;color:#16181d;display:block;margin-bottom:4px;">${escapeHtml(item.title)}</strong>
      <p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5;">${escapeHtml(item.note || '')}</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex:none;">
      ${tags.map(t => `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${t.c};background:${t.b};border-radius:5px;padding:2px 6px;">${t.label}</span>`).join('')}
      ${ownerAvatar(owner, 26)}
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">
        <span>${item.notes || 0} notes</span>
        <span>${escapeHtml(item.age || '')}</span>
      </div>
    </div>
  </div>`;
}
