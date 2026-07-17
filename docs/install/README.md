# Install Genus on your machine

Genus runs privately on your machine using Docker Compose. Total install time: about 30 minutes.

## 0. Before you start — check what you have

Open a Terminal (macOS: Cmd+Space → "Terminal") or PowerShell (Windows: Start → "PowerShell") and check these three things.

**Docker Desktop.** Type `docker --version`. If you see a version number, you're set — skip step 1. If you see "command not found", follow step 1.

**Git (optional but recommended).** Type `git --version`. If you see a version number, use the `git clone` path in step 2. If you don't have Git, install it from https://git-scm.com/downloads or use the ZIP path in step 2.

**A text editor.** For step 3 you open a file called `.env`. Any plain-text editor works:

- **macOS**: TextEdit (built-in) opens via `open -a TextEdit .env` from Terminal, or right-click `.env` in Finder → Open With → TextEdit. VS Code, Cursor, Sublime also work.
- **Windows**: Notepad (built-in) — right-click `.env` in File Explorer → Open with → Notepad. VS Code, Cursor also work.

Save with plain-text encoding (default in all of these).

## 1. Install Docker Desktop

If you don't have Docker Desktop:

- macOS: https://docs.docker.com/desktop/install/mac-install/
- Windows: https://docs.docker.com/desktop/install/windows-install/

Launch Docker Desktop and wait for the whale icon to stop animating.

## 2. Download Genus

**If you have Git installed** — open a Terminal (macOS) or PowerShell (Windows) and run:

```bash
git clone https://github.com/Tij8i/Genus.git my-genus
cd my-genus
```

**If you don't have Git** — download the repo as a ZIP:

1. Go to https://github.com/Tij8i/Genus/archive/refs/heads/main.zip
2. Extract the ZIP anywhere you like — you'll get a folder called `Genus-main`
3. Open a Terminal (macOS) or PowerShell (Windows) and `cd` into that folder:
   ```bash
   cd path/to/Genus-main
   ```

(Git makes future updates easier — `git pull` — but the ZIP works fine for a first install.)

## 3. Configure your key

Copy the example config:

```bash
cp .env.example .env
```

Open `.env` in a text editor:

- **macOS** — `open -a TextEdit .env` in Terminal (or right-click the file in Finder → Open With → TextEdit).
- **Windows** — `notepad .env` in PowerShell (or right-click the file in File Explorer → Open with → Notepad).
- Any editor works — VS Code, Cursor, Sublime, nano, vim.

Once open:

1. Paste your Anthropic API key after `ANTHROPIC_API_KEY=`. Don't have one? Get it at https://console.anthropic.com.
2. Generate a random secret and paste it after `BETTER_AUTH_SECRET=`:
   - macOS / Linux: `openssl rand -hex 32`
   - Windows PowerShell: `-join ((48..57 + 97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})`

Save the file and close the editor.

## 4. Start Genus

```bash
docker compose up --build
```

The first run takes a few minutes to download images and build the dashboard. When you see `Genus is running at http://localhost:8080` in the console output, open that URL in your browser.

If the container is running in the background (Docker Desktop hides the console), just open http://localhost:8080 directly.

