// POST /api/update-module-settings
//
// Operator changes a module's per-installation settings from the dashboard.
// Writes to dashboard/public/data/bus/<bu>/modules/<module>/settings.json on
// the Orchestrator substrate so the next module heartbeat picks them up
// (per GEN-136 acceptance criterion #2).
//
// Body: { bu, module, settings, expectedSha?, rationale? }
//   - bu: BU slug (defaults to "medivara" — first install target per SPEC §0)
//   - module: module name (e.g. "finance")
//   - settings: object matching modules/<module>/settings.schema.json
//   - expectedSha: optional sha of the file the operator's form was based on,
//     for optimistic-concurrency rejects on mid-air collisions
//
// Schema validation runs the subset of JSON Schema we actually use
// (required / type / pattern / minimum / maximum / enum / additionalProperties).
// Tight enough to keep junk out of substrate, loose enough to avoid pulling a
// full JSON Schema runtime into the Pages Function bundle.

import { getFile, putFile, jsonResponse, todayISO, GITHUB_REPO } from './_gh.js';
import { requireAdmin } from './_identity.js';

const MODULE_REGISTRY = {
  finance: {
    substrateRel: 'modules/finance/settings.json',
    auditRel: 'modules/finance/settings_audit.jsonl',
  },
};

const FINANCE_SETTINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['moneybird', 'alerts'],
  properties: {
    moneybird: {
      type: 'object',
      additionalProperties: false,
      required: ['connector_ref'],
      properties: {
        connector_ref: { type: 'string', pattern: '^connectors/[a-z0-9-]+/[a-z0-9-]+$' },
        endpoint_override: { type: 'string' },
        auth_token_ref: { type: 'string', pattern: '^secrets/[a-z0-9/_-]+$' },
        healthcheck_route: { type: 'string', pattern: '^/[a-zA-Z0-9/_.-]*$' },
      },
    },
    alerts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        runway_days_warning: { type: 'integer', minimum: 1 },
        runway_days_critical: { type: 'integer', minimum: 1 },
        burn_variance_warning_pct: { type: 'number', minimum: 0, maximum: 200 },
        draw_vs_runway_conflict_days: { type: 'integer', minimum: 1 },
      },
    },
    digest: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        day_of_month: { type: 'integer', minimum: 1, maximum: 28 },
        include_categories: {
          type: 'array',
          items: { type: 'string', enum: ['cash', 'revenue', 'costs', 'runway', 'recommendations'] },
        },
      },
    },
    recommendations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        expense_recategorization_enabled: { type: 'boolean' },
        founder_draw_adjustment_enabled: { type: 'boolean' },
      },
    },
  },
};

function loadSchema(moduleName) {
  if (moduleName === 'finance') return FINANCE_SETTINGS_SCHEMA;
  return null;
}

function validate(value, schema, path = '') {
  const errs = [];
  const typeOf = (v) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (Number.isInteger(v)) return 'integer';
    if (typeof v === 'number') return 'number';
    return typeof v;
  };
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === 'number' ? (t === 'number' || t === 'integer') : t === schema.type;
    if (!ok) errs.push(`${path || '<root>'}: expected ${schema.type}, got ${t}`);
  }
  if (schema.type === 'object' && typeOf(value) === 'object') {
    const props = schema.properties || {};
    const required = schema.required || [];
    for (const r of required) if (!(r in value)) errs.push(`${path}.${r}: required`);
    for (const k of Object.keys(value)) {
      if (props[k]) errs.push(...validate(value[k], props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    const item = schema.items || {};
    value.forEach((v, i) => errs.push(...validate(v, item, `${path}[${i}]`)));
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof schema.pattern === 'string' && typeof value === 'string') {
    if (!new RegExp(schema.pattern).test(value)) errs.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errs.push(`${path}: must be >= ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errs.push(`${path}: must be <= ${schema.maximum}`);
  }
  return errs;
}

function appendJsonlEntry(existingContent, entry) {
  const line = JSON.stringify(entry);
  const base = existingContent && !existingContent.endsWith('\n') ? existingContent + '\n' : (existingContent || '');
  return base + line + '\n';
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'medivara').toString();
  const moduleName = (body.module || '').toString().toLowerCase();
  const settings = body.settings;
  const expectedSha = body.expectedSha || null;
  const rationale = (body.rationale || 'Set via Module Settings page').toString();

  const gate = await requireAdmin(request, env, { bu });
  if (gate instanceof Response) return gate;
  const viewer = gate;

  const registry = MODULE_REGISTRY[moduleName];
  if (!registry) {
    return jsonResponse(400, { ok: false, message: `Unknown module: ${moduleName}. Known: ${Object.keys(MODULE_REGISTRY).join(', ')}` });
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return jsonResponse(400, { ok: false, message: '`settings` must be an object matching settings.schema.json' });
  }

  const schema = loadSchema(moduleName);
  const errs = validate(settings, schema, '');
  if (errs.length) {
    return jsonResponse(400, { ok: false, message: 'Schema validation failed', errors: errs });
  }

  const path = `dashboard/public/data/bus/${bu}/${registry.substrateRel}`;
  const auditPath = `dashboard/public/data/bus/${bu}/${registry.auditRel}`;

  let current = { sha: null, content: '' };
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) {
    if (e.status !== 404) return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  if (expectedSha && current.sha && expectedSha !== current.sha) {
    return jsonResponse(409, {
      ok: false,
      message: 'Settings changed since you loaded them. Reload the page and re-apply.',
      current_sha: current.sha,
    });
  }

  let previous = null;
  if (current.content) {
    try { previous = JSON.parse(current.content); } catch { previous = null; }
  }

  const now = todayISO();
  const newContent = JSON.stringify(settings, null, 2) + '\n';

  let commit;
  try {
    commit = await putFile(
      env.GITHUB_PAT,
      path,
      newContent,
      current.sha,
      `module-settings(${moduleName}): updated by ${viewer.email || 'operator'} (${bu})`,
    );
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  let auditCurrent = { sha: null, content: '' };
  try { auditCurrent = await getFile(env.GITHUB_PAT, auditPath); }
  catch (e) { if (e.status !== 404) console.warn('audit read failed:', e.message || e); }

  const auditEntry = {
    at: now,
    actor: viewer.email || 'operator',
    bu,
    module: moduleName,
    rationale,
    previous,
    next: settings,
  };
  const newAudit = appendJsonlEntry(auditCurrent.content, auditEntry);
  try {
    await putFile(
      env.GITHUB_PAT,
      auditPath,
      newAudit,
      auditCurrent.sha,
      `module-settings(${moduleName}): audit entry (${bu})`,
    );
  } catch (e) {
    console.warn('audit write failed (non-fatal):', e.message || e);
  }

  return jsonResponse(200, {
    ok: true,
    bu,
    module: moduleName,
    path,
    commit_sha: commit.commit?.sha || null,
    new_sha: commit.content?.sha || null,
    repo: GITHUB_REPO,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
