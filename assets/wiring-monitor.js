// Wiring monitor — polls /api/wiring-status every 30s, shows a sticky top
// banner when any probe is bad/warn, and broadcasts a 'wiring-updated' event
// so the Settings → Wiring tab can render dots from a single source of truth
// (rather than triggering its own fetch on tab open).
//
// Cost: 2 localhost HTTP calls + 1 fs.stat per tick, ~30ms wall-clock, $0.
// Polling stops when the tab is hidden (Page Visibility API) to save CPU on
// backgrounded windows. Silent no-op on the Cloudflare Pages edge deploy —
// the endpoint returns probes_available:false so nothing shows.
//
// Consumers (settings.js) subscribe via:
//   window.addEventListener('wiring-updated', ev => { ev.detail.probes ... });
// and can read the latest snapshot at any time from window.__genusWiringState.

const POLL_INTERVAL_MS = 30_000;
const BANNER_ID = 'wiring-alert-banner';
const STYLE_ID = 'wiring-alert-banner-style';
const DISMISS_KEY = 'genus.wiring_alert_dismissed_signature';

let pollTimer = null;
let inFlight = false;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    #${BANNER_ID} {
      position: sticky;
      top: 0;
      z-index: 249;
      font-size: 13px;
      padding: 9px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-family: system-ui, -apple-system, sans-serif;
      border-bottom: 1px solid;
    }
    #${BANNER_ID}.wiring-alert-bad {
      background: linear-gradient(90deg, #ffdede 0%, #ffb8b8 100%);
      color: #6b1616;
      border-bottom-color: #d64040;
    }
    #${BANNER_ID}.wiring-alert-warn {
      background: linear-gradient(90deg, #fff7db 0%, #ffeaa8 100%);
      color: #4b3f00;
      border-bottom-color: #e0b820;
    }
    #${BANNER_ID} .wa-title { font-weight: 700; }
    #${BANNER_ID} .wa-detail { color: inherit; opacity: .85; font-size: 12.5px; }
    #${BANNER_ID} .wa-spacer { flex: 1; }
    #${BANNER_ID} .wa-btn {
      background: transparent;
      color: inherit;
      border: 1px solid currentColor;
      padding: 4px 11px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
      opacity: .85;
    }
    #${BANNER_ID} .wa-btn:hover { opacity: 1; background: rgba(0,0,0,0.06); }
  `;
  document.head.appendChild(el);
}

function summariseProbes(probes) {
  // Build a stable signature so a dismissed banner only reappears when the
  // underlying failure set changes (not on every 30s tick).
  const failing = Object.entries(probes)
    .filter(([_, p]) => p.status === 'bad' || p.status === 'warn')
    .map(([name, p]) => ({ name, status: p.status, message: p.message || '' }));
  return {
    failing,
    severity: failing.some(f => f.status === 'bad') ? 'bad'
            : failing.length > 0 ? 'warn' : 'ok',
    signature: failing.map(f => `${f.name}:${f.status}`).sort().join('|'),
  };
}

function readDismissedSignature() {
  try { return localStorage.getItem(DISMISS_KEY) || ''; }
  catch { return ''; }
}

function writeDismissedSignature(sig) {
  try { localStorage.setItem(DISMISS_KEY, sig); } catch {}
}

function humanizeProbeName(name) {
  return {
    paperclip: 'Paperclip runtime',
    meeting_server: 'Meeting server',
    adapter: 'Adapter sync',
  }[name] || name;
}

function renderBanner(summary) {
  ensureStyle();
  const prior = document.getElementById(BANNER_ID);
  if (prior) prior.remove();

  if (summary.severity === 'ok') return;
  if (readDismissedSignature() === summary.signature) return;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.classList.add(summary.severity === 'bad' ? 'wiring-alert-bad' : 'wiring-alert-warn');
  banner.setAttribute('role', 'alert');

  const iconGlyph = summary.severity === 'bad' ? '⛔' : '⚠️';
  const titleText = summary.severity === 'bad'
    ? `Operating stack: ${summary.failing.length} service${summary.failing.length === 1 ? '' : 's'} down`
    : `Operating stack: ${summary.failing.length} service${summary.failing.length === 1 ? '' : 's'} degraded`;
  const detail = summary.failing
    .map(f => `${humanizeProbeName(f.name)} — ${f.message || f.status}`)
    .join(' · ');

  banner.innerHTML = `
    <span class="wa-title">${iconGlyph} ${escapeText(titleText)}</span>
    <span class="wa-detail">${escapeText(detail)}</span>
    <span class="wa-spacer"></span>
    <button class="wa-btn" data-role="open">Open Wiring</button>
    <button class="wa-btn" data-role="dismiss" title="Hide until the failure set changes">Dismiss</button>
  `;

  banner.querySelector('[data-role="open"]').addEventListener('click', () => {
    window.location.hash = '#settings?tab=wiring';
  });
  banner.querySelector('[data-role="dismiss"]').addEventListener('click', () => {
    writeDismissedSignature(summary.signature);
    banner.remove();
  });

  document.body.insertBefore(banner, document.body.firstChild);
}

function escapeText(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const resp = await fetch('/api/wiring-status', { credentials: 'include' });
    if (!resp.ok) return;
    const json = await resp.json();
    window.__genusWiringState = json;
    const probes = (json && json.probes) || {};
    const summary = summariseProbes(probes);

    // Fire an event so subscribers (Settings → Wiring tab) can refresh dots
    // without doing their own fetch. Includes raw json + computed summary.
    window.dispatchEvent(new CustomEvent('wiring-updated', {
      detail: { json, probes, summary, at: json.checked_at },
    }));

    // Only banner on the local Node deploy where probes are real. On the edge
    // deploy every probe is 'unknown' and we don't want to false-alarm.
    if (json.probes_available === true) renderBanner(summary);
  } catch {
    // Silent: unreachable local server / network hiccup shouldn't spam.
  } finally {
    inFlight = false;
  }
}

function schedule() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    // Skip when the tab is backgrounded to save CPU + the operator can't see
    // the banner anyway.
    if (document.visibilityState === 'hidden') return;
    tick();
  }, POLL_INTERVAL_MS);
}

function unschedule() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export function startWiringMonitor() {
  tick();       // fire once at boot
  schedule();   // then every 30s
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      schedule();
    } else {
      unschedule();
    }
  });
}

// Manual retrigger — used by Settings → Wiring to fetch on tab open without
// waiting up to 30s for the next poll.
export function refreshWiringNow() {
  return tick();
}
