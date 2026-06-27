// Decisions — ADR list + per-decision detail page.

import { currentBu, loadProductFile, pageHeader, emptyPanel, escapeHtml, pathSegment, DSTATUS, REL_META } from './_shared.js';

let DEC_FILTER = 'all';

export async function renderDecisions() {
  const root = document.getElementById('route-decisions');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading decisions…</div>';

  const data = await loadProductFile(bu, 'decisions.json');
  const all = data?.decisions || [];

  if (all.length === 0) {
    root.innerHTML = pageHeader({
      eyebrow: `${bu.toUpperCase()} · PRODUCT`,
      title: 'Decisions',
      sub: 'Architecture Decision Records — why this product is the way it is.',
    }) + emptyPanel({
      icon: '◑',
      color: '#2f6bff',
      title: 'No decisions recorded yet',
      copy: 'Write the first ADR. Decisions are durable — they outlive any release.',
      ctaLabel: '+ New decision',
    });
    return;
  }

  const counts = all.reduce((m, d) => { m[d.status] = (m[d.status] || 0) + 1; return m; }, {});
  const filters = [
    ['all', 'All', all.length],
    ['accepted', 'Accepted', counts.accepted || 0],
    ['proposed', 'Proposed', counts.proposed || 0],
    ['superseded', 'Superseded', counts.superseded || 0],
    ['deprecated', 'Deprecated', counts.deprecated || 0],
  ];
  const filtered = DEC_FILTER === 'all' ? all : all.filter(d => d.status === DEC_FILTER);

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:0 8px 80px;">
      ${pageHeader({
        eyebrow: `${bu.toUpperCase()} · PRODUCT`,
        title: 'Decisions',
        sub: 'Architecture Decision Records — why this product is the way it is.',
      })}

      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px;">
        ${filters.map(([k, label, count]) => {
          const on = DEC_FILTER === k;
          return `<button type="button" data-dec-filter="${k}" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:1px solid ${on ? 'rgba(47,107,255,.3)' : 'rgba(20,22,28,.12)'};border-radius:99px;background:${on ? 'rgba(47,107,255,.08)' : '#fff'};color:${on ? '#16181d' : '#5b6270'};font-family:inherit;font-size:12.5px;font-weight:${on ? 700 : 500};cursor:pointer;">
            ${escapeHtml(label)} <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${count}</span>
          </button>`;
        }).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:9px;">
        ${filtered.map(renderDecisionCard).join('')}
      </div>
    </div>
  `;
  document.querySelectorAll('[data-dec-filter]').forEach(btn => btn.addEventListener('click', () => {
    DEC_FILTER = btn.dataset.decFilter;
    renderDecisions();
  }));
}

function renderDecisionCard(d) {
  const st = DSTATUS[d.status] || DSTATUS.accepted;
  return `<a href="#decision-detail/${escapeHtml(d.id)}" style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:16px 18px;text-decoration:none;color:inherit;display:block;box-shadow:0 1px 2px rgba(16,18,28,.04);transition:all .12s;" onmouseover="this.style.borderColor='rgba(20,22,28,.18)';this.style.boxShadow='0 4px 14px rgba(16,18,28,.07)';" onmouseout="this.style.borderColor='rgba(20,22,28,.08)';this.style.boxShadow='0 1px 2px rgba(16,18,28,.04)';">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
      <span style="font:700 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;background:rgba(20,22,28,.05);padding:2px 9px;border-radius:6px;">${escapeHtml(d.num)}</span>
      <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${st.fg};background:${st.bg};border-radius:5px;padding:2px 7px;">${escapeHtml(d.status.toUpperCase())}</span>
      <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-left:auto;">${escapeHtml(d.date)}</span>
    </div>
    <h3 style="font-size:15px;font-weight:700;margin:0 0 6px;color:#16181d;">${escapeHtml(d.title)}</h3>
    <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">${escapeHtml(d.context || '')}</p>
  </a>`;
}

// ============ Decision detail ============

export async function renderDecisionDetail() {
  const root = document.getElementById('route-decision-detail');
  if (!root) return;
  const bu = currentBu();
  const id = pathSegment();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading decision…</div>';

  const data = await loadProductFile(bu, 'decisions.json');
  const all = data?.decisions || [];
  const d = all.find(x => x.id === id);
  if (!d) {
    root.innerHTML = `<div style="padding:40px;">
      <a href="#decisions" style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;text-decoration:none;">‹ Back to Decisions</a>
      <h2 style="margin-top:14px;font-size:21px;font-weight:800;">Decision not found</h2>
    </div>`;
    return;
  }

  const st = DSTATUS[d.status] || DSTATUS.accepted;

  root.innerHTML = `
    <div style="max-width:760px;margin:0 auto;padding:24px 8px 80px;">
      <a href="#decisions" style="display:inline-flex;align-items:center;gap:7px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;text-decoration:none;margin-bottom:18px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Decisions / ${escapeHtml(d.num)}
      </a>

      <header style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font:700 13px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;background:rgba(20,22,28,.05);padding:4px 10px;border-radius:6px;">${escapeHtml(d.num)}</span>
          <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${st.fg};background:${st.bg};border-radius:5px;padding:3px 9px;">${escapeHtml(d.status.toUpperCase())}</span>
          <span style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(d.date)}</span>
        </div>
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0;color:#16181d;">${escapeHtml(d.title)}</h1>
      </header>

      ${(d.sections || []).map(s => `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;margin-bottom:14px;">
        <h2 style="font-size:14px;font-weight:700;margin:0 0 12px;color:#16181d;letter-spacing:-.005em;">${escapeHtml(s.heading)}</h2>
        ${(s.paras || []).map(p => `<p style="font-size:14px;color:#3a3f4a;line-height:1.65;margin:0 0 10px;">${escapeHtml(p)}</p>`).join('')}
      </section>`).join('')}

      ${(d.links || []).length > 0 ? `
        <section style="background:#fbfbfc;border:1px solid rgba(20,22,28,.08);border-radius:13px;padding:18px 20px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:12px;">Related decisions</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${d.links.map(l => {
              const m = REL_META[l.rel] || REL_META.related;
              const target = all.find(x => x.num === l.num);
              return `<a href="${target ? '#decision-detail/' + escapeHtml(target.id) : '#decisions'}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid rgba(20,22,28,.07);border-radius:10px;text-decoration:none;color:inherit;">
                <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${m.fg};background:${m.bg};border-radius:5px;padding:3px 8px;">${escapeHtml(l.rel.toUpperCase())}</span>
                <span style="font:700 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;">${escapeHtml(l.num)}</span>
                <span style="font-size:13.5px;color:#3a3f4a;">${escapeHtml(l.title)}</span>
              </a>`;
            }).join('')}
          </div>
        </section>` : ''}

      ${d.source ? `<div style="margin-top:18px;text-align:center;font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(d.source)}</div>` : ''}
    </div>
  `;
}
