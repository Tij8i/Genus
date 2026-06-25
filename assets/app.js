// Genus v0.6 dashboard — main app module
//
// Boot sequence:
//   1. Pick a BU (v1: hardcoded 'tuto' per [[stewart-mason-dashboard-split]])
//   2. Fetch substrate files in parallel from /api/substrate
//   3. Wire hash router → show/hide route sections
//   4. Render each route (step 2a: stubs that prove substrate is loaded;
//      step 2b+ fills in the real renderers)
//
// Architecture per [[v06-mockup-interpretation]]:
//   - Visual style + IA come from the v0.6 mockup
//   - Data model + concepts stay as we have them (Initiative states, Stewart
//     vs Mason, tier system, milestones, etc.)
//   - safeRender wraps each renderer so one failure doesn't break the rest

import {
  fetchSubstrate,
  fetchSubstrateJson,
  fetchSubstrateJsonl,
  substrateBase,
} from './substrate-client.js';
import { initRouter, onRouteChange } from './router.js';
import { renderDashboard as renderDashboardView } from './views/dashboard.js';
import { renderInputs as renderInputsView } from './views/inputs.js';
import { renderPlanning as renderPlanningView } from './views/planning.js';
import { renderKpis as renderKpisView } from './views/kpis.js';
import { renderOutputs as renderOutputsView } from './views/outputs.js';
import { renderSettings as renderSettingsView } from './views/settings.js';
import { renderLearning as renderLearningView } from './views/learning.js';
import { renderModules as renderModulesView } from './views/modules.js';
import { renderPeople as renderPeopleView } from './views/people.js';
// Finance views migrated to the Finance Module folder (GEN-127). When the
// module loader (GEN-113) ships, these direct imports are replaced by dynamic
// resolution via `modules/finance/module.json` → `views.dashboard[*].component_ref`.
import { renderBudget as renderBudgetView } from '../modules/finance/views/budget.js';
import { renderCosts as renderCostsView } from '../modules/finance/views/costs.js';
import { renderInvoices as renderInvoicesView } from '../modules/finance/views/invoices.js';
import { openOnboarding } from './overlay.js';
import { applyAppearance } from './appearance.js';

// Sidebar nav groups (FINANCE / STRATEGY / OPERATIONS) collapse state.
// Three independent booleans, default-open, persisted to localStorage so the
// operator's choice survives a reload. Per GEN-99.
const NAV_GROUPS_LS_KEY = 'genus.nav.groups.v1';
function loadNavGroupsState() {
  try {
    const raw = localStorage.getItem(NAV_GROUPS_LS_KEY);
    if (!raw) return { finance: true, strategy: true, operations: true };
    const parsed = JSON.parse(raw);
    return {
      finance: parsed.finance !== false,
      strategy: parsed.strategy !== false,
      operations: parsed.operations !== false,
    };
  } catch {
    return { finance: true, strategy: true, operations: true };
  }
}
function saveNavGroupsState(state) {
  try { localStorage.setItem(NAV_GROUPS_LS_KEY, JSON.stringify(state)); } catch {}
}
function applyNavGroupState(name, open) {
  const el = document.querySelector(`.nav-group[data-group="${name}"]`);
  if (!el) return;
  el.classList.toggle('nav-group--collapsed', !open);
  const btn = el.querySelector('.nav-group-label');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function wireNavGroups() {
  const state = loadNavGroupsState();
  for (const k of ['finance', 'strategy', 'operations']) applyNavGroupState(k, state[k]);
  document.querySelectorAll('.nav-group-label').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.groupToggle;
      if (!name) return;
      state[name] = !state[name];
      applyNavGroupState(name, state[name]);
      saveNavGroupsState(state);
    });
  });
}

// v1: hardcoded BU. Multi-BU switcher slot exists in the sidebar but only
// one BU is wired today (Tuto on Genus-native substrate). Per [[v06-mockup-interpretation]]
// + decision 5 in the migration plan, others appear as they migrate.
const BU = 'tuto';

