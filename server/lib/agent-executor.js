// Shared executor — runs a single Anthropic turn as a named agent against a
// task or a memo, records the outcome per i109 trust rules.
//
// Used by both /api/tasks/execute (synchronous task execution) and
// /api/memos/process (memo classification + suggestion filing). Same
// substrate loading + system-prompt shape as the meeting server; the
// difference is that these calls are one-shot (no transcript) and land
// an artifact in substrate instead of a chat reply.
//
// i109 trust guards applied here (not up at the route layer) so any future
// caller — including the in-process scheduler — inherits them without
// having to re-copy the checks.

import Anthropic from '@anthropic-ai/sdk';
import { getFile, putFile } from '../storage/index.js';
import { buildSystemPrompt } from './meeting-agent.js';

const PAT = 'local-mode-no-pat';
const MODEL_ID = process.env.GENUS_EXECUTOR_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.GENUS_EXECUTOR_MAX_TOKENS || 4096);
const CALL_TIMEOUT_MS = Number(process.env.GENUS_EXECUTOR_TIMEOUT_MS || 240_000);

let anthropicClient = null;
function getClient() {
  if (anthropicClient) return anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  anthropicClient = new Anthropic({ apiKey: key, timeout: CALL_TIMEOUT_MS });
  return anthropicClient;
}

async function readJsonSafe(path) {
  try {
    const { content } = await getFile(PAT, path);
    return JSON.parse(content);
  } catch { return null; }
}

// Resolve which agent should execute a given target. Fresh-install BUs only
// have the genus-agent binding; every other executor id (e.g. "medivara-stewart")
// falls back to genus-agent. Once module Stewarts are installed the specific
// binding takes precedence.
export async function resolveExecutor(targetExecutor, bu) {
  const bindings = await readJsonSafe('dashboard/public/data/system/agent_bindings.json');
  const list = bindings?.bindings || [];
  const forBu = list.filter(b => b.bu === bu);
  const exact = forBu.find(b => b.agent_id === targetExecutor);
  if (exact) return exact.agent_id;
  const genus = forBu.find(b => b.agent_id === 'genus-agent') || list.find(b => b.agent_id === 'genus-agent');
  return genus ? genus.agent_id : 'genus-agent';
}

// Run a single Claude turn as the resolved agent. Returns
//   { ok, text, executionRunId, model } on success
//   { ok: false, error }               on failure
//
// Callers (task-execute, memo-process) must verify ok before flipping any
// substrate state to Done — this is where i109's "no Done without a real
// execution artifact" guard bites.
export async function runAgentTurn({ agent_id, bu, systemExtras, userMessage }) {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error: 'ANTHROPIC_API_KEY is not set in the container. Add it to .env and restart the compose stack.',
    };
  }
  const baseSystem = await buildSystemPrompt({ agent_id, bu, meeting: null });
  const system = systemExtras ? baseSystem + '\n\n---\n\n' + systemExtras : baseSystem;
  try {
    const resp = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: String(userMessage) }],
    });
    const parts = Array.isArray(resp.content) ? resp.content : [];
    const text = parts.filter(p => p && p.type === 'text' && p.text).map(p => p.text).join('\n').trim();
    if (!text) return { ok: false, error: 'agent returned empty text' };
    return {
      ok: true,
      text,
      executionRunId: resp.id,   // Anthropic message id — the i109-required proof
      model: resp.model,
      stop_reason: resp.stop_reason,
      usage: resp.usage,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Append an outcome memo to bus/<bu>/memos.jsonl and return the resulting
// memo id + relative path so callers can populate outcome_artifact.
export async function writeOutcomeMemo({ bu, agent_id, source_task_id, body, run }) {
  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  let current = null;
  try { current = await getFile(PAT, path); } catch { current = null; }
  const existing = (current?.content || '').split('\n').filter(Boolean).length;
  const today = new Date().toISOString().slice(0, 10);
  const id = `memo-${today}-exec-${String(existing + 1).padStart(3, '0')}`;
  const memo = {
    id,
    bu,
    created_at: new Date().toISOString(),
    created_by: agent_id,
    level: 'task',
    target: source_task_id ? { type: 'task', id: source_task_id } : null,
    body,
    type: 'agent_execution_output',
    source: 'agent_executor',
    status: 'processed',
    processed_by: agent_id,
    processed_at: new Date().toISOString(),
    applied_to: source_task_id ? [source_task_id] : [],
    agent_run: {
      executionRunId: run.executionRunId,
      model: run.model,
      stop_reason: run.stop_reason,
      usage: run.usage,
    },
  };
  const line = JSON.stringify(memo) + '\n';
  const newContent = (current?.content || '') + line;
  await putFile(PAT, path, newContent, current?.sha, `memos: agent-execution artifact for ${source_task_id || 'batch'}`);
  return { id, path, memo };
}
