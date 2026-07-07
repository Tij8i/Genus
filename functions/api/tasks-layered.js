// Roadmap i65 — tasks as a layered system.
//
// GET  /api/tasks-layered?bu=<bu>&module=<mod?>  → filtered list
// POST /api/tasks-layered — spawn / handoff / update actions
//
// Central pool: bus/{bu}/tasks.json (already exists). i65 extends the shape
// with owner_module, parent_task_id, spawned_task_ids[], history[].
// Per-module Tasks tabs filter this pool by owner_module.

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin, getViewerIdentity } from './_identity.js';

function pathFor(bu) { return `dashboard/public/data/bus/${bu}/tasks.json`; }

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  const module = (url.searchParams.get('module') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const viewer = await getViewerIdentity(request, env);
  if (!viewer || viewer.role === 'unauthenticated') return jsonResponse(403, { ok: false, message: 'auth required' });
  const allowed = viewer.role === 'owner' || (Array.isArray(viewer.ventures) && (viewer.ventures.includes('*') || viewer.ventures.includes(bu)));
  if (!allowed) return jsonResponse(403, { ok: false, message: `not authorised for ${bu}` });

  try {
    const file = await getFile(env.GITHUB_PAT, pathFor(bu));
    const tasks = JSON.parse(file.content);
    const filtered = module ? tasks.filter(t => t.owner_module === module) : tasks;
    return jsonResponse(200, { ok: true, bu, module: module || null, tasks: filtered, total: tasks.length });
  } catch (e) {
    if (e.status === 404) return jsonResponse(200, { ok: true, bu, tasks: [], total: 0 });
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'invalid JSON' }); }
  const bu = (body.bu || '').toString().trim().toLowerCase();
  const action = (body.action || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!action) return jsonResponse(400, { ok: false, message: 'action required' });

  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  let file, tasks;
  try {
    file = await getFile(env.GITHUB_PAT, pathFor(bu));
    tasks = JSON.parse(file.content);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'could not read tasks.json: ' + (e.message || String(e)) });
  }

  const now = todayISO();

  try {
    if (action === 'spawn') {
      // Body: { bu, action: 'spawn', parent_task_id, child: { title, description, owner_module, target? } }
      const pid = (body.parent_task_id || '').toString().trim();
      const child = body.child || {};
      if (!pid) return jsonResponse(400, { ok: false, message: 'parent_task_id required' });
      const parent = tasks.find(t => t.id === pid);
      if (!parent) return jsonResponse(404, { ok: false, message: `parent ${pid} not found` });

      const id = 'T-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5);
      const newTask = {
        id, bu,
        title: (child.title || '').toString().slice(0, 200),
        description: (child.description || '').toString().slice(0, 4000),
        origin: 'spawn',
        proposer: viewer.email,
        proposed_at: now,
        owner_module: child.owner_module || parent.owner_module,
        target: child.target || null,
        status: 'proposed',
        parent_task_id: pid,
        spawned_task_ids: [],
        history: [{ at: now, actor: viewer.email, action: 'spawned_from', ref: pid }],
      };
      tasks.push(newTask);
      parent.spawned_task_ids = parent.spawned_task_ids || [];
      parent.spawned_task_ids.push(id);
      parent.history = parent.history || [];
      parent.history.push({ at: now, actor: viewer.email, action: 'spawned_child', ref: id });
    } else if (action === 'handoff') {
      // Body: { bu, action: 'handoff', task_id, to_module, to_agent? }
      const tid = (body.task_id || '').toString().trim();
      const to_module = (body.to_module || '').toString().trim();
      if (!tid) return jsonResponse(400, { ok: false, message: 'task_id required' });
      if (!to_module) return jsonResponse(400, { ok: false, message: 'to_module required' });
      const t = tasks.find(x => x.id === tid);
      if (!t) return jsonResponse(404, { ok: false, message: `task ${tid} not found` });
      const from_module = t.owner_module;
      t.owner_module = to_module;
      if (body.to_agent) t.target = { ...(t.target || {}), executor: body.to_agent };
      t.history = t.history || [];
      t.history.push({ at: now, actor: viewer.email, action: 'handoff', from: from_module, to: to_module });
    } else if (action === 'update_status') {
      const tid = (body.task_id || '').toString().trim();
      const status = (body.status || '').toString().trim();
      if (!tid) return jsonResponse(400, { ok: false, message: 'task_id required' });
      const t = tasks.find(x => x.id === tid);
      if (!t) return jsonResponse(404, { ok: false, message: `task ${tid} not found` });
      const prev = t.status;
      t.status = status;
      t.history = t.history || [];
      t.history.push({ at: now, actor: viewer.email, action: 'status_change', from: prev, to: status });

      // Parent-status auto-rollup: when a child flips to done, check whether all
      // sibling children are also done → mark parent done too. Cascades up the
      // chain so a deep tree closes cleanly when the last leaf finishes. We only
      // roll UP, never sideways or down, and we never overwrite a parent that's
      // already in a terminal state (done/cancelled/rejected).
      const TERMINAL = new Set(['done', 'cancelled', 'rejected', 'closed']);
      const cascade = (childId) => {
        const child = tasks.find(x => x.id === childId);
        if (!child?.parent_task_id) return;
        const parent = tasks.find(x => x.id === child.parent_task_id);
        if (!parent) return;
        if (TERMINAL.has((parent.status || '').toLowerCase())) return;
        const siblings = (parent.spawned_task_ids || []).map(sid => tasks.find(x => x.id === sid)).filter(Boolean);
        if (siblings.length === 0) return;
        if (!siblings.every(s => (s.status || '').toLowerCase() === 'done')) return;
        const parentPrev = parent.status;
        parent.status = 'done';
        parent.history = parent.history || [];
        parent.history.push({ at: now, actor: 'system', action: 'auto_rollup', from: parentPrev, to: 'done', reason: `all ${siblings.length} children done` });
        cascade(parent.id);
      };
      if (status === 'done') cascade(tid);
    } else {
      return jsonResponse(400, { ok: false, message: `unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'mutation failed: ' + (e.message || String(e)) });
  }

  try {
    await putFile(env.GITHUB_PAT, pathFor(bu), JSON.stringify(tasks, null, 2) + '\n', file.sha, `tasks: ${action} by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'write failed: ' + (e.message || String(e)) });
  }
  return jsonResponse(200, { ok: true, action, bu });
}
