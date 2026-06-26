// POST /api/agent-binding-edit
//
// Body: { bu, module_id, runtime_id?, hitl_owner_email? }
//
// Updates the agent binding for (bu × module_id) in agent_bindings.json.
// Creates the binding if missing (treats absence as "use defaults").
// Owners + admins only; admins gated to ventures they have access to.

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';
const RUNTIMES_PATH = 'dashboard/public/data/system/runtimes.json';
const ROLES_PATH = 'dashboard/public/data/system/roles.json';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const module_id = (body.module_id || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!module_id) return jsonResponse(400, { ok: false, message: 'module_id is required' });

  // Gate (BU-scoped if admin/member)
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  // Validate runtime_id exists (if provided)
  if (body.runtime_id !== undefined && body.runtime_id !== null && body.runtime_id !== '') {
    let runtimesFile;
    try { runtimesFile = await getFile(env.GITHUB_PAT, RUNTIMES_PATH); }
    catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read runtimes: ' + (e.message || String(e)) }); }
    let runtimes;
    try { runtimes = JSON.parse(runtimesFile.content); }
    catch { return jsonResponse(500, { ok: false, message: 'runtimes.json not valid JSON' }); }
    const valid = (runtimes.runtimes || []).some(r => r.id === body.runtime_id);
    if (!valid) return jsonResponse(404, { ok: false, message: `runtime_id '${body.runtime_id}' not found in runtimes.json` });
  }

  // Validate hitl_owner_email exists in roles.json (if provided)
  if (body.hitl_owner_email !== undefined && body.hitl_owner_email !== null && body.hitl_owner_email !== '') {
    let rolesFile;
    try { rolesFile = await getFile(env.GITHUB_PAT, ROLES_PATH); }
    catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read roles: ' + (e.message || String(e)) }); }
    let roles;
    try { roles = JSON.parse(rolesFile.content); }
    catch { return jsonResponse(500, { ok: false, message: 'roles.json not valid JSON' }); }
    const target = body.hitl_owner_email.toString().toLowerCase();
    const valid = (roles.users || []).some(u => (u.email || '').toLowerCase() === target);
    if (!valid) return jsonResponse(404, { ok: false, message: `hitl_owner_email '${body.hitl_owner_email}' not in roles.json` });
  }

  // Load + mutate bindings
  let file;
  try { file = await getFile(env.GITHUB_PAT, BINDINGS_PATH); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read bindings: ' + (e.message || String(e)) }); }
  let data;
  try { data = JSON.parse(file.content); }
  catch { return jsonResponse(500, { ok: false, message: 'agent_bindings.json not valid JSON' }); }
  data.bindings = data.bindings || [];

  const idx = data.bindings.findIndex(b => b.bu === bu && b.module_id === module_id);
  const now = new Date().toISOString();
  if (idx === -1) {
    const fresh = {
      bu,
      module_id,
      agent_id: `${module_id}-stewart-of-${bu}`,
      runtime_id: body.runtime_id || null,
      hitl_owner_email: body.hitl_owner_email || viewer.email,
      installer_email: viewer.email,
      installed_at: now,
    };
    data.bindings.push(fresh);
  } else {
    const upd = { ...data.bindings[idx] };
    if (body.runtime_id !== undefined) upd.runtime_id = body.runtime_id || null;
    if (body.hitl_owner_email !== undefined) upd.hitl_owner_email = body.hitl_owner_email || viewer.email;
    upd.edited_at = now;
    upd.edited_by = viewer.email;
    data.bindings[idx] = upd;
  }

  const newContent = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, BINDINGS_PATH, newContent, file.sha, `bindings: edit ${bu}/${module_id} (by ${viewer.email})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write bindings: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, bu, module_id, binding: data.bindings.find(b => b.bu === bu && b.module_id === module_id) });
}
