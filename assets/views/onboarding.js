// Roadmap i40 — chat-driven onboarding.
// Route: #onboarding
//
// v0.9 ships an interactive walkthrough: 6 topics in the left pane with
// operator answers appended to a running transcript; readiness rail on
// the right updates live as topics complete. Full agent-driven streaming
// chat is v1.0 (ties in with i108 dock + meeting-server chat).

import { escapeHtml, currentBu } from './workflows/_shared.js';

const TOPICS = [
  { id: 1, key: 'setup',        label: 'Set up',                       prompt: 'What are you building? A one-line thesis is enough — I\'ll follow up.' },
  { id: 2, key: 'capabilities', label: 'What Genus can do',            prompt: 'Tell me a bit about what you do day-to-day. I\'ll map that to what Genus already helps with, and suggest a first module to install.' },
  { id: 3, key: 'assets',       label: 'Analyze and organise assets',  prompt: 'Where does your knowledge live today? Google Drive, Notion, spreadsheets, docs on your Mac? Point me at the places.' },
  { id: 4, key: 'tools',        label: 'Work with existing software',  prompt: 'What tools do you already use? Gmail, Calendar, Slack, Notion, HubSpot, Miro — anything. I\'ll ask for access as it becomes useful.' },
  { id: 5, key: 'workflows',    label: 'Automate workflows',           prompt: 'What do you do repeatedly that a Steward could help with? Describe one loop — I\'ll file it as a workflow record.' },
  { id: 6, key: 'tasks',        label: 'Manage execution',             prompt: 'What\'s on your plate right now? Tasks you\'ve been putting off, follow-ups, decisions. I\'ll drop them into your task pool.' },
];

const TRANSCRIPT_KEY = 'genus.onboarding.transcript';

function loadTranscript() {
  try { return JSON.parse(localStorage.getItem(TRANSCRIPT_KEY) || '[]'); } catch { return []; }
}
function saveTranscript(t) { try { localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(t)); } catch (_) {} }

