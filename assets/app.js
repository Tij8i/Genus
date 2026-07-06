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
import { renderLayers as renderLayersView } from './views/layers.js';
import { renderModules as renderModulesView } from './views/modules.js';
import { renderPeople as renderPeopleView } from './views/people.js';
import { renderTasksCentral as renderTasksCentralView } from './views/tasks-central.js';
import { mountChatDock } from './chat-dock.js';
import { renderLearningOverview } from './views/learning-module.js';
import { renderHrOverview, renderHrCatalog, renderPlanOptimizer } from './views/hr.js';
import { renderSalesOverview } from './views/sales.js';
import { renderMarketingOverview } from './views/marketing.js';
import { renderAbRuns } from './views/ab-runs.js';
import { renderMeetings } from './views/meetings.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderAgents as renderAgentsView, openAddAgentOverlay } from './views/agents.js';
import { renderRoster as renderRosterView } from './views/roster.js';
import { renderAgentDetail as renderAgentDetailView } from './views/agent-detail.js';
import { renderArchetype as renderArchetypeView } from './views/archetype-detail.js';
import { renderProducts as renderProductsView } from './views/product/products.js';
import { renderVision as renderVisionView } from './views/product/vision.js';
import { renderRoadmap as renderRoadmapView } from './views/product/roadmap.js';
import { renderBacklog as renderBacklogView } from './views/product/backlog.js';
import { renderReleases as renderReleasesView } from './views/product/releases.js';
import { renderReleaseDetail as renderReleaseDetailView } from './views/product/releases.js';
import { renderDesignSystem as renderDesignSystemView } from './views/product/design-system.js';
import { renderDecisions as renderDecisionsView } from './views/product/decisions.js';
import { renderDecisionDetail as renderDecisionDetailView } from './views/product/decisions.js';
import { renderFunctionOverview as renderFnOverviewView } from './views/workflows/function-overview.js';
import { renderFunctionWorkflows as renderFnWorkflowsView } from './views/workflows/function-workflows.js';
import { renderFunctionTasks as renderFnTasksView } from './views/workflows/function-tasks.js';
import { renderFunctionDiscipline as renderFnDisciplineView } from './views/workflows/function-discipline.js';
import { renderSettingsPlaceholder as renderFnSettingsPlaceholder } from './views/workflows/function-settings.js';
import { renderWorkflowDetail as renderWorkflowDetailView } from './views/workflows/workflow-detail.js';
import { loadWorkflowTasks, updateTaskBadges } from './views/workflows/_shared.js';
import { renderDevelopmentOverview } from './views/development/overview.js';
import { renderDevTests } from './views/development/tests.js';
import { renderDevBugs } from './views/development/bugs.js';
import { renderDevDeploys } from './views/development/deploys.js';
import { renderDevSynthetic } from './views/development/synthetic.js';
// Finance views migrated to the Finance Module folder (GEN-127). When the
// module loader (GEN-113) ships, these direct imports are replaced by dynamic
// resolution via `modules/finance/module.json` → `views.dashboard[*].component_ref`.
import { renderBudget as renderBudgetView } from '../modules/finance/views/budget.js';
import { renderCosts as renderCostsView } from '../modules/finance/views/costs.js';
import { renderInvoices as renderInvoicesView } from '../modules/finance/views/invoices.js';
import { renderConfidenceDemo as renderConfidenceDemoView } from './views/confidence-demo.js';
import { renderWorkshop as renderWorkshopView } from './views/product/workshop.js';
import { openOnboarding, openOverlay, closeOverlay } from './overlay.js';
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
  // Default new groups (introduced in v0.9) to expanded so operators can see
  // the new content items. finance/strategy/operations keep their persisted state.
  for (const k of ['finance', 'strategy', 'operations', 'product', 'development', 'learning', 'hr', 'sales', 'marketing']) {
    if (state[k] === undefined) state[k] = true;
    applyNavGroupState(k, state[k]);
  }
  saveNavGroupsState(state);
  // i44: labels are now anchor links to the module page. Clicking anywhere on
  // the label (including chevron) navigates; clicking JUST the chevron toggles
  // the group expand/collapse without navigating.
  document.querySelectorAll('.nav-group-label').forEach(el => {
    el.addEventListener('click', (e) => {
      const name = el.dataset.groupToggle;
      if (!name) return;
      // Only toggle when the click was on the chevron; leave the anchor
      // nav to navigate normally.
      const chevron = e.target.closest('.nav-group-chevron');
      if (!chevron) return;
      e.preventDefault();
      state[name] = !state[name];
      applyNavGroupState(name, state[name]);
      saveNavGroupsState(state);
    });
  });
}

