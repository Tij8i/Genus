// Layers view — Business Coverage Map.
//
// Per design-handoff: /Users/AlessioTixi/Desktop/design_handoff_business_layers/README.md
// + the brief at /Users/AlessioTixi/Desktop/genus-business-coverage-view-brief.md.
//
// Five layers per area: business areas (1) · modules (2) · agents (3) · humans (4)
// + connected tools (5, lens not coverage). Three card treatments:
//   A. Layer stack (default, most explicit)
//   B. Coverage bar (3-cell pill grid)
//   C. Ledger (dense rows with dots)
//
// Initiative #4 Session #19. v1 = no real Genus Agent chat — the CTA opens
// the existing meeting infrastructure (or a placeholder until that's wired).

import { escapeHtml } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';

const TOOL_TOKENS = {
  notion:        { bg: '#16181d', fg: '#fff',    initial: 'N', label: 'Notion' },
  miro:          { bg: '#ffd02f', fg: '#16181d', initial: 'M', label: 'Miro' },
  'google-drive':{ bg: '#1a73e8', fg: '#fff',    initial: 'D', label: 'Google Drive' },
  slack:         { bg: '#611f69', fg: '#fff',    initial: '#', label: 'Slack' },
  figma:         { bg: '#f24e1e', fg: '#fff',    initial: 'F', label: 'Figma' },
  hubspot:       { bg: '#ff7a59', fg: '#fff',    initial: 'H', label: 'HubSpot' },
  stripe:        { bg: '#635bff', fg: '#fff',    initial: 'S', label: 'Stripe' },
  linear:        { bg: '#5e6ad2', fg: '#fff',    initial: 'L', label: 'Linear' },
  intercom:      { bg: '#1f8ded', fg: '#fff',    initial: 'I', label: 'Intercom' },
};

const STATE_TOKENS = {
  fully:     { fg: '#0e9f6e', bg: '#e9f7f0', border: '#c9ebda', dot: '#0e9f6e', label: 'Covered', icon: 'check' },
  partial:   { fg: '#a9790a', bg: '#fbf3da', border: '#f0e0ab', dot: '#e8ad12', label: 'Partial',  icon: 'alert' },
  uncovered: { fg: '#9c7a4f', bg: '#f8f3ec', border: '#e7dccb', dot: '#c69a5e', label: 'Uncovered', icon: 'circle-dashed' },
  overlap:   { fg: '#7a4dff', bg: '#f1edfe', border: '#ddd3fb', dot: '#7a4dff', label: 'Overlap',  icon: 'zap' },
};

const LAYER_COLORS = {
  module: '#2f6bff',
  agent:  '#7a4dff',
  human:  '#0e9f6e',
  tools:  '#475569',
};

// View state — persists across re-renders within the session.
let VIEW_STATE = {
  cardStyle: 'A',       // 'A' | 'B' | 'C'
  openAreaId: null,
  openToolKey: null,    // composite areaId:toolKey
};

