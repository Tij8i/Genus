// POST /api/dismiss-plan-proposals (Cloudflare Pages Functions mirror).
// See server/api/dismiss-plan-proposals.js for canonical doc.

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const setId = (body.proposal_set_id || '').toString().trim();
  const actor = (body.actor || 'operator').toString();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!setId) return jsonResponse(400, { ok: false, message: 'proposal_set_id required' });

  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  const path = `dashboard/public/data/bus/${bu}/plan_proposals.json`;
  let file;
  try { file = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let proposals;
  try { proposals = JSON.parse(file.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `parse: ${e}` }); }
  if (!Array.isArray(proposals)) return jsonResponse(500, { ok: false, message: 'plan_proposals.json must be an array' });

  const now = todayISO();
  let dismissed = 0;
  for (const p of proposals) {
    if (p.proposal_set_id === setId && p.status === 'proposed') {
      p.status = 'rejected';
      p.rejected_at = now;
      p.rejected_by = actor;
      p.rejection_reason = 'operator_dismissed_set';
      dismissed++;
    }
  }

  if (dismissed === 0) {
    return jsonResponse(200, { ok: true, dismissed_count: 0, message: `No proposed entries found in set ${setId}` });
  }

  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, JSON.stringify(proposals, null, 2) + '\n', file.sha,
      `proposals: dismiss set ${setId} (${dismissed} proposals rejected by ${actor})`);
  } catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  return jsonResponse(200, { ok: true, dismissed_count: dismissed, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
