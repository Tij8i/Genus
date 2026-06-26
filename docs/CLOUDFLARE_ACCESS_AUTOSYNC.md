# Cloudflare Access auto-sync — setup runbook

When configured, every call to `/api/people-edit` (add/edit/remove a user) also rewrites the Cloudflare Access policy's email include list to match `roles.json`. Single source of truth becomes `roles.json`; the Access allow-list follows automatically.

If env vars are not set, the sync is silently skipped — the dashboard works exactly as before, and Cloudflare Access edits stay manual.

---

## What you need

Four Pages env vars on the `genus-v06` project:

| Variable | Type | Where to find it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | You generate it (step 1 below) |
| `CLOUDFLARE_ACCOUNT_ID` | Plain | Cloudflare dashboard → right sidebar, "Account ID" |
| `CLOUDFLARE_ACCESS_APP_UUID` | Plain | Zero Trust → Access → Applications → click `genus-v06` → URL shows `…/applications/{uuid}/` |
| `CLOUDFLARE_ACCESS_POLICY_UUID` | Plain | Inside that app → Policies → click the Allow policy → URL shows `…/policies/{uuid}/` (or query the API) |

---

## Step-by-step

### 1. Generate the API token

1. Cloudflare dashboard → **My Profile** (top right) → **API Tokens** → **Create Token**
2. Start with the **Custom Token** template
3. Token name: `Genus dashboard — Access policy sync`
4. Permissions — add exactly one:
   - **Account** → **Access: Apps and Policies** → **Edit**
5. Account Resources: **Include → Your account** (pick the one with the Zero Trust org)
6. Optional: set an IP allow-list (Cloudflare Pages egress IPs are not stable, so leave open)
7. Continue to summary → Create Token
8. **Copy the token now** — Cloudflare only shows it once

### 2. Collect the 3 UUIDs

**Account ID**: Cloudflare dashboard → any page → right sidebar → "Account ID" → copy.

**Access App UUID + Policy UUID**:
- Zero Trust → Access → Applications → click `genus-v06`
- The browser URL is `https://one.dash.cloudflare.com/{account_id}/access/apps/{app_uuid}/policies` → copy the `{app_uuid}` segment
- Click the existing Allow policy (the one that currently lists your email)
- The URL now ends in `…/policies/{policy_uuid}/edit` → copy the `{policy_uuid}` segment

If the policy UUID is hard to find via the UI, use curl:
```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/apps/{app_uuid}/policies" \
  -H "Authorization: Bearer {api_token}" | jq '.result[] | { id, name, decision }'
```
Pick the policy whose `decision: "allow"` covers your dashboard.

### 3. Set the env vars in Cloudflare Pages

1. Cloudflare dashboard → **Pages** → click the `genus-v06` project
2. **Settings** tab → **Environment variables**
3. Under **Production**, add each variable:
   - `CLOUDFLARE_API_TOKEN` → paste token → mark as **Secret** (encrypts at rest)
   - `CLOUDFLARE_ACCOUNT_ID` → paste account ID (plain text is fine)
   - `CLOUDFLARE_ACCESS_APP_UUID` → paste app UUID
   - `CLOUDFLARE_ACCESS_POLICY_UUID` → paste policy UUID
4. Click **Save** at the bottom
5. Cloudflare auto-redeploys; Functions pick up the new vars in ~30 sec

### 4. Verify

1. Open the dashboard → People → click **Add a person**
2. Add a test email
3. Open Cloudflare dashboard → Zero Trust → Access → Applications → `genus-v06` → Policies → click the Allow policy
4. The test email should be in the **Include** list

If it's not: open the dashboard's DevTools → Network → find the `/api/people-edit` POST response. Look at `access_sync`:
- `{ ok: true, synced: N }` → it worked
- `{ ok: false, status, message }` → check the message; usually a permission scope or wrong UUID
- `{ ok: true, skipped: "not_configured" }` → one of the four env vars wasn't set

### 5. Clean up

Once the auto-sync is verified, remove any test entries you added. Real users you add to the dashboard from now on will appear in the Cloudflare Access allow-list automatically.

---

## What gets preserved

The sync only rewrites the `include` array. It preserves: policy name, decision (allow/deny/bypass), exclude rules, require rules, session duration, precedence, approval/isolation/justification flags.

It only emits **single-email** rules — one `{ email: { email: "..." } }` per `roles.json` user. If your policy currently uses an "Emails ending in @domain" rule (group/domain match), the first sync replaces that with individual emails. If you want to keep a domain-fallback alongside the explicit list, edit the policy after the sync to re-add the domain rule under Include (it survives subsequent syncs because the sync only touches the email entries it owns — actually correction: current implementation rewrites the whole `include[]`. If you need hybrid, file a follow-up to make sync additive only for email-entries).

## Rotation

API tokens expire / get rotated. When you rotate:
1. Generate a new token (step 1)
2. Update `CLOUDFLARE_API_TOKEN` in Pages env vars
3. Cloudflare auto-redeploys
4. Old token can be deleted in Cloudflare → My Profile → API Tokens

## Disable auto-sync

Remove (or rename) any of the 4 env vars. Sync silently skips on next mutation. `roles.json` writes still succeed; Access edits become manual again.
