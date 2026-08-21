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
const XTERM_JS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';

const ORCHESTRATOR_CWD = '/Users/AlessioTixi/Documents/GitHub/Orchestrator';

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
    if (window.Terminal) { resolve(window.Terminal); return; }
    const script = document.createElement('script');
    script.src = XTERM_JS;
    script.async = true;
    script.onload = () => window.Terminal ? resolve(window.Terminal) : reject(new Error('xterm loaded but Terminal missing'));
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

  const cleanup = () => {
    disposed = true;
    try { ws?.close(); } catch (_) { /* noop */ }
    try { term?.dispose(); } catch (_) { /* noop */ }
    ws = null;
    term = null;
  };

  const doMount = async () => {
    hostEl.innerHTML = '<div style="padding:20px;color:#9aa1ae;font-size:12px;">Spawning claude session…</div>';
    let Terminal;
    try {
      Terminal = await loadXterm();
    } catch (err) {
      renderBanner(hostEl, 'load-error', 'xterm.js failed to load', doMount);
      return;
    }
    if (disposed) return;

    const cmd = commandForTab(tab, bu);
    const command = `claude --name "${cmd.name.replace(/"/g, '\\"')}" "${cmd.trigger.replace(/"/g, '\\"')}"`;

    // Spawn
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
          // failure branch — claude not on PATH
          renderBanner(hostEl, 'no-claude', 'claude not on PATH', doMount, body.tried);
        } else {
          renderBanner(hostEl, 'spawn-error', `spawn failed (HTTP ${resp.status}): ${body.error || 'unknown'}`, doMount);
        }
        return;
      }
      spawnResp = await resp.json();
    } catch (err) {
      renderBanner(hostEl, 'offline', 'meeting-server offline', doMount);
      return;
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
    term.focus();

    // WS
    try {
      ws = new WebSocket(spawnResp.ws_url);
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
      try { term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n'); } catch (_) { /* noop */ }
    };
    ws.onerror = () => {
      if (disposed) return;
      // Fall through to close; onclose renders the ended line.
    };

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  doMount();
  return cleanup;
}
