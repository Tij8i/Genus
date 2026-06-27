// Vision view — Layered horizons (North Star → This horizon → Now) + Inputs
// + Version history. The Inputs + Library variants from the design handoff
// are deferred; this ships the Layered variant which is the "reading view".

import { currentBu, loadProductFile, pageHeader, emptyPanel, ownerAvatar, escapeHtml } from './_shared.js';

const OWNERS = {
  alessio: { name: 'Alessio Tixi', av: 'A',  grad: 'linear-gradient(135deg,#2f6bff,#7a4dff)' },
  sage:    { name: 'Sage',         av: 'SG', grad: 'linear-gradient(135deg,#0e9f6e,#2fb7a0)' },
  jordan:  { name: 'Jordan Lee',   av: 'JL', grad: 'linear-gradient(135deg,#e0683a,#f0a04b)' },
  sam:     { name: 'Sam Okafor',   av: 'SO', grad: 'linear-gradient(135deg,#7a4dff,#a07bff)' },
};

export async function renderVision() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-vision'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading vision…</div>';

  const data = await loadProductFile(bu, 'vision.json');
  if (!data || !Array.isArray(data.layered) || data.layered.length === 0) {
    root.innerHTML = pageHeader({
      eyebrow: `${bu.toUpperCase()} · PRODUCT`,
      title: 'Vision',
      sub: 'Why this product exists and where it goes — written at three altitudes.',
    }) + emptyPanel({
      icon: '◔',
      color: '#7a4dff',
      title: 'No vision written yet',
      copy: 'Start with the North Star — one sentence the team can repeat. Then add the horizon and what you ship next.',
      ctaLabel: '+ Start the vision',
      ctaHash: '#vision',
    });
    return;
  }

  root.innerHTML = `
    <div style="max-width:760px;margin:0 auto;padding:0 8px 80px;">
      ${pageHeader({
        eyebrow: `${bu.toUpperCase()} · PRODUCT`,
        title: 'Vision',
        sub: 'Why this product exists and where it goes — written at three altitudes.',
        action: `<div style="display:flex;align-items:center;gap:6px;font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">
          last reviewed ${escapeHtml(data.last_review || '—')}
          <span style="width:4px;height:4px;border-radius:99px;background:#bcc1cb;"></span>
          next ${escapeHtml(data.next_review || '—')}
        </div>`,
      })}

      <div style="display:flex;flex-direction:column;gap:14px;">
        ${data.layered.map(renderHorizonCard).join('')}
      </div>

      ${Array.isArray(data.inputs) && data.inputs.length > 0 ? `
        <section style="margin-top:32px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:14px;">Inputs feeding the vision</div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${data.inputs.map(renderInputRow).join('')}
          </div>
        </section>` : ''}

      ${Array.isArray(data.history) && data.history.length > 0 ? `
        <section style="margin-top:16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:14px;">Version history</div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            ${data.history.map(renderHistoryRow).join('')}
          </div>
        </section>` : ''}
    </div>
  `;
}

function renderHorizonCard(h) {
  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;position:relative;overflow:hidden;">
    <span style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${h.color};"></span>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
      <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:${h.color};">${escapeHtml(h.tag)}</span>
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(h.horizon)}</span>
    </div>
    <h2 style="font-size:21px;font-weight:800;letter-spacing:-.02em;margin:0 0 8px;color:#16181d;">${escapeHtml(h.title)}</h2>
    <p style="font-size:14.5px;color:#3a3f4a;line-height:1.6;margin:0;">${escapeHtml(h.body)}</p>
    ${h.touched ? `<div style="margin-top:14px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(h.touched)}</div>` : ''}
  </section>`;
}

function renderInputRow(i) {
  const owner = OWNERS[i.owner];
  return `<div style="display:flex;gap:12px;align-items:flex-start;">
    ${ownerAvatar(owner, 28)}
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <strong style="font-size:13px;color:#16181d;">${escapeHtml(i.author)}</strong>
        <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(i.date)}</span>
      </div>
      <p style="font-size:14px;color:#3a3f4a;line-height:1.55;margin:0;">${escapeHtml(i.text)}</p>
    </div>
  </div>`;
}

function renderHistoryRow(h) {
  const owner = OWNERS[h.owner];
  return `<div style="display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(20,22,28,.05);">
    ${ownerAvatar(owner, 22)}
    <div style="display:flex;flex-direction:column;flex:1;min-width:0;">
      <strong style="font-size:13px;color:#16181d;line-height:1.3;">${escapeHtml(h.label)}</strong>
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(h.author)} · ${escapeHtml(h.date)}</span>
    </div>
    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#0e9f6e;">+${h.add || 0}</span>
    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#c0392b;">−${h.rem || 0}</span>
  </div>`;
}
