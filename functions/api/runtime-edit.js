// POST /api/runtime-edit
//
// Body: { action: 'add' | 'edit' | 'remove', id, display_name?, kind?, endpoint?, owner_email?, description?, status? }
//
// Owner-only. Mutates dashboard/public/data/system/runtimes.json.
// Remove safety: refuses if any binding in agent_bindings.json references the runtime.

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const RUNTIMES_PATH = 'dashboard/public/data/system/runtimes.json';
const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';
const ROLES_PATH = 'dashboard/public/data/system/roles.json';
const VALID_KINDS = new Set(['paperclip-local', 'paperclip-cloud', 'github-actions', 'n8n', 'custom']);
const SLUG_RE = /^[a-z][a-z0-9-]{1,60}$/;

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;
  const viewer = gate;
  // Runtime CRUD is owner-only — runtimes affect Claude billing routing,
  // higher risk than typical writes.
  if (viewer.role !== 'owner') {
    return jsonResponse(403, { ok: false, message: 'Runtime CRUD is owner-only (affects billing routing).' });
  }

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }
  const action = (body.action || 'add').toString();
  if (!['add', 'edit', 'remove'].includes(action)) return jsonResponse(400, { ok: false, message: 'action must be add|edit|remove' });
  const id = (body.id || '').toString().trim().toLowerCase();
  if (!SLUG_RE.test(id)) return jsonResponse(400, { ok: false, message: 'id must be lowercase letters/digits/hyphens, 2-61 chars, start with a letter' });

  // Read runtimes
  let file;
  try { file = await getFile(env.GITHUB_PAT, RUNTIMES_PATH); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read runtimes: ' + (e.message || String(e)) }); }
  let data;
  try { data = JSON.parse(file.content); }
  catch { return jsonResponse(500, { ok: false, message: 'runtimes.json not valid JSON' }); }
  data.runtimes = data.runtimes || [];

  const existingIdx = data.runtimes.findIndex(r => r.id === id);
  const existing = existingIdx >= 0 ? data.runtimes[existingIdx] : null;

  // Validate kind if supplied
  if (body.kind !== undefined) {
    if (!VALID_KINDS.has(body.kind)) {
      return jsonResponse(400, { ok: false, message: `kind must be one of: ${[...VALID_KINDS].join(', ')}` });
    }
  }

  // Validate owner_email if supplied — must be in roles.json
  if (body.owner_email !== undefined && body.owner_email !== '') {
    try {
      const rolesFile = await getFile(env.GITHUB_PAT, ROLES_PATH);
      const roles = JSON.parse(rolesFile.content);
      const target = body.owner_email.toString().toLowerCase();
      if (!(roles.users || []).some(u => (u.email || '').toLowerCase() === target)) {
        return jsonResponse(404, { ok: false, message: `owner_email '${body.owner_email}' not in roles.json` });
      }
    } catch (e) {
      return jsonResponse(500, { ok: false, message: 'Could not validate owner_email: ' + (e.message || String(e)) });
    }
  }

  if (action === 'add') {
    if (existing) return jsonResponse(409, { ok: false, message: `Runtime '${id}' already exists; use action=edit` });
    if (!body.display_name) return jsonResponse(400, { ok: false, message: 'display_name is required' });
    if (!body.kind) return jsonResponse(400, { ok: false, message: 'kind is required' });
    if (!body.endpoint) return jsonResponse(400, { ok: false, message: 'endpoint is required' });
    if (!body.owner_email) return jsonResponse(400, { ok: false, message: 'owner_email is required' });
    data.runtimes.push({
      id,
      display_name: body.display_name.toString(),
      kind: body.kind,
      endpoint: body.endpoint.toString(),
      owner_email: body.owner_email.toString().toLowerCase(),
      description: body.description ? body.description.toString() : '',
      status: body.status || 'active',
    });
  } else if (action === 'edit') {
    if (!existing) return jsonResponse(404, { ok: false, message: `Runtime '${id}' not found` });
    const upd = { ...existing };
    for (const k of ['display_name', 'kind', 'endpoint', 'owner_email', 'description', 'status']) {
      if (body[k] !== undefined) upd[k] = body[k];
    }
    if (typeof upd.owner_email === 'string') upd.owner_email = upd.owner_email.toLowerCase();
    data.runtimes[existingIdx] = upd;
  } else if (action === 'remove') {
    if (!existing) return jsonResponse(404, { ok: false, message: `Runtime '${id}' not found` });
    // Safety: refuse if any binding references this runtime
    try {
      const bFile = await getFile(env.GITHUB_PAT, BINDINGS_PATH);
      const bData = JSON.parse(bFile.content);
      const referring = (bData.bindings || []).filter(b => b.runtime_id === id);
      if (referring.length > 0) {
        return jsonResponse(409, {
          ok: false,
          message: `Runtime '${id}' is bound to ${referring.length} agent${referring.length === 1 ? '' : 's'}; rebind them first.`,
          referring_bindings: referring.map(b => ({ bu: b.bu, module_id: b.module_id })),
        });
      }
    } catch (e) {
      return jsonResponse(500, { ok: false, message: 'Could not check bindings: ' + (e.message || String(e)) });
    }
    data.runtimes.splice(existingIdx, 1);
  }

  // Write back
  const newContent = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, RUNTIMES_PATH, newContent, file.sha, `runtimes: ${action} ${id}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write runtimes: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, action, id, runtimes_total: data.runtimes.length });
}