export async function renderLayers(ctx) {
  const root = document.getElementById('route-layers');
  if (!root) return;
  const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
  root.innerHTML = renderHeader(currentBu) + '<div class="layers-skeleton" style="padding:40px 0;color:var(--text-faint);text-align:center;">Loading coverage…</div>';

  let coverage;
  try {
    const res = await fetch(`/api/coverage?bu=${encodeURIComponent(currentBu)}`);
    coverage = await res.json();
    if (!coverage.ok) throw new Error(coverage.message || `HTTP ${res.status}`);
  } catch (e) {
    root.innerHTML = renderHeader(currentBu) + `<div class="card" style="margin-top:20px;"><div class="card-body">Could not load coverage: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }

  if (coverage.empty || !coverage.areas || coverage.areas.length === 0) {
    root.innerHTML = renderHeader(currentBu) + renderEmpty(currentBu);
    wireEmptyState(currentBu);
    return;
  }

  root.innerHTML = renderHeader(currentBu) + renderPopulated(coverage, currentBu);
  wirePopulated(coverage, currentBu, ctx);
}

// ============ Top-level renderers ============

function renderHeader(bu) {
  return `
    <header class="page-header" style="display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:18px;">
      <div>
        <h1 class="page-title" style="font-size:29px;font-weight:800;letter-spacing:-0.025em;margin:0;">Business layers</h1>
        <p class="page-sub" style="max-width:560px;color:#6b7280;margin:6px 0 0;font-size:14px;line-height:1.55;">
          Top-down coverage of the business — what's covered by modules, agents, and humans; what isn't; where there's overlap.
        </p>
      </div>
      <button type="button" id="layers-talk-btn" class="primary-btn-pill" title="Open a meeting with the Genus Agent on business areas">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Talk to Genus Agent about my areas
      </button>
    </header>
  `;
}

function renderPopulated(coverage, bu) {
  const s = coverage.summary;
  const dots = `
    <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:${STATE_TOKENS.fully.dot};"></span> ${s.fully} fully</span>
    ${s.overlap ? `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:${STATE_TOKENS.overlap.dot};"></span> ${s.overlap} overlap</span>` : ''}
    <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:${STATE_TOKENS.partial.dot};"></span> ${s.partial} partial</span>
    <span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:${STATE_TOKENS.uncovered.dot};"></span> ${s.uncovered} uncovered</span>
  `;

  const critical = s.critical_uncovered.length > 0 ? `
    <div class="layers-ribbon" style="background:#fdebe9;border:1px solid #f6cfca;color:#c12525;padding:11px 14px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;" data-ribbon="critical" data-first-id="${escapeHtml(s.critical_uncovered[0])}">
      <span>⚠ ${s.critical_uncovered.length} critical area${s.critical_uncovered.length === 1 ? ' is' : 's are'} uncovered: ${s.critical_uncovered.map(escapeHtml).join(', ')}</span>
      <span style="font-size:12px;color:#7a1212;text-decoration:underline;cursor:pointer;">Review →</span>
    </div>` : '';

  const overlap = s.overlap > 0 ? `
    <div class="layers-ribbon" style="background:${STATE_TOKENS.overlap.bg};border:1px solid ${STATE_TOKENS.overlap.border};color:${STATE_TOKENS.overlap.fg};padding:11px 14px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;" data-ribbon="overlap" data-first-id="${escapeHtml(s.overlapping_area_ids[0] || '')}">
      <span>⚡ ${s.overlap} area${s.overlap === 1 ? '' : 's'} have overlap — multiple agents claim them without a clear lead</span>
      <span style="font-size:12px;text-decoration:underline;cursor:pointer;">Resolve →</span>
    </div>` : '';

  return `
    ${critical}
    ${overlap}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:14px;">
      <div style="font-size:13px;color:#6b7280;display:flex;gap:18px;flex-wrap:wrap;">
        <strong style="color:#1d2026;font-weight:700;">${s.total} area${s.total === 1 ? '' : 's'}</strong>
        ${dots}
      </div>
      <div class="layers-segctrl" style="display:inline-flex;background:#fff;border:1px solid var(--border);border-radius:10px;padding:3px;font-size:11.5px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;">
        ${['A','B','C'].map(k => `<button type="button" class="seg-btn ${VIEW_STATE.cardStyle === k ? 'active' : ''}" data-style="${k}" style="border:none;background:${VIEW_STATE.cardStyle === k ? 'var(--accent)' : 'transparent'};color:${VIEW_STATE.cardStyle === k ? '#fff' : '#6b7280'};padding:6px 14px;border-radius:7px;cursor:pointer;font-weight:600;letter-spacing:.03em;">${k === 'A' ? 'Layer stack' : k === 'B' ? 'Coverage bar' : 'Ledger'}</button>`).join('')}
      </div>
    </div>

    <div id="layers-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(290px, 1fr));gap:16px;">
      ${coverage.areas.map(a => renderAreaCard(a, VIEW_STATE.cardStyle)).join('')}
    </div>

    <div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap;">
      <button type="button" class="onboard-cancel" id="add-area-btn">+ Add a business area</button>
      <button type="button" class="onboard-cancel" id="add-mason-btn">+ Add a Mason</button>
      <button type="button" class="onboard-cancel" id="assign-human-btn">+ Assign a human</button>
    </div>
  `;
}

// ============ Card variants ============

function renderAreaCard(area, style) {
  const st = STATE_TOKENS[area.state];
  const isUncovered = area.state === 'uncovered';
  const cardBg = isUncovered ? '#f8f3ec' : '#fff';
  const cardBorder = isUncovered ? '1.5px dashed #d8c4a6' : '1px solid rgba(20,22,28,.07)';
  const shadow = isUncovered ? 'none' : '0 1px 2px rgba(16,18,28,.04), 0 6px 16px rgba(16,18,28,.03)';
  const badgeSvg = badgeIcon(st.icon);

  let body;
  if (style === 'A') body = renderCardA(area);
  else if (style === 'B') body = renderCardB(area);
  else body = renderCardC(area);

  return `
    <div class="layer-card" data-area-id="${escapeHtml(area.id)}" style="background:${cardBg};border:${cardBorder};border-radius:15px;padding:15px 16px;box-shadow:${shadow};cursor:pointer;transition:transform .13s, box-shadow .13s;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:12px;">
        <strong style="font-size:15.5px;font-weight:700;letter-spacing:-0.01em;flex:1;min-width:0;color:#1d2026;">${escapeHtml(area.display_name)}</strong>
        <span style="display:inline-flex;align-items:center;gap:5px;border-radius:99px;padding:3px 10px;font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.01em;color:${st.fg};background:${st.bg};border:1px solid ${st.border};flex:none;">
          ${badgeSvg} ${st.label}
        </span>
      </div>
      ${body}
      ${renderCardToolsRow(area)}
    </div>
  `;
}

function renderCardA(area) {
  const rows = [
    { label: 'MODULE', glyph: '▣', value: area.modules.length ? area.modules.map(m => `${m.icon || ''} ${escapeHtml(m.display_name)}`).join(', ') : null, color: LAYER_COLORS.module },
    { label: 'AGENT',  glyph: '◉', value: area.agents.length  ? area.agents.map(a => escapeHtml(agentShortName(a))).join(', ') : null, color: LAYER_COLORS.agent },
    { label: 'HUMAN',  glyph: '◉', value: area.humans.length  ? area.humans.map(h => escapeHtml(h.display_name)).join(', ') : null, color: LAYER_COLORS.human },
  ];
  return rows.map((r, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 0;${i > 0 ? 'border-top:1px solid rgba(20,22,28,.06);' : ''}">
      <span style="font-size:14px;color:${r.value ? r.color : '#d6dae2'};width:18px;">${r.glyph}</span>
      <span style="font-size:9px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;width:50px;letter-spacing:.05em;">${r.label}</span>
      <span style="font-size:12.5px;font-weight:${r.value ? 600 : 400};color:${r.value ? '#1d2026' : '#c2c7d0'};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.value || '(none)'}</span>
    </div>
  `).join('');
}

