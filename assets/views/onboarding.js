// Roadmap i40 — chat-driven onboarding view.
// Route: #onboarding

import { escapeHtml, currentBu } from './workflows/_shared.js';

const TOPICS = [
  { id: 1, key: 'setup',        label: 'Set up' },
  { id: 2, key: 'capabilities', label: 'What Genus can do' },
  { id: 3, key: 'assets',       label: 'Analyze and organise assets' },
  { id: 4, key: 'tools',        label: 'Work with existing software' },
  { id: 5, key: 'workflows',    label: 'Automate workflows' },
  { id: 6, key: 'tasks',        label: 'Manage execution' },
  { id: 7, key: 'closing',      label: 'Closing — describe-back' },
];

export async function renderOnboarding() {
  const root = document.getElementById('route-onboarding');
  if (!root) return;
  const bu = currentBu();
  root.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa1ae;">Loading onboarding…</div>';

  // Load current state (or null if not started)
  let state = null;
  try {
    const res = await fetch(`/api/onboarding?bu=${encodeURIComponent(bu)}`, { credentials: 'include' });
    const j = await res.json();
    if (res.ok && j.ok) state = j.state;
  } catch (_) {}

  const current = state?.current_topic || 1;
  const completed = new Set(state?.completed_topics || []);
  const skipped = new Set(state?.skipped_topics || []);

  const railLine = (t) => {
    let color = '#9aa1ae', copy = 'not started';
    if (completed.has(t.id)) { color = '#238c46'; copy = 'done'; }
    else if (skipped.has(t.id)) { color = '#5b6270'; copy = 'skipped'; }
    else if (t.id === current) { color = '#d69a2b'; copy = 'in progress'; }
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(20,22,28,.06);">
      <span style="width:9px;height:9px;border-radius:99px;background:${color};margin-top:6px;flex-shrink:0;"></span>
      <div style="flex:1;">
        <div style="font-size:12.5px;font-weight:600;color:#16181e;">${escapeHtml(t.label)}</div>
        <div style="font-size:11px;color:${color};margin-top:2px;">${escapeHtml(copy)}</div>
      </div>
    </div>`;
  };

  root.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 380px;min-height:calc(100vh - 100px);gap:0;">
      <div style="padding:32px 40px;background:#fbfbfa;display:flex;flex-direction:column;">
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--accent);text-transform:uppercase;margin-bottom:10px;">GENUS · ONBOARDING</div>
        <h1 style="font-size:32px;font-weight:800;letter-spacing:-.025em;margin:0 0 12px;line-height:1.05;">Welcome to Genus.</h1>
        <div style="font-size:15px;color:#3a3f4a;line-height:1.55;margin-bottom:28px;max-width:600px;">Genus is the dashboard + cockpit for running AI-augmented businesses. We'll do this as a conversation — open the Genus chat below and walk through 7 short topics together. You can skip any at any time; the rail on the right tracks what we've covered.</div>

        <div style="background:#fff;border:1px solid rgba(20,22,28,.08);border-radius:14px;padding:22px 26px;max-width:600px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;margin-bottom:10px;">Ready when you are</div>
          <div style="font-size:14px;color:#16181e;margin-bottom:14px;line-height:1.5;">Click below to start the Genus chat. Genus Agent will greet you and take it from there.</div>
          <button type="button" id="onboarding-start-btn" style="padding:11px 22px;background:#16181e;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;">
            ${state ? 'Continue where we left off →' : 'Start onboarding →'}
          </button>
          ${state ? `<div style="margin-top:10px;font-size:11.5px;color:#9aa1ae;">Started ${escapeHtml((state.started_at || '').slice(0,10))} · on topic ${state.current_topic} of ${TOPICS.length}</div>` : ''}
        </div>
      </div>

      <aside style="background:#fbfbfa;border-left:1px solid rgba(20,22,28,.08);padding:32px 0 20px;">
        <div style="padding:0 20px 12px;">
          <div style="font:600 10px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#aab0bb;text-transform:uppercase;">Readiness rail</div>
          <div style="font-size:12.5px;color:#5b6270;margin-top:3px;">${completed.size + skipped.size} of ${TOPICS.length} settled</div>
        </div>
        ${TOPICS.map(railLine).join('')}
      </aside>
    </div>
  `;

  document.getElementById('onboarding-start-btn')?.addEventListener('click', async () => {
    // Start onboarding record if not yet started
    if (!state) {
      try {
        await fetch('/api/onboarding', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bu, action: 'start' }),
        });
      } catch (_) {}
    }
    // Open the Genus chat via the dock
    try {
      const dock = await import('../chat-dock.js');
      dock.mountChatDock();
      // Simulate clicking the Genus tab to open the meeting
      document.getElementById('chat-tab-genus')?.click();
    } catch (e) { console.warn('open genus chat', e); }
  });
}
