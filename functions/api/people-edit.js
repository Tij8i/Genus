// POST /api/people-edit
//
// Body: { action: 'add' | 'edit' | 'remove', email, role?, ventures?, display_name?, title? }
//
// Owners + admins only. Adds / edits / removes entries in dashboard/public/data/system/roles.json.
// Owner can never demote/remove themselves (one-owner safeguard).

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const ROLES_PATH = 'dashboard/public/data/system/roles.json';
const VALID_ROLES = new Set(['owner', 'admin', 'member', 'observer']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;
  const viewer = gate;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const action = (body.action || 'add').toString();
  if (!['add', 'edit', 'remove'].includes(action)) return jsonResponse(400, { ok: false, message: 'action must be add|edit|remove' });

  const email = (body.email || '').toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return jsonResponse(400, { ok: false, message: 'valid email is required' });

  // Read roles
  let file;
  try { file = await getFile(env.GITHUB_PAT, ROLES_PATH); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read roles: ' + (e.message || String(e)) }); }
  let roles;
  try { roles = JSON.parse(file.content); }
  catch { return jsonResponse(500, { ok: false, message: 'roles.json not valid JSON' }); }
  roles.users = roles.users || [];

  const existingIdx = roles.users.findIndex(u => (u.email || '').toLowerCase() === email);
  const existing = existingIdx >= 0 ? roles.users[existingIdx] : null;

  // Only owners can change owner-role assignments
  const targetRole = body.role ? body.role.toString() : null;
  if (targetRole && !VALID_ROLES.has(targetRole)) {
    return jsonResponse(400, { ok: false, message: `role must be one of: ${[...VALID_ROLES].join(', ')}` });
  }
  if (action !== 'remove' && targetRole === 'owner' && viewer.role !== 'owner') {
    return jsonResponse(403, { ok: false, message: 'Only an owner can promote a user to owner' });
  }
  if (existing && existing.role === 'owner' && viewer.role !== 'owner') {
    return jsonResponse(403, { ok: false, message: 'Only an owner can edit/remove another owner' });
  }

  // One-owner safeguard
  const ownerCount = roles.users.filter(u => u.role === 'owner').length;

  if (action === 'add') {
    if (existing) return jsonResponse(409, { ok: false, message: `${email} already exists; use action=edit` });
    const newUser = {
      email,
      role: targetRole || 'member',
      ventures: Array.isArray(body.ventures) ? body.ventures : [],
      display_name: (body.display_name || email).toString(),
      title: (body.title || '').toString() || undefined,
    };
    roles.users.push(newUser);
  } else if (action === 'edit') {
    if (!existing) return jsonResponse(404, { ok: false, message: `${email} not found` });
    // Demoting an owner — block if last owner
    if (existing.role === 'owner' && targetRole && targetRole !== 'owner' && ownerCount <= 1) {
      return jsonResponse(400, { ok: false, message: 'Cannot demote the only owner — promote another user first' });
    }
    const updated = { ...existing };
    if (targetRole) updated.role = targetRole;
    if (Array.isArray(body.ventures)) updated.ventures = body.ventures;
    if (body.display_name !== undefined) updated.display_name = body.display_name.toString();
    if (body.title !== undefined) updated.title = body.title.toString();
    roles.users[existingIdx] = updated;
  } else if (action === 'remove') {
    if (!existing) return jsonResponse(404, { ok: false, message: `${email} not found` });
    if (existing.role === 'owner' && ownerCount <= 1) {
      return jsonResponse(400, { ok: false, message: 'Cannot remove the only owner' });
    }
    if (existing.email.toLowerCase() === viewer.email.toLowerCase()) {
      return jsonResponse(400, { ok: false, message: 'You cannot remove yourself' });
    }
    roles.users.splice(existingIdx, 1);
  }

  // Write back
  const newContent = JSON.stringify(roles, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, ROLES_PATH, newContent, file.sha, `people: ${action} ${email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write roles: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, action, email, users_total: roles.users.length });
}
