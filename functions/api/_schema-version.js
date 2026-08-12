// Per-BU schema version (Pages Functions mirror).
// See server/api/_schema-version.js for the canonical doc.

import { getFile } from './_gh.js';

const REGISTRY_PATH = 'dashboard/public/data/bus/_registry.json';
const DEFAULT_VERSION = 'v1';

const CACHE = new Map();
const CACHE_TTL_MS = 30_000;

export async function getSchemaVersion(pat, bu) {
  const cached = CACHE.get(bu);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.version;
  let version = DEFAULT_VERSION;
  try {
    const f = await getFile(pat, REGISTRY_PATH);
    const reg = JSON.parse(f.content);
    const entry = (reg?.business_units || []).find(b => b.id === bu);
    if (entry?.schema_version === 'v2') version = 'v2';
  } catch { /* registry missing → default v1 */ }
  CACHE.set(bu, { version, at: Date.now() });
  return version;
}

export function isV2(version) { return version === 'v2'; }
