// Genus Node/Express server (phase 4a of i56).
//
// Ports the Cloudflare Pages Functions handlers in functions/api/ to a
// standalone Node service that runs inside the Docker Compose install
// (phase 4c). The Cloudflare Pages deployment continues to serve
// functions/ untouched for the operator's canonical install.
//
// What this file does:
//   1. Serves the Genus dashboard's static assets (index.html, assets/, docs/,
//      etc.) — same content Cloudflare Pages ships today.
//   2. Auto-discovers every server/api/*.js handler and mounts it under
//      /api/<filename-without-ext>. Handlers export onRequestGet and/or
//      onRequestPost with the same signature as Cloudflare Pages Functions.
//   3. Adapts Express req → the Pages Functions `request` shape (see the
//      makePagesRequest helper below) so the ported handlers don't need any
//      per-handler shim.
//   4. Adapts the standard Response object each handler returns → Express
//      res.status().set().send() so headers + body flow through.
//
// Ports: PORT env var (default 8080). Docker Compose maps this to host 8080.
//
// Runtime env vars:
//   PORT                — HTTP port to listen on (default 8080)
//   GENUS_LOCAL_MODE=1  — enables local admin identity fallback (see
//                          server/api/_identity.js). Docker Compose sets this.
//   GENUS_BUS_ROOT      — filesystem root for substrate reads/writes. Docker
//                          Compose points this at the mounted `genus_bus` volume.
//   GENUS_STORAGE_MODE  — 'local-fs' (default) or 'github' (v1.1, not shipped).

import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 8080);

// Local-mode env seeding.
//
// Many ported handlers gate on `env.GITHUB_PAT` at their top (originally to
// verify the CF Pages project had the substrate PAT bound). In the local
// install there is no PAT — the storage abstraction reads/writes local disk,
// not the GitHub API. Rather than modify every handler to skip the PAT check,
// we seed a sentinel value here when GENUS_LOCAL_MODE=1 so the handlers pass
// the check and go straight to the storage call, where local-fs.js ignores
// the PAT argument entirely.
if (process.env.GENUS_LOCAL_MODE === '1' && !process.env.GITHUB_PAT) {
  process.env.GITHUB_PAT = 'local-mode-no-pat';
}

// ---- Pages-Functions request shim -------------------------------------------
//
// Cloudflare Pages Functions receive a `request` object that conforms to the
// Fetch API `Request` interface. Ported handlers call three things on it:
//
//   • request.url        — absolute URL as string; used with `new URL(...)` to
//                          read query params.
//   • request.headers.get(name) — case-insensitive header lookup.
//   • request.json()     — async, returns parsed body.
//
// Below, we build a minimal object matching that surface from an Express req.
// Not using the global Request constructor because it wants a ReadableStream
// body and Express gives us a raw body Buffer via express.json().
function makePagesRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${proto}://${host}${req.originalUrl}`;

  const headers = {
    get(name) {
      const v = req.headers[String(name).toLowerCase()];
      if (v == null) return null;
      return Array.isArray(v) ? v[0] : String(v);
    },
    has(name) {
      return req.headers[String(name).toLowerCase()] != null;
    },
  };

  return {
    url,
    method: req.method,
    headers,
    // Handlers expect a promise; the body was parsed by express.json() upstream.
    // If parsing failed we still surface { } so handler try/catch → 400 path
    // fires as-if the client sent invalid JSON.
    async json() {
      if (req._bodyParseError) throw new Error(req._bodyParseError);
      return req.body ?? {};
    },
    async text() {
      if (typeof req.body === 'string') return req.body;
      if (req.body == null) return '';
      return JSON.stringify(req.body);
    },
  };
}

// Piping a Response (whatwg fetch Response) into Express res.
async function sendPagesResponse(pagesRes, res) {
  const status = pagesRes.status || 200;
  const headers = {};
  // Pages Response has a Headers iterable; copy through so Content-Type +
  // Cache-Control land on the Express response.
  if (pagesRes.headers && typeof pagesRes.headers.forEach === 'function') {
    pagesRes.headers.forEach((val, key) => { headers[key] = val; });
  }
  res.status(status).set(headers);
  // Prefer arrayBuffer for binary safety (workshop responses can be images).
  const buf = Buffer.from(await pagesRes.arrayBuffer());
  res.send(buf);
}

