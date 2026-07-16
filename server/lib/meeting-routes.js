// Meeting server routes (i56 postfix2 — Docker port of the launchd Python
// server at ~/Library/Application Support/Genus/genus_meeting_server.py).
//
// The Docker install had no meeting server, so chat + "Modify my business
// modelling" hit the Mac-only launchctl service at localhost:8765 and failed
// on any non-Alessio machine. These routes make chat work inside the compose
// stack using the Anthropic SDK directly (no `claude` CLI dependency).
//
// Endpoints (mounted under /api/meetings/*):
//   GET  /api/meetings/health   → liveness + Anthropic key state
//   GET  /api/meetings?bu=<bu>  → list meetings for a BU
//   POST /api/meetings/new      → { bu, agent_id, title?, purpose?, opening_prompt?, expected_output?, related_item?, from_request_id? }
//   POST /api/meetings/turn     → { bu, meeting_id, message }
//   POST /api/meetings/close    → { bu, meeting_id }
//
// v0 scope: minimum viable — no git commits, no meeting-close extraction
// pipeline, no tuto emit / adapter-run. Those are Alessio-specific features
// of the launchd server and don't belong in the Docker image.

import Anthropic from '@anthropic-ai/sdk';
import { loadMeetings, saveMeetings, nowIso, nextMeetingId } from './meeting-store.js';
import { buildSystemPrompt } from './meeting-agent.js';

const MODEL_ID = process.env.GENUS_MEETING_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.GENUS_MEETING_MAX_TOKENS || 2048);
const TURN_TIMEOUT_MS = Number(process.env.GENUS_MEETING_TIMEOUT_MS || 180_000);

let anthropicClient = null;
function getClient() {
  if (anthropicClient) return anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  anthropicClient = new Anthropic({ apiKey: key, timeout: TURN_TIMEOUT_MS });
  return anthropicClient;
}

function json(res, status, body) {
  res.status(status).set('Cache-Control', 'no-store').json(body);
}

function requireBody(req, keys) {
  const missing = keys.filter(k => req.body?.[k] == null || req.body[k] === '');
  return missing.length ? `missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` : null;
}

