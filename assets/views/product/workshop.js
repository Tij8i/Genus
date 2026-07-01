// Workshop view — Product module's Workshop section (v0.9).
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
// Palette + fonts: reskinned 2026-07-01 to Genus design system (assets/app.css)
// — cool grey + blue-accent + Hanken Grotesk throughout. Layout + interactions
// unchanged from the Claude Design handoff.
//
// v0.1 scope: reads from bus/{BU}/product/workshop_modules.json; UI actions
// (Promote / Discard / Advance) mutate in-memory state and show toast. Persist-
// ence via write-endpoint is v0.2 follow-up.

import { escapeHtml } from '../../utils.js';
import { fetchSubstrateJson } from '../../substrate-client.js';

// Status → semantic Genus colors
const STATUS_STYLE = {
  testing:   { dot: 'var(--yellow)',   pillBg: 'var(--yellow-bg)',  pillFg: 'var(--yellow-fg)',  label: 'Testing'   },
  ideation:  { dot: 'var(--text-faint)', pillBg: 'var(--surface2)', pillFg: 'var(--text-dim)',   label: 'Ideation'  },
  promoted:  { dot: 'var(--green)',    pillBg: 'var(--green-bg)',   pillFg: 'var(--green-fg)',   label: 'Promoted'  },
  discarded: { dot: 'var(--text-veryfaint)', pillBg: 'var(--surface2)', pillFg: 'var(--text-faint)', label: 'Discarded' },
};

const GROUP_ORDER = ['testing', 'ideation', 'promoted', 'discarded'];
const GROUP_LABEL = { testing: 'Testing', ideation: 'Ideation', promoted: 'Promoted', discarded: 'Discarded' };
const GROUP_COLOR = { testing: 'var(--yellow-fg)', ideation: 'var(--text-dim)', promoted: 'var(--green-fg)', discarded: 'var(--text-faint)' };

const EVIDENCE_STYLE = {
  interaction: { dot: 'var(--accent)',  bg: 'var(--accent-bg)',   fg: 'var(--accent)',    label: 'interaction' },
  memo:        { dot: 'var(--yellow)',  bg: 'var(--yellow-bg)',   fg: 'var(--yellow-fg)', label: 'memo'        },
  doc:         { dot: 'var(--text-dim)', bg: 'var(--surface2)',   fg: 'var(--text-dim)',  label: 'doc'         },
  data:        { dot: 'var(--green)',   bg: 'var(--green-bg)',    fg: 'var(--green-fg)',  label: 'data'        },
};

