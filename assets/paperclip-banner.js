// First-run Paperclip onboarding banner.
//
// A fresh Docker install starts Paperclip in a container but the
// `paperclipai onboard` step (which creates the Agent JWT that Genus needs to
// push tasks + drive agents) has to be run once by the operator via
// `docker compose exec paperclip npx paperclipai onboard`. If skipped, the
// dashboard looks broken: task-push errors, chat errors. The install guide
// covers this in Step 5 (post PR #30) but operators skim.
//
// This module probes /api/paperclip-status on boot and surfaces a sticky top
// banner with a copy-paste-ready command when Paperclip isn't onboarded.
// Dismiss is remembered per browser via localStorage, so once the operator
// runs the command (or if their install doesn't need it), the banner goes
// away and doesn't come back.

const DISMISS_KEY = 'genus.paperclip_onboard_dismissed';
const BANNER_ID = 'paperclip-onboard-banner';

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; }
  catch { return false; }
}

function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); }
  catch { /* private mode — banner comes back next visit; acceptable */ }
}

function ensureStyle() {
  if (document.getElementById('paperclip-banner-style')) return;
  const el = document.createElement('style');
  el.id = 'paperclip-banner-style';
  el.textContent = `
    #${BANNER_ID} {
      position: sticky;
      top: 0;
      z-index: 250;
      background: linear-gradient(90deg, #fff7db 0%, #ffeaa8 100%);
      color: #4b3f00;
      border-bottom: 1px solid #e0b820;
      font-size: 13px;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #${BANNER_ID} .pb-title { font-weight: 700; }
    #${BANNER_ID} .pb-cmd {
      font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
      background: rgba(0, 0, 0, 0.08);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      user-select: all;
    }
    #${BANNER_ID} .pb-btn {
      background: #4b3f00;
      color: #fff;
      border: none;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
    }
    #${BANNER_ID} .pb-btn:hover { background: #6a5a00; }
    #${BANNER_ID} .pb-btn-ghost {
      background: transparent;
      color: #4b3f00;
      border: 1px solid rgba(75, 63, 0, 0.35);
    }
    #${BANNER_ID} .pb-btn-ghost:hover { background: rgba(0, 0, 0, 0.06); }
    #${BANNER_ID} .pb-spacer { flex: 1; }
    #${BANNER_ID} .pb-reason { color: #6a5a00; font-size: 12px; }
  `;
  document.head.appendChild(el);
}

function renderBanner({ hint, reason }) {
  ensureStyle();
  // Remove any prior banner so we always render the latest state.
  const prior = document.getElementById(BANNER_ID);
  if (prior) prior.remove();

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span class="pb-title">🖇️ Finish Paperclip setup</span>
    <span class="pb-reason">${reason || 'Agents can\'t run until Paperclip has been onboarded once.'}</span>
    <code class="pb-cmd" title="Run this in a new terminal">${hint}</code>
    <span class="pb-spacer"></span>
    <button class="pb-btn" data-role="copy">Copy command</button>
    <button class="pb-btn pb-btn-ghost" data-role="dismiss">Dismiss</button>
  `;

  const copyBtn = banner.querySelector('[data-role="copy"]');
  const dismissBtn = banner.querySelector('[data-role="dismiss"]');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(hint);
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 1600);
    } catch {
      // Fallback: select the code element for manual copy
      const range = document.createRange();
      range.selectNode(banner.querySelector('.pb-cmd'));
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      copyBtn.textContent = 'Select+Copy';
    }
  });

  dismissBtn.addEventListener('click', () => {
    markDismissed();
    banner.remove();
  });

  // Insert at the top of <body> so it stays visible regardless of the current
  // route or view layout.
  document.body.insertBefore(banner, document.body.firstChild);
}

// Boot entry — fire-and-forget from app.js's boot(). Silent on any failure
// so the dashboard load isn't blocked by this probe.
export async function checkPaperclipOnboarding() {
  if (dismissed()) return;
  try {
    const r = await fetch('/api/paperclip-status', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || j.ok !== true) return;
    if (j.onboarded === true) return;   // confirmed onboarded — no banner
    if (!j.hint) return;                 // no actionable hint — silent
    renderBanner({ hint: j.hint, reason: j.hint_reason });
  } catch {
    // Endpoint missing (older install, Cloudflare Pages deploy without the
    // server/api handler) — no banner, no error.
  }
}
