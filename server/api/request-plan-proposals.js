// POST /api/request-plan-proposals
//
// Operator clicks "Ask Stewart for 3 plan proposals" in the Planning view.
// This function:
//   1. Reads current plan + backlog ready items + recent memos
//   2. Resolves which Stewart owns Strategy on this BU (from agent_bindings.json)
//   3. Builds a rich synthesis prompt with all the context baked in
//   4. Appends an auto-approved planning_proposal task to tasks.json,
//      targeted at the resolved Stewart
//   5. Adapter picks it up on next 30s poll + pushes to Paperclip
//   6. Stewart drafts 3 proposals + writes them to plan_proposals.json
//
// Body: { bu }
//
// Recovery merge Step 1 (2026-07-31): ported from 5fc65d7 (2026-06-19 EOD
// working era). Original hardcoded 'tuto-stewart' as executor. This version
// resolves the strategy-module Stewart per BU from agent_bindings.json —
// no more silent fallback to genus-agent.

import { getFile, putFile, jsonResponse, todayISO, todayDate } from '../storage/index.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body = {};
  try { body = await request.json(); } catch {}
  const bu = (body.bu || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu required' });

  // i38: BU-isolation on mutation
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  // Resolve which Stewart owns Strategy on this BU. No silent fallback.
  const stewart = await resolveStrategyStewart(env.GITHUB_PAT, bu);
  if (!stewart) {
    return jsonResponse(400, {
      ok: false,
      message: `No Strategy Stewart bound to BU '${bu}'. Install the strategy module first (Modules → Install) so a Strategy Stewart owns the planning loop.`,
    });
  }

  // Gather context for the synthesis prompt
  const ctx = await loadContext(env.GITHUB_PAT, bu);

  const description = buildSynthesisPrompt(bu, stewart.agent_id, ctx);

  const tasksPath = `dashboard/public/data/bus/${bu}/tasks.json`;
  let tasksFile;
  try { tasksFile = await getFile(env.GITHUB_PAT, tasksPath); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let tasks;
  try { tasks = JSON.parse(tasksFile.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse tasks.json: ${e}` }); }
  if (!Array.isArray(tasks)) return jsonResponse(500, { ok: false, message: 'tasks.json must be an array' });

  const today = todayDate();
  const now = todayISO();
  const todayTasks = tasks.filter(t => t.id && t.id.startsWith(`task-${today}-`));
  const nextNum = String(todayTasks.length + 1).padStart(3, '0');
  const taskId = `task-${today}-${nextNum}`;

  const newTask = {
    id: taskId,
    bu,
    title: `Synthesize 3 next-plan proposals (operator request ${now})`,
    description,
    origin: 'operator_request',
    proposer: 'operator',
    proposed_at: now,
    source_heartbeat: 'plan-proposal-request',
    category: 'planning_proposal',
    risk_level: 'low',
    reversibility: 'high',
    estimated_minutes: 20,
    target: {
      type: 'planning_synthesis',
      scope: `dashboard/public/data/bus/${bu}/plan_proposals.json`,
      executor: stewart.agent_id,
    },
    advances_initiative: null,
    affects_kpi: null,
    from_memo: null,
    status: 'approved',
    approval: {
      rule_evaluation: 'operator_request → auto-approved',
      decided_by: 'operator',
      decided_at: now,
      notes: null,
    },
    execution: {
      paperclip_issue_id: null,
      paperclip_issue_url: null,
      started_at: null,
      completed_at: null,
      outcome: null,
    },
  };

  tasks.push(newTask);
  const newContent = JSON.stringify(tasks, null, 2) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, tasksPath, newContent, tasksFile.sha, `tasks: ${taskId} — request 3 plan proposals (operator → ${stewart.agent_id})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, {
    ok: true,
    task: newTask,
    stewart: stewart.agent_id,
    commit_sha: commit.commit.sha,
    message: `Task queued for ${stewart.agent_id}. Adapter will push to Paperclip in <30s; Stewart will write 3 proposals + commit. Check the Planning view in ~3-5 min.`,
  });
}

/**
 * Resolve which agent owns Strategy on this BU.
 * Reads agent_bindings.json — returns null if strategy module not installed.
 */
async function resolveStrategyStewart(pat, bu) {
  try {
    const f = await getFile(pat, 'dashboard/public/data/system/agent_bindings.json');
    let bindings = JSON.parse(f.content);
    if (!Array.isArray(bindings)) bindings = bindings?.bindings || [];
    const match = bindings.find(b =>
      b.bu === bu && b.module_id === 'strategy' && b.agent_id
    );
    return match ? { agent_id: match.agent_id } : null;
  } catch {
    return null;
  }
}

async function loadContext(pat, bu) {
  const paths = {
    plans: `dashboard/public/data/bus/${bu}/plans.json`,
    goals: `dashboard/public/data/bus/${bu}/goals.json`,
    initiatives: `dashboard/public/data/bus/${bu}/initiatives.json`,
    memos: `dashboard/public/data/bus/${bu}/memos.jsonl`,
  };
  const results = {};
  for (const [k, p] of Object.entries(paths)) {
    try {
      const f = await getFile(pat, p);
      results[k] = k === 'memos'
        ? f.content.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        : JSON.parse(f.content);
    } catch (e) {
      results[k] = [];
    }
  }
  return results;
}

function buildSynthesisPrompt(bu, stewartId, ctx) {
  const activePlan = (ctx.plans || []).find(p => p.status === 'active');
  const readyBacklog = [
    ...(ctx.goals || []).filter(g => g.backlog_state === 'ready').map(g => ({ ...g, _type: 'goal' })),
    ...(ctx.initiatives || []).filter(i => i.backlog_state === 'ready').map(i => ({ ...i, _type: 'initiative' })),
  ];
  const recentMemos = (ctx.memos || []).slice(-10);

  const lines = [];
  lines.push(`You are ${stewartId} — the Strategy Stewart of the ${bu} BU. The operator has requested 3 plan proposals for the next ~30-day period.`);
  lines.push('');
  lines.push(`## Current plan state`);
  if (activePlan) {
    lines.push(`Active: ${activePlan.id} — "${activePlan.title}"`);
    lines.push(`Period: ${activePlan.period_start} → ${activePlan.period_target_end}`);
    lines.push(`Rationale: ${activePlan.rationale || '—'}`);
    lines.push(`Goals (${activePlan.goal_ids?.length || 0}):`);
    (activePlan.goal_ids || []).forEach(gid => {
      const g = (ctx.goals || []).find(x => x.id === gid);
      if (g) lines.push(`  - ${g.id} · "${g.title}" · status: ${g.status || '?'}`);
    });
    lines.push(`Initiatives (${activePlan.initiative_ids?.length || 0}):`);
    (activePlan.initiative_ids || []).forEach(iid => {
      const i = (ctx.initiatives || []).find(x => x.id === iid);
      if (i) lines.push(`  - ${i.id} · ${i.priority_in_plan || '?'} · "${i.title}" · status: ${i.status || '?'} · close: ${i.target_close_date || '?'}`);
    });
  } else {
    lines.push('No active plan.');
  }
  lines.push('');
  lines.push(`## Backlog — ready items (vetted by operator)`);
  if (readyBacklog.length) {
    readyBacklog.forEach(it => {
      const detail = it._type === 'goal' ? (it.description || '') : (it.active_hypothesis || '');
      lines.push(`- ${it._type.toUpperCase()} ${it.id} · "${it.title}" · ${detail}`);
    });
  } else {
    lines.push('No ready items in the backlog. (Consider untriaged items if strategically warranted, but prefer the active plan\'s unfinished work.)');
  }
  lines.push('');
  lines.push(`## Recent memos (last 10)`);
  if (recentMemos.length) {
    recentMemos.forEach(m => lines.push(`- [${m.level || 'misc'}${m.target ? ' → ' + m.target : ''}] ${m.body || ''}`));
  } else {
    lines.push('No recent memos.');
  }
  lines.push('');
  lines.push(`## Your task`);
  lines.push('');
  lines.push(`Synthesize 3 distinct plan proposals for the next ~30-day period. Each proposal should have its own thematic angle — genuinely different alternatives, not variations on the same plan.`);
  lines.push('');
  lines.push(`Suggested angles to differentiate proposals (use these as inspiration, not a checklist):`);
  lines.push(`- **Continue momentum**: finish slipped initiatives + immediate next-step build work`);
  lines.push(`- **Pivot focus**: shift to whichever dimension (acquisition, monetisation, retention) is most under-served`);
  lines.push(`- **Reset on weakest link**: foundational work where the current plan revealed gaps`);
  lines.push('');
  lines.push(`Each proposal must include:`);
  lines.push(`- A distinct title (no clones)`);
  lines.push(`- Period (30 days default; adjust if a different window fits)`);
  lines.push(`- 1–3 goals, 3–5 initiatives drawn from either backlog OR new ideas you justify`);
  lines.push(`- A "reasoning" section: why this set, what it sacrifices, what it bets on`);
  lines.push('');
  lines.push(`## Output: write to dashboard/public/data/bus/${bu}/plan_proposals.json`);
  lines.push('');
  lines.push(`Schema for each proposal entry:`);
  lines.push('```json');
  lines.push(JSON.stringify({
    id: 'plan-proposal-YYYYMMDDHHMMSS-NN',
    proposal_set_id: 'pset-YYYYMMDDHHMMSS',
    bu,
    status: 'proposed',
    title: '<distinct title>',
    rationale: '<2-4 sentences why this plan>',
    period_start: 'YYYY-MM-DD',
    period_target_end: 'YYYY-MM-DD',
    proposed_goals: [
      { title: '<goal title>', description: '<goal description>' },
    ],
    proposed_initiatives: [
      {
        title: '<initiative title>',
        goal_index: 0,
        active_hypothesis: '<falsifiable claim>',
        success_criterion: '<measurable outcome>',
        target_close_date: 'YYYY-MM-DD',
        priority_in_plan: 'primary|secondary',
        depends_on_index: [],
      },
    ],
    backlog_ids_drawn_from: ['<existing backlog goal/init id>', '...'],
    reasoning: '<why this set: what it bets on, what it sacrifices, why over the alternatives>',
    proposed_by: stewartId,
    proposed_at: 'YYYY-MM-DDTHH:MM:SSZ',
    proposal_source: {
      current_plan_id: activePlan?.id || null,
      current_plan_progress_summary: '<one-line execution summary>',
      backlog_ready_count: readyBacklog.length,
      memos_considered: recentMemos.length,
    },
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`All 3 proposals share the same \`proposal_set_id\`. Append them to the existing array in plan_proposals.json (don't overwrite — proposals from past requests stay for reference).`);
  lines.push('');
  lines.push(`When done: \`git add\` plan_proposals.json + commit with message "proposals: <count> next-plan candidates synthesized", git push.`);
  return lines.join('\n');
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
