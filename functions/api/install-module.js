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

  // 3) Write registry back
  const newContent = JSON.stringify(parsed, null, 2) + '\n';
  const action_verb = action === 'install' ? 'install' : 'uninstall';
  try {
    await putFile(env.GITHUB_PAT, REGISTRY_PATH, newContent, registry.sha, `multi-bu: ${action_verb} '${module_id}' for BU '${bu}'`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write registry: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, action, bu: buEntry });
}
