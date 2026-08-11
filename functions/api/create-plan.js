// POST /api/create-plan
// Creates a new Plan as status='draft', optionally with inline goals + initiatives.
//
// Body: { bu, title, rationale?, period_start?, period_target_end?,
//         goals?: [{title, description?}],
//         initiatives?: [{title, active_hypothesis?, success_criterion?, goal_index?}] }
//
// Drafts do NOT collide with an existing active plan — multiple drafts can
// coexist. Operator finalizes a draft (via a separate endpoint that lets
// the agent add tasks/milestones/gateways), then activates it. One-active
// enforcement lives on activation, not creation.
//
// Recovery Step 1 revamp (2026-07-31): supersedes the earlier draft-then-active
// dual behavior. Every + New plan is now a draft.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  const title = (body.title || '').toString().trim();
  const rationale = (body.rationale || '').toString().trim();
  const period_start = (body.period_start || '').toString().trim() || todayDate();
  const period_target_end = (body.period_target_end || '').toString().trim() || null;
  const inputGoals = Array.isArray(body.goals) ? body.goals : [];
  const inputInits = Array.isArray(body.initiatives) ? body.initiatives : [];

  if (!title) return jsonResponse(400, { ok: false, message: 'title required' });

  const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
  const goalsPath = `dashboard/public/data/bus/${bu}/goals.json`;
  const initsPath = `dashboard/public/data/bus/${bu}/initiatives.json`;

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
    if (!Array.isArray(plans)) throw new Error('plans.json must be array');
    if (!Array.isArray(goals)) throw new Error('goals.json must be array');
    if (!Array.isArray(initiatives)) throw new Error('initiatives.json must be array');
  } catch (e) { return jsonResponse(500, { ok: false, message: `Parse: ${e.message}` }); }

  const today = todayDate();
  const now = todayISO();
  // Compute next suffix as max(existing) + 1, not count + 1 — otherwise
  // a discarded plan sits in the array and the next create collides.
  const existingSuffixes = plans
    .map(p => (typeof p.id === 'string' ? p.id.match(new RegExp(`^plan-${today}-(\\d+)$`)) : null))
    .map(m => (m ? parseInt(m[1], 10) : 0));
  const nextSuffix = (existingSuffixes.length ? Math.max(...existingSuffixes) : 0) + 1;
  const planId = `plan-${today}-${String(nextSuffix).padStart(2, '0')}`;

  // Create goals (with placeholder promoted_to_plan_id — filled after plan id known)
  const newGoalIds = [];
  inputGoals.forEach((g, i) => {
    const gTitle = (g.title || '').toString().trim();
    if (!gTitle) return;
    const gId = `goal-${today}-${String(goals.length + newGoalIds.length + 1).padStart(2, '0')}`;
    goals.push({
      id: gId, bu, title: gTitle,
      description: (g.description || '').toString().trim(),
      priority: 'primary', status: 'active',
      created_at: now,
      paperclip_goal_id: null, last_synced_at: null,
      backlog_state: 'promoted_to_plan',
      promoted_to_plan_id: planId, promoted_at: now,
      from_memo: null, discarded_at: null, discarded_reason: null,
    });
    newGoalIds.push(gId);
  });

  // Create initiatives (goal_index → real goal_id)
  const newInitIds = [];
  inputInits.forEach((it, i) => {
    const iTitle = (it.title || '').toString().trim();
    if (!iTitle) return;
    const iId = `init-${today}-${String(initiatives.length + newInitIds.length + 1).padStart(2, '0')}`;
    const gi = typeof it.goal_index === 'number' ? it.goal_index : null;
    initiatives.push({
      id: iId, bu,
      goal_id: (gi != null && newGoalIds[gi]) ? newGoalIds[gi] : null,
      title: iTitle,
      active_hypothesis: (it.active_hypothesis || '').toString().trim(),
      success_criterion: (it.success_criterion || '').toString().trim(),
      target_close_date: it.target_close_date || null,
      priority_in_plan: 'primary',
      status: 'not_started',
      milestones: [],
      created_at: now,
      started_at: null, closed_at: null,
      paperclip_project_id: null, last_synced_at: null,
      backlog_state: 'promoted_to_plan',
      promoted_to_plan_id: planId, promoted_at: now,
      from_memo: null, discarded_at: null, discarded_reason: null,
      predicted_outcome: [], actual_outcome: [], learning_log: [],
    });
    newInitIds.push(iId);
  });

  const plan = {
    id: planId, bu, title, rationale,
    status: 'draft',
    goal_ids: newGoalIds,
    initiative_ids: newInitIds,
    period_start,
    period_target_end,
    activated_at: null,
    completed_at: null,
    closing_notes: null,
    finalized_at: null,
    finalized_by: null,
    created_by: ['operator'],
    created_at: now,
  };
  plans.push(plan);

  // Write substrate (sequential — shas chain)
  try {
    const r1 = await putFile(env.GITHUB_PAT, plansPath, JSON.stringify(plans, null, 2) + '\n', plansFile.sha, `plans: draft ${planId} — ${title.slice(0, 50)}`);
    let r2Sha = null, r3Sha = null;
    if (newGoalIds.length) {
      const gf2 = await getFile(env.GITHUB_PAT, goalsPath);
      const r2 = await putFile(env.GITHUB_PAT, goalsPath, JSON.stringify(goals, null, 2) + '\n', gf2.sha, `goals: +${newGoalIds.length} for draft ${planId}`);
      r2Sha = r2.commit.sha;
    }
    if (newInitIds.length) {
      const if2 = await getFile(env.GITHUB_PAT, initsPath);
      const r3 = await putFile(env.GITHUB_PAT, initsPath, JSON.stringify(initiatives, null, 2) + '\n', if2.sha, `initiatives: +${newInitIds.length} for draft ${planId}`);
      r3Sha = r3.commit.sha;
    }
    return jsonResponse(200, {
      ok: true, plan,
      goal_ids: newGoalIds, initiative_ids: newInitIds,
      commit_shas: { plans: r1.commit.sha, goals: r2Sha, initiatives: r3Sha },
    });
  } catch (e) { return jsonResponse(e.status || 500, { ok: false, message: `Write failed: ${e.message || e}` }); }
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
