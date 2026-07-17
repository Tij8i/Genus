#!/usr/bin/env bash
#
# Genus → Paperclip one-command onboarding.
#
# The raw `paperclipai onboard` CLI leaves two sharp edges when run under
# Docker Compose; this wrapper handles both so you get a clean result:
#
#   1. Runs onboard as the `node` user (UID 1000). `docker compose exec`
#      defaults to root, and onboarding-as-root writes .env/config.json owned
#      by root — which the server (running as node) then can't read, so it
#      crash-loops with EACCES on its next restart.
#
#   2. Bridges the onboarding invite server (container port 3101, which is
#      internal to the compose network) to 127.0.0.1 on your host, so you can
#      open the bootstrap-CEO invite URL in a browser. The bridge is removed
#      when you're done.
#
# Usage:  ./scripts/onboard.sh      (run from anywhere in the repo)
#
# macOS/Linux only. Windows users: follow the manual steps in
# docs/install/README.md step 5 (PowerShell has no `docker compose exec -u`
# ergonomics and no socat sidecar).
#
set -uo pipefail

SERVICE=paperclip
CONTAINER=genus-paperclip
FWD=genus-onboard-fwd
PORT=3101

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

cleanup() { docker rm -f "$FWD" >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "✗ docker not found — install/start Docker Desktop first."; exit 1; }

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "✗ Paperclip isn't running. Start the stack first:  docker compose up -d"
  exit 1
fi

echo "==> Onboarding Paperclip as 'node' (avoids root-owned config / EACCES crash)…"
echo "    Follow any prompts. It will print a bootstrap CEO invite URL."
echo
tmp="$(mktemp)"
docker compose exec -u node "$SERVICE" npx paperclipai onboard 2>&1 | tee "$tmp"
token="$(grep -oE 'invite/[A-Za-z0-9_]+' "$tmp" | head -1)"
rm -f "$tmp"

if [ -z "${token:-}" ]; then
  echo
  echo "No invite URL detected. If the output says Paperclip is already onboarded,"
  echo "you're done. Otherwise re-run this script."
  exit 0
fi

# Bridge the internal onboarding server (3101) to the host so a browser can reach it.
net="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CONTAINER" 2>/dev/null)"
cleanup
if [ -n "$net" ] && docker run -d --name "$FWD" --network "$net" -p "127.0.0.1:${PORT}:${PORT}" \
     alpine/socat "TCP-LISTEN:${PORT},fork,reuseaddr" "TCP:${SERVICE}:${PORT}" >/dev/null 2>&1; then
  echo
  echo "======================================================================"
  echo "  Open this to create your Paperclip admin (CEO) account:"
  echo
  echo "      http://localhost:${PORT}/${token}"
  echo
  echo "======================================================================"
else
  echo
  echo "⚠ Couldn't publish 127.0.0.1:${PORT} (already in use, or network lookup failed)."
  echo "  Open the invite URL printed above, but change the host 'paperclip' → 'localhost'."
fi

echo
read -r -p "Press Enter once your account is created… " _ || true

# Safety net: make sure nothing the CLI wrote under the instance is root-owned,
# then drop the bridge.
docker compose exec -u 0 "$SERVICE" chown -R node:node /paperclip/instances >/dev/null 2>&1 || true
cleanup

echo "==> Verifying…"
status="$(docker compose exec -T -u node "$SERVICE" sh -c 'wget -q -O - http://127.0.0.1:3100/api/health' 2>/dev/null | grep -oE '"bootstrapStatus":"[a-z_]+"')"
echo "    ${status:-(could not read /api/health)}"
case "$status" in
  *ready*) echo "✓ Onboarded. The dashboard 'Paperclip not active' banner will clear." ;;
  *)       echo "… Not 'ready' yet — complete the invite in your browser, then re-run this script." ;;
esac
