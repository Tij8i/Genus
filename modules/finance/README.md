# Finance Module

**Status**: v1.0.0-skeleton (GEN-127) — on-disk skeleton; runtime wiring lands in subsequent children of [GEN-123](https://github.com/Tij8i/Orchestrator/issues) (v0.7 Finance Module v1 build).
**Spec**: [`docs/genus/modules/finance/SPEC_v1.md`](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md) — v1 LOCKED 2026-06-24.
**Manifest format**: [`docs/system/MODULE_MANIFEST.md`](https://github.com/Tij8i/Orchestrator/blob/main/docs/system/MODULE_MANIFEST.md) v0.7-draft-1.

## Purpose

A lightweight monitoring + decision-support layer on top of Moneybird. Founders glance at runway; investors glance at health; the module flags only what jumps out. It does **not** move money, file taxes, run payroll, or replace bookkeeping.

See SPEC_v1.md for the locked v1 design.

## What's here today (skeleton)

| File | Purpose |
|---|---|
| `module.json` | Manifest validating against MODULE_MANIFEST v0.7-draft-1. |
| `README.md` | This file. |
| `instruction-package.md` | Stub for the agent-agnostic protocol doc; format firms up under GEN-93/GEN-105. |
| `settings.schema.json` | JSON Schema for operator-configurable settings — Moneybird MCP endpoint, auth token reference, healthcheck route, alert thresholds. |
| `views/budget.js` | Founder Budget view (migrated from `assets/views/`). |
| `views/costs.js` | Founder Costs view (migrated from `assets/views/`). |
| `views/invoices.js` | Founder Invoices view (migrated from `assets/views/`). |
| `views/settings.js` | Settings panel stub — full UI ships under child L. |

## What's NOT here yet

Tracked in the GEN-123 child list:

- `agent/` — native Finance agent identity + playbook + memory schema + KPI set (child B / GEN-106).
- `recipes/` — `FIN-MONTHLY-DIGEST`, `FIN-RUNWAY-ALERT`, `FIN-DRAW-CONFLICT-ALERT` (child D and onward).
- `kpis/` — KPI schemas for `fin.runway_days`, `fin.burn_rate`, `fin.cash_position`, `fin.gross_revenue_3m` (child K).
- `connectors/moneybird.md` — connector usage docs (child C; depends on [GEN-104](https://github.com/Tij8i/Orchestrator/issues) for Settings → Wiring).
- `schemas/` — recommendation / alert / investor-KPI output schemas (child G).
- Real data wiring (child C).
- Investor view + signed-URL share (child H/I).

The manifest references some of these paths so the schema validates as a complete declaration; the loader's bind sequence (per [`docs/system/MODULE_LOADER.md`](https://github.com/Tij8i/Orchestrator/blob/main/docs/system/MODULE_LOADER.md) §bind sequence) will block on missing files when the loader itself ships.

## Architecture notes

- **Category**: `connector + surface` per [SPEC_v1.md §1](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md). (GEN-127 issue scope mentioned `connector+observability` — superseded by the locked spec.)
- **Soft enhances**: Operations — surfaced via the `enhances-operations` tag; the manifest schema has no `enhances` field yet (deferred to v0.7-draft-2).
- **Depends on multi-tenant + module-loader**: these are core systems, not modules, so they live outside `depends_on_modules` per [MODULE_MANIFEST §6.5](https://github.com/Tij8i/Orchestrator/blob/main/docs/system/MODULE_MANIFEST.md). Compatibility is encoded in `genus_core.compat_min: "0.7.0"`.
- **Connector ownership**: Moneybird MCP is wired by the Genus Agent in `Settings → Wiring`, not by this module. See [SPEC_v1.md §10](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md) and [GEN-104](https://github.com/Tij8i/Orchestrator/issues).

## Loading today vs after the loader ships

Until the module loader (GEN-113 Phase 1 implementation) lands, the views are imported directly by the dashboard shell (`assets/app.js`) from the module-local path (`/modules/finance/views/*.js`). The shell's `index.html` routes (`#budget`, `#costs`, `#invoices`) are unchanged so the user-facing IA is identical.

When the loader ships, those imports become dynamic via the manifest's `views.dashboard[*].component_ref` and the shell drops the hardcoded import lines.
