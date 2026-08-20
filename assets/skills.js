// Skill registry + dispatcher.
//
// The system's user-invokable actions are catalogued as "skills." Each skill
// lives in the substrate at dashboard/public/data/skills/<id>/ with:
//   - manifest.json — the shape (id, name, kind, trigger, endpoint/handler)
//   - SKILL.md      — prompt template (for kind='agent_session' only)
//
// The registry index is dashboard/public/data/skills/_index.json.
//
// Kinds:
//   agent_session  → opens a live meeting with the agent, injects SKILL.md
//                     (with context slots filled) as opening_prompt
//   agent_task     → fires an async POST to an endpoint; agent runs headless
//   deterministic  → runs a client-side handler (no agent involvement)
//
// Callers use invokeSkill(id, ctx, opts). See planning.js for the 3
// backlog-strip buttons wired as skills.

import { fetchSubstrateJson, fetchSubstrate } from './substrate-client.js';
import { showAlert, showConfirm } from './dialog.js';

const SKILLS_BASE = 'dashboard/public/data/skills';
const INDEX_PATH = `${SKILLS_BASE}/_index.json`;

// Cached during a page load, but flushed on the fetch call itself via a
// timestamp query param — skills change fast during iteration, and stale
// prompts in the client cache caused mid-session drift where the agent
// still saw items the operator had just processed. Restart a chat session
// after editing a SKILL.md and it re-fetches. window.__skillsRegistry.reload()
// still exposed for explicit invalidation from DevTools.
let indexCache = null;
let manifestCache = new Map();   // id → manifest JSON
let promptCache = new Map();     // id → SKILL.md text (short-TTL, see loadPromptTemplate)

// Registry of handlers for kind='deterministic' skills. Callers register
// their handlers at boot with registerHandler(name, fn). The dispatcher
// looks up by manifest.handler.
const handlerRegistry = new Map();

export function registerHandler(name, fn) {
  handlerRegistry.set(name, fn);
}

async function loadIndex() {
  if (indexCache) return indexCache;
  indexCache = await fetchSubstrateJson(INDEX_PATH, { skills: [] });
  return indexCache;
}

// No client-side caching during dev — we're actively iterating on SKILL.md
// files, so cached prompts caused mid-session drift. If perf becomes an
// issue later, re-enable with a short TTL. window.__skillsRegistry.reload()
// stays exposed for explicit invalidation from DevTools.
async function loadManifest(id) {
  const path = `${SKILLS_BASE}/${id}/manifest.json`;
  const manifest = await fetchSubstrateJson(path, null);
  if (!manifest) throw new Error(`Skill '${id}' has no manifest at ${path}`);
  manifestCache.set(id, manifest);   // kept for DevTools introspection only
  return manifest;
}

async function loadPromptTemplate(id, manifest) {
  const file = manifest.prompt_file || 'SKILL.md';
  const path = `${SKILLS_BASE}/${id}/${file}`;
  const result = await fetchSubstrate(path);
  if (!result?.content) throw new Error(`Skill '${id}' prompt not found at ${path}`);
  promptCache.set(id, result.content); // kept for DevTools introspection only
  return result.content;
}

// Fill {slot_name} placeholders in the SKILL.md template with rendered
// context. Each context_slot listed in the manifest maps to a render helper
// in the CONTEXT_RENDERERS table below.
function renderPrompt(template, manifest, ctx, extras = {}) {
  const slots = { ...renderStandardSlots(ctx, extras), ...extras };
  for (const slotName of (manifest.context_slots || [])) {
    const renderer = CONTEXT_RENDERERS[slotName];
    // Renderers may need per-invocation params (e.g. plan_detail needs the
    // plan_id from extras). Pass extras as second arg.
    if (renderer) slots[slotName] = renderer(ctx, extras);
  }
  return template.replace(/\{(\w+)\}/g, (m, key) => (slots[key] ?? m));
}

function renderStandardSlots(ctx, extras) {
  return {
    bu: extras.bu || '',
    bu_label: extras.bu_label || extras.bu || '',
    agent_id: extras.agent_id || '',
    related_id: extras.related_id || '',
  };
}