function renderCardB(area) {
  const cells = [
    { lab: 'MODULE', present: area.modules.length > 0, value: area.modules[0]?.display_name || '—', color: LAYER_COLORS.module },
    { lab: 'AGENT',  present: area.agents.length > 0,  value: area.agents[0] ? agentShortName(area.agents[0]) : '—', color: LAYER_COLORS.agent },
    { lab: 'HUMAN',  present: area.humans.length > 0,  value: area.humans[0]?.display_name || '—', color: LAYER_COLORS.human },
  ];
  return `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;">
      ${cells.map(c => {
        const pill = c.present
          ? `background:${c.color};color:#fff;`
          : `background:repeating-linear-gradient(45deg,#f0f1f4,#f0f1f4 4px,#e7e9ee 4px,#e7e9ee 8px);color:#b9bec9;`;
        return `
          <div style="text-align:center;">
            <div style="border-radius:7px;padding:7px 0;font:700 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;text-transform:uppercase;${pill}">${c.lab}</div>
            <div style="font-size:11.5px;color:${c.present ? '#1d2026' : '#b3b9c4'};margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.value)}</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function renderCardC(area) {
  const rows = [
    { lab: 'MOD', present: area.modules.length > 0, value: area.modules[0]?.display_name || '—', color: LAYER_COLORS.module },
    { lab: 'AGT', present: area.agents.length > 0,  value: area.agents[0] ? agentShortName(area.agents[0]) : '—', color: LAYER_COLORS.agent },
    { lab: 'HUM', present: area.humans.length > 0,  value: area.humans[0]?.display_name || '—', color: LAYER_COLORS.human },
  ];
  return rows.map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
      <span style="width:9px;height:9px;border-radius:50%;${r.present ? `background:${r.color};` : 'background:#fff;box-shadow:inset 0 0 0 1.6px #d2d6de;'}"></span>
      <span style="font-size:10px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;width:30px;letter-spacing:.05em;">${r.lab}</span>
      <span style="font-size:12.5px;font-weight:${r.present ? 600 : 400};color:${r.present ? '#1d2026' : '#b3b9c4'};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;">${escapeHtml(r.value)}</span>
    </div>
  `).join('');
}

