// POST /api/external-access-edit
//
// Body: { bu, action, ... }
//
// Actions:
//   add    { display_name, owner_email, protocol: 'rest' | 'mcp', scopes: [...], scoped_areas?: [...], description? }
//   edit   { id, fields: { display_name?, owner_email?, scopes?, scoped_areas? } }
//   remove { id }
//
// Writes to dashboard/public/data/bus/<bu>/external_access.json. Stores the
// token only as a SHA-256 hash on the server; returns the plaintext token
// ONCE in the 'add' response so the operator can copy it. After that, the
// token can never be retrieved again — only verified against the hash.
//
// Owners + admins only; admins gated to ventures they have access to.

import { getFile, putFile, jsonResponse, todayISO } from '../storage/index.js';
import { requireAdmin } from './_identity.js';

const VALID_SCOPES = ['read', 'write-recommendations', 'write-tasks', 'write-areas'];
const VALID_PROTOCOLS = ['rest', 'mcp'];

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const action = (body.action || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!['add', 'edit', 'remove'].includes(action)) return jsonResponse(400, { ok: false, message: `Unknown action: ${action}` });

  // i38: admin-only gate, scoped to bu (token-issuance is infra config).
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = `dashboard/public/data/bus/${bu}/external_access.json`;

  let file = null;
  let data = null;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    if (e.status === 404) {
      data = {
        $schema: 'https://genus.work/schemas/external-access-v0.json',
        version: 1,
        bu,
        entries: [],
      };
    } else {
      return jsonResponse(e.status || 500, { ok: false, message: 'Could not read external_access.json: ' + (e.message || String(e)) });
    }
  }

  data.entries = data.entries || [];

  let resultEntry = null;
  let plaintextToken = null;
  let commitSummary;

  if (action === 'add') {
    const display_name = (body.display_name || '').toString().trim();
    const owner_email = (body.owner_email || viewer.email || '').toString().trim();
    const protocol = (body.protocol || 'rest').toString();
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter(s => VALID_SCOPES.includes(s)) : [];
    const scoped_areas = Array.isArray(body.scoped_areas) ? body.scoped_areas : [];
    const description = (body.description || '').toString();

    if (!display_name) return jsonResponse(400, { ok: false, message: 'display_name is required' });
    if (!VALID_PROTOCOLS.includes(protocol)) return jsonResponse(400, { ok: false, message: 'protocol must be rest or mcp' });
    if (protocol === 'mcp') return jsonResponse(400, { ok: false, message: 'MCP server is a v2 follow-up — not yet supported' });
    if (scopes.length === 0) return jsonResponse(400, { ok: false, message: 'At least one scope is required' });

    plaintextToken = await generateToken(bu);
    const tokenHash = await sha256(plaintextToken);
    const id = `ext_${randomBase62(10)}`;

    const fresh = {
      id,
      bu,
      display_name,
      owner_email,
      protocol,
      scopes,
      scoped_areas,
      description,
      token_hash: tokenHash,
      token_preview: plaintextToken.slice(0, 12) + '…',
      created_at: todayISO(),
      created_by: viewer.email,
      last_seen: null,
      audit: [],
    };
    data.entries.push(fresh);
    resultEntry = { ...fresh, token: plaintextToken };
    commitSummary = `add ${bu}/${id}`;
  } else if (action === 'edit') {
    const id = (body.id || '').toString().trim();
    if (!id) return jsonResponse(400, { ok: false, message: 'id is required' });
    const idx = data.entries.findIndex(e => e.id === id);
    if (idx === -1) return jsonResponse(404, { ok: false, message: `External entry '${id}' not found` });
    const fields = body.fields || {};
    const upd = { ...data.entries[idx] };
    if (typeof fields.display_name === 'string') upd.display_name = fields.display_name.trim();
    if (typeof fields.owner_email === 'string') upd.owner_email = fields.owner_email.trim();
    if (Array.isArray(fields.scopes)) upd.scopes = fields.scopes.filter(s => VALID_SCOPES.includes(s));
    if (Array.isArray(fields.scoped_areas)) upd.scoped_areas = fields.scoped_areas;
    if (typeof fields.description === 'string') upd.description = fields.description;
    upd.edited_at = todayISO();
    upd.edited_by = viewer.email;
    data.entries[idx] = upd;
    resultEntry = upd;
    commitSummary = `edit ${bu}/${id}`;
  } else if (action === 'remove') {
    const id = (body.id || '').toString().trim();
    if (!id) return jsonResponse(400, { ok: false, message: 'id is required' });
    const before = data.entries.length;
    data.entries = data.entries.filter(e => e.id !== id);
    if (data.entries.length === before) return jsonResponse(404, { ok: false, message: `External entry '${id}' not found` });
    commitSummary = `remove ${bu}/${id}`;
  }

  const newContent = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, PATH, newContent, file ? file.sha : null, `external-access: ${commitSummary} (by ${viewer.email})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Write failed: ' + (e.message || String(e)) });
  }

  return jsonResponse(200, { ok: true, action, bu, entry: resultEntry, token: plaintextToken });
}

async function generateToken(bu) {
  const rand = randomBase62(32);
  const prefix = bu.slice(0, 3);
  return `gns_${prefix}_${rand}`;
}

function randomBase62(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function sha256(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
