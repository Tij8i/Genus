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

import { getFile, putFile, jsonResponse, todayISO } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

// v1 actions (pre-fusion): mark_milestone_done, edit_gateway
// v2 actions (i66 fusion): mark_checkpoint_done, approve_checkpoint, edit_checkpoint
// Legacy v1 actions still accepted on v2 BUs — they read the v1 fields if present.
const VALID_ACTIONS = new Set([
  'log_actual', 'add_learning', 'set_status',
  'mark_milestone_done', 'edit_gateway',
  'mark_checkpoint_done', 'approve_checkpoint', 'edit_checkpoint',
]);
// Legacy statuses kept for backwards-compat: active / on_track / at_risk.
// New Genus-native cycle states per docs/system/EXECUTION_CYCLE.md:
// not_started / scoping / gateways_pending_approval (GEN-34) / in_progress / blocked / review / completed (was done) / abandoned (was discarded).
const VALID_STATUSES = new Set([
  'not_started', 'scoping', 'gateways_pending_approval', 'in_progress', 'blocked', 'review', 'completed', 'abandoned',
  'active', 'on_track', 'at_risk',  // legacy compatibility
]);
const VALID_GATEWAY_CRITICALITIES = new Set(['critical', 'tactical']);

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const initId = (body.init_id || '').toString();
  const action = (body.action || '').toString();

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

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
  } else if (action === 'edit_gateway') {
    // Operator inline-edits a single gateway's title or criticality from the
    // gateway-approval panel (GEN-40). Add/remove gateways is out of scope —
    // Stewart proposes the list at scoping; operator edits in place.
    const gwId = (body.gateway_id || '').toString();
    if (!gwId) return jsonResponse(400, { ok: false, message: 'gateway_id required for edit_gateway' });
    const edits = body.edits || {};
    if (typeof edits !== 'object') return jsonResponse(400, { ok: false, message: 'edits must be an object' });
    const gateways = target.gateways || [];
    const gw = gateways.find(g => g.id === gwId);
    if (!gw) return jsonResponse(404, { ok: false, message: `Gateway ${gwId} not found on initiative ${initId}` });

    const newTitle = typeof edits.title === 'string' ? edits.title.trim() : undefined;
    const newCrit = typeof edits.criticality === 'string' ? edits.criticality.trim().toLowerCase() : undefined;

    if (newTitle !== undefined) {
      if (!newTitle) return jsonResponse(400, { ok: false, message: 'gateway title cannot be empty' });
      gw.title = newTitle.slice(0, 200);
    }
    if (newCrit !== undefined) {
      if (!VALID_GATEWAY_CRITICALITIES.has(newCrit)) {
        return jsonResponse(400, { ok: false, message: `criticality must be one of: ${[...VALID_GATEWAY_CRITICALITIES].join(', ')}` });
      }
      gw.criticality = newCrit;
    }
    gw.last_edited_at = now;
    gw.last_edited_by = body.actor || 'operator';
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
    // Recovery Step 3: gate on task completion. All tasks that advance this
    // milestone must be in a terminal status. Operator can override with
    // force=true (retroactive/offline closure).
    if (!body.force) {
      const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
      try {
        const tf = await getFile(env.GITHUB_PAT, tasksPath);
        const tasks = JSON.parse(tf.content);
        if (Array.isArray(tasks)) {
          const TERMINAL = new Set(['done', 'closed', 'completed', 'cancelled', 'rejected']);
          const openLinked = tasks.filter(t =>
            t.advances_milestone === msId && !TERMINAL.has((t.status || '').toLowerCase())
          );
          if (openLinked.length > 0) {
            return jsonResponse(409, {
              ok: false,
              message: `Milestone ${msId} has ${openLinked.length} open task(s). Close them first, or pass force=true to override.`,
              open_task_ids: openLinked.map(t => t.id),
            });
          }
        }
      } catch (_) { /* tasks.json missing = nothing to gate against */ }
    }
    ms.status = 'done';
    ms.closed_at = now;
    ms.closed_by = body.actor || 'operator';
    ms.closed_by_meeting = null;  // explicitly null — this path is not meeting-driven
    if (body.force) ms.closed_forced = true;
    if (body.note) ms.close_note = body.note.toString().slice(0, 500);
  } else if (action === 'mark_checkpoint_done' || action === 'approve_checkpoint') {
    // i66 fusion — v2 checkpoint action. Merges the v1 mark_milestone_done +
    // gateway-approval logic into one action-family:
    //   mark_checkpoint_done → sets status='done' if !requires_approval, or
    //                          status='pending_approval' if requires_approval.
    //   approve_checkpoint    → transitions pending_approval → done.
    const cpId = (body.checkpoint_id || body.milestone_id || '').toString();
    if (!cpId) return jsonResponse(400, { ok: false, message: 'checkpoint_id required' });
    // Support both v2 (checkpoints[]) and v1-during-transition (milestones[]).
    const list = Array.isArray(target.checkpoints) ? target.checkpoints
               : Array.isArray(target.milestones) ? target.milestones : [];
    const cp = list.find(x => x.id === cpId);
    if (!cp) return jsonResponse(404, { ok: false, message: `Checkpoint ${cpId} not found on initiative ${initId}` });

    if (action === 'approve_checkpoint') {
      if ((cp.status || '').toLowerCase() !== 'pending_approval') {
        return jsonResponse(409, { ok: false, message: `Checkpoint ${cpId} is ${cp.status || 'pending'}, not pending_approval` });
      }
      cp.status = 'done';
      cp.approved_at = now;
      cp.approved_by = body.actor || 'operator';
      if (body.note) cp.approval_note = body.note.toString().slice(0, 500);
    } else {
      // mark_checkpoint_done
      if ((cp.status || '').toLowerCase() === 'done') {
        return jsonResponse(409, { ok: false, message: `Checkpoint ${cpId} already done` });
      }
      // Task-completion gate (same rule as v1 mark_milestone_done).
      if (!body.force) {
        const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
        try {
          const tf = await getFile(env.GITHUB_PAT, tasksPath);
          const tasks = JSON.parse(tf.content);
          if (Array.isArray(tasks)) {
            const TERMINAL = new Set(['done', 'closed', 'completed', 'cancelled', 'rejected']);
            const openLinked = tasks.filter(t =>
              (t.advances_checkpoint === cpId || t.advances_milestone === cpId) &&
              !TERMINAL.has((t.status || '').toLowerCase())
            );
            if (openLinked.length > 0) {
              return jsonResponse(409, {
                ok: false,
                message: `Checkpoint ${cpId} has ${openLinked.length} open task(s). Close them first, or pass force=true to override.`,
                open_task_ids: openLinked.map(t => t.id),
              });
            }
          }
        } catch (_) { /* tasks.json missing = nothing to gate against */ }
      }
      // If the checkpoint requires operator approval, mark done as
      // pending_approval — a follow-up approve_checkpoint call will close it.
      // Otherwise it's just done.
      const needsApproval = cp.requires_approval === true;
      cp.status = needsApproval ? 'pending_approval' : 'done';
      cp.closed_at = now;
      cp.closed_by = body.actor || 'operator';
      if (body.force) cp.closed_forced = true;
      if (body.note) cp.close_note = body.note.toString().slice(0, 500);
    }
  } else if (action === 'edit_checkpoint') {
    // Inline edit of a v2 checkpoint's title, criticality, or requires_approval flag.
    const cpId = (body.checkpoint_id || '').toString();
    if (!cpId) return jsonResponse(400, { ok: false, message: 'checkpoint_id required for edit_checkpoint' });
    const edits = body.edits || {};
    if (typeof edits !== 'object') return jsonResponse(400, { ok: false, message: 'edits must be an object' });
    const list = Array.isArray(target.checkpoints) ? target.checkpoints : [];
    const cp = list.find(x => x.id === cpId);
    if (!cp) return jsonResponse(404, { ok: false, message: `Checkpoint ${cpId} not found on initiative ${initId}` });
    if (typeof edits.name === 'string' && edits.name.trim()) cp.name = edits.name.trim().slice(0, 200);
    if (typeof edits.criticality === 'string') {
      const c = edits.criticality.trim().toLowerCase();
      if (!VALID_GATEWAY_CRITICALITIES.has(c)) return jsonResponse(400, { ok: false, message: `criticality must be one of: ${[...VALID_GATEWAY_CRITICALITIES].join(', ')}` });
      cp.criticality = c;
    }
    if (typeof edits.requires_approval === 'boolean') cp.requires_approval = edits.requires_approval;
    if (typeof edits.produces_artifact === 'boolean') cp.produces_artifact = edits.produces_artifact;
    cp.last_edited_at = now;
    cp.last_edited_by = body.actor || 'operator';
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
