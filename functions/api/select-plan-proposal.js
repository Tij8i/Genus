// POST /api/select-plan-proposal
//
// Operator picks one of the 3 proposals the Stewart drafted.
//   - Copies the picked proposal into plans.json as status="draft"
//     (operator still activates it explicitly via update-plan)
//   - Copies proposed_goals + proposed_initiatives into goals.json + initiatives.json
//     with backlog_state="promoted_to_plan"
//   - Marks the picked proposal status="picked"; siblings in same set → "rejected"
//
// Body: { bu, proposal_id }
//
// Recovery merge Step 1 (2026-07-31): ported from 5fc65d7 (2026-06-19 working era).
// Original hardcoded 'tuto-stewart' in created_by; this version records the
// resolved Stewart from agent_bindings.json — no more Tuto-only assumption.

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const proposalId = (body.proposal_id || '').toString();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!proposalId) return jsonResponse(400, { ok: false, message: 'proposal_id required' });

  // i38: BU-isolation on mutation
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  // Resolve Stewart for credit line
  const stewartId = await resolveStrategyStewartId(env.GITHUB_PAT, bu);

  const proposalsPath = `dashboard/public/data/bus/${bu}/plan_proposals.json`;
  const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
  const goalsPath = `dashboard/public/data/bus/${bu}/goals.json`;
  const initsPath = `dashboard/public/data/bus/${bu}/initiatives.json`;

  let proposalsFile, plansFile, goalsFile, initsFile;
  try {
    [proposalsFile, plansFile, goalsFile, initsFile] = await Promise.all([
      getFile(env.GITHUB_PAT, proposalsPath),
      getFile(env.GITHUB_PAT, plansPath),
      getFile(env.GITHUB_PAT, goalsPath),
      getFile(env.GITHUB_PAT, initsPath),
    ]);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: `Load failed: ${e.message || e}` });
  }

  let proposals, plans, goals, initiatives;
  try {
    proposals = JSON.parse(proposalsFile.content);
    plans = JSON.parse(plansFile.content);
    goals = JSON.parse(goalsFile.content);
    initiatives = JSON.parse(initsFile.content);
    if (!Array.isArray(proposals)) return jsonResponse(500, { ok: false, message: 'plan_proposals.json must be an array' });
    if (!Array.isArray(plans)) return jsonResponse(500, { ok: false, message: 'plans.json must be an array' });
    if (!Array.isArray(goals)) return jsonResponse(500, { ok: false, message: 'goals.json must be an array' });
    if (!Array.isArray(initiatives)) return jsonResponse(500, { ok: false, message: 'initiatives.json must be an array' });
  } catch (e) {
    return jsonResponse(500, { ok: false, message: `Parse error: ${e}` });
  }

  const picked = proposals.find(p => p.id === proposalId);
  if (!picked) return jsonResponse(404, { ok: false, message: `Proposal ${proposalId} not found` });
  if (picked.status !== 'proposed') return jsonResponse(409, { ok: false, message: `Proposal already ${picked.status}` });

  const now = todayISO();
  const setId = picked.proposal_set_id;
  const today = now.slice(0, 10);

  // Create goals from proposed_goals
  const proposedGoals = picked.proposed_goals || [];
  const proposedInits = picked.proposed_initiatives || [];
  const newGoalIds = [];
  proposedGoals.forEach((pg, i) => {
    const gId = `goal-${today}-${String(goals.length + i + 1).padStart(2, '0')}`;
    goals.push({
      id: gId,
      bu,
      title: pg.title || 'Untitled goal',
      description: pg.description || '',
      priority: pg.priority || 'primary',
      status: 'active',
      created_at: now,
      paperclip_goal_id: null,
      last_synced_at: null,
      backlog_state: 'promoted_to_plan',
      promoted_to_plan_id: null, // filled in after plan id known
      promoted_at: now,
      from_memo: null,
      discarded_at: null,
      discarded_reason: null,
      from_proposal: picked.id,
    });
    newGoalIds.push(gId);
  });

  // Create initiatives
  const newInitIds = [];
  proposedInits.forEach((pi, i) => {
    const iId = `init-${today}-${String(initiatives.length + i + 1).padStart(2, '0')}`;
    const goalIdx = typeof pi.goal_index === 'number' ? pi.goal_index : 0;
    initiatives.push({
      id: iId,
      bu,
      goal_id: newGoalIds[goalIdx] || newGoalIds[0] || null,
      title: pi.title || 'Untitled initiative',
      active_hypothesis: pi.active_hypothesis || '',
      success_criterion: pi.success_criterion || '',
      target_close_date: pi.target_close_date || null,
      priority_in_plan: pi.priority_in_plan || 'primary',
      status: 'not_started',
      predicted_kpi_impact: pi.predicted_kpi_impact || '',
      outcome_artifacts: [],
      created_at: now,
      started_at: null,
      closed_at: null,
      paperclip_project_id: null,
      last_synced_at: null,
      backlog_state: 'promoted_to_plan',
      promoted_to_plan_id: null,
      promoted_at: now,
      from_memo: null,
      discarded_at: null,
      discarded_reason: null,
      from_proposal: picked.id,
      depends_on: (pi.depends_on_index || []).map(idx => newInitIds[idx]).filter(Boolean),
      predicted_outcome: Array.isArray(pi.predicted_outcome) ? pi.predicted_outcome : [],
      actual_outcome: [],
      learning_log: [],
      milestones: Array.isArray(pi.milestones) ? pi.milestones : [],
    });
    newInitIds.push(iId);
  });

  // Create the new plan. Use max(existing suffix) + 1 to avoid collision with
  // discarded plans still in the array.
  const existingSuffixes = plans
    .map(p => (typeof p.id === 'string' ? p.id.match(new RegExp(`^plan-${today}-(\\d+)$`)) : null))
    .map(m => (m ? parseInt(m[1], 10) : 0));
  const nextSuffix = (existingSuffixes.length ? Math.max(...existingSuffixes) : 0) + 1;
  const planId = `plan-${today}-${String(nextSuffix).padStart(2, '0')}`;
  const stewartCredit = stewartId || 'stewart';

  // Auto-activate on pick. Operator's mental model is "pick = it becomes THE plan."
  // Close the current active plan (if any) as completed, superseded by the new one.
  const previousActive = plans.find(p => p.status === 'active');
  if (previousActive) {
    previousActive.status = 'completed';
    previousActive.completed_at = now;
    previousActive.closing_notes = `Superseded by ${planId} (operator picked proposal ${picked.id})`;
  }

  const newPlan = {
    id: planId,
    bu,
    title: picked.title,
    rationale: `[Stewart proposal ${picked.id}]\n${picked.reasoning || picked.rationale || ''}`,
    period_start: picked.period_start,
    period_target_end: picked.period_target_end,
    status: 'active',
    goal_ids: newGoalIds,
    initiative_ids: newInitIds,
    created_at: now,
    created_by: ['operator', stewartCredit],
    activated_at: now,
    completed_at: null,
    closing_notes: null,
    from_proposal: picked.id,
    superseded_plan_id: previousActive?.id || null,
    closure_status: null,
    evaluation_due_at: null,
  };
  plans.push(newPlan);

  // Back-fill promoted_to_plan_id
  newGoalIds.forEach(gid => {
    const g = goals.find(x => x.id === gid);
    if (g) g.promoted_to_plan_id = planId;
  });
  newInitIds.forEach(iid => {
    const i = initiatives.find(x => x.id === iid);
    if (i) i.promoted_to_plan_id = planId;
  });

  // Mark proposals: picked = "picked"; siblings in same set = "rejected"
  proposals.forEach(p => {
    if (p.proposal_set_id === setId) {
      if (p.id === proposalId) {
        p.status = 'picked';
        p.picked_at = now;
        p.materialized_as_plan_id = planId;
      } else if (p.status === 'proposed') {
        p.status = 'rejected';
        p.rejected_at = now;
        p.rejected_by_picking = proposalId;
      }
    }
  });

  // Write all 4 files (sequential — shas chain)
  try {
    const r1 = await putFile(env.GITHUB_PAT, proposalsPath, JSON.stringify(proposals, null, 2) + '\n', proposalsFile.sha, `proposals: pick ${proposalId} (set ${setId})`);
    const goalsFile2 = await getFile(env.GITHUB_PAT, goalsPath);
    const r2 = await putFile(env.GITHUB_PAT, goalsPath, JSON.stringify(goals, null, 2) + '\n', goalsFile2.sha, `goals: +${newGoalIds.length} from proposal ${proposalId}`);
    const initsFile2 = await getFile(env.GITHUB_PAT, initsPath);
    const r3 = await putFile(env.GITHUB_PAT, initsPath, JSON.stringify(initiatives, null, 2) + '\n', initsFile2.sha, `initiatives: +${newInitIds.length} from proposal ${proposalId}`);
    const plansFile2 = await getFile(env.GITHUB_PAT, plansPath);
    const r4 = await putFile(env.GITHUB_PAT, plansPath, JSON.stringify(plans, null, 2) + '\n', plansFile2.sha, `plans: draft ${planId} from proposal ${proposalId}`);

    return jsonResponse(200, {
      ok: true,
      plan: newPlan,
      goal_ids: newGoalIds,
      initiative_ids: newInitIds,
      rejected_count: proposals.filter(p => p.proposal_set_id === setId && p.status === 'rejected').length,
      commit_shas: {
        proposals: r1.commit.sha,
        goals: r2.commit.sha,
        initiatives: r3.commit.sha,
        plans: r4.commit.sha,
      },
      message: `Plan ${planId} activated from proposal ${proposalId}${previousActive ? ` (superseded ${previousActive.id})` : ''}.`,
    });
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: `Write failed: ${e.message || e}` });
  }
}

async function resolveStrategyStewartId(pat, bu) {
  try {
    const f = await getFile(pat, 'dashboard/public/data/system/agent_bindings.json');
    let bindings = JSON.parse(f.content);
    if (!Array.isArray(bindings)) bindings = bindings?.bindings || [];
    const match = bindings.find(b =>
      b.bu === bu && b.module_id === 'strategy' && b.agent_id
    );
    return match ? match.agent_id : null;
  } catch {
    return null;
  }
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