async function callAgent({ agent_id, bu, meeting, transcript, message }) {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error: 'ANTHROPIC_API_KEY is not set in the container. Add it to .env (ANTHROPIC_API_KEY=...) and restart the compose stack.',
    };
  }

  const system = await buildSystemPrompt({ agent_id, bu, meeting });

  const messages = [];
  for (const t of transcript || []) {
    const role = t.role === 'operator' ? 'user' : 'assistant';
    const content = String(t.content || '').trim();
    if (!content) continue;
    // The Anthropic SDK requires strict user/assistant alternation. If the
    // stored transcript violates it (e.g. two agent turns in a row after a
    // resumed session), merge consecutive same-role messages so the SDK
    // doesn't 400.
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n\n' + content;
    } else {
      messages.push({ role, content });
    }
  }
  const newMsg = String(message || '').trim();
  if (newMsg) {
    if (messages.length && messages[messages.length - 1].role === 'user') {
      messages[messages.length - 1].content += '\n\n' + newMsg;
    } else {
      messages.push({ role: 'user', content: newMsg });
    }
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return { ok: false, error: 'Cannot generate a reply — no user message in the conversation' };
  }

  try {
    const resp = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });
    const parts = Array.isArray(resp.content) ? resp.content : [];
    const text = parts
      .filter(p => p && p.type === 'text' && p.text)
      .map(p => p.text)
      .join('\n')
      .trim();
    return { ok: true, text: text || '(the agent returned an empty reply)' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function installMeetingRoutes(app) {
  app.get('/api/meetings/health', (_req, res) => {
    json(res, 200, {
      ok: true,
      service: 'genus-meeting-server',
      variant: 'docker-node',
      version: '0.1',
      model: MODEL_ID,
      anthropic_key_present: !!process.env.ANTHROPIC_API_KEY,
    });
  });

  app.get('/api/meetings', async (req, res) => {
    const bu = (req.query.bu || '').toString().trim();
    if (!bu) return json(res, 400, { ok: false, message: 'bu query param required' });
    try {
      const meetings = await loadMeetings(bu);
      json(res, 200, { ok: true, meetings });
    } catch (e) {
      json(res, 500, { ok: false, message: e?.message || String(e) });
    }
  });

  app.post('/api/meetings/new', async (req, res) => {
    const err = requireBody(req, ['bu', 'agent_id']);
    if (err) return json(res, 400, { ok: false, message: err });
    const { bu, agent_id, title, purpose, opening_prompt, related_item, from_request_id, expected_output } = req.body;

    try {
      const meetings = await loadMeetings(bu);

      // Idempotency: reuse an active meeting for the same request_id.
      if (from_request_id) {
        const existing = meetings.find(m => m.status === 'active' && m.from_request_id === from_request_id);
        if (existing) return json(res, 200, { ok: true, meeting: existing, deduped: true });
      }

      const meeting = {
        id: nextMeetingId(meetings),
        bu,
        title: title || 'Untitled meeting',
        agent_id,
        purpose: purpose || 'general',
        status: 'active',
        started_at: nowIso(),
        closed_at: null,
        transcript: [],
      };
      if (related_item) meeting.related_item = related_item;
      if (from_request_id) meeting.from_request_id = from_request_id;
      if (expected_output) meeting.expected_output = String(expected_output).trim();
      if (opening_prompt) {
        meeting.transcript.push({
          role: agent_id,
          content: String(opening_prompt),
          at: nowIso(),
        });
      }

      meetings.push(meeting);
      await saveMeetings(bu, meetings);
      json(res, 200, { ok: true, meeting });
    } catch (e) {
      json(res, 500, { ok: false, message: e?.message || String(e) });
    }
  });

  app.post('/api/meetings/turn', async (req, res) => {
    const err = requireBody(req, ['bu', 'meeting_id', 'message']);
    if (err) return json(res, 400, { ok: false, message: err });
    const { bu, meeting_id, message } = req.body;

    let meetings;
    try { meetings = await loadMeetings(bu); }
    catch (e) { return json(res, 500, { ok: false, message: e?.message || String(e) }); }

    const meeting = meetings.find(m => m.id === meeting_id);
    if (!meeting) return json(res, 404, { ok: false, message: `Meeting ${meeting_id} not found` });
    if (meeting.status !== 'active') {
      return json(res, 409, { ok: false, message: `Meeting is ${meeting.status}; cannot add turns` });
    }

    meeting.transcript = meeting.transcript || [];
    meeting.transcript.push({ role: 'operator', content: message, at: nowIso() });

    const priorTranscript = meeting.transcript.slice(0, -1);
    const result = await callAgent({
      agent_id: meeting.agent_id,
      bu,
      meeting,
      transcript: priorTranscript,
      message,
    });

    if (!result.ok) {
      // Persist the operator turn even if the agent call failed — no lost input.
      try { await saveMeetings(bu, meetings); } catch { /* best-effort */ }
      return json(res, 502, { ok: false, message: result.error });
    }

    meeting.transcript.push({
      role: meeting.agent_id,
      content: result.text,
      at: nowIso(),
    });

    try { await saveMeetings(bu, meetings); }
    catch (e) { return json(res, 500, { ok: false, message: `Turn generated but save failed: ${e?.message || e}` }); }

    json(res, 200, { ok: true, meeting, reply: result.text });
  });

  app.post('/api/meetings/close', async (req, res) => {
    const err = requireBody(req, ['bu', 'meeting_id']);
    if (err) return json(res, 400, { ok: false, message: err });
    const { bu, meeting_id } = req.body;

    try {
      const meetings = await loadMeetings(bu);
      const meeting = meetings.find(m => m.id === meeting_id);
      if (!meeting) return json(res, 404, { ok: false, message: `Meeting ${meeting_id} not found` });
      meeting.status = 'closed';
      meeting.closed_at = nowIso();
      await saveMeetings(bu, meetings);
      json(res, 200, { ok: true, meeting });
    } catch (e) {
      json(res, 500, { ok: false, message: e?.message || String(e) });
    }
  });
}
