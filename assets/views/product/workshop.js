// Workshop view — Product module's Workshop section (v0.9 i43 successor).
//
// Where Genus develops its own module catalog: the Product Stewart proposes
// candidate modules based on operator patterns, drafts HTML prototypes, and
// the operator promotes them (→ Sage spec's the real module) or discards them.
//
// Design: /Users/AlessioTixi/Desktop/design_handoff_genus_playground/README.md
// (Claude Design, 2026-07-01) — 3-column Workbench, but Column 1 is the existing
// Genus sidebar so we render Columns 2 (candidate rail) + 3 (detail panel) inside
// the main content area.
//
// v0.1 scope: reads from bus/{BU}/product/workshop_modules.json; UI actions
// (Promote / Discard / Advance) mutate in-memory state and show toast. Persist-
// ence via write-endpoint is v0.2 follow-up.

import { escapeHtml } from '../../utils.js';
import { fetchSubstrateJson } from '../../substrate-client.js';

// ============ Design tokens (from README §Design Tokens) ============
const T = {
  bgCanvas: '#f1eee7',
  bgNav: '#ebe7dd',
  bgRail: '#f6f3ec',
  bgCardRaised: '#fffdf8',
  bgSectionCard: '#faf8f2',
  ink: '#232017',
  ink2a: '#4a4538',
  ink2b: '#55503f',
  muted: '#6b6457',
  muted2a: '#8c8576',
  muted2b: '#9a9384',
  faint1: '#a59e8f',
  faint2: '#b0a999',
  border: '#e6e0d4',
  borderStrong: '#ddd7ca',
  borderCard: '#ebe6da',
  borderNav: '#e0dacd',
  greenPrimary: '#2f5d3f',
  greenTintActive: '#dfe7e0',
  greenTintPromoted: '#e3ede2',
  greenTintPromotedBg: '#eef4ee',
  greenTintPromoBorder: '#d4e2d6',
  greenDot: '#4f8a63',
  greenLink: '#356845',
  greenAccent1: '#3f7d52',
  greenAccent2: '#5a7a64',
  amber: '#c08a3e',
  amberTintPill: '#f3e9d6',
  amberTintBg: '#fbf3e8',
  amberInk: '#9a6320',
  amberInkAlt: '#a08243',
  blueGrey: '#7c8b97',
  blueGreyInk: '#4a5a67',
  blueGreyTint: '#e6ebef',
  red: '#9a3b3b',
};

const STATUS_STYLE = {
  testing:   { dot: T.amber,     pillBg: T.amberTintPill,    pillFg: T.amberInk,   label: 'Testing'   },
  ideation:  { dot: T.blueGrey,  pillBg: T.blueGreyTint,     pillFg: T.blueGreyInk, label: 'Ideation'  },
  promoted:  { dot: T.greenDot,  pillBg: T.greenTintPromoted, pillFg: T.greenLink,  label: 'Promoted'  },
  discarded: { dot: '#aaa294',   pillBg: '#eeebe3',          pillFg: '#8d8475',    label: 'Discarded' },
};

const GROUP_ORDER = ['testing', 'ideation', 'promoted', 'discarded'];
const GROUP_LABEL = { testing: 'Testing', ideation: 'Ideation', promoted: 'Promoted', discarded: 'Discarded' };
const GROUP_COLOR = { testing: T.amber, ideation: '#6f8290', promoted: T.greenDot, discarded: T.faint1 };

const EVIDENCE_STYLE = {
  interaction: { dot: '#356845', bg: '#e3ede2', label: 'interaction' },
  memo:        { dot: T.amberInk, bg: T.amberTintPill, label: 'memo' },
  doc:         { dot: T.blueGreyInk, bg: T.blueGreyTint, label: 'doc' },
  data:        { dot: T.muted, bg: '#ece8df', label: 'data' },
};

// ============ Module-scoped state (persists between renders in the same session) ============
const state = {
  bu: null,
  candidates: [],
  stewart: null,
  routed: [],
  selectedId: null,
  expanded: false,
  discarding: false,
  reasonText: '',
  flash: null,
  flashTimer: null,
};

let rootEl = null;

// ============ Entry point ============
export async function renderWorkshop(ctx) {
  const bu = ctx?.bu || 'genus';
  rootEl = document.getElementById('route-workshop');
  if (!rootEl) return;

  if (state.bu !== bu) {
    // BU changed — reset selection + reload
    state.bu = bu;
    state.selectedId = null;
  }

  const path = `dashboard/public/data/bus/${bu}/product/workshop_modules.json`;
  const data = await fetchSubstrateJson(path, null).catch(() => null);

  if (!data) {
    rootEl.innerHTML = renderEmpty(bu);
    return;
  }

  // Preserve any in-session mutations by merging: if a candidate has been mutated
  // this session, keep the mutation; otherwise take the substrate value.
  const substrateById = new Map((data.candidates || []).map(c => [c.id, c]));
  const mutatedById = new Map(state.candidates.map(c => [c.id, c]));
  state.candidates = (data.candidates || []).map(c => mutatedById.get(c.id) || c);
  state.stewart = data.stewart;
  state.routed = data.routed || [];

  if (!state.selectedId || !state.candidates.some(c => c.id === state.selectedId)) {
    // Auto-select first Testing candidate, else first anything
    const firstTesting = state.candidates.find(c => c.status === 'testing');
    state.selectedId = (firstTesting || state.candidates[0])?.id || null;
  }

  render();
  wire();
}

