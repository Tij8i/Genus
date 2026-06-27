// POST /api/business-areas-edit
//
// Body: { bu, action, ... }
//
// Actions:
//   add_area    { area: { id?, display_name, description?, critical? } }
//   edit_area   { area_id, fields: { display_name?, description?, critical?, genus_agent_notes? } }
//   delete_area { area_id }
//   add_tool    { area_id, tool: { tool, resources?: [{kind, name, meta?}] } }
//   remove_tool { area_id, tool_name }
//
// Writes to dashboard/public/data/bus/<bu>/business_areas.json. Owners + admins
// only; admins gated to ventures they have access to. Members/observers 403.

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin } from './_identity.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const action = (body.action || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!action) return jsonResponse(400, { ok: false, message: 'action is required' });

  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = `dashboard/public/data/bus/${bu}/business_areas.json`;

  // Load or initialize
  let file = null;
  let data = null;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    if (e.status === 404 && action === 'add_area') {
      // First area: seed the file
      data = {
        $schema: 'https://genus.work/schemas/business-areas-v0.json',
        version: 1,
        bu,
        default_seeded_by: viewer.email,
        seeded_at: todayISO(),
        genus_agent_state: { status: 'suggestion', message: 'Operator just started modelling this business. Open a meeting to refine.', updated_at: todayISO() },
        areas: [],
      };
    } else {
      return jsonResponse(e.status || 500, { ok: false, message: 'Could not read business_areas.json: ' + (e.message || String(e)) });
    }
  }

  data.areas = data.areas || [];

  try {
    if (action === 'add_area') {
      const area = body.area || {};
      const display_name = (area.display_name || '').toString().trim();
      if (!display_name) return jsonResponse(400, { ok: false, message: 'area.display_name is required' });
      const id = (area.id || slugify(display_name)).toString().trim();
      if (!id) return jsonResponse(400, { ok: false, message: 'area.id (or derivable from display_name) is required' });
      if (data.areas.some(a => a.id === id)) {
        return jsonResponse(409, { ok: false, message: `Area '${id}' already exists` });
      }
      data.areas.push({
        id,
        display_name,
        description: (area.description || '').toString(),
        critical: !!area.critical,
        operator_confirmed: false,
        genus_agent_notes: '',
        tools: [],
      });
    } else if (action === 'edit_area') {
      const area_id = (body.area_id || '').toString().trim();
      if (!area_id) return jsonResponse(400, { ok: false, message: 'area_id is required' });
      const idx = data.areas.findIndex(a => a.id === area_id);
      if (idx === -1) return jsonResponse(404, { ok: false, message: `Area '${area_id}' not found` });
      const fields = body.fields || {};
      const a = { ...data.areas[idx] };
      if (typeof fields.display_name === 'string') a.display_name = fields.display_name.trim();
      if (typeof fields.description === 'string') a.description = fields.description;
      if (typeof fields.critical === 'boolean') a.critical = fields.critical;
      if (typeof fields.genus_agent_notes === 'string') a.genus_agent_notes = fields.genus_agent_notes;
      data.areas[idx] = a;
    } else if (action === 'delete_area') {
      const area_id = (body.area_id || '').toString().trim();
      if (!area_id) return jsonResponse(400, { ok: false, message: 'area_id is required' });
      const prevLen = data.areas.length;
      data.areas = data.areas.filter(a => a.id !== area_id);
      if (data.areas.length === prevLen) return jsonResponse(404, { ok: false, message: `Area '${area_id}' not found` });
    } else if (action === 'add_tool') {
      const area_id = (body.area_id || '').toString().trim();
      const tool = body.tool || {};
      const tool_key = (tool.tool || '').toString().trim();
      if (!area_id) return jsonResponse(400, { ok: false, message: 'area_id is required' });
      if (!tool_key) return jsonResponse(400, { ok: false, message: 'tool.tool is required' });
      const idx = data.areas.findIndex(a => a.id === area_id);
      if (idx === -1) return jsonResponse(404, { ok: false, message: `Area '${area_id}' not found` });
      const a = { ...data.areas[idx] };
      a.tools = a.tools || [];
      if (a.tools.some(t => t.tool === tool_key)) {
        return jsonResponse(409, { ok: false, message: `Tool '${tool_key}' already added to '${area_id}'` });
      }
      a.tools.push({ tool: tool_key, resources: Array.isArray(tool.resources) ? tool.resources : [] });
      data.areas[idx] = a;
    } else if (action === 'remove_tool') {
      const area_id = (body.area_id || '').toString().trim();
      const tool_name = (body.tool_name || '').toString().trim();
      if (!area_id) return jsonResponse(400, { ok: false, message: 'area_id is required' });
      if (!tool_name) return jsonResponse(400, { ok: false, message: 'tool_name is required' });
      const idx = data.areas.findIndex(a => a.id === area_id);
      if (idx === -1) return jsonResponse(404, { ok: false, message: `Area '${area_id}' not found` });
      const a = { ...data.areas[idx] };
      a.tools = (a.tools || []).filter(t => t.tool !== tool_name);
      data.areas[idx] = a;
    } else {
      return jsonResponse(400, { ok: false, message: `Unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'Mutation failed: ' + (e.message || String(e)) });
  }

  const commitMessage = `business-areas: ${action} for ${bu} by ${viewer.email}`;
  const content = JSON.stringify(data, null, 2) + '\n';
  try {
    await putFile(env.GITHUB_PAT, PATH, content, file ? file.sha : null, commitMessage);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: 'Write failed: ' + (e.message || String(e)) });
  }
  return jsonResponse(200, { ok: true, action, bu });
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
