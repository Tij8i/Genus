// POST /api/add-roadmap-items
//
// Roadmap i39 — Note-capture flow on Roadmap.
// Operator types a note, the Note-Decompose helper (client-side) breaks it
// into draft cards, operator picks which to keep, calls here to persist.
//
// Body: {
//   bu,
//   items: [
//     { title, summary?, long?, version, owner?, tags?, status? }
//   ]
// }
//
// Each item is assigned a fresh `i<N>` id (max existing + 1). Defaults:
//   status = 'planned'
//   owner  = 'sage'
//   tags   = []
//   prs = decs = 0; pr_list = decision_ids = []
//
// Owners + admins only (scoped to the BU).

import { getFile, putFile, jsonResponse } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) return jsonResponse(400, { ok: false, message: 'items[] required and must be non-empty' });

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  let viewer = { email: 'external_token' };
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
    viewer = gate;
  } else {
    viewer = { email: external.entry?.owner_email || external.entry?.display_name || 'external_token' };
  }

  const PATH = `dashboard/public/data/bus/${bu}/product/roadmap.json`;
  let file, data;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Could not read roadmap.json: ' + (e.message || String(e)) });
  }

  data.items = Array.isArray(data.items) ? data.items : [];
  const validVersions = new Set((data.versions || []).map(v => v.key));

  // Compute next id — find max i<N> across existing items
  let maxN = 0;
  for (const it of data.items) {
    const m = String(it.id || '').match(/^i(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }

  const created = [];
  for (const raw of items) {
    const title = (raw.title || '').toString().trim();
    if (!title) return jsonResponse(400, { ok: false, message: 'Each item requires a title' });
    const version = (raw.version || '').toString().trim();
    if (!version) return jsonResponse(400, { ok: false, message: `Item "${title.slice(0,40)}" is missing a version` });
    if (validVersions.size > 0 && !validVersions.has(version)) {
      return jsonResponse(400, { ok: false, message: `Version "${version}" is not in versions[]` });
    }
    maxN += 1;
    const item = {
      id: `i${maxN}`,
      title: title.slice(0, 120),
      version,
      status: (raw.status || 'planned').toString(),
      owner: (raw.owner || 'sage').toString(),
      tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string').slice(0, 6) : [],
      prs: 0,
      decs: 0,
      summary: (raw.summary || '').toString().slice(0, 500),
      long: (raw.long || '').toString().slice(0, 4000),
      pr_list: [],
      decision_ids: [],
      created_via: 'note-capture',
      created_by: viewer.email,
      created_at: new Date().toISOString(),
    };
    data.items.push(item);
    created.push(item);
  }

  const content = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, PATH, content, file.sha, `roadmap: add ${created.length} item(s) via note-capture by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Write failed: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, added: created.length, items: created });
}
