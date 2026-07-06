// Roadmap i40 — chat-driven onboarding.
//
// GET  /api/onboarding?bu=<bu>  → current state
// POST /api/onboarding — start / advance_topic / close

import { getFile, putFile, jsonResponse, todayISO } from './_gh.js';
import { requireAdmin, getViewerIdentity } from './_identity.js';

const TOPICS = [
  { id: 1, key: 'setup',      label: 'Set up' },
  { id: 2, key: 'capabilities', label: 'What Genus can do' },
  { id: 3, key: 'assets',     label: 'Analyze and organise assets' },
  { id: 4, key: 'tools',      label: 'Work with existing software' },
  { id: 5, key: 'workflows',  label: 'Automate workflows' },
  { id: 6, key: 'tasks',      label: 'Manage execution' },
  { id: 7, key: 'closing',    label: 'Closing — describe-back' },
];

function pathFor(bu) { return `dashboard/public/data/bus/${bu}/onboarding_state.json`; }

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const url = new URL(request.url);
  const bu = (url.searchParams.get('bu') || '').toString().trim().toLowerCase();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const viewer = await getViewerIdentity(request, env);
  if (!viewer || viewer.role === 'unauthenticated') return jsonResponse(403, { ok: false, message: 'auth required' });

  try {
    const file = await getFile(env.GITHUB_PAT, pathFor(bu));
    return jsonResponse(200, { ok: true, bu, state: JSON.parse(file.content), topics: TOPICS });
  } catch (e) {
    if (e.status === 404) return jsonResponse(200, { ok: true, bu, state: null, topics: TOPICS });
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
  let file = null, state = null;
  try {
    file = await getFile(env.GITHUB_PAT, PATH);
    state = JSON.parse(file.content);
  } catch (e) {
    if (e.status !== 404) return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  const now = todayISO();

  try {
    if (action === 'start') {
      state = {
        $schema: 'https://genus.work/schemas/onboarding-state-v0.json',
        version: 1, bu,
        started_at: now,
        current_topic: 1,
        completed_topics: [],
        skipped_topics: [],
        closed_at: null,
        venture_shape: null,  // 'fresh' | 'existing' | 'mixed'
        chat_conversation_id: null,
        path_taken: 'chat',
      };
    } else if (action === 'advance_topic') {
      if (!state) return jsonResponse(400, { ok: false, message: 'onboarding not started' });
      const t = parseInt(body.topic_id, 10);
      if (isNaN(t)) return jsonResponse(400, { ok: false, message: 'topic_id required' });
      if (!state.completed_topics.includes(t)) state.completed_topics.push(t);
      state.current_topic = Math.min(t + 1, TOPICS.length);
      if (body.venture_shape) state.venture_shape = body.venture_shape;
      if (body.chat_conversation_id) state.chat_conversation_id = body.chat_conversation_id;
    } else if (action === 'skip_topic') {
      if (!state) return jsonResponse(400, { ok: false, message: 'onboarding not started' });
      const t = parseInt(body.topic_id, 10);
      if (isNaN(t)) return jsonResponse(400, { ok: false, message: 'topic_id required' });
      if (!state.skipped_topics.includes(t)) state.skipped_topics.push(t);
      state.current_topic = Math.min(t + 1, TOPICS.length);
    } else if (action === 'close') {
      if (!state) return jsonResponse(400, { ok: false, message: 'onboarding not started' });
      state.closed_at = now;
      state.current_topic = TOPICS.length;
    } else {
      return jsonResponse(400, { ok: false, message: `unknown action: ${action}` });
    }
  } catch (e) {
    return jsonResponse(500, { ok: false, message: e.message || String(e) });
  }

  try {
    await putFile(env.GITHUB_PAT, PATH, JSON.stringify(state, null, 2) + '\n', file?.sha || null, `onboarding: ${action} for ${bu} by ${viewer.email}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }
  return jsonResponse(200, { ok: true, action, bu, state });
}
