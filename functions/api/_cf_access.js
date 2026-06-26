// Cloudflare Access policy auto-sync.
//
// When /api/people-edit mutates roles.json, this helper rewrites the Cloudflare
// Access policy's email include list to match. Single source of truth becomes
// roles.json; the Access allow-list follows automatically.
//
// Requires four Pages env vars (set in Cloudflare Pages → Project → Settings →
// Environment variables → Production):
//
//   CLOUDFLARE_API_TOKEN          - secret; needs `Access: Apps and Policies: Edit`
//   CLOUDFLARE_ACCOUNT_ID         - your account UUID (Cloudflare dashboard → right sidebar)
//   CLOUDFLARE_ACCESS_APP_UUID    - the genus-v06 app UUID (Zero Trust → Access → Applications → genus-v06 → URL)
//   CLOUDFLARE_ACCESS_POLICY_UUID - the policy UUID inside that app
//
// If any are unset, sync is silently skipped (caller continues — roles.json is
// still authoritative, drift just means manual Access edits). Failures are
// returned to the caller as a non-fatal status object.

const CF_API = 'https://api.cloudflare.com/client/v4';

export function isAccessSyncConfigured(env) {
  return !!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID
            && env.CLOUDFLARE_ACCESS_APP_UUID && env.CLOUDFLARE_ACCESS_POLICY_UUID);
}

// Rewrite the policy's include list to match the supplied emails. Preserves
// the policy's name + decision + exclude/require rules; only include is replaced
// with one email-rule per emails[].
//
// Returns: { ok, skipped?: 'not_configured' | true, status?, message?, synced?: number }
export async function syncAccessEmails(env, emails) {
  if (!isAccessSyncConfigured(env)) return { ok: true, skipped: 'not_configured' };

  const acct = env.CLOUDFLARE_ACCOUNT_ID;
  const app = env.CLOUDFLARE_ACCESS_APP_UUID;
  const pol = env.CLOUDFLARE_ACCESS_POLICY_UUID;
  const token = env.CLOUDFLARE_API_TOKEN;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1) Fetch existing policy to preserve fields we don't touch
  let current;
  try {
    const r = await fetch(`${CF_API}/accounts/${acct}/access/apps/${app}/policies/${pol}`, { headers });
    const j = await r.json();
    if (!r.ok || !j.success) {
      return { ok: false, status: r.status, message: 'Could not GET policy: ' + JSON.stringify(j.errors || j) };
    }
    current = j.result;
  } catch (e) {
    return { ok: false, message: 'Network GET policy: ' + (e.message || String(e)) };
  }

  // 2) Build new include list — one { email: { email } } per address
  const cleaned = Array.from(new Set(emails.map(e => (e || '').toString().trim().toLowerCase()).filter(Boolean)));
  const newInclude = cleaned.map(e => ({ email: { email: e } }));

  // 3) PUT updated policy
  const payload = {
    name: current.name || 'Genus dashboard allow',
    decision: current.decision || 'allow',
    include: newInclude,
    exclude: current.exclude || [],
    require: current.require || [],
    precedence: current.precedence,
    session_duration: current.session_duration,
    approval_required: current.approval_required,
    isolation_required: current.isolation_required,
    purpose_justification_required: current.purpose_justification_required,
    purpose_justification_prompt: current.purpose_justification_prompt,
  };
  // Strip undefined keys (Cloudflare API rejects unknown nulls in some places)
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  try {
    const r = await fetch(`${CF_API}/accounts/${acct}/access/apps/${app}/policies/${pol}`, {
      method: 'PUT', headers, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.success) {
      return { ok: false, status: r.status, message: 'Could not PUT policy: ' + JSON.stringify(j.errors || j) };
    }
    return { ok: true, synced: cleaned.length };
  } catch (e) {
    return { ok: false, message: 'Network PUT policy: ' + (e.message || String(e)) };
  }
}
