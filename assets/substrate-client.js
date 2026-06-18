// Substrate client — talks to /api/substrate Pages Function.
//
// Per [[genus-repo-split-substrate]]: substrate data (bus/<bu>/*.json) lives
// in Tij8i/Orchestrator. This dashboard reads it cross-repo via Pages
// Functions that use the GITHUB_PAT env var.
//
// API:
//   substrateBase(bu)                          → 'dashboard/public/data/bus/tuto'
//   fetchSubstrate(path)                       → { ok, path, size, content }
//   fetchSubstrateJson(path, fallback = null)  → parsed JSON or fallback
//   fetchSubstrateJsonl(path)                  → array of parsed JSONL rows

export function substrateBase(bu) {
  return `dashboard/public/data/bus/${bu}`;
}

export async function fetchSubstrate(path) {
  const url = `/api/substrate?path=${encodeURIComponent(path)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`substrate ${path} HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(`substrate ${path}: ${json.message || 'unknown error'}`);
  }
  return json;
}

export async function fetchSubstrateJson(path, fallback = null) {
  try {
    const result = await fetchSubstrate(path);
    return JSON.parse(result.content);
  } catch (e) {
    // 404 or parse errors fall through to fallback. Other errors throw —
    // boot's catch will surface them as a boot banner.
    if (fallback !== null) {
      console.warn(`[substrate] using fallback for ${path}:`, e.message);
      return fallback;
    }
    throw e;
  }
}

export async function fetchSubstrateJsonl(path) {
  try {
    const result = await fetchSubstrate(path);
    const lines = (result.content || '').split('\n');
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); } catch { /* skip malformed lines */ }
    }
    return out;
  } catch (e) {
    console.warn(`[substrate] jsonl ${path} failed, returning empty:`, e.message);
    return [];
  }
}
