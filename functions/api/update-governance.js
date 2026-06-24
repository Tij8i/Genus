// POST /api/update-governance
//
// Operator changes a Governance gauge (Delegation / Trust / Speed) from the
// dashboard. Mirrors the legacy Orchestrator Python endpoint of the same name
// (see Orchestrator dashboard/public/assets/tuto.js updateGauge()), but writes
// via the GitHub Contents API instead of a localhost Flask backend so the
// deployed CF Pages dashboard can drive the change.
//
// Body: { bu, gauge, new_level, actor?, rationale? }
//   - bu: BU slug (defaults to "tuto")
//   - gauge: "delegation" | "trust" | "speed"
//   - new_level: "off" | "cautious" | "balanced" | "bold" | "autonomous"
//
// Side effects on governance.json at dashboard/public/data/bus/{bu}/governance.json:
//   - gauges[gauge].current = new_level
//   - gauges[gauge].set_at / set_by / set_with_override_warning updated
//   - audit_log entry appended with maturity_at_change snapshot

import { getFile, putFile, jsonResponse, todayISO, GITHUB_REPO } from './_gh.js';
import { requireAdmin } from './_identity.js';

const VALID_GAUGES = new Set(['delegation', 'trust', 'speed']);
const LEVELS = ['off', 'cautious', 'balanced', 'bold', 'autonomous'];

function levelIndex(v) {
  const i = LEVELS.indexOf((v || '').toString().toLowerCase());
  return i < 0 ? 0 : i;
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });
  const gate = await requireAdmin(request, env);
  if (gate instanceof Response) return gate;

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const gauge = (body.gauge || '').toString().toLowerCase();
  const newLevel = (body.new_level || '').toString().toLowerCase();
  const actor = (body.actor || 'operator').toString();
  const rationale = (body.rationale || 'Set via dashboard governance card').toString();

  if (!VALID_GAUGES.has(gauge)) return jsonResponse(400, { ok: false, message: `gauge must be one of: ${[...VALID_GAUGES].join(', ')}` });
  if (!LEVELS.includes(newLevel)) return jsonResponse(400, { ok: false, message: `new_level must be one of: ${LEVELS.join(', ')}` });

  const path = `dashboard/public/data/bus/${bu}/governance.json`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }

  let doc;
  try { doc = JSON.parse(current.content); }
  catch (e) { return jsonResponse(500, { ok: false, message: `Parse error: ${e}` }); }

  doc.gauges = doc.gauges || {};
  doc.gauges[gauge] = doc.gauges[gauge] || {};
  const prevLevel = (doc.gauges[gauge].current || 'off').toString().toLowerCase();

  if (prevLevel === newLevel) {
    return jsonResponse(200, {
      ok: true, no_op: true,
      previous_level: prevLevel, new_level: newLevel,
      override_warning_shown: false,
      commit_sha: null,
    });
  }

  const matLevel = ((doc.maturity || {})[gauge] || {}).level || 'off';
  const overrideWarning = levelIndex(newLevel) > levelIndex(matLevel);

  const now = todayISO();
  doc.gauges[gauge].current = newLevel;
  doc.gauges[gauge].set_at = now;
  doc.gauges[gauge].set_by = actor;
  doc.gauges[gauge].set_with_override_warning = overrideWarning;

  doc.audit_log = doc.audit_log || [];
  doc.audit_log.push({
    at: now,
    actor,
    change: `${gauge}: ${prevLevel} → ${newLevel}`,
    rationale,
    maturity_at_change: {
      delegation: ((doc.maturity || {}).delegation || {}).level || 'off',
      trust: ((doc.maturity || {}).trust || {}).level || 'off',
      speed: ((doc.maturity || {}).speed || {}).level || 'off',
    },
    override_warning_shown: overrideWarning,
  });

  const newContent = JSON.stringify(doc, null, 2) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `governance: ${gauge} ${prevLevel} → ${newLevel} (${bu})`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, {
    ok: true,
    previous_level: prevLevel,
    new_level: newLevel,
    override_warning_shown: overrideWarning,
    commit_sha: commit.commit?.sha || null,
    repo: GITHUB_REPO,
  });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
