// GET /api/paperclip-status — is the Paperclip runtime reachable + onboarded?
//
// Called by the dashboard on boot (assets/paperclip-banner.js) to surface the
// "Agent JWT: missing (run `pnpm paperclipai onboard`)" state that first-time
// operators would otherwise only see if they read Paperclip's stdout in the
// docker-compose console. Without this banner, fresh installs look broken
// because chat + task-push both silently fail against an un-onboarded
// Paperclip container.
//
// Returns:
//   { ok: true, reachable, onboarded, jwt_present, url, hint? }
//
// - reachable — did Paperclip respond at all?
// - onboarded — best-effort: does the response indicate a completed onboard?
// - jwt_present — best-effort: does an agent JWT exist?
// - hint — copy-paste-ready command the operator should run if not onboarded

import { jsonResponse } from '../storage/index.js';

// Detect the "Agent JWT: missing" state by scanning Paperclip's /health JSON.
// Paperclip's health payload is not versioned; we look for the keywords
// present in the console banner (Screenshot IMG_8787): `Agent JWT`, `missing`,
// `onboard`. Keeps the check resilient to schema tweaks.
function looksNotOnboarded(payload) {
  if (!payload || typeof payload !== 'object') return true;
  const s = JSON.stringify(payload).toLowerCase();
  // Explicit signal — Paperclip surfaces this in banner text and often in
  // health JSON when the auth store is empty.
  if (s.includes('agent jwt') && s.includes('missing')) return true;
  if (s.includes('onboard') && (s.includes('required') || s.includes('needed') || s.includes('run '))) return true;
  // Some Paperclip builds expose `hasJwt` / `jwtPresent` / `onboarded` fields.
  if (payload.hasJwt === false || payload.jwtPresent === false || payload.onboarded === false) return true;
  if (payload.agent_jwt === null || payload.agent_jwt === 'missing') return true;
  return false;
}

const ONBOARD_HINT = 'docker compose exec paperclip npx paperclipai onboard';

export async function onRequestGet({ env }) {
  const url = env.PAPERCLIP_URL || 'http://paperclip:3100';

  // Try Paperclip's health endpoint. Short timeout — this fires on every
  // dashboard boot, must not delay the UI.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  let reachable = false;
  let onboarded = null;    // null = unknown / cannot tell
  let jwt_present = null;
  let raw = null;

  try {
    const resp = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { 'accept': 'application/json' },
    });
    // A response of any status means Paperclip is reachable on the network.
    // 401 / 403 specifically signal "reachable but auth-gated" — i.e., Paperclip
    // is running but no Agent JWT / admin session has been onboarded yet, which
    // is exactly the onboarding state we want to surface.
    reachable = true;
    if (resp.status === 401 || resp.status === 403) {
      // Auth-gated: reachable + definitively not onboarded.
      onboarded = false;
      jwt_present = false;
    } else if (resp.ok) {
      try {
        raw = await resp.json();
      } catch {
        // Non-JSON body (e.g. HTML landing page) — treat as reachable but unknown.
        raw = null;
      }
    }
  } catch (_e) {
    // Timeout, DNS failure, connection refused. Container may still be starting
    // OR Paperclip isn't installed at all.
    reachable = false;
  } finally {
    clearTimeout(timeout);
  }

  // If we haven't already set onboarded from a 401/403 above and we got a
  // JSON payload, derive from its content.
  if (onboarded === null && reachable && raw) {
    const notOnboarded = looksNotOnboarded(raw);
    onboarded = !notOnboarded;
    if (raw.jwtPresent != null) jwt_present = !!raw.jwtPresent;
    else if (raw.hasJwt != null) jwt_present = !!raw.hasJwt;
    else if (raw.agent_jwt != null) jwt_present = raw.agent_jwt !== 'missing';
    else jwt_present = onboarded;
  }

  const body = {
    ok: true,
    url,
    reachable,
    onboarded,
    jwt_present,
  };
  // Surface the copy-paste command whenever onboarded is anything other than
  // a confirmed `true`. Being over-inclusive is fine — the operator can
  // dismiss the banner in one click.
  if (onboarded !== true) {
    body.hint = ONBOARD_HINT;
    body.hint_reason = reachable
      ? 'Paperclip is up but hasn\'t been onboarded yet — the CLI step below creates the Agent JWT Genus needs to push tasks.'
      : 'Paperclip container isn\'t reachable yet. If it just started, wait a few seconds. If it\'s been a minute, check `docker compose ps` and `docker compose logs paperclip`.';
  }

  return jsonResponse(200, body);
}