// v1: hardcoded BU. Multi-BU switcher slot exists in the sidebar but only
// Multi-BU resolution (Session #18 Initiative #2, 2026-06-25):
// Reads ?bu=<id> from URL, falls back to localStorage, then to registry default.
// Registry is loaded async at boot — see boot() for the fetch + apply step.
function resolveCurrentBu(registry) {
  const fromUrl = new URLSearchParams(location.search).get('bu');
  if (fromUrl) return fromUrl;
  const fromStorage = localStorage.getItem('genus.currentBu');
  if (fromStorage) return fromStorage;
  return registry?.default_bu || 'genus';
}
// Registry state — populated at boot from /api/substrate?path=dashboard/public/data/bus/_registry.json.
let BU_REGISTRY = null;
// Master BU constant — set at boot. Views read this via the existing baseRel() helpers.
let BU = 'genus';

// Viewer = logged-in user identity resolved from CF Access JWT + roles.json.
// Per GEN-107: { email, role: 'admin'|'observer'|'unknown'|'unauthenticated',
// ventures: ['*' | bu...], display_name?, title?, dev_fallback? }.
// Populated at boot from /api/identity, then passed through to every view via
// the render ctx so write actions can gate on viewer.role.
let viewer = null;
function viewerIsAdmin() { return viewer && (viewer.role === 'admin' || viewer.role === 'owner'); }

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
  // Suggestion card actions (Inputs view)
  '.sugg-accept',
  '.sugg-dismiss',
  '.sugg-discuss',
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
    const role = viewer && viewer.role;
    const msg = role === 'unknown'
      ? "Your email isn't authorized for this dashboard yet. Ask the owner to add you."
      : role === 'member'
      ? "You don't have permission for this action. Ask the venture owner to upgrade your role."
      : role === 'observer'
      ? 'Observer mode — read-only.'
      : "You don't have permission for this action.";
    showObserverToast(msg);
  }, true); // capture: true so we run before any view handler
}

