// POST /api/file-stewart-task
//
// Files an operator-originated task that the BU's Stewart should pick up at
// next heartbeat. Mirrors the schema produced by stewart_emit_only (see
// dashboard/public/data/bus/<bu>/tasks.json) so the existing executor
// pipeline + dashboard renderers Just Work.
//
// Used by the dashboard plan-cycle controls:
//   - "Ask Stewart for 3 plan proposals" → category=plan_proposal
//   - Edit current plan → resync prompt → category=plan_resync
//
// Body: {
//   bu,
//   title,                    // required
//   description?,
//   category?,                // e.g. "plan_proposal" | "plan_resync" | "decision_capture" — free string
//   advances_initiative?,
//   target?: { type?, scope?, executor? },   // executor defaults to "<bu>-stewart"
//   estimated_minutes?,
//   risk_level?,              // default "low"
//   reversibility?,           // default "high"
//   source?,                  // free-form, recorded in source_heartbeat for audit
// }
//
// Returns: { ok, task, commit_sha }
//
// Authoring conventions:
//   - origin = "operator_request" (distinct from "stewart_emit_only")
//   - proposer = "operator"
//   - status = "approved" — operator clicked the button, this IS the approval.
//     Stewart heartbeat picks up approved tasks and executes / pushes through
//     the adapter as it would for operator-approved Stewart-emitted tasks.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from './_gh.js';
import { requireAdmin } from './_identity.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const title = (body.title || '').toString().trim();
  if (!title) return jsonResponse(400, { ok: false, message: 'title required' });
  const description = (body.description || '').toString();
  const category = (body.category || 'operator_request').toString();
  const advancesInit = body.advances_initiative ? String(body.advances_initiative) : null;
  const tIn = body.target || {};
  const target = {
    type: tIn.type ? String(tIn.type) : 'stewart_action',
    scope: tIn.scope ? String(tIn.scope) : '',
    executor: tIn.executor ? String(tIn.executor) : `${bu}-stewart`,
  };
  const estMin = Number.isFinite(body.estimated_minutes) ? Math.max(1, Math.round(body.estimated_minutes)) : 30;
  const risk = (body.risk_level || 'low').toString();
  const rev = (body.reversibility || 'high').toString();
  const source = (body.source || 'dashboard_operator_button').toString();

  const path = `dashboard/public/data/bus/${bu}/tasks.json`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let tasks;
  try { tasks = JSON.parse(current.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `tasks.json parse error: ${e}` }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json is not an array' });

  // Allocate next id task-YYYY-MM-DD-NNN for today
  const today = todayDate();
  const todayPrefix = `task-${today}-`;
  const used = tasks.filter(t => t && typeof t.id === 'string' && t.id.startsWith(todayPrefix)).length;
  const id = `${todayPrefix}${String(used + 1).padStart(3, '0')}`;
  const now = todayISO();

  const task = {
    id,
    bu,
    title,
    description,
    origin: 'operator_request',
    proposer: 'operator',
    proposed_at: now,
    source_heartbeat: source,
    category,
    risk_level: risk,
    reversibility: rev,
    tier: 'normal',
    estimated_minutes: estMin,
    target,
    advances_initiative: advancesInit,
    affects_kpi: null,
    from_memo: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'operator_initiated → auto-approved',
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

  tasks.push(task);
  const newContent = JSON.stringify(tasks, null, 2) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `tasks: file ${id} (operator) — ${title.slice(0, 60)}${title.length > 60 ? '…' : ''}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, task, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
