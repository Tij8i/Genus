// Scheduled-meeting nudger.
//
// Polls the current BU's meetings.json every 60s. When a meeting has
// status='scheduled' and scheduled_at within the next 15 min, shows a
// top-of-screen banner so the operator doesn't miss it.
//
// Operator actions:
//   Start now → routes through the meeting flow (opens the docked panel).
//   Snooze 5m → hides the banner for 5 minutes (localStorage).
//   Dismiss   → hides the banner for this meeting until either the
//               meeting starts or its scheduled_at moves.

import { fetchSubstrateJson, substrateBase } from './substrate-client.js';
import { currentBu, escapeHtml } from './views/workflows/_shared.js';

const POLL_MS = 60_000;
const LEAD_MIN = 15;            // show banner starting 15 min before scheduled_at
const SNOOZE_MIN = 5;
const STORE_KEY = 'genus.scheduled-nudger.state';

let pollTimer = null;
let mounted = false;

function loadDismissals() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}

function saveDismissals(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}

// Return the meeting to nudge for right now, or null. Picks the earliest
// scheduled meeting whose scheduled_at is within [-1h, +LEAD_MIN min] and
// hasn't been dismissed for this run.
function pickNudgeCandidate(meetings) {
  const now = Date.now();
  const dismissals = loadDismissals();
  const cutoff_early = now - 60 * 60 * 1000;          // 1h grace for missed meetings
  const cutoff_late  = now + LEAD_MIN * 60 * 1000;
  const eligible = (meetings || []).filter(m => {
    if (m.status !== 'scheduled') return false;
    if (!m.scheduled_at) return false;
    const t = new Date(m.scheduled_at).getTime();
    if (Number.isNaN(t)) return false;
    if (t < cutoff_early || t > cutoff_late) return false;
    const key = `m:${m.id}`;
    const dis = dismissals[key];
    // dismissal shape: { until: ISO } — hide until that time passes
    if (dis?.until && new Date(dis.until).getTime() > now) return false;
    return true;
  });
  eligible.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  return eligible[0] || null;
}

function formatWhen(iso) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((t - now) / 60000);
  if (diffMin > 1) return `in ${diffMin} min`;
  if (diffMin === 1) return 'in 1 min';
  if (diffMin === 0) return 'now';
  if (diffMin > -5) return `${-diffMin} min ago`;
  return `${-diffMin} min late`;
}

function renderBanner(m) {
  let host = document.getElementById('scheduled-nudger-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'scheduled-nudger-host';
    host.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:70;pointer-events:none;';
    document.body.appendChild(host);
  }
  const when = formatWhen(m.scheduled_at);
  const isLate = new Date(m.scheduled_at).getTime() < Date.now();
  const tint = isLate ? '#c78500' : '#3468d6';
  host.innerHTML = `
    <div style="pointer-events:auto;background:#fff;border:1px solid rgba(20,22,28,.14);border-left:4px solid ${tint};border-radius:10px;box-shadow:0 8px 32px rgba(20,22,28,.18);padding:12px 16px;display:flex;align-items:center;gap:14px;max-width:640px;font-family:inherit;">
      <div style="font-size:20px;line-height:1;">🕐</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11.5px;font-weight:700;color:${tint};letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px;">Scheduled meeting · ${escapeHtml(when)}</div>
        <div style="font-size:13.5px;font-weight:600;color:#16181e;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.title || 'Meeting')}</div>
        <div style="font-size:11.5px;color:#5b6270;margin-top:2px;">${escapeHtml(m.agent_id || 'agent')} · ${escapeHtml(m.purpose || 'meeting')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button type="button" id="sched-nudge-start" style="padding:7px 12px;font-size:12px;font-weight:600;background:${tint};color:#fff;border:none;border-radius:7px;cursor:pointer;">Start now</button>
        <button type="button" id="sched-nudge-snooze" title="Hide for ${SNOOZE_MIN} minutes" style="padding:7px 10px;font-size:12px;font-weight:600;background:#fbfbfa;color:#5b6270;border:1px solid rgba(20,22,28,.14);border-radius:7px;cursor:pointer;">Snooze</button>
        <button type="button" id="sched-nudge-dismiss" title="Dismiss until scheduled_at moves" style="padding:7px 10px;font-size:12px;font-weight:600;background:transparent;color:#9aa1ae;border:none;border-radius:7px;cursor:pointer;">✕</button>
      </div>
    </div>
  `;
  document.getElementById('sched-nudge-start')?.addEventListener('click', async () => {
    // Open the docked chat with this meeting. Simpler + safer than trying to
    // rehydrate the scheduled meeting's ID directly — the operator can pick
    // up from a fresh conversation with the same agent.
    try {
      const { openChatDocked } = await import('./chat-dock.js');
      openChatDocked({
        bu: currentBu(),
        agent_id: m.agent_id || 'genus-agent',
        label: m.title || 'Meeting',
        purpose: m.purpose || 'scheduled-meeting',
        opening_prompt: `The operator opened this scheduled meeting: ${m.title}. Purpose: ${m.purpose || 'general'}. Greet briefly and confirm the agenda.`,
        fresh: true,
      });
    } catch (_) {}
    dismissMeeting(m, /*durationMin*/ null);  // final dismissal — meeting is "started"
  });
  document.getElementById('sched-nudge-snooze')?.addEventListener('click', () => {
    dismissMeeting(m, SNOOZE_MIN);
  });
  document.getElementById('sched-nudge-dismiss')?.addEventListener('click', () => {
    dismissMeeting(m, null);
  });
}

function hideBanner() {
  const host = document.getElementById('scheduled-nudger-host');
  if (host) host.innerHTML = '';
}

function dismissMeeting(m, durationMin) {
  const s = loadDismissals();
  const key = `m:${m.id}`;
  if (durationMin == null) {
    // Final dismissal — pin to the meeting's scheduled_at + 1h so it never
    // reappears until the operator reschedules.
    const until = new Date(new Date(m.scheduled_at).getTime() + 60 * 60 * 1000).toISOString();
    s[key] = { until, scheduled_at: m.scheduled_at };
  } else {
    const until = new Date(Date.now() + durationMin * 60 * 1000).toISOString();
    s[key] = { until, scheduled_at: m.scheduled_at };
  }
  saveDismissals(s);
  hideBanner();
}

// Clean out dismissals whose scheduled_at moved (rescheduled meeting → the
// operator should see the new nudge). Called on each poll.
function purgeStaleDismissals(meetings) {
  const s = loadDismissals();
  const byId = new Map((meetings || []).map(m => [m.id, m]));
  let changed = false;
  for (const key of Object.keys(s)) {
    if (!key.startsWith('m:')) continue;
    const mid = key.slice(2);
    const m = byId.get(mid);
    if (!m || m.status !== 'scheduled') { delete s[key]; changed = true; continue; }
    if (s[key].scheduled_at && s[key].scheduled_at !== m.scheduled_at) {
      delete s[key]; changed = true;
    }
  }
  if (changed) saveDismissals(s);
}

async function tick() {
  const bu = currentBu();
  if (!bu) return;
  const path = `${substrateBase(bu)}/meetings.json`;
  const meetings = await fetchSubstrateJson(path, []);
  purgeStaleDismissals(meetings);
  const candidate = pickNudgeCandidate(meetings);
  if (candidate) renderBanner(candidate);
  else hideBanner();
}

export function mountScheduledNudger() {
  if (mounted) return;
  mounted = true;
  // Fire on mount + on visibility restore so a returning operator sees the
  // banner immediately rather than waiting for the next poll.
  tick();
  pollTimer = setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
