// Resolve which meeting server the dashboard should talk to.
//
// Two runtimes ship the meeting server:
//   • Docker install (i56 postfix2) — server/lib/meeting-routes.js exposes
//     /api/meetings/* on the same origin as the dashboard.
//   • Alessio's Mac / Cloudflare Pages install — the launchd Python server
//     at http://localhost:8765/meeting/* (only reachable from Alessio's own
//     machine; requires launchctl kickstart).
//
// This module probes same-origin first (Docker-shaped) and falls back to
// launchd. The resolved endpoint is memoized for the tab lifetime — no
// per-request probe.
//
// All meeting server callers (meeting.js, views/inputs.js, views/dashboard.js)
// import from here and use `meetingServerUrl(path)` to build the fetch target.

let resolved = null; // { base, style: 'docker' | 'launchd', ok: bool }
let probeInFlight = null;

const DOCKER_BASE = ''; // same-origin
const LAUNCHD_BASE = 'http://localhost:8765';

async function probe(base, healthPath) {
  try {
    const r = await fetch(base + healthPath, { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.ok;
  } catch { return false; }
}

async function resolveEndpoint() {
  // Docker style first (same-origin, cheap).
  if (await probe(DOCKER_BASE, '/api/meetings/health')) {
    return { base: DOCKER_BASE, style: 'docker', ok: true };
  }
  // Fallback to the legacy launchd server on Alessio's Mac.
  if (await probe(LAUNCHD_BASE, '/health')) {
    return { base: LAUNCHD_BASE, style: 'launchd', ok: true };
  }
  return { base: null, style: null, ok: false };
}

export async function meetingServerHealth() {
  if (resolved) return resolved;
  if (probeInFlight) return probeInFlight;
  probeInFlight = resolveEndpoint().then(r => { resolved = r; probeInFlight = null; return r; });
  return probeInFlight;
}

// Build the URL for a meeting endpoint. Style-aware — the Docker server uses
// /api/meetings/* + query-string bu, the launchd server uses /meeting/* +
// /meetings query. Callers pass a logical action + an optional query string.
//
// Actions:
//   'health'  → GET
//   'list'    → GET (needs ?bu=...)
//   'new'     → POST
//   'turn'    → POST
//   'close'   → POST
export function meetingServerUrl(action, queryString = '') {
  if (!resolved || !resolved.ok) return null;
  const base = resolved.base;
  const q = queryString ? (queryString.startsWith('?') ? queryString : '?' + queryString) : '';
  if (resolved.style === 'docker') {
    switch (action) {
      case 'health': return base + '/api/meetings/health';
      case 'list':   return base + '/api/meetings' + q;
      case 'new':    return base + '/api/meetings/new';
      case 'turn':   return base + '/api/meetings/turn';
      case 'close':  return base + '/api/meetings/close';
      default:       return null;
    }
  }
  // launchd style
  switch (action) {
    case 'health': return base + '/health';
    case 'list':   return base + '/meetings' + q;
    case 'new':    return base + '/meeting/new';
    case 'turn':   return base + '/meeting/turn';
    case 'close':  return base + '/meeting/close';
    default:       return null;
  }
}

// Convenience — human-readable descriptor for the resolved endpoint. Used by
// error messages so the operator knows which server was targeted.
export function meetingServerLabel() {
  if (!resolved || !resolved.ok) return 'meeting server (unreachable)';
  if (resolved.style === 'docker') return 'Genus meeting server (Docker · same-origin)';
  return 'Genus meeting server (launchd · localhost:8765)';
}

// Reset for tests. Not used in production.
export function _resetMeetingEndpoint() { resolved = null; probeInFlight = null; }
