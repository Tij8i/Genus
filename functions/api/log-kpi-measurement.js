// POST /api/log-kpi-measurement
// Appends a measurement row to data/bus/<bu>/measurements/<kpi_id>.jsonl.
//
// Body: { bu, kpi_id, value, notes?, source? }
//
// Per the legacy Orchestrator dashboard (Tij8i/Orchestrator/dashboard/public/assets/tuto.js).
// Numeric coercion is best-effort — non-numeric values pass through as strings so
// binary/milestone KPIs (value "done" / 0/1) and free-text captures still work.

import { getFile, putFile, jsonResponse, todayISO, ghHeaders, GITHUB_REPO, BRANCH } from './_gh.js';

const KPI_ID_RE = /^[A-Za-z0-9_.-]+$/;

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || 'tuto').toString();
  const kpi_id = (body.kpi_id || '').toString().trim();
  const valueRaw = body.value;
  const notes = body.notes != null ? String(body.notes).trim() || null : null;
  const source = body.source != null ? String(body.source).trim() || null : null;

  if (!kpi_id || !KPI_ID_RE.test(kpi_id)) {
    return jsonResponse(400, { ok: false, message: 'kpi_id is required and must match [A-Za-z0-9_.-]+' });
  }
  if (valueRaw == null || String(valueRaw).trim() === '') {
    return jsonResponse(400, { ok: false, message: 'value is required' });
  }

  const num = Number(valueRaw);
  const value = Number.isFinite(num) ? num : String(valueRaw).trim();

  const path = `dashboard/public/data/bus/${bu}/measurements/${kpi_id}.jsonl`;

  // measurements/<kpi_id>.jsonl may not exist yet — treat 404 as "empty file".
  let current = { sha: undefined, content: '' };
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) {
    if (e.status !== 404) {
      return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
    }
  }

  const row = {
    kpi_id,
    bu,
    value,
    captured_at: todayISO(),
    captured_by: 'operator',
    source: source || 'dashboard_log_value',
    notes,
  };

  const sep = current.content && !current.content.endsWith('\n') ? '\n' : '';
  const newContent = current.content + sep + JSON.stringify(row) + '\n';
  const valueLabel = typeof value === 'number'
    ? (Number.isInteger(value) ? String(value) : value.toFixed(2))
    : String(value);
  let commit;
  try {
    commit = await putFile(
      env.GITHUB_PAT, path, newContent, current.sha,
      `measurements/${kpi_id}: log ${valueLabel}${notes ? ` (${notes.slice(0, 50)}${notes.length > 50 ? '…' : ''})` : ''}`,
    );
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, measurement: row, commit_sha: commit.commit.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
