// POST /api/update-initiative
//
// Capture retrospective data on an initiative: actual_outcome entries,
// learning_log entries, status changes (mark closed).
//
// Body: {
//   bu,
//   init_id,
//   action: "log_actual" | "add_learning" | "set_status",
//   outcome?: { kpi, measured_delta, source?, notes? },          // for log_actual
//   learning?: { body, author? },                                  // for add_learning
//   status?: "completed" | "abandoned"                             // for set_status
// }
//
// Side effect on log_actual: if afterwards every initiative in the
// plan (that owns this init) has ≥1 actual_outcome entry AND status="completed",
// flip plan.closure_status to "evaluated".

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';

const VALID_ACTIONS = new Set(['log_actual', 'add_learning', 'set_status', 'mark_milestone_done']);
// Legacy statuses kept for backwards-compat: active / on_track / at_risk.
// New Genus-native cycle states per docs/system/EXECUTION_CYCLE.md:
// not_started / scoping / in_progress / blocked / review / completed (was done) / abandoned (was discarded).
const VALID_STATUSES = new Set([
  'not_started', 'scoping', 'in_progress', 'blocked', 'review', 'completed', 'abandoned',
  'active', 'on_track', 'at_risk',  // legacy compatibility
]);

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const initId = (body.init_id || '').toString();
  const action = (body.action || '').toString();

  if (!initId) return jsonResponse(400, { ok: false, message: 'init_id required' });
  if (!VALID_ACTIONS.has(action)) return jsonResponse(400, { ok: false, message: `action must be: ${[...VALID_ACTIONS].join(', ')}` });

  const initsPath = `dashboard/public/data/bus/${bu}/initiatives.json`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, initsPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let initiatives;
  try { initiatives = JSON.parse(current.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse error: ${e}` }); }

  const target = initiatives.find(x => x.id === initId);
  if (!target) return jsonResponse(404, { ok: false, message: `Initiative ${initId} not found` });

  const now = todayISO();

  if (action === 'log_actual') {
    const o = body.outcome || {};
    if (!o.kpi || o.measured_delta === undefined) {
      return jsonResponse(400, { ok: false, message: 'outcome.kpi + outcome.measured_delta required' });
    }
    target.actual_outcome = target.actual_outcome || [];
    target.actual_outcome.push({
      kpi: o.kpi,
      measured_delta: o.measured_delta,
      source: o.source || 'operator_manual',
      measured_at: now,
      notes: o.notes || null,
    });
  } else if (action === 'add_learning') {
    const l = body.learning || {};
    if (!l.body) return jsonResponse(400, { ok: false, message: 'learning.body required' });
    target.learning_log = target.learning_log || [];
    target.learning_log.push({
      author: l.author || 'operator',
      at: now,
      body: l.body,
    });
  } else if (action === 'set_status') {
    const s = body.status;
    if (!VALID_STATUSES.has(s)) return jsonResponse(400, { ok: false, message: `status must be: ${[...VALID_STATUSES].join(', ')}` });
    const prevStatus = target.status || null;
    target.status = s;
    if (s === 'completed' && !target.closed_at) target.closed_at = now;
    if ((s === 'active' || s === 'on_track' || s === 'in_progress') && !target.started_at) target.started_at = now;
    // Append status_history entry (per docs/system/EXECUTION_CYCLE.md)
    target.status_history = target.status_history || [];
    target.status_history.push({
      at: now,
      from: prevStatus,
      to: s,
      actor: body.actor || 'operator',
      via: 'api/update-initiative',
      rationale: body.rationale || null,
    });
  } else if (action === 'mark_milestone_done') {
    // Manual operator mark-done on a specific milestone. Complements the auto-
    // mark-done that fires when an initiative_milestone meeting closes. Use
    // when the milestone was settled offline / retroactively / without a meeting.
    const msId = (body.milestone_id || '').toString();
    if (!msId) return jsonResponse(400, { ok: false, message: 'milestone_id required for mark_milestone_done' });
    const milestones = target.milestones || [];
    const ms = milestones.find(m => m.id === msId);
    if (!ms) return jsonResponse(404, { ok: false, message: `Milestone ${msId} not found on initiative ${initId}` });
    if ((ms.status || '').toLowerCase() === 'done') {
      return jsonResponse(409, { ok: false, message: `Milestone ${msId} already done` });
    }
    ms.status = 'done';
    ms.closed_at = now;
    ms.closed_by = body.actor || 'operator';
    ms.closed_by_meeting = null;  // explicitly null — this path is not meeting-driven
    if (body.note) ms.close_note = body.note.toString().slice(0, 500);
  }

  const newContent = JSON.stringify(initiatives, null, 2) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, initsPath, newContent, current.sha, `initiatives: ${action} ${initId}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  // If this initiative is in a completed plan, check if we should flip plan closure_status
  let planFlipped = null;
  if (target.promoted_to_plan_id) {
    try {
      const plansPath = `dashboard/public/data/bus/${bu}/plans.json`;
      const plansFile = await getFile(env.GITHUB_PAT, plansPath);
      const plans = JSON.parse(plansFile.content);
      const plan = plans.find(p => p.id === target.promoted_to_plan_id);
      if (plan && plan.status === 'completed' && plan.closure_status === 'pending_evaluation') {
        // Re-load updated initiatives to compute the check
        const planInits = (plan.initiative_ids || []).map(iid => initiatives.find(x => x.id === iid)).filter(Boolean);
        const allEvaluated = planInits.length > 0 && planInits.every(it =>
          (it.actual_outcome || []).length > 0 &&
          ['completed', 'abandoned'].includes(it.status)
        );
        if (allEvaluated) {
          plan.closure_status = 'evaluated';
          plan.fully_evaluated_at = now;
          await putFile(env.GITHUB_PAT, plansPath, JSON.stringify(plans, null, 2) + '\n', plansFile.sha, `plans: ${plan.id} fully evaluated`);
          planFlipped = plan.id;
        }
      }
    } catch (e) {
      console.warn('plan closure check failed:', e);
    }
  }

  return jsonResponse(200, { ok: true, initiative: target, commit_sha: commit.commit.sha, plan_flipped_to_evaluated: planFlipped });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
