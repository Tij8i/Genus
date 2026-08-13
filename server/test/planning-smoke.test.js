// Planning-loop smoke suite (S1–S8).
//
// Node's built-in test runner. No external test framework. Exercises the 8
// core planning endpoints against an ephemeral file-backed BU. Assertions
// hit the resulting substrate directly — we don't wait for Stewart to run,
// we assert that the endpoints file the right task/write the right JSON.
//
// Run:  npm test
//
// Env:  GENUS_STORAGE_MODE=local-fs (set by the test itself)
//       GENUS_BUS_ROOT=<tmp>        (set by the test itself)
//       GENUS_LOCAL_MODE=1          (set by the test — bypasses auth)

// Env must be set BEFORE any module import so storage/index.js picks it up.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'genus-smoke-'));

// local-fs resolves `dashboard/public/data/bus/<bu>/...` against GENUS_BUS_ROOT
// directly, and `system/...` against BUS_ROOT/../system. So BUS_ROOT should be
// the `bus/` dir, and the sibling `system/` dir sits next to it. Layout:
//   <TMP_ROOT>/bus/_registry.json + <bu>/*.json
//   <TMP_ROOT>/system/*.json
process.env.GENUS_STORAGE_MODE = 'local-fs';
process.env.GENUS_BUS_ROOT = path.join(TMP_ROOT, 'bus');
process.env.GENUS_LOCAL_MODE = '1';
process.env.GITHUB_PAT = 'local-mode-no-pat';  // any non-empty string passes the guard
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-fake-not-used-by-smoke-suite';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const BU = 'test-planning';
const BASE = path.join(TMP_ROOT, 'bus', BU);

// -------- Seed helpers --------

async function writeJson(rel, data) {
  const abs = path.join(TMP_ROOT, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(data, null, 2) + '\n');
}

async function readJson(rel) {
  const abs = path.join(TMP_ROOT, rel);
  return JSON.parse(await fs.readFile(abs, 'utf8'));
}

