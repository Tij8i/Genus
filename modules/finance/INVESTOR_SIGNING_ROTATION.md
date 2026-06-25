# Investor URL signing — secret rotation procedure

**Status**: dev-only secret in tree. **MUST rotate before any real Medivara investor sees a URL.**

## Current state (Session #18, 2026-06-25)

Dev-only signing secret hard-coded inline at `investor.html`:

```
DEV_SIGNING_SECRET = 'medivara-dev-only-rotate-before-prod-9c5a'
```

Per locked decision Q3=B (Session #18 preliminary): "I generate a dev-only secret + commit a doc explaining how to rotate it."

This is **not** suitable for real investor URLs. Anyone with the dev secret (which is in the public Genus repo) can forge tokens.

## How to construct an investor URL (dev / fixture / smoke test)

The token is `HMAC-SHA256(secret, "<bu>|<expires_epoch_seconds>")`, hex-encoded.

```bash
# Example — fires a 30-day investor link for Medivara
python3 - <<'PY'
import hmac, hashlib, time
SECRET = "medivara-dev-only-rotate-before-prod-9c5a"
bu = "medivara"
expires = int(time.time()) + 30 * 86400  # 30 days from now
payload = f"{bu}|{expires}"
sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
print(f"https://genus-v06.pages.dev/investor.html?bu={bu}&e={expires}&token={sig}")
PY
```

## Rotation procedure (before real production traffic)

1. **Generate a strong secret** (32+ random bytes):
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```

2. **Move signing + verification server-side** — currently `investor.html` performs client-side HMAC verification using a constant. That is by definition not secure. Production must:
   - Replace the in-page verification with a call to a Cloudflare Pages Function (e.g. `/api/investor-verify`) that holds the secret in an env var binding.
   - Function rejects the request before the substrate fetch can fire.

3. **Set the secret as a Pages env var**:
   - Cloudflare Pages → Project `genus-v06` → Settings → Environment variables → Production → Add `INVESTOR_SIGNING_SECRET` with the new secret.
   - Make it a "Secret" type (encrypted at rest).

4. **Update token-generation tooling** to pull the secret from env / 1Password / SOPS — never commit a real secret.

5. **Invalidate all previously issued tokens** by rotating the secret.

6. **Rotate cadence**: every 90 days, or immediately after any suspected leak.

## Production migration trigger

Per SPEC §13.3 — when Medivara contract lands and per-investor login is available (depends on the multi-tenant Initiative — currently deferred), drop the signed-URL model entirely in favor of email-based authentication.

Until that lands, even a server-side-verified signed URL is the bridge mechanism.
