// POST /api/create-goal
// Appends a new goal to dashboard/public/data/bus/<bu>/goals.json (array).
//
// Body: { bu, title, description?, priority? }
//
// Recovery A2 step 2 (GENOS_CORE_RECOVERY_PLAN v2 §3.2): closes S1 (goal
// capture reachable). Node/Express port of functions/api/create-goal.js,
// uses the storage abstraction so it works in Docker installs.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

const VALID_PRIORITIES = new Set(['primary', 'secondary']);

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
  const description = (body.description || '').toString().trim();
  const priority = (body.priority || 'primary').toString();

  if (!title) return jsonResponse(400, { ok: false, message: 'title required' });
  if (!VALID_PRIORITIES.has(priority)) {
    return jsonResponse(400, { ok: false, message: `priority must be one of: ${[...VALID_PRIORITIES].join(', ')}` });
  }

  const path = `dashboard/public/data/bus/${bu}/goals.json`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let goals;
  try { goals = JSON.parse(current.content || '[]'); }
  catch { return jsonResponse(500, { ok: false, message: 'goals.json is not valid JSON' }); }
  if (!Array.isArray(goals)) return jsonResponse(500, { ok: false, message: 'goals.json must be an array' });

  const today = todayDate();
  const existingToday = goals.filter(g => typeof g.id === 'string' && g.id.startsWith(`goal-${today}-`));
  const nextNum = String(existingToday.length + 1).padStart(2, '0');
  const id = `goal-${today}-${nextNum}`;

  const goal = {
    id,
    bu,
    title,
    description,
    priority,
    status: 'active',
    created_at: todayISO(),
    paperclip_goal_id: null,
    last_synced_at: null,
    backlog_state: 'unpromoted',
    promoted_to_plan_id: null,
    promoted_at: null,
    from_memo: null,
    discarded_at: null,
    discarded_reason: null,
  };

  goals.push(goal);
  const newContent = JSON.stringify(goals, null, 2) + '\n';

  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `goals: ${id} — ${title.slice(0, 60)}${title.length > 60 ? '…' : ''}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, goal, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
