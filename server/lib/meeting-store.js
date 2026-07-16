// Meetings substrate IO (i56 postfix2 — meeting server Node port).
//
// Reads/writes bus/<bu>/meetings.json via the storage abstraction, so behaviour
// stays consistent whether the install uses local-fs (Docker) or a future
// GitHub-backed mode. Meetings themselves are plain records — id, agent, bu,
// title, purpose, status, started_at, closed_at, transcript[].
//
// Contract mirrors the Python launchd server so the dashboard client behaves
// the same on both runtimes.

import { getFile, putFile } from '../storage/index.js';

const PAT_PLACEHOLDER = 'local-mode-no-pat';

function meetingsPath(bu) {
  return `dashboard/public/data/bus/${bu}/meetings.json`;
}

export async function loadMeetings(bu) {
  try {
    const { content } = await getFile(PAT_PLACEHOLDER, meetingsPath(bu));
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // 404 or empty file → empty list; either shape is safe to write on first save.
    if (e && (e.status === 404 || /not.?found/i.test(e.message || ''))) return [];
    throw e;
  }
}

export async function saveMeetings(bu, meetings) {
  // Best-effort: re-read the existing sha so we don't 409 when the file exists.
  let sha;
  try { ({ sha } = await getFile(PAT_PLACEHOLDER, meetingsPath(bu))); }
  catch { sha = undefined; }
  const body = JSON.stringify(meetings, null, 2) + '\n';
  await putFile(
    PAT_PLACEHOLDER,
    meetingsPath(bu),
    body,
    sha,
    'meetings: sync from meeting server',
  );
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function nextMeetingId(meetings, today = todayDate()) {
  const prefix = `meeting-${today}-`;
  const n = meetings.filter(m => (m.id || '').startsWith(prefix)).length + 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}