// ---- Handler auto-discovery -------------------------------------------------
//
// Every server/api/*.js file that isn't a private helper (leading underscore)
// is mounted as an /api/<name> route. Files that export onRequestGet get a
// GET handler; files that export onRequestPost get a POST handler. A file
// can export both.
async function discoverAndMount(app) {
  const apiDir = path.join(__dirname, 'api');
  let entries;
  try {
    entries = await fs.readdir(apiDir, { withFileTypes: true });
  } catch (e) {
    console.error(`[server] no server/api directory at ${apiDir}; skipping handler mount.`);
    return { mounted: [], skipped: [] };
  }
  const mounted = [];
  const skipped = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith('.js')) continue;
    if (ent.name.startsWith('_')) continue;   // private helper — imported, not mounted
    const route = '/api/' + ent.name.replace(/\.js$/, '');
    const filePath = path.join(apiDir, ent.name);
    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (e) {
      console.error(`[server] failed to import ${filePath}: ${e.message}`);
      skipped.push({ route, reason: 'import-failed', error: e.message });
      continue;
    }
    let hasVerb = false;
    if (typeof mod.onRequestGet === 'function') {
      app.get(route, (req, res) => runHandler(mod.onRequestGet, req, res));
      hasVerb = true;
    }
    if (typeof mod.onRequestPost === 'function') {
      app.post(route, (req, res) => runHandler(mod.onRequestPost, req, res));
      hasVerb = true;
    }
    if (typeof mod.onRequest === 'function') {
      // Cloudflare's catch-all export. Rare in our handlers, but supported.
      app.all(route, (req, res) => runHandler(mod.onRequest, req, res));
      hasVerb = true;
    }
    if (hasVerb) {
      mounted.push(route);
    } else {
      skipped.push({ route, reason: 'no onRequest* export' });
    }
  }
  return { mounted, skipped };
}

async function runHandler(fn, req, res) {
  try {
    const pagesReq = makePagesRequest(req);
    const env = process.env;
    const out = await fn({ request: pagesReq, env });
    if (out && typeof out.arrayBuffer === 'function' && typeof out.status === 'number') {
      // It's a Response
      await sendPagesResponse(out, res);
      return;
    }
    // Shouldn't happen — handler didn't return a Response. Surface as 500.
    res.status(500).json({ ok: false, message: 'handler returned no Response object' });
  } catch (e) {
    // Some ported handlers throw { status, message } for GH errors. Surface.
    const status = (e && e.status && Number.isInteger(e.status)) ? e.status : 500;
    const message = (e && e.message) ? e.message : String(e);
    console.error(`[server] handler error on ${req.method} ${req.originalUrl}: ${message}`);
    res.status(status).json({ ok: false, message });
  }
}

// ---- i56 phase 4b: first-run wizard + redirect ------------------------------
//
// In local mode we intercept `GET /` and redirect to `/wizard/` when no user
// BU exists on disk. "User BU" = any subdirectory of GENUS_BUS_ROOT that isn't
// the built-in `synthetic` demo and isn't a system entry (files, dotfiles,
// or `_`-prefixed registry files). If any user BU exists, the redirect
// short-circuits and the request falls through to express.static() which
// serves the dashboard's index.html.

const WIZARD_DIR = path.join(REPO_ROOT, 'dashboard', 'public', 'wizard');
// i56 phase 4c: splash is now a shipped static asset in dashboard/public/wizard/.
// Previously the /_boot handler read from the sibling Orchestrator repo
// (docs/products/i56-forkable-install/design-output/01-splash.html) which does
// not exist inside the Docker Compose container. Now it reads from the same
// repo tree, so a stripped-down container image serves the splash correctly.
const SPLASH_PATH = path.join(WIZARD_DIR, 'splash.html');

