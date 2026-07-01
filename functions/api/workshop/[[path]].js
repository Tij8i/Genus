// GET /api/workshop/<path>
//
// Serves Workshop candidate prototype files raw, with the correct Content-Type,
// so the Workshop view can iframe them and their relative fetches resolve.
//
// URL shape: /api/workshop/docs/genus/modules/<module-id>/prototypes/<file>.html
//   - The prototype HTML lives at /api/workshop/docs/genus/modules/<id>/prototypes/<file>.html
//   - A relative fetch ../../../bus/{BU}/whatever.json from inside that page
//     resolves to /api/workshop/docs/genus/bus/{BU}/whatever.json — also
//     served here (any path under docs/genus/ OR dashboard/public/data/bus/
//     is readable via the same allowlist as /api/experiment).
//
// Path envelope: same security shape as /api/substrate. Only paths under
// the Workshop-relevant prefixes are readable. No traversal, no null bytes.

import { getFile } from '../_gh.js';

const ALLOWED_PREFIXES = [
  'docs/genus/modules/',              // module folders (spec, agent files, prototypes)
  'dashboard/public/data/bus/',       // substrate for cross-referenced BU data from a prototype
];

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function contentTypeFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function pathIsAllowed(subPath) {
  if (!subPath || typeof subPath !== 'string') return false;
  if (subPath.includes('..')) return false;
  if (subPath.includes('\0')) return false;
  if (/[\x00-\x1f]/.test(subPath)) return false;
  return ALLOWED_PREFIXES.some(p => subPath.startsWith(p));
}

export async function onRequestGet({ request, env, params }) {
  if (!env.GITHUB_PAT) {
    return new Response('GITHUB_PAT env var not set', { status: 500 });
  }
  const segments = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const subPath = segments.join('/');

  if (!pathIsAllowed(subPath)) {
    return new Response(
      `Forbidden path. Allowed prefixes: ${ALLOWED_PREFIXES.join(', ')}. Got: ${subPath || '(empty)'}`,
      { status: 400 }
    );
  }

  try {
    const result = await getFile(env.GITHUB_PAT, subPath);
    return new Response(result.content, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(subPath),
        'Cache-Control': 'no-cache, must-revalidate',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return new Response(
      `Could not fetch ${subPath}: ${e.message || String(e)}`,
      { status }
    );
  }
}
