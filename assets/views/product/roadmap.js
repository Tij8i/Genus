// Roadmap view — kanban-by-version (View A, default) + timeline (View B).
// Click a roadmap-item card → right-side detail drawer.

import { currentBu, loadProductFile, pageHeader, emptyPanel, ownerAvatar, escapeHtml, STATUS, VSTATE, VSTATE_SOFT, TAG } from './_shared.js';

let VIEW = 'A';            // 'A' = kanban, 'B' = timeline
let ACTIVE_VERSION = null; // version key to filter columns
let SHOW_ONLY_OPEN = false; // true = hide shipped + cut; show only planned + in_progress
let OPEN_ITEM_ID = null;

const OPEN_STATUSES = new Set(['planned', 'in_progress']);
const isOpen = (it) => OPEN_STATUSES.has(it.status);

export async function renderRoadmap() {
  const root = (document.getElementById('subtab-host') || document.getElementById('route-roadmap'));
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;color:#9aa1ae;text-align:center;">Loading roadmap…</div>';

  const data = await loadProductFile(bu, 'roadmap.json');
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    root.innerHTML = pageHeader({
      eyebrow: `${bu.toUpperCase()} · PRODUCT`,
      title: 'Roadmap',
      sub: 'Where this product is going, organised by version.',
    }) + emptyPanel({
      icon: '◌',
      color: '#2f6bff',
      title: 'No roadmap yet',
      copy: 'Add versions and the first roadmap items. Releases build on top of versions.',
      ctaLabel: '+ Add a version',
      ctaHash: '#roadmap',
    });
    return;
  }

  // Filter items by status BEFORE handing off to the renderers — keep
  // versions intact so empty columns still show + the version totals
  // reflect "x of N open"
  const visibleData = SHOW_ONLY_OPEN
    ? { ...data, items: (data.items || []).filter(isOpen), _totalItems: (data.items || []).length, _hiddenCount: (data.items || []).filter(it => !isOpen(it)).length }
    : { ...data, _totalItems: (data.items || []).length, _hiddenCount: 0 };

  root.innerHTML = pageHeader({
    eyebrow: `${bu.toUpperCase()} · PRODUCT`,
    title: 'Roadmap',
    sub: 'Where this product is going, organised by version.',
    action: renderViewToggle(),
  }) + renderFilterRow(visibleData) + renderVersionChips(data.versions) + (VIEW === 'A' ? renderKanban(visibleData) : renderTimeline(visibleData));

  // Wiring
  document.querySelectorAll('[data-view-toggle]').forEach(btn => btn.addEventListener('click', () => {
    VIEW = btn.dataset.viewToggle;
    renderRoadmap();
  }));
  document.querySelectorAll('[data-open-only-toggle]').forEach(btn => btn.addEventListener('click', () => {
    SHOW_ONLY_OPEN = !SHOW_ONLY_OPEN;
    renderRoadmap();
  }));
  document.querySelectorAll('[data-version-chip]').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.versionChip;
    ACTIVE_VERSION = ACTIVE_VERSION === k ? null : k;
    renderRoadmap();
  }));
  document.querySelectorAll('[data-item-card]').forEach(card => card.addEventListener('click', () => {
    OPEN_ITEM_ID = card.dataset.itemCard;
    openItemDrawer(data);
  }));

  if (OPEN_ITEM_ID) openItemDrawer(data);
}

function renderViewToggle() {
  const seg = (k, label) => {
    const on = VIEW === k;
    return `<button type="button" data-view-toggle="${k}" style="border:none;background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : '#6b7280'};padding:6px 14px;border-radius:7px;cursor:pointer;font-weight:600;letter-spacing:.03em;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11.5px;">${label}</button>`;
  };
  return `<div style="display:inline-flex;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:10px;padding:3px;">
    ${seg('A', 'Kanban')}
    ${seg('B', 'Timeline')}
  </div>`;
}