// Apply body classes + render the operator chip based on the resolved viewer.
// Triggers CSS that dims action buttons when viewer.role !== 'admin'.
function applyViewerToShell(v) {
  if (!v) return;
  document.body.classList.toggle('viewer-observer', v.role === 'observer');
  document.body.classList.toggle('viewer-unauthenticated', v.role === 'unauthenticated');
  document.body.classList.toggle('viewer-unknown', v.role === 'unknown');
  document.body.classList.toggle('viewer-admin', v.role === 'admin' || v.role === 'owner');
  document.body.classList.toggle('viewer-owner', v.role === 'owner');
  document.body.classList.toggle('viewer-member', v.role === 'member');
  document.body.classList.toggle('viewer-dev-fallback', !!v.dev_fallback);

  // Operator chip bottom-left of sidebar — was hardcoded "Alessio Tixi /
  // Founder · Operator" pre-GEN-107. Now reflects the actual signed-in user.
  const chip = document.querySelector('.operator-chip');
  if (chip) {
    const display = v.display_name || v.email || 'Unknown';
    const initial = (display.charAt(0) || '?').toUpperCase();
    const rolePill = v.role === 'owner'
      ? '<span class="role-pill role-pill--admin">Owner</span>'
      : v.role === 'admin'
      ? '<span class="role-pill role-pill--admin">Admin</span>'
      : v.role === 'member'
      ? '<span class="role-pill role-pill--observer">Member</span>'
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
  // Member is a legitimate role (limited write within ventures) — no banner needed.
  // Banner only for unknown / unauthenticated / observer (legacy read-only).
  const showBanner = v.role === 'observer' || v.role === 'unknown' || v.role === 'unauthenticated';
  if (showBanner) {
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

  // Multi-BU bootstrap: load registry, resolve current BU from URL/localStorage/default,
  // persist + filter sidebar nav before any view renders. (Session #18 Initiative #2)
  try {
    BU_REGISTRY = await fetchSubstrateJson('dashboard/public/data/bus/_registry.json', null);
    // Expose registry to modules that need synchronous meta lookup (e.g.
    // functionHeader in _shared.js reads purpose_line + stewart_archetype).
    window.__genusRegistry = BU_REGISTRY;
  } catch (e) {
    console.warn('[genus] BU registry fetch failed; falling back to default', e);
  }
  BU = resolveCurrentBu(BU_REGISTRY);
  localStorage.setItem('genus.currentBu', BU);
  applyBuNavFilter(BU, BU_REGISTRY);
  // Fire-and-forget: populate sidebar Tasks badges from substrate so they
  // surface before the user navigates into a workflow page.
  loadWorkflowTasks(BU).then(d => updateTaskBadges(d?.tasks || [])).catch(() => {});

  // Expose the leaf renderers globally so the Function Overview view can
  // dispatch into them with the right ctx (identity / viewer / substrate
  // slices) instead of re-fetching everything from scratch.
  window.__renderLeaf = (key) => {
    const dispatch = {
      budget: renderBudget, costs: renderCosts, invoices: renderInvoices,
      planning: renderPlanning, kpis: renderKpis, learning: renderLearning,
      inputs: renderInputs, outputs: renderOutputs,
      products: renderProducts, vision: renderVision, roadmap: renderRoadmap,
      backlog: renderBacklog, releases: renderReleases,
      'design-system': renderDesignSystem, decisions: renderDecisions,
    };
    const fn = dispatch[key];
    if (fn) try { fn(); } catch (e) { console.error('leaf render', key, e); }
  };

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

  // Sidebar BU name + avatar — prefer registry entry over per-BU identity.json
  // so the switcher and the sidebar header agree on the same label/avatar.
  const registryBu = (BU_REGISTRY?.business_units || []).find(b => b.id === BU);
  const buName = document.getElementById('bu-name');
  const buAvatar = document.getElementById('bu-avatar');
  const buMeta = document.getElementById('bu-meta');
  const buDisplay = registryBu?.display_name || identity?.name || BU;
  if (buName) buName.textContent = buDisplay;
  if (buAvatar) {
    buAvatar.textContent = registryBu?.avatar_initial || buDisplay.charAt(0).toUpperCase();
    if (registryBu?.color) buAvatar.style.background = registryBu.color;
  }
  if (buMeta) buMeta.textContent = `${identity?.category || (registryBu?.modules_installed || []).join(', ') || 'BU'} · v0.7`;

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
      // BU switcher click handlers — reload page with new ?bu= (hard swap v1; soft swap = v1.1)
      wsMenu.querySelectorAll('.ws-menu-venture-switchable').forEach(row => {
        row.addEventListener('click', () => {
          const newBu = row.dataset.buId;
          if (!newBu || newBu === BU) return;
          localStorage.setItem('genus.currentBu', newBu);
          const url = new URL(location.href);
          url.searchParams.set('bu', newBu);
          url.hash = ''; // start fresh on default route for the new BU
          location.href = url.toString();
        });
      });
      // Add-a-* actions are disabled (v0.8) — their disabled attribute
      // blocks clicks. Manage-people still navigates.
      wsMenu.querySelector('[data-action="manage-people"]')?.addEventListener('click', () => { wsMenu.hidden = true; window.location.hash = '#people'; });
      // Add a person → jump to People & permissions (which has the working add flow)
      wsMenu.querySelector('[data-action="add-human"]')?.addEventListener('click', () => {
        wsMenu.hidden = true;
        wsBtn.setAttribute('aria-expanded', 'false');
        window.location.hash = '#people';
        // Open the add-person modal once the People view has rendered
        setTimeout(() => document.getElementById('invite-person-btn')?.click(), 250);
      });
      // Add a venture → minimal modal flow (Session #18 Initiative #2 v1)
      wsMenu.querySelector('[data-action="add-venture"]')?.addEventListener('click', async () => {
        wsMenu.hidden = true;
        wsBtn.setAttribute('aria-expanded', 'false');
        await addVentureFlow();
      });
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
  else if (route === 'layers') safeRender('layers', renderLayers);
  else if (route === 'modules') safeRender('modules', renderModules);
  else if (route === 'agents') safeRender('agents', renderAgents);
  else if (route === 'people') safeRender('people', renderPeople);
  else if (route === 'tasks') safeRender('tasks', renderTasksCentralView);
  else if (route === 'learning-overview') safeRender('learning-overview', renderLearningOverview);
  else if (route === 'hr-overview')        safeRender('hr-overview',        renderHrOverview);
  else if (route === 'hr-catalog')         safeRender('hr-catalog',         renderHrCatalog);
  else if (route === 'hr-plan-optimizer')  safeRender('hr-plan-optimizer',  renderPlanOptimizer);
  else if (route === 'sales-overview')     safeRender('sales-overview',     renderSalesOverview);
  else if (route === 'marketing-overview') safeRender('marketing-overview', renderMarketingOverview);
  else if (route === 'ab-runs')            safeRender('ab-runs',            renderAbRuns);
  else if (route === 'meetings')           safeRender('meetings',           renderMeetings);
  else if (route === 'onboarding')         safeRender('onboarding',         renderOnboarding);
  else if (route === 'roster') safeRender('roster', renderRoster);
  else if (route === 'agent-detail') safeRender('agent-detail', renderAgentDetail);
  else if (route === 'archetype') safeRender('archetype', renderArchetype);
  else if (route === 'products') safeRender('products', renderProducts);
  else if (route === 'vision') safeRender('vision', renderVision);
  else if (route === 'roadmap') safeRender('roadmap', renderRoadmap);
  else if (route === 'backlog') safeRender('backlog', renderBacklog);
  else if (route === 'releases') safeRender('releases', renderReleases);
  else if (route === 'release-detail') safeRender('release-detail', renderReleaseDetail);
  else if (route === 'design-system') safeRender('design-system', renderDesignSystem);
  else if (route === 'decisions') safeRender('decisions', renderDecisions);
  else if (route === 'decision-detail') safeRender('decision-detail', renderDecisionDetail);
  else if (route === 'finance-overview')    safeRender('finance-overview',    () => renderFnOverviewView('finance'));
  else if (route === 'finance-workflows')   safeRender('finance-workflows',   () => renderFnWorkflowsView('finance'));
  else if (route === 'finance-tasks')       safeRender('finance-tasks',       () => renderFnTasksView('finance'));
  else if (route === 'finance-discipline')  safeRender('finance-discipline',  () => renderFnDisciplineView('finance'));
  else if (route === 'strategy-overview')   safeRender('strategy-overview',   () => renderFnOverviewView('strategy'));
  else if (route === 'strategy-workflows')  safeRender('strategy-workflows',  () => renderFnWorkflowsView('strategy'));
  else if (route === 'strategy-tasks')      safeRender('strategy-tasks',      () => renderFnTasksView('strategy'));
  else if (route === 'strategy-discipline') safeRender('strategy-discipline', () => renderFnDisciplineView('strategy'));
  else if (route === 'product-overview')    safeRender('product-overview',    () => renderFnOverviewView('product'));
  else if (route === 'product-workflows')   safeRender('product-workflows',   () => renderFnWorkflowsView('product'));
  else if (route === 'product-tasks')       safeRender('product-tasks',       () => renderFnTasksView('product'));
  else if (route === 'product-discipline')  safeRender('product-discipline',  () => renderFnDisciplineView('product'));
  else if (route.match(/^(product|finance|strategy|development|operations)-settings-rules$/)) {
    const mod = route.split('-')[0];
    safeRender(route, () => renderFnDisciplineView(mod));
  }
  else if (route.match(/^(product|finance|strategy|development|operations)-settings-(general|connections|permissions)$/)) {
    const [mod, , sub] = route.split('-');
    safeRender(route, () => renderFnSettingsPlaceholder(mod, sub));
  }
  else if (route === 'development-overview') safeRender('development-overview', renderDevelopmentOverview);
  else if (route === 'development-workflows')safeRender('development-workflows',() => renderFnWorkflowsView('development'));
  else if (route === 'development-tasks')    safeRender('development-tasks',    () => renderFnTasksView('development'));
  else if (route === 'development-discipline')safeRender('development-discipline',() => renderFnDisciplineView('development'));
  else if (route === 'dev-tests')            safeRender('dev-tests',            renderDevTests);
  else if (route === 'dev-bugs')             safeRender('dev-bugs',             renderDevBugs);
  else if (route === 'dev-deploys')          safeRender('dev-deploys',          renderDevDeploys);
  else if (route === 'dev-synthetic')        safeRender('dev-synthetic',        renderDevSynthetic);
  else if (route === 'dev-workflow-detail')  safeRender('dev-workflow-detail',  renderWorkflowDetailView);
  else if (route === 'operations-overview') safeRender('operations-overview', () => renderFnOverviewView('operations'));
  else if (route === 'operations-workflows')safeRender('operations-workflows',() => renderFnWorkflowsView('operations'));
  else if (route === 'operations-tasks')    safeRender('operations-tasks',    () => renderFnTasksView('operations'));
  else if (route === 'operations-discipline')safeRender('operations-discipline',() => renderFnDisciplineView('operations'));
  else if (route === 'workflow-detail')     safeRender('workflow-detail',     renderWorkflowDetailView);
  else if (route === 'settings') safeRender('settings', renderSettings);
  else if (route === 'budget') safeRender('budget', renderBudget);
  else if (route === 'costs') safeRender('costs', renderCosts);
  else if (route === 'invoices') safeRender('invoices', renderInvoices);
  else if (route === 'confidence-demo') safeRender('confidence-demo', renderConfidenceDemo);
  else if (route === 'workshop') safeRender('workshop', () => renderWorkshopView({ bu: BU }));

  // Apply observer-mode tooltips to write-action buttons in the just-rendered
  // route. Views rebuild innerHTML so titles must be re-applied post-render.
  applyObserverTooltips();
}

function renderConfidenceDemo() {
  renderConfidenceDemoView({ identity });
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

function renderLayers() {
  renderLayersView({ identity, viewer });
}
function renderAgents() {
  renderAgentsView({ identity, viewer });
}
function renderRoster() {
  renderRosterView({ identity, viewer });
}
function renderAgentDetail() {
  renderAgentDetailView({ identity, viewer });
}
function renderArchetype() {
  renderArchetypeView({ identity, viewer });
}
function renderProducts()      { renderProductsView({ identity, viewer }); }
function renderVision()        { renderVisionView({ identity, viewer }); }
function renderRoadmap()       { renderRoadmapView({ identity, viewer }); }
function renderBacklog()       { renderBacklogView({ identity, viewer }); }
function renderReleases()      { renderReleasesView({ identity, viewer }); }
function renderReleaseDetail() { renderReleaseDetailView({ identity, viewer }); }
function renderDesignSystem()  { renderDesignSystemView({ identity, viewer }); }
function renderDecisions()     { renderDecisionsView({ identity, viewer }); }
function renderDecisionDetail(){ renderDecisionDetailView({ identity, viewer }); }
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

// "Add a venture" — minimal v1 flow per Session #18 Initiative #2.
// Per operator: keep it simple; this just creates an empty installation. Module
// install + agent setup happen later. Uses the shared openOverlay primitive so
// the modal matches the rest of the dashboard's visual language.
function addVentureFlow() {
  // Available modules for the picker come from the registry (loaded at boot
  // into BU_REGISTRY). If the registry hasn't loaded yet we fall back to a
  // static list matching MODULE_BINDING_TEMPLATES in functions/api/create-bu.js.
  const availableModules = (BU_REGISTRY?.available_modules || []).filter(m =>
    ['strategy', 'finance', 'product', 'development'].includes(m.id)
  );
  const modulePickerHtml = availableModules.length > 0 ? `
    <label style="display:flex;flex-direction:column;gap:6px;">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Default modules <span style="font-weight:400;color:var(--text-faint);text-transform:none;letter-spacing:0;">(optional — you can install more later)</span></span>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;">
        ${availableModules.map(m => `
          <label style="display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--surface);">
            <input type="checkbox" class="addbu-module" value="${m.id}" style="margin-top:2px;flex:none;" ${m.id === 'strategy' ? 'checked' : ''}/>
            <span>
              <span style="display:block;font-weight:600;font-size:13px;color:var(--text);">${m.icon || ''} ${m.display_name || m.id}</span>
              <span style="display:block;font-size:11.5px;color:var(--text-dim);line-height:1.4;margin-top:2px;">${(m.summary || '').slice(0, 90)}${(m.summary || '').length > 90 ? '…' : ''}</span>
            </span>
          </label>
        `).join('')}
      </div>
    </label>
  ` : '';

  const bodyHtml = `
    <div class="onboard-section-label mono">New venture</div>
    <p style="font-size:13px;color:var(--text-dim);line-height:1.55;margin:0 0 18px;">
      Creates a fresh installation. If your Paperclip trigger daemon is running, this also spins up the matching Paperclip company + agents in one shot (roadmap i28). If not, you can install modules manually later via Modules.
    </p>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">Display name</span>
        <input id="addbu-name" type="text" placeholder="e.g. Acme Corp" autocomplete="off"
               style="padding:10px 12px;font-size:14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:inherit;outline:none;" />
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);font-weight:600;">URL id</span>
        <input id="addbu-id" type="text" placeholder="acme-corp" autocomplete="off"
               style="padding:10px 12px;font-size:13px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;outline:none;" />
        <span style="font-size:11px;color:var(--text-faint);">Lowercase letters, digits, hyphens. Auto-derived from name.</span>
      </label>
      ${modulePickerHtml}
      <div id="addbu-progress" style="display:none;padding:10px 12px;background:var(--accent-bg);color:var(--accent);border-radius:6px;font-size:12px;"></div>
      <div id="addbu-error" style="display:none;padding:10px 12px;background:var(--red-bg);color:var(--red-fg);border-radius:6px;font-size:12px;"></div>
    </div>
  `;
  const footerHtml = `
    <button type="button" class="onboard-cancel" id="addbu-cancel">Cancel</button>
    <button type="button" class="onboard-begin" id="addbu-create">Create venture</button>
  `;
  openOverlay({
    title: 'Add a venture',
    subtitle: 'A new BU installation under this workspace.',
    iconHtml: '🏛',
    iconTint: '#0e9f6e',
    bodyHtml,
    footerHtml,
  });

  const $name = document.getElementById('addbu-name');
  const $id = document.getElementById('addbu-id');
  const $err = document.getElementById('addbu-error');
  const $btn = document.getElementById('addbu-create');
  const $cancel = document.getElementById('addbu-cancel');

  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  let idTouched = false;
  $id.addEventListener('input', () => { idTouched = true; });
  $name.addEventListener('input', () => {
    if (!idTouched) $id.value = slugify($name.value);
  });
  setTimeout(() => $name.focus(), 30);

  const submit = async () => {
    const display_name = $name.value.trim();
    const id = $id.value.trim();
    $err.style.display = 'none';
    if (!display_name) { $err.textContent = 'Display name is required.'; $err.style.display = 'block'; return; }
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) { $err.textContent = 'URL id must be lowercase letters/digits/hyphens, 2-31 chars, start with a letter.'; $err.style.display = 'block'; return; }

    const selectedModules = Array.from(document.querySelectorAll('.addbu-module:checked')).map(el => el.value);
    const $progress = document.getElementById('addbu-progress');
    const setProgress = (msg) => { $progress.textContent = msg; $progress.style.display = 'block'; };

    $btn.disabled = true;
    $btn.textContent = 'Creating…';
    try {
      // 1. Registry + identity + bindings (all-in-one via /api/create-bu)
      setProgress('1/4 · writing registry + identity…');
      const res = await fetch('/api/create-bu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, display_name, default_modules: selectedModules }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        $err.textContent = result.message || `HTTP ${res.status}`;
        $err.style.display = 'block';
        $progress.style.display = 'none';
        $btn.disabled = false;
        $btn.textContent = 'Create venture';
        return;
      }

      // 2. Paperclip company via local trigger daemon (best-effort). If the
      // daemon isn't running, we skip and land on the created BU anyway —
      // operator can attach a company later via manual reconcile.
      let paperclipCompany = null;
      try {
        setProgress('2/4 · creating Paperclip company…');
        const prefix = id.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'NEW';
        const pcRes = await fetch('http://127.0.0.1:3101/paperclip/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: display_name, issue_prefix: prefix }),
          signal: AbortSignal.timeout(20000),
        });
        const pcJson = await pcRes.json();
        if (pcRes.ok && pcJson.ok) paperclipCompany = pcJson.company;
        else console.warn('[add-bu] paperclip create returned', pcRes.status, pcJson);
      } catch (e) {
        console.info('[add-bu] trigger not reachable — Paperclip company step skipped:', e.message || e);
      }

      // 3. Persist mapping (only if we got a company id)
      if (paperclipCompany?.id) {
        try {
          setProgress('3/4 · saving Paperclip mapping…');
          await fetch('/api/finalize-bu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bu_id: id,
              paperclip_company_id: paperclipCompany.id,
              paperclip_company_name: paperclipCompany.name,
              issue_prefix: paperclipCompany.issuePrefix || paperclipCompany.issue_prefix || '',
            }),
          });
        } catch (e) {
          console.warn('[add-bu] finalize-bu failed:', e.message || e);
        }
      }

      // 4. Fire reconcile so agents + heartbeat routines get created now
      if (paperclipCompany?.id && selectedModules.length > 0) {
        try {
          setProgress('4/4 · spinning up agents…');
          await fetch('http://127.0.0.1:3101/reconcile-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bu: id, timeout_ms: 60000 }),
            signal: AbortSignal.timeout(60000),
          });
        } catch (e) {
          console.info('[add-bu] reconcile trigger skipped:', e.message || e);
        }
      }

      localStorage.setItem('genus.currentBu', result.bu.id);
      const url = new URL(location.href);
      url.searchParams.set('bu', result.bu.id);
      url.hash = '';
      location.href = url.toString();
    } catch (e) {
      $err.textContent = 'Network error: ' + (e.message || e);
      $err.style.display = 'block';
      $progress.style.display = 'none';
      $btn.disabled = false;
      $btn.textContent = 'Create venture';
    }
  };

  $btn.addEventListener('click', submit);
  $cancel.addEventListener('click', closeOverlay);
  // Submit on Enter from either input
  [$name, $id].forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
}

