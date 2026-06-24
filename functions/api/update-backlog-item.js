// POST /api/update-backlog-item
// Move a backlog item (goal or initiative) between states.
//
// Body: { bu, item_type: "goal"|"initiative", item_id, action, discarded_reason? }
//   action: "move_to_ready" | "move_to_untriaged" | "discard" | "restore"
//
// Restored from legacy parity audit (GEN-39, P0) for v0.7 Backlog kanban (GEN-50).

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';

const VALID_TYPES = new Set(['goal', 'initiative']);
const VALID_ACTIONS = new Set(['move_to_ready', 'move_to_untriaged', 'discard', 'restore']);

const ACTION_TO_STATE = {
  move_to_ready: 'ready',
  move_to_untriaged: 'untriaged',
  discard: 'discarded',
  restore: 'untriaged',
};

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const itemType = (body.item_type || '').toString();
  const itemId = (body.item_id || '').toString();
  const action = (body.action || '').toString();
  const discardedReason = body.discarded_reason ? body.discarded_reason.toString() : null;

  if (!VALID_TYPES.has(itemType)) return jsonResponse(400, { ok: false, message: `item_type must be: ${[...VALID_TYPES].join(', ')}` });
  if (!itemId) return jsonResponse(400, { ok: false, message: 'item_id required' });
  if (!VALID_ACTIONS.has(action)) return jsonResponse(400, { ok: false, message: `action must be: ${[...VALID_ACTIONS].join(', ')}` });

  const filename = itemType === 'goal' ? 'goals.json' : 'initiatives.json';
  const path = `dashboard/public/data/bus/${bu}/${filename}`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let items;
  try { items = JSON.parse(current.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse error: ${e}` }); }

  const target = items.find(x => x.id === itemId);
  if (!target) return jsonResponse(404, { ok: false, message: `${itemType} ${itemId} not found` });

  // Items already in a plan are immutable from Backlog UI — operator should
  // edit the plan or the item via the Plan flow instead.
  if (target.backlog_state === 'promoted_to_plan' && action !== 'restore') {
    return jsonResponse(409, { ok: false, message: `${itemId} is in a plan; cannot move from Backlog directly` });
  }

  const now = todayISO();
  target.backlog_state = ACTION_TO_STATE[action];
  if (action === 'discard') {
    target.discarded_at = now;
    target.discarded_reason = discardedReason;
  } else if (action === 'restore') {
    target.discarded_at = null;
    target.discarded_reason = null;
  }

  const newContent = JSON.stringify(items, null, 2) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `backlog: ${action} ${itemType} ${itemId}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, item: target, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
