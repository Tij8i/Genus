# Genus — Manifest Specification

**Version**: 0.5 — adds `monitor` to the `archetype` enum and the Monitor-specific field set per `GENUS_SPEC.md` v0.6 and `MONITOR.md` v0.1
**Status**: Public specification. Manifest contract for Genus-conformant agents.
**Last updated**: 2026-06-25

---

## What this document is

The specification for `GENUS_MANIFEST.md` — the **plug-in contract** that every Genus-compatible agent ships. The manifest is what makes an agent's archetype claim, runtime requirements, permission scope, and lifecycle state machine-readable.

Read this if you are:
- Building any Genus-compatible agent (the manifest is required regardless of archetype)
- Writing a runtime that hosts Genus agents (the manifest tells you what to expect)
- Building tooling that indexes, validates, or queries Genus agents (the manifest is what you parse)

Prior reading: `GENUS_SPEC.md` (the protocol), `AGENT_FAMILIES.md` (the four families), and the relevant archetype spec (`VIRGIL.md` / `STEWART.md` / `MONITOR.md` / `MASON.md`).

---

## What a manifest is and why it exists

The manifest is the **contract between an agent and the Genus installation that hosts it**. A repo ships an agent; the manifest declares what that agent is, what it needs, and what it commits to. A Genus installation reads the manifest at registry time and uses it to:

- Validate that the agent honors the non-negotiables of `GENUS_SPEC.md`
- Configure the installation's substrate to receive the agent's reads + writes
- Allocate connector permissions per the agent's declared scope
- Surface the agent in the registry, the dashboard, the operator's view
- Route invocations (for Masons) or schedule heartbeats (for Stewarts + Virgils)

A non-conformant manifest means the agent **does not participate in Genus governance**: dashboards don't see it, approval gates can't be enforced on it, memory isn't auditable. There is no enforcement engine that prevents a non-conformant manifest from existing; conformance is the **price of admission** to the Genus ecosystem.

---

## File location and format

The manifest lives at the root of the agent's repo as `GENUS_MANIFEST.md`.

The file is a Markdown wrapper around a YAML block:

```
# <Agent name> — Genus Manifest

<Optional human-readable prose about the agent.>

​```yaml
# The structured manifest
genus_version: "0.1"
archetype: "stewart"
... (per the schema below)
​```

<Optional human-readable footer / changelog.>
```

The YAML block is what tooling parses. The Markdown wrapper is for humans browsing the repo. If multiple YAML blocks exist in the file, the **first** is treated as the manifest.

---

## Universal fields (all archetypes)

Required for every Genus agent regardless of archetype.

