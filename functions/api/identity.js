// GET /api/identity
//
// Returns the resolved viewer identity for this request: their email, role,
// venture access, and display fields. The dashboard fetches this once at boot
// to drive the operator chip, role pill, observer-mode body class, and
// venture-switcher entries.
//
// Per GEN-107: roles.json is server-side only. The client never sees the full
// roster — only its own resolved identity.

import { getViewerIdentity } from './_identity.js';
import { jsonResponse } from './_gh.js';

export async function onRequestGet({ request, env }) {
  let viewer;
  try { viewer = await getViewerIdentity(request, env); }
  catch (e) { return jsonResponse(e.status || 500, { ok: false, message: e.message || String(e) }); }
  return jsonResponse(200, { ok: true, viewer });
}