// Viewer = logged-in user identity resolved from CF Access JWT + roles.json.
// Per GEN-107: { email, role: 'admin'|'observer'|'unknown'|'unauthenticated',
// ventures: ['*' | bu...], display_name?, title?, dev_fallback? }.
// Populated at boot from /api/identity, then passed through to every view via
// the render ctx so write actions can gate on viewer.role.
let viewer = null;
function viewerIsAdmin() { return viewer && viewer.role === 'admin'; }

// Preview-as override: an admin can append ?viewAs=observer (or unknown /
// unauthenticated) to the URL to simulate that role end-to-end. We persist
// the choice in sessionStorage so it survives route navigation, and we
// monkey-patch window.fetch to add an `x-genus-view-as` header to every
// request — _identity.js honors the header server-side, so the dashboard,
// /api/identity, and the write Pages Functions all see the same downgraded
// role. Only admins can use it (non-admins are ignored server-side); this
// is one-way de-escalation, never an upgrade.
const VIEW_AS_STORAGE_KEY = 'genus.viewAs.v1';
const VALID_PREVIEW_ROLES = new Set(['observer', 'unknown', 'unauthenticated']);
function readPreviewAsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('viewAs');
  if (raw === null) return undefined; // no preference expressed
  const normalized = raw.trim().toLowerCase();
  if (normalized === '' || normalized === 'off' || normalized === 'admin') return null; // explicit clear
  return VALID_PREVIEW_ROLES.has(normalized) ? normalized : null;
}
function currentPreviewAs() {
  try { return sessionStorage.getItem(VIEW_AS_STORAGE_KEY) || null; }
  catch { return null; }
}
function setPreviewAs(value) {
  try {
    if (value) sessionStorage.setItem(VIEW_AS_STORAGE_KEY, value);
    else sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
  } catch { /* sessionStorage unavailable — silently degrade */ }
}
function applyUrlPreviewAs() {
  const fromUrl = readPreviewAsFromUrl();
  if (fromUrl === undefined) return;          // ?viewAs not present
  if (fromUrl === null) setPreviewAs(null);   // explicit clear
  else setPreviewAs(fromUrl);                 // set / replace
}
function installFetchViewAsHeader() {
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const preview = currentPreviewAs();
    if (!preview) return origFetch(input, init);
    const opts = init ? { ...init } : {};
    const headers = new Headers(opts.headers || (typeof input === 'object' && input && input.headers) || {});
    headers.set('x-genus-view-as', preview);
    opts.headers = headers;
    return origFetch(input, opts);
  };
}

// Fetch /api/identity. On any failure, fall back to a synthetic anonymous
// viewer so the dashboard still renders (read-only) rather than white-screening.
async function fetchViewer() {
  try {
    const resp = await fetch('/api/identity', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok || !json.viewer) throw new Error(json.message || 'malformed response');
    return json.viewer;
  } catch (e) {
    console.warn('[genus] identity fetch failed, falling back to anonymous viewer:', e.message || e);
    return { email: null, role: 'unauthenticated', ventures: [], display_name: 'Unknown', title: 'Not signed in' };
  }
}

