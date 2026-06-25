# Finance Module — Instruction Package (v1.0.0-stub)

**Status**: STUB — full format firms up under [GEN-93](https://github.com/Tij8i/Orchestrator/issues) (module agent-binding protocol) and [GEN-105](https://github.com/Tij8i/Orchestrator/issues) (module ↔ agent binding UI + instruction-package contract). Finance v1 ships with this inline stub; v1.x replaces with the protocol-locked format.

**Purpose**: the agent-agnostic protocol doc any Paperclip agent (or external agent) loads to operate the Finance Module. Per [SPEC_v1.md §0.3 + §12](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md).

Pointed at by `module.json` → `instruction_package.ref`.

---

## 1. What the module is for

A lightweight monitoring + decision-support layer on Moneybird. Read-only on bookkeeping; writes only to its own recommendation feed and alerts. Surfaces cash flow tabs (Cash / Revenue / Costs / Runway), a narrow recommendation set, and a read-only investor view.

One-liner: *"Founders glance at runway. Investors glance at health. The module flags only what jumps out — through whichever finance agent the operator has bound."*

## 2. Allowed and forbidden actions

The bound agent **may** emit recommendations in these categories only:

- `fin.recommendation.expense_recategorization` — re-categorize bookkeeping entries for visibility/reporting accuracy.
- `fin.recommendation.founder_draw_adjustment` — suggest timing / amount adjustments to founder personal draws when they materially affect runway.

The bound agent **must not** emit, even if asked:

- `fin.recommendation.fire_people`
- `fin.recommendation.cut_product`
- `fin.recommendation.vendor_swap`
- `fin.recommendation.cancel_subscriptions`
- `fin.recommendation.chase_receivables`
- `fin.payment.initiate`
- `fin.invoice.generate`

These match `module.json → actions.allowed` / `forbidden` and are machine-checked by the runtime adapter.

Autonomy ceiling (per `module.json → actions.autonomy_ceiling`): `delegation: 2, trust: 2, speed: 3`. Anything above this requires operator approval.

## 3. Confidence frame mode

`silent_low_only`, per `module.json → confidence_frame.mode` and [SPEC_v1.md §7](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md):

- HIGH-confidence numbers render normally with no badge.
- LOW-confidence numbers carry an inline marker + "why this might be wrong" expander **only when the deviation is material**.
- The module never refuses to render a number because of low confidence — it flags inline.

The bound agent computes confidence per output but does not render it; rendering is the module's job via the ConfidenceFrame@1 primitive ([GEN-95](https://github.com/Tij8i/Orchestrator/issues)).

## 4. Data sources available

- **Moneybird (read-only, via MCP)** — wired in `Settings → Wiring` by the Genus Agent, not this module. The bound agent receives a connector handle at runtime; it does not authenticate itself. Scopes: `read:invoices`, `read:ledger`, `read:contacts`.
- **Forwarded email** (inbound) — operator forwards selected invoices/receipts to a dedicated agent address. No inbox-scraping.
- **Manual entries** (inbound) — operator can add ad-hoc spend or expected revenue items via the module UI.

See `connectors/moneybird.md` (TBD under child C) for scopes and field-level read patterns.

## 5. Output shapes

Three structured-record shapes the bound agent writes (full JSON Schemas land under child G):

- `recommendation` — `bus/finance/recommendations.jsonl`
- `alert` — `bus/finance/alerts.jsonl`
- `investor_kpi` — `bus/finance/cash_state.json`

Until schemas ship, the agent should produce records following the shapes sketched in [SPEC_v1.md §6 + §4](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md).

## 6. Memory expectations

The bound agent persists between sessions:

- Recommendation history — which recommendations it emitted, what the founders did with them (accept / dismiss / silent), so it learns whether its draw-adjustment suggestions actually changed founder behavior.
- Threshold tunings — operator overrides on runway alert thresholds, digest cadence, etc.

Memory schema is at `agent/MEMORY.schema.json` once the native Finance agent identity ships under child B / [GEN-106](https://github.com/Tij8i/Orchestrator/issues). Until then, the bound agent uses its own runtime memory pattern; the contract above is what it must persist.

---

*Stub written for GEN-127. Replaces by the GEN-93/GEN-105 protocol-locked format in a subsequent release.*