// Fresh BU substrate before each test. Wipes + re-seeds a minimal v2 shape.
async function seedFreshBu({ withActive = false, withProposals = false, withQueued = false, withCompleted = false } = {}) {
  const buDir = path.join(TMP_ROOT, 'bus', BU);
  await fs.rm(buDir, { recursive: true, force: true });

  // Minimal system substrate: registry with BU flagged as v2, agent_bindings
  // with Strategy Stewart bound. Both are read-once per endpoint via
  // _schema-version.js and each endpoint's resolveStrategyStewart.
  await writeJson('bus/_registry.json', {
    version: '1.0.0',
    default_bu: BU,
    business_units: [{
      id: BU,
      display_name: 'Test Planning BU',
      avatar_initial: 'T',
      color: '#888',
      modules_installed: [],
      schema_version: 'v2',
    }],
    module_route_map: {},
    core_routes: ['dashboard', 'planning', 'kpis', 'inputs', 'outputs', 'learning'],
  });
  await writeJson('system/agent_bindings.json', [
    { bu: BU, module_id: 'strategy', agent_id: 'test-strategy-stewart' },
  ]);
  await writeJson('system/roles.json', [
    { email: 'operator@test', role: 'owner', ventures: ['*'] },
  ]);

  // Per-BU substrate.
  await writeJson(`bus/${BU}/goals.json`, []);
  await writeJson(`bus/${BU}/initiatives.json`, []);
  await writeJson(`bus/${BU}/tasks.json`, []);
  await writeJson(`bus/${BU}/plan_proposals.json`, []);
  await writeJson(`bus/${BU}/memos.jsonl`, []);
  await writeJson(`bus/${BU}/kpis.json`, [{
    id: 'kpi-test-mrr',
    bu: BU,
    area: 'revenue',
    name: 'Test MRR',
    unit: 'USD/mo',
    direction: 'higher_is_better',
    category: 'north_star',
    priority: 'primary',
    target: 10000,
  }]);
  // Overwrite the memos.jsonl (writeJson wrote "[]"; jsonl expects empty).
  await fs.writeFile(path.join(TMP_ROOT, `bus/${BU}/memos.jsonl`), '');

  // Optional: seed an already-active plan (for queue-behavior tests).
  const plans = [];
  const goals = [];
  const initiatives = [];
  const tasks = [];
  const now = new Date().toISOString();

  if (withActive) {
    goals.push({ id: 'goal-active-01', bu: BU, title: 'Ship the pilot', description: '', kpi_id: 'kpi-test-mrr', target_value: 5000, target_date: '2026-09-15', status: 'active', backlog_state: 'promoted_to_plan', created_at: now });
    initiatives.push({ id: 'init-active-01', bu: BU, goal_id: 'goal-active-01', title: 'Draft pilot deck', status: 'in_progress', checkpoints: [
      { id: 'cp-active-01-1', name: 'Deck outline agreed', criticality: 'strategic', status: 'pending', requires_approval: false, produces_artifact: true, created_at: now },
      { id: 'cp-active-01-2', name: 'Deck reviewed', criticality: 'strategic', status: 'pending', requires_approval: true, produces_artifact: true, created_at: now },
    ], created_at: now });
    tasks.push({ id: 'task-active-01', bu: BU, title: 'Sketch outline', status: 'proposed', advances_initiative: 'init-active-01', advances_checkpoint: 'cp-active-01-1', created_at: now });
    plans.push({ id: 'plan-active-01', bu: BU, title: 'Pilot plan', status: 'active', period_start: '2026-08-01', period_target_end: '2026-08-31', goal_ids: ['goal-active-01'], initiative_ids: ['init-active-01'], created_at: now, activated_at: now, finalized_at: now });
  }

  if (withCompleted) {
    plans.push({ id: 'plan-completed-01', bu: BU, title: 'Old cycle', status: 'completed', period_start: '2026-07-01', period_target_end: '2026-07-31', goal_ids: [], initiative_ids: [], created_at: '2026-07-01T00:00:00Z', activated_at: '2026-07-01T00:00:00Z', completed_at: '2026-07-31T00:00:00Z' });
  }

  if (withProposals) {
    plans.push();  // no plan yet — proposals waiting to be picked
  }

  await writeJson(`bus/${BU}/goals.json`, goals);
  await writeJson(`bus/${BU}/initiatives.json`, initiatives);
  await writeJson(`bus/${BU}/tasks.json`, tasks);
  await writeJson(`bus/${BU}/plans.json`, plans);

  if (withProposals) {
    const psetId = 'pset-test-001';
    const proposals = [1, 2, 3].map(n => ({
      id: `plan-proposal-test-${n}`,
      proposal_set_id: psetId,
      bu: BU,
      status: 'proposed',
      title: `Proposal ${n}`,
      rationale: `Because ${n}.`,
      period_start: '2026-09-01',
      period_target_end: '2026-09-30',
      proposed_goals: [{
        title: `Grow MRR (variant ${n})`,
        description: '',
        kpi_id: 'kpi-test-mrr',
        target_value: 5000 + n * 1000,
        target_date: '2026-09-30',
      }],
      proposed_initiatives: [{
        title: `Do the thing ${n}`, goal_index: 0,
        active_hypothesis: '', success_criterion: '',
        target_close_date: '2026-09-25', priority_in_plan: 'primary', depends_on_index: [],
      }],
      backlog_ids_drawn_from: [],
      reasoning: '', proposed_by: 'test-strategy-stewart', proposed_at: now,
    }));
    await writeJson(`bus/${BU}/plan_proposals.json`, proposals);
    return { psetId };
  }

  if (withQueued && plans.length) {
    // Add a queued plan waiting behind the active one.
    plans.push({
      id: 'plan-queued-01', bu: BU, title: 'Next cycle', status: 'queued',
      period_start: '2026-09-01', period_target_end: '2026-09-30',
      goal_ids: [], initiative_ids: [],
      created_at: now, activated_at: null, queued_at: now, queued_after_plan_id: 'plan-active-01',
      finalized_at: now,   // pre-finalized so complete_cycle can promote cleanly
    });
    await writeJson(`bus/${BU}/plans.json`, plans);
  }

  return {};
}

// Build a mock request object matching what express-adapter passes through.
function mockReq(body) {
  return {
    json: async () => body,
    headers: new Map(),
    // CF Access header used by getViewerIdentity — in local mode it's ignored.
  };
}

function mockEnv() {
  return {
    GITHUB_PAT: process.env.GITHUB_PAT,
    GENUS_LOCAL_MODE: process.env.GENUS_LOCAL_MODE,
  };
}