function renderCardToolsRow(area) {
  const tools = area.tools || [];
  if (tools.length === 0) {
    return `<div style="display:flex;align-items:center;gap:10px;padding-top:10px;margin-top:10px;border-top:1px solid rgba(20,22,28,.06);"><span style="font-size:9px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;letter-spacing:.05em;width:50px;">TOOLS</span><span style="font-size:11px;color:#c2c7d0;">(none)</span></div>`;
  }
  return `
    <div style="display:flex;align-items:center;gap:8px;padding-top:10px;margin-top:10px;border-top:1px solid rgba(20,22,28,.06);">
      <span style="font-size:9px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;letter-spacing:.05em;width:50px;">TOOLS</span>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${tools.map(t => renderToolChip(t.tool, 21)).join('')}
      </div>
    </div>
  `;
}

function renderToolChip(toolId, size = 21) {
  const tok = TOOL_TOKENS[toolId] || { bg: '#475569', fg: '#fff', initial: '?', label: toolId };
  return `<span title="${escapeHtml(tok.label)}" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:6px;background:${tok.bg};color:${tok.fg};font:700 ${Math.round(size * 0.5)}px 'JetBrains Mono',ui-monospace,Menlo,monospace;">${tok.initial}</span>`;
}

// ============ Empty state ============

