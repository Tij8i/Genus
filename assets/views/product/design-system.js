// Design system reference — sectioned docs with a sticky left nav.
// v1 ships Colors / Typography / Spacing / Components / Brand. Imagery /
// AI prompts / Patterns / Icons are stubbed sections in the nav and
// render a "documented soon" placeholder for now.

import { currentBu, loadProductFile, pageHeader, emptyPanel, escapeHtml } from './_shared.js';

let DS_SECTION = 'colors';

const SECTIONS = [
  { key: 'colors',     label: 'Colors',       count: 5 },
  { key: 'typography', label: 'Typography',   count: 5 },
  { key: 'spacing',    label: 'Spacing',      count: 6 },
  { key: 'components', label: 'Components',   count: 4 },
  { key: 'imagery',    label: 'Imagery',      count: 3, stub: true },
  { key: 'prompts',    label: 'AI prompts',   count: 3, stub: true },
  { key: 'brand',      label: 'Brand & voice', count: '—' },
  { key: 'patterns',   label: 'Patterns',     count: 3, stub: true },
  { key: 'icons',      label: 'Icons',        count: 18, stub: true },
];

export async function renderDesignSystem() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-design-system'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading design system…</div>';

  const data = await loadProductFile(bu, 'design_system.json');
  if (!data) {
    root.innerHTML = pageHeader({
      eyebrow: `${bu.toUpperCase()} · PRODUCT`,
      title: 'Design system',
      sub: 'Tokens, components and patterns that hold this product together.',
    }) + emptyPanel({
      icon: '◊',
      color: '#2f6bff',
      title: 'No design system documented yet',
      copy: 'Import tokens from Figma or Storybook, or document the ones you already use in code.',
      ctaLabel: '+ Start documenting',
    });
    return;
  }

  root.innerHTML = `
    <div style="display:flex;gap:20px;max-width:1280px;margin:0 auto;padding:0 8px 80px;">
      <aside style="width:220px;flex:none;position:sticky;top:24px;align-self:flex-start;">
        <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:10px;padding:0 10px;">${bu.toUpperCase()} · DS</div>
        <nav style="display:flex;flex-direction:column;gap:2px;">
          ${SECTIONS.map(s => {
            const on = DS_SECTION === s.key;
            const fg = on ? '#16181d' : (s.stub ? '#9aa1ae' : '#5b6270');
            const bg = on ? 'rgba(47,107,255,.10)' : 'transparent';
            const w = on ? 700 : 500;
            return `<button type="button" data-ds-section="${escapeHtml(s.key)}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:none;border-radius:8px;background:${bg};color:${fg};font-family:inherit;font-size:13px;font-weight:${w};cursor:pointer;text-align:left;">
              <span style="flex:1;">${escapeHtml(s.label)}</span>
              <span style="font:500 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(String(s.count))}</span>
            </button>`;
          }).join('')}
        </nav>
      </aside>
      <main style="flex:1;min-width:0;">
        ${pageHeader({
          eyebrow: `${bu.toUpperCase()} · PRODUCT`,
          title: 'Design system',
          sub: 'Tokens, components and patterns that hold this product together.',
        })}
        ${renderSection(data)}
      </main>
    </div>
  `;
  document.querySelectorAll('[data-ds-section]').forEach(btn => btn.addEventListener('click', () => {
    DS_SECTION = btn.dataset.dsSection;
    renderDesignSystem();
  }));
}

function renderSection(data) {
  if (DS_SECTION === 'colors')     return renderColors(data.colors || []);
  if (DS_SECTION === 'typography') return renderTypography(data.typography || []);
  if (DS_SECTION === 'spacing')    return renderSpacing(data.spacing || []);
  if (DS_SECTION === 'components') return renderComponents(data);
  if (DS_SECTION === 'brand')      return renderBrand(data.brand || {});
  return renderStub(SECTIONS.find(s => s.key === DS_SECTION)?.label || DS_SECTION);
}

function renderColors(groups) {
  return groups.map(g => `<section style="margin-bottom:22px;">
    <h2 style="font-size:17px;font-weight:700;margin:0 0 12px;color:#16181d;">${escapeHtml(g.group)}</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
      ${(g.tokens || []).map(t => `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:11px;padding:13px;display:flex;align-items:center;gap:12px;">
        <span style="width:42px;height:42px;border-radius:9px;background:${escapeHtml(t.hex)};flex:none;box-shadow:inset 0 0 0 1px rgba(20,22,28,.05);"></span>
        <div style="display:flex;flex-direction:column;min-width:0;flex:1;">
          <strong style="font-size:13px;color:#16181d;">${escapeHtml(t.name)}</strong>
          <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;">${escapeHtml(t.hex)}</span>
          <span style="font:500 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(t.var)}</span>
        </div>
      </div>`).join('')}
    </div>
  </section>`).join('');
}

