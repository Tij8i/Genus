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

  const reads = await Promise.all([
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/roles.json'),
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/runtimes.json'),
    safeRead(env.GITHUB_PAT, 'dashboard/public/data/system/agent_bindings.json'),
  ]);

  const [rolesData, runtimesData, bindingsData] = reads;
  return jsonResponse(200, {
    ok: true,
    users: rolesData?.users || [],
    runtimes: runtimesData?.runtimes || [],
    bindings: bindingsData?.bindings || [],
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
