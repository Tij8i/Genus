// GET /api/wiring-status (Cloudflare Pages Functions mirror)
//
// The edge runtime cannot reach the operator's localhost:3100 / :8765 to
// probe Paperclip or the meeting server, so this returns a shape the UI
// treats as "unknown" — with a note explaining that live probes only work
// from the local Node install. See server/api/wiring-status.js for the
// real probes.

import { jsonResponse, todayISO } from './_gh.js';

export function onRequestGet() {
  const unknown = (label) => ({
    status: 'unknown',
    message: `${label} lives on the operator's laptop; the edge deploy cannot probe it. Run Genus locally to see live status.`,
  });
  return jsonResponse(200, {
    ok: true,
    runtime: 'cloudflare-pages-functions',
    probes_available: false,
    checked_at: todayISO(),
    probes: {
      paperclip:      unknown('Paperclip runtime'),
      meeting_server: unknown('Meeting server'),
      adapter:        unknown('Adapter'),
    },
  });
}