const CONTEXT_RENDERERS = {
  goals_by_backlog_state(ctx) {
    const goals = ctx?.goals || [];
    if (!goals.length) return '(no goals yet)';
    const buckets = { untriaged: [], ready: [], promoted_to_plan: [], discarded: [] };
    goals.forEach(g => (buckets[g.backlog_state || 'untriaged'] || (buckets.untriaged = buckets.untriaged || [])).push(g));
    const line = (label, arr) => arr.length ? `- **${label} (${arr.length})**: ${arr.slice(0, 8).map(g => `"${g.title || g.id}"`).join('; ')}${arr.length > 8 ? ` … +${arr.length - 8}` : ''}` : null;
    return [line('Untriaged', buckets.untriaged), line('Ready', buckets.ready), line('In active plan', buckets.promoted_to_plan)].filter(Boolean).join('\n') || '(all discarded)';
  },
  initiatives_by_backlog_state(ctx) {
    const inits = ctx?.initiatives || [];
    if (!inits.length) return '(no initiatives yet)';
    const buckets = { untriaged: [], ready: [], promoted_to_plan: [], discarded: [] };
    inits.forEach(i => (buckets[i.backlog_state || 'untriaged'] || (buckets.untriaged = buckets.untriaged || [])).push(i));
    const line = (label, arr) => arr.length ? `- **${label} (${arr.length})**: ${arr.slice(0, 8).map(i => `"${i.title || i.id}"`).join('; ')}${arr.length > 8 ? ` … +${arr.length - 8}` : ''}` : null;
    return [line('Untriaged', buckets.untriaged), line('Ready', buckets.ready), line('In active plan', buckets.promoted_to_plan)].filter(Boolean).join('\n') || '(all discarded)';
  },
  primary_kpis(ctx) {
    const kpis = (ctx?.kpis || []).filter(k => k.priority === 'primary' || k.category === 'north_star');
    if (!kpis.length) return '(none configured — flag this to the operator if it seems relevant)';
    return kpis.map(k => `- \`${k.id}\` · "${k.name}" [${k.unit || '?'}]${k.target != null ? ` · target ${k.target}` : ''}`).join('\n');
  },
  recent_memos_15(ctx) {
    const memos = (ctx?.memos || []).slice(-15);
    if (!memos.length) return '(none)';
    return memos.map(m => `- [${m.level || 'misc'}] ${(m.body || '').slice(0, 220)}`).join('\n');
  },
  plan_detail(ctx, extras) {
    // Renders one specific plan (id from extras.plan_id or extras.related_id)
    // with its goals + initiatives + linked tasks. Used by the iterate_plan
    // skill so the agent gets the full plan state without re-reading files.
    const planId = extras?.plan_id || extras?.related_id;
    if (!planId) return '(no plan_id in context — bug)';
    const plan = (ctx?.plans || []).find(p => p.id === planId);
    if (!plan) return `(plan ${planId} not found)`;
    const goals = (plan.goal_ids || []).map(gid => (ctx?.goals || []).find(g => g.id === gid)).filter(Boolean);
    const inits = (plan.initiative_ids || []).map(iid => (ctx?.initiatives || []).find(i => i.id === iid)).filter(Boolean);
    const L = [];
    L.push(`**${plan.title || '(untitled)'}** · id \`${plan.id}\` · status \`${plan.status}\``);
    L.push(`period: ${plan.period_start || '?'} → ${plan.period_target_end || '?'}`);
    if (plan.rationale) L.push(`\nrationale: ${plan.rationale}`);
    L.push(`\n### Goals (${goals.length})`);
    if (goals.length) {
      goals.forEach(g => {
        L.push(`- ${g.id} · "${g.title}"${g.kpi_id ? ` · KPI \`${g.kpi_id}\`` : ''}${g.target_value != null ? ` · target ${g.target_value}` : ''}${g.target_date ? ` by ${g.target_date}` : ''}`);
      });
    } else {
      L.push('(none — plan has no explicit goals)');
    }
    L.push(`\n### Initiatives (${inits.length})`);
    if (inits.length) {
      inits.forEach(i => {
        const tasks = (ctx?.tasks || []).filter(t => t.advances_initiative === i.id);
        L.push(`- **${i.title}** \`${i.id}\``);
        if (i.active_hypothesis) L.push(`    hypothesis: ${i.active_hypothesis}`);
        if (i.success_criterion) L.push(`    success: ${i.success_criterion}`);
        tasks.forEach(t => L.push(`    · ${t.status || 'proposed'} · ${t.title} \`${t.id}\``));
      });
    } else {
      L.push('(none)');
    }
    return L.join('\n');
  },
  open_tasks(ctx) {
    // True orphans only: no advances_initiative AND no advances_plan AND
    // not in a terminal status. Every well-formed task lives under an
    // initiative, so this list should normally be empty — anything here
    // is a legacy artifact or a bug worth flagging.
    const TERMINAL = new Set(['done', 'closed', 'completed', 'cancelled', 'rejected']);
    const orphans = (ctx?.tasks || []).filter(t =>
      !TERMINAL.has((t.status || '').toLowerCase()) &&
      !t.advances_initiative &&
      !t.advances_plan
    );
    if (!orphans.length) return '(none — every open task has an initiative, as it should)';
    return orphans.slice(0, 25).map(t => `- \`${t.id}\` · ${t.title || '(untitled)'}`).join('\n') + (orphans.length > 25 ? `\n(+ ${orphans.length - 25} more)` : '');
  },
};

// ------- Public API -------

// Load the registry index. Callers rarely need this — invokeSkill handles it.
export async function listSkills() {
  const idx = await loadIndex();
  return idx.skills || [];
}

// The single entry point. Resolves the skill, dispatches by kind.
//   id      — skill id (matches manifest.id)
//   ctx     — the current planning context ({goals, initiatives, tasks, kpis, memos, plans})
//   opts    — { bu, bu_label, agent_id, onChange, sourceEl }
//              bu is required. bu_label defaults to bu.
//              For agent_session/agent_task, agent_id is resolved from
//              agent_bindings if not provided.
export async function invokeSkill(id, ctx, opts = {}) {
  let manifest;
  try { manifest = await loadManifest(id); }
  catch (e) {
    console.error('[skills] invokeSkill: manifest load failed', id, e);
    await showAlert(`Could not load skill "${id}": ${e.message || e}. Check that /api/substrate allows dashboard/public/data/skills/ and that the manifest file exists.`);
    return { error: 'manifest_load_failed', detail: e.message };
  }

  // Confirm dialog (if manifest asks). Skip if opts.skipConfirm.
  if (manifest.confirms && !opts.skipConfirm) {
    const body = interpolate(manifest.confirm_body || `Invoke skill "${manifest.name}"?`, {
      bu: opts.bu || '',
      bu_label: opts.bu_label || opts.bu || '',
      agent_id: opts.agent_id || '',
    });
    if (!await showConfirm(body)) return { cancelled: true };
  }

  try {
    switch (manifest.kind) {
      case 'agent_session':  return await runAgentSession(manifest, ctx, opts);
      case 'agent_task':     return await runAgentTask(manifest, ctx, opts);
      case 'deterministic':  return await runDeterministic(manifest, ctx, opts);
      default:
        await showAlert(`Unknown skill kind "${manifest.kind}" on skill "${id}".`);
        return { error: 'unknown_kind' };
    }
  } catch (e) {
    console.error('[skills] invokeSkill dispatch failed', id, e);
    await showAlert(`Skill "${manifest.name || id}" failed: ${e.message || e}`);
    return { error: 'dispatch_failed', detail: e.message };
  }
}

async function runAgentSession(manifest, ctx, opts) {
  const bu = opts.bu;
  if (!bu) throw new Error('invokeSkill: opts.bu required');
  const agentId = opts.agent_id || await resolveAgent(bu, manifest.agent?.module_id);
  if (!agentId) {
    // resolveAgent already falls back to the Director when no module Stewart
    // is installed. If we're still here, the BU has neither Stewart nor
    // Director bound — the BU is not set up yet.
    await showAlert(`No agent bound to ${opts.bu_label || bu}. This BU has no Director or ${manifest.agent?.module_id || 'module'} Stewart installed yet.`);
    return { error: 'no_agent' };
  }
  const template = await loadPromptTemplate(manifest.id, manifest);
  const brief = renderPrompt(template, manifest, ctx, {
    bu, bu_label: opts.bu_label || bu, agent_id: agentId,
    plan_id: opts.plan_id || opts.related_item?.id,
    related_id: opts.related_id || opts.related_item?.id || opts.plan_id,
  });
  const title = interpolate(manifest.meeting?.title_template || manifest.name, {
    bu, bu_label: opts.bu_label || bu, agent_id: agentId,
  });
  // The SKILL.md becomes `skill_brief` — invisible system context for the
  // agent. The agent's visible first turn is `opening_prompt` — a short
  // greeting drawn from manifest.meeting.greeting (fallback: generic prompt).
  const greeting = interpolate(manifest.meeting?.greeting || 'Hi — what would you like to work on?', {
    bu, bu_label: opts.bu_label || bu, agent_id: agentId,
  });
  // Two mount modes:
  //   1. opts.mountHost = HTMLElement → mount the chat surface inline
  //      into that element (used by the plan detail overlay's Iterate flow).
  //   2. no mountHost → open docked panel (default; groom, generic skill
  //      sessions).
  if (opts.mountHost instanceof HTMLElement) {
    const meetingMod = await import('./meeting.js');
    const meeting = await meetingMod.createMeeting({
      bu,
      agent_id: agentId,
      title,
      purpose: manifest.meeting?.purpose || `skill:${manifest.id}`,
      opening_prompt: greeting,
      skill_brief: brief,
      related_item: { kind: 'skill', id: manifest.id, name: manifest.name, ...(opts.related_item || {}) },
    });
    if (!meeting) return { error: 'meeting_create_failed' };
    meetingMod.mountChatSurface(opts.mountHost, meeting, { bu, mode: 'overlay' });
    return { ok: true, inline: true, meeting };
  }
  const mod = await import('./chat-dock.js');
  mod.openChatDocked({
    bu,
    agent_id: agentId,
    label: title,
    kind: 'agent',
    tab_id: `skill-${manifest.id}-${bu}`,
    purpose: manifest.meeting?.purpose || `skill:${manifest.id}`,
    opening_prompt: greeting,
    skill_brief: brief,
    related_item: { kind: 'skill', id: manifest.id, name: manifest.name, ...(opts.related_item || {}) },
    fresh: true,
  });
  return { ok: true, docked: true };
}

async function runAgentTask(manifest, ctx, opts) {
  const bu = opts.bu;
  if (!bu) throw new Error('invokeSkill: opts.bu required');
  if (!manifest.endpoint?.path) throw new Error(`Skill "${manifest.id}" has no endpoint.path`);
  const btn = opts.sourceEl;
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'working…'; }
  try {
    const resp = await fetch(manifest.endpoint.path, {
      method: manifest.endpoint.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bu, ...(opts.body || {}) }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) throw new Error(json.message || `HTTP ${resp.status}`);
    if (btn) btn.textContent = '✓ done';
    if (opts.onChange) opts.onChange();
    return { ok: true, response: json };
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
    }
    await showAlert(`Skill "${manifest.name}" failed: ${e.message || 'unknown'}`);
    return { error: e.message };
  }
}

async function runDeterministic(manifest, ctx, opts) {
  const handler = handlerRegistry.get(manifest.handler);
  if (!handler) {
    await showAlert(`Skill "${manifest.id}" has no handler registered for "${manifest.handler}". Call registerHandler at boot.`);
    return { error: 'no_handler' };
  }
  return await handler(ctx, opts);
}

// ------- Helpers -------

async function resolveAgent(bu, moduleId) {
  if (!moduleId) return null;
  try {
    const raw = await fetchSubstrateJson('dashboard/public/data/system/agent_bindings.json', []);
    const list = Array.isArray(raw) ? raw : (raw?.bindings || []);
    // Preferred: exact module binding for this BU (Stewart installed).
    const match = list.find(b => b.bu === bu && b.module_id === moduleId);
    if (match?.agent_id) return match.agent_id;
    // Module-fallback: when no Stewart is installed for `moduleId` on this BU,
    // the Director covers at basic fidelity (per Director archetype IDENTITY
    // + Genus Agent v1.0 spec). Route the skill to the Director so planning /
    // finance / product / etc. still work on a bare install.
    const director = list.find(b => b.bu === bu && (b.archetype === 'Director' || b.module_id === 'core'));
    return director?.agent_id || null;
  } catch {
    return null;
  }
}

function interpolate(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (m, key) => (vars[key] ?? m));
}

// Expose reload() for DevTools when tweaking skills without a page refresh.
if (typeof window !== 'undefined') {
  window.__skillsRegistry = {
    reload() { indexCache = null; manifestCache.clear(); promptCache.clear(); console.log('[skills] caches cleared'); },
    listCached() { return { index: indexCache, manifests: [...manifestCache.keys()], prompts: [...promptCache.keys()] }; },
  };
}
