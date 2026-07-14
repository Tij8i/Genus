// Local filesystem storage implementation for the Genus storage abstraction.
//
// Reads and writes substrate files from process.env.GENUS_BUS_ROOT (default:
// ./bus) using node:fs/promises. The Docker Compose install (phase 4c) will
// mount a named volume at /app/bus inside the container and set
// GENUS_BUS_ROOT=/app/bus so substrate persists across container restarts.
//
// Return shapes match functions/api/_gh.js exactly so ported handlers don't
// need to change their call sites. See server/storage/index.js for the full
// contract.
//
// v1.0 assumptions (documented in the phase 4a spec):
//   • Single-writer per install. No optimistic concurrency check on putFile —
//     the `sha` argument is accepted for shape compatibility with the GitHub
//     Contents API but ignored. This is safe because the Docker Compose install
//     is a single-machine, single-operator deployment (BRIEF D3: localhost =
//     trusted, no multi-user).
//   • Content hash serves as `sha`. It's a stable identifier for the current
//     file content but isn't used for locking. Handlers that read the sha for
//     provenance / debugging still get a value.
//   • Parent directories are created automatically on putFile so first-time
//     writes to `bus/<new-bu>/foo.json` don't 404.
//
// Path safety: the storage layer receives paths that were already validated
// at the handler level (substrate.js has an ALLOWED_PREFIXES allowlist, the
// workshop route has its own). We still normalize + check that the resolved
// path stays inside BUS_ROOT to defend against a handler that forgot to
// validate.

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DEFAULT_BUS_ROOT = './bus';

// Ported CF Pages Functions pass paths like:
//   dashboard/public/data/bus/<bu>/<file>.json
//   dashboard/public/data/system/roles.json
//
// GENUS_BUS_ROOT is the on-disk directory that corresponds to the
// `dashboard/public/data/bus/` prefix of those paths (mirroring how the
// Docker Compose install mounts a `genus_bus` volume at /app/bus and stores
// `bus/<bu>/...` inside it).
//
// The resolvePath function below strips a small set of well-known virtual
// prefixes so paths from either style resolve correctly:
//
//   dashboard/public/data/bus/<bu>/foo → <BUS_ROOT>/<bu>/foo
//   dashboard/public/data/system/roles.json → <BUS_ROOT>/../system/roles.json
//                                             (co-located sibling dir)
//   bus/<bu>/foo → <BUS_ROOT>/<bu>/foo   (already stripped)
//
// The verification path in the phase 4a spec (`GENUS_BUS_ROOT=./dashboard/public/data/bus`)
// exercises the first rule.
const VIRTUAL_PREFIXES = [
  { from: 'dashboard/public/data/bus/', to: '' },      // → BUS_ROOT/...
  { from: 'bus/', to: '' },                            // already-stripped alias
];

function busRoot() {
  return process.env.GENUS_BUS_ROOT || DEFAULT_BUS_ROOT;
}

function stripVirtualPrefix(relPath) {
  for (const { from, to } of VIRTUAL_PREFIXES) {
    if (relPath.startsWith(from)) return to + relPath.slice(from.length);
  }
  return relPath;
}

// system/ files live alongside bus/ in the CF Pages install
// (dashboard/public/data/system/*). We resolve those against BUS_ROOT's
// parent so an operator who mounts BUS_ROOT=/app/bus finds
// /app/system/roles.json (both peers of /app/data or /app/).
function resolveSystemPath(relPath) {
  // Strip either dashboard/public/data/system/ or system/ from the front.
  let rest = relPath;
  if (rest.startsWith('dashboard/public/data/system/')) {
    rest = rest.slice('dashboard/public/data/system/'.length);
  } else if (rest.startsWith('system/')) {
    rest = rest.slice('system/'.length);
  }
  const root = path.resolve(busRoot());
  const systemRoot = path.resolve(root, '..', 'system');
  const abs = path.resolve(systemRoot, rest);
  if (!abs.startsWith(systemRoot + path.sep) && abs !== systemRoot) {
    throw { status: 400, message: `path escapes system root: ${relPath}` };
  }
  return abs;
}

function resolvePath(relPath) {
  if (typeof relPath !== 'string' || !relPath) {
    throw { status: 400, message: 'path is required' };
  }
  if (relPath.includes('\0')) {
    throw { status: 400, message: 'path contains null byte' };
  }
  // system/ and dashboard/public/data/system/ go to their own resolver so
  // roles.json / agent_bindings.json / _registry.json live at BUS_ROOT/../system/.
  if (relPath.startsWith('dashboard/public/data/system/') || relPath.startsWith('system/')) {
    return resolveSystemPath(relPath);
  }
  const stripped = stripVirtualPrefix(relPath);
  const root = path.resolve(busRoot());
  const abs = path.resolve(root, stripped);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    // Traversal defense — resolved path escaped the storage root.
    throw { status: 400, message: `path escapes storage root: ${relPath}` };
  }
  return abs;
}

function contentSha(content) {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

// getFile(pat, path) → { sha, content }
// Throws { status, message } shaped like _gh.js on error so handler try/catch
// blocks that inspect e.status still work.
export async function getFile(_pat, relPath) {
  const abs = resolvePath(relPath);
  let content;
  try {
    content = await fs.readFile(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw { status: 404, message: `file not found: ${relPath}` };
    }
    throw { status: 500, message: `read failed for ${relPath}: ${e.message || String(e)}` };
  }
  return { sha: contentSha(content), content };
}

// putFile(pat, path, content, sha, commitMessage) → { commit: { sha } }
// The `sha` argument is ignored (see file header). Parent dirs are created
// automatically. Commit message is currently discarded — v1.1 will optionally
// pipe local writes through `git commit` so operators who forked their own
// Genus repo can auto-persist substrate changes upstream.
export async function putFile(_pat, relPath, content, _sha, _commitMessage) {
  const abs = resolvePath(relPath);
  const dir = path.dirname(abs);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  } catch (e) {
    throw { status: 500, message: `write failed for ${relPath}: ${e.message || String(e)}` };
  }
  const newSha = contentSha(content);
  // Shape mirrors the GitHub Contents API PUT response subset that handlers
  // actually read (e.g. log-kpi-measurement.js references commit.commit.sha).
  return {
    content: { path: relPath, sha: newSha },
    commit: { sha: newSha, message: _commitMessage || '' },
  };
}

// listFiles(pat, dirPath) → [ { name, sha, path } ]
// Non-recursive: lists direct children only, mirroring the GitHub Contents API
// GET on a directory. Returns [] when the directory doesn't exist so callers
// that use listFiles for "does this BU have any measurements yet" work
// without a special-case.
export async function listFiles(_pat, dirPath) {
  const abs = resolvePath(dirPath);
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    throw { status: 500, message: `list failed for ${dirPath}: ${e.message || String(e)}` };
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const childRel = path.posix.join(dirPath.replace(/\\/g, '/'), ent.name);
    let sha = '';
    try {
      const buf = await fs.readFile(path.resolve(abs, ent.name));
      sha = createHash('sha1').update(buf).digest('hex');
    } catch { /* unreadable; leave sha empty */ }
    out.push({ name: ent.name, sha, path: childRel });
  }
  return out;
}
