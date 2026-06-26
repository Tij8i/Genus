// POST /api/install-module     body: { bu, module_id }
// POST /api/uninstall-module   body: { bu, module_id }
//
// Single endpoint serves both via the `action` field, OR uses path segments.
// For simplicity: this file ONLY handles install. uninstall lives next to it.
//
// Updates bus/_registry.json — appends module_id to the BU's modules_installed.
// Idempotent: returns ok if module already installed.

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const REGISTRY_PATH = 'dashboard/public/data/bus/_registry.json';
const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const module_id = (body.module_id || '').toString().trim();
  const action = (body.action || 'install').toString();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!module_id) return jsonResponse(400, { ok: false, message: 'module_id is required' });
  if (!['install', 'uninstall'].includes(action)) return jsonResponse(400, { ok: false, message: 'action must be install|uninstall' });

  // 1) Read registry
  let registry;
  try { registry = await getFile(env.GITHUB_PAT, REGISTRY_PATH); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read registry: ' + (e.message || String(e)) }); }

  let parsed;
  try { parsed = JSON.parse(registry.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: 'Registry not valid JSON' }); }

  // 2) Find BU + validate module exists in available_modules
  const buEntry = (parsed.business_units || []).find(b => b.id === bu);
  if (!buEntry) return jsonResponse(404, { ok: false, message: `BU '${bu}' not found` });

  const availableIds = new Set((parsed.available_modules || []).map(m => m.id));
  if (!availableIds.has(module_id)) {
    return jsonResponse(404, { ok: false, message: `Module '${module_id}' not in available_modules` });
  }

  const installed = new Set(buEntry.modules_installed || []);
  if (action === 'install') {
    if (installed.has(module_id)) {
      return jsonResponse(200, { ok: true, already_installed: true, bu: buEntry });
    }
    installed.add(module_id);
  } else {
    if (!installed.has(module_id)) {
      return jsonResponse(200, { ok: true, not_installed: true, bu: buEntry });
    }
    installed.delete(module_id);
  }
  buEntry.modules_installed = Array.from(installed);

  // 3) Write registry back. Keep this endpoint LEAN — only the registry write.
  //    Substrate seed + agent binding now happen via /api/module-init which the
  //    client fires after a successful install. Splitting these prevents the
  //    Cloudflare Pages Function from timing out + returning HTML.
  const newContent = JSON.stringify(parsed, null, 2) + '\n';
  const action_verb = action === 'install' ? 'install' : 'uninstall';
  try {
    await putFile(env.GITHUB_PAT, REGISTRY_PATH, newContent, registry.sha, `multi-bu: ${action_verb} '${module_id}' for BU '${bu}'`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write registry: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, action, bu: buEntry });
}

// Add a default binding on install, remove on uninstall. Defaults: runtime_id =
// first runtime in runtimes.json (v1: single local Paperclip); hitl_owner_email
// = the user who installed.
async function mutateAgentBinding(pat, bu, module_id, action, viewer_email) {
  try {
    const file = await getFile(pat, BINDINGS_PATH);
    const data = JSON.parse(file.content);
    data.bindings = data.bindings || [];
    const idx = data.bindings.findIndex(b => b.bu === bu && b.module_id === module_id);
    if (action === 'install') {
      if (idx !== -1) return { status: 'exists' };
      // Read first runtime as default
      let default_runtime = 'local-paperclip-alessio';
      try {
        const rt = await getFile(pat, 'dashboard/public/data/system/runtimes.json');
        const rtData = JSON.parse(rt.content);
        if (rtData.runtimes && rtData.runtimes.length > 0) default_runtime = rtData.runtimes[0].id;
      } catch (_) { /* keep fallback */ }
      data.bindings.push({
        bu,
        module_id,
        agent_id: `${module_id}-stewart-of-${bu}`,
        runtime_id: default_runtime,
        hitl_owner_email: viewer_email,
        installer_email: viewer_email,
        installed_at: new Date().toISOString(),
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

// Seed bus/<bu>/finance/ with the 5 per-BU memory files in pending-onboarding state.
// Returns a summary; never throws (best-effort).
async function seedFinanceSubstrate(pat, bu) {
  const now = new Date().toISOString();
  const files = [
    {
      path: `dashboard/public/data/bus/${bu}/finance/ONBOARDING_STATE.json`,
      content: JSON.stringify({
        status: 'pending',
        last_run_at: null,
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
      path: `dashboard/public/data/bus/${bu}/finance/CONFIDENCE_STATE.json`,
      content: JSON.stringify({
        computed_at: now,
        per_figure: {},
        layer_states: {
          services_should_exist: { state: 'pending_onboarding' },
          invoices_present: { state: 'pending_onboarding' },
          anomalies: { state: 'pending_onboarding' },
        },
        dismissed_findings: [],
      }, null, 2) + '\n',
    },
    {
      path: `dashboard/public/data/bus/${bu}/finance/THRESHOLDS.json`,
      content: JSON.stringify({
        runway_alert_days: 90,
        variance_alert_pct: 15,
        draw_vs_runway_block_days: 60,
        digest_day_of_month: 1,
        tunings_history: [{ tuned_at: now, key: '__seed__', from: null, to: null, reason: `Initial defaults seeded on Finance install for BU '${bu}'.` }],
      }, null, 2) + '\n',
    },
    {
      path: `dashboard/public/data/bus/${bu}/finance/RECOMMENDATION_LEDGER.jsonl`,
      content: '',
    },
    {
      path: `dashboard/public/data/bus/${bu}/finance/DOMAIN_MODEL.md`,
      content: `# Finance Stewart of ${bu} — Domain Model\n\n**Status**: seed (onboarding pending).\n\nNo Moneybird connector wired yet. Once Settings → Wiring → Moneybird is configured + the heartbeat runs, this file refreshes with cash position, runway, recurring-cost map, anomaly list.\n`,
    },
  ];

  const results = [];
  for (const f of files) {
    try {
      // Try to read existing — if present, skip (idempotent).
      let sha;
      try { const existing = await getFile(pat, f.path); sha = existing.sha; } catch (_) { sha = undefined; }
      if (sha) {
        results.push({ path: f.path, status: 'exists' });
        continue;
      }
      await putFile(pat, f.path, f.content, undefined, `finance install: seed ${f.path.split('/').pop()}`);
      results.push({ path: f.path, status: 'created' });
    } catch (e) {
      results.push({ path: f.path, status: 'failed', error: e.message || String(e) });
    }
  }
  return results;
}
