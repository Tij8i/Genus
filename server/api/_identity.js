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

import { getFile, jsonResponse } from '../storage/index.js';

// Local-install identity fallback (phase 4a of i56, per BRIEF D3).
//
// The Docker Compose install runs on the operator's laptop with no Cloudflare
// Access in front of it. localhost = trusted (BRIEF D3), so we short-circuit
// the roles.json lookup and return a single always-admin identity. Downstream
// requireAdmin() calls then see role=owner and let mutations through without
// modification.
//
// Docker Compose (phase 4c) will set GENUS_LOCAL_MODE=1. When unset (i.e. the
// module is imported by a test or by the Cloudflare Pages fork of these files)
// this fallback is inactive and the original CF Access + roles.json flow runs.
const LOCAL_ADMIN_IDENTITY = {
  email: 'local@genus',
  role: 'owner',
  ventures: ['*'],
  display_name: 'Local Admin',
  title: 'Owner (local)',
  local_mode: true,
};

function isLocalMode() {
  return process.env.GENUS_LOCAL_MODE === '1';
}

const ROLES_PATH = 'dashboard/public/data/system/roles.json';

function titleForRole(r) {
  return ({ owner: 'Owner', admin: 'Admin', member: 'Member', observer: 'Observer' })[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Member');
}
const CF_ACCESS_HEADER = 'cf-access-authenticated-user-email';
const VIEW_AS_HEADER = 'x-genus-view-as';
const VIEW_AS_QUERY = 'viewAs';
const VALID_PREVIEW_ROLES = new Set(['observer', 'unknown', 'unauthenticated']);

// Returns the verified email from the CF Access header, or null if absent.
// Lowercases so roles.json lookups are case-insensitive.
export function readCfAccessEmail(request) {
  const raw = request.headers.get(CF_ACCESS_HEADER);
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

// Read the preview-as override from either the query string or the
// x-genus-view-as header. Used so an admin can simulate observer/unknown/
// unauthenticated for end-to-end testing on the preview environment without
// editing roles.json or adding a second user.
//
// Only roles below admin are valid here — you can downgrade yourself, never
// upgrade. The actual admin check happens in getViewerIdentity() below.
function readPreviewAs(request) {
  let candidate = null;
  try {
    const url = new URL(request.url);
    candidate = url.searchParams.get(VIEW_AS_QUERY);
  } catch { /* request.url not parseable — fall through to header */ }
  if (!candidate) candidate = request.headers.get(VIEW_AS_HEADER);
  if (!candidate) return null;
  const normalized = candidate.trim().toLowerCase();
  return VALID_PREVIEW_ROLES.has(normalized) ? normalized : null;
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
  // Local install short-circuit (see LOCAL_ADMIN_IDENTITY at top of file).
  // No CF Access, no roles.json, no PAT — everything is one trusted admin.
  if (isLocalMode()) {
    return { ...LOCAL_ADMIN_IDENTITY };
  }
  const roles = await loadRoles(env);
  const email = readCfAccessEmail(request);
  let actual;
  if (!email) {
    const firstAdmin = roles.users.find(u => u.role === 'owner' || u.role === 'admin');
    if (!firstAdmin) {
      actual = { email: null, role: 'unauthenticated', ventures: [], dev_fallback: true };
    } else {
      actual = {
        email: firstAdmin.email,
        role: firstAdmin.role,
        ventures: firstAdmin.ventures || ['*'],
        display_name: firstAdmin.display_name || firstAdmin.email,
        title: firstAdmin.title || 'Admin',
        dev_fallback: true,
      };
    }
  } else {
    const match = roles.users.find(u => (u.email || '').toLowerCase() === email);
    if (!match) {
      actual = { email, role: 'unknown', ventures: [] };
    } else {
      actual = {
        email: match.email,
        role: match.role,
        ventures: match.ventures || [],
        display_name: match.display_name || match.email,
        title: match.title || titleForRole(match.role),
      };
    }
  }

  // Preview-as override: an actual admin can downgrade themselves to observer
  // (or unknown / unauthenticated) for the duration of a request by passing
  // ?viewAs=observer or x-genus-view-as: observer. Non-admins are ignored —
  // this is one-way (de-escalation only). Honest end-to-end test path for
  // preview environments without needing a second test email + CF Access
  // policy edit.
  const previewAs = readPreviewAs(request);
  if (previewAs && (actual.role === 'admin' || actual.role === 'owner')) {
    return {
      ...actual,
      role: previewAs,
      ventures: previewAs === 'observer' ? ['tuto'] : [],
      title: previewAs === 'observer' ? 'Observer (preview)'
            : previewAs === 'unknown' ? 'No access (preview)'
            : 'Not signed in (preview)',
      preview_as: previewAs,
      actual_role: 'admin',
      actual_email: actual.email,
    };
  }
  return actual;
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
  if (viewer.role !== 'admin' && viewer.role !== 'owner') {
    return jsonResponse(403, { ok: false, message: `Insufficient role for this action. (role=${viewer.role}; need owner or admin)` });
  }
  if (bu && Array.isArray(viewer.ventures) && !viewer.ventures.includes('*') && !viewer.ventures.includes(bu)) {
    return jsonResponse(403, { ok: false, message: `${viewer.email} does not have access to venture "${bu}".` });
  }
  return viewer;
}