(`--build` is needed on the first run because the dashboard image is built locally, not pulled from a registry. On subsequent runs `docker compose up` alone is fine unless you've pulled updates.)

**What's running:**

| Service | URL | What it's for |
|---|---|---|
| Genus dashboard | http://localhost:8080 | Where you work — open this |
| Paperclip runtime | Internal to the compose network (`http://paperclip:3100`) | Runs your agents. The dashboard talks to it automatically. |

To reach the Paperclip UI directly (rarely needed), add `- "3100:3100"` under `paperclip:` → `ports:` in `docker-compose.yml` and restart. Then it's at http://localhost:3100.

## 5. Set up your BU

The wizard walks you through naming your business unit and (optionally) connecting external systems. Takes about 2 minutes. If your Anthropic key was missing, the wizard shows a banner so you can fix it before continuing.

**One-time Paperclip step:** after finishing the wizard, onboard Paperclip. This creates your admin (CEO) account — it's what lets Genus push tasks to your agents. Without it, task-push shows "Agent JWT: missing".

**macOS / Linux — one command (recommended).** In a new terminal window (leave `docker compose up` running in the first):

```bash
./scripts/onboard.sh
```

It runs onboarding correctly, prints a `http://localhost:3101/…` link to open in your browser, and cleans up after itself. Open the link, create your account, come back and press Enter. Done — skip the rest of this step.

<details>
<summary><b>Manual steps</b> (Windows, or if you'd rather not use the script)</summary>

```bash
docker compose exec -u node paperclip npx paperclipai onboard
```

> **Use `-u node`, not the default.** `docker compose exec` runs as `root`, but the Paperclip server runs as the `node` user (UID 1000). If you onboard as root, the config files it writes (`.env`, `config.json`) end up owned by root and unreadable by the server — Paperclip then crash-loops with `EACCES` on its next restart. `-u node` writes them as the right user. (If you already hit this, see Troubleshooting.)

`onboard` prints a **bootstrap CEO invite URL** on port 3101 — e.g. `http://paperclip:3101/invite/pcp_bootstrap_…`. The `paperclip` hostname only resolves inside Docker, so open it from your browser with the host swapped to `localhost`:

```
http://localhost:3101/invite/pcp_bootstrap_…
```

If your browser can't reach `localhost:3101` (the onboarding server is internal to the compose network), temporarily expose it — add this under `paperclip:` in `docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:3101:3101"
```

then `docker compose up -d paperclip` and open the `localhost:3101` invite URL. Remove the `ports:` block once your account is created.

</details>

Done.

## Updating

```bash
git pull
docker compose build
docker compose up
```

## Stopping

```bash
docker compose down
```

Your data stays in the Docker volume. The next `docker compose up` picks up where you left off.

## Uninstalling

```bash
docker compose down -v
```

The `-v` removes the volumes too and deletes your BU data. Skip `-v` to keep the data.

## Troubleshooting

**Port 8080 is taken.** Uncomment `PORT=8081` (or any free port) in `.env`, then `docker compose down && docker compose up`.

**"Anthropic API key not set" banner.** You skipped step 3. Set the key in `.env`, then `docker compose down && docker compose up`.

**Paperclip needs onboarding.** Run `docker compose exec paperclip npx paperclipai onboard` and follow prompts. Step 5 in the install flow above covers this; this troubleshooting entry catches the case where you skipped it.

**"Agent JWT: missing" in the Paperclip container logs.** Same fix as above — you need to run `docker compose exec paperclip npx paperclipai onboard` once. The banner is just Paperclip telling you it hasn't been onboarded yet; nothing is broken.

**Task-push fails with `file not found: dashboard/public/data/bus/{bu}/tasks.json`.** Update to the latest Genus (`git pull && docker compose build && docker compose up`) — this was a bug in `create-bu.js` that stopped seeding per-BU substrate files. If updating doesn't fix it, delete the affected BU from `_registry.json` and recreate it via the wizard.

**Dashboard came up but the demo BU is missing.** The synthetic BU seeds on the first empty-volume boot. If the volume already existed (e.g. an aborted previous run), `docker compose down -v` clears it — then `docker compose up` re-seeds.

**Paperclip crash-loops with `EACCES: permission denied, open '/paperclip/instances/default/.env'`.** Its config files are owned by root, but the server runs as the `node` user (UID 1000). This happens when you onboard as root — the default for `docker compose exec`. Fix the ownership once:

```bash
docker compose stop paperclip
docker run --rm -u 0 -v "$(basename "$PWD")_paperclip-data":/pc alpine chown -R 1000:1000 /pc
docker compose start paperclip
```

(`docker volume ls | grep paperclip-data` shows the exact volume name if the `basename` shortcut doesn't match.) Going forward, onboard with `-u node` (step 5) so it doesn't recur.

**Dashboard says "Paperclip not active" even after onboarding; `/api/paperclip-status` shows `reachable:false`.** Paperclip is binding to loopback (127.0.0.1) only, so the dashboard container can't reach it across the compose network. Current Genus sets `PAPERCLIP_BIND: all` in `docker-compose.yml` — `git pull` to get it. An instance already provisioned with `bind: loopback` in its config keeps that setting; patch it once:

```bash
docker compose stop paperclip
docker run --rm -i -u 0 -v "$(basename "$PWD")_paperclip-data":/pc python:3-alpine python3 - <<'PY'
import json, os
p = "/pc/instances/default/config.json"
c = json.load(open(p))
c["server"]["bind"] = "all"; c["server"]["host"] = "0.0.0.0"
json.dump(c, open(p, "w"), indent=2); os.chown(p, 1000, 1000)
PY
docker compose start paperclip
```

Confirm the paperclip startup banner shows `Bind ... (0.0.0.0)` and the dashboard banner clears.

Anything else, open an issue at https://github.com/Tij8i/Genus/issues.