function renderEmpty(bu) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:62vh;text-align:center;padding:40px 20px;">
      <div style="width:78px;height:78px;border-radius:18px;background:rgba(47,107,255,0.10);color:#2f6bff;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <h2 style="font-size:30px;font-weight:800;margin:0 0 10px;color:#16181d;">Let's map out your business</h2>
      <p style="font-size:14.5px;color:#6b7280;max-width:430px;line-height:1.55;margin:0 0 24px;">No business areas are defined for ${escapeHtml(bu)} yet. The Genus Agent will propose an initial set based on what kind of venture this is; you confirm and refine through conversation.</p>
      <button type="button" id="empty-talk-btn" class="primary-btn-pill" style="font-size:14px;">
        Talk to Genus Agent
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
      </button>
      <div style="font-size:11px;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;color:#aab0bb;margin-top:18px;">Seeds bus/${escapeHtml(bu)}/business_areas.json</div>
    </div>
  `;
}

function wireEmptyState(bu) {
  document.getElementById('empty-talk-btn')?.addEventListener('click', () => startGenusAgentMeeting(bu));
  document.getElementById('layers-talk-btn')?.addEventListener('click', () => startGenusAgentMeeting(bu));
}

// ============ Wiring (populated state) ============

function wirePopulated(coverage, bu, ctx) {
  // Header CTA
  document.getElementById('layers-talk-btn')?.addEventListener('click', () => startGenusAgentMeeting(bu));

  // Segmented control
  document.querySelectorAll('.layers-segctrl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      VIEW_STATE.cardStyle = btn.dataset.style;
      renderLayers(ctx);
    });
  });

  // Card click → open detail panel
  document.querySelectorAll('.layer-card').forEach(card => {
    card.addEventListener('click', () => openDetail(coverage, card.dataset.areaId, bu, ctx));
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 10px 26px rgba(16,18,28,.10)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      const area = coverage.areas.find(a => a.id === card.dataset.areaId);
      card.style.boxShadow = area && area.state === 'uncovered' ? 'none' : '0 1px 2px rgba(16,18,28,.04), 0 6px 16px rgba(16,18,28,.03)';
    });
  });

  // Ribbons
  document.querySelectorAll('.layers-ribbon').forEach(rib => {
    rib.addEventListener('click', () => {
      const firstId = rib.dataset.firstId;
      if (firstId) openDetail(coverage, firstId, bu, ctx);
    });
  });

  // Bottom actions
  document.getElementById('add-area-btn')?.addEventListener('click', () => startGenusAgentMeeting(bu, 'add-area'));
  document.getElementById('add-mason-btn')?.addEventListener('click', () => alert('Add a Mason — ships in a follow-up Initiative once the Mason install flow is built. For now, register Masons by hand in agent_bindings.json.'));
  document.getElementById('assign-human-btn')?.addEventListener('click', () => { location.hash = '#people'; });
}

// ============ Detail panel ============

function openDetail(coverage, areaId, bu, ctx) {
  const area = coverage.areas.find(a => a.id === areaId);
  if (!area) return;
  const st = STATE_TOKENS[area.state];

  const host = document.getElementById('overlay-host');
  if (!host) return;
  host.innerHTML = `
    <div id="layer-detail-scrim" style="position:fixed;inset:0;background:rgba(16,18,28,.34);z-index:50;"></div>
    <aside id="layer-detail-panel" style="position:fixed;top:0;right:0;height:100%;width:476px;max-width:92vw;background:#fbfbfc;border-left:1px solid rgba(20,22,28,.1);box-shadow:-20px 0 50px rgba(16,18,28,.16);z-index:51;display:flex;flex-direction:column;animation:panelIn .24s cubic-bezier(.2,.7,.2,1);">
      <div style="padding:20px 22px 16px;border-bottom:1px solid rgba(20,22,28,.06);">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:10px;">
          <span style="display:inline-flex;align-items:center;gap:5px;border-radius:99px;padding:3px 10px;font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${st.fg};background:${st.bg};border:1px solid ${st.border};">${badgeIcon(st.icon)} ${st.label}</span>
          <button type="button" id="layer-detail-close" aria-label="Close" style="background:none;border:none;font-size:24px;color:#9aa1ae;cursor:pointer;line-height:1;">×</button>
        </div>
        <h2 style="font-size:24px;font-weight:800;margin:0 0 6px;color:#16181d;">${escapeHtml(area.display_name)}</h2>
        <p style="font-size:13.5px;color:#6b7280;margin:0;">${escapeHtml(area.description)}</p>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 22px 0;">
        ${area.genus_agent_notes ? `
          <div style="background:#f3f6ff;border:1px solid #d9e4ff;border-radius:13px;padding:13px 15px;margin-bottom:18px;">
            <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#2f6bff;letter-spacing:.06em;margin-bottom:4px;">⊹ GENUS AGENT NOTES</div>
            <p style="font-size:13px;color:#3f4654;margin:0;line-height:1.55;">${escapeHtml(area.genus_agent_notes)}</p>
          </div>
        ` : ''}
        ${area.state === 'overlap' ? renderResolver(area, bu) : ''}
        ${renderSection('MODULE', LAYER_COLORS.module, area.modules.length, area.modules.length > 0
          ? area.modules.map(m => `<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><div style="font-weight:600;font-size:14px;color:#1d2026;">${m.icon || '▣'} ${escapeHtml(m.display_name)}</div><div style="font-size:11px;color:#9aa1ae;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;margin-top:2px;">${escapeHtml(m.id)} · v${escapeHtml(m.version || '0')}</div></div><button type="button" class="onboard-cancel" data-edit-binding="${escapeHtml(m.id)}" style="padding:5px 11px;font-size:11px;">Edit binding</button></div>`).join('')
          : emptyLayerCTA('Install a module', 'modules'))}
        ${renderSection('AGENTS', LAYER_COLORS.agent, area.agents.length, area.agents.length > 0
          ? area.agents.map(a => renderAgentCard(a, bu)).join('')
          : emptyLayerCTA('Add a Mason', 'add-mason'))}
        ${renderSection('HUMAN (HITL)', LAYER_COLORS.human, area.humans.length, area.humans.length > 0
          ? area.humans.map(h => renderHumanCard(h)).join('')
          : emptyLayerCTA('Assign a human', 'people'))}
        ${renderSection('CONNECTED TOOLS', LAYER_COLORS.tools, area.tools.length,
          area.tools.length > 0 ? renderToolsExpandable(area) : `<div style="color:#9aa1ae;font-size:13px;padding:8px 0;">No tools wired for this area yet.</div>`)}
      </div>
      <div style="padding:14px 22px;border-top:1px solid rgba(20,22,28,.06);background:#fbfbfc;display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="onboard-cancel" data-panel-action="assign-human" style="padding:8px 14px;font-size:12px;">Assign a human</button>
        ${area.modules.length === 0 ? '<button type="button" class="onboard-cancel" data-panel-action="install-module" style="padding:8px 14px;font-size:12px;">Install a module</button>' : ''}
        <button type="button" class="onboard-begin" data-panel-action="add-mason" style="padding:8px 14px;font-size:12px;">+ Add a Mason</button>
      </div>
    </aside>
  `;

  document.getElementById('layer-detail-scrim').addEventListener('click', closeDetail);
  document.getElementById('layer-detail-close').addEventListener('click', closeDetail);
  setTimeout(() => {
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeDetail(); document.removeEventListener('keydown', esc); }
    });
  }, 0);

  // Tool drill-down accordion
  document.querySelectorAll('.tool-row-header').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.toolKey;
      const all = document.querySelectorAll('.tool-row-body');
      all.forEach(b => { b.style.display = 'none'; });
      const target = document.querySelector(`.tool-row-body[data-tool-key="${key}"]`);
      if (target) target.style.display = '';
      VIEW_STATE.openToolKey = key;
      document.querySelectorAll('.tool-row-caret').forEach(c => c.style.transform = '');
      const caret = row.querySelector('.tool-row-caret');
      if (caret) caret.style.transform = 'rotate(90deg)';
    });
  });
  // Auto-expand first tool
  const firstToolKey = area.tools[0] && (area.id + ':' + area.tools[0].tool);
  if (firstToolKey) {
    const body = document.querySelector(`.tool-row-body[data-tool-key="${firstToolKey}"]`);
    if (body) body.style.display = '';
    const caret = document.querySelector(`.tool-row-header[data-tool-key="${firstToolKey}"] .tool-row-caret`);
    if (caret) caret.style.transform = 'rotate(90deg)';
  }

  // Footer actions
  document.querySelectorAll('[data-panel-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.panelAction;
      if (act === 'install-module') { closeDetail(); location.hash = '#modules'; }
      else if (act === 'assign-human') { closeDetail(); location.hash = '#people'; }
      else if (act === 'add-mason') alert('Add a Mason — ships in a follow-up Initiative. For now, register Masons in agent_bindings.json directly.');
    });
  });

  // Resolver
  const resolveBtn = document.getElementById('resolver-submit');
  if (resolveBtn) {
    resolveBtn.addEventListener('click', () => {
      const picked = document.querySelector('input[name="resolver-lead"]:checked')?.value;
      if (!picked) return;
      // For v1 — placeholder: surface message, real implementation rewires
      // agent_bindings.json via a new endpoint that sets lead:true on picked
      // + drops the other agent's covers_areas claim for this area.
      alert(`Resolver: ${picked} would be set as lead for "${area.display_name}". Wiring to /api/agent-binding-edit ships in the follow-up that adds covers_areas + lead fields to bindings.`);
      closeDetail();
    });
  }
}

function renderSection(label, color, count, bodyHtml) {
  return `
    <div style="margin-bottom:22px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${color};letter-spacing:.07em;">${label}</span>
        ${count > 0 ? `<span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#6b7280;background:#f0f1f4;border-radius:99px;padding:1px 7px;">${count}</span>` : ''}
        <span style="flex:1;height:1px;background:rgba(20,22,28,.06);"></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function emptyLayerCTA(label, route) {
  const cta = route === 'add-mason'
    ? `<button type="button" data-panel-action="add-mason" style="background:none;border:none;color:#2f6bff;font-weight:600;font-size:12px;cursor:pointer;text-decoration:underline;">+ ${escapeHtml(label)}</button>`
    : `<button type="button" data-panel-action="${escapeHtml(route === 'modules' ? 'install-module' : 'assign-human')}" style="background:none;border:none;color:#2f6bff;font-weight:600;font-size:12px;cursor:pointer;text-decoration:underline;">+ ${escapeHtml(label)}</button>`;
  return `<div style="background:#faf8f4;border:1px dashed rgba(20,22,28,.16);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:13px;color:#9c7a4f;">(none)</span>${cta}</div>`;
}

