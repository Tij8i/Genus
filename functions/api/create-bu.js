// POST /api/create-bu
// Adds a new business unit to bus/_registry.json + seeds bus/<id>/identity.json.
//
// Body: { id, display_name, avatar_initial?, color? }
//
// Per Session #18 Initiative #2 (multi-BU setup): "for now we can keep it simple
// and just start with a new installation". No modules installed by default — that
// happens via Modules page later. Importing/onboarding an agent is a separate flow.

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const DEFAULT_COLORS = ['#2f6bff', '#0e9f6e', '#e0a008', '#df4b3f', '#8a5cf6', '#06b6d4', '#ec4899', '#f97316'];
const BINDINGS_PATH = 'dashboard/public/data/system/agent_bindings.json';

// Per-BU substrate files the dashboard reads from. Kept in sync with the
// server/api/ copy — see comment there for the reasoning.
function perBuSeeds(bu) {
  return [
    { path: `dashboard/public/data/bus/${bu}/tasks.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/goals.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/kpis.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/initiatives.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/plans.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/approval_rules.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/documentation.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/meetings.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/connectors.json`, content: '[]\n' },
    { path: `dashboard/public/data/bus/${bu}/cycle_state.json`, content: '{}\n' },
    { path: `dashboard/public/data/bus/${bu}/connectors_backrefs.json`,
      content: JSON.stringify({ version: 1, connectors_backrefs: {} }, null, 2) + '\n' },
    { path: `dashboard/public/data/bus/${bu}/governance.json`,
      content: JSON.stringify({
        stewart_id: null,
        schema_version: '0.1',
        gauges: {},
        thresholds: {},
      }, null, 2) + '\n' },
    { path: `dashboard/public/data/bus/${bu}/external_access.json`,
      content: JSON.stringify({
        $schema: 'https://genus.work/schemas/external-access-v0.json',
        version: 1,
        bu,
        entries: [],
      }, null, 2) + '\n' },
    { path: `dashboard/public/data/bus/${bu}/memos.jsonl`, content: '' },
    { path: `dashboard/public/data/bus/${bu}/urgent_notes.jsonl`, content: '' },
  ];
}

