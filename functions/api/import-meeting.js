// POST /api/import-meeting
//
// Imports a structured meeting note (typically from Granola, Otter, or any
// external recorder) as a memo of type='meeting_note' in the BU's memos.jsonl.
// The Stewards covering the referenced areas pick it up on next heartbeat —
// same processing pipeline as an operator-typed memo, just typed differently
// so views can filter it out / treat it specifically.
//
// Body shape:
//   { bu, area_refs?, title, source?, source_id?, source_url?,
//     meeting_date?, duration_minutes?, attendees?[], summary?, decisions?[],
//     action_items?[], transcript? }
//
// Required: bu, title (+ at least one of summary / decisions / action_items / transcript)
//
// Auth: same Cloudflare Access gate as create-memo. (External Claude
// instances calling this would use a scoped REST token via the
// external_access_edit middleware once that ships — for now: cookie auth.)

import { getFile, putFile, jsonResponse, todayISO, todayDate } from './_gh.js';
import { requireAdmin } from './_identity.js';
import { requireExternalRead } from './_external_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_PAT) return jsonResponse(500, { ok: false, message: 'GITHUB_PAT not set' });

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { ok: false, message: 'Invalid JSON' }); }

  const bu = (body.bu || '').toString().trim();
  const title = (body.title || '').toString().trim();
  if (!bu) return jsonResponse(400, { ok: false, message: 'bu is required' });
  if (!title) return jsonResponse(400, { ok: false, message: 'title is required' });

  // i38: BU-isolation on mutation — allow external Bearer (scope=write) OR admin gated to bu.
  const external = await requireExternalRead(request, env, { bu, scope: 'write', jsonResponse });
  if (external instanceof Response) return external;
  if (external === null) {
    const gate = await requireAdmin(request, env, { bu });
    if (gate instanceof Response) return gate;
  }

  const summary = (body.summary || '').toString().trim();
  const transcript = (body.transcript || '').toString().trim();
  const decisions = Array.isArray(body.decisions) ? body.decisions.filter(d => typeof d === 'string' && d.trim()) : [];
  const action_items = Array.isArray(body.action_items) ? body.action_items.filter(a => a && typeof a === 'object') : [];

  if (!summary && !transcript && decisions.length === 0 && action_items.length === 0) {
    return jsonResponse(400, { ok: false, message: 'Need at least one of: summary, transcript, decisions[], action_items[]' });
  }

  const area_refs = Array.isArray(body.area_refs) ? body.area_refs.filter(a => typeof a === 'string') : [];
  const source = (body.source || 'paste').toString();
  const source_id = body.source_id ? body.source_id.toString() : null;
  const source_url = body.source_url ? body.source_url.toString() : null;
  const meeting_date = body.meeting_date ? body.meeting_date.toString() : null;
  const duration_minutes = typeof body.duration_minutes === 'number' ? body.duration_minutes : null;
  const attendees = Array.isArray(body.attendees) ? body.attendees.filter(a => a && typeof a === 'object') : [];

  // Compose a structured markdown body. Stewards read this at heartbeat;
  // structure matters more than prose.
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (meeting_date || duration_minutes != null) {
    const bits = [];
    if (meeting_date) bits.push(`📅 ${meeting_date}`);
    if (duration_minutes != null) bits.push(`⏱ ${duration_minutes} min`);
    lines.push(bits.join(' · '));
    lines.push('');
  }
  if (attendees.length > 0) {
    lines.push('## Attendees');
    for (const a of attendees) {
      const name = (a.name || a.email || '?').toString();
      const email = a.email && a.email !== name ? ` (${a.email})` : '';
      lines.push(`- ${name}${email}`);
    }
    lines.push('');
  }
  if (summary) {
    lines.push('## Summary');
    lines.push(summary);
    lines.push('');
  }
  if (decisions.length > 0) {
    lines.push('## Decisions');
    for (const d of decisions) lines.push(`- ${d}`);
    lines.push('');
  }
  if (action_items.length > 0) {
    lines.push('## Action items');
    for (const it of action_items) {
      const text = (it.text || '').toString();
      const owner = it.owner ? ` — _${it.owner}_` : '';
      const due = it.due ? ` (due ${it.due})` : '';
      lines.push(`- ${text}${owner}${due}`);
    }
    lines.push('');
  }
  if (transcript) {
    lines.push('## Transcript');
    lines.push(transcript);
    lines.push('');
  }
  const memoBody = lines.join('\n').trim();

  const path = `dashboard/public/data/bus/${bu}/memos.jsonl`;
  let current;
  try { current = await getFile(env.GITHUB_PAT, path); }
  catch (e) {
    if (e.status === 404) {
      current = { content: '', sha: null };
    } else {
      return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
    }
  }

  const today = todayDate();
  const existingToday = current.content.split('\n').filter(l => l.trim() && l.includes(`"memo-${today}-`));
  const nextNum = String(existingToday.length + 1).padStart(3, '0');
  const id = `memo-${today}-${nextNum}`;

  const memo = {
    id,
    bu,
    created_at: todayISO(),
    created_by: 'operator',
    level: 'system',
    target: null,
    body: memoBody,
    type: 'meeting_note',
    area_refs,
    source,
    source_id,
    source_url,
    meeting_date,
    duration_minutes,
    attendees,
    status: 'unprocessed',
    processed_by: null,
    processed_at: null,
    applied_to: [],
  };

  const newContent = (current.content || '') + (current.content && !current.content.endsWith('\n') ? '\n' : '') + JSON.stringify(memo) + '\n';
  let commit;
  try {
    commit = await putFile(env.GITHUB_PAT, path, newContent, current.sha, `memos: import-meeting ${id} — ${title.slice(0, 50)}${title.length > 50 ? '…' : ''}`);
  } catch (e) {
    return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) });
  }

  return jsonResponse(200, { ok: true, memo, commit_sha: commit.commit?.sha });
}

export function onRequestGet() {
  return jsonResponse(405, { ok: false, message: 'POST only.' });
}
