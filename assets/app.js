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

// v1: hardcoded BU. Multi-BU switcher slot exists in the sidebar but only
// one BU is wired today (Tuto on Genus-native substrate). Per [[v06-mockup-interpretation]]
// + decision 5 in the migration plan, others appear as they migrate.
const BU = 'tuto';

// Module-level state, populated at boot.
let identity = null;
let goals = [];
let initiatives = [];
let plans = [];
let tasks = [];
let meetings = [];
let memos = [];
let kpis = [];
let governance = {};

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
    ]);
  } catch (e) {
    bootError(e.message || String(e));
    return;
  }
  [identity, goals, initiatives, plans, tasks, meetings, memos, kpis, governance] = results;

  // Sidebar BU name from identity
  const buName = document.getElementById('bu-name');
  const buAvatar = document.getElementById('bu-avatar');
  const buMeta = document.getElementById('bu-meta');
  if (buName) buName.textContent = identity?.name || BU;
  if (buAvatar) buAvatar.textContent = (identity?.name || BU).charAt(0).toUpperCase();
  if (buMeta) buMeta.textContent = `${identity?.category || 'BU'} · v0.6`;

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

  // Wire router
  initRouter('dashboard');
  onRouteChange(route => renderRoute(route));
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
  else if (route === 'settings') safeRender('settings', renderSettings);
}

function renderDashboard() {
  // Delegate to the view module (step 2b). It reads from the substrate state
  // we hydrated at boot. ctx is a snapshot — if substrate updates we re-render.
  renderDashboardView({
    identity, plans, initiatives, tasks, meetings, memos, kpis, governance,
  });
}

function renderPlanning() {
  renderPlanningView(
    { identity, plans, initiatives, tasks, meetings, memos, kpis, governance, goals },
    { onChange: rehydrateAndRerender },
  );
}

function renderKpis() {
  document.getElementById('route-kpis').innerHTML =
    TODO_PLACEHOLDER('KPIs — Scope dropdown / Sources row / 4-up KPI grid',
      `${kpis.length} KPIs in registry`);
}

function renderInputs() {
  renderInputsView(
    { identity, plans, initiatives, tasks, meetings, memos, kpis, governance },
    { onChange: rehydrateAndRerender },
  );
}

// After an action (approve a task, dismiss a memo, etc.) re-fetch the affected
// substrate files and re-render the current route. Bypasses the per-Pages
// CDN cache by adding a cache-bust param.
async function rehydrateAndRerender() {
  try {
    const baseRel = (file) => `${substrateBase(BU)}/${file}`;
    const [t, m, mm, mt, i, g] = await Promise.all([
      fetchSubstrateJson(baseRel('tasks.json'), tasks),
      fetchSubstrateJson(baseRel('meetings.json'), meetings),
      fetchSubstrateJsonl(baseRel('memos.jsonl')),
      fetchSubstrateJson(baseRel('plans.json'), plans),
      fetchSubstrateJson(baseRel('initiatives.json'), initiatives),
      fetchSubstrateJson(baseRel('goals.json'), goals),
    ]);
    tasks = t; meetings = m; memos = mm; plans = mt; initiatives = i; goals = g;
    // Re-render current route
    const route = (window.location.hash || '#dashboard').replace(/^#/, '');
    renderRoute(route);
  } catch (e) {
    console.error('[genus] rehydrate failed:', e);
  }
}

function renderOutputs() {
  const doneTasksRecent = tasks.filter(t => t.status === 'done').length;
  const closedInits = initiatives.filter(i => i.status === 'completed').length;
  document.getElementById('route-outputs').innerHTML =
    TODO_PLACEHOLDER('Outputs — Trajectory / Work shipped / Milestones reached',
      `${doneTasksRecent} tasks done · ${closedInits} initiatives completed`);
}

function renderSettings() {
  const g = governance?.gauges || {};
  document.getElementById('route-settings').innerHTML =
    TODO_PLACEHOLDER('Settings — Identity / Governance / Wiring',
      `delegation: <strong>${g.delegation?.current || '?'}</strong> · trust: <strong>${g.trust?.current || '?'}</strong> · speed: <strong>${g.speed?.current || '?'}</strong>`);
}

// ============ Go ============

boot();
