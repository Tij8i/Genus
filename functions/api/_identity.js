// Shared identity helpers for Genus Pages Functions.
//
// Identity model (per GEN-107):
//   - Cloudflare Access authenticates the request and injects the verified
//     email into the `cf-access-authenticated-user-email` request header.
//   - Roles + venture scoping live in Orchestrator at
//     dashboard/public/data/system/roles.json (operator-edited).
//   - This helper resolves the verified email against roles.json and returns
//     { email, role, ventures, display_name?, title? } — or null if no header.
//
// Local dev: when no CF Access header is present, we fall back to the first
// admin in roles.json so `wrangler pages dev` still works. Production traffic
// is fronted by CF Access; the header is always present in prod.
//
// Security: roles.json is read server-side only. The /api/identity endpoint
// returns the resolved viewer (their email, role, ventures) — never the full
// roster. Write endpoints call requireAdmin() to gate mutations.

import { getFile, jsonResponse } from './_gh.js';

const ROLES_PATH = 'dashboard/public/data/system/roles.json';
const CF_ACCESS_HEADER = 'cf-access-authenticated-user-email';

// Returns the verified email from the CF Access header, or null if absent.
// Lowercases so roles.json lookups are case-insensitive.
export function readCfAccessEmail(request) {
  const raw = request.headers.get(CF_ACCESS_HEADER);
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

// Loads roles.json from Orchestrator. Throws on PAT-missing / network error.
async function loadRoles(env) {
  if (!env.GITHUB_PAT) {
    throw { status: 500, message: 'GITHUB_PAT env var not set on the project' };
  }
  let raw;
  try {
    raw = await getFile(env.GITHUB_PAT, ROLES_PATH);
  } catch (e) {
    // Missing roles.json is a misconfiguration but shouldn't 500 the whole
    // dashboard — surface it as 503 so the boot banner explains.
    throw { status: 503, message: `roles.json not found in Orchestrator at ${ROLES_PATH}: ${e.message || e}` };
  }
  let parsed;
  try { parsed = JSON.parse(raw.content); }
  catch (e) { throw { status: 500, message: `roles.json parse error: ${e.message || e}` }; }
  if (!parsed || !Array.isArray(parsed.users)) {
    throw { status: 500, message: 'roles.json malformed: missing users array' };
  }
  return parsed;
}

// Resolves the viewer for this request:
//   - reads CF Access email
//   - looks up roles.json
//   - returns { email, role, ventures, display_name, title } or null
//
// If CF Access header is absent (local dev), returns the first admin in
// roles.json with a `dev_fallback: true` flag so the client can show a banner.
// If the verified email isn't in roles.json, returns { email, role: 'unknown', ventures: [] }
// so the client can render a "no access" screen instead of crashing.
export async function getViewerIdentity(request, env) {
  const roles = await loadRoles(env);
  const email = readCfAccessEmail(request);
  if (!email) {
    const firstAdmin = roles.users.find(u => u.role === 'admin');
    if (!firstAdmin) {
      return { email: null, role: 'unauthenticated', ventures: [], dev_fallback: true };
    }
    return {
      email: firstAdmin.email,
      role: firstAdmin.role,
      ventures: firstAdmin.ventures || ['*'],
      display_name: firstAdmin.display_name || firstAdmin.email,
      title: firstAdmin.title || 'Admin',
      dev_fallback: true,
    };
  }
  const match = roles.users.find(u => (u.email || '').toLowerCase() === email);
  if (!match) {
    return { email, role: 'unknown', ventures: [] };
  }
  return {
    email: match.email,
    role: match.role,
    ventures: match.ventures || [],
    display_name: match.display_name || match.email,
    title: match.title || (match.role === 'admin' ? 'Admin' : 'Observer'),
  };
}

// Gate helper for write endpoints. Returns the viewer identity if admin.
// Otherwise returns a Response (403 / 401 / 503) that the endpoint must
// return immediately.
//
// Optional buCheck: if the endpoint targets a specific BU, pass it to
// also enforce venture scoping (admin with ventures: ['tuto'] can't write
// to 'equiply'). Defaults to skipping the BU check.
//
// Usage in a write Function:
//
//   const gate = await requireAdmin(request, env, { bu: 'tuto' });
//   if (gate instanceof Response) return gate;
//   const viewer = gate;   // proceed; viewer.email is the verified writer
export async function requireAdmin(request, env, { bu } = {}) {
  let viewer;
  try { viewer = await getViewerIdentity(request, env); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }
  if (!viewer || viewer.role === 'unauthenticated') {
    return jsonResponse(401, { ok: false, message: 'Authentication required — CF Access header missing.' });
  }
  if (viewer.role === 'unknown') {
    return jsonResponse(403, { ok: false, message: `${viewer.email} is not in roles.json — contact the operator.` });
  }
  if (viewer.role !== 'admin') {
    return jsonResponse(403, { ok: false, message: `Observer mode — write actions are read-only. (role=${viewer.role})` });
  }
  if (bu && Array.isArray(viewer.ventures) && !viewer.ventures.includes('*') && !viewer.ventures.includes(bu)) {
    return jsonResponse(403, { ok: false, message: `${viewer.email} does not have access to venture "${bu}".` });
  }
  return viewer;
}
