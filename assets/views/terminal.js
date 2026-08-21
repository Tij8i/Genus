// terminal-embed — embedded xterm.js terminal that drives the local
// meeting-server pty (POST /terminal/spawn → WebSocket).
//
// Contract: dashboard/public/data/system/features/terminal-embed/contract.md
// Verify:   dashboard/scripts/verify/terminal-embed.py
//
// Failure branches (both surfaced inline, never buried in the console):
//   - server offline  → banner "meeting-server offline" + Retry
//   - claude missing  → banner "claude not on PATH" + tried[] paths

const XTERM_JS_URL  = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
const XTERM_CSS_URL = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3101;
const SPAWN_URL   = `http://${SERVER_HOST}:${SERVER_PORT}/terminal/spawn`;

// The command mirrors the amendment default: open Claude Code in the
// Orchestrator repo with a "backlog grooming" opening prompt. Kept as a
// module const so operator can grep + swap once we per-page it.
const DEFAULT_CWD     = '/Users/AlessioTixi/Documents/GitHub/Orchestrator';
const DEFAULT_COMMAND = 'claude "backlog grooming"';

let xtermScriptPromise = null;

function loadXtermOnce() {
  if (xtermScriptPromise) return xtermScriptPromise;
  xtermScriptPromise = new Promise((resolve, reject) => {
    // Inject CSS (idempotent — check if already present)
    if (!document.querySelector(`link[data-xterm-css]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = XTERM_CSS_URL;
      link.dataset.xtermCss = '1';
      document.head.appendChild(link);
    }
    // Inject JS
    if (window.Terminal) return resolve(window.Terminal);
    const script = document.createElement('script');
    script.src = XTERM_JS_URL;
    script.onload = () => {
      if (window.Terminal) resolve(window.Terminal);
      else reject(new Error('xterm.js loaded but window.Terminal is undefined'));
    };
    script.onerror = () => reject(new Error(`failed to load xterm.js from ${XTERM_JS_URL}`));
    document.head.appendChild(script);
  });
  return xtermScriptPromise;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderOfflineBanner(root, extra) {
  root.innerHTML = `<div style="max-width:820px;margin:40px auto;padding:22px 26px;background:#fff;border:1px solid rgba(20,22,28,.10);border-left:4px solid #c12525;border-radius:10px;">
    <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#c12525;text-transform:uppercase;margin-bottom:6px;">Terminal unavailable</div>
    <h2 style="font-size:19px;font-weight:700;margin:0 0 8px;color:#16181e;">meeting-server offline</h2>
    <p style="font-size:13.5px;color:#5b6270;line-height:1.55;margin:0 0 14px;">Could not reach <code>http://${SERVER_HOST}:${SERVER_PORT}/terminal/spawn</code>. Start the local meeting-server:</p>
    <pre style="background:#f6f6f4;padding:10px 12px;border-radius:8px;font-size:12px;overflow:auto;margin:0 0 14px;color:#16181e;">python3 dashboard/scripts/genus_meeting_server.py</pre>
    ${extra ? `<div style="font-size:12px;color:#9aa1ae;margin-bottom:12px;">${escapeHtml(extra)}</div>` : ''}
    <button type="button" id="terminal-retry" style="padding:8px 16px;background:#3468d6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">Retry</button>
  </div>`;
  document.getElementById('terminal-retry')?.addEventListener('click', () => renderTerminal());
}

function renderClaudeMissingBanner(root, tried) {
  const triedList = Array.isArray(tried) && tried.length
    ? `<ul style="margin:0 0 14px;padding-left:22px;font-size:12.5px;color:#5b6270;line-height:1.7;">${tried.map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('')}</ul>`
    : `<div style="font-size:12.5px;color:#9aa1ae;margin-bottom:14px;">Server did not report which paths it tried.</div>`;
  root.innerHTML = `<div style="max-width:820px;margin:40px auto;padding:22px 26px;background:#fff;border:1px solid rgba(20,22,28,.10);border-left:4px solid #c78500;border-radius:10px;">
    <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#c78500;text-transform:uppercase;margin-bottom:6px;">Terminal spawn failed</div>
    <h2 style="font-size:19px;font-weight:700;margin:0 0 8px;color:#16181e;">claude not on PATH</h2>
    <p style="font-size:13.5px;color:#5b6270;line-height:1.55;margin:0 0 10px;">The meeting-server is running but cannot resolve the <code>claude</code> binary. Paths tried:</p>
    ${triedList}
    <p style="font-size:12.5px;color:#5b6270;line-height:1.55;margin:0 0 14px;">Install Claude Code (<code>brew install anthropics/claude/claude</code>) or expose the binary at one of the fallback paths above.</p>
    <button type="button" id="terminal-retry" style="padding:8px 16px;background:#3468d6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">Retry</button>
  </div>`;
  document.getElementById('terminal-retry')?.addEventListener('click', () => renderTerminal());
}

function renderGenericErrorBanner(root, message) {
  root.innerHTML = `<div style="max-width:820px;margin:40px auto;padding:22px 26px;background:#fff;border:1px solid rgba(20,22,28,.10);border-left:4px solid #c12525;border-radius:10px;">
    <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#c12525;text-transform:uppercase;margin-bottom:6px;">Terminal error</div>
    <h2 style="font-size:19px;font-weight:700;margin:0 0 8px;color:#16181e;">Could not start terminal</h2>
    <p style="font-size:13.5px;color:#5b6270;line-height:1.55;margin:0 0 14px;">${escapeHtml(message)}</p>
    <button type="button" id="terminal-retry" style="padding:8px 16px;background:#3468d6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">Retry</button>
  </div>`;
  document.getElementById('terminal-retry')?.addEventListener('click', () => renderTerminal());
}

export async function renderTerminal() {
  const root = document.getElementById('route-terminal');
  if (!root) return;

  root.innerHTML = `<div style="max-width:1080px;margin:0 auto;padding:22px 28px 24px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:14px;">
      <div>
        <div style="font:600 10.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#3468d6;text-transform:uppercase;margin-bottom:6px;">Local · Claude Code</div>
        <h1 style="font-size:27px;font-weight:800;letter-spacing:-.025em;margin:0;line-height:1.04;">Terminal</h1>
        <div style="font-size:13.5px;color:#5b6270;margin-top:4px;">Embedded pty into <code>${escapeHtml(DEFAULT_CWD)}</code> running <code>${escapeHtml(DEFAULT_COMMAND)}</code>.</div>
      </div>
    </div>
    <div id="terminal-mount" style="background:#0a0a0a;border-radius:10px;padding:12px;min-height:460px;box-shadow:0 1px 3px rgba(20,22,28,.08);">
      <div style="color:#9aa1ae;font:500 12.5px 'JetBrains Mono',ui-monospace,Menlo,monospace;">Loading xterm.js and spawning session…</div>
    </div>
  </div>`;

  // 1) POST /terminal/spawn — handle both failure branches inline
  let spawn;
  try {
    const res = await fetch(SPAWN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: DEFAULT_CWD, command: DEFAULT_COMMAND }),
    });
    if (!res.ok) {
      // Try to parse structured error body (e.g. {error, tried})
      let body = {};
      try { body = await res.json(); } catch (_) { /* fall through */ }
      if (body && typeof body.error === 'string' && body.error.toLowerCase().includes('claude')) {
        return renderClaudeMissingBanner(root, body.tried || []);
      }
      return renderGenericErrorBanner(root, `spawn returned HTTP ${res.status}${body.error ? ` — ${body.error}` : ''}`);
    }
    spawn = await res.json();
    if (!spawn || !spawn.ws_url || !spawn.session_id) {
      return renderGenericErrorBanner(root, `spawn response missing ws_url/session_id: ${JSON.stringify(spawn)}`);
    }
  } catch (err) {
    // Network failure → server offline
    return renderOfflineBanner(root, err && err.message ? err.message : '');
  }

  // 2) Load xterm.js + mount
  let Terminal;
  try {
    Terminal = await loadXtermOnce();
  } catch (err) {
    return renderGenericErrorBanner(root, err && err.message ? err.message : 'xterm.js load failed');
  }

  const mount = document.getElementById('terminal-mount');
  if (!mount) return; // route changed under us
  mount.innerHTML = '';
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: `'JetBrains Mono', ui-monospace, Menlo, monospace`,
    fontSize: 13,
    theme: { background: '#0a0a0a', foreground: '#e6e6e6' },
    convertEol: true,
  });
  term.open(mount);
  term.focus();

  // 3) Open WS, wire stdio both directions
  let ws;
  try {
    ws = new WebSocket(spawn.ws_url);
  } catch (err) {
    return renderGenericErrorBanner(root, `could not open WebSocket at ${spawn.ws_url}: ${err.message}`);
  }

  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    term.write(`\x1b[90m[connected: session ${spawn.session_id.slice(0, 8)}…]\x1b[0m\r\n`);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      term.write(ev.data);
    } else if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    }
  };
  ws.onerror = () => {
    term.write(`\r\n\x1b[31m[WebSocket error — the pty may have exited]\x1b[0m\r\n`);
  };
  ws.onclose = () => {
    term.write(`\r\n\x1b[90m[session closed]\x1b[0m\r\n`);
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  // Best-effort cleanup on route change — close WS if this route body is
  // repainted by another view.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(mount)) {
      try { ws.close(); } catch (_) {}
      try { term.dispose(); } catch (_) {}
      observer.disconnect();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}
