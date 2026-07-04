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
    action: renderHeaderActions(),
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

  document.getElementById('rm-add-note-btn')?.addEventListener('click', () => openNoteDialog(data, bu));

  if (OPEN_ITEM_ID) openItemDrawer(data);
}

function renderHeaderActions() {
  return `<div style="display:inline-flex;gap:10px;align-items:center;">
    <button type="button" id="rm-add-note-btn" style="display:inline-flex;align-items:center;gap:7px;padding:7px 14px;background:var(--accent);color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      Add via note
    </button>
    ${renderViewToggle()}
  </div>`;
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

// ============ i39 — Note-capture flow ============
//
// Operator types a rough note; we split it into draft cards (client-side —
// deterministic decomposition, no meeting round-trip). Operator picks which
// to keep, edits inline, saves. POSTs to /api/add-roadmap-items.
//
// Decomposition rules (in priority order):
//   1. Lines starting with '- ', '* ', or 'N. ' → each is one card
//   2. Otherwise: split on blank lines → each chunk is one card
//   3. Fallback: whole note = one card
// First line of a chunk = title; the rest = summary + long.

let DRAFTS = [];

function decomposeNote(note) {
  const text = (note || '').trim();
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim());

  const bulletRe = /^([-*•]|\d+[\.\)])\s+(.*)$/;
  const bulletChunks = [];
  let currentBullet = null;
  for (const line of lines) {
    const m = line.match(bulletRe);
    if (m) {
      if (currentBullet) bulletChunks.push(currentBullet);
      currentBullet = m[2];
    } else if (currentBullet !== null) {
      if (line === '') { bulletChunks.push(currentBullet); currentBullet = null; }
      else currentBullet += ' ' + line;
    }
  }
  if (currentBullet) bulletChunks.push(currentBullet);
  if (bulletChunks.length >= 2) {
    return bulletChunks.map(chunkToCard);
  }

  const paraChunks = text.split(/\n{2,}/).map(c => c.trim()).filter(Boolean);
  if (paraChunks.length >= 2) return paraChunks.map(chunkToCard);

  return [chunkToCard(text)];
}

function chunkToCard(chunk) {
  const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
  const title = (lines[0] || '').slice(0, 100);
  const rest = lines.slice(1).join(' ').trim();
  return {
    title,
    summary: rest.slice(0, 200) || title,
    long: rest || title,
    version: null,
    tags: [],
  };
}

function openNoteDialog(data, bu) {
  const host = document.getElementById('overlay-host');
  if (!host) return;
  const versions = (data.versions || []).map(v => v.key);
  const defaultVersion = versions.find(k => (data.versions.find(v => v.key === k)?.vstate) === 'in_progress')
    || versions.find(k => (data.versions.find(v => v.key === k)?.vstate) === 'planned')
    || versions[versions.length - 1]
    || 'v0.9';
  DRAFTS = [];

  host.innerHTML = `
    <div id="rm-note-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:60;"></div>
    <div id="rm-note-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(720px,94vw);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 30px 90px rgba(16,18,28,.28);z-index:61;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:20px 24px 14px;border-bottom:1px solid rgba(20,22,28,.08);display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--accent);text-transform:uppercase;">Add roadmap items via note</div>
          <div style="font-size:13.5px;color:#3a3f4a;margin-top:4px;">Type your thought — one idea per bullet, or paragraphs separated by blank lines.</div>
        </div>
        <button type="button" id="rm-note-close" style="background:none;border:none;font-size:26px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
      </div>

      <div id="rm-note-step-input" style="padding:20px 24px;overflow-y:auto;flex:1;">
        <textarea id="rm-note-textarea" placeholder="e.g.
- MCP server so external instances get native tool access
- Redesign the module submenus — the three-tab pattern isn't right
- Onboarding wizard for empty installs" style="width:100%;min-height:220px;padding:14px 16px;border:1px solid rgba(20,22,28,.12);border-radius:11px;font-family:inherit;font-size:13.5px;line-height:1.55;resize:vertical;color:#16181d;"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
          <button type="button" class="rm-note-cancel onboard-cancel" style="padding:8px 16px;">Cancel</button>
          <button type="button" id="rm-note-decompose-btn" class="onboard-begin" style="padding:8px 18px;">Decompose →</button>
        </div>
      </div>

      <div id="rm-note-step-review" style="display:none;padding:20px 24px;overflow-y:auto;flex:1;"></div>

      <div id="rm-note-step-footer" style="display:none;padding:14px 24px;border-top:1px solid rgba(20,22,28,.08);display:flex;justify-content:space-between;align-items:center;">
        <button type="button" id="rm-note-back-btn" class="onboard-cancel" style="padding:8px 16px;">← Back</button>
        <div style="display:flex;gap:10px;">
          <button type="button" class="rm-note-cancel onboard-cancel" style="padding:8px 16px;">Cancel</button>
          <button type="button" id="rm-note-save-btn" class="onboard-begin" style="padding:8px 18px;">Add selected to roadmap ↗</button>
        </div>
      </div>
    </div>
  `;

  const close = () => { host.innerHTML = ''; };
  document.getElementById('rm-note-scrim')?.addEventListener('click', close);
  document.getElementById('rm-note-close')?.addEventListener('click', close);
  document.querySelectorAll('.rm-note-cancel').forEach(b => b.addEventListener('click', close));

  document.getElementById('rm-note-decompose-btn').addEventListener('click', () => {
    const text = document.getElementById('rm-note-textarea').value;
    DRAFTS = decomposeNote(text).map(d => ({ ...d, keep: true, version: defaultVersion }));
    if (DRAFTS.length === 0) { alert('Nothing to decompose — type at least one line.'); return; }
    document.getElementById('rm-note-step-input').style.display = 'none';
    const rev = document.getElementById('rm-note-step-review');
    rev.style.display = 'block';
    rev.innerHTML = renderDrafts(versions);
    document.getElementById('rm-note-step-footer').style.display = 'flex';
    wireDraftInputs();
  });

  document.getElementById('rm-note-back-btn').addEventListener('click', () => {
    document.getElementById('rm-note-step-input').style.display = 'block';
    document.getElementById('rm-note-step-review').style.display = 'none';
    document.getElementById('rm-note-step-footer').style.display = 'none';
  });

  document.getElementById('rm-note-save-btn').addEventListener('click', async () => {
    const kept = DRAFTS.filter(d => d.keep);
    if (kept.length === 0) { alert('Toggle at least one card to keep.'); return; }
    const btn = document.getElementById('rm-note-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = { bu, items: kept.map(d => ({ title: d.title, summary: d.summary, long: d.long, version: d.version, tags: d.tags })) };
      const res = await fetch('/api/add-roadmap-items', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.message || `HTTP ${res.status}`);
      close();
      await renderRoadmap();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Add selected to roadmap ↗';
      alert(`Could not add items: ${e.message}`);
    }
  });
}