// Filter sidebar nav links: hide routes that are not in the current BU's installed
// modules + the always-visible core_routes. Reads `module_route_map` + `core_routes`
// from the registry. Defensive — if registry missing, leave nav as-is.
function applyBuNavFilter(currentBu, registry) {
  if (!registry || !registry.module_route_map) return;
  const buEntry = (registry.business_units || []).find(b => b.id === currentBu);
  if (!buEntry) return;
  const installed = new Set(buEntry.modules_installed || []);
  const visibleRoutes = new Set(registry.core_routes || []);
  for (const m of installed) {
    for (const r of (registry.module_route_map[m] || [])) visibleRoutes.add(r);
  }
  document.querySelectorAll('.nav-link[data-route]').forEach(a => {
    const r = a.dataset.route;
    a.style.display = visibleRoutes.has(r) ? '' : 'none';
  });
  // Hide nav-groups that have no visible children
  document.querySelectorAll('.nav-group').forEach(g => {
    const anyVisible = Array.from(g.querySelectorAll('.nav-link[data-route]')).some(a => a.style.display !== 'none');
    g.style.display = anyVisible ? '' : 'none';
  });
}

// Filter the BU list shown in the WS switcher by the viewer's ventures (per Q2=C
// hybrid role model). Owners see everything; admins/members/observers see only
// the BUs in their `ventures` list (or all if ventures === ['*']).
function visibleBusForViewer(registry, viewer) {
  if (!registry) return [];
  const all = registry.business_units || [];
  if (!viewer || viewer.role === 'owner') return all;
  if (Array.isArray(viewer.ventures) && viewer.ventures.includes('*')) return all;
  const allowed = new Set(viewer.ventures || []);
  return all.filter(b => allowed.has(b.id));
}