export async function renderOnboarding() {
  const root = document.getElementById('route-onboarding');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading…</div>';

  let state = null;
  try {
    const res = await fetch(`/api/onboarding?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    const j = await res.json();
    if (res.ok && j.ok) state = j.state;
  } catch (_) {}

  const current = state?.current_topic || 1;
  const completed = new Set(state?.completed_topics || []);
  const skipped = new Set(state?.skipped_topics || []);
  const transcript = loadTranscript();

  const isClosed = !!state?.closed_at;

  const railLine = (t) => {
    let color = '#9aa1ae', copy = 'not started';
    if (completed.has(t.id)) { color = '#238c46'; copy = 'done · you can task me with executing them'; }
    else if (skipped.has(t.id)) { color = '#5b6270'; copy = 'skipped by choice · say the word to revisit'; }
    else if (t.id === current) { color = '#d69a2b'; copy = 'in progress'; }
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(20,22,28,.06);">
      <span style="width:9px;height:9px;border-radius:99px;background:${color};margin-top:6px;flex-shrink:0;"></span>
      <div style="flex:1;">
        <div style="font-size:12.5px;font-weight:600;color:#16181e;">${escapeHtml(t.label)}</div>
        <div style="font-size:11px;color:${color};margin-top:2px;line-height:1.35;">${escapeHtml(copy)}</div>
      </div>
    </div>`;
  };

  const activeTopic = TOPICS.find(t => t.id === current) || TOPICS[TOPICS.length - 1];
  const settled = completed.size + skipped.size;

  root.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 380px;min-height:calc(100vh - 100px);gap:0;">
      <!-- Chat pane -->
      <div style="padding:24px 40px;background:#fbfbfa;display:flex;flex-direction:column;">
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--accent);text-transform:uppercase;margin-bottom:8px;">GENUS · ONBOARDING</div>
        <h1 style="font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0 0 6px;line-height:1.05;">${isClosed ? 'You\'re all set.' : 'Let\'s get you set up.'}</h1>
        <div style="font-size:13.5px;color:#3a3f4a;line-height:1.55;margin-bottom:18px;max-width:640px;">${isClosed ? 'Chat with Genus anytime from the dock at the bottom-right.' : 'This is the beginning of one continuous conversation you\'ll have with Genus. Rail on the right tracks where we are. You can skip any topic and come back.'}</div>

        <!-- Transcript so far -->
        <div style="flex:1;overflow-y:auto;padding-right:6px;">
          ${transcript.map(m => renderMessage(m)).join('')}
          ${!isClosed ? `<div style="margin-top:12px;padding:16px 20px;background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:12px;max-width:640px;box-shadow:0 1px 3px rgba(20,22,28,.03);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="width:24px;height:24px;border-radius:99px;background:#16181e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">G</span>
              <span style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;">Genus · topic ${activeTopic.id} of ${TOPICS.length}</span>
            </div>
            <div style="font-size:14px;color:#16181e;line-height:1.55;margin-bottom:12px;">${escapeHtml(activeTopic.prompt)}</div>
            <textarea id="onb-input" placeholder="Type your answer, or click Skip to come back to this later…" rows="3" style="width:100%;padding:10px 12px;border:1px solid rgba(20,22,28,.12);border-radius:8px;font-family:inherit;font-size:13px;line-height:1.5;color:#16181e;resize:vertical;box-sizing:border-box;"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
              <button type="button" id="onb-skip"  style="padding:8px 14px;background:transparent;color:#5b6270;border:1px solid rgba(20,22,28,.14);border-radius:8px;font:600 12.5px inherit;cursor:pointer;">Skip for now</button>
              <button type="button" id="onb-next"  style="padding:8px 16px;background:#16181e;color:#fff;border:none;border-radius:8px;font:600 12.5px inherit;cursor:pointer;">Answer → Next topic</button>
            </div>
          </div>` : `<div style="margin-top:20px;padding:20px 24px;background:#fff;border:1px solid rgba(35,140,70,.20);border-radius:12px;max-width:640px;"><div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#238c46;text-transform:uppercase;margin-bottom:6px;">✓ Onboarding closed</div><div style="font-size:13.5px;color:#3a3f4a;">Welcome. Open the Genus dock (bottom-right) whenever you want to talk.</div></div>`}
        </div>
      </div>

      <!-- Readiness rail -->
      <aside style="background:#fbfbfa;border-left:1px solid rgba(20,22,28,.08);padding:24px 0 20px;">
        <div style="padding:0 20px 12px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;">Readiness rail</div>
          <div style="font-size:12.5px;color:#5b6270;margin-top:3px;">${settled} of ${TOPICS.length} settled</div>
        </div>
        ${TOPICS.map(railLine).join('')}
        ${settled === TOPICS.length && !isClosed ? `<div style="padding:16px 20px;"><button type="button" id="onb-close" style="width:100%;padding:11px 16px;background:#238c46;color:#fff;border:none;border-radius:9px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">That's us — take over ↗</button></div>` : ''}
      </aside>
    </div>
  `;

  // Wire actions
  document.getElementById('onb-next')?.addEventListener('click', async () => {
    const input = document.getElementById('onb-input');
    const answer = (input?.value || '').trim();
    if (!answer) { input?.focus(); return; }
    // Ensure onboarding record exists
    if (!state) {
      try {
        const res = await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bu, action: 'start' }) });
        const j = await res.json();
        state = j?.state;
      } catch (_) {}
    }
    // Persist the answer to transcript
    transcript.push({ role: 'agent', body: activeTopic.prompt, topic: activeTopic.id });
    transcript.push({ role: 'operator', body: answer, topic: activeTopic.id });
    saveTranscript(transcript);
    // Advance topic
    await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bu, action: 'advance_topic', topic_id: activeTopic.id }) });
    await renderOnboarding();
  });

  document.getElementById('onb-skip')?.addEventListener('click', async () => {
    if (!state) {
      try {
        const res = await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bu, action: 'start' }) });
        const j = await res.json();
        state = j?.state;
      } catch (_) {}
    }
    transcript.push({ role: 'agent', body: activeTopic.prompt, topic: activeTopic.id });
    transcript.push({ role: 'operator', body: '(skipped for now)', topic: activeTopic.id, skipped: true });
    saveTranscript(transcript);
    await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bu, action: 'skip_topic', topic_id: activeTopic.id }) });
    await renderOnboarding();
  });

  document.getElementById('onb-close')?.addEventListener('click', async () => {
    if (!confirm('Close onboarding and land on the dashboard?')) return;
    await fetch('/api/onboarding', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bu, action: 'close' }) });
    location.hash = '#dashboard';
  });
}

function renderMessage(m) {
  if (m.role === 'agent') {
    return `<div style="display:flex;gap:10px;margin-bottom:14px;max-width:640px;">
      <span style="width:24px;height:24px;border-radius:99px;background:#16181e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;margin-top:2px;">G</span>
      <div style="flex:1;padding:10px 14px;background:#fff;border:1px solid rgba(20,22,28,.06);border-radius:12px;font-size:13px;color:#16181e;line-height:1.5;">${escapeHtml(m.body)}</div>
    </div>`;
  }
  return `<div style="display:flex;justify-content:flex-end;margin-bottom:14px;max-width:640px;margin-left:auto;">
    <div style="padding:10px 14px;background:#16181e;color:#fff;border-radius:12px;font-size:13px;line-height:1.5;max-width:80%;${m.skipped ? 'opacity:.55;font-style:italic;' : ''}">${escapeHtml(m.body)}</div>
  </div>`;
}
