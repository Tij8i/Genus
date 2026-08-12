// POST /api/groom-backlog
//
// Operator clicks "Groom backlog" on the Backlog tab. This is Step 1 in the
// planning ritual (Groom → Draft → Propose):
//
//   1. Groom (this endpoint)    — Stewart enriches the backlog: promotes
//                                  Untriaged candidates to Ready or discards
//                                  stale ones, adds new goals/initiatives
//                                  implied by recent memos. No plan yet.
//   2. Draft (manual "New plan") — operator sketches their plan.
//   3. Propose (existing endpoint) — Stewart synthesizes 3 alternatives.
//
// Each step is optional; the buttons are independent.
//
// Body: { bu }
// Returns: { ok, task, stewart, commit_sha, message }

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';
import { getSchemaVersion, isV2 } from './_schema-version.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body = {};
  try { body = await request.json(); } catch {}
  const bu = (body.bu || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  const stewart = await resolveStrategyStewart(env.GITHUB_PAT, bu);
  if (!stewart) return jsonResponse(400, { ok: false, message: `No Strategy Stewart bound to '${bu}'. Install the strategy module first.` });

  const ctx = await loadContext(env.GITHUB_PAT, bu);
  const schemaVersion = await getSchemaVersion(env.GITHUB_PAT, bu);
  const description = buildGroomPrompt(bu, stewart.agent_id, ctx, schemaVersion);

  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
  let tasksFile;
  try { tasksFile = await getFile(env.GITHUB_PAT, tasksPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }
  let tasks;
  try { tasks = JSON.parse(tasksFile.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse tasks: ${e}` }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json must be an array' });

  const today = todayDate();
  const now = todayISO();
  const todayTasks = tasks.filter(t => t.id && t.id.startsWith(`task-${today}-`));
  const nextNum = String(todayTasks.length + 1).padStart(3, '0');
  const taskId = `task-${today}-${nextNum}`;

  const newTask = {
    id: taskId, bu,
    title: `Groom the ${bu} backlog (operator request ${now})`,
    description,
    origin: 'operator_request',
    proposer: 'operator',
    proposed_at: now,
    source_heartbeat: 'backlog-groom-request',
    category: 'backlog_groom',
    risk_level: 'low',
    reversibility: 'high',
    estimated_minutes: 20,
    target: {
      type: 'backlog_grooming',
      scope: `dashboard/public/data/bus/${bu}/goals.json + initiatives.json + memos.jsonl`,
      executor: stewart.agent_id,
    },
    advances_initiative: null,
    advances_plan: null,
    affects_kpi: null,
    from_memo: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'operator_request → auto-approved',
      decided_by: 'operator',
      decided_at: now,
      notes: null,
    },
    execution: { paperclip_issue_id: null, paperclip_issue_url: null, started_at: null, completed_at: null, outcome: null },
  };
  tasks.push(newTask);

  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, tasksPath, JSON.stringify(tasks, null, 2) + '\n', tasksFile.sha,
      `tasks: ${taskId} — groom backlog (operator → ${stewart.agent_id})`);
  } catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  return jsonResponse(200, {
    ok: true,
    task: newTask,
    stewart: stewart.agent_id,
    commit_sha: commit.commit.sha,
    message: `Task queued for ${stewart.agent_id}. Adapter pushes to Paperclip in <30s; Stewart grooms the backlog. Refresh in ~3-5 min.`,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}

async function resolveStrategyStewart(pat, bu) {
  try {
    const f = await getFile(pat, 'dashboard/public/data/system/agent_bindings.json');
    let bindings = JSON.parse(f.content);
    if (!Array.isArray(bindings)) bindings = bindings?.bindings || [];
    const match = bindings.find(b => b.bu === bu && b.module_id === 'strategy' && b.agent_id);
    return match ? { agent_id: match.agent_id } : null;
  } catch { return null; }
}

async function loadContext(pat, bu) {
  const paths = {
    goals: `dashboard/public/data/bus/${bu}/goals.json`,
    initiatives: `dashboard/public/data/bus/${bu}/initiatives.json`,
    memos: `dashboard/public/data/bus/${bu}/memos.jsonl`,
    kpis: `dashboard/public/data/bus/${bu}/kpis.json`,
    plans: `dashboard/public/data/bus/${bu}/plans.json`,
  };
  const results = {};
  for (const [k, p] of Object.entries(paths)) {
    try {
      const f = await getFile(pat, p);
      results[k] = k === 'memos'
        ? f.content.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        : JSON.parse(f.content);
    } catch { results[k] = []; }
  }
  return results;
}

function buildGroomPrompt(bu, stewartId, ctx, schemaVersion) {
  const v2 = isV2(schemaVersion);
  const goals = ctx.goals || [];
  const inits = ctx.initiatives || [];
  const memos = (ctx.memos || []).slice(-20);
  const kpis = (ctx.kpis || []).filter(k => (k.priority || '').toLowerCase() === 'primary' || (k.category || '').toLowerCase() === 'north_star');
  const activePlan = (ctx.plans || []).find(p => p.status === 'active');

  const untriaged = [...goals, ...inits].filter(x => (x.backlog_state || 'untriaged') === 'untriaged');
  const ready = [...goals, ...inits].filter(x => x.backlog_state === 'ready');

  const L = [];
  L.push(`You are ${stewartId} — the Strategy Stewart of the ${bu} BU. The operator asked you to groom the backlog. This is Step 1 of the planning ritual (Groom → Draft → Propose). Your job: enrich + tidy the pool of candidate goals/initiatives. Do NOT propose a plan.`);
  L.push('');
  L.push(`## Current state`);
  L.push(`- Active plan: ${activePlan ? `"${activePlan.title}"` : 'none'}`);
  L.push(`- Untriaged items (${untriaged.length}): candidates waiting for a call.`);
  L.push(`- Ready items (${ready.length}): vetted, awaiting a plan to land in.`);
  L.push(`- Recent memos (${memos.length}): operator observations, ideas, requests.`);
  L.push(`- Primary/north-star KPIs (${kpis.length}): ${kpis.map(k => k.name).slice(0, 5).join(', ')}${kpis.length > 5 ? ' …' : ''}`);
  L.push('');
  L.push(`## Untriaged items — please triage`);
  if (untriaged.length) {
    untriaged.forEach(x => {
      const kind = x.title ? (x.active_hypothesis ? 'INITIATIVE' : 'GOAL') : 'ITEM';
      L.push(`- ${kind} ${x.id}: "${x.title || '(untitled)'}" — ${(x.description || x.active_hypothesis || '').slice(0, 120)}`);
    });
  } else {
    L.push('(none — skip triage)');
  }
  L.push('');
  L.push(`## Ready items — no action needed unless something is stale`);
  if (ready.length) {
    ready.forEach(x => L.push(`- ${x.id}: "${x.title}"`));
  } else {
    L.push('(none)');
  }
  L.push('');
  L.push(`## Recent memos — mine for missing action items`);
  if (memos.length) {
    memos.forEach(m => L.push(`- [${m.level || 'misc'}${m.target ? ' → ' + m.target : ''}] ${(m.body || '').slice(0, 200)}`));
  } else {
    L.push('(none)');
  }
  L.push('');
  L.push(`## What to do`);
  L.push('');
  L.push(`1. **Triage every Untriaged item** — for each, either:`);
  L.push(`   - Move to Ready (\`backlog_state: "ready"\`) if it's a strong candidate for an upcoming plan.`);
  L.push(`   - Move to Discarded (\`backlog_state: "discarded"\` + \`discarded_reason: "..."\`) if it's stale/redundant/off-strategy.`);
  L.push('');
  L.push(`2. **Add new items from memos** — for any recent memo that names a concrete action or opportunity that isn't already represented in the backlog:`);
  if (v2) {
    L.push(`   - Add a new goal (\`goal-YYYY-MM-DD-NN\`) with title + description + kpi_id + target_value + target_date if the memo implies a measurable outcome.`);
  } else {
    L.push(`   - Add a new goal with title + description.`);
  }
  L.push(`   - Add a new initiative (\`init-YYYY-MM-DD-NN\`) with title + active_hypothesis + success_criterion if the memo implies a workstream.`);
  L.push(`   - Set \`backlog_state: "ready"\` on any new item you're confident about (skip Untriaged for your own additions).`);
  L.push(`   - Reference the memo id in \`from_memo\`.`);
  L.push('');
  L.push(`3. **Do NOT propose a plan** — that's the next step (either the operator will manually draft one, or click "Ask Stewart for 3 proposals").`);
  L.push('');
  L.push(`## Output`);
  L.push('');
  L.push(`Write updates to:`);
  L.push(`- \`dashboard/public/data/bus/${bu}/goals.json\` (mutations + additions)`);
  L.push(`- \`dashboard/public/data/bus/${bu}/initiatives.json\` (mutations + additions)`);
  L.push('');
  L.push(`Commit with message \`backlog: grooming pass — <N> triaged, <M> new items from memos\`, git push.`);
  return L.join('\n');
}