function renderDrafts(versions) {
  return `
    <div style="font-size:12.5px;color:#5b6270;margin-bottom:12px;">Split into <strong>${DRAFTS.length}</strong> draft card${DRAFTS.length === 1 ? '' : 's'}. Untick to drop, edit inline, then save.</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
    ${DRAFTS.map((d, i) => `
      <div class="rm-draft" data-idx="${i}" style="border:1px solid rgba(20,22,28,.1);border-radius:12px;padding:12px 14px;background:${d.keep ? '#fff' : '#f5f6f8'};transition:opacity .12s;opacity:${d.keep ? '1' : '.5'};">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <input type="checkbox" class="rm-draft-keep" data-idx="${i}" ${d.keep ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
          <input type="text" class="rm-draft-title" data-idx="${i}" value="${escapeHtml(d.title)}" style="flex:1;font-size:13.5px;font-weight:700;color:#16181d;border:1px solid transparent;background:transparent;padding:4px 6px;border-radius:6px;" onfocus="this.style.background='#fff';this.style.borderColor='rgba(20,22,28,.12)';" onblur="this.style.background='transparent';this.style.borderColor='transparent';">
          <select class="rm-draft-version" data-idx="${i}" style="font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:11.5px;padding:4px 8px;border-radius:6px;border:1px solid rgba(20,22,28,.15);background:#fff;cursor:pointer;">
            ${versions.map(v => `<option value="${escapeHtml(v)}" ${d.version === v ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}
          </select>
        </div>
        <textarea class="rm-draft-summary" data-idx="${i}" rows="2" placeholder="Summary (shown on the card)" style="width:100%;font-size:12.5px;color:#3a3f4a;line-height:1.5;padding:6px 8px;border:1px solid rgba(20,22,28,.1);border-radius:7px;font-family:inherit;resize:vertical;background:#fff;">${escapeHtml(d.summary)}</textarea>
      </div>
    `).join('')}
    </div>`;
}

function wireDraftInputs() {
  document.querySelectorAll('.rm-draft-keep').forEach(cb => cb.addEventListener('change', e => {
    const i = parseInt(e.target.dataset.idx, 10);
    DRAFTS[i].keep = e.target.checked;
    const card = e.target.closest('.rm-draft');
    if (card) { card.style.opacity = DRAFTS[i].keep ? '1' : '.5'; card.style.background = DRAFTS[i].keep ? '#fff' : '#f5f6f8'; }
  }));
  document.querySelectorAll('.rm-draft-title').forEach(inp => inp.addEventListener('input', e => {
    DRAFTS[parseInt(e.target.dataset.idx, 10)].title = e.target.value;
  }));
  document.querySelectorAll('.rm-draft-summary').forEach(ta => ta.addEventListener('input', e => {
    DRAFTS[parseInt(e.target.dataset.idx, 10)].summary = e.target.value;
  }));
  document.querySelectorAll('.rm-draft-version').forEach(sel => sel.addEventListener('change', e => {
    DRAFTS[parseInt(e.target.dataset.idx, 10)].version = e.target.value;
  }));
}
