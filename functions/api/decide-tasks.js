// Cloudflare Pages Function: POST /api/decide-tasks
//
// Persists operator approve/reject decisions on Genus tasks by editing
// dashboard/public/data/bus/<bu>/tasks.json and committing back to GitHub.
//
// Body: { bu: "tuto", decisions: [{ task_id, decision, notes? }], decided_by? }
//   decision must be "approved" or "rejected"
//
// Auth model: same Cloudflare Access policy as the dashboard. The operator
// is the only person who can call this. No additional shared secret needed.
//
// Required env var (Cloudflare Pages → Settings → Environment variables):
//   GITHUB_PAT — fine-grained token with `Contents: Read and write` on Tij8i/Orchestrator.
//   (The same PAT used by /api/refresh can be extended to add Contents:R+W,
//    or a second PAT can be issued specifically for this. See dashboard/DEPLOY.md.)

// Refactored 2026-06-17 (Session #14): now imports from _gh.js so the
// large-file fix (raw URL fallback when tasks.json >1MB) is shared with
// other endpoints. Previously this Function had its own copy of the
// GitHub Contents logic which broke when tasks.json grew past the 1MB
// Contents-API limit (operator hit "Unexpected end of JSON input" when
// clicking approve, because the API returned empty content).

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

const VALID_DECISIONS = new Set(['approved', 'rejected']);

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) {
    return jsonResponse(500, {
      ok: false,
      message: 'GITHUB_PAT env var is not set on the Pages project. See dashboard/DEPLOY.md.',
    });
  }

  // ---- parse + validate body ----
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, message: 'Invalid JSON body' });
  }

  const bu = (body.bu || 'tuto').toString();

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  const decidedBy = (body.decided_by || 'operator').toString();

  if (decisions.length === 0) {
    return jsonResponse(400, { ok: false, message: 'decisions[] is required (non-empty)' });
  }
  for (const d of decisions) {
    if (!d || typeof d.task_id !== 'string' || !VALID_DECISIONS.has(d.decision)) {
      return jsonResponse(400, {
        ok: false,
        message: `Each decision needs task_id (string) + decision ("approved"|"rejected"). Got: ${JSON.stringify(d)}`,
      });
    }
  }

  const path = `dashboard/public/data/bus/${bu}/tasks.json`;

  // ---- 1) GET current file (handles >1MB via raw-URL fallback in _gh.js) ----
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  // ---- 2) parse + apply decisions ----
  let tasks;
  try {
    tasks = JSON.parse(current.content);
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'Could not parse tasks.json: ' + String(e) });
  }
  if (!Array.isArray(tasks)) {
    return jsonResponse(500, { ok: false, message: 'tasks.json is not an array' });
  }

  const now = todayISO();
  const applied = [];
  const skipped = [];
  for (const dec of decisions) {
    const task = tasks.find(t => t && t.id === dec.task_id);
    if (!task) { skipped.push({ task_id: dec.task_id, reason: 'not_found' }); continue; }
    if (!['proposed', 'awaiting_approval'].includes(task.status)) {
      skipped.push({ task_id: dec.task_id, reason: `status_is_${task.status}` });
      continue;
    }
    task.status = dec.decision;
    task.approval = {
      ...(task.approval || {}),
      decided_by: decidedBy,
      decided_at: now,
      notes: dec.notes || null,
    };
    applied.push({ task_id: task.id, decision: dec.decision });
  }

  if (applied.length === 0) {
    return jsonResponse(409, {
      ok: false,
      message: 'No decisions applied (all task_ids not found or no longer pending).',
      skipped,
    });
  }

  // ---- 3) PUT updated file (via shared putFile) ----
  const newContent = JSON.stringify(tasks, null, 2) + '\n';
  const summary = applied.length === 1
    ? `tasks: ${applied[0].decision} ${applied[0].task_id} (operator)`
    : `tasks: ${applied.length} decisions by ${decidedBy}`;

  let putData;
  try {
    putData = await putFile(env.GITHUB_PAT, path, newContent, current.sha, summary);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, {
    ok: true,
    applied,
    skipped,
    commit_sha: putData.commit.sha,
    commit_url: putData.commit.html_url,
    message: summary,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
