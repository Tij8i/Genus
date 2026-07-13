// POST /api/dismiss-memo
// Marks a memo as dismissed (operator decided it's not worth pursuing).
//
// Body: { bu, memo_id }

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const memoId = (body.memo_id || '').toString();
  if (!memoId) return jsonResponse(400, { ok: false, message: 'memo_id is required' });

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  let actorEmail = 'operator';
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
    actorEmail = gate.email || 'operator';
  } else {
    actorEmail = external.entry?.owner_email || external.entry?.display_name || 'external_token';
  }

  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  const lines = current.content.split('\n').filter(l => l.trim());
  let found = false;
  const updated = lines.map(line => {
    try {
      const memo = JSON.parse(line);
      if (memo.id === memoId) {
        found = true;
        memo.status = 'dismissed';
        memo.processed_at = todayISO();
        memo.processed_by = actorEmail;
        return JSON.stringify(memo);
      }
      return line;
    } catch { return line; }
  });

  if (!found) return jsonResponse(404, { ok: false, message: `Memo ${memoId} not found` });

  const newContent = updated.join('\n') + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `memos: dismiss ${memoId}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, memo_id: memoId, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