function renderAgentCard(a, bu) {
  const isPaperclip = (a.runtime_kind || '').startsWith('paperclip-') || (a.runtime_id || '').includes('paperclip');
  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="width:24px;height:24px;border-radius:50%;background:#f1edfe;color:#7a4dff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;">⌬</span>
            <strong style="font-size:13.5px;color:#1d2026;">${escapeHtml(agentShortName(a))}</strong>
            ${a.lead ? '<span style="font:700 9px \'JetBrains Mono\',ui-monospace,Menlo,monospace;background:#7a4dff;color:#fff;padding:1px 6px;border-radius:99px;">LEAD</span>' : ''}
          </div>
          <div style="font:500 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:#9aa1ae;margin-top:4px;">${escapeHtml(a.archetype)} · ${escapeHtml(a.runtime_display_name)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        <button type="button" class="onboard-cancel" style="padding:4px 10px;font-size:11px;" data-agent-edit="${escapeHtml(a.agent_id)}">Edit binding</button>
        ${isPaperclip ? `<a href="http://127.0.0.1:3100" target="_blank" rel="noopener" class="onboard-cancel" style="padding:4px 10px;font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;">View in Paperclip <span style="font-size:10px;">↗</span></a>` : ''}
      </div>
    </div>
  `;
}

function renderHumanCard(h) {
  return `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
      <span style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#0e9f6e,#a3d9c0);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${escapeHtml((h.display_name || '?').charAt(0).toUpperCase())}</span>
      <div style="flex:1;min-width:0;">
        <strong style="font-size:13.5px;color:#1d2026;">${escapeHtml(h.display_name)}</strong>
        <div style="font-size:11px;color:#9aa1ae;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;margin-top:2px;">${escapeHtml(h.email)} · ${escapeHtml(h.role)}${h.explicit ? '' : ' · inferred from HITL'}</div>
      </div>
      <button type="button" class="onboard-cancel" style="padding:4px 10px;font-size:11px;">Reassign</button>
    </div>
  `;
}

function renderToolsExpandable(area) {
  return area.tools.map(t => {
    const tok = TOOL_TOKENS[t.tool] || { bg: '#475569', fg: '#fff', initial: '?', label: t.tool };
    const key = area.id + ':' + t.tool;
    return `
      <div style="background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;">
        <div class="tool-row-header" data-tool-key="${escapeHtml(key)}" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none;">
          ${renderToolChip(t.tool, 30)}
          <div style="flex:1;min-width:0;">
            <strong style="font-size:13px;color:#1d2026;">${escapeHtml(tok.label)}</strong>
            <div style="font-size:11px;color:#9aa1ae;">${(t.resources || []).length} location${(t.resources || []).length === 1 ? '' : 's'}</div>
          </div>
          <span class="tool-row-caret" style="display:inline-block;transition:transform .15s;color:#9aa1ae;">▸</span>
        </div>
        <div class="tool-row-body" data-tool-key="${escapeHtml(key)}" style="display:none;background:#fafbfc;padding:4px 14px 12px;">
          ${(t.resources || []).map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(20,22,28,.06);">
              <span style="width:28px;height:28px;border-radius:6px;background:#eef0f4;display:inline-flex;align-items:center;justify-content:center;color:#475569;font-size:11px;font-weight:700;text-transform:uppercase;">${escapeHtml((r.kind || '?').slice(0,1))}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;color:#1d2026;">${escapeHtml(r.name)}</div>
                <div style="font-size:11px;color:#9aa1ae;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;">${escapeHtml(r.meta || '')}</div>
              </div>
              <span style="font-size:11px;color:#2f6bff;">Open ↗</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderResolver(area, bu) {
  return `
    <div style="background:${STATE_TOKENS.overlap.bg};border:1px solid ${STATE_TOKENS.overlap.border};border-radius:13px;padding:14px 16px;margin-bottom:18px;">
      <div style="font:600 11px 'JetBrains Mono',ui-monospace,Menlo,monospace;color:${STATE_TOKENS.overlap.fg};letter-spacing:.06em;margin-bottom:6px;">⚡ OVERLAP</div>
      <div style="font-size:14px;font-weight:700;color:#1d2026;margin-bottom:4px;">Two agents claim this area</div>
      <p style="font-size:12.5px;color:#5b6270;margin:0 0 12px;line-height:1.55;">Pick a lead. The other agent keeps its other claims but drops <strong>${escapeHtml(area.display_name)}</strong>.</p>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
        ${area.agents.map(a => `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#fff;border:1.5px solid var(--border);border-radius:9px;cursor:pointer;font-size:13px;">
            <input type="radio" name="resolver-lead" value="${escapeHtml(a.agent_id)}" style="accent-color:${STATE_TOKENS.overlap.fg};" />
            <strong style="color:#1d2026;">${escapeHtml(agentShortName(a))}</strong>
            <span style="font-size:11px;color:#9aa1ae;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;">${escapeHtml(a.runtime_display_name)}</span>
          </label>
        `).join('')}
      </div>
      <button type="button" id="resolver-submit" style="width:100%;padding:10px 14px;background:${STATE_TOKENS.overlap.fg};color:#fff;border:none;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer;">Resolve overlap — set lead</button>
    </div>
  `;
}

function closeDetail() {
  const host = document.getElementById('overlay-host');
  if (host) host.innerHTML = '';
}

// ============ Genus Agent meeting (uses existing meeting infrastructure) ============

async function startGenusAgentMeeting(bu, mode = 'areas') {
  // Per Session #19: don't build a special chat overlay. Use the existing
  // meeting primitive. v1 placeholder — when meeting-request API is wired
  // for Genus BU, this fires it; until then, surface that it's queued.
  const topic = mode === 'add-area'
    ? `Business areas — add an area to ${bu}`
    : `Business areas — ${bu}`;
  alert(`Meeting requested with Genus Agent\n\nTopic: "${topic}"\n\nThis would open in the existing meeting chat overlay (built Session #15 for Tuto). For BU=${bu}, the meeting-request endpoint isn't wired up yet — that's a follow-up Initiative. For now, write business_areas.json directly in the substrate.`);
}

// ============ Helpers ============

function agentShortName(a) {
  return `${a.archetype} of ${a.module_id || '—'}`;
}

function badgeIcon(kind) {
  const stroke = 'currentColor';
  if (kind === 'check') return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  if (kind === 'alert') return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  if (kind === 'circle-dashed') return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"><circle cx="12" cy="12" r="9"/></svg>`;
  if (kind === 'zap') return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
  return '';
}
