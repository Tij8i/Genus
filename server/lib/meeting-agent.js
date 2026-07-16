// Agent context assembly for the Docker meeting server.
//
// The launchd Python server reads deep IDENTITY / PLAYBOOK / DOMAIN_MODEL /
// substrate files from the Orchestrator repo mounted on the operator's Mac.
// The Docker install doesn't have that repo — it just has the Genus repo +
// bus/ substrate. This module builds a workable system prompt from what IS
// available in Docker:
//
//   • agent_bindings.json → archetype + role for this agent
//   • bus/<bu>/identity.json → what business the operator is running
//   • bus/<bu>/business_areas.json (if present) → what's in scope
//   • bus/<bu>/governance.json (if present) → operator's current gauge posture
//   • bus/<bu>/memos.jsonl (if present) → recent notes targeting this agent
//   • bus/<bu>/meetings.json → last N closed meetings with this agent
//
// Then wraps with a generic archetype preamble (Stewart / Genus Agent / Mason)
// so the model has a stable persona even without the operator's private docs.
//
// v0 spec: keep this small. Substrate injection stays under ~30KB total so
// the prompt fits alongside a growing transcript.

import { getFile } from '../storage/index.js';

const PAT = 'local-mode-no-pat';
const TOTAL_SUBSTRATE_BUDGET = 30_000;
const MEMOS_MAX = 8;
const MEMOS_BUDGET = 4_000;
const CLOSED_CHATS_MAX = 5;
const CLOSED_CHATS_BUDGET = 5_000;

const ARCHETYPE_TEMPLATES = {
  'Genus Agent': `You are the Genus Agent for this business unit. Your job is to help the operator model, monitor, and evolve the shape of their business. You do not run departments — that's what Stewart agents do when modules are installed. You do help the operator understand what modules they might want, what areas need coverage, and what to build next. You operate within the Genus framework and stay conversational, plain-English, concise.`,
  'Stewart': `You are a Stewart — the Operating Steward of a specific module within a business unit. You own the KPIs, workflows, and outcomes for your module. You have three modes: Monitor (surface state), Recommend (propose interventions), Execute (act within your authority envelope). You confidence-tag every output (✅ / ⚠️ / ❓). You stay concise, plain-English, and action-biased.`,
  'Mason': `You are a Mason — a specialist executor. You do NOT hold ongoing context or plan across sessions. You take a typed task, produce a typed output, and go idle. Stay focused on the specific job the operator or Stewart has handed you.`,
};

const DEFAULT_ARCHETYPE_PROMPT = `You are an AI agent inside a Genus installation. You help the operator run their business. Stay conversational, plain-English, concise.`;

function chatConversationRules(bu, agent_id) {
  return `\n\nGeneral rules for this chat:
- This is a real-time conversation, not a report. Respond in natural prose.
- Do NOT write headers, structured docs, or long bullet lists unless explicitly asked.
- Lead with the answer, then briefly explain if needed.
- Confidence-tag your claims when the answer isn't ✅ certain (⚠️ for uncertain, ❓ for speculation).
- You are talking to the operator about business unit '${bu}'. Your agent id is '${agent_id}'.
- You do NOT have the ability to file meetings, tasks, or write substrate on your own. Never claim to have done so, and never post links to records you haven't seen exist.`;
}

async function readJsonSafe(path) {
  try {
    const { content } = await getFile(PAT, path);
    return JSON.parse(content);
  } catch { return null; }
}

async function readTextSafe(path) {
  try {
    const { content } = await getFile(PAT, path);
    return content;
  } catch { return null; }
}

function projectValue(val, maxStr = 400, maxArr = 6) {
  if (typeof val === 'string') {
    return val.length > maxStr ? val.slice(0, maxStr) + `…[+${val.length - maxStr} chars]` : val;
  }
  if (Array.isArray(val)) {
    const head = val.slice(0, maxArr).map(x => projectValue(x, maxStr, maxArr));
    if (val.length > maxArr) head.push(`…[+${val.length - maxArr} more]`);
    return head;
  }
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = projectValue(v, maxStr, maxArr);
    return out;
  }
  return val;
}

function truncateToBudget(text, budget) {
  if (!text || text.length <= budget) return text || '';
  return text.slice(0, budget) + `\n…[+${text.length - budget} chars truncated]`;
}

async function resolveArchetype(agent_id) {
  const bindings = await readJsonSafe('dashboard/public/data/system/agent_bindings.json');
  if (!bindings || !Array.isArray(bindings.bindings)) return null;
  const short = String(agent_id || '').replace(/-of-[a-z0-9-]+$/, '');
  const matches = [agent_id, short];
  const found = bindings.bindings.find(b => matches.includes(b.agent_id));
  return found ? {
    archetype: found.archetype || null,
    module_id: found.module_id || null,
    docs_root: found.docs_root || null,
  } : null;
}