// Show a transient "Observer mode — read-only" toast at the bottom of the
// viewport. Used by the capture-phase click gate below when a non-admin
// clicks a write-action button.
let observerToastTimer = null;
function showObserverToast(msg) {
  let el = document.getElementById('observer-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'observer-toast';
    el.className = 'observer-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg || 'Observer mode — read-only';
  // Re-trigger transition
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add('is-visible');
  if (observerToastTimer) clearTimeout(observerToastTimer);
  observerToastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

// Selectors that mark "this click mutates state." Capture-phase handler below
// short-circuits clicks on these when viewer.role !== 'admin'. Keep this in
// sync with the same selector list in app.css so visuals and logic agree.
const WRITE_ACTION_SELECTORS = [
  '[data-write-action]',
  '.primary-btn-pill:not(.btn-soon):not([disabled])',
  '.kpi-log-btn',
  '.approve-btn',
  '.reject-btn',
].join(',');

// Install a single document-level capture-phase click listener that gates
// every write-action click for non-admin viewers. Capture phase + stopPropagation
// means view-level handlers never see the event — no per-view changes needed.
function installObserverClickGate() {
  document.addEventListener('click', (e) => {
    if (viewerIsAdmin()) return;
    const target = e.target instanceof Element ? e.target.closest(WRITE_ACTION_SELECTORS) : null;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    showObserverToast(viewer && viewer.role === 'unknown'
      ? 'No access — your email is not in roles.json'
      : 'Observer mode — read-only');
  }, true); // capture: true so we run before any view handler
}

// Apply body classes + render the operator chip based on the resolved viewer.
// Triggers CSS that dims action buttons when viewer.role !== 'admin'.
function applyViewerToShell(v) {
  if (!v) return;
  document.body.classList.toggle('viewer-observer', v.role === 'observer');
  document.body.classList.toggle('viewer-unauthenticated', v.role === 'unauthenticated');
  document.body.classList.toggle('viewer-unknown', v.role === 'unknown');
  document.body.classList.toggle('viewer-admin', v.role === 'admin');
  document.body.classList.toggle('viewer-dev-fallback', !!v.dev_fallback);

  // Operator chip bottom-left of sidebar — was hardcoded "Alessio Tixi /
  // Founder · Operator" pre-GEN-107. Now reflects the actual signed-in user.
  const chip = document.querySelector('.operator-chip');
  if (chip) {
    const display = v.display_name || v.email || 'Unknown';
    const initial = (display.charAt(0) || '?').toUpperCase();
    const rolePill = v.role === 'admin'
      ? '<span class="role-pill role-pill--admin">Admin</span>'
      : v.role === 'observer'
      ? '<span class="role-pill role-pill--observer">Observer</span>'
      : v.role === 'unknown'
      ? '<span class="role-pill role-pill--unknown">No access</span>'
      : '<span class="role-pill role-pill--unauth">Not signed in</span>';
    chip.innerHTML = `
      <span class="operator-avatar">${initial}</span>
      <span class="operator-label">
        <span class="operator-name">${display}</span>
        <span class="operator-role">${v.email ? v.email + ' · ' : ''}${v.title || ''} ${rolePill}</span>
      </span>
    `;
  }

  // Observer banner — single line at top of main, only visible when role
  // isn't admin. Keeps the operator-mental-model honest: "you're in read-only
  // mode, write attempts will be rejected."
  const existing = document.getElementById('observer-banner');
  if (v.role !== 'admin') {
    const previewSuffix = v.preview_as
      ? ` <a href="?viewAs=off" class="observer-banner-exit">Exit preview ←</a>`
      : '';
    const previewPrefix = v.preview_as
      ? `<strong>Preview-as-${v.preview_as}</strong> (you're actually admin · ${v.actual_email || '—'}) — `
      : '';
    const msg = v.role === 'observer'
      ? `${previewPrefix}Observer mode — read-only. Write actions are disabled${v.preview_as ? '' : ` (${v.email || '—'})`}.${previewSuffix}`
      : v.role === 'unknown'
      ? `${previewPrefix}${v.email || 'You'} ${v.preview_as ? 'would be' : 'are'} signed in but not in roles.json — contact the operator for access.${previewSuffix}`
      : `${previewPrefix}Not signed in — Cloudflare Access header missing. Local-dev fallback is showing the first admin's view; mutations will fail.${previewSuffix}`;
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'observer-banner';
      banner.className = 'observer-banner';
      banner.innerHTML = msg;
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      existing.innerHTML = msg;
    }
  } else if (existing) {
    existing.remove();
  }
}

// Module-level state, populated at boot.
let identity = null;
let goals = [];
let initiatives = [];
let plans = [];
let tasks = [];
let meetings = [];
let memos = [];
let kpis = [];
let measurementsByKpi = {};
let governance = {};
let connectors = [];
let documentation = [];

// ============ Boot ============

function bootError(msg) {
  const banner = document.createElement('div');
  banner.className = 'boot-error';
  banner.textContent = `Boot error: ${msg}`;
  document.body.appendChild(banner);
  console.error('[genus] boot error:', msg);
}

const safeRender = (label, fn) => {
  try { fn(); } catch (e) { console.error(`[genus] ${label} render failed:`, e); }
};

async function boot() {
  // Apply saved appearance prefs (accent + density) before any render
  applyAppearance();

  // Wire sidebar nav-group collapse (GEN-99) BEFORE substrate fetch so the
  // sidebar still toggles even if substrate is unreachable (e.g. local file
  // serve without Pages Functions, or auth failure).
  wireNavGroups();

  // Wire preview-as override BEFORE the identity fetch so the very first
  // /api/identity call already carries the x-genus-view-as header. Otherwise
  // boot would briefly render admin UI then flicker to observer.
  applyUrlPreviewAs();
  installFetchViewAsHeader();

  // Resolve viewer identity (CF Access email → roles.json lookup) in parallel
  // with the substrate fetch. Done early so the operator chip + observer
  // banner + body class are correct before any render runs. Per GEN-107.
  const viewerPromise = fetchViewer();

  // Fire all substrate reads in parallel — Pages Functions handle cross-repo
  // GitHub reads via the GITHUB_PAT env var.
  const baseRel = (file) => `${substrateBase(BU)}/${file}`;
  let results;
  try {
    results = await Promise.all([
      fetchSubstrateJson(baseRel('identity.json')),
      fetchSubstrateJson(baseRel('goals.json'), []),
      fetchSubstrateJson(baseRel('initiatives.json'), []),
      fetchSubstrateJson(baseRel('plans.json'), []),
      fetchSubstrateJson(baseRel('tasks.json'), []),
      fetchSubstrateJson(baseRel('meetings.json'), []),
      fetchSubstrateJsonl(baseRel('memos.jsonl')),
      fetchSubstrateJson(baseRel('kpis.json'), []),
      fetchSubstrateJson(baseRel('governance.json'), {}),
      fetchSubstrateJson(baseRel('connectors.json'), []),
      fetchSubstrateJson(baseRel('documentation.json'), []),
    ]);
  } catch (e) {
    // Substrate unreachable (e.g. preview deploy missing GITHUB_PAT, or local
    // file serve with no Pages Functions). Show the banner so it's obvious
    // something is wrong, but keep booting with empty defaults so the sidebar
    // + router + routes that don't depend on substrate (Budget, Costs,
    // Invoices) still render. Per GEN-99 verification needs.
    bootError(e.message || String(e));
    results = [null, [], [], [], [], [], [], [], {}, [], []];
  }
  [identity, goals, initiatives, plans, tasks, meetings, memos, kpis, governance, connectors, documentation] = results;

  // Resolve viewer and reflect it in the shell (operator chip + body class +
  // observer banner) before any route renders so views see the correct ctx.
  viewer = await viewerPromise;
  applyViewerToShell(viewer);
  installObserverClickGate();

  // Hydrate per-KPI measurement series (GEN-48). Each KPI has its own
  // measurements/<kpi_id>.jsonl; many will 404 (no captures yet) which
  // fetchSubstrateJsonl turns into [] without throwing. Run in parallel so
  // boot still finishes in a single round-trip wait.
  await Promise.all((kpis || []).map(async (k) => {
    if (!k || !k.id) return;
    const rows = await fetchSubstrateJsonl(baseRel(`measurements/${k.id}.jsonl`));
    measurementsByKpi[k.id] = rows;
  }));

  // Sidebar BU name from identity
  const buName = document.getElementById('bu-name');
  const buAvatar = document.getElementById('bu-avatar');
  const buMeta = document.getElementById('bu-meta');
  if (buName) buName.textContent = identity?.name || BU;
  if (buAvatar) buAvatar.textContent = (identity?.name || BU).charAt(0).toUpperCase();
  if (buMeta) buMeta.textContent = `${identity?.category || 'BU'} · v0.7`;

  // Workspace switcher dropdown
  const wsBtn = document.getElementById('bu-switcher');
  const wsMenu = document.getElementById('ws-menu');
  if (wsBtn && wsMenu) {
    wsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !wsMenu.hidden;
      if (isOpen) {
        wsMenu.hidden = true;
        wsBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      wsMenu.innerHTML = renderWsMenu(identity);
      wsMenu.hidden = false;
      wsBtn.setAttribute('aria-expanded', 'true');
      // Add-a-* actions are disabled (v0.8) — their disabled attribute
      // blocks clicks. Manage-people still navigates.
      wsMenu.querySelector('[data-action="manage-people"]')?.addEventListener('click', () => { wsMenu.hidden = true; window.location.hash = '#people'; });
      // Click outside to close
      setTimeout(() => {
        document.addEventListener('click', function closeOnce() {
          wsMenu.hidden = true;
          wsBtn.setAttribute('aria-expanded', 'false');
          document.removeEventListener('click', closeOnce);
        });
      }, 0);
    });
  }

  // Inputs badge: how many things need operator attention?
  // For v1, count pending meeting requests + awaiting_approval tasks.
  const pendingMeetingReqs = (meetings || []).filter(m => m.status === 'requested_by_agent').length;
  const awaitingApprovalTasks = (tasks || []).filter(t => t.status === 'awaiting_approval').length;
  const inputsBadgeCount = pendingMeetingReqs + awaitingApprovalTasks;
  const inputsBadge = document.getElementById('nav-inputs-badge');
  if (inputsBadge) {
    if (inputsBadgeCount > 0) {
      inputsBadge.textContent = inputsBadgeCount;
      inputsBadge.hidden = false;
    } else {
      inputsBadge.hidden = true;
    }
  }

  // Wire router. Register the callback BEFORE initRouter — initRouter fires
  // the initial handle() synchronously, and if the cb isn't registered yet
  // that first render is dropped to the default no-op. Bug: GEN-16.
  onRouteChange(route => renderRoute(route));
  initRouter('dashboard');
}

