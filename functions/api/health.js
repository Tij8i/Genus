// GET /api/health — minimal smoke test for the Pages Functions runtime.
//
// Useful for verifying:
//   1. Cloudflare Pages picked up the Functions deploy
//   2. GITHUB_PAT env var is bound on the project
//   3. Cross-repo substrate read works (target: Tij8i/Orchestrator per
//      [[genus-repo-split-substrate]] path A — substrate stays in
//      Orchestrator, Genus dashboard reads it via PAT).
//
// Response shape:
//   { ok: true, runtime: "cloudflare-pages-functions",
//     substrate_repo: "Tij8i/Orchestrator", substrate_reachable: bool,
//     substrate_check_path: "...", substrate_check_status: int, now: iso }

// i38: No BU-isolation check: this endpoint reports service health with no BU context.

import { getFile, jsonResponse, todayISO, GITHUB_REPO } from './_gh.js';

const SUBSTRATE_PROBE_PATH = 'dashboard/public/data/bus/tuto/identity.json';

export async function onRequestGet({ env }) {
  const base = {
    ok: true,
    runtime: 'cloudflare-pages-functions',
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
