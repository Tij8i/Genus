# Genus first-run wizard (i56 phase 4b)

Files in this directory implement the first-run wizard shown when a fresh install
of Genus is opened with no user BU yet. Design source of truth:
`Orchestrator/docs/products/i56-forkable-install/design-output/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Wizard SPA (welcome → name-bu → connectors). Server injects `window.__ANTHROPIC_KEY_MISSING__` into `<head>` on serve. |
| `wizard.css` | Extracted, deduplicated styles from the design output. Mock-only `.rail`/`.variant` helpers stripped. |
| `wizard.js` | State machine, form validation, /api/create-bu + /api/module-init calls. |
| `empty-layers.html` | Static markup for the empty Layers view. **Not yet wired** into `assets/*.js` — see below. |
| `demo-banner.html` | Static markup for the persistent "You're exploring the demo" banner. **Not yet wired** into the dashboard shell — see below. |
| `demo-banner.js` | Companion controller. Exposes `window.Genus.mountDemoBanner(hostEl)`. |

## Server hooks (phase 4b, `server/index.js`)

- Root redirect: `GET /` in local mode with no user BU → 302 `/wizard/`.
- `GET /wizard/` serves `index.html` with `window.__ANTHROPIC_KEY_MISSING__` injected.
- `GET /wizard/wizard.css` / `.js` / `.html` snippets served as static files.
- `GET /_boot` serves the pre-boot splash (design output `01-splash.html` with `.rail` stripped).

## Deferred to a later phase

### Empty Layers view wiring

`empty-layers.html` is available as a static snippet but the dashboard's Layers
view in `assets/` still renders its own empty state. Wiring the fetched
snippet into the Layers view requires:

1. Identifying the Layers view module in `assets/` and finding the "no data"
   render branch.
2. Adding a `fetch('/wizard/empty-layers.html')` + string replace on
   `__BU_DISPLAY_NAME__` + `innerHTML` into that branch.

Impact: cosmetic. The wizard flow completes and lands the user on the
dashboard; the existing empty state is functional but off-brand.

### Demo banner integration

`demo-banner.html` + `demo-banner.js` are available. Wiring requires the
dashboard shell to:

1. On boot, check if current BU is `synthetic` AND registry has no non-synthetic BUs.
2. If yes, call `window.Genus.mountDemoBanner(document.querySelector('.app-shell-or-similar'))`.

Impact: net-new user cannot see the "Create your own BU →" prompt from the
demo. They still reach the wizard via the root redirect on next visit if no
user BU exists.

Both items are stretch goals per the phase-4b task spec and do not block the
install flow.
