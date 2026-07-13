// POST /api/module-init    body: { bu, module_id, action: 'install' | 'uninstall' }
//
// Second-phase install/uninstall. install-module.js handles the registry write
// (must be fast — Pages Functions time out if heavy); this endpoint handles
// the slow follow-up work:
//
//   - On install: seed per-BU substrate stubs (Finance only, for now) + create
//     a default agent binding in agent_bindings.json
//   - On uninstall: remove the agent binding (substrate left in place by design
//     so the operator can re-install without losing local config)
//
// Best-effort — if anything fails, the client just logs it. Source of truth
// for "module installed?" remains bus/_registry.json (managed by install-module).

import { getFile, putFile, jsonResponse } from '../storage/index.js';
import { requireAdmin } from './_identity.js';

const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';
const RUNTIMES_PATH = 'dashboard/public/data/system/runtimes.json';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const module_id = (body.module_id || '').toString().trim();
  const action = (body.action || 'install').toString();
  if (!bu || !module_id) return jsonResponse(400, { ok: false, message: 'bu + module_id required' });
  if (!['install', 'uninstall'].includes(action)) return jsonResponse(400, { ok: false, message: 'action must be install|uninstall' });

  // i38: admin-only gate, scoped to bu.
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  let seeded = null;
  if (action === 'install' && module_id === 'finance') {
    seeded = await seedFinanceSubstrate(env.GITHUB_PAT, bu);
  }
  const binding = await mutateAgentBinding(env.GITHUB_PAT, bu, module_id, action, viewer.email);

  return jsonResponse(200, { ok: true, action, bu, module_id, seeded, binding });
}

async function seedFinanceSubstrate(pat, bu) {
  const now = new Date().toISOString();
  const files = [
    {
      path: `dashboard/public/data/bus/${bu}/finance/ONBOARDING_STATE.json`,
      content: JSON.stringify({
        status: 'pending', last_run_at: null,
        checks: {
          connector_probe: { pass: false, detail: 'No Moneybird connector wired yet — go to Settings → Wiring' },
          category_coverage: { pass: false, missing: ['founder-draws', 'revenue-stream'] },
          data_freshness: { pass: false, last_sync_at: null },
          identity_binding: { pass: false, detail: `Finance Stewart of ${bu} not yet instantiated` },
        },
        gaps_surfaced_to_operator_at: now,
      }, null, 2) + '\n',
    },
    {
      path: `dashboard/public/data/bus/${bu}/finance/THRESHOLDS.json`,
      content: JSON.stringify({
        runway_alert_days: 90, variance_alert_pct: 15, draw_vs_runway_block_days: 60, digest_day_of_month: 1,
        tunings_history: [{ tuned_at: now, key: '__seed__', from: null, to: null, reason: `Initial defaults seeded on Finance install for BU '${bu}'.` }],
      }, null, 2) + '\n',
    },
  ];

  const results = [];
  for (const f of files) {
    try {
      let sha;
      try { const existing = await getFile(pat, f.path); sha = existing.sha; } catch (_) { sha = undefined; }
      if (sha) { results.push({ path: f.path, status: 'exists' }); continue; }
      await putFile(pat, f.path, f.content, undefined, `finance install: seed ${f.path.split('/').pop()}`);
      results.push({ path: f.path, status: 'created' });
    } catch (e) {
      results.push({ path: f.path, status: 'failed', error: e.message || String(e) });
    }
  }
  return results;
}

async function mutateAgentBinding(pat, bu, module_id, action, viewer_email) {
  try {
    const file = await getFile(pat, BINDINGS_PATH);
    const data = JSON.parse(file.content);
    data.bindings = data.bindings || [];
    const idx = data.bindings.findIndex(b => b.bu === bu && b.module_id === module_id);
    if (action === 'install') {
      if (idx !== -1) return { status: 'exists' };
      let default_runtime = 'local-paperclip-alessio';
      try {
        const rt = await getFile(pat, RUNTIMES_PATH);
        const rtData = JSON.parse(rt.content);
        if (rtData.runtimes && rtData.runtimes.length > 0) default_runtime = rtData.runtimes[0].id;
      } catch (_) { /* keep fallback */ }
      data.bindings.push({
        bu, module_id, agent_id: `${module_id}-stewart-of-${bu}`,
        runtime_id: default_runtime, hitl_owner_email: viewer_email,
        installer_email: viewer_email, installed_at: new Date().toISOString(),
      });
    } else {
      if (idx === -1) return { status: 'absent' };
      data.bindings.splice(idx, 1);
    }
    const newContent = JSON.stringify(data, null, 2) + '\n';
    await putFile(pat, BINDINGS_PATH, newContent, file.sha, `bindings: ${action} ${bu}/${module_id} default`);
    return { status: action === 'install' ? 'created' : 'removed' };
  } catch (e) {
    return { status: 'failed', error: e.message || String(e) };
  }
}
