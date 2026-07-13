// GET  /api/discipline?bu=<bu>&module=<mod>
// POST /api/discipline
//
// Roadmap i41 — per-module Discipline surface.
// The rules the operator + the module's Stewart have agreed to follow.
// Rules can be in state: pending (proposed, awaiting decision), agreed,
// rejected (with reason). Rejected rules stay in the file for archaeology.
//
// GET returns: { ok, bu, module, description, rules: [...] }
//   Missing file → { ok, empty: true, rules: [] }
//
// POST body: { bu, module, action, ... }
//   action:
//     propose_rule  { rule: { title, body, evidence?: [] } }
//     agree_rule    { rule_id }
//     reject_rule   { rule_id, reason }
//     edit_rule     { rule_id, fields: { title?, body? } }   // pre-agreement edits
//     remove_rule   { rule_id }                              // owner-only
//
// Owners + admins scoped to the BU may propose / agree / reject / edit.
// Members / observers get read-only GET.

import { getFile, putFile, jsonResponse, todayISO } from '../storage/index.js';
import { requireAdmin, getViewerIdentity } from './_identity.js';

const VALID_MODULES = new Set(['product', 'strategy', 'finance', 'development', 'growth', 'operations', 'workshop']);

function pathFor(bu, mod) {
  return `dashboard/public/data/bus/${bu}/${mod}/discipline.json`;
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  const module = (url.searchParams.get('module') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!module) return jsonResponse(400, { ok: false, message: 'module is required' });
  if (!VALID_MODULES.has(module)) return jsonResponse(400, { ok: false, message: `Unknown module: ${module}` });

  // Read gate: any authenticated viewer with access to this BU may read.
  const viewer = await getViewerIdentity(request, env);
  if (!viewer || viewer.role === 'unauthenticated' || viewer.role === 'unknown') {
    return jsonResponse(403, { ok: false, message: 'Authentication required' });
  }
  const allowed = viewer.role === 'owner'
    || (Array.isArray(viewer.ventures) && (viewer.ventures.includes('*') || viewer.ventures.includes(bu)));
  if (!allowed) return jsonResponse(403, { ok: false, message: `Viewer not authorized for BU '${bu}'` });

  try {
    const file = await getFile(env.GITHUB_PAT, pathFor(bu, module));
    const data = JSON.parse(file.content);
    return jsonResponse(200, { ok: true, bu, module, description: data.description || '', rules: data.rules || [] });
  } catch (e) {
    if (e.status === 404) {
      return jsonResponse(200, { ok: true, bu, module, empty: true, description: '', rules: [] });
    }
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not read discipline.json: ' + (e.message || String(e)) });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim().toLowerCase();
  const module = (body.module || '').toString().trim().toLowerCase();
  const action = (body.action || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!module) return jsonResponse(400, { ok: false, message: 'module is required' });
  if (!VALID_MODULES.has(module)) return jsonResponse(400, { ok: false, message: `Unknown module: ${module}` });
  if (!action) return jsonResponse(400, { ok: false, message: 'action is required' });

  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = pathFor(bu, module);
  let file = null;
  let data;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    if (e.status === 404) {
      data = {
        $schema: 'https://genus.work/schemas/discipline-v0.json',
        version: 1,
        bu,
        module,
        description: '',
        rules: [],
      };
    } else {
      return jsonResponse(e.status || 500, { ok: false, message: 'Could not read discipline.json: ' + (e.message || String(e)) });
    }
  }
  data.rules = Array.isArray(data.rules) ? data.rules : [];
  const now = todayISO();

  try {
    if (action === 'propose_rule') {
      const r = body.rule || {};
      const title = (r.title || '').toString().trim();
      const ruleBody = (r.body || '').toString().trim();
      if (!title) return jsonResponse(400, { ok: false, message: 'rule.title is required' });
      if (!ruleBody) return jsonResponse(400, { ok: false, message: 'rule.body is required' });
      const id = `d-${now.slice(0,10)}-${slug(title).slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
      const evidence = Array.isArray(r.evidence)
        ? r.evidence.filter(e => e && typeof e === 'object').map(e => ({ t: (e.t || now.slice(0,10)).toString(), signal: (e.signal || '').toString().slice(0, 400) }))
        : [];
      data.rules.push({
        id,
        title: title.slice(0, 200),
        body: ruleBody.slice(0, 4000),
        status: 'pending',
        proposed_by: r.proposed_by || viewer.email,
        proposed_at: now,
        evidence,
      });
    } else if (action === 'agree_rule') {
      const rule_id = (body.rule_id || '').toString().trim();
      if (!rule_id) return jsonResponse(400, { ok: false, message: 'rule_id is required' });
      const r = data.rules.find(x => x.id === rule_id);
      if (!r) return jsonResponse(404, { ok: false, message: `Rule '${rule_id}' not found` });
      if (r.status !== 'pending') return jsonResponse(409, { ok: false, message: `Rule '${rule_id}' is already ${r.status}` });
      r.status = 'agreed';
      r.agreed_at = now;
      r.agreed_by = viewer.email;
    } else if (action === 'reject_rule') {
      const rule_id = (body.rule_id || '').toString().trim();
      const reason = (body.reason || '').toString().trim();
      if (!rule_id) return jsonResponse(400, { ok: false, message: 'rule_id is required' });
      const r = data.rules.find(x => x.id === rule_id);
      if (!r) return jsonResponse(404, { ok: false, message: `Rule '${rule_id}' not found` });
      if (r.status !== 'pending') return jsonResponse(409, { ok: false, message: `Rule '${rule_id}' is already ${r.status}` });
      r.status = 'rejected';
      r.decided_at = now;
      r.decided_reason = reason || 'No reason given.';
      r.decided_by = viewer.email;
    } else if (action === 'edit_rule') {
      const rule_id = (body.rule_id || '').toString().trim();
      const fields = body.fields || {};
      if (!rule_id) return jsonResponse(400, { ok: false, message: 'rule_id is required' });
      const r = data.rules.find(x => x.id === rule_id);
      if (!r) return jsonResponse(404, { ok: false, message: `Rule '${rule_id}' not found` });
      if (typeof fields.title === 'string' && fields.title.trim()) r.title = fields.title.trim().slice(0, 200);
      if (typeof fields.body === 'string' && fields.body.trim()) r.body = fields.body.trim().slice(0, 4000);
      r.last_edited_at = now;
      r.last_edited_by = viewer.email;
    } else if (action === 'remove_rule') {
      const rule_id = (body.rule_id || '').toString().trim();
      if (!rule_id) return jsonResponse(400, { ok: false, message: 'rule_id is required' });
      const idx = data.rules.findIndex(x => x.id === rule_id);
      if (idx === -1) return jsonResponse(404, { ok: false, message: `Rule '${rule_id}' not found` });
      data.rules.splice(idx, 1);
    } else {
      return jsonResponse(400, { ok: false, message: `Unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'Mutation failed: ' + (e.message || String(e)) });
  }

  const commitMessage = `discipline: ${action} for ${bu}/${module} by ${viewer.email}`;
  const content = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, PATH, content, file ? file.sha : null, commitMessage);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Write failed: ' + (e.message || String(e)) });
  }
  return jsonResponse(200, { ok: true, action, bu, module });
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
