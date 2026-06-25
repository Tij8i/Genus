// Connector client — Phase 1 helpers for the Wiring connector overlay.
//
// Per GEN-104 plan §5–§6:
//   - connectorPing(connector)            client-side HTTP health probe
//   - fileHealTask(connector, payload)    files a heal task on the BU's substrate
//
// In-memory only: connectorPing never writes back to connectors.json. The
// persistent write-back path is Phase 2 (separate child issue).

const HEAL_KINDS = {
  reauth: 'Re-authenticate connector (refresh OAuth / re-grant scopes).',
  restart: 'Restart MCP server endpoint.',
  refresh_token: 'Rotate API token / refresh credential.',
  other: null,
};

export function healKindLabel(kind) {
  switch (kind) {
    case 'reauth': return 'Re-authenticate';
    case 'restart': return 'Restart MCP server';
    case 'refresh_token': return 'Refresh token';
    case 'other': return 'Other (describe)';
    default: return kind || 'Heal';
  }
}

// Probe an MCP connector's endpoint. Returns { ok, latency_ms, error }.
// Phase 1: HEAD `/`; on non-2xx/network fail, retry with `/healthz`.
// Phase 2 will route through a Cloudflare function to avoid CORS (separate child).
export async function connectorPing(connector) {
  const mcp = connector?.mcp || {};
  if (mcp.transport && mcp.transport !== 'http') {
    return { ok: false, latency_ms: null, error: `transport=${mcp.transport} not supported in Phase 1 (http only)` };
  }
  const endpoint = mcp.endpoint;
  if (!endpoint) return { ok: false, latency_ms: null, error: 'no mcp.endpoint set' };

  const tryFetch = async (url) => {
    const start = performance.now();
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      const latency = Math.round(performance.now() - start);
      // mode:no-cors yields opaque responses (resp.ok = false, status = 0).
      // We treat a completed request as evidence that the endpoint is reachable.
      return { ok: true, latency_ms: latency, error: null, opaque: resp.type === 'opaque' };
    } catch (e) {
      const latency = Math.round(performance.now() - start);
      return { ok: false, latency_ms: latency, error: e?.message || String(e) };
    }
  };

  const root = await tryFetch(endpoint);
  if (root.ok) return root;

  // /healthz convention fallback
  const healthz = endpoint.replace(/\/+$/, '') + '/healthz';
  const fb = await tryFetch(healthz);
  if (fb.ok) return fb;
  return { ok: false, latency_ms: fb.latency_ms ?? root.latency_ms, error: fb.error || root.error };
}

// File a heal task on the BU's substrate. The Genus system agent (or its
// stand-in until GEN-93 lands) picks it up at next heartbeat. Phase 1: no
// inline credential mutation — the agent is the only writer.
export async function fileHealTask(connector, payload, { bu = 'genus' } = {}) {
  const kind = payload?.kind || 'other';
  const description = (payload?.description || '').trim();
  const kindLabel = healKindLabel(kind);
  const title = `Heal connector ${connector?.id || '?'} — ${kindLabel}`;
  const body = {
    bu,
    title,
    description: description || HEAL_KINDS[kind] || '',
    category: 'connector_heal',
    target: {
      type: 'connector_heal',
      scope: `connector:${connector?.id || ''} provider:${connector?.provider || ''} kind:${kind}`,
      executor: connector?.owner_agent || 'genus-system',
    },
    estimated_minutes: 15,
    risk_level: 'low',
    reversibility: 'high',
    source: 'wiring_connector_overlay',
  };
  const resp = await fetch('/api/file-stewart-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || !j.ok) {
    throw new Error(j.message || `HTTP ${resp.status}`);
  }
  return j.task;
}

// Read `?role=operator` / `?role=module-steward` from the hash query.
// Defaults to operator. Per [[testable-previews]] — URL bar override so
// reviewers can switch roles without editing config.
export function readConnectorRole() {
  const queryStr = (window.location.hash || '').split('?')[1] || '';
  const role = new URLSearchParams(queryStr).get('role');
  if (role === 'module-steward') return 'module-steward';
  return 'operator';
}

// Stale = last_check_at older than 2× health_check.interval_minutes.
export function isStale(connector, now = Date.now()) {
  const last = connector?.last_check_at ? Date.parse(connector.last_check_at) : NaN;
  if (!Number.isFinite(last)) return false;
  const intervalMin = connector?.health_check?.interval_minutes || 0;
  if (!intervalMin) return false;
  const ageMs = now - last;
  return ageMs > intervalMin * 2 * 60 * 1000;
}
