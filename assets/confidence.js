// Genus shell ConfidenceFrame v1 renderer (GEN-110).
//
// Implements the four protocol-level UI affordances reserved by
// CONFIDENCE_FRAME.md §5 — `badge` / `hover` / `hidden` / `blocking` — so every
// module/view renders confidence uniformly. The shell owns the visual
// treatment; modules supply the wire payload.
//
// Public surface:
//   normalizeConfidence(claim)   — compact ↔ structured normalisation
//   pickAffordance(normalized, surface) — policy-mode → affordance kind
//   renderClaim(claim, surface, opts)   — full HTML for a claim cell
//
// Conformance notes:
//   - Compact form `{value, confidence:"low"}` is treated as equivalent to
//     `{value, confidence:{overall:"low", layers:null, concerns:[]}}` per §7.
//   - Malformed payloads degrade to `unknown` and emit a console warning.
//   - Layer vocabulary (L1/L2/L3, mental_model, data_grounding, coherence)
//     is dropped on the operator surface per §5 closing rule.
//   - Policy mode is read from the surface descriptor (view spec) — never
//     from the claim payload.

import { escapeHtml } from './utils.js';

const VALID_LEVELS = ['high', 'medium', 'low', 'unknown'];
const VALID_ACTION_KINDS = ['operator-confirm', 'connect-source', 'audit-data', 'recategorize', 'dismiss', 'custom'];
const VALID_POLICY_MODES = ['silent', 'warn', 'block'];
const VALID_AFFORDANCE_HINTS = ['badge', 'hidden', 'blocking'];

export function normalizeConfidence(claim) {
  if (!claim || typeof claim !== 'object') {
    warn('claim payload missing or not an object', claim);
    return baseStructured('unknown');
  }
  const raw = claim.confidence;
  if (raw == null) {
    warn('claim missing confidence field, treating as unknown', claim);
    return baseStructured('unknown');
  }
  if (typeof raw === 'string') {
    if (!VALID_LEVELS.includes(raw)) {
      warn('invalid compact confidence level, treating as unknown', raw);
      return baseStructured('unknown');
    }
    return baseStructured(raw);
  }
  if (typeof raw === 'object') {
    const overall = VALID_LEVELS.includes(raw.overall) ? raw.overall : null;
    if (overall == null) {
      warn('structured confidence missing valid overall, treating as unknown', raw);
      return baseStructured('unknown');
    }
    const concerns = Array.isArray(raw.concerns)
      ? raw.concerns
          .filter((c) => c && typeof c.summary === 'string')
          .map((c) => ({
            summary: c.summary,
            action: validateAction(c.action),
          }))
      : [];
    return { overall, concerns };
  }
  warn('malformed confidence payload, treating as unknown', raw);
  return baseStructured('unknown');
}

function baseStructured(level) {
  return { overall: level, concerns: [] };
}

function validateAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (!VALID_ACTION_KINDS.includes(action.kind)) return null;
  return {
    label: typeof action.label === 'string' ? action.label : 'Take action',
    kind: action.kind,
    href: typeof action.href === 'string' ? action.href : null,
  };
}

