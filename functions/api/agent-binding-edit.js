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
  const action = (body.action || 'upsert').toString().trim(); // upsert | add | remove
  const module_id = (body.module_id || '').toString().trim();
  const agent_id_in = (body.agent_id || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (action !== 'remove' && action !== 'add' && action !== 'upsert' && action !== 'edit') {
    return jsonResponse(400, { ok: false, message: `Unknown action: ${action}` });
  }
  if ((action === 'upsert' || action === 'add') && !module_id && !agent_id_in) {
    return jsonResponse(400, { ok: false, message: 'module_id or agent_id is required' });
  }
  if (action === 'remove' && !agent_id_in) {
    return jsonResponse(400, { ok: false, message: 'agent_id is required for remove' });
  }
  if (action === 'edit' && !agent_id_in && !module_id) {
    return jsonResponse(400, { ok: false, message: 'agent_id or module_id is required for edit' });
  }

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

  const now = new Date().toISOString();
  let commitSummary;
  let resultBinding;

  if (action === 'remove') {
    const before = data.bindings.length;
    data.bindings = data.bindings.filter(b => !(b.bu === bu && b.agent_id === agent_id_in));
    if (data.bindings.length === before) {
      return jsonResponse(404, { ok: false, message: `No binding found for bu=${bu} agent_id=${agent_id_in}` });
    }
    commitSummary = `remove ${bu}/${agent_id_in}`;
    resultBinding = null;
  } else if (action === 'add') {
    const archetype = (body.archetype || 'Stewart').toString();
    const agent_id = agent_id_in || `${module_id}-stewart-of-${bu}`;
    if (data.bindings.some(b => b.bu === bu && b.agent_id === agent_id)) {
      return jsonResponse(409, { ok: false, message: `Binding for agent_id '${agent_id}' already exists in bu '${bu}'` });
    }
    const fresh = {
      bu,
      module_id: module_id || null,
      agent_id,
      archetype,
      display_name: (body.display_name || '').toString() || null,
      runtime_id: body.runtime_id || null,
      hitl_owner_email: body.hitl_owner_email || viewer.email,
      covers_areas: Array.isArray(body.covers_areas) ? body.covers_areas : [],
      lead: typeof body.lead === 'boolean' ? body.lead : false,
      installer_email: viewer.email,
      installed_at: now,
    };
    data.bindings.push(fresh);
    commitSummary = `add ${bu}/${agent_id}`;
    resultBinding = fresh;
  } else {
    // 'upsert' (back-compat) and 'edit' (explicit)
    let idx;
    if (agent_id_in) {
      idx = data.bindings.findIndex(b => b.bu === bu && b.agent_id === agent_id_in);
    } else {
      idx = data.bindings.findIndex(b => b.bu === bu && b.module_id === module_id);
    }
    if (idx === -1) {
      if (action === 'edit') {
        return jsonResponse(404, { ok: false, message: `No binding found to edit for bu=${bu} ${agent_id_in ? 'agent_id=' + agent_id_in : 'module_id=' + module_id}` });
      }
      const fresh = {
        bu,
        module_id: module_id || null,
        agent_id: agent_id_in || `${module_id}-stewart-of-${bu}`,
        archetype: (body.archetype || 'Stewart').toString(),
        runtime_id: body.runtime_id || null,
        hitl_owner_email: body.hitl_owner_email || viewer.email,
        covers_areas: Array.isArray(body.covers_areas) ? body.covers_areas : [],
        lead: typeof body.lead === 'boolean' ? body.lead : false,
        installer_email: viewer.email,
        installed_at: now,
      };
      data.bindings.push(fresh);
      commitSummary = `add ${bu}/${fresh.agent_id} (upsert)`;
      resultBinding = fresh;
    } else {
      const upd = { ...data.bindings[idx] };
      if (body.runtime_id !== undefined) upd.runtime_id = body.runtime_id || null;
      if (body.hitl_owner_email !== undefined) upd.hitl_owner_email = body.hitl_owner_email || viewer.email;
      if (Array.isArray(body.covers_areas)) upd.covers_areas = body.covers_areas;
      if (typeof body.lead === 'boolean') upd.lead = body.lead;
      if (typeof body.archetype === 'string') upd.archetype = body.archetype;
      if (typeof body.display_name === 'string') upd.display_name = body.display_name || null;
      upd.edited_at = now;
      upd.edited_by = viewer.email;
      data.bindings[idx] = upd;
      commitSummary = `edit ${bu}/${upd.agent_id}`;
      resultBinding = upd;
    }
  }

  const newContent = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, BINDINGS_PATH, newContent, file.sha, `bindings: ${commitSummary} (by ${viewer.email})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write bindings: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, bu, action, binding: resultBinding });
}
