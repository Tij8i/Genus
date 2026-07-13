// POST /api/finalize-bu
//
// Second phase of the Add-BU flow (roadmap i28). Called by the browser AFTER
// - /api/create-bu (writes registry + identity + optional bindings)
// - trigger daemon POST /paperclip/company (creates the Paperclip company)
//
// This endpoint takes the newly-created Paperclip company id and persists
// the mapping into dashboard/public/data/system/bu_paperclip_map.json so
// the reconciler knows which company backs the BU. Idempotent — if a
// mapping already exists for the BU it returns 200 with the existing entry.
//
// Body: { bu_id, paperclip_company_id, paperclip_company_name, issue_prefix? }
// Response: { ok, mapping }

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';

const MAP_PATH = 'dashboard/public/data/system/bu_paperclip_map.json';
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu_id = (body.bu_id || '').toString().trim().toLowerCase();
  const paperclip_company_id = (body.paperclip_company_id || '').toString().trim();
  const paperclip_company_name = (body.paperclip_company_name || '').toString().trim();
  const issue_prefix = (body.issue_prefix || '').toString().trim().toUpperCase().slice(0, 4);

  if (!SLUG_RE.test(bu_id)) return jsonResponse(400, { ok: false, message: 'bu_id is not a valid slug' });
  if (!UUID_RE.test(paperclip_company_id)) return jsonResponse(400, { ok: false, message: 'paperclip_company_id must be a UUID' });
  if (!paperclip_company_name) return jsonResponse(400, { ok: false, message: 'paperclip_company_name is required' });

  // i38: admin-only gate, scoped to bu_id (Paperclip mapping is infra config).
  const gate = await requireAdmin(request, env, { bu: bu_id });
  if (gate instanceof Response) return gate;

  // Read + parse the map file
  let mapFile;
  try { mapFile = await getFile(env.GITHUB_PAT, MAP_PATH); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: 'Could not read bu_paperclip_map: ' + (e.message || String(e)) }); }

  let parsed;
  try { parsed = JSON.parse(mapFile.content); }
  catch { return jsonResponse(500, { ok: false, message: 'bu_paperclip_map not valid JSON' }); }

  parsed.mappings = parsed.mappings || [];
  const existing = parsed.mappings.find(m => m.bu === bu_id);
  if (existing) {
    // Idempotent — return whatever's already there
    return jsonResponse(200, { ok: true, mapping: existing, already_present: true });
  }

  const newMapping = {
    bu: bu_id,
    paperclip_company_id,
    paperclip_company_name,
    issue_prefix,
  };
  parsed.mappings = [...parsed.mappings, newMapping];

  const newContent = JSON.stringify(parsed, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, MAP_PATH, newContent, mapFile.sha, `multi-bu: map '${bu_id}' → Paperclip company ${paperclip_company_id.slice(0, 8)}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not write bu_paperclip_map: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, mapping: newMapping });
}
