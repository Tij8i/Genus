// POST /api/generate-retrospective
//
// Feature (e): 30-day retrospective. Files an auto-approved task to the
// Strategy Stewart of the given BU asking them to synthesize a retrospective
// for a completed plan. Stewart reads plan.expected_impact + actual KPI
// measurements + initiative outcomes, writes learnings, appends to
// retrospectives.jsonl, and stamps plans.json with retrospective_generated_at.
//
// Body: { bu, plan_id }
// Returns: { ok, task, stewart, commit_sha }
//
// Also runs autonomously via the in-Node scheduler (server/index.js →
// startAutonomousScheduler → retroTick): every configured BU is scanned for
// completed plans whose completed_at + 30d has elapsed AND that have no
// retrospective_generated_at stamp yet.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

const PAT = 'local-mode-no-pat';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  let body = {};
  try { body = await request.json(); } catch {}
  const bu = (body.bu || '').toString().trim();
  const planId = (body.plan_id || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!planId) return jsonResponse(400, { ok: false, message: 'plan_id required' });

  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  try {
    const result = await generateRetrospectiveForBu({ bu, plan_id: planId, pat: env.GITHUB_PAT });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}

// Exported so the scheduler can call it without an HTTP round-trip.
// Pass pat explicitly (scheduler uses local-mode sentinel).
export async function generateRetrospectiveForBu({ bu, plan_id, pat }) {
  const usePat = pat || PAT;

  const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
  const plansFile = await getFile(usePat, plansPath);
  const plans = JSON.parse(plansFile.content);
  if (!Array.isArray(plans)) throw new Error('plans.json is not an array');
  const plan = plans.find(p => p.id === plan_id);
  if (!plan) { const e = new Error(`Plan ${plan_id} not found`); e.status = 404; throw e; }
  if (plan.status !== 'completed') {
    const e = new Error(`Retrospective only valid on completed plans (${plan_id} is ${plan.status})`);
    e.status = 409; throw e;
  }
  if (plan.retrospective_generated_at) {
    const e = new Error(`Retrospective already generated for ${plan_id} at ${plan.retrospective_generated_at}`);
    e.status = 409; throw e;
  }

  const stewart = await resolveStrategyStewart(usePat, bu);
  if (!stewart) {
    const e = new Error(`No Strategy Stewart bound to BU '${bu}'. Install the strategy module first.`);
    e.status = 400; throw e;
  }

  // Load initiatives + kpis for context.
  let initiatives = [];
  let kpis = [];
  try { initiatives = JSON.parse((await getFile(usePat, `dashboard/public/data/bus/${bu}/initiatives.json`)).content); } catch {}
  try { kpis = JSON.parse((await getFile(usePat, `dashboard/public/data/bus/${bu}/kpis.json`)).content); } catch {}

  const description = buildRetroPrompt(bu, stewart.agent_id, plan, initiatives, kpis);

  // File the retrospective task, auto-approved.
  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
  const tasksFile = await getFile(usePat, tasksPath);
  const tasks = JSON.parse(tasksFile.content);
  if (!Array.isArray(tasks)) throw new Error('tasks.json is not an array');
  const today = todayDate();
  const now = todayISO();
  const todayTasks = tasks.filter(t => t.id && t.id.startsWith(`task-${today}-`));
  const nextNum = String(todayTasks.length + 1).padStart(3, '0');
  const taskId = `task-${today}-${nextNum}`;

  const newTask = {
    id: taskId,
    bu,
    title: `Retrospective for ${plan_id} (30d post-close)`,
    description,
    origin: 'auto_retro',
    proposer: 'scheduler',
    proposed_at: now,
    source_heartbeat: 'retro-scheduler',
    category: 'retrospective',
    risk_level: 'low',
    reversibility: 'high',
    estimated_minutes: 20,
    target: {
      type: 'retrospective_synthesis',
      scope: `dashboard/public/data/bus/${bu}/retrospectives.jsonl`,
      executor: stewart.agent_id,
    },
    advances_initiative: null,
    advances_plan: plan_id,
    affects_kpi: null,
    from_memo: null,
    requires_operator_input: false,
    operator_input_prompt: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'auto_retro → auto-approved (scheduled at plan.completed_at + 30d)',
      decided_by: 'scheduler',
      decided_at: now,
      notes: null,
    },
    execution: { paperclip_issue_id: null, paperclip_issue_url: null, started_at: null, completed_at: null, outcome: null },
  };
  tasks.push(newTask);
  const tasksCommit = await putFile(usePat, tasksPath, JSON.stringify(tasks, null, 2) + '\n', tasksFile.sha,
    `tasks: ${taskId} — auto-retro for ${plan_id} (→ ${stewart.agent_id})`);

  // Stamp the plan so we don't file another retro on the next tick.
  plan.retrospective_generated_at = now;
  plan.retrospective_task_id = taskId;
  const plansFile2 = await getFile(usePat, plansPath);
  const plans2 = JSON.parse(plansFile2.content);
  const p2 = plans2.find(p => p.id === plan_id);
  if (p2) {
    p2.retrospective_generated_at = now;
    p2.retrospective_task_id = taskId;
  }
  const plansCommit = await putFile(usePat, plansPath, JSON.stringify(plans2, null, 2) + '\n', plansFile2.sha,
    `plans: ${plan_id} — retrospective task ${taskId} filed`);

  return {
    task: newTask,
    stewart: stewart.agent_id,
    tasks_commit_sha: tasksCommit.commit.sha,
    plans_commit_sha: plansCommit.commit.sha,
    message: `Retrospective task ${taskId} filed for plan ${plan_id} (→ ${stewart.agent_id}).`,
  };
}

