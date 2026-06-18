# Genus dashboard — deploy notes

The dashboard ships from this repo's root directory via Cloudflare Pages. No build step.

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

## Substrate

Per `[[genus-repo-split-substrate]]`: the dashboard reads + writes operator data from `Tij8i/Orchestrator` (cross-repo via GitHub PAT), not from this repo. This repo holds only code + Genus spec docs. Operator-specific data (`bus/tuto/*.json`, agent canonicals) lives in Orchestrator until eventual move to its own instance repo (path C).
