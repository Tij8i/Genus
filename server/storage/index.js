// Genus substrate storage abstraction (phase 4a of i56).
//
// The Cloudflare Pages Functions in functions/api/ read/write substrate via
// functions/api/_gh.js, which calls the GitHub Contents API. The Node/Express
// port in server/api/ imports from THIS module instead — the public API is
// the same shape as _gh.js so ported handlers don't have to change how they
// call getFile / putFile / etc.
//
// Behind the interface we dispatch to an implementation based on the
// GENUS_STORAGE_MODE env var:
//
//   • local-fs (default) — server/storage/local-fs.js — reads/writes files
//     under process.env.GENUS_BUS_ROOT (default: ./bus). This is the runtime
//     for the Docker Compose install.
//   • github (future, v1.1) — will re-implement getFile / putFile against the
//     GitHub Contents API for install variants that prefer git-persisted
//     substrate. Not shipped in this phase; the branch is stubbed so a caller
//     that sets GENUS_STORAGE_MODE=github gets a clear error.
//
// Contract: return shapes MUST match functions/api/_gh.js exactly.
//   getFile(pat, path)          → { sha, content }
//   putFile(pat, path, content, sha, msg) → { commit: { sha } }  (subset of the
//                                  GitHub Contents API PUT response — the fields
//                                  handlers actually read)
//   listFiles(pat, dirPath)     → [ { name, sha, path } ]
//
// The `pat` first argument is preserved for shape compatibility with the CF
// Pages handlers. local-fs.js ignores it; a future github.js will use it.

import * as localFs from './local-fs.js';

const MODE = process.env.GENUS_STORAGE_MODE || 'local-fs';

let impl;
if (MODE === 'local-fs') {
  impl = localFs;
} else if (MODE === 'github') {
  throw new Error(
    'GENUS_STORAGE_MODE=github is not implemented in phase 4a; the ' +
    'Cloudflare Pages install continues to serve GitHub-backed substrate via ' +
    'functions/api/_gh.js. Local install uses GENUS_STORAGE_MODE=local-fs (default).',
  );
} else {
  throw new Error(`Unknown GENUS_STORAGE_MODE: ${MODE}. Valid: local-fs, github.`);
}

// ---- Substrate access (dispatched to the active implementation) --------------

export async function getFile(pat, path) {
  return impl.getFile(pat, path);
}

export async function putFile(pat, path, content, sha, commitMessage) {
  return impl.putFile(pat, path, content, sha, commitMessage);
}

export async function listFiles(pat, dirPath) {
  return impl.listFiles(pat, dirPath);
}

// ---- Constants + helpers preserved from _gh.js -------------------------------
// These are imported directly by some handlers (e.g. log-kpi-measurement.js
// pulls ghHeaders + GITHUB_REPO + BRANCH; health.js and update-governance.js
// pull GITHUB_REPO; several handlers pull todayISO + todayDate). We re-export
// so ported handlers can keep the same import list, only swapping the specifier
// from './_gh.js' to '../storage/index.js'.
//
// In local-fs mode GITHUB_REPO / BRANCH describe where substrate ORIGINATED
// (the canonical upstream) but do not gate anything server-side. The values
// are still surfaced by /api/health so operators can see which upstream this
// install is tracking.

export const GITHUB_REPO = process.env.GENUS_SUBSTRATE_REPO || 'Tij8i/Orchestrator';
export const BRANCH = process.env.GENUS_SUBSTRATE_BRANCH || 'main';

export function ghHeaders(pat) {
  // Preserved for shape compatibility. Only referenced by log-kpi-measurement.js
  // in an unused import in local mode; kept exported so we don't have to modify
  // the ported handler.
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'genus-dashboard-fn',
    'Content-Type': 'application/json',
  };
}

export function utf8ToBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

export function base64ToUtf8(b64) {
  return Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf8');
}

export function jsonResponse(status, body) {
  // Mirrors the shape returned by _gh.js.jsonResponse(): a global Response
  // object with JSON body + no-store Cache-Control. Node 18+ ships global
  // Response; server/index.js consumes it via `.status` + `.headers` + body
  // pull-through, so behavior matches Cloudflare's Response consumption.
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function todayISO() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}
