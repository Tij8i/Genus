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
    if (renderer) slots[slotName] = renderer(ctx);
  }
  return template.replace(/\{(\w+)\}/g, (m, key) => (slots[key] ?? m));
}

function renderStandardSlots(ctx, extras) {
  return {
    bu: extras.bu || '',
    bu_label: extras.bu_label || extras.bu || '',
    agent_id: extras.agent_id || '',
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
    await showAlert(`No ${manifest.agent?.module_id || 'agent'} bound to ${opts.bu_label || bu}. Install the module first.`);
    return { error: 'no_agent' };
  }
  const template = await loadPromptTemplate(manifest.id, manifest);
  const brief = renderPrompt(template, manifest, ctx, {
    bu, bu_label: opts.bu_label || bu, agent_id: agentId,
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
  // Open docked (not full-screen overlay) so the operator can minimise it
  // and continue while navigating the rest of the dashboard. Uses a fresh
  // tab id per (skill, bu) pair so multiple concurrent skill sessions each
  // get their own dock tab (rather than resuming the previous one).
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
    // related_item lets us filter meetings by skill later (e.g.
    // "show me all backlog_grooming sessions").
    related_item: { kind: 'skill', id: manifest.id, name: manifest.name },
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
    const match = list.find(b => b.bu === bu && b.module_id === moduleId);
    return match?.agent_id || null;
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
