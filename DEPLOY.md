# Genus dashboard — deploy notes

The dashboard ships from this repo's root directory via Cloudflare Pages. No build step.

## URLs (as of 2026-06-19)

- **Daily driver: `genus-v06.pages.dev`** — the v0.7 cockpit. Reads + writes Tuto substrate from `Tij8i/Orchestrator`. Use this as your primary dashboard going forward.
- **Legacy backup: `genus-dashboard.pages.dev`** — the pre-migration dashboard from `Tij8i/Orchestrator/dashboard/public/`. Kept live in parallel as a fallback during the cutover. Will be retired once you're confident v0.7 covers everything.

Both read the same Tuto substrate, so any task approve / meeting convert / etc. you do on one shows up on the other after refresh.

## Layout

```
/                  Repo root — Pages serves static files from here
├── index.html     Dashboard entry point
├── assets/        JS, CSS, icons (empty placeholder today; populated as v0.6 builds)
├── functions/     Cloudflare Pages Functions (auto-detected by Pages)
│   └── api/
│       ├── _gh.js     Shared GitHub helper (UTF-8 safe, raw-URL fallback for >1MB files)
│       └── health.js  GET /api/health — runtime + substrate smoke test
└── scripts/       Generic Python scripts (cycle diagnostic, etc.) — not deployed
```

Spec docs (`GENUS_SPEC.md`, `MASON.md`, `STEWART.md`, etc.) also live at root and are publicly served as plain text by Pages. That's fine — they're already public on the GitHub repo page.

## Cloudflare Pages setup (one-time, in Cloudflare dashboard)

1. **Workers & Pages → Create application → Pages → Connect to Git**
2. Pick repo `Tij8i/Genus`, branch `main`
3. **Build settings**: leave everything at defaults
   - Framework preset: `None`
   - Build command: blank
   - Build output directory: leave blank (Pages serves from repo root)
4. Save & deploy — you'll get a `*.pages.dev` URL
5. **Settings → Environment variables → Production**: add `GITHUB_PAT`
   - Value: a fine-grained PAT with `Contents: Read and write` on `Tij8i/Orchestrator`
   - Same PAT used by the current Orchestrator dashboard works
6. **Settings → Custom domains** (optional): friendly subdomain
7. **Cloudflare Access → Applications → Add → Self-hosted**: cover the Pages URL with a policy locking access to operator's email
8. **Trigger a redeploy** so the env var is picked up

## Verifying

- Visit the Pages URL → see "Genus dashboard — v0.6 build" landing
- Visit `<pages-url>/api/health` → JSON with `substrate_reachable: true` and a non-zero `substrate_check_bytes`

If `substrate_reachable: false`, the PAT is missing or doesn't have access to `Tij8i/Orchestrator`.

## Branch-based preview deploys (GEN-87)

`main` is production. Every other change goes on a feature branch first.

- Branch naming: `feature/GEN-NN-short-slug` (e.g. `feature/GEN-87-pages-preview-deploys`).
- Push a feature branch → Cloudflare Pages creates a preview URL (typically `<slug>.genus-v06.pages.dev` with `/` normalized to `-`).
- Operator confirms the preview URL → merge feature branch → `main` → production auto-deploy via `.github/workflows/deploy.yml`.
- Cloudflare Access policy on `genus-v06.pages.dev` gates all subdomains, including preview URLs (see `docs/system/deploy/genus_v06_access_setup.md` in Orchestrator).

Authoritative working spec + open verification items (Cloudflare GitHub App authorization on `Tij8i/Genus` vs. extending this workflow with a `branch=` form field): `docs/system/deploy/genus_branch_preview_workflow.md` in `Tij8i/Orchestrator`.

## Substrate

Per `[[genus-repo-split-substrate]]`: the dashboard reads + writes operator data from `Tij8i/Orchestrator` (cross-repo via GitHub PAT), not from this repo. This repo holds only code + Genus spec docs. Operator-specific data (`bus/tuto/*.json`, agent canonicals) lives in Orchestrator until eventual move to its own instance repo (path C).