function renderWsMenu(identity) {
  const registry = BU_REGISTRY;
  const currentBu = BU;
  // Filter to BUs the current viewer is allowed to see (per Q2=C role × ventures)
  const filtered = visibleBusForViewer(registry, viewer);
  const list = filtered.length > 0
    ? filtered
    : [{ id: currentBu, display_name: currentBu, avatar_initial: currentBu.charAt(0).toUpperCase(), color: 'var(--accent)' }];
  const ventureRows = list.map(b => {
    const isCurrent = b.id === currentBu;
    const checkOrSwitch = isCurrent
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>`
      : '';
    const cls = isCurrent ? 'ws-menu-venture ws-menu-venture-current' : 'ws-menu-venture ws-menu-venture-switchable';
    return `<div class="${cls}" data-bu-id="${b.id}" style="cursor:${isCurrent ? 'default' : 'pointer'}">
      <span class="ws-menu-venture-avatar" style="background:${b.color || 'var(--accent)'}">${b.avatar_initial || b.display_name.charAt(0).toUpperCase()}</span>
      <span class="ws-menu-venture-name">${b.display_name}</span>
      ${checkOrSwitch}
    </div>`;
  }).join('');
  return `
    <div class="ws-menu-section-label mono">Ventures</div>
    ${ventureRows}
    <div class="ws-menu-divider"></div>
    <button type="button" class="ws-menu-action" data-action="add-human" title="Go to People & permissions">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg></span>
      Add a person
    </button>
    <button type="button" class="ws-menu-action" data-action="add-venture" title="Create a new BU (empty install)">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg></span>
      Add a venture
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

boot().then(() => {
  try { mountChatDock(); } catch (e) { console.warn('chat dock mount', e); }
  // i44 — Chat with Stewart tab handler (bubbles from any module page)
  document.body.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-action-tab="steward-chat"]');
    if (!link) return;
    e.preventDefault();
    try {
      const { openStewardTab } = await import('./chat-dock.js');
      const { fetchSubstrateJson } = await import('./substrate-client.js');
      const mod = link.dataset.mod;
      const displayName = mod ? (mod.charAt(0).toUpperCase() + mod.slice(1)) : 'Stewart';
      // Look up the real agent binding for this BU + module
      const currentBu = new URLSearchParams(location.search).get('bu') || localStorage.getItem('genus.currentBu') || 'genus';
      let agent_id = `${mod}-stewart`;  // fallback if binding not found
      try {
        const bindings = await fetchSubstrateJson('dashboard/public/data/system/agent_bindings.json', { bindings: [] });
        const match = (bindings?.bindings || []).find(b => b.bu === currentBu && (b.module_id === mod || b.module_id === 'architect' && mod === 'product'));
        if (match?.agent_id) agent_id = match.agent_id;
      } catch (_) {}
      openStewardTab({ id: `${mod}-steward-${currentBu}`, label: `${displayName} Stewart`, agent_id });
    } catch (err) { console.warn('steward chat', err); }
  });
});
