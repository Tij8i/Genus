// Releases — list of versioned snapshots + per-release detail page.

import { currentBu, loadProductFile, pageHeader, emptyPanel, escapeHtml, pathSegment, STATUS, RSTATUS, TAG } from './_shared.js';

export async function renderReleases() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-releases'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading releases…</div>';

  const data = await loadProductFile(bu, 'releases.json');
  const releases = data?.releases || [];

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:0 8px 80px;">
      ${pageHeader({
        eyebrow: `${bu.toUpperCase()} · PRODUCT`,
        title: 'Releases',
        sub: 'Versioned snapshots — what shipped, what slipped, what we learned.',
      })}

      ${releases.length === 0 ? emptyPanel({
        icon: '◐',
        color: '#0e9f6e',
        title: 'No releases yet',
        copy: 'Mark a version shipped from the roadmap to create the first release.',
        ctaLabel: 'Open roadmap',
        ctaHash: '#roadmap',
      }) : `
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${releases.map(renderReleaseCard).join('')}
        </div>`}
    </div>
  `;
}

function renderReleaseCard(r) {
  const st = RSTATUS[r.status] || RSTATUS.shipped;
  const shipped = (r.shipped || []).slice(0, 4);
  return `<a href="#release-detail/${escapeHtml(r.id)}" style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,18,28,.04);text-decoration:none;color:inherit;display:block;transition:all .12s;" onmouseover="this.style.borderColor='rgba(20,22,28,.18)';this.style.boxShadow='0 4px 14px rgba(16,18,28,.07)';" onmouseout="this.style.borderColor='rgba(20,22,28,.08)';this.style.boxShadow='0 1px 2px rgba(16,18,28,.04)';">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
      <span style="font:700 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;background:rgba(20,22,28,.05);padding:3px 9px;border-radius:6px;">${escapeHtml(r.version_key)}</span>
      <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${st.fg};background:${st.bg};border-radius:5px;padding:2px 7px;">${escapeHtml(st.l.toUpperCase())}</span>
      <span style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-left:auto;">${escapeHtml(r.ship_label || '')}</span>
    </div>
    <h3 style="font-size:17px;font-weight:700;letter-spacing:-.01em;margin:0 0 10px;color:#16181d;">${escapeHtml(r.title)}</h3>
    <p style="font-size:13.5px;color:#6b7280;line-height:1.5;margin:0 0 14px;">${escapeHtml(r.summary || '')}</p>
    ${shipped.length > 0 ? `
      <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:7px;">Shipped</div>
      <ul style="font-size:13px;color:#3a3f4a;line-height:1.6;margin:0;padding-left:20px;">
        ${shipped.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>` : ''}
    <div style="display:flex;align-items:center;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(20,22,28,.06);font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">
      ${r.commit_range ? `<span>${escapeHtml(r.commit_range)}</span>` : ''}
      ${r.item_ids?.length ? `<span>· ${r.item_ids.length} item${r.item_ids.length === 1 ? '' : 's'}</span>` : ''}
      <span style="margin-left:auto;color:#2f6bff;">Read full release →</span>
    </div>
  </a>`;
}

// ============ Release detail ============

export async function renderReleaseDetail() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-release-detail'));
  if (!root) return;
  const bu = currentBu();
  const releaseId = pathSegment();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading release…</div>';

  const [releasesData, roadmapData] = await Promise.all([
    loadProductFile(bu, 'releases.json'),
    loadProductFile(bu, 'roadmap.json'),
  ]);
  const r = (releasesData?.releases || []).find(x => x.id === releaseId);
  if (!r) {
    root.innerHTML = `<div style="padding:40px;">
      <a href="#releases" style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;text-decoration:none;">‹ Back to Releases</a>
      <h2 style="margin-top:14px;font-size:21px;font-weight:800;">Release not found</h2>
    </div>`;
    return;
  }
  const st = RSTATUS[r.status] || RSTATUS.shipped;
  const items = (r.item_ids || []).map(id => (roadmapData?.items || []).find(i => i.id === id)).filter(Boolean);

  root.innerHTML = `
    <div style="max-width:880px;margin:0 auto;padding:24px 8px 80px;">
      <a href="#releases" style="display:inline-flex;align-items:center;gap:7px;font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;text-decoration:none;margin-bottom:18px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Releases / ${escapeHtml(r.version_key)}
      </a>

      <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font:700 13px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#16181d;background:rgba(20,22,28,.05);padding:4px 10px;border-radius:6px;">${escapeHtml(r.version_key)}</span>
            <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${st.fg};background:${st.bg};border-radius:5px;padding:3px 9px;">${escapeHtml(st.l.toUpperCase())}</span>
            <span style="font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(r.ship_label || '')}</span>
          </div>
          <h1 style="font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0;color:#16181d;">${escapeHtml(r.title)}</h1>
          <p style="font-size:15px;color:#5b6270;line-height:1.55;margin:10px 0 0;">${escapeHtml(r.summary || '')}</p>
        </div>
      </header>

      ${section('Goals', r.goals)}
      ${section('What shipped', r.shipped, '#0e9f6e')}
      ${section('What slipped', r.slipped, '#c98a16')}
      ${section('Lessons', r.lessons)}

      ${items.length > 0 ? `
        <section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;margin-top:14px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:14px;">Items in this release</div>
          <div style="display:flex;flex-direction:column;gap:9px;">
            ${items.map(it => {
              const ist = STATUS[it.status] || STATUS.shipped;
              const tags = (it.tags || []).map(t => TAG[t]).filter(Boolean);
              return `<div style="display:flex;align-items:center;gap:11px;padding:9px 11px;background:#fbfbfc;border:1px solid rgba(20,22,28,.07);border-radius:11px;">
                <span style="width:7px;height:7px;border-radius:99px;background:${ist.c};flex:none;"></span>
                <strong style="font-size:13.5px;color:#16181d;flex:1;">${escapeHtml(it.title)}</strong>
                ${tags.map(t => `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${t.c};background:${t.b};border-radius:5px;padding:2px 6px;">${t.label}</span>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </section>` : ''}

      ${(r.metrics || []).length > 0 ? `
        <section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;margin-top:14px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:14px;">Metrics</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
            ${r.metrics.map(m => {
              const after = parseInt(m.after);
              const ship = parseInt(m.at_ship);
              const ok = !isNaN(after) && !isNaN(ship) ? after >= ship : true;
              const dc = ok ? '#0e9f6e' : '#c0392b';
              return `<div style="background:#fbfbfc;border:1px solid rgba(20,22,28,.07);border-radius:11px;padding:13px 14px;">
                <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-bottom:6px;">${escapeHtml(m.label)}</div>
                <div style="display:flex;align-items:baseline;gap:6px;">
                  <span style="font-size:18px;font-weight:800;color:#16181d;">${escapeHtml(m.at_ship)}</span>
                  <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">→</span>
                  <span style="font-size:18px;font-weight:800;color:${dc};">${escapeHtml(m.after)}</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        </section>` : ''}

      ${r.commit_range ? `<div style="margin-top:18px;font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;text-align:center;">${escapeHtml(r.commit_range)}</div>` : ''}
    </div>
  `;
}

function section(title, items, accent) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const c = accent || '#16181d';
  return `<section style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:22px 24px;margin-top:14px;">
    <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:${c};margin-bottom:10px;">${escapeHtml(title)}</div>
    <ul style="font-size:14px;color:#3a3f4a;line-height:1.6;margin:0;padding-left:20px;">
      ${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}
    </ul>
  </section>`;
}
