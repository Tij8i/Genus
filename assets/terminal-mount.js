// terminal-mount.js — mounts an xterm.js panel that spawns a real claude
// process via the local meeting-server (POST /terminal/spawn) and streams
// pty stdio over WebSocket. Replaces the previous chat-surface mount inside
// the chat-dock panel — every dock tab is now a real Claude Code session.
//
// Public API mirrors mountChatSurface's signature so chat-dock.js can swap
// callers with one import change:
//
//   mountTerminalSurface(hostEl, tab, { bu, mode })
//     → mounts xterm into hostEl; spawns claude with agent + trigger
//       derived from the tab object (tab.kind, tab.agent_id, tab.label).
//     Returns unmount() that closes the WS + disposes the terminal.

const TERM_HOST = 'http://127.0.0.1:3101';
const SPAWN_URL = `${TERM_HOST}/terminal/spawn`;
const SESSION_URL = (sid) => `${TERM_HOST}/terminal/session/${sid}`;
const WS_URL = (sid) => `ws://127.0.0.1:3101/terminal/ws/${sid}`;
const XTERM_JS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
const XTERM_FIT_JS = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js';

const ORCHESTRATOR_CWD = '/Users/AlessioTixi/Documents/GitHub/Orchestrator';

// Per-tab persisted session — survives page reloads. Keyed by tab.id.
// Format: { [tabId]: session_id }
const TERM_SESSION_STORE_KEY = 'genus.terminal.sessions';

function loadTermSessions() {
  try { return JSON.parse(localStorage.getItem(TERM_SESSION_STORE_KEY) || '{}'); }
  catch { return {}; }
}
function saveTermSessionFor(tabId, sessionId) {
  const s = loadTermSessions();
  if (sessionId) s[tabId] = sessionId;
  else delete s[tabId];
  try { localStorage.setItem(TERM_SESSION_STORE_KEY, JSON.stringify(s)); } catch (_) {}
}

async function isSessionAlive(sessionId) {
  try {
    const r = await fetch(SESSION_URL(sessionId), { method: 'GET' });
    if (!r.ok) return false;
    const info = await r.json();
    return !!info.alive && !info.attached;   // must be alive AND not already attached
  } catch { return false; }
}

let xtermReady = null;
function loadXterm() {
  if (xtermReady) return xtermReady;
  xtermReady = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-xterm-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = XTERM_CSS;
      link.dataset.xtermCss = '1';
      document.head.appendChild(link);
    }
    const done = () => {
      if (!window.Terminal) return reject(new Error('xterm loaded but Terminal missing'));
      // Also ensure fit addon
      if (window.FitAddon) return resolve({ Terminal: window.Terminal, FitAddon: window.FitAddon.FitAddon });
      const fitScript = document.createElement('script');
      fitScript.src = XTERM_FIT_JS;
      fitScript.async = true;
      fitScript.onload = () => resolve({ Terminal: window.Terminal, FitAddon: (window.FitAddon && window.FitAddon.FitAddon) || null });
      fitScript.onerror = () => resolve({ Terminal: window.Terminal, FitAddon: null }); // degrade gracefully — no fit but still usable
      document.head.appendChild(fitScript);
    };
    if (window.Terminal) { done(); return; }
    const script = document.createElement('script');
    script.src = XTERM_JS;
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error(`failed to load xterm from ${XTERM_JS}`));
    document.head.appendChild(script);
  });
  return xtermReady;
}

// Derive (name, trigger) for `claude --name "<name>" "<trigger>"` from the tab.
// tab.kind === 'genus' → Director of <bu>
// tab.kind === 'steward' → whatever the tab's agent_id + label say
// Otherwise → default to Director-of-<bu>
function commandForTab(tab, bu) {
  const buCap = (bu || 'genus').replace(/(^|-)([a-z])/g, (_, s, c) => s + c.toUpperCase());
  if (tab.kind === 'steward' && tab.agent_id) {
    return {
      name: tab.label || tab.agent_id,
      trigger: `load ${tab.agent_id}`,
    };
  }
  // default = director-of-<bu>
  const agent = `director-of-${bu || 'genus'}`;
  return {
    name: `Director of ${buCap}`,
    trigger: `load director of ${bu || 'genus'}`,
  };
}

function renderBanner(hostEl, kind, message, retryFn, tried) {
  hostEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;gap:10px;color:#5b6270;font-size:12.5px;line-height:1.55;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;color:#16181e;';
  title.textContent = message;
  wrap.appendChild(title);
  if (tried && tried.length) {
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:11px;color:#9aa1ae;font-family:ui-monospace,SFMono-Regular,monospace;';
    sub.textContent = 'Tried: ' + tried.join(' · ');
    wrap.appendChild(sub);
  }
  if (retryFn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Retry';
    btn.style.cssText = 'margin-top:6px;padding:8px 14px;background:#3468d6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;';
    btn.addEventListener('click', retryFn);
    wrap.appendChild(btn);
  }
  hostEl.appendChild(wrap);
}

