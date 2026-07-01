// GET /api/substrate?path=bus/tuto/initiatives.json
//
// Read a substrate file from Tij8i/Orchestrator and return its contents.
// Single generic endpoint instead of one-Function-per-file. Path is
// constrained to `bus/<bu>/<filename>` to prevent the dashboard from
// fetching anything outside the substrate scope (no source code, no
// agent canonicals, no .git history).
//
// Per [[genus-repo-split-substrate]]: substrate stays in Orchestrator.
// Genus dashboard reads it cross-repo via the GITHUB_PAT env var.
//
// Response on success: { ok: true, path, size, content_type, content }
// Response on bad path: 400 { ok: false, message }
// Response on missing: 404 { ok: false, message }
//
// The content is returned as a JSON-encoded string (the file's raw bytes
// decoded as UTF-8). Caller does JSON.parse / JSONL.parse as needed.

import { getFile, jsonResponse } from './_gh.js';
import { requireExternalRead } from './_external_auth.js';

// Substrate scope allowlist — only paths under these prefixes are readable.
// Keep tight: this Function is exposed publicly, and any GET goes via the
// dashboard's GITHUB_PAT secret. We don't want raw Orchestrator code leaking.
const ALLOWED_PREFIXES = [
  'dashboard/public/data/bus/',  // primary substrate (per-BU JSON + JSONL)
];

// Extract the BU segment from a path like "dashboard/public/data/bus/<bu>/..."
// Used to enforce BU scoping on external-token reads (roadmap i30).
function buFromPath(p) {
  const m = /^dashboard\/public\/data\/bus\/([a-z][a-z0-9-]*)\//.exec(p || '');
  return m ? m[1] : null;
}

function pathIsAllowed(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..')) return false;          // no traversal
  if (path.includes('\0')) return false;          // no null bytes
  if (!ALLOWED_PREFIXES.some(p => path.startsWith(p))) return false;
  return true;
}

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) {
    return jsonResponse(500, { ok: false, message: 'GITHUB_PAT env var not set on the project' });
  }
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) {
    return jsonResponse(400, { ok: false, message: 'query param `path` is required' });
  }
  if (!pathIsAllowed(path)) {
    return jsonResponse(400, {
      ok: false,
      message: `path must be under one of: ${ALLOWED_PREFIXES.join(', ')}`,
      requested_path: path,
    });
  }

  // Two-path auth (roadmap i30):
  //   • Dashboard users hit this endpoint with a CF Access header — no
  //     external gating needed (the substrate is meant to be dashboard-
  //     visible for all admin/owner viewers).
  //   • External Claude instances hit with `Authorization: Bearer gns_...` —
  //     we verify the token against external_access.json for the requested
  //     BU and gate the read.
  // requireExternalRead returns null when no Bearer is present (fall through)
  // or a Response/object as documented in _external_auth.js.
  const targetBu = buFromPath(path);
  const external = await requireExternalRead(request, env, {
    bu: targetBu,
    scope: 'read',
    jsonResponse,
  });
  if (external instanceof Response) return external;
  // external === null means no Bearer — dashboard path — proceed unrestricted
  // external is verified → we already scoped by BU inside requireExternalRead

  try {
    const result = await getFile(env.GITHUB_PAT, path);
    return jsonResponse(200, {
      ok: true,
      path,
      size: (result.content || '').length,
      content: result.content,
      sha: result.sha,
      ...(external ? { authed_via: 'external-token', token_id: external.token_id } : {}),
    });
  } catch (e) {
    return jsonResponse(e.status || 500, {
      ok: false,
      message: e.message || String(e),
      requested_path: path,
    });
  }
}