async function invoke(mod, body) {
  const resp = await mod.onRequestPost({ request: mockReq(body), env: mockEnv() });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: resp.status, body: json };
}

after(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

// -------- Tests --------

test('S1 — POST /api/groom-backlog files a backlog_groom task', async () => {
  await seedFreshBu();
  const mod = await import('../api/groom-backlog.js');
  const r = await invoke(mod, { bu: BU });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.stewart, 'test-strategy-stewart');
  const tasks = await readJson(`bus/${BU}/tasks.json`);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].category, 'backlog_groom');
  assert.equal(tasks[0].status, 'approved');
});

test('S2 — POST /api/request-plan-proposals files a planning_proposal task', async () => {
  await seedFreshBu();
  const mod = await import('../api/request-plan-proposals.js');
  const r = await invoke(mod, { bu: BU });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const tasks = await readJson(`bus/${BU}/tasks.json`);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].category, 'planning_proposal');
  // v2 sanity: the prompt should mention the v2 goal schema.
  assert.match(tasks[0].description, /kpi_id/);
  assert.match(tasks[0].description, /target_value/);
});

test('S3 — POST /api/select-plan-proposal (no active) → active plan + finalize task auto-filed', async () => {
  const { psetId: _ } = await seedFreshBu({ withProposals: true });
  const mod = await import('../api/select-plan-proposal.js');
  const r = await invoke(mod, { bu: BU, proposal_id: 'plan-proposal-test-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const plans = await readJson(`bus/${BU}/plans.json`);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].status, 'active');
  assert.equal(plans[0].finalized_at, null);          // Stewart hasn't run yet
  assert.ok(plans[0].finalize_task_id);               // but the finalize task was filed

  const goals = await readJson(`bus/${BU}/goals.json`);
  assert.equal(goals.length, 1);
  assert.equal(goals[0].kpi_id, 'kpi-test-mrr');      // v2 goal carries KPI target
  assert.equal(goals[0].target_value, 6000);

  const tasks = await readJson(`bus/${BU}/tasks.json`);
  const finalizeTask = tasks.find(t => t.category === 'planning_finalize');
  assert.ok(finalizeTask, 'finalize task should exist');
  assert.equal(finalizeTask.origin, 'auto_on_pick');

  const proposals = await readJson(`bus/${BU}/plan_proposals.json`);
  const picked = proposals.find(p => p.id === 'plan-proposal-test-1');
  const siblings = proposals.filter(p => p.id !== 'plan-proposal-test-1');
  assert.equal(picked.status, 'picked');
  siblings.forEach(s => assert.equal(s.status, 'rejected'));
});

test('S4 — POST /api/select-plan-proposal (active exists) → new plan lands queued', async () => {
  await seedFreshBu({ withActive: true, withProposals: true });
  const mod = await import('../api/select-plan-proposal.js');
  const r = await invoke(mod, { bu: BU, proposal_id: 'plan-proposal-test-2' });
  assert.equal(r.status, 200);

  const plans = await readJson(`bus/${BU}/plans.json`);
  const newPlan = plans.find(p => p.from_proposal === 'plan-proposal-test-2');
  assert.equal(newPlan.status, 'queued');
  assert.equal(newPlan.queued_after_plan_id, 'plan-active-01');
  assert.ok(newPlan.queued_at);
});

test('S5 — POST /api/update-initiative mark_checkpoint_done is gated by open tasks', async () => {
  await seedFreshBu({ withActive: true });
  const mod = await import('../api/update-initiative.js');

  // Attempt 1: open task blocks
  const blocked = await invoke(mod, {
    bu: BU, init_id: 'init-active-01',
    action: 'mark_checkpoint_done', checkpoint_id: 'cp-active-01-1',
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /open task/);

  // Close the task, retry
  const tasks = await readJson(`bus/${BU}/tasks.json`);
  tasks.find(t => t.id === 'task-active-01').status = 'done';
  await writeJson(`bus/${BU}/tasks.json`, tasks);

  const ok = await invoke(mod, {
    bu: BU, init_id: 'init-active-01',
    action: 'mark_checkpoint_done', checkpoint_id: 'cp-active-01-1',
  });
  assert.equal(ok.status, 200);
  const inits = await readJson(`bus/${BU}/initiatives.json`);
  const cp = inits[0].checkpoints.find(c => c.id === 'cp-active-01-1');
  assert.equal(cp.status, 'done');
});

test('S5c — POST /api/update-plan activate on a draft auto-sets finalized_at + activates/queues', async () => {
  await seedFreshBu();
  // Seed a bare draft plan (no finalized_at).
  const now = new Date().toISOString();
  const plans = [{
    id: 'plan-draft-01', bu: BU, title: 'Compose output', status: 'draft',
    period_start: '2026-08-13', period_target_end: '2026-09-13',
    goal_ids: [], initiative_ids: [],
    created_at: now, activated_at: null, finalized_at: null, finalized_by: null,
  }];
  await writeJson(`bus/${BU}/plans.json`, plans);

  const mod = await import('../api/update-plan.js');
  const r = await invoke(mod, { bu: BU, plan_id: 'plan-draft-01', action: 'activate', actor: 'operator' });
  assert.equal(r.status, 200);
  const after = await readJson(`bus/${BU}/plans.json`);
  const p = after.find(x => x.id === 'plan-draft-01');
  assert.equal(p.status, 'active');   // no other active plan, so straight to active
  assert.ok(p.finalized_at, 'finalized_at should be auto-set');
  assert.equal(p.finalized_by, 'operator');
});

test('S5b — POST /api/update-plan discard releases child initiatives back to backlog', async () => {
  await seedFreshBu({ withActive: true });
  // Seed init-active-01 as promoted_to_plan_id → plan-active-01 (which is what
  // the withActive fixture already does implicitly). Confirm it, then discard.
  const initsBefore = await readJson(`bus/${BU}/initiatives.json`);
  // Fixture doesn't set promoted_to_plan_id; do it now to make the test real.
  initsBefore[0].promoted_to_plan_id = 'plan-active-01';
  initsBefore[0].backlog_state = 'promoted_to_plan';
  await writeJson(`bus/${BU}/initiatives.json`, initsBefore);

  const mod = await import('../api/update-plan.js');
  const r = await invoke(mod, { bu: BU, plan_id: 'plan-active-01', action: 'discard' });
  assert.equal(r.status, 200);

  const inits = await readJson(`bus/${BU}/initiatives.json`);
  const released = inits.find(i => i.id === 'init-active-01');
  assert.equal(released.promoted_to_plan_id, null);
  assert.equal(released.backlog_state, 'ready');
  assert.ok(Array.isArray(released.previously_in_plan) && released.previously_in_plan.length >= 1);
  assert.equal(released.previously_in_plan[0].plan_id, 'plan-active-01');
});

test('S6 — POST /api/update-plan complete_cycle auto-promotes the queued plan', async () => {
  await seedFreshBu({ withActive: true, withQueued: true });
  const mod = await import('../api/update-plan.js');
  const r = await invoke(mod, {
    bu: BU, plan_id: 'plan-active-01', action: 'complete_cycle',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.auto_promoted_plan_id, 'plan-queued-01');

  const plans = await readJson(`bus/${BU}/plans.json`);
  assert.equal(plans.find(p => p.id === 'plan-active-01').status, 'completed');
  assert.equal(plans.find(p => p.id === 'plan-queued-01').status, 'active');
});

test('S7 — POST /api/dismiss-plan-proposals marks a whole set as rejected', async () => {
  const { psetId } = await seedFreshBu({ withProposals: true });
  const mod = await import('../api/dismiss-plan-proposals.js');
  const r = await invoke(mod, { bu: BU, proposal_set_id: psetId });
  assert.equal(r.status, 200);
  assert.equal(r.body.dismissed_count, 3);

  const proposals = await readJson(`bus/${BU}/plan_proposals.json`);
  proposals.forEach(p => assert.equal(p.status, 'rejected'));
});

test('S8 — POST /api/generate-retrospective files a retro task for a completed plan', async () => {
  await seedFreshBu({ withCompleted: true });
  const mod = await import('../api/generate-retrospective.js');
  const r = await invoke(mod, { bu: BU, plan_id: 'plan-completed-01' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const plans = await readJson(`bus/${BU}/plans.json`);
  assert.ok(plans[0].retrospective_generated_at);
  assert.ok(plans[0].retrospective_task_id);

  const tasks = await readJson(`bus/${BU}/tasks.json`);
  const retro = tasks.find(t => t.category === 'retrospective');
  assert.ok(retro);
  assert.equal(retro.status, 'approved');
});
