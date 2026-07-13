// Shared external-access token verification helper (roadmap i30).
//
// External Claude instances (and future MCP clients) authenticate with an
// `Authorization: Bearer gns_<bu_prefix>_<32-char-base62>` header. This module
// resolves that Bearer against the plaintext-hash records stored in
// `dashboard/public/data/bus/{BU}/external_access.json`.
//
// Token format is minted by external-access-edit.js at grant time:
//   token       = "gns_" + bu.slice(0,3) + "_" + randomBase62(32)
//   token_hash  = sha256_hex(token)
// The bu-prefix is a hint used to load the right per-BU file quickly. It is
// NOT the security boundary — the SHA-256 match is. A caller can forge the
// prefix and still be rejected because the hash won't match anything.
//
// Two return shapes:
//   verifyExternalToken(request, env) →
//     null           — no Bearer header (endpoint falls through to CF Access)
//     { ok: false, status, message }        — Bearer present but invalid
//     { ok: true, entry, bu, scopes, token_id, hash_prefix } — verified
//
// The verified path also fire-and-forgets a `touchLastSeen()` write to update
// entry.last_seen so operators can see idle tokens in the Roster External tab.
// If that write fails (rate limit, contention), it's silently swallowed —
// don't fail the read path on audit-trail hiccups.

import { getFile, putFile } from '../storage/index.js';

const BEARER_PREFIX_RE = /^Bearer\s+(gns_[a-z0-9]{1,4}_[A-Za-z0-9]{16,64})$/;

// Read Bearer from Authorization header. Returns the raw plaintext token
// (still needs hashing) or null if header absent / malformed. Malformed
// (Basic auth, wrong prefix, etc.) → null: caller treats as "no external
// auth attempted" and falls through to CF Access. Only a well-formed gns_
// token that then fails hash-match is treated as an outright rejection.
function readBearerToken(request) {
  const raw = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!raw) return null;
  const m = BEARER_PREFIX_RE.exec(raw.trim());
  return m ? m[1] : null;
}

function extractBuPrefix(token) {
  // Format: gns_<bu_prefix>_<rand>
  const parts = token.split('_');
  if (parts.length < 3 || parts[0] !== 'gns') return null;
  return parts[1].toLowerCase();
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadExternalAccessForBu(pat, bu) {
  const path = `dashboard/public/data/bus/${bu}/external_access.json`;
  try {
    const file = await getFile(pat, path);
    const parsed = JSON.parse(file.content);
    return { path, file, parsed };
  } catch (e) {
    // 404 = BU exists but external_access.json wasn't seeded (or BU doesn't
    // exist). Treat as "no matching tokens on that BU." Same for parse errors.
    return null;
  }
}

// Best-effort audit-trail update. On any error (write conflict, rate limit,
// etc.) we swallow and continue — the read shouldn't fail because we couldn't
// bump a timestamp.
async function touchLastSeen(pat, bu, entryId) {
  try {
    const path = `dashboard/public/data/bus/${bu}/external_access.json`;
    const file = await getFile(pat, path);
    const parsed = JSON.parse(file.content);
    const idx = (parsed.entries || []).findIndex(e => e.id === entryId);
    if (idx === -1) return;
    const now = new Date().toISOString();
    // Skip the write entirely if we already updated within the last hour
    // to avoid write-storm on hot-path tokens.
    const prev = parsed.entries[idx].last_seen;
    if (prev && (Date.now() - new Date(prev).getTime()) < 3600 * 1000) return;
    parsed.entries[idx].last_seen = now;
    const body = JSON.stringify(parsed, null, 2) + '\n';
    await putFile(pat, path, body, file.sha, `external-access: touch last_seen for ${bu}/${entryId}`);
  } catch { /* audit-only, swallow */ }
}

// Main entry point. See file header for return contract.
export async function verifyExternalToken(request, env) {
  const token = readBearerToken(request);
  if (!token) return null;

  if (!env.GITHUB_PAT) {
    return { ok: false, status: 500, message: 'GITHUB_PAT env var not set on the project' };
  }

  const bu = extractBuPrefix(token);
  if (!bu) return { ok: false, status: 401, message: 'malformed token' };

  // We use the prefix as a HINT to find the file quickly, but the security
  // boundary is the hash match. We enumerate BU dirs whose id starts with the
  // prefix so a longer id like `medivara` still resolves from prefix `med`.
  // v0.1 keeps this simple: try the exact-prefix load first. If we later need
  // to support ambiguous prefixes (unlikely — prefixes are BU-derived at grant
  // time), extend to a small directory listing.
  const state = await loadExternalAccessForBu(env.GITHUB_PAT, bu === 'gen' ? 'genus' : bu);
  if (!state) {
    // Try the raw prefix as literal bu id (in case someone named their BU 'med').
    const alt = await loadExternalAccessForBu(env.GITHUB_PAT, bu);
    if (!alt) return { ok: false, status: 401, message: 'invalid token' };
    return finishVerify(env.GITHUB_PAT, token, alt);
  }
  return finishVerify(env.GITHUB_PAT, token, state);
}

async function finishVerify(pat, token, state) {
  const hash = await sha256Hex(token);
  const entry = (state.parsed.entries || []).find(e => e.token_hash === hash);
  if (!entry) return { ok: false, status: 401, message: 'invalid token' };
  // Audit — fire and forget
  touchLastSeen(pat, entry.bu, entry.id).catch(() => {});
  return {
    ok: true,
    entry,
    bu: entry.bu,
    scopes: Array.isArray(entry.scopes) ? entry.scopes : [],
    token_id: entry.id,
    hash_prefix: hash.slice(0, 8),
  };
}

// Convenience: caller passes the target BU (e.g. from the ?path=bus/<bu>/...
// query parameter) and this returns either the verified external identity
// scoped correctly, null (no external token used — endpoint falls through),
// or a Response object the endpoint should return directly.
//
// Enforces:
//   - Bearer validity (hash-match)
//   - Required scope (default: 'read')
//   - BU scope: token's entry.bu must equal the requested bu
export async function requireExternalRead(request, env, { bu, scope = 'read', jsonResponse }) {
  const verified = await verifyExternalToken(request, env);
  if (verified === null) return null;
  if (!verified.ok) return jsonResponse(verified.status, { ok: false, message: verified.message });
  if (bu && verified.bu !== bu) {
    return jsonResponse(403, { ok: false, message: `token is scoped to bu='${verified.bu}', but this request targets '${bu}'` });
  }
  if (scope && !verified.scopes.includes(scope)) {
    return jsonResponse(403, { ok: false, message: `token lacks '${scope}' scope (has: ${verified.scopes.join(', ') || 'none'})` });
  }
  return verified;
}
