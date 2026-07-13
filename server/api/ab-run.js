// Roadmap i47 — A/B orchestration.
//
// POST /api/ab-run
// Body: { bu, action, ... }
//   action: 'start'  { task_body, contestants: [agent_id_a, agent_id_b] }
//   action: 'pick_winner' { run_id, winner_agent_id, notes? }
//   action: 'complete_contestant' { run_id, agent_id, output }
//
// v0.9 ships the substrate + pick-winner flow. Firing the actual agents
// happens through the meeting-server today; automated dispatch is a
// v1.0 follow-up.

import { getFile, putFile, jsonResponse, todayISO } from '../storage/index.js';
import { requireAdmin } from './_identity.js';

function pathFor(bu) { return `dashboard/public/data/bus/${bu}/ab_runs.json`; }

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  // i38: admin-only gate, scoped to bu (A/B run substrate is infra-adjacent).
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;

  try {
    const file = await getFile(env.GITHUB_PAT, pathFor(bu));
    const data = JSON.parse(file.content);
    return jsonResponse(200, { ok: true, bu, runs: data.runs || [] });
  } catch (e) {
    if (e.status === 404) return jsonResponse(200, { ok: true, bu, runs: [] });
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

  // i38: admin-only gate, scoped to bu (A/B run substrate is infra-adjacent).
  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const PATH = pathFor(bu);
  let file, data;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    data = JSON.parse(file.content);
  } catch (e) {
    if (e.status === 404) data = { $schema: 'https://genus.work/schemas/ab-runs-v0.json', version: 1, bu, runs: [] };
    else return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  data.runs = Array.isArray(data.runs) ? data.runs : [];
  const now = todayISO();

  try {
    if (action === 'start') {
      const contestants = Array.isArray(body.contestants) ? body.contestants : [];
      if (contestants.length !== 2) return jsonResponse(400, { ok: false, message: 'exactly 2 contestant agent_ids required (v0.9)' });
      const id = 'ab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,5);
      data.runs.push({
        id, bu,
        task_body: (body.task_body || '').toString().slice(0, 4000),
        contestants: contestants.map(aid => ({ agent_id: aid, output: null, status: 'running', started_at: now, completed_at: null, latency_ms: null })),
        winner: null, verdict_at: null, verdict_by: null, verdict_notes: null,
        started_at: now, closed_at: null,
        started_by: viewer.email,
      });
    } else if (action === 'pick_winner') {
      const rid = (body.run_id || '').toString();
      const winner = (body.winner_agent_id || '').toString();
      const notes = (body.notes || '').toString();
      const run = data.runs.find(r => r.id === rid);
      if (!run) return jsonResponse(404, { ok: false, message: `run ${rid} not found` });
      if (run.winner) return jsonResponse(409, { ok: false, message: 'winner already picked' });
      if (!run.contestants.find(c => c.agent_id === winner)) return jsonResponse(400, { ok: false, message: 'winner must be a contestant' });
      run.winner = winner;
      run.verdict_at = now;
      run.verdict_by = viewer.email;
      run.verdict_notes = notes;
      run.closed_at = now;
    } else if (action === 'complete_contestant') {
      const rid = (body.run_id || '').toString();
      const aid = (body.agent_id || '').toString();
      const output = (body.output || '').toString();
      const run = data.runs.find(r => r.id === rid);
      if (!run) return jsonResponse(404, { ok: false, message: `run ${rid} not found` });
      const c = run.contestants.find(x => x.agent_id === aid);
      if (!c) return jsonResponse(404, { ok: false, message: `contestant ${aid} not found` });
      c.output = output;
      c.status = 'completed';
      c.completed_at = now;
      const start = new Date(c.started_at).getTime();
      const end = new Date(now).getTime();
      c.latency_ms = end - start;
    } else {
      return jsonResponse(400, { ok: false, message: `unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: 'mutation failed: ' + (e.message || String(e)) });
  }

  try {
    await putFile(env.GITHUB_PAT, PATH, JSON.stringify(data, null, 2) + '\n', file?.sha || null, `ab-run: ${action} by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  return jsonResponse(200, { ok: true, action, bu });
}