async function hasAnyUserBu() {
  // GENUS_BUS_ROOT points AT the bus/ directory (per local-fs.js VIRTUAL_PREFIXES).
  // A "user BU" is a directory whose name is neither 'synthetic' nor starts
  // with '_' nor '.'.
  const busRoot = process.env.GENUS_BUS_ROOT;
  if (!busRoot) return false;
  let entries;
  try {
    entries = await fs.readdir(busRoot, { withFileTypes: true });
  } catch (e) {
    // No bus dir yet → definitely no user BU.
    return false;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (name === 'synthetic') continue;
    if (name.startsWith('_')) continue;   // e.g. _registry_backup/
    if (name.startsWith('.')) continue;
    return true;
  }
  return false;
}

async function loadWizardTemplate() {
  const html = await fs.readFile(path.join(WIZARD_DIR, 'index.html'), 'utf8');
  return html;
}

function renderWizardHtml(templateHtml) {
  // Inject the flag script into <head> at our marker. Fall through to a plain
  // <head> insert if the template ever loses the marker.
  const missing = !process.env.ANTHROPIC_API_KEY;
  const script = `<script>window.__ANTHROPIC_KEY_MISSING__ = ${missing ? 'true' : 'false'};</script>`;
  const marker = '<!--GENUS_INJECT_ANTHROPIC_KEY_FLAG-->';
  if (templateHtml.includes(marker)) {
    return templateHtml.replace(marker, script);
  }
  return templateHtml.replace('</head>', `${script}\n</head>`);
}

