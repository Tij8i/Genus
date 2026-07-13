// GET /api/health — minimal smoke test for the Genus server.
//
// Useful for verifying:
//   1. The server picked up the handler mount
//   2. Storage layer is reachable (GITHUB_PAT bound in Cloudflare Pages mode,
//      or GENUS_BUS_ROOT readable in local-fs mode).
//   3. Substrate probe path is present (in local-fs mode, present only after
//      first-run wizard seeded a BU + the synthetic fixture is baked).
//
// Response shape (Docker Compose install guide + phase 4a verify step depend
// on `ok` and `version` being present even on a fresh install with no BUs):
//   { ok: true, version: "v1.0.0-dev" | "manifest-<v>",
//     runtime: "node-express" | "cloudflare-pages-functions",
//     substrate_repo, substrate_reachable, substrate_check_path,
//     substrate_check_status, now }

// i38: No BU-isolation check: this endpoint reports service health with no BU context.

import { getFile, jsonResponse, todayISO, GITHUB_REPO } from '../storage/index.js';

const SUBSTRATE_PROBE_PATH = 'dashboard/public/data/bus/tuto/identity.json';

// Version — hardcoded default per phase 4a spec; the server bootstrap
// (server/index.js) reads GENUS_MANIFEST.md and sets GENUS_VERSION at boot,
// which overrides this constant when present.
const DEFAULT_VERSION = 'v1.0.0-dev';

export async function onRequestGet({ env }) {
  const localMode = env.GENUS_LOCAL_MODE === '1';
  const base = {
    ok: true,
    version: env.GENUS_VERSION || DEFAULT_VERSION,
    runtime: localMode ? 'node-express' : 'cloudflare-pages-functions',
    substrate_repo: GITHUB_REPO,
    substrate_check_path: SUBSTRATE_PROBE_PATH,
    now: todayISO(),
  };
  if (!env.GITHUB_PAT) {
    return jsonResponse(200, {
      ...base,
      substrate_reachable: false,
      substrate_check_status: null,
      error: 'GITHUB_PAT not set on Pages project — set it in Settings → Environment variables',
    });
  }
  try {
    const result = await getFile(env.GITHUB_PAT, SUBSTRATE_PROBE_PATH);
    return jsonResponse(200, {
      ...base,
      substrate_reachable: true,
      substrate_check_status: 200,
      substrate_check_bytes: (result.content || '').length,
    });
  } catch (e) {
    return jsonResponse(200, {
      ...base,
      substrate_reachable: false,
      substrate_check_status: e.status || 500,
      error: e.message || String(e),
    });
  }
}
