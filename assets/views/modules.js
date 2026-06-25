// Modules view — top-level route (moved out of Settings per v0.7 IA).
//
// 2-col gallery of high-level modules. Each card: icon + name + mono tag +
// PREVIEW badge + blurb + Preview button + Request button (flips to Requested).
// Footer "Suggest a module" CTA.
//
// Request state persisted in localStorage so it survives page reloads (v0.8
// will persist to substrate so it's cross-device).

// (No imports needed for the empty-state version — kept minimal until
// real modules + preview overlay re-introduce them.)

// No formal modules installed yet (per substrate). The 4 speculative cards
// I authored earlier (Finance / Stakeholders / Briefings / Concepts) were
// stripped — they were dummy data, not real modules.
//
// When real modules ship (per docs/system/MODULES.md spec), they'll load
// from substrate (`modules/*/module.json` manifests) and render as cards
// here. For now: honest cactus state.

// First real installed module: Finance (GEN-127 skeleton + GEN-136 Settings).
// Hard-coded for v1 since the module loader (GEN-113) ships later. When the
// loader lands, this list comes from a manifest scan instead.
const INSTALLED_MODULES = [
  {
    id: 'finance',
    name: 'Finance',
    tag: 'connector + surface',
    blurb: 'Cash-flow monitoring + investor view on Moneybird. Read-only on bookkeeping; writes only to its own recommendation feed.',
    settingsRoute: 'module-finance-settings',
    primaryRoute: 'budget',
  },
];

export function renderModules(ctx) {
  const root = document.getElementById('route-modules');
  root.innerHTML = `
    <div class="card">
      <div class="card-section-label">Installed modules</div>
      <p class="card-sub" style="margin-bottom:10px">Modules with a <code>module.json</code> manifest in the dashboard repo. The formal loader (GEN-113) ships next; today these are wired directly.</p>
      <div class="row-list">
        ${INSTALLED_MODULES.map(renderInstalledModuleRow).join('')}
      </div>
    </div>

    <div class="suggest-module-row" data-soon="true" title="Module suggestion intake ships in v0.8">
      <span class="suggest-module-plus">+</span>
      <div class="suggest-module-body">
        <div class="suggest-module-title">Want a module not on the roadmap?<span class="soon-tag">soon</span></div>
        <div class="suggest-module-sub">Suggestion intake ships in v0.8. For now, mention it in a memo — Stewart will surface it.</div>
      </div>
      <button type="button" class="suggest-module-btn" disabled>Suggest a module</button>
    </div>
  `;
}

function renderInstalledModuleRow(m) {
  return `
    <div class="row-with-icon module-row">
      <span class="row-icon-letter">${m.name.charAt(0)}</span>
      <div class="row-body">
        <div class="row-title">${m.name}</div>
        <div class="row-sub">${m.blurb}</div>
      </div>
      <span class="row-tag-accent mono">${m.tag}</span>
      <div class="module-row-actions">
        <a href="#${m.primaryRoute}" class="module-row-link">Open</a>
        <a href="#${m.settingsRoute}" class="module-row-link module-row-link-settings">Settings</a>
      </div>
    </div>
  `;
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
