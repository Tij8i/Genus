// POST /api/finalize-plan-draft
//
// Operator clicks "Finalize with Stewart" on a draft plan. This function:
//   1. Verifies the draft exists + is status=draft
//   2. Resolves the Strategy Stewart of the BU from agent_bindings.json
//   3. Writes an auto-approved task at status=approved, targeted at that
//      Stewart, with a rich prompt: "read this draft + add milestones +
//      tasks under each initiative per the Initiative-lifecycle rules"
//   4. Adapter pushes to Paperclip within 30s; Stewart runs; writes
//      milestones[] on each initiative, tasks[] with advances_initiative +
//      advances_milestone; then sets plan.finalized_at + finalized_by
//   5. On next Planning-view load, draft shows [Activate] instead of
//      [Finalize with Stewart]
//
// Body: { bu, plan_id }

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }
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

  // Resolve Stewart
  const stewart = await resolveStrategyStewart(env.GITHUB_PAT, bu);
  if (!stewart) return jsonResponse(400, { ok: false, message: `No Strategy Stewart bound to '${bu}'. Install the strategy module first.` });

  // Load plans + related substrate
  const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
  const goalsPath = `dashboard/public/data/bus/${bu}/goals.json`;
  const initsPath = `dashboard/public/data/bus/${bu}/initiatives.json`;
  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;

  let plansFile, goalsFile, initsFile;
  try {
    [plansFile, goalsFile, initsFile] = await Promise.all([
      getFile(env.GITHUB_PAT, plansPath),
      getFile(env.GITHUB_PAT, goalsPath),
      getFile(env.GITHUB_PAT, initsPath),
    ]);
  } catch (e) { return jsonResponse(e.status || 500, { ok: false, message: `Load failed: ${e.message || e}` }); }

  let plans, goals, initiatives;
  try {
    plans = JSON.parse(plansFile.content || '[]');
    goals = JSON.parse(goalsFile.content || '[]');
    initiatives = JSON.parse(initsFile.content || '[]');
  } catch (e) { return jsonResponse(500, { ok: false, message: `Parse: ${e}` }); }

  const plan = plans.find(p => p.id === planId);
  if (!plan) return jsonResponse(404, { ok: false, message: `Plan ${planId} not found` });
  if (plan.status !== 'draft') return jsonResponse(409, { ok: false, message: `Plan ${planId} is ${plan.status}, not draft` });
  if (plan.finalized_at) return jsonResponse(409, { ok: false, message: `Plan ${planId} was already finalized at ${plan.finalized_at}` });

  const planGoals = (plan.goal_ids || []).map(id => goals.find(g => g.id === id)).filter(Boolean);
  const planInits = (plan.initiative_ids || []).map(id => initiatives.find(i => i.id === id)).filter(Boolean);

  // Load current tasks.json (needed to append the finalize task)
  let tasksFile;
  try { tasksFile = await getFile(env.GITHUB_PAT, tasksPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: `Load tasks: ${e.message || e}` }); }
  let tasks;
  try { tasks = JSON.parse(tasksFile.content || '[]'); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse tasks: ${e}` }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json must be array' });

  // Build id + prompt
  const today = todayDate();
  const now = todayISO();
  const todayTasks = tasks.filter(t => t.id && t.id.startsWith(`task-${today}-`));
  const nextNum = String(todayTasks.length + 1).padStart(3, '0');
  const taskId = `task-${today}-${nextNum}`;

  const description = buildFinalizePrompt(bu, stewart.agent_id, plan, planGoals, planInits);

  const newTask = {
    id: taskId,
    bu,
    title: `Finalize plan draft ${plan.id} — add tasks + milestones + gateways`,
    description,
    origin: 'operator_request',
    proposer: 'operator',
    proposed_at: now,
    source_heartbeat: 'plan-draft-finalize',
    category: 'planning_finalize',
    risk_level: 'low',
    reversibility: 'high',
    estimated_minutes: 30,
    target: {
      type: 'planning_finalize',
      scope: `dashboard/public/data/bus/${bu}/initiatives.json + tasks.json + plans.json`,
      executor: stewart.agent_id,
    },
    advances_initiative: null,
    advances_plan: plan.id,
    affects_kpi: null,
    from_memo: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'operator_request → auto-approved',
      decided_by: 'operator',
      decided_at: now,
      notes: null,
    },
    execution: {
      paperclip_issue_id: null,
      paperclip_issue_url: null,
      started_at: null,
      completed_at: null,
      outcome: null,
    },
  };

  tasks.push(newTask);
  try {
    const commit = await putFile(env.GITHUB_PAT, tasksPath, JSON.stringify(tasks, null, 2) + '\n', tasksFile.sha, `tasks: ${taskId} — finalize draft ${plan.id} (operator → ${stewart.agent_id})`);
    return jsonResponse(200, {
      ok: true,
      task: newTask,
      stewart: stewart.agent_id,
      commit_sha: commit.commit.sha,
      message: `Task queued for ${stewart.agent_id}. Adapter pushes to Paperclip in <30s; Stewart adds tasks + milestones under each initiative + sets plan.finalized_at. Refresh in ~3-5 min to see the [Activate] button.`,
    });
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
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

function buildFinalizePrompt(bu, stewartId, plan, planGoals, planInits) {
  const L = [];
  L.push(`You are ${stewartId} — the Strategy Stewart of the ${bu} BU. The operator has drafted a plan and asked you to finalize it: add milestones + tasks so it's executable.`);
  L.push('');
  L.push(`## The draft plan`);
  L.push(`- **ID**: ${plan.id}`);
  L.push(`- **Title**: ${plan.title}`);
  L.push(`- **Period**: ${plan.period_start || '?'} → ${plan.period_target_end || '?'}`);
  L.push(`- **Rationale**: ${plan.rationale || '—'}`);
  L.push('');
  L.push(`## Goals in this plan (${planGoals.length})`);
  planGoals.forEach(g => L.push(`- ${g.id} · **${g.title}** — ${g.description || '(no description)'}`));
  L.push('');
  L.push(`## Initiatives (${planInits.length}) — you must populate milestones + tasks under each`);
  planInits.forEach(i => {
    L.push(`- **${i.id}** · "${i.title}"`);
    L.push(`    - goal: ${i.goal_id || '(unassigned)'}`);
    L.push(`    - hypothesis: ${i.active_hypothesis || '(none)'}`);
    L.push(`    - success criterion: ${i.success_criterion || '(none)'}`);
    L.push(`    - milestones today: ${(i.milestones || []).length}`);
  });
  L.push('');
  L.push(`## What to do`);
  L.push('');
  L.push(`For each initiative in this plan:`);
  L.push(`1. **Add 2–4 milestones** to the initiative's \`milestones[]\` array. Each milestone is a named checkpoint the operator can validate. Schema per milestone:`);
  L.push('```json');
  L.push(JSON.stringify({
    id: 'ms-<initiative-id>-<n>',
    name: '<short name of the checkpoint>',
    criticality: 'critical | strategic | tactical',
    status: 'not_started',
    gateway: true,
    source: 'stewart_finalize',
    created_at: '<ISO now>',
  }, null, 2));
  L.push('```');
  L.push(`Follow the milestone rules in \`docs/system/GATEWAYS_AND_MILESTONES.md\`: ≤5 gateways per initiative, meaningful strategic checkpoints (not low-level ticks). Tag \`gateway: true\` on the ones the operator MUST sign off on.`);
  L.push('');
  L.push(`2. **Add tasks** to \`tasks.json\` that advance each milestone. Each task has:`);
  L.push('```json');
  L.push(JSON.stringify({
    id: 'task-YYYY-MM-DD-NNN',
    bu,
    title: '<concrete action>',
    description: '<what to do, what to produce, where to write>',
    category: 'execution',
    status: 'proposed',
    advances_initiative: '<init-id>',
    advances_milestone: '<ms-id>',
    target: { executor: '<the-right-agent-name>' },
    priority: 'medium',
    estimated_minutes: 30,
    risk_level: 'low',
    reversibility: 'high',
    requires_operator_input: false,
    operator_input_prompt: null,
    created_at: '<ISO now>',
  }, null, 2));
  L.push('```');
  L.push('');
  L.push(`**Feature (c) — human-input tasks grouped at plan start.** Set \`requires_operator_input: true\` on any task where you genuinely need information, decisions, or artifacts from the operator BEFORE an agent can execute (e.g. brand tone, target customer names, financial thresholds, access credentials, brainstorming choices). When true, also set \`operator_input_prompt\` to a one-sentence question the UI can display next to the task. **These tasks must be listed FIRST in the tasks.json array for their initiative**, so the operator can front-load their input and then let the agent execute autonomously. Do NOT flag tasks that just need routine oversight — reserve this for cases where execution is genuinely blocked without operator input.`);
  L.push('');
  L.push(`Tasks land as status=**proposed** — the operator reviews + approves them via the Backlog / Suggestions flow before adapter pushes to Paperclip.`);
  L.push('');
  L.push(`3. **Update the plan**: set \`finalized_at\` to the current ISO timestamp and \`finalized_by\` to your agent name.`);
  L.push('');
  L.push(`## Output`);
  L.push('');
  L.push(`Write updates to:`);
  L.push(`- \`dashboard/public/data/bus/${bu}/initiatives.json\` (add milestones[] on each initiative)`);
  L.push(`- \`dashboard/public/data/bus/${bu}/tasks.json\` (append tasks)`);
  L.push(`- \`dashboard/public/data/bus/${bu}/plans.json\` (set finalized_at + finalized_by on ${plan.id})`);
  L.push('');
  L.push(`Commit with message \`plans: finalize ${plan.id} — <N> milestones + <M> tasks added\`, git push.`);
  return L.join('\n');
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