// Map module_id → { archetype, docs_root, agent_id_pattern } for auto-binding
// on Add-BU with default modules picked. Kept in sync with modules the operator
// can actually install via the Modules view.
const MODULE_BINDING_TEMPLATES = {
  strategy: {
    archetype: 'Stewart',
    docs_root: 'docs/genus/modules/strategic-planning/agent',
    agent_id: (bu) => `strategy-stewart-of-${bu}`,
  },
  finance: {
    archetype: 'Stewart',
    docs_root: 'docs/genus/modules/finance/agent',
    agent_id: (bu) => `finance-stewart-of-${bu}`,
  },
  product: {
    archetype: 'Stewart',
    docs_root: 'docs/genus/modules/product/agent',
    agent_id: (bu) => `product-stewart-of-${bu}`,
  },
  development: {
    archetype: 'Stewart',
    docs_root: 'docs/agents/bu_managers/dev_stewart',
    agent_id: (bu) => `development-stewart-of-${bu}`,
  },
};

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  // i38: admin-only gate (no BU payload — creating a new one).
  const gate = await requireAdmin(request, env, {});
  if (gate instanceof Response) return gate;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const id = (body.id || '').toString().trim().toLowerCase();
  const display_name = (body.display_name || '').toString().trim();
  if (!SLUG_RE.test(id)) {
    return jsonResponse(400, { ok: false, message: 'id must be lowercase letters/digits/hyphens, 2-31 chars, start with a letter' });
  }
  if (!display_name) {
    return jsonResponse(400, { ok: false, message: 'display_name is required' });
  }
  if (id.startsWith('_')) {
    return jsonResponse(400, { ok: false, message: 'id may not start with underscore (reserved for system entries)' });
  }

  // 1) Read registry
  const registryPath = 'dashboard/public/data/bus/_registry.json';
  let registry;
  try {
    registry = await getFile(env.GITHUB_PAT, registryPath);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not read registry: ' + (e.message || String(e)) });
  }
  let parsed;
  try { parsed = JSON.parse(registry.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: 'Registry not valid JSON' }); }

  const existingIds = new Set((parsed.business_units || []).map(b => b.id));
  if (existingIds.has(id)) {
    return jsonResponse(409, { ok: false, message: `BU '${id}' already exists in registry` });
  }

  // 2) Compose new entry — default_modules from body are installed inline.
  // Anything not in available_modules or MODULE_BINDING_TEMPLATES is skipped
  // silently (frontend picker only shows valid ones anyway).
  const availableIds = new Set((parsed.available_modules || []).map(m => m.id));
  const requestedModules = Array.isArray(body.default_modules) ? body.default_modules : [];
  const validModules = requestedModules
    .map(m => (m || '').toString().trim())
    .filter(m => availableIds.has(m));

  const avatar_initial = (body.avatar_initial || display_name.charAt(0)).toString().toUpperCase().slice(0, 2);
  const color = body.color || DEFAULT_COLORS[existingIds.size % DEFAULT_COLORS.length];
  const newEntry = {
    id,
    display_name,
    avatar_initial,
    color,
    modules_installed: validModules,
    description: `New BU created via dashboard onboarding ${new Date().toISOString().slice(0, 10)}`,
  };
  parsed.business_units = [...(parsed.business_units || []), newEntry];

  // 3) Write registry back
  const newRegistryContent = JSON.stringify(parsed, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, registryPath, newRegistryContent, registry.sha, `multi-bu: add '${id}' (${display_name})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write registry: ' + (e.message || String(e)) });
  }

  // 4) Seed identity.json for the new BU
  const identityPath = `dashboard/public/data/bus/${id}/identity.json`;
  const identityContent = JSON.stringify({
    bu: id,
    name: display_name,
    category: 'Newly installed BU',
    tagline: '',
    mission: '',
    vision: '',
    description: `Newly installed BU. No modules wired yet — visit Modules to install Strategy / Finance / etc.`,
    current_stage: 'fresh-install',
    current_stage_confidence: 'operator_set',
    health: {
      verdict: 'green',
      summary: 'Just installed — no signals yet.',
      rationale: 'Fresh install; awaiting first agent/module wiring.',
      last_assessed_at: new Date().toISOString(),
      assessed_by: 'genus-agent',
    },
    connected_agents: [],
    modules_installed: [],
  }, null, 2) + '\n';

  try {
    // New file (no sha needed)
    await putFile(env.GITHUB_PAT, identityPath, identityContent, undefined, `multi-bu: seed identity.json for '${id}'`);
  } catch (e) {
    // Registry already updated — best-effort report
    return jsonResponse(200, {
      ok: true,
      partial: true,
      message: 'Registry updated; identity.json seed failed: ' + (e.message || String(e)),
      bu: newEntry,
    });
  }

  // 4b) Seed per-BU substrate files (see server/api/ copy for details).
  const substrateSeeds = perBuSeeds(id);
  const substrateSkipped = [];
  await Promise.all(substrateSeeds.map(async ({ path, content }) => {
    try {
      await putFile(env.GITHUB_PAT, path, content, undefined, `multi-bu: seed ${path.split('/').pop()} for '${id}'`);
    } catch (e) {
      substrateSkipped.push({ path, reason: e?.message || String(e) });
    }
  }));

  // 5) Compose bindings. genus-agent is bound to EVERY new BU regardless of
  // whether the operator picked any modules — it's the always-there base
  // agent that supervises the venture, executes operator-filed tasks,
  // generates suggestions, and fills in for un-installed module Stewards.
  // Module Stewards (strategy / finance / product / development) are added
  // only when the corresponding module_id is in validModules.
  const bindingsWritten = [];
  const bindingsSkipped = [];
  let bindingsFile;
  try { bindingsFile = await getFile(env.GITHUB_PAT, BINDINGS_PATH); }
  catch (e) {
    return jsonResponse(200, {
      ok: true, partial: true, bu: newEntry,
      message: `Registry + identity written; bindings read failed: ${e.message || String(e)}`,
      default_modules: validModules,
    });
  }
  let bindingsParsed;
  try { bindingsParsed = JSON.parse(bindingsFile.content); }
  catch { return jsonResponse(200, { ok: true, partial: true, bu: newEntry, message: 'Registry + identity written; bindings not valid JSON', default_modules: validModules }); }
  bindingsParsed.bindings = bindingsParsed.bindings || [];
  const now = new Date().toISOString();
  const installerEmail = gate?.email || 'unknown@genus.dashboard';

  if (!bindingsParsed.bindings.some(b => b.bu === id && b.agent_id === 'genus-agent')) {
    bindingsParsed.bindings.push({
      bu: id,
      module_id: 'core',
      agent_id: 'genus-agent',
      archetype: 'Genus Agent',  // Must match reconcile.mjs filter
      docs_root: 'docs/agents/genus_agent',
      paperclip_url_key: 'genus-agent',
      runtime_id: 'local-paperclip-alessio',
      hitl_owner_email: installerEmail,
      lead: true,
      installer_email: installerEmail,
      installed_at: now,
    });
    bindingsWritten.push({ module_id: 'core', agent_id: 'genus-agent' });
  }

  for (const modId of validModules) {
    const tpl = MODULE_BINDING_TEMPLATES[modId];
    if (!tpl) { bindingsSkipped.push({ module_id: modId, reason: 'no binding template' }); continue; }
    const agentId = tpl.agent_id(id);
    if (bindingsParsed.bindings.some(b => b.agent_id === agentId)) {
      bindingsSkipped.push({ module_id: modId, reason: 'binding already exists' });
      continue;
    }
    bindingsParsed.bindings.push({
      bu: id,
      module_id: modId,
      agent_id: agentId,
      archetype: tpl.archetype,
      docs_root: tpl.docs_root,
      runtime_id: 'local-paperclip-alessio',
      hitl_owner_email: installerEmail,
      installer_email: installerEmail,
      installed_at: now,
    });
    bindingsWritten.push({ module_id: modId, agent_id: agentId });
  }
  if (bindingsWritten.length > 0) {
    const bindingsContent = JSON.stringify(bindingsParsed, null, 2) + '\n';
    try {
      await putFile(env.GITHUB_PAT, BINDINGS_PATH, bindingsContent, bindingsFile.sha, `multi-bu: seed bindings for '${id}' (${bindingsWritten.map(b => b.module_id).join(', ')})`);
    } catch (e) {
      return jsonResponse(200, {
        ok: true, partial: true, bu: newEntry,
        message: `Registry + identity written; bindings write failed: ${e.message || String(e)}`,
        default_modules: validModules,
        bindings_written: [],
        bindings_skipped: bindingsSkipped,
      });
    }
  }

  return jsonResponse(200, {
    ok: true,
    bu: newEntry,
    default_modules: validModules,
    bindings_written: bindingsWritten,
    bindings_skipped: bindingsSkipped,
    substrate_seeded: substrateSeeds.length - substrateSkipped.length,
    substrate_skipped: substrateSkipped,
  });
}
