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
  // Header: greeting + date + cycle context
  const greeting = document.getElementById('dash-greeting');
  const subtitle = document.getElementById('dash-subtitle');
  const cycleMeta = document.getElementById('dash-cycle-meta');
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // For v1, use "Operator" as the address (we'll wire to identity in step 2b)
  greeting.textContent = `${greet}, Alessio`;
  subtitle.textContent = `Here's what's on autopilot today for ${identity?.name || 'this venture'}.`;
  const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][now.getDay()];
  const monthName = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getMonth()];
  cycleMeta.innerHTML = `
    <div class="page-cycle-meta">
      <span class="mono" style="font-size:12px;color:var(--text-faint);letter-spacing:.02em">${(identity?.current_stage || '').toUpperCase()}</span>
      <span style="font-size:13.5px;color:var(--text);font-weight:600">${initiatives.filter(i => i.status === 'in_progress').length} initiatives in progress</span>
    </div>
    <div class="date-chip">
      <span class="mono" style="font-size:9px;color:var(--red);font-weight:600;letter-spacing:.06em">${monthName}</span>
      <span style="font-weight:800;font-size:16px;margin-top:1px">${now.getDate()}</span>
    </div>
  `;
  document.getElementById('route-dashboard').innerHTML =
    TODO_PLACEHOLDER('Dashboard — Waiting on you / Recently shipped / Upcoming milestones / Decisions / Snapshot',
      `substrate loaded: ${initiatives.length} initiatives, ${tasks.length} tasks, ${meetings.length} meetings, ${memos.length} memos, ${plans.length} plans, ${kpis.length} kpis`);
}

function renderPlanning() {
  const activePlan = plans.find(p => p.status === 'active');
  document.getElementById('route-planning').innerHTML =
    TODO_PLACEHOLDER('Planning — Roadmap timeline / Active plan / Initiatives / Backlog / Retrospective',
      activePlan
        ? `active plan: <strong>${activePlan.title}</strong> · ${(activePlan.initiative_ids || []).length} initiatives`
        : 'no active plan');
}

function renderKpis() {
  document.getElementById('route-kpis').innerHTML =
    TODO_PLACEHOLDER('KPIs — Scope dropdown / Sources row / 4-up KPI grid',
      `${kpis.length} KPIs in registry`);
}

function renderInputs() {
  const unprocessedMemos = memos.filter(m => m.status !== 'processed' && m.status !== 'dismissed').length;
  const pendingMeetings = meetings.filter(m => m.status === 'requested_by_agent').length;
  const pendingSuggestions = tasks.filter(t => t.status === 'awaiting_approval' || t.status === 'proposed').length;
  document.getElementById('route-inputs').innerHTML =
    TODO_PLACEHOLDER('Inputs — Memos / Meetings / Suggestions (3-column)',
      `${unprocessedMemos} unprocessed memos · ${pendingMeetings} pending meetings · ${pendingSuggestions} pending suggestions`);
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
