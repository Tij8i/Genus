# Moneybird connector

**Status**: v1 interim — written under [GEN-131](https://github.com/Tij8i/Orchestrator/issues) (child C of [GEN-123](https://github.com/Tij8i/Orchestrator/issues) v0.7 Finance build).
**Owner**: Sage Stewart (Architect / Head of Genus).
**Spec source**: [`docs/genus/modules/finance/SPEC_v1.md`](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md) §5, §10 — connector ownership lives in `Settings → Wiring`, not in the module.
**Confidence integration**: [`docs/genus/modules/finance/CONFIDENCE_FRAME.md`](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/CONFIDENCE_FRAME.md) §6.2 — healthcheck staleness drives the L2 layer.

---

## 1. What this document is

The Finance Module reads bookkeeping state from Moneybird via an MCP server, and writes nothing back. This file is the **read-side contract** the module relies on:

1. What Moneybird entities the module consumes.
2. How those entities map to the normalized Genus Finance shapes the bound agent and the Cash/Costs/Invoices views work against.
3. How the healthcheck protocol surfaces staleness to ConfidenceFrame.
4. The **interim wiring path** the operator uses today, and how it migrates to the eventual [GEN-104](https://github.com/Tij8i/Orchestrator/issues) `Settings → Wiring` UI without code changes.

The MCP **server** is a third-party concern (community-maintained wrappers around the Moneybird REST API, or the operator's own). This file documents the **client contract** the module expects regardless of which server is wired.

---

## 2. Scope (v1)

| In scope | Out of scope |
|---|---|
| Read invoices (sales + purchase), ledger entries, contacts, bank balance snapshots. | Anything write-back to Moneybird (no invoice creation, no payment registration, no ledger mutation). |
| Healthcheck + last-successful-sync timestamp. | OAuth/token rotation — owned by the Genus Agent at the Wiring layer. |
| Entity normalization into the Genus Finance shapes (§5). | Multi-BU fan-out — v1 wires one Moneybird administration per Finance Module installation. |
| Operator config via `modules/finance/settings.schema.json` `moneybird` block. | Inbox-scraping or folder-watch on the operator's email (excluded by SPEC_v1 §8). |

The autonomy ceiling for any bound agent reading through this connector is capped at `delegation: 2, trust: 2, speed: 3` (per `module.json → actions.autonomy_ceiling`). The connector exposes no `write` scopes, so even a misbehaving agent cannot mutate Moneybird state through this path.

---

## 3. MCP server expectations

The module references the wired MCP server by `connector_ref` (see §6). Any MCP server that satisfies the contract below is acceptable.

### 3.1 Required tools

The server MUST expose these tools (names are interim — the GEN-104 Wiring UI will let the operator alias them):

| Tool | Purpose | Returns |
|---|---|---|
| `moneybird.list_sales_invoices` | List outgoing invoices in a time window. | Array of Moneybird `SalesInvoice` records. |
| `moneybird.list_purchase_invoices` | List incoming invoices in a time window. | Array of `PurchaseInvoice` records. |
| `moneybird.list_ledger_entries` | List ledger entries (journal lines) in a time window. | Array of `LedgerEntry` records. |
| `moneybird.list_contacts` | List contacts (vendors + customers). | Array of `Contact` records. |
| `moneybird.list_bank_accounts` | List configured bank accounts with current balance. | Array of `BankAccount` records. |
| `moneybird.healthcheck` | Probe server + Moneybird API liveness. | `{ ok: bool, last_successful_sync: ISO8601, error?: string }`. |

### 3.2 Read scopes

Declared in `module.json → connectors.required[0].scopes`:

- `read:invoices` — sales + purchase invoices.
- `read:ledger` — journal lines + bank balance reads.
- `read:contacts` — vendor + customer lookups for cost categorization.

The module MUST refuse to operate against a connector wired with a write scope. The Genus Agent enforces this at bind time.

### 3.3 Authentication

Moneybird API tokens are personal-access tokens scoped to a single administration. The token NEVER reaches the module — it lives in the secret store referenced by `auth_token_ref` (e.g. `secrets/moneybird/medivara`) and is injected into the MCP server's environment at start by the Genus Agent.

The module receives an opaque `connector_ref` and calls the MCP tools through it. Rotation (token refresh) is the Genus Agent's job — see §7.

---

## 4. Healthcheck + reconnect

This section is the v1 implementation of CONFIDENCE_FRAME §6.2 (L2 staleness signal).

### 4.1 Healthcheck cadence

The Genus Agent probes the connector's `moneybird.healthcheck` tool on this schedule:

- **Every 15 minutes** — baseline liveness probe. Updates `last_successful_sync` if the probe returns `ok: true`.
- **On every read attempt** that returns an error — opportunistic probe before retry.
- **On demand** — operator can fire a probe from `Settings → Wiring` (interim path: the `dev-console.html` page in v1, see §6.4).

### 4.2 Staleness windows

| Window since `last_successful_sync` | Connector status | ConfidenceFrame L2 effect |
|---|---|---|
| ≤ 1h | `green` | No staleness signal. All figures from this connector render at HIGH L2. |
| 1h – 24h | `yellow` | Soft warning surfaced in `Settings → Wiring` only. Figures still render at HIGH L2. |
| > 24h | `red` | **L2 stale flag fires.** Every Finance Module figure backed by Moneybird data marks LOW per the silent-low-only rendering rules (CONFIDENCE_FRAME §7.1). An Alert is emitted to `bus/finance/alerts.jsonl` per CONFIDENCE_FRAME §6.3 with title `"Moneybird connector stale > 24h — figures may not reflect recent activity"`. |

The 24h threshold matches the acceptance criterion on GEN-131. It is operator-overridable in v1.1 via `settings.schema.json` (`moneybird.staleness_red_threshold_hours`); v1 ships the threshold as a constant to keep the contract small.

### 4.3 Reconnect logic

When `moneybird.healthcheck` returns `ok: false`:

1. **First failure** — log to the connector status feed, do nothing else. Many transient failures resolve on the next 15-min probe.
2. **Two consecutive failures** — the Genus Agent emits a `connector_degraded` event on `bus/connectors/events.jsonl`. The Finance Module reads this stream and surfaces a `yellow` chip in the module's settings panel.
3. **Six consecutive failures (≈90 min)** — the Genus Agent attempts a reconnect: restart the MCP server process via the runtime adapter and re-issue the healthcheck. If the reconnect succeeds, the failure counter resets. If it fails, the connector status moves to `red` and an Alert is emitted to the operator.
4. **Past 24h with no successful sync** — the L2 stale flag fires regardless of probe cadence (§4.2 red row). The Genus Agent stops auto-retrying reconnect and waits for operator action; chatter at a degraded service costs MCP-server budget without yielding new information.

The reconnect ladder is the Genus Agent's responsibility, not the Finance Module's. The module only **reads** the connector status feed and the staleness window; it never attempts to fix the connector itself. This preserves the SPEC_v1 §10 invariant that modules don't own connector lifecycle.

### 4.4 What the module does NOT do

- No retry-with-backoff inside view rendering. A view that needs data calls the connector once; if it fails, the view renders with the most recent cached snapshot and the inline LOW marker (per CONFIDENCE_FRAME §7.1).
- No connector mutation (start / stop / restart). Reads only.
- No credential handling. The opaque `connector_ref` is the only handle the module ever sees.

---

## 5. Entity mapping (Moneybird → Genus Finance)

The normalized shapes live as JSON Schemas in `./schemas/`. This section explains the mapping decisions.

### 5.1 Outgoing invoice → `invoice` (direction: outgoing)

Source: `moneybird.list_sales_invoices`.

| Moneybird field | Genus Finance field | Notes |
|---|---|---|
| `id` | `source.id` | Opaque; never rendered. |
| `invoice_id` | `external_ref` | Human-readable invoice number (e.g. `"2026-0042"`). |
| `contact.company_name` ‖ `contact.firstname + lastname` | `counterparty.name` | Display string for the customer. |
| `contact_id` | `counterparty.ref` | Stable key for joining to `Contact` records. |
| `invoice_date` | `issued_at` | ISO 8601 date. |
| `due_date` | `due_at` | Nullable. |
| `state` | `status` | Mapped: `draft` → `draft`, `open` → `unpaid`, `late` → `unpaid_overdue`, `paid` → `paid`, `uncollectible` → `written_off`, others → `other`. |
| `total_price_incl_tax_base` | `amount_gross.value` | Decimal string in EUR. |
| `total_price_excl_tax_base` | `amount_net.value` | Decimal string in EUR. |
| `currency` | `amount_gross.currency` ‖ `amount_net.currency` | ISO 4217. |
| (derived) | `direction` | Constant `"outgoing"` for sales invoices. |

### 5.2 Incoming invoice → `invoice` (direction: incoming)

Source: `moneybird.list_purchase_invoices`.

Same mapping as §5.1 with these differences:

| Moneybird field | Genus Finance field | Notes |
|---|---|---|
| `reference` ‖ `invoice_id` | `external_ref` | Purchase invoices carry vendor-provided references; fall back to Moneybird's internal id. |
| `contact.*` | `counterparty.*` | The vendor. |
| (derived) | `direction` | Constant `"incoming"`. |

Sales and purchase invoices share one normalized `invoice` shape so the Invoices view, recommendation engine, and runway projection logic see one record type.

### 5.3 Ledger entry → `ledger_entry`

Source: `moneybird.list_ledger_entries`.

| Moneybird field | Genus Finance field | Notes |
|---|---|---|
| `id` | `source.id` | Opaque. |
| `date` | `booked_at` | ISO 8601 date. |
| `description` | `memo` | Free text. |
| `ledger_account_id` | `account.ref` | Stable join key. |
| `ledger_account.name` | `account.name` | Display string. |
| `debit` | `debit.value` | Decimal string. |
| `credit` | `credit.value` | Decimal string. |
| `currency` | `debit.currency` ‖ `credit.currency` | ISO 4217. |
| `tax_rate_id` ‖ `tax_rate.name` | `tax.label` | Free text; not parsed in v1. |

Categorization (mapping a ledger entry to a Finance category like *salaries* / *rent* / *SaaS subscription*) is the bound agent's job, not the connector's. The connector exposes the raw entry; the agent applies the categorization rules. This keeps the connector schema-stable when the agent's categorization model evolves.

### 5.4 Bank account → `bank_balance`

Source: `moneybird.list_bank_accounts`.

| Moneybird field | Genus Finance field | Notes |
|---|---|---|
| `id` | `account.ref` | Stable join key. |
| `name` | `account.name` | Display string (e.g. `"ING zakelijk"`). |
| `currency` | `balance.currency` | ISO 4217. |
| `current_balance` | `balance.value` | Decimal string. |
| (probe time) | `as_of` | ISO 8601 timestamp of the read, not a Moneybird field. The connector stamps it on emission. |

The runway projection sums `bank_balance.balance.value` across accounts in EUR. Non-EUR accounts are surfaced raw in v1; multi-currency normalization is a v1.1 candidate.

### 5.5 Contact → `counterparty`

Source: `moneybird.list_contacts`. Used as a lookup table when normalizing invoices and ledger entries; not a top-level entity the module renders directly.

| Moneybird field | Genus Finance field | Notes |
|---|---|---|
| `id` | `ref` | Stable join key. |
| `company_name` ‖ `firstname + lastname` | `name` | Display string. |
| `customer` (boolean) | `roles[]` includes `"customer"` | Multi-role: a contact can be both customer and supplier. |
| `supplier` (boolean) | `roles[]` includes `"supplier"` | |

---

## 6. Interim wiring contract

The eventual GEN-104 `Settings → Wiring` UI doesn't exist yet. This section is the interim path that lets the operator wire Medivara's Moneybird against this module in v1 — config only, no code changes.

### 6.1 What gets wired

A Moneybird connector entry is identified by `connector_ref` and consists of:

1. **Endpoint URL** — where the MCP server is reachable (typically `http://localhost:PORT/mcp` for a locally-run server, or an internal URL).
2. **Auth token reference** — a path into the operator's secret store (e.g. `secrets/moneybird/medivara`) that resolves to the Moneybird personal-access token.
3. **Healthcheck route** — the path on the MCP server used by the §4 probe loop. Defaults to `/healthz`.

These three fields are the **entire** interim contract. The Genus Agent injects the secret into the MCP server's env at start and never hands it to the module.

### 6.2 Where v1 stores it

`modules/finance/settings.schema.json → moneybird`:

```json
{
  "connector_ref": "connectors/moneybird/medivara",
  "endpoint_override": "http://localhost:7042/mcp",
  "auth_token_ref": "secrets/moneybird/medivara",
  "healthcheck_route": "/healthz"
}
```

`connector_ref` is a stable id chosen by the operator. The format is `connectors/{service}/{installation-name}`. Once GEN-104 ships, the Wiring UI assigns connector_refs centrally; the value in `settings.schema.json` becomes a pointer rather than a definition.

`endpoint_override` and `auth_token_ref` are present **only during the interim**. Once Wiring lands, both fields are populated from the central Wiring entry the operator manages there; the module's `settings.schema.json` keeps the fields for backward-compat but the Wiring values win at runtime resolution.

### 6.3 Bootstrapping a Moneybird connector against an existing installation

For Medivara (the first installation):

1. Operator runs the Moneybird MCP server somewhere reachable (locally or on the Cloudflare-tunneled Genus host).
2. Operator stores the Moneybird API token in the secret store under `secrets/moneybird/medivara`.
3. Operator edits `modules/finance/settings.json` (per-installation file in the runtime; not in this repo) and fills the four fields above.
4. Operator restarts the module loader (or waits for the next loader sweep, when GEN-113 ships).
5. The Genus Agent picks up the new connector, fires the first healthcheck, and the connector status moves to `green`.

This sequence is documented as `FIN-WIRE-MONEYBIRD-INTERIM` once the recipes/ dir ships under child D. Until then, the operator follows the steps above manually.

### 6.4 Health & test from the operator side

Until `Settings → Wiring` exists, the operator can:

- Read connector status from `bus/connectors/status.jsonl` (one record per connector per probe).
- Trigger an on-demand probe from `dashboard/public/dev-console.html → Connectors → Moneybird → Probe` once that page exists (interim; lands incrementally as the Wiring UI's progenitor surface).

Neither of these surfaces is the final UI. They exist so the operator isn't blind during the v0.7 window.

---

## 7. Divergence from the eventual GEN-104 Wiring UI

The migration to [GEN-104](https://github.com/Tij8i/Orchestrator/issues) must be **mechanical** — no code rewrites in the module, no schema changes in the bound agent. This section lists every deliberate v1 simplification so the GEN-104 implementer has a checklist of what to replace, not redesign.

| v1 interim (this doc) | GEN-104 target | Migration delta |
|---|---|---|
| `connector_ref` is a free-form string in `settings.schema.json`. | `connector_ref` resolves to a row in the central Wiring registry. | Validate at module bind time that the referenced row exists; surface a typed error if not. No schema change in `settings.schema.json` itself. |
| `endpoint_override` + `auth_token_ref` live in `settings.schema.json`. | Both live in the Wiring row; the module-local fields become optional overrides. | Wiring row values win at resolution time. Module-local values are honored if present (back-compat) and deprecated with a soft warning. |
| `healthcheck_route` is module-local. | Becomes a per-connector-type default the Wiring registry knows about (`mcp` connectors default to `/healthz`; override per-row only when needed). | Module's `healthcheck_route` default stays for back-compat; operator's per-installation override is in the Wiring row. |
| Bootstrapping is manual (operator edits `settings.json`, restarts loader). | Bootstrapping is a Wiring-UI flow with form validation, test-connection button, and visible probe status. | The Wiring UI replaces the manual edit. The on-disk shape of `settings.json` is unchanged — the UI writes the same fields. |
| Reconnect ladder runs entirely in the Genus Agent process (§4.3). | Wiring UI surfaces the ladder state with an operator "force reconnect" button. | Same ladder logic; UI gains a visualization + manual trigger. No connector code change. |
| Multi-installation aliasing is implicit (`connector_ref` carries the installation name in its path). | Wiring registry has a first-class `installation_id` field. | If the registry adopts a separate field, `connector_ref` becomes either a UUID or a `service:installation_id` tuple; module reads the new format transparently. |
| No connector-type registry — `module.json` declares `service: "moneybird"` directly. | Wiring registry has a typed connector-type table; modules reference a type by id. | `module.json` keeps the `service` field for documentation; the Wiring layer reads it as a hint and resolves against the registry. |

What does NOT change between v1 and GEN-104:

- The MCP server tool surface (§3.1). Any server that satisfies v1 also satisfies GEN-104.
- The entity mapping (§5). The normalized Genus Finance shapes are stable across the migration.
- The healthcheck cadence + staleness windows (§4.1, §4.2). The ladder runs in the Genus Agent regardless of where the operator configured the connector.
- The L2 staleness signal contract (CONFIDENCE_FRAME §6.2). The Finance Module's view-rendering rules see no difference.

---

## 8. Open items (for future children, not GEN-131)

- **Multi-administration support** — a single Moneybird user can have multiple administrations (one per legal entity). v1 wires one per Finance Module installation; multi-administration fan-out lands when the second customer asks.
- **Webhook ingestion** — Moneybird supports webhook notifications for invoice + ledger updates. The v1 path is poll-only via healthcheck cadence. Webhook subscription cuts staleness windows from minutes to seconds and is a v1.1 candidate.
- **Backfill semantics** — v1 assumes the bound agent reads forward from "now minus 90 days". Historical reconciliation against an existing book is out of scope.
- **Per-administration secret rotation** — covered by the Genus Agent's general rotation path once it ships; not a v1 module concern.

---

## 9. Cross-references

- [SPEC_v1.md](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/SPEC_v1.md) §5, §10 — connector ownership.
- [CONFIDENCE_FRAME.md](https://github.com/Tij8i/Orchestrator/blob/main/docs/genus/modules/finance/CONFIDENCE_FRAME.md) §6.2 — L2 staleness contract.
- [`../module.json`](../module.json) — `connectors.required[0]` references this doc via `documentation_ref`.
- [`../settings.schema.json`](../settings.schema.json) — `moneybird` block holds the interim wiring contract.
- [`./schemas/`](./schemas/) — normalized Genus Finance entity shapes referenced by §5.
- [GEN-104](https://github.com/Tij8i/Orchestrator/issues) — eventual `Settings → Wiring` UI; this doc's §7 is its migration delta.
- [GEN-106](https://github.com/Tij8i/Orchestrator/issues) — native Finance agent; consumes this connector contract.
- [GEN-113](https://github.com/Tij8i/Orchestrator/issues) — module loader; resolves `connector_ref` against the runtime.

---

*v1 interim — GEN-131. Migrates without code changes when GEN-104 ships per §7.*
