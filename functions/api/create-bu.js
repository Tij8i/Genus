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

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
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

  // 2) Compose new entry — empty modules_installed by default
  const avatar_initial = (body.avatar_initial || display_name.charAt(0)).toString().toUpperCase().slice(0, 2);
  const color = body.color || DEFAULT_COLORS[existingIds.size % DEFAULT_COLORS.length];
  const newEntry = {
    id,
    display_name,
    avatar_initial,
    color,
    modules_installed: [],
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

  return jsonResponse(200, { ok: true, bu: newEntry });
}
