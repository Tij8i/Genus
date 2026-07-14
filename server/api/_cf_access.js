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

  // Cloudflare has two policy shapes:
  //   - App-scoped:    /accounts/{acct}/access/apps/{app}/policies/{pol}
  //   - Reusable:      /accounts/{acct}/access/policies/{pol}  (account-level)
  // Newer Zero Trust setups use reusable policies referenced by apps. Try the
  // reusable endpoint first; fall back to app-scoped if it 404s.
  const reusableUrl = `${CF_API}/accounts/${acct}/access/policies/${pol}`;
  const appScopedUrl = `${CF_API}/accounts/${acct}/access/apps/${app}/policies/${pol}`;

  let current, baseUrl;
  for (const url of [reusableUrl, appScopedUrl]) {
    try {
      const r = await fetch(url, { headers });
      const j = await r.json();
      if (r.ok && j.success) {
        current = j.result;
        baseUrl = url;
        break;
      }
      // 404 = wrong shape, try the other endpoint silently
      if (r.status !== 404) {
        return { ok: false, status: r.status, message: 'Could not GET policy: ' + JSON.stringify(j.errors || j) };
      }
    } catch (e) {
      return { ok: false, message: 'Network GET policy: ' + (e.message || String(e)) };
    }
  }
  if (!current || !baseUrl) {
    return { ok: false, status: 404, message: 'Policy not found at either reusable or app-scoped endpoint — check CLOUDFLARE_ACCESS_POLICY_UUID (and CLOUDFLARE_ACCESS_APP_UUID if app-scoped).' };
  }

  // Build new include list — one { email: { email } } per address
  const cleaned = Array.from(new Set(emails.map(e => (e || '').toString().trim().toLowerCase()).filter(Boolean)));
  const newInclude = cleaned.map(e => ({ email: { email: e } }));

  // Reusable policies require `name` + `decision` at minimum. App-scoped accept
  // a superset. Same payload works for both.
  const payload = {
    name: current.name || 'Genus dashboard allow',
    decision: current.decision || 'allow',
    include: newInclude,
    exclude: current.exclude || [],
    require: current.require || [],
  };
  // Preserve only fields that exist (app-scoped has more; reusable rejects some)
  for (const k of ['session_duration', 'approval_required', 'isolation_required',
                   'purpose_justification_required', 'purpose_justification_prompt']) {
    if (current[k] !== undefined && current[k] !== null) payload[k] = current[k];
  }

  try {
    const r = await fetch(baseUrl, {
      method: 'PUT', headers, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.success) {
      return { ok: false, status: r.status, message: 'Could not PUT policy: ' + JSON.stringify(j.errors || j), endpoint: baseUrl };
    }
    return { ok: true, synced: cleaned.length, endpoint_kind: baseUrl === reusableUrl ? 'reusable' : 'app-scoped' };
  } catch (e) {
    return { ok: false, message: 'Network PUT policy: ' + (e.message || String(e)) };
  }
}