// ============ Render ============

function render() {
  const selected = getSelected();

  rootEl.innerHTML = `
    <style>${STYLES}</style>
    <div class="ws-shell">
      ${renderRail()}
      ${renderDetail(selected)}
    </div>
    ${state.expanded && selected ? renderExpandModal(selected) : ''}
    ${state.flash ? `<div class="ws-toast">${escapeHtml(state.flash)}</div>` : ''}
  `;
}

function renderEmpty(bu) {
  return `
    <div style="padding:40px 32px; text-align:center; color:${T.muted}; font-family:'Hanken Grotesk',sans-serif;">
      <div style="font-family:'Spectral',serif; font-size:22px; color:${T.ink}; margin-bottom:8px;">Workshop</div>
      <div style="font-size:13.5px; line-height:1.5; max-width:520px; margin:0 auto;">
        No workshop substrate for <b>${escapeHtml(bu)}</b> yet. The Workshop lives in the Product module for the Genus installation itself — modules-in-development get proposed here by the Product Stewart based on your usage patterns. Once <code>bus/${escapeHtml(bu)}/product/workshop_modules.json</code> is seeded, this view surfaces the candidates.
      </div>
    </div>
  `;
}

function renderRail() {
  const grouped = groupCandidates(state.candidates);
  const totalCount = state.candidates.length;

  const stewartCard = state.stewart ? `
    <div class="ws-stewart-card">
      <span class="ws-pulse-dot"></span>
      <span class="ws-stewart-title">${escapeHtml(state.stewart.name || 'Product Stewart')} · ${escapeHtml(state.stewart.state || 'watching')}</span>
      <span class="ws-stewart-meta">${escapeHtml(state.stewart.last_scan_label || '')} · ${escapeHtml(state.stewart.scan_footprint || '')}</span>
    </div>
  ` : '';

  const groupsHtml = GROUP_ORDER
    .filter(g => (grouped[g] || []).length > 0)
    .map(g => {
      const color = GROUP_COLOR[g];
      const label = GROUP_LABEL[g];
      const items = grouped[g];
      return `
        <div class="ws-group">
          <div class="ws-group-header" style="color:${color};">
            <span>${label}</span>
            <span class="ws-group-count">${items.length}</span>
          </div>
          <div class="ws-group-items">
            ${items.map(renderCandidateCard).join('')}
          </div>
        </div>
      `;
    }).join('');

  const routedHtml = (state.routed || []).length > 0 ? `
    <div class="ws-routed">
      <div class="ws-routed-label">Routed — already covered</div>
      ${state.routed.map(r => `
        <div class="ws-routed-body">
          <span style="color:${T.greenAccent1}; font-weight:600;">${escapeHtml(r.detected_need)}</span>
          → sent to ${escapeHtml(r.existing_module_display || r.existing_module)}. ${escapeHtml(r.note || 'No candidate created.')}
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <aside class="ws-rail">
      <div class="ws-rail-header">
        <h2 class="ws-rail-title">Workshop</h2>
        <span class="ws-rail-count">${totalCount} candidate${totalCount === 1 ? '' : 's'}</span>
      </div>
      ${stewartCard}
      <div class="ws-rail-scroll">
        ${groupsHtml}
        ${routedHtml}
      </div>
    </aside>
  `;
}

function renderCandidateCard(c) {
  const style = STATUS_STYLE[c.status] || STATUS_STYLE.ideation;
  const selected = c.id === state.selectedId;
  const isDiscarded = c.status === 'discarded';

  const footer = (() => {
    if (c.status === 'promoted') {
      return `<div class="ws-card-footer" style="color:${T.greenAccent2};">→ Sage spec'ing · ${escapeHtml(c.decided_ago_label || 'recently')}</div>`;
    }
    if (c.status === 'discarded') {
      return `<div class="ws-card-footer">discarded · ${escapeHtml(c.decided_ago_label || 'recently')}</div>`;
    }
    if (c.status === 'testing') {
      return `<div class="ws-card-footer"><span style="color:${T.amber};">●</span> ${c.weight} signals · v${c.iteration}</div>`;
    }
    // ideation
    return `<div class="ws-card-footer"><span style="color:${T.blueGrey};">●</span> ${c.weight} signals · no prototype yet</div>`;
  })();

  const kindBadge = c.kind === 'forked' ? `<span class="ws-card-kind" title="Forked from ${escapeHtml(c.source_module_id || '')} v${escapeHtml(c.source_module_version || '')}">forked · v${escapeHtml(c.target_version || '')}</span>` : '';

  return `
    <div class="ws-card ${selected ? 'ws-card--selected' : ''} ${isDiscarded ? 'ws-card--discarded' : ''}"
         data-card-id="${escapeHtml(c.id)}">
      <span class="ws-card-dot" style="background:${style.dot};"></span>
      <div class="ws-card-name">${escapeHtml(c.name)}</div>
      ${kindBadge}
      <div class="ws-card-desc">${escapeHtml(c.desc || '')}</div>
      ${footer}
    </div>
  `;
}

