// GET /api/admin-state
//
// Returns { users, runtimes, bindings } — the three system files combined.
// Owner/admin only. Used by Settings → People + Modules → bindings UI so the
// client can render rosters without re-implementing role gating per file.

import { getFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();

  const reads = await Promise.all([
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/roles.json'),
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/runtimes.json'),
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/agent_bindings.json'),
  ]);

  const [rolesData, runtimesData, bindingsData] = reads;
  let users = rolesData?.users || [];
  let bindings = bindingsData?.bindings || [];

  // BU scoping — each BU is a permission-isolated view (operator security
  // requirement Session #18/19): you only see people + bindings for the BU
  // you're currently looking at. Owner role of the requesting viewer still
  // applies (owner sees all rosters across all BUs they switch into).
  //
  // Requesting viewers who are NOT owner can only request BUs in their ventures.
  if (bu) {
    if (viewer.role !== 'owner' && Array.isArray(viewer.ventures)
        && !viewer.ventures.includes('*') && !viewer.ventures.includes(bu)) {
      return jsonResponse(403, { ok: false, message: `Viewer not authorized for BU '${bu}'` });
    }
    users = users.filter(u => {
      const v = u.ventures || [];
      return v.includes('*') || v.includes(bu);
    });
    bindings = bindings.filter(b => b.bu === bu);
  }

  return jsonResponse(200, {
    ok: true,
    bu: bu || null,
    users,
    runtimes: runtimesData?.runtimes || [],
    bindings,
  });
}

async function safeRead(pat, path) {
  try {
    const file = await getFile(pat, path);
    return JSON.parse(file.content);
  } catch (_) {
    return null;
  }
}