async function loadRecentMemos(bu, agent_id) {
  const raw = await readTextSafe(`dashboard/public/data/bus/${bu}/memos.jsonl`);
  if (!raw) return null;
  const short = String(agent_id || '').replace(/-of-[a-z0-9-]+$/, '');
  const matches = new Set([agent_id, short, '']);
  const rows = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const m = JSON.parse(s);
      const target = (m.target_agent || '').trim();
      if (target && !matches.has(target)) continue;
      rows.push(m);
    } catch { /* skip malformed line */ }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const picks = rows.slice(0, MEMOS_MAX);
  let out = '## Recent memos for you\n\nShort-form observations the operator (or another agent) filed for your attention.\n\n';
  let remaining = MEMOS_BUDGET;
  for (const m of picks) {
    const body = String(m.body || '').trim();
    if (!body) continue;
    const author = m.author || 'unknown';
    const created = (m.created_at || '?').slice(0, 10);
    const entry = `- **[${created}] ${author}**: ${body.length > 400 ? body.slice(0, 400) + '…' : body}\n`;
    if (entry.length > remaining) break;
    out += entry;
    remaining -= entry.length;
  }
  return out;
}

async function loadClosedChats(bu, agent_id) {
  const meetings = await readJsonSafe(`dashboard/public/data/bus/${bu}/meetings.json`);
  if (!Array.isArray(meetings)) return null;
  const short = String(agent_id || '').replace(/-of-[a-z0-9-]+$/, '');
  const matches = new Set([agent_id, short]);
  const closed = meetings.filter(m => matches.has(m.agent_id) && m.status === 'closed');
  if (!closed.length) return null;
  closed.sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''));
  const picks = closed.slice(0, CLOSED_CHATS_MAX);
  const perBudget = Math.max(400, Math.floor(CLOSED_CHATS_BUDGET / picks.length));
  const parts = ['## Recent closed conversations with you\n\nCompact summaries of your most recent closed meetings with this operator on this BU. Use as background; do not repeat these back unless directly relevant.\n'];
  for (const m of picks) {
    const transcript = Array.isArray(m.transcript) ? m.transcript : [];
    const firstOp = transcript.find(t => t.role === 'operator');
    const lastAgent = [...transcript].reverse().find(t => t.role !== 'operator');
    const summary = {
      id: m.id, title: m.title, purpose: m.purpose,
      closed_at: m.closed_at, expected_output: m.expected_output,
      opener_op: firstOp ? String(firstOp.content || '').slice(0, 300) : undefined,
      last_agent_reply: lastAgent ? String(lastAgent.content || '').slice(0, 400) : undefined,
    };
    for (const k of Object.keys(summary)) if (summary[k] === undefined) delete summary[k];
    parts.push('```json\n' + truncateToBudget(JSON.stringify(summary, null, 2), perBudget) + '\n```\n');
  }
  return parts.join('\n');
}

function meetingOwnership(meeting) {
  if (!meeting) return '';
  const purpose = meeting.purpose || 'general';
  const expected = meeting.expected_output || 'operator-stated';
  return `You own this meeting. Purpose: ${purpose}. Expected output: ${expected}. Stay on topic. If new threads surface that would derail this one, flag them ("worth a separate chat about X") and offer to note them — do NOT absorb them. When the operator asks to close, post a final recap: Recap · Decisions · Actions · Threads to follow up.\n\n`;
}

export async function buildSystemPrompt({ agent_id, bu, meeting }) {
  const binding = await resolveArchetype(agent_id);
  const archetype = binding?.archetype;
  const archetypeBlock = ARCHETYPE_TEMPLATES[archetype] || DEFAULT_ARCHETYPE_PROMPT;

  const identity = await readJsonSafe(`dashboard/public/data/bus/${bu}/identity.json`);
  const areas = await readJsonSafe(`dashboard/public/data/bus/${bu}/business_areas.json`);
  const governance = await readJsonSafe(`dashboard/public/data/bus/${bu}/governance.json`);

  const substrateParts = [];
  let remaining = TOTAL_SUBSTRATE_BUDGET;
  const push = (label, obj) => {
    if (!obj || remaining <= 0) return;
    const text = JSON.stringify(projectValue(obj), null, 2);
    const trimmed = truncateToBudget(text, Math.min(remaining, 8_000));
    substrateParts.push(`### ${label}\n\n\`\`\`json\n${trimmed}\n\`\`\``);
    remaining -= trimmed.length;
  };
  push(`bus/${bu}/identity.json`, identity);
  if (areas) push(`bus/${bu}/business_areas.json`, areas);
  if (governance) push(`bus/${bu}/governance.json`, governance);

  const memos = await loadRecentMemos(bu, agent_id);
  const closed = await loadClosedChats(bu, agent_id);

  const parts = [
    `${archetypeBlock}`,
    binding?.module_id ? `Module you're responsible for: ${binding.module_id}.` : '',
    meetingOwnership(meeting),
    chatConversationRules(bu, agent_id),
    '',
    '## Live dashboard state — reference during this chat',
    '',
    'Projected snapshot of what the operator sees on the Genus dashboard for this BU right now. Long descriptions may be truncated. Prefer these facts over anything you infer from prior sessions.',
    '',
    substrateParts.length ? substrateParts.join('\n\n') : '(no substrate loaded — this BU has minimal state)',
  ];
  if (memos) parts.push('---', memos);
  if (closed) parts.push('---', closed);

  return parts.filter(Boolean).join('\n');
}
