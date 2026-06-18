// POST /api/create-memo
// Appends a new memo to data/bus/<bu>/memos.jsonl
//
// Body: { bu, level, target?, body }

import { getFile, putFile, jsonResponse, todayISO, todayDate } from './_gh.js';

const VALID_LEVELS = new Set(['task', 'initiative', 'system', 'misc']);

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const level = (body.level || 'misc').toString();
  const target = body.target ? body.target.toString() : null;
  const memoBody = (body.body || '').toString().trim();

  if (!VALID_LEVELS.has(level)) {
    return jsonResponse(400, { ok: false, message: `level must be one of: ${[...VALID_LEVELS].join(', ')}` });
  }
  if (!memoBody) {
    return jsonResponse(400, { ok: false, message: 'body is required' });
  }

  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  // Generate id: memo-YYYY-MM-DD-NNN
  const today = todayDate();
  const existingToday = current.content.split('\n').filter(l => l.trim() && l.includes(`"memo-${today}-`));
  const nextNum = String(existingToday.length + 1).padStart(3, '0');
  const id = `memo-${today}-${nextNum}`;

  const memo = {
    id,
    bu,
    created_at: todayISO(),
    created_by: 'operator',
    level,
    target,
    body: memoBody,
    status: 'unprocessed',
    processed_by: null,
    processed_at: null,
    applied_to: [],
  };

  const newContent = current.content + (current.content && !current.content.endsWith('\n') ? '\n' : '') + JSON.stringify(memo) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `memos: ${id} (${level}) — ${memoBody.slice(0, 50)}${memoBody.length > 50 ? '…' : ''}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, memo, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