// ============ Routes ============

const TODO_PLACEHOLDER = (label, pointer) => `
  <div class="todo-placeholder">
    <strong>${label}</strong> — step 2b+ wiring.<br>
    <span class="mono">${pointer}</span>
  </div>
`;

function renderRoute(route) {
  // Mark active nav link
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('current', a.dataset.route === route);
  });
  // Show/hide route sections
  document.querySelectorAll('.route').forEach(s => {
    s.hidden = s.dataset.route !== route;
  });

  // Render the active route. Each renderer is wrapped in safeRender so one
  // breakage doesn't kill the rest.
  if (route === 'dashboard') safeRender('dashboard', renderDashboard);
  else if (route === 'planning') safeRender('planning', renderPlanning);
  else if (route === 'kpis') safeRender('kpis', renderKpis);
  else if (route === 'inputs') safeRender('inputs', renderInputs);
  else if (route === 'outputs') safeRender('outputs', renderOutputs);
  else if (route === 'learning') safeRender('learning', renderLearning);
  else if (route === 'modules') safeRender('modules', renderModules);
  else if (route === 'people') safeRender('people', renderPeople);
  else if (route === 'settings') safeRender('settings', renderSettings);
  else if (route === 'budget') safeRender('budget', renderBudget);
  else if (route === 'costs') safeRender('costs', renderCosts);
  else if (route === 'invoices') safeRender('invoices', renderInvoices);

  // Apply observer-mode tooltips to write-action buttons in the just-rendered
  // route. Views rebuild innerHTML so titles must be re-applied post-render.
  applyObserverTooltips();
}

