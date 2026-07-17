// POST /api/process-memos
//
// Closes the memo→process→suggestion loop. Reads unprocessed memos in
// bus/<bu>/memos.jsonl, asks the Genus Agent whether each one needs
// action, files matching suggestions as tasks with
// status=awaiting_approval, marks the memos processed.
//
// The operator's canonical flow: drop a memo saying "please file a
// suggestion to do X" → click Process → suggestion appears in Tasks.
// Also runs autonomously via the in-Node scheduler (server/index.js →
// startAutonomousScheduler) so memos dropped when the operator is away
// still get processed.
//
// Body: { bu, max?: number }
// Returns: { ok, processed_count, tasks_filed[], skipped[] }

import { getFile, putFile, jsonResponse } from '../storage/index.js';
import { runAgentTurn, resolveExecutor } from '../lib/agent-executor.js';

const PAT = 'local-mode-no-pat';
const DEFAULT_MAX = 20;

// The single-memo decision prompt. The model MUST reply with a JSON object
// matching the shape below — no prose around it. Parse errors → treat as
// no-action + log; never file a phantom task.
const DECISION_SCHEMA_HINT = `Reply with a JSON object of this exact shape (no prose, no Markdown code fence, just the JSON):

{
  "action": "file_task" | "no_action",
  "reasoning": "one sentence explaining your decision",
  "task": {
    "title": "short imperative task title",
    "description": "1-3 sentence description of what to do",
    "category": "operator_request"
  }
}

Only include the "task" field when action == "file_task".

Guidance:
- If the memo explicitly asks you to file a task, suggestion, or follow-up: action = file_task.
- If the memo is a stray thought, observation, or feedback with no action ask: action = no_action.
- If unsure, default to no_action.`;

function parseDecision(text) {
  const trimmed = String(text || '').trim();
  // Strip potential fenced ```json blocks the model might still emit.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && (parsed.action === 'file_task' || parsed.action === 'no_action')) return parsed;
  } catch { /* fall through */ }
  return null;
}

async function readMemos(bu) {
  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  let current;
  try { current = await getFile(PAT, path); }
  catch (e) {
    if (e && (e.status === 404 || /not.?found/i.test(e.message || ''))) return { lines: [], sha: undefined };
    throw e;
  }
  const lines = (current.content || '').split('\n').filter(Boolean).map(l => {
    try { return { raw: l, obj: JSON.parse(l) }; }
    catch { return { raw: l, obj: null }; }
  });
  return { lines, sha: current.sha };
}

async function saveMemos(bu, lines, sha) {
  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  const body = lines.map(x => JSON.stringify(x.obj) + '\n').join('');
  await putFile(PAT, path, body, sha, `memos: process pass (${lines.length} lines)`);
}

async function loadTasks(bu) {
  const path = `dashboard/public/data/bus/${bu}/tasks.json`;
  let current;
  try { current = await getFile(PAT, path); }
  catch (e) {
    if (e && (e.status === 404 || /not.?found/i.test(e.message || ''))) return { arr: [], sha: undefined };
    throw e;
  }
  const arr = JSON.parse(current.content);
  return { arr: Array.isArray(arr) ? arr : [], sha: current.sha };
}

function nextTaskId(arr) {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `task-${today}-`;
  const n = arr.filter(t => (t?.id || '').startsWith(prefix)).length + 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

async function saveTasks(bu, arr, sha) {
  const path = `dashboard/public/data/bus/${bu}/tasks.json`;
  const body = JSON.stringify(arr, null, 2) + '\n';
  await putFile(PAT, path, body, sha, `tasks: filed by memo-processor (+${arr.length})`);
}

export async function processMemosForBu({ bu, max = DEFAULT_MAX }) {
  const agent_id = await resolveExecutor(`${bu}-stewart`, bu);
  const { lines, sha: memosSha } = await readMemos(bu);
  const unprocessed = lines
    .map((entry, i) => ({ ...entry, i }))
    .filter(x => x.obj && (x.obj.status === 'unprocessed' || !x.obj.status))
    .slice(0, max);

  if (unprocessed.length === 0) return { processed_count: 0, tasks_filed: [], skipped: [] };

  const { arr: existingTasks, sha: tasksSha } = await loadTasks(bu);
  const tasks_filed = [];
  const skipped = [];
  const now = new Date().toISOString();
  let filedTasksMutated = false;

  for (const entry of unprocessed) {
    const memo = entry.obj;
    const run = await runAgentTurn({
      agent_id,
      bu,
      systemExtras: DECISION_SCHEMA_HINT,
      userMessage: `The operator filed this memo — decide if it warrants filing a task/suggestion:\n\n---\n${memo.body || ''}\n---`,
    });
    if (!run.ok) {
      skipped.push({ memo_id: memo.id, reason: run.error });
      continue;
    }
    const decision = parseDecision(run.text);
    if (!decision) {
      skipped.push({ memo_id: memo.id, reason: `agent reply not parseable: ${(run.text || '').slice(0, 200)}` });
      continue;
    }

    if (decision.action === 'file_task' && decision.task) {
      const id = nextTaskId(existingTasks);
      const task = {
        id,
        bu,
        title: String(decision.task.title || '(untitled)').slice(0, 200),
        description: String(decision.task.description || ''),
        origin: 'memo_derived',
        proposer: agent_id,
        proposed_at: now,
        source_heartbeat: 'memo_processor',
        category: decision.task.category || 'operator_request',
        risk_level: 'low',
        reversibility: 'high',
        tier: 'normal',
        estimated_minutes: 30,
        target: { type: 'stewart_action', scope: '', executor: agent_id },
        advances_initiative: null,
        affects_kpi: null,
        from_memo: memo.id,
        status: 'awaiting_approval',
        approval: {
          rule_evaluation: 'agent_suggested → awaiting operator approval',
          decided_by: null,
          decided_at: null,
          notes: decision.reasoning || null,
        },
        execution: {
          started_at: null,
          completed_at: null,
          outcome: null,
        },
      };
      existingTasks.push(task);
      tasks_filed.push({ memo_id: memo.id, task_id: id, reasoning: decision.reasoning });
      filedTasksMutated = true;
    }

    // Mark memo processed regardless of the decision — operator sees the audit trail.
    entry.obj = {
      ...memo,
      status: 'processed',
      processed_by: agent_id,
      processed_at: now,
      applied_to: decision.action === 'file_task' ? [tasks_filed[tasks_filed.length - 1].task_id] : [],
      processing_run: {
        executionRunId: run.executionRunId,
        model: run.model,
        decision: decision.action,
        reasoning: decision.reasoning,
      },
    };
    lines[entry.i] = entry;
  }

  if (filedTasksMutated) {
    try { await saveTasks(bu, existingTasks, tasksSha); }
    catch (e) { skipped.push({ reason: `tasks.json write failed: ${e.message || e}` }); }
  }
  try { await saveMemos(bu, lines, memosSha); }
  catch (e) { skipped.push({ reason: `memos.jsonl write failed: ${e.message || e}` }); }

  return { processed_count: unprocessed.length - skipped.length, tasks_filed, skipped };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON body' }); }
  const bu = (body.bu || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });
  const max = Number.isFinite(body.max) ? Math.max(1, Math.round(body.max)) : DEFAULT_MAX;

  try {
    const out = await processMemosForBu({ bu, max });
    return jsonResponse(200, { ok: true, bu, ...out });
  } catch (e) {
    return jsonResponse(500, { ok: false, message: e?.message || String(e) });
  }
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