// Origin → display metadata (who proposed the candidate)
const ORIGIN_STYLE = {
  operator: { label: 'You',              badge: 'you',     accent: 'var(--accent)' },
  stewart:  { label: 'Product Stewart',  badge: 'stewart', accent: 'var(--green-fg)' },
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
  creating: false,
  newName: '',
  newDesc: '',
  newPattern: '',
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
    state.bu = bu;
    state.selectedId = null;
  }

  const path = `dashboard/public/data/bus/${bu}/product/workshop_modules.json`;
  const data = await fetchSubstrateJson(path, null).catch(() => null);

  if (!data) {
    rootEl.innerHTML = renderEmpty(bu);
    return;
  }

  // Preserve in-session mutations: if a candidate was mutated this session,
  // keep the mutation; otherwise take the substrate value.
  const mutatedById = new Map(state.candidates.map(c => [c.id, c]));
  state.candidates = (data.candidates || []).map(c => mutatedById.get(c.id) || c);
  state.stewart = data.stewart;
  state.routed = data.routed || [];

  if (!state.selectedId || !state.candidates.some(c => c.id === state.selectedId)) {
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
    ${state.creating ? renderCreateModal() : ''}
    ${state.flash ? `<div class="ws-toast">${escapeHtml(state.flash)}</div>` : ''}
  `;
}

function renderEmpty(bu) {
  return `
    <div style="padding:40px 32px; text-align:center; color: var(--text-dim); font-family:'Hanken Grotesk',system-ui,sans-serif;">
      <div style="font-family:'Hanken Grotesk',system-ui,sans-serif; font-size:20px; font-weight:700; letter-spacing:-.01em; color: var(--text); margin-bottom:8px;">Workshop</div>
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
      <div class="ws-stewart-copy">
        <div class="ws-stewart-title">${escapeHtml(state.stewart.name || 'Product Stewart')} · ${escapeHtml(state.stewart.state || 'watching')}</div>
        <div class="ws-stewart-meta">${escapeHtml(state.stewart.last_scan_label || '')} · ${escapeHtml(state.stewart.scan_footprint || '')}</div>
      </div>
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
          <span style="color: var(--green-fg); font-weight:600;">${escapeHtml(r.detected_need)}</span>
          → sent to ${escapeHtml(r.existing_module_display || r.existing_module)}. ${escapeHtml(r.note || 'No candidate created.')}
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <aside class="ws-rail">
      <div class="ws-rail-header">
        <div class="ws-rail-titlerow">
          <h2 class="ws-rail-title">Workshop</h2>
          <span class="ws-rail-count">${totalCount} candidate${totalCount === 1 ? '' : 's'}</span>
        </div>
        <button type="button" class="ws-rail-new" data-action="open-create">＋ New candidate</button>
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
      return `<div class="ws-card-footer" style="color: var(--green-fg);">→ Sage spec'ing · ${escapeHtml(c.decided_ago_label || 'recently')}</div>`;
    }
    if (c.status === 'discarded') {
      return `<div class="ws-card-footer">discarded · ${escapeHtml(c.decided_ago_label || 'recently')}</div>`;
    }
    if (c.status === 'testing') {
      return `<div class="ws-card-footer"><span style="color: var(--yellow);">●</span> ${c.weight} signals · v${c.iteration}</div>`;
    }
    return `<div class="ws-card-footer"><span style="color: var(--text-faint);">●</span> ${c.weight} signals · no prototype yet</div>`;
  })();

  const kindBadge = c.kind === 'forked' ? `<span class="ws-card-kind" title="Forked from ${escapeHtml(c.source_module_id || '')} v${escapeHtml(c.source_module_version || '')}">forked · v${escapeHtml(c.target_version || '')}</span>` : '';
  const origin = ORIGIN_STYLE[c.origin] || ORIGIN_STYLE.stewart;
  const authorBadge = `<span class="ws-card-author" title="Proposed by ${escapeHtml(origin.label)}" style="color:${origin.accent};">by ${escapeHtml(origin.badge)}</span>`;

  return `
    <div class="ws-card ${selected ? 'ws-card--selected' : ''} ${isDiscarded ? 'ws-card--discarded' : ''}"
         data-card-id="${escapeHtml(c.id)}">
      <span class="ws-card-dot" style="background:${style.dot};"></span>
      <div class="ws-card-name">${escapeHtml(c.name)}</div>
      <div class="ws-card-badges">
        ${authorBadge}
        ${kindBadge}
      </div>
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
          <div style="padding:40px 0; color: var(--text-dim); font-size:13.5px;">Select a candidate on the left.</div>
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
  const origin = ORIGIN_STYLE[c.origin] || ORIGIN_STYLE.stewart;
  const authorEyebrow = `<div class="ws-header-author" style="color:${origin.accent};">Proposed by ${escapeHtml(origin.label)}</div>`;

  return `
    <section class="ws-detail">
      <div class="ws-detail-inner">
        <header class="ws-header">
          <div class="ws-header-left">
            ${authorEyebrow}
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
    const iframeSrc = `/api/workshop/${c.prototype_path.split('/').map(encodeURIComponent).join('/')}`;
    bodyHtml = `<iframe class="ws-frame-iframe" src="${iframeSrc}" title="Prototype"></iframe>`;
  } else if (c.status === 'ideation') {
    bodyHtml = `
      <div class="ws-frame-empty">
        <div class="ws-frame-empty-hatched">no prototype yet</div>
        <div class="ws-frame-empty-heading">The Steward hasn't built a prototype yet</div>
        <div class="ws-frame-empty-body">Ideation candidates carry a pattern and evidence, but no surface to try. Advance to <span style="color: var(--yellow-fg); font-weight:600;">Testing</span> and the Steward drafts a first prototype on its next heartbeat.</div>
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
          const s = EVIDENCE_STYLE[e.k] || EVIDENCE_STYLE.data;
          return `
            <div class="ws-evidence-item">
              <span class="ws-evidence-dot" style="background:${s.dot};"></span>
              <div class="ws-evidence-content">
                <div class="ws-evidence-meta">
                  <span class="ws-evidence-date">${escapeHtml(e.t || '')}</span>
                  <span class="ws-evidence-chip" style="color:${s.fg}; background:${s.bg};">${escapeHtml(s.label)}</span>
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

function renderCreateModal() {
  const canSubmit = state.newName.trim().length > 0 && state.newDesc.trim().length > 0;
  return `
    <div class="ws-modal-backdrop" data-action="create-close">
      <div class="ws-modal ws-modal--form" data-action="create-inner">
        <div class="ws-modal-head">
          <div class="ws-modal-title">Propose a new candidate</div>
          <button type="button" class="ws-modal-close" data-action="create-close">Close ✕</button>
        </div>
        <div class="ws-modal-body ws-create-body">
          <div class="ws-create-lede">
            Describe a module you'd like Genus to develop. It'll enter <span style="color:var(--text-dim); font-weight:600;">Ideation</span> with you marked as proposer. When you advance it to <span style="color:var(--yellow-fg); font-weight:600;">Testing</span>, the Product Stewart will draft the first prototype on its next heartbeat.
          </div>
          <label class="ws-form-label">
            <span>Name</span>
            <input type="text" class="ws-form-input" data-action="create-name" value="${escapeHtml(state.newName)}" placeholder="e.g. Personal agents tab in Roster" />
          </label>
          <label class="ws-form-label">
            <span>What would it do?</span>
            <input type="text" class="ws-form-input" data-action="create-desc" value="${escapeHtml(state.newDesc)}" placeholder="One line — the thing this module would show or do." />
          </label>
          <label class="ws-form-label">
            <span>Why this? <span class="ws-form-optional">(optional — helps the Stewart draft it better)</span></span>
            <textarea class="ws-form-textarea" data-action="create-pattern" placeholder="What pattern made you think of this? What's currently painful or scattered?" rows="3">${escapeHtml(state.newPattern)}</textarea>
          </label>
        </div>
        <div class="ws-modal-foot">
          <button type="button" class="ws-btn ws-btn-cancel" data-action="create-close">Cancel</button>
          <button type="button" class="ws-btn ws-btn-promote" data-action="create-submit" ${canSubmit ? '' : 'disabled'} style="${canSubmit ? '' : 'opacity:.5; cursor:not-allowed;'}">Add to Ideation</button>
        </div>
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
          ${iframeSrc ? `<iframe class="ws-modal-iframe" src="${iframeSrc}" title="Prototype"></iframe>` : `<div style="padding:40px; text-align:center; color: var(--text-dim);">No prototype available.</div>`}
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
      selectCandidate(cardEl.dataset.cardId);
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
    else if (action === 'open-create') openCreate();
    else if (action === 'create-close') closeCreate(e);
    else if (action === 'create-inner') e.stopPropagation();
    else if (action === 'create-submit') doCreate();
  });

  rootEl.addEventListener('input', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'reason-input') state.reasonText = el.value;
    else if (a === 'create-name') state.newName = el.value;
    else if (a === 'create-desc') state.newDesc = el.value;
    else if (a === 'create-pattern') state.newPattern = el.value;
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

function openCreate() {
  state.creating = true;
  state.newName = '';
  state.newDesc = '';
  state.newPattern = '';
  render();
  wire();
  const first = rootEl.querySelector('[data-action="create-name"]');
  if (first) first.focus();
}

function closeCreate(e) {
  if (e && e.target && e.target.dataset && e.target.dataset.action === 'create-inner') return;
  state.creating = false;
  render();
  wire();
}

function doCreate() {
  const name = state.newName.trim();
  const desc = state.newDesc.trim();
  const pattern = state.newPattern.trim() || 'Proposed by the operator — no pattern text provided.';
  if (!name || !desc) return;

  const slug = name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const id = state.candidates.some(c => c.id === slug) ? `${slug}-${Date.now().toString(36)}` : slug;

  const now = nowIso();
  const candidate = {
    id,
    name,
    kind: 'new',
    origin: 'operator',
    source_module_id: null,
    target_version: '0.1.0',
    status: 'ideation',
    iteration: 0,
    weight: 1,
    desc,
    prototype_path: null,
    prototype_filename: '—',
    prototype_meta: 'awaiting prototype',
    pattern,
    reason: '',
    created_at: now,
    last_updated: now,
    decided_at: null,
    decided_reason: null,
    evidence: [
      { t: now.slice(0, 10), k: 'memo', s: 'Operator note when creating this candidate — proposed the pattern directly.' },
    ],
    more_signals: 0,
  };
  state.candidates = [candidate, ...state.candidates];
  state.selectedId = id;
  state.creating = false;
  flash(`Added "${name}" to Ideation.`);
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

// ============ Styles — Genus design system ============

const STYLES = `
  #route-workshop {
    background: var(--bg);
    font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
    color: var(--text);
    height: 100%;
    overflow: hidden;
  }
  .ws-shell {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
    background: var(--bg);
    animation: wsIn 0.22s ease;
  }
  @keyframes wsIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* ============ Rail (Column 2) ============ */
  .ws-rail {
    background: var(--surface2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .ws-rail-header {
    padding: 22px 22px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ws-rail-titlerow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .ws-rail-title {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-weight: 700;
    font-size: 20px;
    letter-spacing: -.015em;
    margin: 0;
    color: var(--text);
  }
  .ws-rail-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }
  .ws-rail-new {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--surface);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 8px;
    padding: 7px 12px;
    cursor: pointer;
    transition: background .12s;
    text-align: center;
  }
  .ws-rail-new:hover { background: var(--accent-bg); }
  .ws-stewart-card {
    margin: 0 22px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 12px;
    align-items: center;
  }
  .ws-pulse-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    animation: pulseDot 2.4s ease-in-out infinite;
    flex: none;
  }
  .ws-stewart-copy { min-width: 0; }
  .ws-stewart-title { font-size: 12.5px; font-weight: 600; color: var(--text); line-height: 1.3; }
  .ws-stewart-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--text-faint);
    margin-top: 2px;
  }
  .ws-rail-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 22px 24px;
    min-height: 0;
  }
  .ws-group { margin-bottom: 24px; }
  .ws-group-header {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .14em;
    padding: 6px 2px 10px;
    display: flex;
    justify-content: space-between;
  }
  .ws-group-count { color: var(--text-faint); }
  .ws-group-items { display: flex; flex-direction: column; gap: 8px; }
  .ws-card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 15px;
    cursor: pointer;
    transition: background .12s, border-color .12s, box-shadow .12s;
    animation: wsIn 0.22s ease;
  }
  .ws-card:hover { border-color: var(--border-strong); background: var(--surface-hover); }
  .ws-card--selected {
    background: var(--surface);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }
  .ws-card--discarded { opacity: .68; }
  .ws-card--discarded .ws-card-name {
    text-decoration: line-through;
    text-decoration-color: var(--text-veryfaint);
  }
  .ws-card-dot {
    position: absolute;
    top: 14px; right: 14px;
    width: 8px; height: 8px;
    border-radius: 50%;
  }
  .ws-card-name {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    padding-right: 16px;
    color: var(--text);
  }
  .ws-card-badges {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .ws-card-author {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: .08em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .ws-card-kind {
    display: inline-block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: .06em;
    padding: 2px 6px;
    background: var(--accent-bg);
    color: var(--accent);
    border-radius: 6px;
    text-transform: uppercase;
    font-weight: 600;
  }
  .ws-card-desc {
    font-size: 12.5px;
    color: var(--text-dim);
    margin-top: 8px;
    line-height: 1.5;
  }
  .ws-card-footer {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--text-faint);
    margin-top: 10px;
  }
  .ws-routed {
    margin-top: 8px;
    border: 1px dashed var(--border-strong);
    background: transparent;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .ws-routed-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: var(--text-faint);
    margin-bottom: 4px;
  }
  .ws-routed-body {
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.4;
  }

  /* ============ Detail (Column 3) ============ */
  .ws-detail {
    background: var(--bg);
    overflow-y: auto;
    padding: 32px 40px 64px;
    min-height: 0;
  }
  .ws-detail-inner {
    max-width: 980px;
    margin: 0 auto;
    animation: wsIn 0.26s ease;
  }
  .ws-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 28px;
  }
  .ws-header-left { flex: 1; min-width: 0; }
  .ws-header-author {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    letter-spacing: .12em;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .ws-header-tags {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .ws-status-pill {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    padding: 4px 10px;
    border-radius: 20px;
    font-weight: 600;
  }
  .ws-id-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }
  .ws-fork-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--accent);
    background: var(--accent-bg);
    padding: 3px 8px;
    border-radius: 8px;
  }
  .ws-header-name {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-weight: 800;
    font-size: 28px;
    letter-spacing: -.02em;
    line-height: 1.15;
    margin: 4px 0 8px;
    color: var(--text);
  }
  .ws-header-desc {
    font-size: 15px;
    color: var(--text-dim);
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
    transition: transform .06s, box-shadow .12s, background .12s;
  }
  .ws-btn:active { transform: translateY(1px); }
  .ws-btn-discard {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    color: var(--text-dim);
  }
  .ws-btn-discard:hover { background: var(--surface-hover); color: var(--text); }
  .ws-btn-promote {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: #fff;
    padding: 9px 18px;
    box-shadow: 0 2px 6px rgba(47, 107, 255, .32);
  }
  .ws-btn-promote:hover { background: #2557d9; }
  .ws-btn-cancel {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-dim);
    padding: 8px 14px;
    font-size: 12px;
  }
  .ws-btn-discard-confirm {
    background: var(--surface);
    border: 1px solid var(--red);
    color: var(--red-fg);
    padding: 8px 14px;
    font-size: 12px;
  }
  .ws-btn-discard-confirm:hover { background: var(--red-bg); }
  .ws-btn-advance {
    background: var(--surface);
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 8px 14px;
    font-size: 12.5px;
    margin-top: 14px;
    font-weight: 600;
  }
  .ws-btn-advance:hover { background: var(--accent-bg); }
  .ws-btn-expand {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    color: var(--text-dim);
    padding: 4px 10px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    margin-left: 8px;
    font-family: inherit;
  }
  .ws-btn-expand:hover { background: var(--surface-hover); color: var(--text); }

  /* ============ Discard composer ============ */
  .ws-discard-composer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--red);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 20px;
    animation: wsIn 0.22s ease;
  }
  .ws-discard-prompt {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
  }
  .ws-discard-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 8px 12px;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 13px;
    color: var(--text);
    box-sizing: border-box;
  }
  .ws-discard-input::placeholder { color: var(--text-faint); }
  .ws-discard-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
  .ws-discard-helper {
    font-size: 11.5px;
    color: var(--text-faint);
    margin: 6px 0 10px;
  }
  .ws-discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* ============ Stepper ============ */
  .ws-stepper-card {
    background: var(--surface);
    border: 1px solid var(--border);
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
    font-weight: 700;
    border: 1px solid;
    font-family: 'JetBrains Mono', monospace;
  }
  .ws-stepper-label {
    font-size: 12.5px;
    font-weight: 600;
  }
  .ws-stepper-node--reached .ws-stepper-num {
    background: var(--accent-bg);
    color: var(--accent);
    border-color: var(--accent);
  }
  .ws-stepper-node--reached .ws-stepper-label { color: var(--accent); }
  .ws-stepper-node--testing .ws-stepper-num {
    background: var(--yellow-bg);
    color: var(--yellow-fg);
    border-color: var(--yellow);
  }
  .ws-stepper-node--testing .ws-stepper-label { color: var(--yellow-fg); }
  .ws-stepper-node--unreached .ws-stepper-num {
    background: var(--surface);
    color: var(--text-veryfaint);
    border-color: var(--border-strong);
  }
  .ws-stepper-node--unreached .ws-stepper-label { color: var(--text-veryfaint); }
  .ws-stepper-connector {
    width: 32px;
    height: 1.5px;
    background: var(--border-strong);
    display: inline-block;
  }
  .ws-stepper-connector--reached { background: var(--accent); }
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
    font-weight: 600;
  }
  .ws-pill-muted { background: var(--yellow-bg); color: var(--yellow-fg); }
  .ws-pill-active { background: var(--yellow); color: #fff; }
  .ws-stepper-caption {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 12px;
    line-height: 1.5;
  }

  /* ============ Body (Try + Why/Evidence) ============ */
  .ws-body {
    display: flex;
    gap: 28px;
    align-items: flex-start;
  }
  .ws-try { flex: 1.55; min-width: 0; }
  .ws-why { flex: 1; min-width: 0; }

  .ws-frame {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 1px 3px rgba(20,22,28,.04);
    overflow: hidden;
  }
  .ws-frame-head {
    background: var(--surface-hover);
    border-bottom: 1px solid var(--border);
    padding: 9px 13px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ws-frame-dots { display: flex; gap: 5px; }
  .ws-frame-dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .ws-frame-file {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--text-faint);
    margin-left: 6px;
  }
  .ws-frame-meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .ws-frame-body { min-height: 360px; background: #fff; }
  .ws-frame-iframe {
    width: 100%;
    height: 500px;
    border: 0;
    display: block;
    background: #fff;
  }
  .ws-frame-empty {
    padding: 24px 28px 28px;
    text-align: center;
  }
  .ws-frame-empty-hatched {
    height: 130px;
    background-image: repeating-linear-gradient(135deg, var(--surface2), var(--surface2) 9px, var(--bg) 9px, var(--bg) 18px);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
    margin-bottom: 18px;
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .ws-frame-empty-heading {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -.01em;
    color: var(--text);
    margin-bottom: 6px;
  }
  .ws-frame-empty-body {
    font-size: 13px;
    color: var(--text-dim);
    line-height: 1.55;
    max-width: 42ch;
    margin: 0 auto;
  }
  .ws-frame-promoted {
    padding: 22px 26px 26px;
    background: var(--green-bg);
    border: 1px solid var(--green-border);
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
    width: 24px; height: 24px;
    background: var(--green);
    color: #fff;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 700;
  }
  .ws-frame-promoted-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--green-fg);
  }
  .ws-frame-promoted-code {
    background: var(--surface);
    border: 1px solid var(--green-border);
    padding: 10px 14px;
    border-radius: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: var(--text);
    margin: 0 0 12px;
    white-space: pre-wrap;
  }
  .ws-frame-promoted-copy {
    font-size: 13px;
    color: var(--text-dim);
    line-height: 1.55;
  }
  .ws-frame-discarded {
    padding: 40px 30px;
    text-align: center;
    background: #fff;
  }
  .ws-frame-discarded-title {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -.01em;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .ws-frame-discarded-reason {
    font-size: 13.5px;
    color: var(--text);
    font-style: italic;
    max-width: 42ch;
    margin: 0 auto 12px;
    line-height: 1.5;
  }
  .ws-frame-discarded-mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }

  /* ============ Why / Evidence ============ */
  .ws-why-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 18px;
  }
  .ws-why-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .14em;
    color: var(--text-faint);
    margin-bottom: 8px;
  }
  .ws-why-body {
    font-size: 13.5px;
    color: var(--text);
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
    color: var(--text-faint);
  }
  .ws-evidence-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }
  .ws-evidence-list {
    border-left: 1.5px solid var(--border);
    margin-left: 4px;
    padding-left: 14px;
  }
  .ws-evidence-item {
    position: relative;
    padding: 8px 0;
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
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .ws-evidence-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: .08em;
    padding: 1px 6px;
    border-radius: 6px;
    font-weight: 600;
  }
  .ws-evidence-text {
    font-size: 12.5px;
    color: var(--text);
    line-height: 1.5;
  }
  .ws-evidence-more {
    padding: 8px 0 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }

  /* ============ Modal ============ */
  .ws-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20,22,28,.42);
    backdrop-filter: blur(3px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 30px;
    animation: wsIn 0.18s ease;
  }
  .ws-modal {
    max-width: 1080px;
    width: 100%;
    max-height: 88vh;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: 0 24px 70px rgba(0,0,0,.28);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ws-modal-head {
    background: var(--surface-hover);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 1px solid var(--border);
  }
  .ws-modal-title {
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -.01em;
    color: var(--text);
  }
  .ws-modal-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--text-faint);
  }
  .ws-modal-close {
    margin-left: auto;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    color: var(--text-dim);
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .ws-modal-close:hover { background: var(--surface-hover); color: var(--text); }
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
  .ws-modal--form {
    max-width: 620px;
  }
  .ws-create-body {
    padding: 24px 28px 8px;
    background: var(--surface);
  }
  .ws-create-lede {
    font-size: 13.5px;
    color: var(--text-dim);
    line-height: 1.55;
    margin-bottom: 22px;
  }
  .ws-form-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 18px;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .ws-form-optional {
    font-weight: 400;
    color: var(--text-faint);
  }
  .ws-form-input, .ws-form-textarea {
    width: 100%;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 400;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--text);
    box-sizing: border-box;
    resize: vertical;
  }
  .ws-form-input::placeholder, .ws-form-textarea::placeholder { color: var(--text-veryfaint); }
  .ws-form-input:focus, .ws-form-textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }
  .ws-form-textarea {
    min-height: 76px;
    line-height: 1.5;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
  }
  .ws-modal-foot {
    padding: 16px 28px 22px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  /* ============ Toast ============ */
  .ws-toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: #fff;
    font-family: 'Hanken Grotesk', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 11px 18px;
    border-radius: 11px;
    box-shadow: 0 8px 28px rgba(20,22,28,.28);
    z-index: 10000;
    animation: wsIn 0.2s ease;
  }
`;
