// POST /api/create-plan
// Node/Express port of functions/api/create-plan.js — used in Docker installs.
// Same shape: one active plan at a time, 409 if one already exists.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
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
  const period_target_end = (body.period_target_end || '').toString().trim() || null;

  if (!title) return jsonResponse(400, { ok: false, message: 'title required' });

  const path = `dashboard/public/data/bus/${bu}/plans.json`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let plans;
  try { plans = JSON.parse(current.content || '[]'); }
  catch { return jsonResponse(500, { ok: false, message: 'plans.json is not valid JSON' }); }
  if (!Array.isArray(plans)) return jsonResponse(500, { ok: false, message: 'plans.json must be an array' });

  const activePlan = plans.find(p => p.status === 'active');
  if (activePlan) {
    return jsonResponse(409, {
      ok: false,
      message: `An active plan already exists (${activePlan.title}). Complete or discard it first via the plan card controls before starting a new one.`,
      active_plan_id: activePlan.id,
    });
  }

  const today = todayDate();
  const existingToday = plans.filter(p => typeof p.id === 'string' && p.id.startsWith(`plan-${today}-`));
  const nextNum = String(existingToday.length + 1).padStart(2, '0');
  const id = `plan-${today}-${nextNum}`;

  const plan = {
    id,
    bu,
    title,
    rationale,
    status: 'active',
    goal_ids: [],
    initiative_ids: [],
    period_start: today,
    period_target_end,
    activated_at: todayISO(),
    created_by: ['operator'],
    created_at: todayISO(),
  };

  plans.push(plan);
  const newContent = JSON.stringify(plans, null, 2) + '\n';

  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `plans: ${id} — ${title.slice(0, 60)}${title.length > 60 ? '…' : ''}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, plan, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