async function loadSplashHtml() {
  // Preferred: the shipped static splash at dashboard/public/wizard/splash.html.
  // Phase 4c copied this in from the Orchestrator design-output tree, so the
  // container image is self-contained (no sibling-repo dependency).
  try {
    return await fs.readFile(SPLASH_PATH, 'utf8');
  } catch { /* fall through to inline fallback */ }
  // Fallback: minimal inline splash matching the design intent so /_boot still
  // returns something coherent if the shipped file was removed post-build.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Genus is starting…</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f5f7;color:#16181d;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:18px}
.dot{width:11px;height:11px;border-radius:99px;background:#2f6bff;animation:p 1.6s ease-in-out infinite;box-shadow:0 2px 8px rgba(47,107,255,.4)}
@keyframes p{0%,100%{opacity:1}50%{opacity:.35}}
.mono{font-family:'JetBrains Mono',monospace;color:#9aa1ae;text-align:center;line-height:1.6}
</style></head><body><div class="dot"></div><div style="font-size:17px;font-weight:600">Genus is starting…</div>
<div class="mono" style="font-size:11.5px">waiting for the dashboard at localhost:${PORT}<br>first run can take a minute</div>
<div class="mono" style="font-size:10px;color:#aab0bb">this page refreshes automatically</div></body></html>`;
}

function mountWizardAndBoot(app) {
  // Root: redirect to /wizard/ when no user BU exists yet.
  app.get('/', async (req, res, next) => {
    try {
      const anyBu = await hasAnyUserBu();
      if (!anyBu) return res.redirect(302, '/wizard/');
    } catch (e) {
      console.error('[wizard] hasAnyUserBu failed:', e && e.message);
      // On error, fall through to static so we don't dead-loop the operator.
    }
    return next();
  });

  // /wizard and /wizard/ → serve the templated index.html
  app.get(['/wizard', '/wizard/', '/wizard/index.html'], async (req, res) => {
    try {
      const tpl = await loadWizardTemplate();
      const html = renderWizardHtml(tpl);
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache, must-revalidate').send(html);
    } catch (e) {
      console.error('[wizard] failed to serve index.html:', e && e.message);
      res.status(500).send('Wizard template not found.');
    }
  });

  // /wizard/<static file> — serve the css / js / html partials directly.
  app.use('/wizard', express.static(WIZARD_DIR, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  }));

  // /_boot — pre-boot splash. Cheap to hit; Docker Compose can point at this
  // as a healthcheck URL that also renders a usable page for the human
  // hitting localhost:8080 before Express has finished importing 35 handlers.
  app.get('/_boot', async (_req, res) => {
    try {
      const html = await loadSplashHtml();
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache').send(html);
    } catch (e) {
      res.status(500).send('boot page unavailable');
    }
  });
}

// ---- i56 phase 4c: first-run seed -------------------------------------------
//
// On empty-volume boot the container has an empty GENUS_BUS_ROOT (fresh Docker
// named volume). We copy:
//
//   1. The `synthetic` demo BU (Acme Roastery) from the image-baked fixtures
//      at /app/synthetic-fixtures/ → <BUS_ROOT>/synthetic/. This makes the
//      demo BU usable on first boot without the operator seeding it manually.
//
//   2. A minimal bus/_registry.json listing only the `synthetic` BU. Handlers
//      like create-bu.js will append to this file when the operator names
//      their first real BU via the wizard.
//
// Rules:
//   • Never overwrite. If either target exists we skip silently so operator
//     edits survive container restarts.
//   • Failures are logged, not fatal — the server still boots. Worst case is
//     the operator has to run the wizard's "start from scratch" path.
//   • Fixture dir may be missing (e.g. during `node --check` / local dev
//     without running docker build); in that case we log + skip.

const SYNTHETIC_FIXTURES_DIR = process.env.GENUS_SYNTHETIC_FIXTURES_DIR
  || '/app/synthetic-fixtures';

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyDirRecursive(src, dest) {
  // fs.cp is available in Node 20+ (matches package.json engines >=20).
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, errorOnExist: false, force: false });
}

async function seedFirstRun() {
  const busRoot = process.env.GENUS_BUS_ROOT;
  if (!busRoot) {
    console.log('[seed] GENUS_BUS_ROOT not set; skipping first-run seed.');
    return;
  }
  try {
    await fs.mkdir(busRoot, { recursive: true });
  } catch (e) {
    console.error('[seed] failed to create bus root:', e && e.message);
    return;
  }

  // 1. Synthetic BU fixtures ------------------------------------------------
  const syntheticTarget = path.join(busRoot, 'synthetic');
  if (await pathExists(syntheticTarget)) {
    // Already seeded (or operator edited); do not overwrite.
  } else if (await pathExists(SYNTHETIC_FIXTURES_DIR)) {
    try {
      await copyDirRecursive(SYNTHETIC_FIXTURES_DIR, syntheticTarget);
      console.log(`[seed] Seeded synthetic BU into ${syntheticTarget}`);
    } catch (e) {
      console.error('[seed] failed to seed synthetic BU:', e && e.message);
    }
  } else {
    console.log(`[seed] synthetic fixtures not found at ${SYNTHETIC_FIXTURES_DIR}; skipping (this is normal outside Docker).`);
  }

  // 2. bus/_registry.json ---------------------------------------------------
  //
  // Handlers read/write dashboard/public/data/bus/_registry.json (see e.g.
  // server/api/create-bu.js). Under local-fs.js the `bus/` prefix maps to
  // BUS_ROOT, so on disk the registry lives at <BUS_ROOT>/_registry.json.
  const registryPath = path.join(busRoot, '_registry.json');
  if (!(await pathExists(registryPath))) {
    const starter = {
      $schema: 'https://genus.work/schemas/bu-registry-v0.json',
      version: '1.0.0',
      default_bu: 'synthetic',
      business_units: [
        {
          id: 'synthetic',
          display_name: 'Acme Roastery',
          avatar_initial: 'A',
          color: '#a85b32',
          modules_installed: [],
          description: 'Synthetic showcase BU — fictional coffee subscription business. Used to show what a fully wired Genus instance looks like.'
        }
      ],
      module_route_map: {},
      core_routes: [
        'agents', 'dashboard', 'inputs', 'layers', 'modules',
        'onboarding', 'outputs', 'people', 'roster', 'settings'
      ],
      available_modules: []
    };
    try {
      await fs.writeFile(registryPath, JSON.stringify(starter, null, 2) + '\n', 'utf8');
      console.log(`[seed] Seeded starter _registry.json at ${registryPath}`);
    } catch (e) {
      console.error('[seed] failed to seed _registry.json:', e && e.message);
    }
  }
}

// ---- Bootstrap --------------------------------------------------------------

async function readVersion() {
  // Read the version from GENUS_MANIFEST.md's front-matter-ish line; fall back
  // to the hardcoded default the phase-4a spec permits so /api/health works
  // even before the manifest is present in the image.
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, 'GENUS_MANIFEST.md'), 'utf8');
    const m = /\*\*Version\*\*:\s*([^\s—\n]+)/.exec(text);
    if (m) return `manifest-${m[1]}`;
  } catch { /* fall through */ }
  return 'v1.0.0-dev';
}

async function main() {
  // i56 phase 4c: first-run seed BEFORE the app is wired so handlers that
  // read the registry / synthetic BU on their first request find populated
  // files. Failures are non-fatal (see seedFirstRun for details).
  if (process.env.GENUS_LOCAL_MODE === '1') {
    await seedFirstRun();
  }

  const app = express();

  // Body parsing. Cloudflare Pages Functions get raw request.json() lazily;
  // Express pre-parses JSON when Content-Type: application/json is set. If
  // the client sends malformed JSON we stash the error on req so the shim's
  // .json() re-throws it — same shape as a Pages Functions request.json()
  // rejection.
  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, _buf, _encoding) => {
      // no-op; parse error goes to the error handler below
    },
  }));
  app.use((err, req, _res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      req._bodyParseError = 'Invalid JSON';
      req.body = undefined;
      // fall through — handler calls request.json() and gets the error
      return next();
    }
    return next(err);
  });

  // ---- i56 phase 4b: wizard + first-run redirect --------------------------
  //
  // These routes must land BEFORE express.static(REPO_ROOT) because static
  // would otherwise serve the dashboard's index.html for GET /, bypassing the
  // no-user-BU redirect. Only active in local mode (GENUS_LOCAL_MODE=1); the
  // Cloudflare Pages deploy sees none of this.
  if (process.env.GENUS_LOCAL_MODE === '1') {
    mountWizardAndBoot(app);
  }

  // Static assets — the current Cloudflare Pages install serves the repo root
  // as its document root. Mirror that here so index.html, assets/, docs/,
  // modules/, etc. are all reachable at the same URLs the dashboard client
  // code expects.
  //
  // We deliberately do NOT set express.static('public/') — this repo doesn't
  // have a public/ subdirectory; the static files live at the repo root
  // (index.html, assets/app.js, etc.). This matches DEPLOY.md.
  app.use(express.static(REPO_ROOT, {
    // /assets/* on Cloudflare Pages uses no-cache, must-revalidate (see
    // _headers). Mirror to avoid stale assets after a fresh install pulls
    // updates via git pull + docker compose up.
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
    index: 'index.html',
    extensions: ['html'],
  }));

  const { mounted, skipped } = await discoverAndMount(app);
  console.log(`[server] mounted ${mounted.length} api routes`);
  if (skipped.length > 0) {
    console.log(`[server] skipped ${skipped.length} api files:`, skipped);
  }

  // Fallback: if no other route matched an /api/* request, 404 as JSON so
  // clients don't get the static-file 404 HTML.
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, message: `no api route for ${req.method} ${req.originalUrl}` });
  });

  const version = await readVersion();
  app.locals.genusVersion = version;
  // Surface to handlers via env (health.js reads env.GENUS_VERSION so its
  // response includes the boot-time-resolved value even before roles.json
  // / substrate is present).
  if (!process.env.GENUS_VERSION) process.env.GENUS_VERSION = version;

  app.listen(PORT, () => {
    console.log(`Genus is running at http://localhost:${PORT}`);
    console.log(`[server] storage mode: ${process.env.GENUS_STORAGE_MODE || 'local-fs'}`);
    console.log(`[server] bus root: ${process.env.GENUS_BUS_ROOT || './bus'}`);
    console.log(`[server] local mode: ${process.env.GENUS_LOCAL_MODE === '1' ? 'on' : 'off'}`);
    console.log(`[server] version: ${version}`);
  });
}

main().catch(e => {
  console.error('[server] fatal boot error:', e);
  process.exit(1);
});

// Export the version reader for /api/health to read via app.locals.
export { readVersion };
