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
#   2. Runs it non-interactively (`-y --bind lan`) so there's no wizard menu
#      to click through, then bridges the onboarding invite server (container
#      port 3101, internal to the compose network) to 127.0.0.1 on your host,
#      prints a ready-to-click invite URL, and tears the bridge down after.
#
# onboard -y does NOT exit — it generates the invite then keeps serving 3101
# until you accept the invite. So we run it in the background, wait for the
# URL, and stop it once you're done.
#
# Usage:  ./scripts/onboard.sh      (run from anywhere in the repo)
#
# macOS/Linux only. Windows users: follow the manual steps in
# docs/install/README.md step 5.
#
set -uo pipefail

SERVICE=paperclip
CONTAINER=genus-paperclip
FWD=genus-onboard-fwd
PORT=3101

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

logf="$(mktemp)"
cleanup() {
  docker compose exec -T -u node "$SERVICE" pkill -f paperclipai >/dev/null 2>&1 || true
  docker rm -f "$FWD" >/dev/null 2>&1 || true
  rm -f "$logf" 2>/dev/null || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "✗ docker not found — install/start Docker Desktop first."; exit 1; }

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "✗ Paperclip isn't running. Start the stack first:  docker compose up -d"
  exit 1
fi

echo "==> Onboarding Paperclip as 'node' (avoids root-owned config / EACCES crash)…"
# Non-interactive: -y skips the setup-path wizard, --bind lan binds 0.0.0.0.
# It generates the invite, then keeps serving 3101 — so run it in the background.
docker compose exec -T -u node "$SERVICE" npx paperclipai onboard -y --bind lan >"$logf" 2>&1 &
ob_pid=$!

echo "    Waiting for the bootstrap CEO invite…"
token=""
for _ in $(seq 1 45); do
  token="$(grep -oE 'invite/[A-Za-z0-9_]+' "$logf" | head -1)"
  [ -n "$token" ] && break
  kill -0 "$ob_pid" 2>/dev/null || break   # onboard exited/errored early
  sleep 2
done

if [ -z "${token:-}" ]; then
  echo
  echo "✗ No invite URL was generated. Onboard output:"
  sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$logf" | tail -20
  echo
  echo "If it says Paperclip is already onboarded, you're done. Otherwise re-run."
  exit 1
fi

# Bridge the internal onboarding server (3101) to the host so a browser can reach it.
net="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CONTAINER" 2>/dev/null)"
docker rm -f "$FWD" >/dev/null 2>&1 || true
if [ -n "$net" ] && docker run -d --name "$FWD" --network "$net" -p "127.0.0.1:${PORT}:${PORT}" \
     alpine/socat "TCP-LISTEN:${PORT},fork,reuseaddr" "TCP:${SERVICE}:${PORT}" >/dev/null 2>&1; then
  url="http://localhost:${PORT}/${token}"
else
  echo "⚠ Couldn't publish 127.0.0.1:${PORT} (already in use, or network lookup failed)."
  echo "  Open the invite below with the host 'paperclip' changed to 'localhost'."
  url="http://paperclip:${PORT}/${token}"
fi

echo
echo "======================================================================"
echo "  Open this to create your Paperclip admin (CEO) account:"
echo
echo "      $url"
echo
echo "======================================================================"
echo
read -r -p "Press Enter once your account is created… " _ || true

# Stop the onboarding server + bridge, safety-chown, and verify.
cleanup
trap - EXIT

echo "==> Verifying…"
status="$(docker compose exec -T -u node "$SERVICE" sh -c 'wget -q -O - http://127.0.0.1:3100/api/health' 2>/dev/null | grep -oE '"bootstrapStatus":"[a-z_]+"')"
echo "    ${status:-(could not read /api/health)}"
case "$status" in
  *ready*) echo "✓ Onboarded. The dashboard 'Paperclip not active' banner will clear." ;;
  *)       echo "… Not 'ready' yet — complete the invite in your browser, then re-run this script." ;;
esac