| Field | Type | Required | Description |
|---|---|---|---|
| `genus_version` | string | yes | Which Genus protocol version this agent conforms to (e.g., `"0.1"`). The agent commits to behaving according to this version's spec. |
| `archetype` | enum | yes | One of `"virgil"`, `"stewart"`, `"monitor"`, `"mason"`. The family this agent belongs to. |
| `name` | string | yes | The agent's instance name (e.g., `"Mindy"`, `"PA Virgil"`, `"Designer Mason"`). Human-readable. |
| `version` | string | yes | The agent's own version (semver, e.g., `"1.0.0"`). Independent of `genus_version`. |
| `operator` | string \| null | yes | Identifier for the operator this agent serves. `null` for unbound templates / community repos pre-fork. |
| `runtime` | string | yes | Which agent runtime executes this agent. Common values: `"claude_code"`, `"n8n"`, `"langgraph"`, `"crewai"`, `"openai_agents_sdk"`, `"custom"`. |
| `host` | string | no (v0.2) | The orchestration layer hosting the runtime — when different from the runtime itself. Examples: `"nanoclaw"` (hosts Claude Code agents with cron + Telegram bridge), `"anthropic_claude_ai"` (hosts Claude Code agents via the claude.ai Triggers infrastructure), `"self_hosted"`. Used when multiple cron/orchestration options exist for the same runtime. Omit when the runtime is its own host. |
| `identity_files` | object | yes | Paths to the required identity files for this archetype. See per-archetype sections below. |
| `permissions` | list of strings | yes | Permission scopes the agent requests. Format: `"<action>:<resource>"` (e.g., `"read:calendar"`, `"write:kpi_measurements"`, `"connector:canva"`). |
| `connectors` | list of strings | yes (may be empty) | External MCP / API connectors this agent requires. Names match the installation's connector registry. |
| `composability` | object | yes | Declares whether this agent runs standalone and what other agents it expects. See *Composability* below. |
| `repo_url` | string | yes | Where the agent's source lives. Public URL. |
| `license` | string | yes | Open-source license identifier (e.g., `"MIT"`, `"Apache-2.0"`) or `"proprietary"`. |
| `distribution` | enum | no (v0.2) | Clarifies license semantics: `"community-template"` (open-source template anyone may fork), `"operator-bound"` (a specific operator's instance; not designed for general fork), `"proprietary"` (closed source). When omitted, inferred from the `license` field (`"MIT"` etc. → community-template; `"proprietary"` → proprietary; ambiguous values like `"internal"` → operator-bound). |
| `substrate_mapping` | object | no (v0.2) | Declares which configured connector implements which Genus operational substrate store. Recognized keys (v0.3): `task_store`, `campaign_store`, `kpi_registry`, `workflow_registry`, `agent_updates_store`, `approval_log`, `artifact_index`. Example: `{ task_store: "notion:taskDB-id", campaign_store: "notion:goalsProjectsDB-id", kpi_registry: "notion:kpiRegistry-id", ... }`. Without this, the installation can't know which Notion database is which store. Optional (defaults inferred from connector defaults); recommended for installations with multiple data stores. |
| `installation_configuration` | object | no (v0.2) | Declares what an installation must wire up before the agent can run. Example: a Mason that uses Canva may declare `installation_configuration: { brand_kit_ids: { required: true, type: "list[string]" } }` — the installation must supply at least one brand-kit ID before the Mason is usable. Surfaces configuration requirements that the agent itself doesn't ship with. |
| `confidence_frame_mode` | enum \| object | conditional (v0.4) | Declares how this agent's bound surfaces handle low-confidence claims per `CONFIDENCE_FRAME.md` v1. **Required for any agent that emits claims to a Genus surface** (substrate stores, dashboards, module views, operator-facing artifacts). Omit for agents that produce only raw chat output (the `GENUS_SPEC.md` non-negotiable #2 grandfathering). Simple form: one of `"silent"`, `"warn"`, `"block"` — applied uniformly to every surface the agent emits to. Per-surface form: object mapping surface identifier → mode, e.g. `{ "finance.overview": "silent", "finance.outbound_payment": "block" }`. Surface identifiers are module-defined; consult the module's binding contract. Default when ambiguous: `"silent"`. See [CONFIDENCE_FRAME.md § 6](./CONFIDENCE_FRAME.md) for mode semantics. |

### Composability object

```yaml
composability:
  standalone: true              # Can this agent operate without other agents present?
  expects: ["genus>=0.1"]       # What it requires to fully function.
  recommends: ["mason:designer"] # Other agents whose presence enhances it but is not required.
```

- `standalone`: boolean. `true` means the agent does useful work even when alone in its installation. `false` is rare and usually means the agent should be re-scoped.
- `expects`: list of dependencies the agent requires. Format: `"<archetype>:<name>"` or `"genus>=<version>"` for protocol versions.
- `recommends`: list of optional companions. Empty array if none.

---

## Stewart-specific fields

| Field | Type | Required | Description |
|---|---|---|---|
| `business_unit` | string | yes | Name of the BU this Stewart owns. Singular. |
| `heartbeat_schedule` | string | yes | Cron expression for the daily heartbeat (e.g., `"0 4 * * *"` for 04:00 daily). |
| `kpis` | list of objects | yes | KPIs this Stewart owns. Each entry: `{ name, kpi_registry_ref, cadence }`. |
| `authority_envelope` | object | yes | Per-workflow authority levels (🟢 / 🟡 / 🔴). |
| `campaign_cap` | integer | no (v0.3) | Maximum number of `Active` Campaigns this Stewart will hold concurrently. Default: `3`. Floor: `1`. The Stewart enforces this cap at promotion time (cannot promote a Not-started Campaign if cap is full and no slot has opened). Per `STEWART.md` v0.3 § Campaign discipline. |
| `campaign_status_enum` | list of strings | no (v0.3) | Declares the Campaign status taxonomy this Stewart honors. Default (and recommended): `["Not started", "Active", "Dormant", "Paused", "Completed", "Discarded"]`. An installation MAY substitute equivalents (e.g., `"Open"` for `"Active"`) but MUST include semantic equivalents for all six default states. Installations using non-default values declare the mapping here so dashboards can render correctly. |
| `campaign_dormant_threshold_days` | integer | no (v0.3) | Number of days of zero task activity after which an `Active` Campaign auto-transitions to `Dormant` and the Stewart files an Action Required. Default: `14`. Per `STEWART.md` v0.3 § Campaign discipline. |

### Stewart `identity_files`

```yaml
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  business: "BUSINESS.md"
  insights: "INSIGHTS.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  trust_log: "TRUST_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
```

### Stewart `authority_envelope`

```yaml
authority_envelope:
  default: "approval"           # The default for any workflow not explicitly listed (🔴).
  workflows:
    - workflow: "weekly_kpi_capture"
      level: "autonomous"        # 🟢
    - workflow: "send_outbound_message"
      level: "approval"          # 🔴
    - workflow: "draft_recommendation"
      level: "notified"          # 🟡
```

---

## Virgil-specific fields

| Field | Type | Required | Description |
|---|---|---|---|
| `personal_domain` | string | yes | The single personal domain (e.g., `"general PA"`, `"fitness"`, `"mental health"`, `"career"`). |
| `heartbeat_schedule` | string | yes | Cron expression. May be more frequent than Stewart's daily (e.g., morning + evening). |
| `personal_data_scope` | list of strings | yes | Explicit declaration of personal data classes accessed. Subset of `permissions`, elevated for visibility. |
| `kpis` | list of objects | yes (may be empty) | Personal KPIs this Virgil owns. Same shape as Stewart's. |
| `authority_envelope` | object | yes | Per-action-class authority levels. More granular than Stewart's per-workflow envelope (e.g., read inbox 🟢 / draft reply 🟡 / send reply 🔴). |

---

## Monitor-specific fields

Required for any agent declaring `archetype: "monitor"`.

| Field | Type | Required | Description |
|---|---|---|---|
| `business` | string | yes | The single business this Monitor watches. Singular. |
| `domain` | string | yes | The single domain this Monitor is bound to (e.g., `"finance"`, `"compliance"`, `"ops_uptime"`, `"marketing_health"`, `"support_quality"`). Singular. A Monitor with two domains is a manifest error — split into two Monitors. |
| `heartbeat_schedule` | string | yes | Cron expression for the heartbeat (e.g., `"0 5 * * *"` for 05:00 daily, `"0 * * * *"` for hourly). Cadence is domain-appropriate; most Monitors are daily. |
| `watched_kpis` | list of objects | yes | KPIs this Monitor watches (tracks honestly, does not own a target to move). Each entry: `{ name, kpi_registry_ref, cadence }`. Distinct from Stewart's `kpis` (which the Stewart owns and tries to move). |
| `action_allow_list` | list of strings | yes | The explicit allow-list of substrate writes this Monitor can perform. Format: `"<action>:<resource>"` (e.g., `"emit:recommendation_feed.finance"`, `"emit:alert.runway"`, `"emit:digest.monthly_finance"`). Empty list means surfacing-only with no substrate writes — valid but rare. **Anything outside this list is not in the Monitor's envelope and cannot be performed at all.** |
| `authority_envelope` | object | yes | Per-action authority levels (🟢 / 🟡 / 🔴), keyed by entries from `action_allow_list`. Distinct from Stewart's per-workflow envelope. |
| `recommendation_feed_ref` | string | yes (may be empty string) | Reference to the installation's Recommendation feed substrate location for this Monitor (e.g., `"notion:<recommendation-feed-db-id>"`). The Monitor writes recommendations here. Empty string allowed only for Monitors that surface alerts/digests but no recommendation feed (rare). |
| `confidence_frame_mode` | enum \| object | **yes** | Required for Monitors (not conditional). Monitors emit claims to Genus surfaces by definition; ConfidenceFrame is the load-bearing primitive of the archetype. See universal field above + `CONFIDENCE_FRAME.md` for shape. Monitor default: `"block"` on operator-facing surfaces. |

### Monitor `identity_files`

```yaml
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  business: "BUSINESS.md"
  insights: "INSIGHTS.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
```

Notice the absence of `targets` and `trust_log` compared to Stewart. A Monitor does not own period-bound delivery targets (the figures it watches have alerting thresholds, not delivery targets), and it has no bi-weekly trust-cycle authority-expansion ritual — calibration is the ranking-learner kind, recorded inline in `REFLECTION_LOG.md`.

### Monitor `authority_envelope`

```yaml
authority_envelope:
  default: "approval"           # 🔴 — anything not explicitly listed is approval-required (and must be in action_allow_list anyway)
  actions:
    - action: "emit:recommendation_feed.finance"
      level: "autonomous"        # 🟢 — surfacing is the whole point
    - action: "emit:alert.runway"
      level: "autonomous"        # 🟢
    - action: "emit:digest.monthly_finance"
      level: "autonomous"        # 🟢
    - action: "mark:recommendation_superseded"
      level: "autonomous"        # 🟢 — internal feed hygiene
    - action: "ack:recommendation_auto"
      level: "approval"          # 🔴 — auto-ack defaults off; operator may climb per-recommendation-class
```

### Monitor `action_allow_list` validation rules

- Every entry in `authority_envelope.actions` must reference an action present in `action_allow_list`.
- An action present in `action_allow_list` but missing from `authority_envelope.actions` is treated at the `authority_envelope.default` level.
- A Monitor cannot expand `action_allow_list` at runtime — adding a new action is an explicit operator action that updates the manifest + `CONTRACT.md`.

### Virgil `identity_files`

```yaml
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  preferences: "PREFERENCES.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  trust_log: "TRUST_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
```

### Virgil `personal_data_scope`

```yaml
personal_data_scope:
  - "personal_data:calendar"
  - "personal_data:inbox"
  - "personal_data:journal"
```

The operator can revoke any of these at any time; revocation takes effect at the next heartbeat. The manifest is the operator's reference for what Virgil currently has access to.

---

## Mason-specific fields

| Field | Type | Required | Description |
|---|---|---|---|
| `craft_specialty` | string | yes | The one craft (e.g., `"visual_design"`, `"code_generation"`, `"research"`, `"copywriting"`). |
| `comparison_ref` | string | yes | Path to `COMPARISON.md` within the repo. |
| `current_rating` | number \| null | yes | Current aggregate weighted rating (1.0–5.0). `null` for Probationary Masons with < 5 rated invocations. Updated by the Mason after each invocation. |
| `invocation_count` | integer | yes | Lifetime count of invocations. |
| `lifecycle_state` | enum | yes | One of `"probationary"`, `"active"`, `"retired"`. Derived from rating + invocation count per `MASON.md`. |
| `heartbeat_schedule` | null | yes | **Must be `null`.** Mason has no clock. Declaring a heartbeat is a manifest error. |
| `context_inputs` | list of objects | no (v0.2) | Files the Mason reads at every invocation that are neither the brief nor accumulated craft memory. Example: a Designer Mason reading a saved taste-reference library. Each entry: `{ path, purpose }`. Lets the installation surface "background knowledge" of the Mason to the operator. |

### Mason `identity_files`

```yaml
identity_files:
  card: "MASON_CARD.md"
  craft_log: "CRAFT_LOG.md"
  comparison: "COMPARISON.md"
  rating_log: "RATING_LOG.md"
```

Notice the absence of `identity`, `contract`, `playbook`, `domain_model`, `reflection_log`, `trust_log`, `handoff`, `learning_log`. Those exist for continuous agents that maintain state across sessions; a Mason that has them has become a Stewart and should be re-classified.

---

## Field reference (universal validation rules)

| Field | Validation |
|---|---|
| `genus_version` | Must match a published Genus protocol version. v0.1 agents continue to function when Genus 0.2 ships (MINOR is non-breaking). |
| `archetype` | Must be exactly one of `"virgil"`, `"stewart"`, `"monitor"`, `"mason"`. (v0.1–v0.4 permitted only `"virgil"` / `"stewart"` / `"mason"`; v0.5 adds `"monitor"` per `GENUS_SPEC.md` v0.6.) |
| `permissions` | Each entry must be a recognized permission scope. Unknown scopes are rejected at registry time. |
| `connectors` | Each entry must match a connector available in the installation's connector pool (or be flagged as a missing dependency). |
| `heartbeat_schedule` | Stewart + Virgil + Monitor: must be a valid cron expression. Mason: must be `null`. |
| `composability.standalone` | If `false`, the `expects` list must contain at least one entry. |
| `confidence_frame_mode` | Required for agents that emit claims to a Genus surface (per `GENUS_SPEC.md` non-negotiable #2 and `CONFIDENCE_FRAME.md` v1). Simple form: one of `"silent"` / `"warn"` / `"block"`. Per-surface form: object mapping surface identifier → mode; each value one of the same three strings. Omit only for agents that produce raw chat output and write no claims to substrate / dashboards / module views. |

A manifest that fails validation is not registered. The installation surfaces the validation failure to the operator (or the agent author) for correction.

---

## Example manifests

### Stewart — Mindy (marketing BU)

```yaml
genus_version: "0.1"
archetype: "stewart"
name: "Mindy"
version: "2.0.0"
operator: "you@example.com"
runtime: "claude_code"
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  business: "BUSINESS.md"
  insights: "INSIGHTS.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  trust_log: "TRUST_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
permissions:
  - "read:kpi_registry"
  - "write:kpi_measurements"
  - "read:task_store"
  - "write:task_store"
  - "read:campaign_store"
  - "write:campaign_store"
  - "write:agent_updates"
  - "read:workflow_registry"
  - "connector:notion"
  - "connector:google_workspace"
connectors:
  - "notion"
  - "google_workspace"
substrate_mapping:
  task_store: "notion:<task-db-id>"
  campaign_store: "notion:<campaign-db-id>"
  kpi_registry: "notion:<kpi-registry-id>"
  workflow_registry: "notion:<workflow-registry-id>"
  agent_updates_store: "notion:<agent-updates-id>"
composability:
  standalone: true
  expects: ["genus>=0.1"]
  recommends: ["mason:designer", "mason:copywriter"]
repo_url: "https://github.com/example/mindy-stewart"
license: "MIT"
business_unit: "Marketing"
heartbeat_schedule: "0 4 * * *"
kpis:
  - name: "Qualified leads per month"
    kpi_registry_ref: "marketing.qualified_leads_per_month"
    cadence: "weekly"
  - name: "Content production rate"
    kpi_registry_ref: "marketing.content_published_per_week"
    cadence: "weekly"
authority_envelope:
  default: "approval"
  workflows:
    - workflow: "weekly_kpi_capture"
      level: "autonomous"
    - workflow: "draft_recommendation"
      level: "notified"
    - workflow: "outbound_campaign_send"
      level: "approval"
campaign_cap: 3
campaign_status_enum:
  - "Not started"
  - "Active"
  - "Dormant"
  - "Paused"
  - "Completed"
  - "Discarded"
campaign_dormant_threshold_days: 14
```

### Virgil — Personal Assistant

```yaml
genus_version: "0.1"
archetype: "virgil"
name: "PA Virgil"
version: "1.0.0"
operator: "you@example.com"
runtime: "claude_code"
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  preferences: "PREFERENCES.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  trust_log: "TRUST_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
permissions:
  - "read:task_store"
  - "write:task_store"
  - "write:agent_updates"
  - "personal_data:calendar"
  - "personal_data:inbox"
  - "personal_data:journal"
  - "connector:google_workspace"
  - "connector:notion"
connectors:
  - "google_workspace"
  - "notion"
composability:
  standalone: true
  expects: ["genus>=0.1"]
  recommends: []
repo_url: "https://github.com/example/pa-virgil"
license: "MIT"
personal_domain: "general PA"
heartbeat_schedule: "0 6,18 * * *"   # 06:00 + 18:00 daily
personal_data_scope:
  - "personal_data:calendar"
  - "personal_data:inbox"
  - "personal_data:journal"
kpis:
  - name: "Daily reflection completion"
    kpi_registry_ref: "operator.daily_reflection_streak"
    cadence: "daily"
  - name: "Weekly planning session completion"
    kpi_registry_ref: "operator.weekly_planning_completion"
    cadence: "weekly"
authority_envelope:
  default: "approval"
  workflows:
    - workflow: "morning_brief_compose"
      level: "autonomous"
    - workflow: "calendar_block_create"
      level: "notified"
    - workflow: "send_message_on_behalf"
      level: "approval"
```

### Monitor — Finance Monitor

```yaml
genus_version: "0.6"
archetype: "monitor"
name: "Quill Monitor"
version: "1.0.0"
operator: "you@example.com"
runtime: "claude_code"
identity_files:
  identity: "IDENTITY.md"
  contract: "CONTRACT.md"
  playbook: "PLAYBOOK.md"
  domain_model: "DOMAIN_MODEL.md"
  business: "BUSINESS.md"
  insights: "INSIGHTS.md"
  recommendations: "RECOMMENDATIONS.md"
  reflection_log: "REFLECTION_LOG.md"
  handoff: "HANDOFF.md"
  learning_log: "LEARNING_LOG.md"
permissions:
  - "read:kpi_registry"
  - "write:kpi_measurements"
  - "read:agent_updates"
  - "write:agent_updates"
  - "write:recommendation_feed.finance"
  - "connector:moneybird"
connectors:
  - "moneybird"
substrate_mapping:
  kpi_registry: "notion:<kpi-registry-id>"
  agent_updates_store: "notion:<agent-updates-id>"
composability:
  standalone: true
  expects: ["genus>=0.6"]
  recommends: []
repo_url: "https://github.com/example/finance-monitor"
license: "MIT"
business: "Medivara"
domain: "finance"
heartbeat_schedule: "0 5 * * *"   # 05:00 daily
watched_kpis:
  - name: "Runway days"
    kpi_registry_ref: "fin.runway_days"
    cadence: "daily"
  - name: "Monthly burn rate"
    kpi_registry_ref: "fin.burn_rate"
    cadence: "daily"
  - name: "Current cash position"
    kpi_registry_ref: "fin.cash_position"
    cadence: "daily"
  - name: "Gross revenue trailing 3 months"
    kpi_registry_ref: "fin.gross_revenue_3m"
    cadence: "daily"
action_allow_list:
  - "emit:recommendation_feed.finance"
  - "emit:alert.runway"
  - "emit:alert.draw_conflict"
  - "emit:digest.monthly_finance"
  - "mark:recommendation_superseded"
authority_envelope:
  default: "approval"
  actions:
    - action: "emit:recommendation_feed.finance"
      level: "autonomous"
    - action: "emit:alert.runway"
      level: "autonomous"
    - action: "emit:alert.draw_conflict"
      level: "autonomous"
    - action: "emit:digest.monthly_finance"
      level: "autonomous"
    - action: "mark:recommendation_superseded"
      level: "autonomous"
recommendation_feed_ref: "notion:<recommendation-feed-db-id>"
confidence_frame_mode:
  "finance.overview": "warn"
  "finance.runway_alert": "block"
  "finance.monthly_digest": "block"
  "finance.investor_view": "block"
```

### Mason — Designer

```yaml
genus_version: "0.1"
archetype: "mason"
name: "Designer Mason"
version: "1.0.0"
operator: null    # Community Mason; not bound to a single operator
runtime: "claude_code"
identity_files:
  card: "MASON_CARD.md"
  craft_log: "CRAFT_LOG.md"
  comparison: "COMPARISON.md"
  rating_log: "RATING_LOG.md"
permissions:
  - "read:artifact_index"
  - "write:artifact_index"
  - "connector:canva"
connectors:
  - "canva"
composability:
  standalone: false
  expects: ["genus>=0.1", "stewart:any"]
  recommends: []
repo_url: "https://github.com/example/genus-mason-designer"
license: "MIT"
craft_specialty: "visual_design"
comparison_ref: "COMPARISON.md"
current_rating: 4.2
invocation_count: 47
lifecycle_state: "active"
heartbeat_schedule: null
```

---

## Versioning and compatibility

The manifest schema versions independently of the agent itself, tracked through `genus_version`.

- **`genus_version: "0.1"`** — this spec. Agents must implement the fields above with the specified types and validation.
- **Future MINOR versions** (0.2, 0.3, ...) — additive only. v0.1 agents continue to work; v0.2 agents may declare new optional fields. v0.1 installations may reject v0.2 manifests whose required fields they don't recognize, or may accept them with unknown fields ignored (installation policy).
- **Future MAJOR versions** (1.0, 2.0) — breaking. Migration path provided per release.

An agent's own version (`version` field) is independent and follows the agent's own release discipline.

---

## Conformance + validation

A manifest is *conformant* if it:

- [ ] Contains all required fields for the declared archetype
- [ ] Passes universal validation (above)
- [ ] References real files (every `identity_files` path resolves)
- [ ] Declares only known permission scopes and connectors (per the installation's catalog)
- [ ] Honors archetype constraints (Mason `heartbeat_schedule: null`, Stewart `business_unit` singular, Virgil `personal_data_scope` declared, Monitor `business` + `domain` both singular, Monitor `action_allow_list` declared + every entry in `authority_envelope.actions` referencing an allow-listed action, etc.)
- [ ] Honors the 9 non-negotiables of `GENUS_SPEC.md` (the manifest is the surface where most of them are visible)

A conformant manifest grants the agent admission to Genus governance: registry indexing, dashboard visibility, approval gate enforcement, auditable memory, KPI capture routing.

A non-conformant manifest is rejected at registry time. The installation logs the failure reason. The agent author corrects + re-submits.

---

## What is deferred to v0.2+

- **Schema validation tooling** — v0.1 ships the spec; v0.2 ships a `genus validate` CLI command (or equivalent) that parses + validates a manifest against the schema.
- **Cross-installation manifest portability** — a manifest written for installation A may not work in installation B (different connector catalog, different permission scopes). v0.2+ may introduce a portability layer that translates manifests between installations.
- **Signed manifests** — cryptographic signing of manifests to attest authorship + integrity. Considered for v0.2 alongside `SECURITY_MODEL.md`.
- **Manifest-driven UI generation** — the Genus app could auto-generate per-agent UI from the manifest (which actions are available, which require approval, which connectors are configured). Phase D concern, not v0.1.
- **Per-dimension Mason ratings in manifest** — v0.1 surfaces `current_rating` as a single number; v0.2 may add per-dimension breakdown for richer Stewart-side picking.

---

## What to read next

- Want to understand the protocol the manifest sits inside? → `GENUS_SPEC.md`
- Want to understand the four archetypes? → `AGENT_FAMILIES.md`
- Building a specific archetype? → `VIRGIL.md` / `STEWART.md` / `MASON.md`
- Need to wire a runtime to consume manifests? → see the `Runtime` primitive in `GENUS_SPEC.md` and the schema here.

---

*v0.1 (2026-05-28) — initial draft. Source: schema accumulated across `GENUS_SPEC.md`, `VIRGIL.md`, `STEWART.md`, `MASON.md` (all v0.1). This file closes Phase A of the Genus v0.1 spec.*

*v0.2 (2026-05-29) — five optional fields added based on Phase B retrofit findings:
- `host`: orchestration layer hosting the runtime (e.g., `"nanoclaw"`) — needed when runtime + host are distinct (Virgil PA: Claude Code on NanoClaw).
- `distribution`: clarifies license semantics (`"community-template"` / `"operator-bound"` / `"proprietary"`) — needed because operator-bound instances don't fit open-source license assumptions (Mindy is operator-bound; Designer Mason is community-template-shape).
- `substrate_mapping`: declares which connector implements which Genus operational substrate store — needed when an installation uses multiple data stores (Mindy uses Notion for Task store, KPI Registry, Workflow Registry, Agent Updates; without mapping, the installation can't tell which DB is which).
- `installation_configuration`: declares per-installation config requirements an agent doesn't ship with — needed for Masons that use installation-specific identifiers (Designer Mason's brand-kit IDs).
- Mason `context_inputs`: declares files the Mason reads at every invocation (Designer Mason reading `REFERENCES.md` as its taste library) — distinct from craft memory and from the brief.

All five are additive and optional; v0.1 manifests continue to validate under v0.2 (MINOR per the versioning rules).*

*v0.3 (2026-05-29) — Campaign substrate added per `GENUS_SPEC.md` v0.3:
- `substrate_mapping` recognizes a new key, `campaign_store` (points at the installation's Campaign / Goals & Projects DB).
- Three new optional Stewart-specific fields: `campaign_cap` (default 3), `campaign_status_enum` (default the six canonical states), `campaign_dormant_threshold_days` (default 14).
- Mindy example updated to demonstrate the Campaign-store substrate mapping + the new Stewart fields, using placeholder substrate IDs to document the mapping shape.

All additions are additive and optional; v0.1 and v0.2 manifests continue to validate under v0.3 (MINOR per the versioning rules). An installation can adopt the Campaign primitive without re-issuing existing manifests.*

*v0.4 (2026-06-24) — `confidence_frame_mode` field added per `GENUS_SPEC.md` v0.5 partial bump and `CONFIDENCE_FRAME.md` v1:
- Universal field, conditionally required: any agent emitting claims to a Genus surface (substrate stores, dashboards, module views, operator-facing artifacts) must declare its policy mode. Agents producing only raw chat output may omit (the grandfathering carve-out from `GENUS_SPEC.md` non-negotiable #2).
- Two shapes: simple string (`"silent"` / `"warn"` / `"block"`) applied uniformly to every surface the agent emits to, or an object mapping surface identifier → mode for richer per-surface control. The per-surface shape is the one referenced by the Finance Module v1 spec and by future module bindings.
- v0.1 / v0.2 / v0.3 manifests continue to validate under v0.4 (MINOR per the versioning rules), but agents already emitting claims to Genus surfaces are expected to add this field on their next manifest revision to remain conformant with the updated non-negotiable #2.*

*v0.5 (2026-06-25) — **Monitor archetype added** per `GENUS_SPEC.md` v0.6 and `MONITOR.md` v0.1:
- The `archetype` enum expands from `"virgil" | "stewart" | "mason"` to `"virgil" | "stewart" | "monitor" | "mason"`. v0.1–v0.4 manifests continue to validate under v0.5 (the existing three values remain valid).
- New Monitor-specific field block: `business` (singular, parallel to Stewart's `business_unit`), `domain` (singular — the watched domain), `heartbeat_schedule`, `watched_kpis` (KPIs the Monitor tracks honestly; distinct from Stewart's `kpis` which the Stewart tries to move), `action_allow_list` (the explicit allow-list of substrate writes — anything outside is not in the envelope at all), `authority_envelope` (per-action, keyed by `action_allow_list` entries; distinct shape from Stewart's per-workflow envelope), `recommendation_feed_ref`, `confidence_frame_mode` (required for Monitor, not conditional — Monitors emit claims by definition).
- New Monitor `identity_files` set — same shape as Stewart's, with `targets` and `trust_log` omitted (Monitor has no period-bound delivery targets and no bi-weekly trust-cycle ritual).
- New worked example manifest: Finance Monitor (`Quill Monitor`) — the first Monitor instance, watching one business's books via Moneybird, surfacing runway alerts + monthly digest with per-surface `confidence_frame_mode`.
- New validation rule: every entry in `authority_envelope.actions` for a Monitor must reference an action in `action_allow_list`; Monitors cannot expand `action_allow_list` at runtime — adding an action is an explicit operator action that updates the manifest + `CONTRACT.md`.
- Conformance checklist updated: Monitor `business` + `domain` both singular; `action_allow_list` declared with envelope cross-reference.
- v0.1 / v0.2 / v0.3 / v0.4 manifests continue to validate under v0.5 (MINOR per the versioning rules). Stewart / Virgil / Mason manifests are unchanged.*
