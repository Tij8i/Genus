// Per-BU schema version.
//
// Introduced 2026-08-12 (i66 schema fusion). Determines which shape of
// substrate the endpoint should read/write for a given BU:
//   - 'v1' = pre-fusion: separate Goals + KPIs, milestones + gateways as
//            distinct arrays, subtasks may exist on tasks.
//   - 'v2' = post-fusion: Goals ARE KPI targets, gateways collapsed into
//            checkpoints (was milestones) with requires_approval flag,
//            no subtasks.
//
// Storage: registry entry per BU carries an optional `schema_version` field.
// Absent → default to 'v1' (safe for pre-migration BUs). Migration script
// sets it to 'v2' after rewriting the substrate.
//
// Rollback: flip the field back to 'v1' + revert the substrate commit. No
// deploy needed.

import { getFile } from '../storage/index.js';

const REGISTRY_PATH = 'dashboard/public/data/bus/_registry.json';
const DEFAULT_VERSION = 'v1';

// Cheap in-process cache. Registry rarely changes; a per-request lookup would
// hit GitHub 41 times on Pages boot. TTL is short so migration flips land in
// under a minute.
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