export async function mountTerminalSurface(hostEl, tab, { bu } = {}) {
  if (!hostEl) return () => {};
  let disposed = false;
  let ws = null;
  let term = null;

  let fitAddon = null;
  let ro = null;

  const cleanup = () => {
    disposed = true;
    try { ro?.disconnect(); } catch (_) { /* noop */ }
    try { ws?.close(); } catch (_) { /* noop */ }
    try { term?.dispose(); } catch (_) { /* noop */ }
    ws = null;
    term = null;
    ro = null;
  };

  const doMount = async () => {
    hostEl.innerHTML = '<div style="padding:20px;color:#9aa1ae;font-size:12px;">Connecting…</div>';
    let Terminal, FitAddon;
    try {
      ({ Terminal, FitAddon } = await loadXterm());
    } catch (err) {
      renderBanner(hostEl, 'load-error', 'xterm.js failed to load', doMount);
      return;
    }
    if (disposed) return;

    // Session-persistence flow (2026-08-21):
    //   1. Check localStorage for a stored session_id for this tab.
    //   2. If stored, ping /terminal/session/<sid>: if alive & unattached, reuse.
    //   3. If not stored or dead, spawn fresh + store the new session_id.
    // This is what makes minimise/reload continue the same claude conversation
    // instead of starting over.
    let sessionId = null;
    const stored = loadTermSessions()[tab.id];
    if (stored && await isSessionAlive(stored)) {
      sessionId = stored;
      hostEl.innerHTML = '<div style="padding:20px;color:#9aa1ae;font-size:12px;">Resuming session…</div>';
    } else {
      if (stored) saveTermSessionFor(tab.id, null); // stale; clear
      const cmd = commandForTab(tab, bu);
      const command = `claude --name "${cmd.name.replace(/"/g, '\\"')}" "${cmd.trigger.replace(/"/g, '\\"')}"`;
      let spawnResp;
      try {
        const resp = await fetch(SPAWN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: ORCHESTRATOR_CWD, command }),
        });
        if (!resp.ok) {
          let body = {};
          try { body = await resp.json(); } catch (_) { /* noop */ }
          if ((body.error || '').toLowerCase().includes('claude') && (body.error || '').toLowerCase().includes('path')) {
            renderBanner(hostEl, 'no-claude', 'claude not on PATH', doMount, body.tried);
          } else {
            renderBanner(hostEl, 'spawn-error', `spawn failed (HTTP ${resp.status}): ${body.error || 'unknown'}`, doMount);
          }
          return;
        }
        spawnResp = await resp.json();
        sessionId = spawnResp.session_id;
        saveTermSessionFor(tab.id, sessionId);
      } catch (err) {
        renderBanner(hostEl, 'offline', 'meeting-server offline', doMount);
        return;
      }
    }
    if (disposed) return;

    // Mount xterm
    hostEl.innerHTML = '';
    hostEl.style.cssText = 'flex:1;display:flex;background:#0b0d12;overflow:hidden;';
    const termContainer = document.createElement('div');
    termContainer.style.cssText = 'flex:1;padding:8px;';
    hostEl.appendChild(termContainer);

    term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: { background: '#0b0d12', foreground: '#e6e8ee' },
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });
    term.open(termContainer);
    // Fit to container + observe resize (fixes cramped rendering + expand-panel).
    if (FitAddon) {
      try {
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        // Initial fit — deferred a tick so layout has real dimensions.
        setTimeout(() => { try { fitAddon.fit(); } catch (_) {} }, 0);
        ro = new ResizeObserver(() => {
          try {
            fitAddon.fit();
            // Notify server so pty dimensions match. Server ignores if unsupported.
            if (ws && ws.readyState === WebSocket.OPEN && term) {
              ws.send(JSON.stringify({ __resize: { cols: term.cols, rows: term.rows } }));
            }
          } catch (_) {}
        });
        ro.observe(termContainer);
      } catch (_) { /* degrade */ }
    }
    term.focus();

    // WS (attach to sessionId — either fresh spawn or resumed)
    try {
      ws = new WebSocket(WS_URL(sessionId));
    } catch (err) {
      renderBanner(hostEl, 'ws-error', `WebSocket open failed: ${err.message}`, doMount);
      return;
    }

    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { /* claude begins streaming on its own */ };
    ws.onmessage = (ev) => {
      if (disposed || !term) return;
      const data = typeof ev.data === 'string'
        ? ev.data
        : new TextDecoder('utf-8').decode(new Uint8Array(ev.data));
      term.write(data);
    };
    ws.onclose = () => {
      if (disposed || !term) return;
      // NOTE: WS close no longer means session is over — server keeps pty
      // alive for 30 min grace. This just means our attachment ended (usually
      // because we detached deliberately for cleanup). Only clear stored
      // session if child actually exited (verified via /session probe next
      // reattach). Don't show a "session ended" line — most closes are
      // benign (tab unmount, minimise-then-re-render).
    };
    ws.onerror = () => { /* silent — onclose handles */ };

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  doMount();
  return cleanup;
}
