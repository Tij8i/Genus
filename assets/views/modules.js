// Modules view — top-level route (moved out of Settings per v0.7 IA).
//
// 2-col gallery of high-level modules. Each card: icon + name + mono tag +
// PREVIEW badge + blurb + Preview button + Request button (flips to Requested).
// Footer "Suggest a module" CTA.
//
// Request state persisted in localStorage so it survives page reloads (v0.8
// will persist to substrate so it's cross-device).

import { escapeHtml } from '../utils.js';
import { openOverlay, closeOverlay } from '../overlay.js';

const REQUEST_KEY = 'genus.module_requests.v1';

// Catalog of high-level modules. These are aspirational "ideal modules" the
// dashboard would surface, not actual installed code. Operator clicks Request
// to signal demand → we'll prioritize building them.
const MODULES = [
  {
    id: 'finance',
    name: 'Finance',
    tag: 'Money in / out',
    iconHtml: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    blurb: 'One panel for MRR, runway, burn, and unit economics — sourced from your accounting tool of choice (Stripe, QuickBooks, Brex). Not an accounting product. A read view + budget gates that Stewart respects.',
    preview: 'Connect Stripe + QuickBooks + Brex. Genus consolidates into a single Finance panel with MRR, ARR, runway, burn rate, AR/AP. Budget caps per agent enforced at the runtime layer. Investor-readable monthly snapshot.',
  },
  {
    id: 'stakeholders',
    name: 'Stakeholders',
    tag: 'Investors · advisors · users',
    iconHtml: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    blurb: 'A CRM-shaped view sized for the founder: who knows what, who got which update, who needs a reply. Wraps your existing email + Notion + spreadsheet — does not replace them.',
    preview: 'Pull contacts from Google Workspace + last-touch dates. Tag by role (investor, advisor, beta user, partner). Stewart drafts cadence reminders + summary updates. Operator approves before sending.',
  },
  {
    id: 'briefings',
    name: 'Briefings',
    tag: 'Decks · memos · narratives',
    iconHtml: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
    blurb: 'Every venture has 5–10 living docs — vision, brand, positioning, monthly update. This module keeps them current, asks for edits when they go stale, and renders them as decks on demand.',
    preview: 'Pin canonical docs from Drive. Stewart watches for staleness (e.g., position statement last edited 60 days ago, vision metrics out of date). One-click "render this as a deck" with your brand kit.',
  },
  {
    id: 'concepts',
    name: 'Concepts',
    tag: 'Vocabulary the venture invents',
    iconHtml: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 5.5 1.5c0 2-3 3-3 3M12 17v.01"/></svg>',
    blurb: 'Every team coins terms — TUT-NS1, "the cockpit", "Unified Picture". Concepts captures + defines them so the language stays consistent across agents + docs + new hires.',
    preview: 'Auto-extract proper nouns + acronyms from your substrate. Operator confirms or edits a definition. Agents check this glossary before generating any external-facing copy.',
  },
];

export function renderModules(ctx) {
  const root = document.getElementById('route-modules');
  const requests = loadRequests();
  root.innerHTML = `
    <div class="modules-grid">
      ${MODULES.map(m => renderModuleCard(m, requests[m.id])).join('')}
    </div>
    <div class="suggest-module-row">
      <span class="suggest-module-plus">+</span>
      <div class="suggest-module-body">
        <div class="suggest-module-title">Need something else?</div>
        <div class="suggest-module-sub">Tell us what would make this your single control panel. New modules ship regularly.</div>
      </div>
      <button type="button" class="suggest-module-btn" id="suggest-module-btn">Suggest a module</button>
    </div>
  `;
  root.querySelectorAll('.module-card-preview-btn').forEach(b => {
    b.addEventListener('click', () => openModulePreview(b.dataset.modId));
  });
  root.querySelectorAll('.module-card-request-btn').forEach(b => {
    b.addEventListener('click', () => requestModule(b.dataset.modId, ctx));
  });
  document.getElementById('suggest-module-btn').addEventListener('click', () => {
    const idea = window.prompt('What module would you like? One-line description:');
    if (idea && idea.trim()) {
      alert(`Got it. We'll consider «${idea.trim()}» for the next release. (Full request-tracking ships v0.8.)`);
    }
  });
}

function renderModuleCard(m, requested) {
  return `
    <div class="module-card">
      <div class="module-card-head">
        <span class="module-card-icon">${m.iconHtml}</span>
        <div class="module-card-titles">
          <div class="module-card-name">${escapeHtml(m.name)}</div>
          <div class="module-card-tag mono">${escapeHtml(m.tag)}</div>
        </div>
        <span class="module-card-badge mono">PREVIEW</span>
      </div>
      <p class="module-card-blurb">${escapeHtml(m.blurb)}</p>
      <div class="module-card-actions">
        <button type="button" class="module-card-preview-btn" data-mod-id="${escapeHtml(m.id)}">Preview</button>
        ${requested
          ? `<div class="module-card-requested">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>
              Requested · we'll be in touch
            </div>`
          : `<button type="button" class="module-card-request-btn" data-mod-id="${escapeHtml(m.id)}">Request this module</button>`}
      </div>
    </div>
  `;
}

function openModulePreview(modId) {
  const m = MODULES.find(x => x.id === modId);
  if (!m) return;
  const requests = loadRequests();
  const requested = !!requests[modId];
  openOverlay({
    title: m.name,
    subtitle: m.tag,
    iconHtml: m.iconHtml,
    iconTint: 'var(--accent)',
    bodyHtml: `
      <p class="module-preview-blurb">${escapeHtml(m.blurb)}</p>
      <div class="module-preview-section-label mono">What you'd get</div>
      <p class="module-preview-detail">${escapeHtml(m.preview)}</p>
    `,
    footerHtml: requested
      ? `<div class="module-card-requested">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>
          Requested
        </div>`
      : `<button type="button" class="module-card-request-btn" id="overlay-request-btn">Request this module</button>`,
  });
  const overlayBtn = document.getElementById('overlay-request-btn');
  if (overlayBtn) {
    overlayBtn.addEventListener('click', () => { requestModule(modId); closeOverlay(); });
  }
}

function requestModule(modId, ctx) {
  const requests = loadRequests();
  requests[modId] = { requested_at: new Date().toISOString() };
  saveRequests(requests);
  // Re-render the page
  if (ctx) renderModules(ctx);
  else renderModules({});
}

function loadRequests() {
  try { return JSON.parse(localStorage.getItem(REQUEST_KEY) || '{}'); }
  catch { return {}; }
}
function saveRequests(r) {
  try { localStorage.setItem(REQUEST_KEY, JSON.stringify(r)); }
  catch { /* quota / disabled */ }
}
