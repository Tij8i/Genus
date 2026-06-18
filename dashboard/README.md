# Genus dashboard

The operator-facing UI for the Genus protocol. Static SPA + Cloudflare Pages Functions for write-back to substrate.

## Layout

```
dashboard/
├── public/          # Static assets served by Cloudflare Pages
│   ├── index.html   # Landing — v0.6 skeleton today, full dashboard in build
│   └── assets/      # JS/CSS/icons
└── README.md        # this file

functions/
└── api/             # Cloudflare Pages Functions (write-back to substrate)
    ├── _gh.js       # Shared GitHub helper (UTF-8 safe atob, raw-URL fallback for >1MB files)
    └── health.js    # GET /api/health — smoke test for runtime + substrate

scripts/
└── (empty)          # Generic Python scripts (cycle diagnostic, etc.) — see Tij8i/Orchestrator/dashboard/scripts/ for current versions
```

## Substrate

Per `[[genus-repo-split-substrate]]`: the dashboard reads + writes operator data from `Tij8i/Orchestrator` (cross-repo via GitHub PAT), not from this repo. This repo holds only **code**. Operator-specific data (`bus/tuto/*.json`, agent canonicals, etc.) lives in Orchestrator until eventual move to its own instance repo (path C).

To verify substrate connectivity after a Pages deploy: `GET /api/health` returns substrate reachability + a probe-file size.

## Deploy

1. Cloudflare Pages project pointed at `Tij8i/Genus` main branch
2. `GITHUB_PAT` env var set in Pages project settings (Contents: Read+Write on `Tij8i/Orchestrator`)
3. Cloudflare Access policy locked to operator's email
4. Pushes to `main` auto-deploy in ~30-60s

## Migration status

This is the v0.6 dashboard rebuild. Current production dashboard lives at `Tij8i/Orchestrator/dashboard/`. Cut-over happens when v0.6 reaches feature parity for the operator's daily flow (Dashboard / Planning / Inputs / Outputs / KPIs / Settings — see Genus glossary).

See `Tij8i/Orchestrator/docs/system/GENUS.md` § Next Steps for the broader Genus-vs-Orchestrator split plan.