async function resolveStrategyStewart(pat, bu) {
  try {
    const f = await getFile(pat, 'dashboard/public/data/system/agent_bindings.json');
    let bindings = JSON.parse(f.content);
    if (!Array.isArray(bindings)) bindings = bindings?.bindings || [];
    const match = bindings.find(b => b.bu === bu && b.module_id === 'strategy' && b.agent_id);
    return match ? { agent_id: match.agent_id } : null;
  } catch { return null; }
}

function buildRetroPrompt(bu, stewartId, plan, initiatives, kpis) {
  const planInits = (plan.initiative_ids || []).map(iid => initiatives.find(i => i.id === iid)).filter(Boolean);
  const expected = Array.isArray(plan.expected_impact) ? plan.expected_impact : [];
  const L = [];
  L.push(`You are ${stewartId}, Strategy Stewart of the ${bu} BU. The 30-day observation window after this plan closed has elapsed. Write the retrospective.`);
  L.push('');
  L.push(`## Plan under review`);
  L.push(`- id: ${plan.id}`);
  L.push(`- title: "${plan.title}"`);
  L.push(`- period: ${plan.period_start} → ${plan.period_target_end}`);
  L.push(`- completed_at: ${plan.completed_at}`);
  L.push(`- closing_notes: ${plan.closing_notes ? String(plan.closing_notes).slice(0, 500) : '—'}`);
  L.push('');
  L.push(`## Predicted vs actual — from plan.expected_impact`);
  if (expected.length) {
    expected.forEach(e => {
      const kpi = kpis.find(k => k.id === e.kpi_id);
      L.push(`- KPI ${e.kpi_id}${kpi ? ` ("${kpi.name}", ${kpi.unit})` : ''} · predicted Δ ${e.predicted_delta} (${e.mechanism || 'no mechanism recorded'}, confidence: ${e.confidence || 'unspecified'})`);
    });
  } else {
    L.push('No expected_impact was captured on this plan. Note that in the retrospective — this is a gap to close on future plans.');
  }
  L.push('');
  L.push(`## Initiatives (${planInits.length})`);
  planInits.forEach(i => {
    const actuals = (i.actual_outcome || []).map(a => `${a.kpi} Δ ${a.measured_delta}`).join(', ');
    const learnings = (i.learning_log || []).map(l => `- ${l.body}`).join('\n');
    L.push(`- ${i.id} · "${i.title}" · final status: ${i.status || '?'}`);
    if (actuals) L.push(`  actuals: ${actuals}`);
    if (learnings) L.push(`  learnings:\n${learnings}`);
  });
  L.push('');
  L.push(`## Your task`);
  L.push(`Read the current values of the primary + north-star KPIs (query kpis.json + measurements/<kpi_id>.jsonl). Compare against predicted deltas. Then write ONE retrospective entry to \`dashboard/public/data/bus/${bu}/retrospectives.jsonl\` (create the file if missing) with this shape:`);
  L.push('```json');
  L.push(JSON.stringify({
    id: `retro-${plan.id}`,
    bu,
    plan_id: plan.id,
    generated_at: '<ISO now>',
    generated_by: stewartId,
    window: '30d_post_close',
    predicted_vs_actual: [
      {
        kpi_id: '<from plan.expected_impact>',
        predicted_delta: '<numeric>',
        actual_delta: '<numeric — measured from measurements/<kpi_id>.jsonl between plan.completed_at and today>',
        gap: '<actual - predicted>',
        verdict: 'on_target | over | under | not_measurable',
      },
    ],
    what_worked: ['<one-line item>', '...'],
    what_missed: ['<one-line item>', '...'],
    suggested_improvements_for_next_plan: ['<one-line actionable suggestion Stewart could implement>', '...'],
    summary: '<one paragraph: outcome vs predictions in plain language>',
  }, null, 2));
  L.push('```');
  L.push('');
  L.push(`Commit with message \`retrospectives: +${plan.id} auto-retro\`, git push. No other side effects.`);
  return L.join('\n');
}
