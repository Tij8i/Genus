// POST /api/update-plan
//
// Operator-facing plan-cycle controls. Two actions:
//
//   action="complete_cycle"
//     Body: { bu, plan_id, closing_notes? }
//     - Flips plan.status = "completed", plan.completed_at = now.
//     - Archives plan's initiatives: any in_progress/scoping/review/not_started
//       initiative is set to "completed" (closed_at set if missing) so the
//       plan's initiative roster is no longer "active" in the next cycle.
//     - Writes a retro stub to plan.closing_notes (or appends if non-empty).
//     - Sets plan.closure_status = "pending_evaluation" so update-initiative
//       can later flip it to "evaluated" when actual_outcome data lands.
//
//   action="edit_plan"
//     Body: { bu, plan_id, edits: { title?, rationale?, period_target_end?,
//       initiative_ids?, goal_ids? } }
//     - Applies in-place edits to the named fields. Anything not in edits is
//       left untouched. initiative_ids / goal_ids fully replace if provided.
//     - Stamps plan.last_edited_at / last_edited_by.
//
// Both actions return { ok, plan, commit_sha }. The caller (dashboard) is
// responsible for filing follow-up Stewart tasks (request_proposals after
// complete_cycle; request_resync after edit_plan) via /api/file-stewart-task —
// keeping concerns separate so the operator can dismiss the follow-up prompt
// without polluting this endpoint with conditional task-filing.

import { getFile, putFile, jsonResponse, todayISO } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

const VALID_ACTIONS = new Set(['complete_cycle', 'edit_plan']);
const EDITABLE_FIELDS = new Set(['title', 'rationale', 'period_target_end', 'initiative_ids', 'goal_ids']);
const ARCHIVE_FROM_STATUSES = new Set(['not_started', 'scoping', 'in_progress', 'blocked', 'review', 'active', 'on_track', 'at_risk']);

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const planId = (body.plan_id || '').toString();
  const action = (body.action || '').toString();
  const actor = (body.actor || 'operator').toString();

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  if (!planId) return jsonResponse(400, { ok: false, message: 'plan_id required' });
  if (!VALID_ACTIONS.has(action)) return jsonResponse(400, { ok: false, message: `action must be: ${[...VALID_ACTIONS].join(', ')}` });

  const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
  let plansFile;
  try { plansFile = await getFile(env.GITHUB_PAT, plansPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let plans;
  try { plans = JSON.parse(plansFile.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `plans.json parse error: ${e}` }); }
  if (!Array.isArray(plans)) return jsonResponse(500, { ok: false, message: 'plans.json is not an array' });

  const plan = plans.find(p => p.id === planId);
  if (!plan) return jsonResponse(404, { ok: false, message: `Plan ${planId} not found` });

  const now = todayISO();
  let initsCommitSha = null;
  let archivedInitIds = [];

  if (action === 'complete_cycle') {
    if (plan.status === 'completed' || plan.status === 'superseded') {
      return jsonResponse(409, { ok: false, message: `Plan ${planId} is already ${plan.status}` });
    }
    plan.status = 'completed';
    plan.completed_at = now;
    plan.closure_status = plan.closure_status || 'pending_evaluation';
    plan.evaluation_due_at = plan.evaluation_due_at || now;
    const retroStub = (body.closing_notes || '').toString().trim()
      || `Cycle marked complete by ${actor} at ${now.slice(0, 10)}. Retrospective pending — actual_outcome entries on the plan's Initiatives will flip closure_status to "evaluated" once captured.`;
    plan.closing_notes = plan.closing_notes
      ? `${plan.closing_notes}\n\n— ${now.slice(0, 10)} (cycle close) —\n${retroStub}`
      : retroStub;

    // Archive initiatives: set any still-open Initiative to completed so the
    // next plan starts with a clean slate. Don't touch already-closed ones.
    const initsPath = `dashboard/public/data/bus/${bu}/initiatives.json`;
    let initsFile;
    try { initsFile = await getFile(env.GITHUB_PAT, initsPath); }
    catch (e) { return jsonResponse(e.status || 500, { ok: false, message: `initiatives load failed: ${e.message || String(e)}` }); }
    let initiatives;
    try { initiatives = JSON.parse(initsFile.content); }
    catch (e) { return jsonResponse(500, { ok: false, message: `initiatives.json parse error: ${e}` }); }

    for (const iid of plan.initiative_ids || []) {
      const init = initiatives.find(i => i.id === iid);
      if (!init) continue;
      const cur = (init.status || '').toLowerCase();
      if (!ARCHIVE_FROM_STATUSES.has(cur)) continue;
      const prev = init.status || null;
      init.status = 'completed';
      if (!init.closed_at) init.closed_at = now;
      init.status_history = init.status_history || [];
      init.status_history.push({
        at: now,
        from: prev,
        to: 'completed',
        actor,
        via: 'api/update-plan#complete_cycle',
        rationale: `Auto-archived when plan ${planId} was marked complete`,
      });
      archivedInitIds.push(iid);
    }

    if (archivedInitIds.length > 0) {
      try {
        const initsResp = await putFile(env.GITHUB_PAT, initsPath, JSON.stringify(initiatives, null, 2) + '\n', initsFile.sha, `initiatives: archive ${archivedInitIds.length} on plan ${planId} cycle close`);
        initsCommitSha = initsResp.commit.sha;
      } catch (e) {
        return jsonResponse(e.status || 500, { ok: false, message: `archive write failed: ${e.message || String(e)}` });
      }
    }
  } else if (action === 'edit_plan') {
    if (plan.status !== 'active') {
      return jsonResponse(409, { ok: false, message: `edit_plan only allowed on active plans; ${planId} is ${plan.status}` });
    }
    const edits = body.edits || {};
    if (!edits || typeof edits !== 'object') return jsonResponse(400, { ok: false, message: 'edits object required' });
    const applied = {};
    for (const k of Object.keys(edits)) {
      if (!EDITABLE_FIELDS.has(k)) continue;
      const v = edits[k];
      if (k === 'initiative_ids' || k === 'goal_ids') {
        if (!Array.isArray(v)) return jsonResponse(400, { ok: false, message: `${k} must be an array` });
        plan[k] = v.map(x => String(x));
      } else {
        plan[k] = v == null ? null : String(v);
      }
      applied[k] = plan[k];
    }
    if (!Object.keys(applied).length) return jsonResponse(400, { ok: false, message: 'No editable fields supplied' });
    plan.last_edited_at = now;
    plan.last_edited_by = actor;
  }

  const newContent = JSON.stringify(plans, null, 2) + '\n';
  let commit;
  try {
    const summary = action === 'complete_cycle'
      ? `plans: ${planId} marked complete (${archivedInitIds.length} initiatives archived)`
      : `plans: ${planId} edited (${actor})`;
    commit = await putFile(env.GITHUB_PAT, plansPath, newContent, plansFile.sha, summary);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, {
    ok: true,
    plan,
    commit_sha: commit.commit.sha,
    archived_initiative_ids: archivedInitIds,
    initiatives_commit_sha: initsCommitSha,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
