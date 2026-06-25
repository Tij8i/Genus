# Investor URL signing — secret rotation procedure

**Status**: dev-only secret in tree. **MUST rotate before any real Medivara investor sees a URL.**

## Current state (Session #18, 2026-06-25)

Dev-only signing secret hard-coded inline at `investor.html`:

```
DEV_SIGNING_SECRET = 'medivara-dev-only-rotate-before-prod-9c5a'
```

Per locked decision Q3=B (Session #18 preliminary): "dev-only secret + commit a doc explaining how to rotate."

This is **not** suitable for real investor URLs.

## How to construct an investor URL (dev / fixture / smoke test)

```bash
python3 - <<'PY'
import hmac, hashlib, time
SECRET = "medivara-dev-only-rotate-before-prod-9c5a"
bu = "medivara"
expires = int(time.time()) + 30 * 86400
payload = f"{bu}|{expires}"
sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
print(f"https://genus-v06.pages.dev/investor.html?bu={bu}&e={expires}&token={sig}")
PY
```

## Production-readiness checklist

Before any real investor receives a URL:

1. **Cloudflare Access exemption for `/investor.html`** — *(production gap surfaced 2026-06-25)* the entire `genus-v06.pages.dev` domain is currently behind Cloudflare Access. Investors will not have Genus accounts and will hit the Access login wall. Configure Access to exempt the `/investor.html` path so anyone with a valid signed token can reach the page directly.
2. **Move signing + verification server-side** — replace the in-page HMAC verification with a Cloudflare Pages Function (e.g. `/api/investor-verify`) that holds the secret in an env var binding. Function rejects before the substrate fetch fires.
3. **Generate a strong secret** (32+ random bytes): `python3 -c "import secrets; print(secrets.token_hex(32))"`.
4. **Set the secret as a Pages env var**: Cloudflare Pages → Project `genus-v06` → Settings → Environment variables → Production → `INVESTOR_SIGNING_SECRET` (Secret type).
5. **Update token-generation tooling** to read the secret from env / 1Password / SOPS — never commit a real secret.
6. **Invalidate previously issued tokens** by rotating the secret.
7. **Rotate cadence**: every 90 days or immediately after any suspected leak.

## Production migration trigger

Per SPEC §13.3 — when Medivara contract lands and per-investor login is available (depends on the multi-tenant Initiative), drop the signed-URL model entirely in favor of email-based authentication.

Until then, even a server-side-verified signed URL (with Access exemption + production secret) is the bridge mechanism.
