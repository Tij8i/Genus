// Roadmap i107 — Meetings as a first-class artefact.
//
// GET  /api/meetings?bu=<bu>&module=<mod?>  → filtered list
// POST /api/meetings — start / adjourn / add_outcome / advance_agenda

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin, getViewerIdentity } from './_identity.js';

function pathFor(bu) { return `dashboard/public/data/bus/${bu}/meetings.json`; }

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  const module = (url.searchParams.get('module') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const viewer = await getViewerIdentity(request, env);
  if (!viewer || viewer.role === 'unauthenticated') return jsonResponse(403, { ok: false, message: 'auth required' });
  const allowed = viewer.role === 'owner' || (Array.isArray(viewer.ventures) && (viewer.ventures.includes('*') || viewer.ventures.includes(bu)));
  if (!allowed) return jsonResponse(403, { ok: false, message: 'not authorised' });

  try {
    const file = await getFile(env.GITHUB_PAT, pathFor(bu));
    const data = JSON.parse(file.content);
    const meetings = data.meetings || [];
    const filtered = module ? meetings.filter(m => m.module_id === module) : meetings;
    const live = meetings.filter(m => !m.adjourned_at).length;
    return jsonResponse(200, { ok: true, bu, meetings: filtered, total: meetings.length, live });
  } catch (e) {
    if (e.status === 404) return jsonResponse(200, { ok: true, bu, meetings: [], total: 0, live: 0 });
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'invalid JSON' }); }
  const bu = (body.bu || '').toString().trim().toLowerCase();
  const action = (body.action || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = pathFor(bu);
  let file, data;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    if (e.status === 404) data = { $schema: 'https://genus.work/schemas/meetings-v0.json', version: 1, bu, meetings: [] };
    else return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  data.meetings = Array.isArray(data.meetings) ? data.meetings : [];
  const now = todayISO();

  try {
    if (action === 'start') {
      const id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5);
      data.meetings.push({
        id, bu,
        title: (body.title || 'Untitled meeting').toString().slice(0, 200),
        module_id: body.module_id || null,
        attendees: Array.isArray(body.attendees) ? body.attendees : [viewer.email, 'genus-agent'],
        goal: (body.goal || '').toString().slice(0, 500),
        agenda: (body.agenda || []).map((title, i) => ({ id: `a-${i+1}`, title: title.toString().slice(0, 200), status: i === 0 ? 'current' : 'upcoming' })),
        outcomes: [],
        source_chat_ref: body.source_chat_ref || null,
        started_at: now,
        adjourned_at: null,
        minutes_filed_to: null,
        decisions_filed_to: null,
        tasks_filed_to: [],
        started_by: viewer.email,
      });
    } else if (action === 'add_outcome') {
      const mid = (body.meeting_id || '').toString();
      const m = data.meetings.find(x => x.id === mid);
      if (!m) return jsonResponse(404, { ok: false, message: 'meeting not found' });
      const kind = (body.kind || 'decision').toString();  // 'decision' | 'task'
      m.outcomes.push({
        id: `o-${Date.now().toString(36).slice(-4)}`,
        kind,
        title: (body.title || '').toString().slice(0, 200),
        body: (body.body || '').toString().slice(0, 2000),
        owner: body.owner || null,
        at: now,
      });
    } else if (action === 'advance_agenda') {
      const mid = (body.meeting_id || '').toString();
      const m = data.meetings.find(x => x.id === mid);
      if (!m) return jsonResponse(404, { ok: false, message: 'meeting not found' });
      const currentIdx = m.agenda.findIndex(a => a.status === 'current');
      if (currentIdx >= 0) m.agenda[currentIdx].status = 'done';
      if (currentIdx + 1 < m.agenda.length) m.agenda[currentIdx + 1].status = 'current';
    } else if (action === 'adjourn') {
      const mid = (body.meeting_id || '').toString();
      const m = data.meetings.find(x => x.id === mid);
      if (!m) return jsonResponse(404, { ok: false, message: 'meeting not found' });
      m.adjourned_at = now;
      // v0.9: mark filing status; actual file-to-module logic follows in i71 sweep
      m.minutes_filed_to = m.module_id ? `${m.module_id}/meetings-log` : 'core/meetings-log';
      m.decisions_filed_to = m.outcomes.filter(o => o.kind === 'decision').length > 0 ? 'product/decisions' : null;
      m.tasks_filed_to = m.outcomes.filter(o => o.kind === 'task').map(o => o.id);
    } else {
      return jsonResponse(400, { ok: false, message: `unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'mutation failed: ' + (e.message || String(e)) });
  }

  try {
    await putFile(env.GITHUB_PAT, PATH, JSON.stringify(data, null, 2) + '\n', file?.sha || null, `meetings: ${action} by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  return jsonResponse(200, { ok: true, action, bu });
}