function renderDetail(c) {
  if (!c) {
    return `
      <section class="ws-detail">
        <div class="ws-detail-inner">
          <div style="padding:40px 0; color:${T.muted}; font-size:13.5px;">Select a candidate on the left.</div>
        </div>
      </section>
    `;
  }
  const style = STATUS_STYLE[c.status];
  const showActions = c.status === 'testing' || c.status === 'ideation';
  const idBadge = `<span class="ws-id-badge">${escapeHtml(c.id)}</span>`;
  const forkBadge = c.kind === 'forked'
    ? `<span class="ws-fork-badge">forked from ${escapeHtml(c.source_module_id)} v${escapeHtml(c.source_module_version)} → v${escapeHtml(c.target_version)}</span>`
    : '';

  return `
    <section class="ws-detail">
      <div class="ws-detail-inner">
        <header class="ws-header">
          <div class="ws-header-left">
            <div class="ws-header-tags">
              <span class="ws-status-pill" style="background:${style.pillBg}; color:${style.pillFg};">${style.label}</span>
              ${idBadge}
              ${forkBadge}
            </div>
            <h1 class="ws-header-name">${escapeHtml(c.name)}</h1>
            <p class="ws-header-desc">${escapeHtml(c.desc || '')}</p>
          </div>
          ${showActions ? `
            <div class="ws-header-actions">
              <button type="button" class="ws-btn ws-btn-discard" data-action="discard">Discard</button>
              <button type="button" class="ws-btn ws-btn-promote" data-action="promote">Promote ↗</button>
            </div>
          ` : ''}
        </header>

        ${state.discarding && showActions ? renderDiscardComposer() : ''}

        ${renderStepper(c)}

        <div class="ws-body">
          <div class="ws-try">
            ${renderTryFrame(c)}
          </div>
          <div class="ws-why">
            ${renderWhy(c)}
            ${renderEvidence(c)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderStepper(c) {
  const nodes = [
    { key: 'ideation', num: 1, label: 'Ideation' },
    { key: 'testing', num: 2, label: 'Testing' },
    { key: 'promoted', num: 3, label: 'Promote / Discard' },
  ];
  const stateIndex = c.status === 'ideation' ? 1
    : c.status === 'testing' ? 2
    : 3;

  const caption = ({
    ideation: 'Gathering evidence. No prototype until it advances to Testing.',
    testing: 'Live prototype. The Steward can re-draft it (each pass is a new version) until you make the call.',
    promoted: 'You promoted it. Sage now owns the build.',
    discarded: 'You discarded it, with a reason the Steward remembers.',
  })[c.status];

  const testingPillsHtml = c.status === 'testing' && c.iteration > 1 ? `
    <span class="ws-stepper-pills">
      <span class="ws-pill-muted">v1</span>
      <span class="ws-pill-active">v${c.iteration} now</span>
    </span>
  ` : (c.status === 'testing' ? `<span class="ws-stepper-pills"><span class="ws-pill-active">v${c.iteration} now</span></span>` : '');

  const nodesHtml = nodes.map((n, i) => {
    const reached = (i + 1) < stateIndex;
    const active = (i + 1) === stateIndex;
    const isTestingActive = active && n.key === 'testing';
    const isPromoted = active && n.key === 'promoted' && c.status === 'promoted';

    let nodeClass = 'ws-stepper-node';
    if (reached || isPromoted) nodeClass += ' ws-stepper-node--reached';
    else if (isTestingActive) nodeClass += ' ws-stepper-node--testing';
    else if (!active) nodeClass += ' ws-stepper-node--unreached';
    else nodeClass += ' ws-stepper-node--reached';

    const withPills = active && n.key === 'testing';

    return `
      ${i > 0 ? `<span class="ws-stepper-connector ${reached || active ? 'ws-stepper-connector--reached' : ''}"></span>` : ''}
      <span class="${nodeClass}">
        <span class="ws-stepper-num">${n.num}</span>
        <span class="ws-stepper-label">${n.label}</span>
        ${withPills ? testingPillsHtml : ''}
      </span>
    `;
  }).join('');

  return `
    <div class="ws-stepper-card">
      <div class="ws-stepper-row">${nodesHtml}</div>
      <div class="ws-stepper-caption">${escapeHtml(caption || '')}</div>
    </div>
  `;
}

function renderTryFrame(c) {
  const frameHead = `
    <div class="ws-frame-head">
      <div class="ws-frame-dots">
        <span class="ws-frame-dot"></span>
        <span class="ws-frame-dot"></span>
        <span class="ws-frame-dot"></span>
      </div>
      <div class="ws-frame-file">${escapeHtml(c.prototype_filename || '—')}</div>
      <div class="ws-frame-meta">
        <span>${escapeHtml(c.prototype_meta || '')}</span>
        ${c.status === 'testing' ? `<button type="button" class="ws-btn-expand" data-action="expand">Expand ⤢</button>` : ''}
      </div>
    </div>
  `;

  let bodyHtml = '';
  if (c.status === 'testing' && c.prototype_path) {
    // iframe via /api/workshop/<path>
    const iframeSrc = `/api/workshop/${c.prototype_path.split('/').map(encodeURIComponent).join('/')}`;
    bodyHtml = `<iframe class="ws-frame-iframe" src="${iframeSrc}" title="Prototype"></iframe>`;
  } else if (c.status === 'ideation') {
    bodyHtml = `
      <div class="ws-frame-empty">
        <div class="ws-frame-empty-hatched">no prototype yet</div>
        <div class="ws-frame-empty-heading">The Steward hasn't built a prototype yet</div>
        <div class="ws-frame-empty-body">Ideation candidates carry a pattern and evidence, but no surface to try. Advance to <span style="color:${T.amber}; font-weight:600;">Testing</span> and the Steward drafts a first prototype on its next heartbeat.</div>
        <button type="button" class="ws-btn ws-btn-advance" data-action="advance">Advance to Testing</button>
      </div>
    `;
  } else if (c.status === 'promoted') {
    bodyHtml = `
      <div class="ws-frame-promoted">
        <div class="ws-frame-promoted-head">
          <span class="ws-sage-avatar">S</span>
          <span class="ws-frame-promoted-title">Task filed on Sage</span>
        </div>
        <pre class="ws-frame-promoted-code">Spec the "${escapeHtml(c.name)}" module — pattern + evidence captured in ${escapeHtml(c.id)}.${c.sage_task_id ? `
Task ID: ${escapeHtml(c.sage_task_id)}` : ''}</pre>
        <div class="ws-frame-promoted-copy">Sage now owns the build. The Steward's job on this candidate is done — the next iterations happen on the real module spec.</div>
      </div>
    `;
  } else if (c.status === 'discarded') {
    bodyHtml = `
      <div class="ws-frame-discarded">
        <div class="ws-frame-discarded-title">Discarded</div>
        <div class="ws-frame-discarded-reason">${escapeHtml(c.decided_reason || 'No reason given.')}</div>
        <div class="ws-frame-discarded-mono">in Steward memory · won't re-propose unless behavior shifts</div>
      </div>
    `;
  }

  return `
    <div class="ws-frame">
      ${frameHead}
      <div class="ws-frame-body">${bodyHtml}</div>
    </div>
  `;
}

function renderWhy(c) {
  return `
    <div class="ws-why-card">
      <div class="ws-why-label">Why this</div>
      <p class="ws-why-body">${escapeHtml(c.pattern || '')}</p>
    </div>
  `;
}

function renderEvidence(c) {
  const evidence = c.evidence || [];
  return `
    <div class="ws-evidence">
      <div class="ws-evidence-header">
        <span class="ws-evidence-label">Evidence</span>
        <span class="ws-evidence-count">${c.weight || evidence.length} signals</span>
      </div>
      <div class="ws-evidence-list">
        ${evidence.map(e => {
          const style = EVIDENCE_STYLE[e.k] || EVIDENCE_STYLE.data;
          return `
            <div class="ws-evidence-item">
              <span class="ws-evidence-dot" style="background:${style.dot};"></span>
              <div class="ws-evidence-content">
                <div class="ws-evidence-meta">
                  <span class="ws-evidence-date">${escapeHtml(e.t || '')}</span>
                  <span class="ws-evidence-chip" style="color:${style.dot}; background:${style.bg};">${escapeHtml(style.label)}</span>
                </div>
                <div class="ws-evidence-text">${escapeHtml(e.s || '')}</div>
              </div>
            </div>
          `;
        }).join('')}
        ${(c.more_signals || 0) > 0 ? `<div class="ws-evidence-more">+ ${c.more_signals} earlier signal${c.more_signals === 1 ? '' : 's'}</div>` : ''}
      </div>
    </div>
  `;
}

function renderDiscardComposer() {
  return `
    <div class="ws-discard-composer">
      <div class="ws-discard-prompt">Why discard this candidate?</div>
      <input type="text" class="ws-discard-input" placeholder="e.g. already do this in Notion, wrong scope…" value="${escapeHtml(state.reasonText)}" data-action="reason-input" />
      <div class="ws-discard-helper">The Steward remembers this — it won't re-propose the same pattern unless behavior materially changes.</div>
      <div class="ws-discard-actions">
        <button type="button" class="ws-btn ws-btn-cancel" data-action="discard-cancel">Cancel</button>
        <button type="button" class="ws-btn ws-btn-discard-confirm" data-action="discard-confirm">Confirm discard</button>
      </div>
    </div>
  `;
}

function renderExpandModal(c) {
  const iframeSrc = c.prototype_path
    ? `/api/workshop/${c.prototype_path.split('/').map(encodeURIComponent).join('/')}`
    : '';
  return `
    <div class="ws-modal-backdrop" data-action="modal-close">
      <div class="ws-modal" data-action="modal-inner">
        <div class="ws-modal-head">
          <div class="ws-modal-title">${escapeHtml(c.name)}</div>
          <div class="ws-modal-meta">${escapeHtml(c.prototype_meta || '')}</div>
          <button type="button" class="ws-modal-close" data-action="modal-close">Close ✕</button>
        </div>
        <div class="ws-modal-body">
          ${iframeSrc ? `<iframe class="ws-modal-iframe" src="${iframeSrc}" title="Prototype"></iframe>` : `<div style="padding:40px; text-align:center; color:${T.muted};">No prototype available.</div>`}
        </div>
      </div>
    </div>
  `;
}

// ============ Interactions ============

function wire() {
  if (!rootEl) return;

  rootEl.addEventListener('click', (e) => {
    const cardEl = e.target.closest('[data-card-id]');
    if (cardEl) {
      const id = cardEl.dataset.cardId;
      selectCandidate(id);
      return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const c = getSelected();
    if (!c) return;

    if (action === 'promote') doPromote(c);
    else if (action === 'discard') openDiscard();
    else if (action === 'discard-cancel') closeDiscard();
    else if (action === 'discard-confirm') doDiscard(c);
    else if (action === 'advance') doAdvance(c);
    else if (action === 'expand') openExpand();
    else if (action === 'modal-close') closeExpand(e);
    else if (action === 'modal-inner') e.stopPropagation();
  });

  rootEl.addEventListener('input', (e) => {
    const actionEl = e.target.closest('[data-action="reason-input"]');
    if (actionEl) {
      state.reasonText = actionEl.value;
    }
  });
}

function selectCandidate(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  state.discarding = false;
  state.reasonText = '';
  state.expanded = false;
  render();
  wire();
}

function doPromote(c) {
  updateCandidate(c.id, {
    status: 'promoted',
    decided_at: nowIso(),
    decided_ago_label: 'just now',
    prototype_meta: 'promoted',
  });
  flash(`Promoted — task filed on Sage to spec '${c.name}'.`);
  state.discarding = false;
  render();
  wire();
}

function openDiscard() {
  state.discarding = true;
  state.reasonText = '';
  render();
  wire();
  const input = rootEl.querySelector('[data-action="reason-input"]');
  if (input) input.focus();
}

function closeDiscard() {
  state.discarding = false;
  state.reasonText = '';
  render();
  wire();
}

function doDiscard(c) {
  const reason = state.reasonText.trim() || 'No reason given.';
  updateCandidate(c.id, {
    status: 'discarded',
    decided_at: nowIso(),
    decided_ago_label: 'just now',
    decided_reason: reason,
    prototype_meta: 'discarded',
  });
  state.discarding = false;
  state.reasonText = '';
  flash("Discarded — the Steward will remember not to re-propose this.");
  render();
  wire();
}

function doAdvance(c) {
  const newIter = Math.max(1, c.iteration || 0);
  updateCandidate(c.id, {
    status: 'testing',
    iteration: newIter,
    prototype_filename: `${c.id}.html`,
    prototype_meta: `v${newIter} · drafting…`,
  });
  flash('Advanced to Testing — Steward will draft a prototype on next heartbeat.');
  render();
  wire();
}

function openExpand() {
  state.expanded = true;
  render();
  wire();
}

function closeExpand(e) {
  if (e && e.target && e.target.dataset && e.target.dataset.action === 'modal-inner') return;
  state.expanded = false;
  render();
  wire();
}

// ============ State helpers ============

function updateCandidate(id, patch) {
  state.candidates = state.candidates.map(c => c.id === id ? { ...c, ...patch } : c);
}

function getSelected() {
  return state.candidates.find(c => c.id === state.selectedId) || null;
}

function groupCandidates(list) {
  const out = { testing: [], ideation: [], promoted: [], discarded: [] };
  for (const c of list) {
    if (out[c.status]) out[c.status].push(c);
  }
  return out;
}

function flash(msg) {
  state.flash = msg;
  if (state.flashTimer) clearTimeout(state.flashTimer);
  state.flashTimer = setTimeout(() => {
    state.flash = null;
    if (rootEl) render();
  }, 3200);
}

function nowIso() {
  return new Date().toISOString();
}

// ============ Styles ============

const STYLES = `
  #route-workshop {
    background: ${T.bgCanvas};
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    color: ${T.ink};
    height: calc(100vh - var(--main-header-height, 0px));
    overflow: hidden;
  }
  .ws-shell {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
    background: ${T.bgCanvas};
    animation: gpIn 0.24s ease;
  }
  @keyframes gpIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes gpWatch { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.82); } }

  /* ============ Rail (Column 2) ============ */
  .ws-rail {
    background: ${T.bgRail};
    border-right: 1px solid ${T.borderStrong};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ws-rail-header {
    padding: 20px 20px 14px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .ws-rail-title {
    font-family: 'Spectral', serif;
    font-weight: 600;
    font-size: 23px;
    letter-spacing: -.01em;
    margin: 0;
    color: ${T.ink};
  }
  .ws-rail-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.muted2b};
  }
  .ws-stewart-card {
    margin: 0 20px 16px;
    background: ${T.bgCardRaised};
    border: 1px solid #e3ddd0;
    border-radius: 10px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    row-gap: 2px;
    align-items: center;
  }
  .ws-pulse-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: ${T.greenDot};
    animation: gpWatch 2.4s ease-in-out infinite;
    display: inline-block;
    grid-row: 1 / 3;
  }
  .ws-stewart-title {
    font-size: 12.5px; font-weight: 600; color: ${T.ink2a};
  }
  .ws-stewart-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #8c8576;
    grid-column: 2;
  }
  .ws-rail-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 20px 20px;
  }
  .ws-group { margin-bottom: 18px; }
  .ws-group-header {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .14em;
    padding: 6px 2px;
    display: flex;
    justify-content: space-between;
  }
  .ws-group-count { color: ${T.muted2b}; }
  .ws-group-items { display: flex; flex-direction: column; gap: 6px; }
  .ws-card {
    position: relative;
    background: ${T.bgRail};
    border: 1px solid ${T.borderCard};
    border-radius: 11px;
    padding: 12px 13px;
    cursor: pointer;
    transition: background .12s, border-color .12s, box-shadow .12s;
    animation: gpIn 0.24s ease;
  }
  .ws-card:hover { border-color: #d8d0bd; }
  .ws-card--selected {
    background: ${T.bgCardRaised};
    border-color: #c9c0ad;
    box-shadow: 0 2px 10px rgba(60,52,30,.08);
  }
  .ws-card--discarded {
    opacity: .72;
  }
  .ws-card--discarded .ws-card-name {
    text-decoration: line-through;
    text-decoration-color: #c3bcad;
  }
  .ws-card-dot {
    position: absolute;
    top: 14px; right: 14px;
    width: 7px; height: 7px;
    border-radius: 50%;
  }
  .ws-card-name {
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.25;
    padding-right: 16px;
    color: ${T.ink};
  }
  .ws-card-kind {
    display: inline-block;
    margin-top: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: .06em;
    padding: 2px 6px;
    background: ${T.blueGreyTint};
    color: ${T.blueGreyInk};
    border-radius: 6px;
    text-transform: uppercase;
  }
  .ws-card-desc {
    font-size: 11.5px;
    color: ${T.muted2a};
    margin-top: 6px;
    line-height: 1.35;
  }
  .ws-card-footer {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: ${T.faint1};
    margin-top: 8px;
  }
  .ws-routed {
    margin-top: 8px;
    border: 1px dashed ${T.borderStrong};
    background: transparent;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .ws-routed-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: ${T.muted2b};
    margin-bottom: 4px;
  }
  .ws-routed-body {
    font-size: 12px;
    color: ${T.ink2b};
    line-height: 1.4;
  }

  /* ============ Detail (Column 3) ============ */
  .ws-detail {
    background: ${T.bgCanvas};
    overflow-y: auto;
    padding: 26px 34px 60px;
  }
  .ws-detail-inner {
    max-width: 980px;
    margin: 0 auto;
    animation: gpIn 0.3s ease;
  }
  .ws-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 22px;
  }
  .ws-header-left { flex: 1; min-width: 0; }
  .ws-header-tags {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .ws-status-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    padding: 4px 10px;
    border-radius: 20px;
    font-weight: 500;
  }
  .ws-id-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.faint1};
  }
  .ws-fork-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: ${T.blueGreyInk};
    background: ${T.blueGreyTint};
    padding: 3px 8px;
    border-radius: 8px;
  }
  .ws-header-name {
    font-family: 'Spectral', serif;
    font-weight: 600;
    font-size: 31px;
    letter-spacing: -.015em;
    line-height: 1.1;
    margin: 4px 0 8px;
    color: ${T.ink};
  }
  .ws-header-desc {
    font-size: 15px;
    color: ${T.muted};
    max-width: 60ch;
    line-height: 1.5;
    margin: 0;
  }
  .ws-header-actions { display: flex; gap: 8px; flex-shrink: 0; padding-top: 4px; }
  .ws-btn {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    border-radius: 9px;
    padding: 9px 15px;
    cursor: pointer;
    transition: transform .06s, box-shadow .12s;
  }
  .ws-btn:active { transform: translateY(1px); }
  .ws-btn-discard {
    background: ${T.bgCardRaised};
    border: 1px solid ${T.borderStrong};
    color: ${T.muted};
  }
  .ws-btn-promote {
    background: ${T.greenPrimary};
    border: 1px solid ${T.greenPrimary};
    color: ${T.greenTintPromotedBg};
    padding: 9px 18px;
    box-shadow: 0 1px 2px rgba(47,93,63,.25);
  }
  .ws-btn-promote:hover { background: #274d34; }
  .ws-btn-cancel {
    background: transparent;
    border: 1px solid ${T.borderStrong};
    color: ${T.muted};
    padding: 8px 14px;
    font-size: 12px;
  }
  .ws-btn-discard-confirm {
    background: ${T.bgCardRaised};
    border: 1px solid ${T.red};
    color: ${T.red};
    padding: 8px 14px;
    font-size: 12px;
  }
  .ws-btn-advance {
    background: ${T.bgCardRaised};
    border: 1px solid ${T.amber};
    color: ${T.amberInk};
    padding: 8px 14px;
    font-size: 12px;
    margin-top: 12px;
  }
  .ws-btn-expand {
    background: ${T.bgCardRaised};
    border: 1px solid ${T.borderStrong};
    color: ${T.muted};
    padding: 4px 10px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    margin-left: 8px;
  }

  /* ============ Discard composer ============ */
  .ws-discard-composer {
    background: ${T.bgCardRaised};
    border: 1px solid #e3ddd0;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 20px;
    animation: gpIn 0.24s ease;
  }
  .ws-discard-prompt {
    font-size: 12.5px;
    font-weight: 600;
    color: ${T.ink2a};
    margin-bottom: 8px;
  }
  .ws-discard-input {
    width: 100%;
    background: #fbf9f3;
    border: 1px solid ${T.borderStrong};
    border-radius: 8px;
    padding: 8px 12px;
    font-family: 'Hanken Grotesk', sans-serif;
    font-size: 13px;
    color: ${T.ink};
    box-sizing: border-box;
  }
  .ws-discard-input::placeholder { color: ${T.faint1}; }
  .ws-discard-input:focus { outline: none; border-color: #c9c0ad; }
  .ws-discard-helper {
    font-size: 11px;
    color: ${T.muted2b};
    margin: 6px 0 10px;
  }
  .ws-discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* ============ Stepper ============ */
  .ws-stepper-card {
    background: ${T.bgSectionCard};
    border: 1px solid ${T.border};
    border-radius: 12px;
    padding: 15px 18px;
    margin-bottom: 20px;
  }
  .ws-stepper-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ws-stepper-node {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .ws-stepper-num {
    width: 24px; height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid;
  }
  .ws-stepper-label {
    font-size: 12.5px;
    font-weight: 600;
  }
  .ws-stepper-node--reached .ws-stepper-num {
    background: ${T.greenTintActive};
    color: ${T.greenPrimary};
    border-color: ${T.greenPrimary};
  }
  .ws-stepper-node--reached .ws-stepper-label { color: ${T.greenPrimary}; }
  .ws-stepper-node--testing .ws-stepper-num {
    background: ${T.amberTintPill};
    color: ${T.amber};
    border-color: ${T.amber};
  }
  .ws-stepper-node--testing .ws-stepper-label { color: ${T.amber}; }
  .ws-stepper-node--unreached .ws-stepper-num {
    background: ${T.bgSectionCard};
    color: #b0a999;
    border-color: #cfc8b9;
  }
  .ws-stepper-node--unreached .ws-stepper-label { color: #b0a999; }
  .ws-stepper-connector {
    width: 32px;
    height: 1.5px;
    background: #cfc8b9;
    display: inline-block;
  }
  .ws-stepper-connector--reached { background: ${T.greenPrimary}; }
  .ws-stepper-pills {
    display: inline-flex;
    gap: 6px;
    margin-left: 6px;
  }
  .ws-pill-muted, .ws-pill-active {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 20px;
    font-weight: 500;
  }
  .ws-pill-muted { background: ${T.amberTintPill}; color: ${T.amberInkAlt}; }
  .ws-pill-active { background: ${T.amber}; color: #fff; }
  .ws-stepper-caption {
    font-size: 11.5px;
    color: ${T.muted2b};
    margin-top: 12px;
  }

  /* ============ Body (Try + Why/Evidence) ============ */
  .ws-body {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .ws-try { flex: 1.55; min-width: 0; }
  .ws-why { flex: 1; min-width: 0; }

  .ws-frame {
    border: 1px solid ${T.borderNav};
    border-radius: 13px;
    background: #fff;
    box-shadow: 0 2px 12px rgba(60,52,30,.06);
    overflow: hidden;
  }
  .ws-frame-head {
    background: #f3f0e9;
    border-bottom: 1px solid ${T.border};
    padding: 9px 13px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ws-frame-dots { display: flex; gap: 5px; }
  .ws-frame-dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: #dcd6c8;
  }
  .ws-frame-file {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: ${T.muted2b};
    margin-left: 6px;
  }
  .ws-frame-meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: ${T.muted2b};
  }
  .ws-frame-body { min-height: 360px; }
  .ws-frame-iframe {
    width: 100%;
    height: 500px;
    border: 0;
    display: block;
  }
  .ws-frame-empty {
    padding: 24px 28px 28px;
    text-align: center;
  }
  .ws-frame-empty-hatched {
    height: 130px;
    background-image: repeating-linear-gradient(135deg,#f4f1ea,#f4f1ea 9px,#efebe2 9px,#efebe2 18px);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.faint1};
    margin-bottom: 18px;
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .ws-frame-empty-heading {
    font-family: 'Spectral', serif;
    font-weight: 600;
    font-size: 17px;
    color: ${T.ink};
    margin-bottom: 6px;
  }
  .ws-frame-empty-body {
    font-size: 12.5px;
    color: ${T.muted2a};
    line-height: 1.55;
    max-width: 42ch;
    margin: 0 auto;
  }
  .ws-frame-promoted {
    padding: 22px 26px 26px;
    background: ${T.greenTintPromotedBg};
    border: 1px solid ${T.greenTintPromoBorder};
    border-radius: 10px;
    margin: 18px;
  }
  .ws-frame-promoted-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .ws-sage-avatar {
    width: 22px; height: 22px;
    background: ${T.greenPrimary};
    color: ${T.greenTintPromotedBg};
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'Spectral', serif;
    font-size: 12px;
    font-weight: 600;
  }
  .ws-frame-promoted-title {
    font-size: 14px;
    font-weight: 600;
    color: ${T.greenLink};
  }
  .ws-frame-promoted-code {
    background: ${T.greenTintPromoted};
    padding: 10px 14px;
    border-radius: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: ${T.ink2a};
    margin: 0 0 12px;
    white-space: pre-wrap;
  }
  .ws-frame-promoted-copy {
    font-size: 12.5px;
    color: ${T.ink2a};
    line-height: 1.55;
  }
  .ws-frame-discarded {
    padding: 40px 30px;
    text-align: center;
  }
  .ws-frame-discarded-title {
    font-family: 'Spectral', serif;
    font-weight: 600;
    font-size: 20px;
    color: ${T.muted};
    margin-bottom: 8px;
  }
  .ws-frame-discarded-reason {
    font-size: 13.5px;
    color: ${T.ink2a};
    font-style: italic;
    max-width: 42ch;
    margin: 0 auto 12px;
    line-height: 1.5;
  }
  .ws-frame-discarded-mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.muted2b};
  }

  /* ============ Why / Evidence ============ */
  .ws-why-card {
    background: ${T.bgSectionCard};
    border: 1px solid ${T.border};
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 18px;
  }
  .ws-why-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: ${T.muted2b};
    margin-bottom: 8px;
  }
  .ws-why-body {
    font-size: 13.5px;
    color: ${T.ink2a};
    line-height: 1.6;
    margin: 0;
  }
  .ws-evidence-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
    padding: 0 4px;
  }
  .ws-evidence-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: ${T.muted2b};
  }
  .ws-evidence-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.muted2b};
  }
  .ws-evidence-list {
    border-left: 1.5px solid ${T.border};
    margin-left: 4px;
    padding-left: 14px;
  }
  .ws-evidence-item {
    position: relative;
    padding: 8px 0 8px 4px;
  }
  .ws-evidence-dot {
    position: absolute;
    left: -20px;
    top: 14px;
    width: 9px; height: 9px;
    border-radius: 50%;
  }
  .ws-evidence-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .ws-evidence-date {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: ${T.muted2b};
  }
  .ws-evidence-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .06em;
    padding: 1px 6px;
    border-radius: 6px;
    font-weight: 500;
  }
  .ws-evidence-text {
    font-size: 12.5px;
    color: ${T.ink2b};
    line-height: 1.45;
  }
  .ws-evidence-more {
    padding: 8px 0 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.faint1};
  }

  /* ============ Modal ============ */
  .ws-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(35,32,23,.42);
    backdrop-filter: blur(3px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 30px;
    animation: gpIn 0.18s ease;
  }
  .ws-modal {
    max-width: 1080px;
    width: 100%;
    max-height: 88vh;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 24px 70px rgba(0,0,0,.34);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ws-modal-head {
    background: #f3f0e9;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 1px solid ${T.border};
  }
  .ws-modal-title {
    font-family: 'Spectral', serif;
    font-weight: 600;
    font-size: 15px;
    color: ${T.ink};
  }
  .ws-modal-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: ${T.muted2b};
  }
  .ws-modal-close {
    margin-left: auto;
    background: ${T.bgCardRaised};
    border: 1px solid ${T.borderStrong};
    color: ${T.muted};
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .ws-modal-body {
    flex: 1;
    overflow: auto;
    background: #fff;
  }
  .ws-modal-iframe {
    width: 100%;
    height: 100%;
    min-height: 500px;
    border: 0;
    display: block;
  }

  /* ============ Toast ============ */
  .ws-toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #232017;
    color: #f4f1e8;
    font-size: 13px;
    font-weight: 500;
    padding: 11px 18px;
    border-radius: 11px;
    box-shadow: 0 8px 28px rgba(0,0,0,.22);
    z-index: 10000;
    animation: gpIn 0.2s ease;
  }
`;