function renderTypography(rows) {
  return `<div style="display:flex;flex-direction:column;gap:12px;">
    ${rows.map(t => `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:18px 22px;">
      <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-bottom:8px;">${escapeHtml(t.spec)} · ${escapeHtml(t.label)}</div>
      <div style="font-size:${t.size}px;font-weight:${t.weight};font-family:${t.family};color:#16181d;line-height:1.2;">${escapeHtml(t.sample)}</div>
    </div>`).join('')}
  </div>`;
}

function renderSpacing(rows) {
  return `<div style="display:flex;flex-direction:column;gap:8px;">
    ${rows.map(s => `<div style="display:flex;align-items:center;gap:14px;padding:13px 16px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:11px;">
      <span style="font:600 13px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;width:60px;">${s.px}px</span>
      <span style="height:18px;background:rgba(47,107,255,.18);border-radius:4px;display:block;width:${s.px}px;"></span>
    </div>`).join('')}
  </div>`;
}

function renderComponents(data) {
  const pills = data.components_pills || [];
  const statuses = data.components_status || [];
  return `
    <section style="margin-bottom:22px;">
      <h2 style="font-size:17px;font-weight:700;margin:0 0 12px;color:#16181d;">Pills</h2>
      <div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:18px;display:flex;flex-wrap:wrap;gap:8px;">
        ${pills.map(p => `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${escapeHtml(p.c)};background:${escapeHtml(p.b)};border-radius:5px;padding:3px 8px;text-transform:uppercase;">${escapeHtml(p.label)}</span>`).join('')}
      </div>
    </section>
    <section style="margin-bottom:22px;">
      <h2 style="font-size:17px;font-weight:700;margin:0 0 12px;color:#16181d;">Status dots</h2>
      <div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:18px;display:flex;flex-direction:column;gap:10px;">
        ${statuses.map(s => `<div style="display:flex;align-items:center;gap:9px;">
          <span style="width:8px;height:8px;border-radius:99px;background:${escapeHtml(s.c)};animation:${escapeHtml(s.anim)};"></span>
          <span style="font-size:13.5px;color:#3a3f4a;">${escapeHtml(s.label)}</span>
        </div>`).join('')}
      </div>
    </section>
  `;
}

function renderBrand(brand) {
  const principles = brand.principles || [];
  const say = brand.say || [];
  const avoid = brand.avoid || [];
  return `
    <section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:22px 24px;margin-bottom:14px;">
      <h2 style="font-size:17px;font-weight:700;margin:0 0 14px;color:#16181d;">Principles</h2>
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${principles.map(p => `<div>
          <strong style="font-size:13.5px;color:#16181d;">${escapeHtml(p.t)}</strong>
          <p style="font-size:13.5px;color:#5b6270;line-height:1.55;margin:4px 0 0;">${escapeHtml(p.d)}</p>
        </div>`).join('')}
      </div>
    </section>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <section style="background:rgba(14,159,110,.06);border:1px solid rgba(14,159,110,.18);border-radius:12px;padding:18px;">
        <div style="font:600 11px Hanken Grotesk,sans-serif;color:#0e9f6e;margin-bottom:9px;">Say</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${say.map(w => `<span style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#0e7e58;background:rgba(14,159,110,.10);border-radius:5px;padding:3px 8px;">${escapeHtml(w)}</span>`).join('')}
        </div>
      </section>
      <section style="background:rgba(192,57,43,.05);border:1px solid rgba(192,57,43,.15);border-radius:12px;padding:18px;">
        <div style="font:600 11px Hanken Grotesk,sans-serif;color:#c0392b;margin-bottom:9px;">Avoid</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${avoid.map(w => `<span style="font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9b2c20;background:rgba(192,57,43,.07);border-radius:5px;padding:3px 8px;">${escapeHtml(w)}</span>`).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderStub(label) {
  return `<div style="background:#fbfbfc;border:1.5px dashed rgba(20,22,28,.14);border-radius:14px;padding:50px 30px;text-align:center;color:#9aa1ae;">
    <div style="font-size:14px;">${escapeHtml(label)} — documented in a follow-up slice.</div>
    <div style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#bcc1cb;margin-top:5px;">Defer per first-ship scope.</div>
  </div>`;
}
