// Roadmap Phase 2 (i48/i49/i51/i52) — generic module-edit endpoint.
//
// POST /api/module-edit
// Body: { bu, module, file, action, item?, item_id?, fields? }
//
// Actions:
//   create — appends item[] with generated id
//   update — mutates by id
//   remove — removes by id
//
// The file parameter picks which substrate JSON to touch inside the module's
// directory. E.g. { bu:'genus', module:'learning', file:'experiments.json' }
// touches bus/genus/learning/experiments.json's `experiments[]` (the container
// key is derived from the filename minus .json).
//
// Owners + admins scoped to the BU only.

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';

const ALLOWED_MODULES = new Set(['learning','hr','sales','marketing']);
const ALLOWED_FILES = {
  learning: ['experiments.json'],
  hr: ['openings.json','agent_usage.json'],
  sales: ['deals.json','contacts.json','pipeline_stages.json'],
  marketing: ['campaigns.json','content.json'],
};

function containerKey(file) {
  // deals.json → 'deals'; pipeline_stages.json → 'stages' (special-case list-like)
  const base = file.replace(/\.json$/, '');
  // Most files use base as key; a few exceptions:
  const KEY_MAP = {
    pipeline_stages: 'stages',
    agent_usage: 'usage',
    experiments: 'experiments',
  };
  return KEY_MAP[base] || base;
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'invalid JSON' }); }

  const bu = (body.bu || '').toString().trim().toLowerCase();
  const module = (body.module || '').toString().trim().toLowerCase();
  const file = (body.file || '').toString().trim();
  const action = (body.action || '').toString().trim();

  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  if (!ALLOWED_MODULES.has(module)) return jsonResponse(400, { ok: false, message: `module must be one of: ${[...ALLOWED_MODULES].join(', ')}` });
  if (!ALLOWED_FILES[module].includes(file)) return jsonResponse(400, { ok: false, message: `file must be one of: ${ALLOWED_FILES[module].join(', ')}` });
  if (!['create','update','remove'].includes(action)) return jsonResponse(400, { ok: false, message: 'action must be create|update|remove' });

  // i38: admin-only gate, scoped to bu.
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = `dashboard/public/data/bus/${bu}/${module}/${file}`;
  let fileObj, data;
  try {
    fileObj = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(fileObj.content);
  } catch (e) {
    if (e.status === 404) {
      data = { '$schema': `https://genus.work/schemas/${module}-${file.replace('.json','')}-v0.json`, version: 1, bu };
    } else {
      return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
    }
  }

  const key = containerKey(file);
  data[key] = Array.isArray(data[key]) ? data[key] : [];
  const now = todayISO();

  try {
    if (action === 'create') {
      const item = body.item || {};
      const id = item.id || `${module}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
      const record = { id, created_at: now, created_by: viewer.email, ...item };
      data[key].push(record);
    } else if (action === 'update') {
      const iid = (body.item_id || '').toString();
      if (!iid) return jsonResponse(400, { ok: false, message: 'item_id required' });
      const idx = data[key].findIndex(x => x.id === iid);
      if (idx === -1) return jsonResponse(404, { ok: false, message: `${iid} not found` });
      data[key][idx] = { ...data[key][idx], ...(body.fields || {}), updated_at: now, updated_by: viewer.email };
    } else if (action === 'remove') {
      const iid = (body.item_id || '').toString();
      if (!iid) return jsonResponse(400, { ok: false, message: 'item_id required' });
      const before = data[key].length;
      data[key] = data[key].filter(x => x.id !== iid);
      if (data[key].length === before) return jsonResponse(404, { ok: false, message: `${iid} not found` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'mutation failed: ' + (e.message || String(e)) });
  }

  try {
    await putFile(env.GITHUB_PAT, PATH, JSON.stringify(data, null, 2) + '\n', fileObj?.sha || null, `${module}: ${action} in ${file} by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  return jsonResponse(200, { ok: true, action, bu, module, file });
}
