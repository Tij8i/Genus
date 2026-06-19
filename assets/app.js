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
import { openOnboarding } from './overlay.js';

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
    bootError(e.message || String(e));
    return;
  }
  [identity, goals, initiatives, plans, tasks, meetings, memos, kpis, governance, connectors, documentation] = results;

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
      wsMenu.querySelector('[data-action="add-human"]')?.addEventListener('click', () => { wsMenu.hidden = true; openOnboarding('human'); });
      wsMenu.querySelector('[data-action="add-venture"]')?.addEventListener('click', () => { wsMenu.hidden = true; openOnboarding('venture'); });
      wsMenu.querySelector('[data-action="add-agent"]')?.addEventListener('click', () => { wsMenu.hidden = true; openOnboarding('agent'); });
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
  else if (route === 'learning') safeRender('learning', renderLearning);
  else if (route === 'modules') safeRender('modules', renderModules);
  else if (route === 'people') safeRender('people', renderPeople);
  else if (route === 'settings') safeRender('settings', renderSettings);
}

function renderLearning() {
  renderLearningView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderModules() {
  renderModulesView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderPeople() {
  renderPeopleView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
  // Wire header Invite button (rendered as part of route shell, not view)
  const invite = document.getElementById('invite-person-btn');
  if (invite) invite.addEventListener('click', () => openOnboarding('human'));
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
  renderKpisView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
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
  renderOutputsView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
}

function renderSettings() {
  renderSettingsView({ identity, plans, initiatives, tasks, meetings, memos, kpis, governance, connectors, documentation });
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
    <button type="button" class="ws-menu-action" data-action="add-human">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg></span>
      Add a person
    </button>
    <button type="button" class="ws-menu-action" data-action="add-venture">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg></span>
      Add a venture
    </button>
    <button type="button" class="ws-menu-action" data-action="add-agent">
      <span class="ws-menu-action-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8.5" width="16" height="11" rx="3.2"/><path d="M12 4.8v3.7"/><circle cx="12" cy="3.6" r="1.4"/></svg></span>
      Add an expert agent
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
