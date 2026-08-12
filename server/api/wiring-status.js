// GET /api/wiring-status
//
// Live probes for the local operating stack shown on Settings → Wiring.
// Replaces the hard-coded 'good' dots that used to lie whenever a runtime
// was down (spotted 2026-08-12: dashboard showed Paperclip green while the
// runtime's /api/health was actually deadlocked).
//
// Only the Node/Express runtime can reach localhost, so this handler
// actually probes. The Cloudflare Pages Functions mirror at
// functions/api/wiring-status.js short-circuits with runtime='edge' +
// probes_available:false so the UI can render "unknown" dots and note that
// live probes only work from the local install.
//
// Response shape:
//   {
//     ok, runtime, probes_available, checked_at,
//     probes: {
//       paperclip: { status, latency_ms, code?, message? },
//       meeting_server: { status, latency_ms, code?, message? },
//       adapter:  { status, seconds_since_log?, message? },
//     }
//   }
//
// Status values: 'good' | 'warn' | 'bad' | 'unknown'

import { jsonResponse, todayISO } from '../storage/index.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PAPERCLIP_URL = process.env.PAPERCLIP_HOST || 'http://127.0.0.1:3100';
const MEETING_URL   = process.env.GENUS_MEETING_URL || 'http://127.0.0.1:8765';
const ADAPTER_LOG   = process.env.GENUS_ADAPTER_LOG || path.join(os.homedir(), '.genus-adapter.log');
const PROBE_TIMEOUT_MS = 3000;
const ADAPTER_STALE_SECONDS = 180;    // >3min without a write ⇒ warn
const ADAPTER_DEAD_SECONDS = 600;     // >10min without a write ⇒ bad

export async function onRequestGet() {
  const [paperclip, meeting, adapter] = await Promise.all([
    probeHttp(`${PAPERCLIP_URL}/api/health`, 'paperclip'),
    probeHttp(`${MEETING_URL}/health`, 'meeting_server'),
    probeAdapter(ADAPTER_LOG),
  ]);
  return jsonResponse(200, {
    ok: true,
    runtime: 'node-express',
    probes_available: true,
    checked_at: todayISO(),
    probes: { paperclip, meeting_server: meeting, adapter },
  });
}

function probeHttp(url, label) {
  return new Promise(resolve => {
    const started = Date.now();
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      resolve({ latency_ms: Date.now() - started, ...payload });
    };
    let req;
    try {
      req = http.get(url, { timeout: PROBE_TIMEOUT_MS, headers: { Accept: 'application/json' } }, res => {
        const code = res.statusCode || 0;
        // Consume + discard so the socket closes.
        res.resume();
        if (code >= 200 && code < 400) finish({ status: 'good', code });
        else if (code === 401 || code === 403) finish({ status: 'good', code, message: 'reachable · auth-gated' });
        else finish({ status: 'warn', code, message: `HTTP ${code}` });
      });
    } catch (e) {
      finish({ status: 'bad', message: `probe launch failed: ${e.message || e}` });
      return;
    }
    req.on('timeout', () => {
      try { req.destroy(new Error('timeout')); } catch {}
      finish({ status: 'bad', message: `timeout after ${PROBE_TIMEOUT_MS}ms — runtime may be up but this route is stalled` });
    });
    req.on('error', e => {
      const msg = e.code === 'ECONNREFUSED' ? 'connection refused — runtime not listening' : (e.message || String(e));
      finish({ status: 'bad', message: msg });
    });
  });
}

async function probeAdapter(logPath) {
  try {
    const stat = await fs.stat(logPath);
    const seconds = Math.round((Date.now() - stat.mtimeMs) / 1000);
    let status;
    if (seconds < ADAPTER_STALE_SECONDS) status = 'good';
    else if (seconds < ADAPTER_DEAD_SECONDS) status = 'warn';
    else status = 'bad';
    return {
      status,
      seconds_since_log: seconds,
      message: status === 'good'
        ? 'writing recently'
        : status === 'warn'
          ? `last write ${seconds}s ago — expected within ${ADAPTER_STALE_SECONDS}s`
          : `last write ${seconds}s ago — adapter likely dead`,
    };
  } catch (e) {
    return {
      status: 'unknown',
      message: `adapter log unreadable at ${logPath}: ${e.code || e.message || e}`,
    };
  }
}
