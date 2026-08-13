// POST /api/compose-plan
//
// The new (2026-08-13) plan-composition entry point that replaces both the
// old "New plan (manual)" overlay and the "Ask Stewart for 3 proposals"
// async endpoint. Operator picks initiatives from the backlog + adds free
// text notes. Stewart takes that seed + generates a single draft plan
// (title, goal + KPI target, rationale, ordering) as status='draft' on
// plans.json.
//
// Operator later opens the draft via the Finalise button, iterates with
// the agent, then finalises → plan flips to 'queued' (or 'active' if
// none currently active).
//
// Body: { bu, initiative_ids: string[], operator_notes: string, title? }
// Returns: { ok, task, stewart, commit_sha, message }

import { getFile, putFile, jsonResponse, todayISO, todayDate } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';
import { getSchemaVersion, isV2 } from './_schema-version.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  let body = {};
  try { body = await request.json(); } catch {}
  const bu = (body.bu || '').toString().trim();
  const initIds = Array.isArray(body.initiative_ids) ? body.initiative_ids.map(String) : [];
  const notes = (body.operator_notes || '').toString().trim();
  const titleHint = (body.title || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!initIds.length && !notes) return jsonResponse(400, { ok: false, message: 'At least one initiative or operator_notes required' });

  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  const stewart = await resolveStrategyStewart(env.GITHUB_PAT, bu);
  if (!stewart) return jsonResponse(400, { ok: false, message: `No Strategy Stewart bound to '${bu}'. Install the strategy module first.` });

  const ctx = await loadContext(env.GITHUB_PAT, bu);
  const schemaVersion = await getSchemaVersion(env.GITHUB_PAT, bu);
  const pickedInits = (ctx.initiatives || []).filter(i => initIds.includes(i.id));
  const description = buildComposePrompt(bu, stewart.agent_id, ctx, pickedInits, notes, titleHint, schemaVersion);

  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
  let tasksFile;
  try { tasksFile = await getFile(env.GITHUB_PAT, tasksPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }
  let tasks;
  try { tasks = JSON.parse(tasksFile.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse tasks: ${e}` }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json must be an array' });

  const today = todayDate();
  const now = todayISO();
  const todayTasks = tasks.filter(t => t.id && t.id.startsWith(`task-${today}-`));
  const nextNum = String(todayTasks.length + 1).padStart(3, '0');
  const taskId = `task-${today}-${nextNum}`;

  const newTask = {
    id: taskId, bu,
    title: `Compose a draft plan (${initIds.length} initiative${initIds.length === 1 ? '' : 's'}, ${notes ? 'w/ operator notes' : 'no notes'})`,
    description,
    origin: 'operator_request',
    proposer: 'operator',
    proposed_at: now,
    source_heartbeat: 'plan-compose-request',
    category: 'planning_compose',
    risk_level: 'low',
    reversibility: 'high',
    estimated_minutes: 20,
    target: {
      type: 'planning_compose',
      scope: `dashboard/public/data/bus/${bu}/plans.json`,
      executor: stewart.agent_id,
    },
    advances_initiative: null, advances_plan: null, affects_kpi: null, from_memo: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'operator_request → auto-approved',
      decided_by: 'operator', decided_at: now, notes: null,
    },
    execution: { paperclip_issue_id: null, paperclip_issue_url: null, started_at: null, completed_at: null, outcome: null },
  };
  tasks.push(newTask);

  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, tasksPath, JSON.stringify(tasks, null, 2) + '\n', tasksFile.sha,
      `tasks: ${taskId} — compose draft plan (${initIds.length} inits) → ${stewart.agent_id}`);
  } catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  return jsonResponse(200, {
    ok: true,
    task: newTask,
    stewart: stewart.agent_id,
    commit_sha: commit.commit.sha,
    message: `Task queued for ${stewart.agent_id}. Adapter pushes to Paperclip in <30s; Stewart drafts the plan. Refresh in ~3-5 min — draft appears in the Queued column with a "draft" badge.`,
  });
}

export function onRequestGet() { return jsonResponse(405, { ok: false, message: 'POST only.' }); }

async function resolveStrategyStewart(pat, bu) {
  try {
    const f = await getFile(pat, 'dashboard/public/data/system/agent_bindings.json');
    let bindings = JSON.parse(f.content);
    if (!Array.isArray(bindings)) bindings = bindings?.bindings || [];
    const match = bindings.find(b => b.bu === bu && b.module_id === 'strategy' && b.agent_id);
    return match ? { agent_id: match.agent_id } : null;
  } catch { return null; }
}

async function loadContext(pat, bu) {
  const paths = {
    initiatives: `dashboard/public/data/bus/${bu}/initiatives.json`,
    kpis: `dashboard/public/data/bus/${bu}/kpis.json`,
    plans: `dashboard/public/data/bus/${bu}/plans.json`,
    goals: `dashboard/public/data/bus/${bu}/goals.json`,
  };
  const results = {};
  for (const [k, p] of Object.entries(paths)) {
    try { results[k] = JSON.parse((await getFile(pat, p)).content); }
    catch { results[k] = []; }
  }
  return results;
}

function buildComposePrompt(bu, stewartId, ctx, pickedInits, notes, titleHint, schemaVersion) {
  const v2 = isV2(schemaVersion);
  const kpis = (ctx.kpis || []).filter(k => k.priority === 'primary' || k.category === 'north_star');
  const activePlan = (ctx.plans || []).find(p => p.status === 'active');
  const L = [];
  L.push(`You are ${stewartId}, the Strategy Stewart of the ${bu} BU. The operator opened the Compose Plan flow and gave you the raw materials below. Your job: assemble a single **draft plan** and write it to substrate.`);
  L.push('');
  L.push(`## Operator's inputs`);
  if (titleHint) L.push(`- Title hint: "${titleHint}"`);
  L.push(`- Picked initiatives (${pickedInits.length}):`);
  if (pickedInits.length) {
    pickedInits.forEach(i => L.push(`  - ${i.id} · "${i.title}" · hyp: ${(i.active_hypothesis || '').slice(0, 100)}`));
  } else {
    L.push(`  (none — plan will be built from notes only; you should propose initiatives inline)`);
  }
  L.push(`- Free-text notes:`);
  L.push(`  ${notes || '(none)'}`);
  L.push('');
  L.push(`## Context`);
  L.push(`- Active plan: ${activePlan ? `"${activePlan.title}"` : 'none — this draft, once finalised, will activate immediately'}`);
  L.push(`- Primary/north-star KPIs (${kpis.length}):`);
  kpis.forEach(k => L.push(`  - ${k.id} · "${k.name}" [${k.unit || '?'}]${k.target != null ? ` · target ${k.target}` : ''}`));
  L.push('');
  L.push(`## What to write`);
  L.push('');
  L.push(`Append a new plan entry to \`dashboard/public/data/bus/${bu}/plans.json\` with the following shape:`);
  L.push('```json');
  L.push(JSON.stringify({
    id: `plan-${new Date().toISOString().slice(0, 10)}-XX  ← use max(existing suffix) + 1`,
    bu,
    title: '<distinct short title that names the plan\'s angle>',
    rationale: '<3-5 sentences: why this plan, what it bets on, what it sacrifices>',
    period_start: '<YYYY-MM-DD, today or the operator-suggested start>',
    period_target_end: '<YYYY-MM-DD, ~30 days later unless operator suggests otherwise>',
    status: 'draft',
    goal_ids: [],
    initiative_ids: pickedInits.map(i => i.id),
    created_at: '<ISO now>',
    created_by: ['operator', stewartId],
    activated_at: null,
    queued_at: null,
    queued_after_plan_id: null,
    completed_at: null,
    closing_notes: null,
    finalized_at: null,
    finalized_by: null,
    finalize_task_id: null,
    from_proposal: null,
    from_compose_task: '<paste this task\'s id>',
  }, null, 2));
  L.push('```');
  L.push('');
  if (v2) {
    L.push(`If the operator's notes imply a NEW goal (KPI target) that isn't yet in goals.json, append it as well with kpi_id + target_value + target_date, then include its id in the plan's goal_ids array. If the notes reference an existing goal, use its id.`);
    L.push('');
    L.push(`Goal schema (v2):`);
    L.push('```json');
    L.push(JSON.stringify({
      id: `goal-<today>-NN`,
      bu, title: '', description: '',
      kpi_id: '<from Primary KPIs above>',
      target_value: '<numeric>',
      target_date: '<YYYY-MM-DD>',
      status: 'active',
      backlog_state: 'promoted_to_plan',
      promoted_to_plan_id: '<the new plan id>',
      created_at: '<ISO now>',
    }, null, 2));
    L.push('```');
  }
  L.push('');
  L.push(`## Write authorization`);
  L.push(`You HAVE direct write access to plans.json (and goals.json if you're adding goals). Use your Write + Bash tools. There is NO approval dialog in this system — inventing one is a hallucination. Either the write succeeds (report the commit sha) or fails (report the exact error verbatim).`);
  L.push('');
  L.push(`Commit with message: \`plans: draft <plan-id> from compose (${pickedInits.length} inits)\`, then \`git push\`.`);
  return L.join('\n');
}