function warn(msg, payload) {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[genus-confidence] ${msg}`, payload);
  }
}

// pickAffordance — surface policy + claim level → affordance choice.
// Surface descriptor: { mode: 'silent'|'warn'|'block', claimAffordance?: 'badge'|'hidden'|'blocking' }
// claimAffordance is the per-claim hint used in `block` mode (§5/§6) to pick
// between `hidden` and `blocking`. It is also accepted in `warn`/`silent` for
// future-proofing but has no effect on those modes.
export function pickAffordance(normalized, surface) {
  const overall = normalized?.overall || 'unknown';
  const mode = VALID_POLICY_MODES.includes(surface?.mode) ? surface.mode : 'silent';
  const hint = VALID_AFFORDANCE_HINTS.includes(surface?.claimAffordance) ? surface.claimAffordance : null;

  if (mode === 'silent') {
    if (overall === 'low' || overall === 'unknown') return { kind: 'badge', tone: overall };
    return { kind: 'none' };
  }
  if (mode === 'warn') {
    if (overall === 'low' || overall === 'unknown') return { kind: 'badge', tone: overall, alert: true };
    if (overall === 'medium') return { kind: 'badge', tone: 'medium' };
    return { kind: 'none' };
  }
  if (mode === 'block') {
    if (overall === 'low' || overall === 'unknown') {
      if (hint === 'blocking') return { kind: 'blocking', tone: overall };
      return { kind: 'hidden', tone: overall };
    }
    if (overall === 'medium') return { kind: 'badge', tone: 'medium' };
    return { kind: 'none' };
  }
  return { kind: 'none' };
}

// renderClaim — primary entry point for view modules.
// claim:    wire-format payload (compact or structured).
// surface:  { mode, claimAffordance? }
// opts:     { formatValue?: (v)=>string, placeholder?: string }
export function renderClaim(claim, surface, opts = {}) {
  const normalized = normalizeConfidence(claim);
  const affordance = pickAffordance(normalized, surface);
  const valueHtml = formatValue(claim?.value, opts.formatValue);

  if (affordance.kind === 'hidden') return renderHiddenPlaceholder(opts.placeholder);
  if (affordance.kind === 'blocking') return renderBlocking(valueHtml, normalized);
  if (affordance.kind === 'badge') return renderValueWithBadge(valueHtml, normalized, affordance);
  return `<span class="claim-value">${valueHtml}</span>`;
}

function formatValue(value, formatter) {
  if (typeof formatter === 'function') {
    try {
      return escapeHtml(formatter(value));
    } catch {
      return escapeHtml(value == null ? '—' : String(value));
    }
  }
  return escapeHtml(value == null ? '—' : String(value));
}

function renderHiddenPlaceholder(placeholder) {
  const label = placeholder || 'unavailable';
  return `<span class="claim-hidden" data-confidence-affordance="hidden" title="This figure isn't surfaced — confidence too low for this view.">${escapeHtml(label)}</span>`;
}

function renderValueWithBadge(valueHtml, normalized, affordance) {
  const toneCls = affordance.tone === 'medium' ? 'claim-badge--medium' : 'claim-badge--low';
  const alertCls = affordance.alert ? ' claim-badge--alert' : '';
  return `<span class="claim-with-badge">
    <span class="claim-value">${valueHtml}</span>
    <button type="button" class="claim-badge ${toneCls}${alertCls}" data-confidence-affordance="badge" aria-haspopup="true" aria-label="Why this might be wrong" tabindex="0">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 1.5 21h21z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>
    </button>
    ${renderHover(normalized)}
  </span>`;
}

function renderHover(normalized) {
  const concerns = (normalized && normalized.concerns) || [];
  if (concerns.length === 0) {
    const fallback = normalized?.overall === 'unknown'
      ? "This figure can't be evaluated yet — the agent doesn't have enough underlying data to back it."
      : 'This figure is uncertain — the agent flagged it but did not attach a specific reason.';
    return `<span class="claim-hover" role="tooltip" data-confidence-affordance="hover">
      <span class="claim-hover-summary">${escapeHtml(fallback)}</span>
    </span>`;
  }
  const items = concerns.slice(0, 3).map((c) => {
    const summary = stripLayerVocab(c.summary);
    const action = c.action ? renderAction(c.action) : '';
    return `<li class="claim-hover-item">
      <span class="claim-hover-item-summary">${escapeHtml(summary)}</span>
      ${action}
    </li>`;
  }).join('');
  return `<span class="claim-hover" role="tooltip" data-confidence-affordance="hover">
    <ul class="claim-hover-list">${items}</ul>
  </span>`;
}

function renderAction(action) {
  const tag = action.href ? 'a' : 'button';
  const hrefAttr = action.href ? ` href="${escapeHtml(action.href)}"` : '';
  const typeAttr = action.href ? '' : ' type="button"';
  return `<${tag} class="claim-hover-action" data-action-kind="${escapeHtml(action.kind)}"${hrefAttr}${typeAttr}>${escapeHtml(action.label)}</${tag}>`;
}

function renderBlocking(valueHtml, normalized) {
  const concern = (normalized && normalized.concerns && normalized.concerns[0]) || null;
  const summary = concern
    ? stripLayerVocab(concern.summary)
    : 'This is too uncertain to act on yet — review the figure before continuing.';
  const action = concern && concern.action ? renderAction(concern.action) : '';
  return `<span class="claim-blocking" data-confidence-affordance="blocking">
    <span class="claim-value claim-value--disabled" aria-disabled="true">${valueHtml}</span>
    <span class="claim-blocking-explain">
      <span class="claim-blocking-summary">${escapeHtml(summary)}</span>
      ${action}
    </span>
  </span>`;
}

// stripLayerVocab — defence in depth. Per CONFIDENCE_FRAME.md §5 the layer
// vocabulary is an internal contract; if a module's `summary` text leaks one
// of those tokens we substitute operator-language rather than render it.
function stripLayerVocab(summary) {
  if (typeof summary !== 'string') return '';
  return summary
    .replace(/\bL[123]\b/g, 'this check')
    .replace(/mental[_-]model/gi, 'what should exist')
    .replace(/data[_-]grounding/gi, 'underlying data')
    .replace(/\bcoherence\b/gi, 'pattern check');
}