// For non-admin viewers, set `title` on all write-action elements so the
// browser shows a "read-only" tooltip on hover. Pairs with the capture-phase
// click gate (which stops the action) and the CSS dim (which signals
// disabled-ness). Called after every renderRoute.
function applyObserverTooltips() {
  if (viewerIsAdmin()) return;
  const tooltip = viewer && viewer.role === 'unknown'
    ? 'No access — your email is not in roles.json'
    : 'Observer mode — read-only';
  document.querySelectorAll(WRITE_ACTION_SELECTORS).forEach(el => {
    if (!el.hasAttribute('data-original-title')) {
      el.setAttribute('data-original-title', el.getAttribute('title') || '');
    }
    el.setAttribute('title', tooltip);
  });
}

function renderBudget() {
  renderBudgetView({ identity, viewer, plans, initiatives, tasks, kpis, governance });
}

function renderCosts() {
  renderCostsView({ identity, viewer });
}

function renderInvoices() {
  renderInvoicesView({ identity, viewer });
}

function renderLearning() {
  renderLearningView({ identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderModules() {
  renderModulesView({ identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderPeople() {
  renderPeopleView({ identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
  // Header Invite button is disabled (v0.8). No click handler — disabled
  // attribute + .btn-soon class handle visual + interaction lockout.
}

function renderDashboard() {
  // Delegate to the view module (step 2b). It reads from the substrate state
  // we hydrated at boot. ctx is a snapshot — if substrate updates we re-render.
  renderDashboardView({
    identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance,
  });
}

function renderPlanning() {
  renderPlanningView(
    { identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, goals },
    { onChange: rehydrateAndRerender },
  );
}

function renderKpis() {
  renderKpisView(
    { identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, measurementsByKpi, governance, connectors, documentation },
    { onChange: rehydrateMeasurementsAndRerender },
  );
}

async function rehydrateMeasurementsAndRerender() {
  try {
    const baseRel = (file) => `${substrateBase(BU)}/${file}`;
    await Promise.all((kpis || []).map(async (k) => {
      if (!k || !k.id) return;
      const rows = await fetchSubstrateJsonl(baseRel(`measurements/${k.id}.jsonl`));
      measurementsByKpi[k.id] = rows;
    }));
    const route = (window.location.hash || '#dashboard').replace(/^#/, '').split('?')[0];
    renderRoute(route);
  } catch (e) {
    console.error('[genus] kpi measurements rehydrate failed:', e);
  }
}

function renderInputs() {
  renderInputsView(
    { identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance },
    { onChange: rehydrateAndRerender },
  );
}

// After an action (approve a task, dismiss a memo, etc.) re-fetch the affected
// substrate files and re-render the current route. Bypasses the per-Pages
// CDN cache by adding a cache-bust param.
async function rehydrateAndRerender() {
  try {
    const baseRel = (file) => `${substrateBase(BU)}/${file}`;
    const [t, m, mm, mt, i, g, gov] = await Promise.all([
      fetchSubstrateJson(baseRel('tasks.json'), tasks),
      fetchSubstrateJson(baseRel('meetings.json'), meetings),
      fetchSubstrateJsonl(baseRel('memos.jsonl')),
      fetchSubstrateJson(baseRel('plans.json'), plans),
      fetchSubstrateJson(baseRel('initiatives.json'), initiatives),
      fetchSubstrateJson(baseRel('goals.json'), goals),
      fetchSubstrateJson(baseRel('governance.json'), governance),
    ]);
    tasks = t; meetings = m; memos = mm; plans = mt; initiatives = i; goals = g; governance = gov;
    // Re-render current route
    const route = (window.location.hash || '#dashboard').replace(/^#/, '');
    renderRoute(route);
  } catch (e) {
    console.error('[genus] rehydrate failed:', e);
  }
}

function renderOutputs() {
  renderOutputsView({ identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderSettings() {
  renderSettingsView(
    { identity, viewer, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation },
    { onChange: rehydrateAndRerender },
  );
}

function renderWsMenu(identity) {
  const name = identity?.name || 'Tuto';
  const letter = name.charAt(0).toUpperCase();
  return `
    <div class="ws-menu-section-label mono">Ventures</div>
    <div class="ws-menu-venture ws-menu-venture-current">
      <span class="ws-menu-venture-avatar" style="background:var(--accent)">${letter}</span>
      <span class="ws-menu-venture-name">${name} BU</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>
    </div>
    <div class="ws-menu-divider"></div>
    <button type="button" class="ws-menu-action btn-soon" data-action="add-human" disabled title="Add-a-person flow ships in v0.8">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg></span>
      Add a person<span class="soon-tag">soon</span>
    </button>
    <button type="button" class="ws-menu-action btn-soon" data-action="add-venture" disabled title="Add-a-venture flow ships in v0.8">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg></span>
      Add a venture<span class="soon-tag">soon</span>
    </button>
    <button type="button" class="ws-menu-action btn-soon" data-action="add-agent" disabled title="Add-an-agent flow ships in v0.8">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8.5" width="16" height="11" rx="3.2"/><path d="M12 4.8v3.7"/><circle cx="12" cy="3.6" r="1.4"/></svg></span>
      Add an expert agent<span class="soon-tag">soon</span>
    </button>
    <div class="ws-menu-divider"></div>
    <button type="button" class="ws-menu-action" data-action="manage-people">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg></span>
      People &amp; permissions
    </button>
  `;
}

// ============ Go ============

boot();
