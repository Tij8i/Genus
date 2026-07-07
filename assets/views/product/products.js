// Products switcher — list of products this BU is building. A "product" can
// be the platform itself, an agent product, a service, etc. For first ship
// the operator's BU may have just one product (its own); the view scales
// to multiple.

import { currentBu, loadProductFile, pageHeader, emptyPanel, escapeHtml, VSTATE } from './_shared.js';
import { showAlert, showConfirm, showPrompt } from '../../dialog.js';

const OWNERS = {
  alessio: { name: 'Alessio Tixi', av: 'A',  grad: 'linear-gradient(135deg,#2f6bff,#7a4dff)' },
  sage:    { name: 'Sage',         av: 'SG', grad: 'linear-gradient(135deg,#0e9f6e,#2fb7a0)' },
  jordan:  { name: 'Jordan Lee',   av: 'JL', grad: 'linear-gradient(135deg,#e0683a,#f0a04b)' },
  sam:     { name: 'Sam Okafor',   av: 'SO', grad: 'linear-gradient(135deg,#7a4dff,#a07bff)' },
};

export async function renderProducts() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-products'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading products…</div>';

  const data = await loadProductFile(bu, 'products.json');
  const products = data?.products || [];

  root.innerHTML = `
    <div style="max-width:1080px;margin:0 auto;padding:0 8px 80px;">
      ${pageHeader({
        eyebrow: `${bu.toUpperCase()} · PRODUCT`,
        title: 'Products',
        sub: 'What this venture is building. The Roadmap, Releases and Vision below scope to the selected product.',
        action: `<button type="button" id="add-product-btn" class="primary-btn-pill" style="display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:14px;font-weight:600;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          New product
        </button>`,
      })}

      ${products.length === 0 ? emptyPanel({
        icon: '▢',
        color: '#2f6bff',
        title: 'No products yet',
        copy: 'Add the first product to this venture — the platform, an agent, a service.',
        ctaLabel: '+ Add a product',
      }) : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(340px, 1fr));gap:14px;">
          ${products.map(renderProductCard).join('')}
        </div>`}
    </div>
  `;
  document.getElementById('add-product-btn')?.addEventListener('click', async () => await showAlert('+ New product — sets up a new product space (Vision / Roadmap / Releases) under this BU. Ships in a follow-up.'));
}

function renderProductCard(p) {
  const vs = VSTATE[p.vstate] || VSTATE.planned;
  const owner = OWNERS[p.owner];
  const pct = p.items > 0 ? Math.round((p.shipped / p.items) * 100) : 0;
  return `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);">
    <div style="display:flex;align-items:center;gap:13px;margin-bottom:14px;">
      <span style="width:48px;height:48px;flex:none;border-radius:13px;background:${escapeHtml(p.grad)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;letter-spacing:-.02em;">${escapeHtml(p.av)}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
          <strong style="font-size:15.5px;color:#16181d;">${escapeHtml(p.name)}</strong>
          <span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:#7a4dff;background:rgba(122,77,255,.10);border-radius:5px;padding:2px 6px;">${escapeHtml((p.kind || '').toUpperCase())}</span>
        </div>
        <div style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-top:3px;">${escapeHtml(p.version || '—')} · ${escapeHtml(vs.l)}</div>
      </div>
    </div>
    <p style="font-size:13.5px;color:#5b6270;line-height:1.5;margin:0 0 14px;">${escapeHtml(p.what || '')}</p>
    <div style="display:flex;justify-content:space-between;align-items:center;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-bottom:7px;">
      <span>${p.shipped || 0} of ${p.items || 0} items shipped</span>
      <span>${pct}%</span>
    </div>
    <div style="height:5px;border-radius:99px;background:rgba(20,22,28,.06);overflow:hidden;margin-bottom:14px;">
      <div style="height:100%;width:${pct}%;background:${vs.c};"></div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding-top:12px;border-top:1px solid rgba(20,22,28,.06);">
      ${owner ? `<span style="width:24px;height:24px;border-radius:99px;background:${owner.grad};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">${escapeHtml(owner.av)}</span><span style="font-size:12.5px;color:#5b6270;">${escapeHtml(owner.name)}</span>` : ''}
      <a href="#roadmap" style="margin-left:auto;font-size:12.5px;font-weight:600;color:#2f6bff;text-decoration:none;">Roadmap →</a>
    </div>
  </div>`;
}
