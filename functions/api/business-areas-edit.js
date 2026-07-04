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
    } else if (action === 'accept_proposal' || action === 'reject_proposal' || action === 'dismiss_proposal') {
      // Roadmap i14 — Genus Agent area-modelling proposals.
      // accept_proposal: apply the proposal's change to areas[] + mark accepted
      // reject_proposal: mark rejected with a reason (Agent won't re-propose the same shape)
      // dismiss_proposal: soft-hide; Agent may re-propose if new signals appear
      const proposal_id = (body.proposal_id || '').toString().trim();
      const reason = (body.reason || '').toString();
      if (!proposal_id) return jsonResponse(400, { ok: false, message: 'proposal_id is required' });
      data.proposals = data.proposals || [];
      const pidx = data.proposals.findIndex(p => p.id === proposal_id);
      if (pidx === -1) return jsonResponse(404, { ok: false, message: `Proposal '${proposal_id}' not found` });
      const prop = { ...data.proposals[pidx] };
      if (prop.status !== 'pending') return jsonResponse(409, { ok: false, message: `Proposal '${proposal_id}' is already ${prop.status}` });
      const now = todayISO();

      if (action === 'accept_proposal') {
        // Apply the proposal to areas[]
        if (prop.kind === 'rename') {
          const target_id = prop.subject_area_ids?.[0];
          const aidx = data.areas.findIndex(a => a.id === target_id);
          if (aidx === -1) return jsonResponse(404, { ok: false, message: `Subject area '${target_id}' not found` });
          const a = { ...data.areas[aidx] };
          if (prop.proposal?.new_display_name) a.display_name = prop.proposal.new_display_name;
          if (prop.proposal?.new_description)  a.description  = prop.proposal.new_description;
          a.genus_agent_notes = (a.genus_agent_notes || '') + ` [renamed via proposal ${proposal_id} on ${now.slice(0,10)}]`;
          data.areas[aidx] = a;
        } else if (prop.kind === 'split') {
          const target_id = prop.subject_area_ids?.[0];
          const aidx = data.areas.findIndex(a => a.id === target_id);
          if (aidx === -1) return jsonResponse(404, { ok: false, message: `Subject area '${target_id}' not found` });
          const originalTools = data.areas[aidx].tools || [];
          const newAreas = (prop.proposal?.areas || []).map((child, i) => ({
            id: child.id || slugify(child.display_name || ''),
            display_name: child.display_name,
            description: child.description || '',
            critical: !!child.critical,
            operator_confirmed: true,
            genus_agent_notes: `Created via split from '${target_id}' (proposal ${proposal_id})`,
            tools: i === 0 ? originalTools : [],
          }));
          data.areas.splice(aidx, 1, ...newAreas);
        } else if (prop.kind === 'merge') {
          const targets = prop.subject_area_ids || [];
          const survivors = data.areas.filter(a => !targets.includes(a.id));
          const mergedTools = data.areas
            .filter(a => targets.includes(a.id))
            .flatMap(a => a.tools || []);
          const nc = prop.proposal?.new_area || {};
          survivors.push({
            id: nc.id || slugify(nc.display_name || 'merged'),
            display_name: nc.display_name,
            description: nc.description || '',
            critical: !!nc.critical,
            operator_confirmed: true,
            genus_agent_notes: `Merged from ${targets.join(', ')} (proposal ${proposal_id})`,
            tools: mergedTools,
          });
          data.areas = survivors;
        } else if (prop.kind === 'add') {
          const nc = prop.proposal?.area || {};
          data.areas.push({
            id: nc.id || slugify(nc.display_name || 'new-area'),
            display_name: nc.display_name,
            description: nc.description || '',
            critical: !!nc.critical,
            operator_confirmed: true,
            genus_agent_notes: `Added via proposal ${proposal_id}`,
            tools: [],
          });
        } else if (prop.kind === 'retire') {
          data.areas = data.areas.filter(a => !(prop.subject_area_ids || []).includes(a.id));
        } else {
          return jsonResponse(400, { ok: false, message: `Unknown proposal kind: ${prop.kind}` });
        }
        prop.status = 'accepted';
        prop.decided_at = now;
      } else if (action === 'reject_proposal') {
        prop.status = 'rejected';
        prop.decided_at = now;
        prop.decided_reason = reason || 'No reason given.';
      } else {
        prop.status = 'dismissed';
        prop.decided_at = now;
        prop.decided_reason = reason || null;
      }
      data.proposals[pidx] = prop;
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
