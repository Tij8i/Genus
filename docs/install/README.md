# Install Genus on your machine

Genus runs privately on your machine using Docker Compose. Total install time: about 30 minutes.

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

Open `.env` in a text editor. Paste your Anthropic API key after `ANTHROPIC_API_KEY=`.

Then generate a random secret for Paperclip and paste it after `BETTER_AUTH_SECRET=`. On macOS or Linux:

```bash
openssl rand -hex 32
```

On Windows PowerShell:

```powershell
-join ((48..57 + 97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Save the file.

Don't have an Anthropic key? Get one at https://console.anthropic.com.

## 4. Start Genus

```bash
docker compose up
```

The first run takes a few minutes to download images and build the dashboard. When you see `Genus is running at http://localhost:8080`, open that URL in your browser.

## 5. Set up your BU

The wizard walks you through naming your business unit and (optionally) connecting external systems. Takes about 2 minutes. If your Anthropic key was missing, the wizard shows a banner so you can fix it before continuing.

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

**Paperclip needs onboarding.** Run `docker compose exec paperclip npx paperclipai onboard` and follow prompts.

**Dashboard came up but the demo BU is missing.** The synthetic BU seeds on the first empty-volume boot. If the volume already existed (e.g. an aborted previous run), `docker compose down -v` clears it — then `docker compose up` re-seeds.

Anything else, open an issue at https://github.com/Tij8i/Genus/issues.