function renderFilterRow(data) {
  const total = data._totalItems || 0;
  const open = (data.items || []).length; // when filter on, this is open-only count
  const label = SHOW_ONLY_OPEN
    ? `Open only · ${open} of ${total}`
    : `All items · ${total}`;
  const bg = SHOW_ONLY_OPEN ? 'rgba(47,107,255,.10)' : '#fff';
  const fg = SHOW_ONLY_OPEN ? '#2f6bff' : '#5b6270';
  const border = SHOW_ONLY_OPEN ? '#2f6bff' : 'rgba(20,22,28,.12)';
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    <button type="button" data-open-only-toggle="1" style="display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border:1px solid ${border};border-radius:99px;background:${bg};cursor:pointer;font-family:inherit;font-size:12.5px;color:${fg};font-weight:600;transition:all .12s;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
      ${label}
    </button>
    <span style="font:500 11.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">Open = planned + in progress · Closed = shipped + cut</span>
  </div>`;
}

function renderVersionChips(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return '';
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
    ${versions.map(v => {
      const vs = VSTATE[v.vstate] || VSTATE.planned;
      const sel = ACTIVE_VERSION === v.key;
      const soft = VSTATE_SOFT[vs.c] || 'rgba(154,161,174,.12)';
      const border = sel ? vs.c : 'rgba(20,22,28,.12)';
      const bg = sel ? soft : '#fff';
      const op = (ACTIVE_VERSION && !sel) ? '.45' : '1';
      return `<button type="button" data-version-chip="${escapeHtml(v.key)}" style="display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border:1px solid ${border};border-radius:99px;background:${bg};cursor:pointer;font-family:inherit;font-size:12.5px;opacity:${op};transition:all .12s;">
        <span style="color:${vs.c};font-weight:700;">${vs.glyph}</span>
        <span style="font-weight:700;color:#16181d;">${escapeHtml(v.key)}</span>
        <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${escapeHtml(vs.l)}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function renderKanban(data) {
  const versions = data.versions || [];
  const items = data.items || [];
  const owners = data.owners || {};
  const visible = ACTIVE_VERSION ? versions.filter(v => v.key === ACTIVE_VERSION) : versions;
  return `<div style="display:grid;grid-template-columns:repeat(${visible.length}, minmax(260px, 1fr));gap:13px;overflow-x:auto;">
    ${visible.map(v => {
      const its = items.filter(i => i.version === v.key);
      const vs = VSTATE[v.vstate] || VSTATE.planned;
      const soft = VSTATE_SOFT[vs.c] || 'rgba(154,161,174,.10)';
      const shipLabel = v.vstate === 'shipped' ? `shipped ${v.ship}` : `target ${v.ship}`;
      return `<div style="display:flex;flex-direction:column;gap:9px;">
        <div style="padding:12px 14px;background:${soft};border:1px solid ${vs.c}33;border-radius:13px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:${vs.c};font-weight:700;font-size:14px;">${vs.glyph}</span>
            <strong style="font-size:15px;color:#16181d;">${escapeHtml(v.key)}</strong>
            <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;margin-left:auto;">${escapeHtml(shipLabel)}</span>
          </div>
          <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-top:5px;">${v.pct || 0}% · ${its.length} item${its.length === 1 ? '' : 's'}</div>
          <div style="margin-top:7px;height:5px;border-radius:99px;background:rgba(20,22,28,.08);overflow:hidden;"><div style="height:100%;width:${v.pct || 0}%;background:${vs.c};"></div></div>
        </div>
        ${its.length === 0
          ? `<div style="border:1.5px dashed rgba(20,22,28,.12);border-radius:12px;padding:18px 14px;color:#9aa1ae;font-size:12px;text-align:center;">No items in this version yet</div>`
          : its.map(it => renderItemCard(it, owners)).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function renderItemCard(it, owners) {
  const st = STATUS[it.status] || STATUS.planned;
  const anim = it.status === 'in_progress' ? 'pulseDot 1.6s infinite' : 'none';
  const tags = (it.tags || []).map(t => TAG[t]).filter(Boolean);
  const owner = owners[it.owner];
  return `<button type="button" data-item-card="${escapeHtml(it.id)}" style="display:flex;flex-direction:column;gap:8px;text-align:left;padding:13px 15px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:12px;cursor:pointer;box-shadow:0 1px 2px rgba(16,18,28,.04);font-family:inherit;transition:all .12s;" onmouseover="this.style.borderColor='rgba(20,22,28,.18)';this.style.boxShadow='0 4px 14px rgba(16,18,28,.07)';" onmouseout="this.style.borderColor='rgba(20,22,28,.08)';this.style.boxShadow='0 1px 2px rgba(16,18,28,.04)';">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="width:7px;height:7px;border-radius:99px;background:${st.c};animation:${anim};flex:none;"></span>
      <strong style="font-size:13.5px;color:#16181d;line-height:1.3;">${escapeHtml(it.title)}</strong>
    </div>
    <p style="font-size:12.5px;color:#6b7280;line-height:1.45;margin:0;">${escapeHtml(it.summary || '')}</p>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      ${tags.map(t => `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${t.c};background:${t.b};border-radius:5px;padding:2px 6px;">${t.label}</span>`).join('')}
      <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">
        ${ownerAvatar(owner, 22)}
        ${it.prs ? `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${it.prs}p</span>` : ''}
        ${it.decs ? `<span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${it.decs}d</span>` : ''}
      </span>
    </div>
  </button>`;
}

function renderTimeline(data) {
  // 15-month span (Jan 2026 → Mar 2027) — same as the design's reference
  const SPANS = { 'v0.6':[0,3],'v0.7':[2,5],'v0.8':[4,8],'v0.9':[7,10],'v1.0':[9,15] };
  const months = 15;
  const versions = data.versions || [];
  const items = data.items || [];
  const visible = ACTIVE_VERSION ? versions.filter(v => v.key === ACTIVE_VERSION) : versions;
  const axis = ['Jan ′26', 'Apr', 'Jul', 'Oct', 'Jan ′27'];
  return `<div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:15px;padding:24px 26px;">
    <div style="display:flex;justify-content:space-between;font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-bottom:12px;">
      ${axis.map(a => `<span>${a}</span>`).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${visible.map(v => {
        const vs = VSTATE[v.vstate] || VSTATE.planned;
        const sp = SPANS[v.key] || [0, months];
        const n = items.filter(i => i.version === v.key).length;
        const soft = VSTATE_SOFT[vs.c] || 'rgba(154,161,174,.14)';
        const left = (sp[0] / months * 100).toFixed(1);
        const width = ((sp[1] - sp[0]) / months * 100).toFixed(1);
        const label = v.vstate === 'shipped' ? `shipped ${v.ship}` : `target ${v.ship}`;
        return `<div style="position:relative;height:38px;">
          <div style="position:absolute;left:${left}%;width:${width}%;top:0;bottom:0;background:${soft};border:1px solid ${vs.c}55;border-radius:10px;display:flex;align-items:center;padding:0 14px;gap:9px;">
            <span style="color:${vs.c};font-weight:800;">${vs.glyph}</span>
            <strong style="font-size:13.5px;color:#16181d;">${escapeHtml(v.key)}</strong>
            <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#5b6270;">${escapeHtml(label)}</span>
            ${n ? `<span style="margin-left:auto;font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">${n} items</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function openItemDrawer(data) {
  const host = document.getElementById('overlay-host');
  if (!host) return;
  const it = (data.items || []).find(i => i.id === OPEN_ITEM_ID);
  if (!it) { host.innerHTML = ''; OPEN_ITEM_ID = null; return; }
  const owners = data.owners || {};
  const owner = owners[it.owner];
  const st = STATUS[it.status] || STATUS.planned;
  const anim = it.status === 'in_progress' ? 'pulseDot 1.6s infinite' : 'none';
  const tags = (it.tags || []).map(t => TAG[t]).filter(Boolean);

  host.innerHTML = `
    <div id="rm-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:50;"></div>
    <aside id="rm-panel" style="position:fixed;top:0;right:0;height:100%;width:480px;max-width:92vw;background:#fbfbfc;border-left:1px solid rgba(20,22,28,.1);box-shadow:-20px 0 50px rgba(16,18,28,.16);z-index:51;display:flex;flex-direction:column;">
      <div style="padding:20px 22px 16px;border-bottom:1px solid rgba(20,22,28,.06);">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:10px;">
          <span style="display:inline-flex;align-items:center;gap:6px;font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${st.c};background:${st.c}1a;border-radius:99px;padding:3px 10px;"><span style="width:6px;height:6px;border-radius:99px;background:${st.c};animation:${anim};"></span> ${st.l}</span>
          <button type="button" id="rm-close" style="background:none;border:none;font-size:24px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
        </div>
        <h2 style="font-size:21px;font-weight:800;margin:0;color:#16181d;">${escapeHtml(it.title)}</h2>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;font:500 12px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">
          ${escapeHtml(it.version)}
          ${tags.map(t => `<span style="font:600 9.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.08em;color:${t.c};background:${t.b};border-radius:5px;padding:2px 6px;">${t.label}</span>`).join('')}
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 22px 20px;">
        <p style="font-size:14px;color:#3a3f4a;line-height:1.6;margin:0 0 18px;">${escapeHtml(it.long || it.summary || '')}</p>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
          ${ownerAvatar(owner, 32)}
          <div style="display:flex;flex-direction:column;line-height:1.3;">
            <strong style="font-size:13px;color:#16181d;">${escapeHtml(owner?.name || it.owner || '—')}</strong>
            <span style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;">owner</span>
          </div>
        </div>
        ${(it.pr_list || []).length > 0 ? `
          <div style="margin-bottom:18px;">
            <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:8px;">Pull requests</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${it.pr_list.map(pr => `<div style="display:flex;align-items:center;gap:9px;padding:8px 11px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:9px;font-size:12.5px;">
                <span style="font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#2f6bff;">${escapeHtml(pr.id)}</span>
                <span style="color:#3a3f4a;">${escapeHtml(pr.title)}</span>
              </div>`).join('')}
            </div>
          </div>` : ''}
        ${(it.decision_ids || []).length > 0 ? `
          <div style="margin-bottom:18px;">
            <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#aab0bb;margin-bottom:8px;">Decisions</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${it.decision_ids.map(d => `<a href="#decision-detail/${escapeHtml(d)}" style="font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#2f6bff;background:rgba(47,107,255,.08);border-radius:6px;padding:4px 9px;text-decoration:none;">${escapeHtml(d.toUpperCase())}</a>`).join('')}
            </div>
          </div>` : ''}
      </div>
    </aside>
  `;
  document.getElementById('rm-scrim')?.addEventListener('click', closeDrawer);
  document.getElementById('rm-close')?.addEventListener('click', closeDrawer);
}

function closeDrawer() {
  const host = document.getElementById('overlay-host');
  if (host) host.innerHTML = '';
  OPEN_ITEM_ID = null;
}
