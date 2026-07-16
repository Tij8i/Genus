// POST /api/execute-task
//
// Closes the task→execute→done loop inside the Docker install without a
// separate Paperclip Stewart runtime. Fresh operators can create a task,
// click "Run now", and see it executed + marked done — the core promise
// of Genus.
//
// Body: { bu, task_id }
//
// Flow (all-or-nothing on the Done flip per i109):
//   1. Load task from bus/<bu>/tasks.json
//   2. Guard: must exist; must not already be `done`
//   3. Resolve executor via agent_bindings.json (falls back to genus-agent)
//   4. Run one Anthropic turn with agent identity + BU substrate + task as
//      the user message
//   5. Append the reply as an outcome memo (bus/<bu>/memos.jsonl)
//   6. Flip task to status=done with execution.executionRunId +
//      execution.outcome_artifact populated
//   7. If any step 4-6 fails, task stays where it was; return the error
//
// Returns: { ok, task, artifact } | { ok: false, message }

import { getFile, putFile, jsonResponse } from '../storage/index.js';
import { runAgentTurn, writeOutcomeMemo, resolveExecutor } from '../lib/agent-executor.js';

const PAT = 'local-mode-no-pat';

function taskPromptFromTask(task) {
  const parts = [];
  parts.push(`# Task: ${task.title}`);
  if (task.description) parts.push('\n' + task.description);
  if (task.category) parts.push(`\nCategory: ${task.category}`);
  if (task.advances_initiative) parts.push(`Advances initiative: ${task.advances_initiative}`);
  parts.push('\n---');
  parts.push('The operator has clicked "Run now" on this task. Do the work now, in this turn. Write your answer as if you were reporting back the result — decisions made, facts observed, artifact produced. Be plain-English and concrete. If the task requires editing a file or filing something the runtime cannot do inside a single Claude turn (e.g. sending an external email, hitting an external API you do not have credentials for), say so explicitly and describe what you WOULD do, so the operator can pick it up manually.');
  return parts.join('\n');
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON body' }); }
  const bu = (body.bu || '').toString().trim();
  const task_id = (body.task_id || '').toString().trim();
  if (!bu || !task_id) return jsonResponse(400, { ok: false, message: 'bu + task_id required' });

  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
  let tasksFile;
  try { tasksFile = await getFile(PAT, tasksPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: `tasks.json read failed: ${e.message || e}` }); }

  let tasks;
  try { tasks = JSON.parse(tasksFile.content); }
  catch { return jsonResponse(500, { ok: false, message: 'tasks.json not valid JSON' }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json is not an array' });

  const task = tasks.find(t => t?.id === task_id);
  if (!task) return jsonResponse(404, { ok: false, message: `task ${task_id} not found in ${bu}` });
  if (task.status === 'done') {
    return jsonResponse(409, { ok: false, message: `task ${task_id} is already done`, task });
  }

  const agent_id = await resolveExecutor(task?.target?.executor || `${bu}-stewart`, bu);

  // 1) Call Claude with the task as the user message.
  const run = await runAgentTurn({
    agent_id,
    bu,
    systemExtras: null,
    userMessage: taskPromptFromTask(task),
  });
  if (!run.ok) {
    return jsonResponse(502, {
      ok: false,
      message: `execution failed — task remains ${task.status}: ${run.error}`,
      task,
    });
  }

  // 2) Persist the outcome memo BEFORE flipping the task, so a crash after
  //    the task flip can still be reconciled via memos.jsonl.
  let artifact;
  try {
    artifact = await writeOutcomeMemo({
      bu,
      agent_id,
      source_task_id: task_id,
      body: run.text,
      run,
    });
  } catch (e) {
    return jsonResponse(500, {
      ok: false,
      message: `execution succeeded but outcome-memo write failed — task remains ${task.status}: ${e.message || e}`,
      task,
    });
  }

  // 3) Flip task to done per i109 trust rules.
  const now = new Date().toISOString();
  task.status = 'done';
  task.execution = task.execution || {};
  task.execution.started_at = task.execution.started_at || now;
  task.execution.completed_at = now;
  task.execution.executionRunId = run.executionRunId;   // i109 proof
  task.execution.executed_by = agent_id;
  task.execution.outcome_artifact = {
    kind: 'memo',
    memo_id: artifact.id,
    path: artifact.path,
  };
  task.execution.outcome_summary = (run.text || '').slice(0, 400);

  const newContent = JSON.stringify(tasks, null, 2) + '\n';
  try {
    await putFile(PAT, tasksPath, newContent, tasksFile.sha, `tasks: ${task_id} executed by ${agent_id} → done`);
  } catch (e) {
    // Memo already written; log this as a partial and let the caller retry.
    return jsonResponse(500, {
      ok: false,
      partial: true,
      message: `executed + outcome memo saved, but tasks.json write failed. Re-run to complete the Done flip. Error: ${e.message || e}`,
      artifact,
      task,
    });
  }

  return jsonResponse(200, {
    ok: true,
    task,
    artifact,
    executor: agent_id,
    executionRunId: run.executionRunId,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
