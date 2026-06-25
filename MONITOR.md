# Genus — Monitor Archetype

**Version**: 0.1 (draft) — first cut, declared as the fourth Genus family per `GENUS_SPEC.md` v0.6 and `AGENT_FAMILIES.md` v0.2
**Status**: Public specification. Part of the Genus archetype family docs.
**Last updated**: 2026-06-25

---

## What this document is

The archetype specification for **Monitor** — the continuous domain-bound watcher. Read this if you are:
- Building a Monitor instance (Finance Monitor for a single business's books, Compliance Monitor for a single regulated domain, etc.)
- Wrapping a domain-bound monitoring module with a native Monitor agent
- Integrating a runtime that needs to host Monitor agents

Prior reading: `GENUS_SPEC.md` (the protocol), `AGENT_FAMILIES.md` (the four families), and — if the boundary between Monitor and Stewart matters for your work — `STEWART.md`.

---

## What a Monitor is

**One-liner**: *A Monitor is a continuous domain-bound agent that watches one business in one domain, surfaces what jumps out, and writes through a narrow allow-listed action surface (typically a Recommendation feed) — no Campaigns, no delivery loops.*

A Monitor is built around five commitments:

1. **Continuous watch, not episodic delivery.** A Monitor has a heartbeat. The heartbeat's job is to refresh domain state, detect anomalies, and keep the Recommendation feed honest — not to push Campaigns forward (it does not run any). Most of the work lives in the Mind Layer; the Activity Layer is a narrow recommendation surface plus alerts plus an optional digest.
2. **Narrow, allow-listed action surface.** A Monitor is read-mostly. Its writes to the substrate are restricted to a small, declared set — typically a single Recommendation feed (and the digest / alert artifacts that ride on top). It does not draft outbound, mutate domain data in source systems, or open Initiatives. Anything outside its allow-list requires operator action.
3. **ConfidenceFrame-native.** A Monitor does not render a figure it cannot defend. Every claim it surfaces (a runway day count, a drift signal, a flagged anomaly) carries an attached ConfidenceFrame per `CONFIDENCE_FRAME.md` v1. L1 hard-gate failures suppress the claim rather than emit it silently. The whole point of a Monitor is that the operator can trust the surfaced state — silent fakery is the failure mode it most has to guard against.
4. **No Campaign or Initiative mechanics.** A Monitor does not inherit Stewart-shaped delivery loops. It has no `campaign_cap`, no L1/L2 prioritization split, no Dormant > 14d auto-flag, no "Campaign Shipped" events. The unit at which it works is the **observation cycle** (heartbeat → refresh → recommend / alert / digest), not the finite delivery (Campaign). If the work being asked of an agent requires shipping a Campaign, the agent is a Stewart, not a Monitor.
5. **Domain-bound.** A Monitor serves **exactly one operator**, **exactly one business**, and **exactly one domain** (finance, marketing-health, compliance, ops-uptime, etc.). Cross-domain coordination is Stewart territory; cross-business reuse is module territory (one module, multiple installations). A Monitor that watches two domains at once has begun absorbing Stewart's job.

A Monitor serves **exactly one operator**, **exactly one business**, and **exactly one domain**.

---

## How Monitor differs from Stewart (the critical boundary)

Both Monitor and Stewart are **continuous + business-scoped**. The discriminator is the **work shape**:

| Dimension | Stewart | Monitor |
|---|---|---|
| **Work shape** | Delivery (Campaigns shipped, Initiatives moved) | Watch (observation cycles, recommendations surfaced) |
| **Active set the operator manages** | 1–3 Active Campaigns per Stream (hard cap) | Recommendation feed depth (per-instance configuration; no Genus-level cap) |
| **Trust-progression modes** | Monitor → Recommend → Execute (climbing toward autonomous Execute) | Recommend-only by archetype default; Execute mode does not apply (no delivery loop to autonomize) |
| **Authority envelope shape** | Per-workflow (🟢 / 🟡 / 🔴) — workflows can climb to 🟢 over time | Per-action (🟢 / 🟡 / 🔴) on a small, declared allow-list — climbing happens within the allow-list, not by expanding it |
| **Substrate write surface** | Task store, Campaign store, KPI Measurements, Agent Updates, etc. — broad | Recommendation feed + Agent Updates (alerts/digests) — narrow |
| **Primary KPI relationship** | Owns KPIs it tries to **move** (qualified leads ↑, CAC ↓) | Watches KPIs it tries to **track honestly** (runway days, burn rate, anomaly count) |
| **Heartbeat work** | Domain refresh + reflection + KPI capture + Trust Cycle + Campaign progression | Domain refresh + anomaly scan + recommendation re-validation + KPI capture (no Campaign progression) |
| **Failure mode it most has to avoid** | Drift (work without shipping) | Silent fakery (surfacing a number it cannot defend) |

**Decision rule** (used in the family decision flowchart in `AGENT_FAMILIES.md`):

> *Is the agent expected to ship finite deliveries inside its BU, with operator-approved scope?* → If yes, **Stewart**. If no — the work shape is "watch, recommend, alert, digest" — **Monitor**.

The Stewart's three modes (Monitor → Recommend → Execute) are the *operational stance* of one Stewart workflow at a moment in time. The Monitor *family* is a separate archetype with a different shape. **The name overlap is unfortunate but intentional**: "Monitor" is the right word in both places (a Stewart in Monitor mode is observing-without-executing; a Monitor agent is observing-without-delivering). When ambiguity matters, use *Stewart's Monitor mode* vs *Monitor family*.

---

## The two layers (Activity + Mind)

Like Stewart, a Monitor operates across two architectural layers. Unlike Stewart, the Mind Layer carries the dominant share of the work.

### Mind Layer (agent-internal — most of the work)

The Monitor's heartbeat runs daily (or on a domain-appropriate cadence — finance might be daily, marketing-health might be hourly). The heartbeat sequence:

- **Domain Model Refresh** — re-read source systems via the bound connectors (e.g., Moneybird for Finance, the CRM for marketing-health); update the Monitor's domain model; refresh ConfidenceFrames for every tracked figure.
- **Anomaly Scan** — apply the Monitor's anomaly rules to the refreshed state; identify candidates for surfacing.
- **Recommendation Re-validation** — for each open recommendation in the feed, re-evaluate whether it's still warranted given the refreshed state; mark stale recommendations as superseded.
- **KPI Capture** — pull current values for the domain KPIs the Monitor watches and write to the KPI Measurements store with attached ConfidenceFrames.
- **Digest Assembly (optional)** — if a periodic digest cadence is configured (e.g., monthly finance digest), assemble the digest from the refreshed state.

By the time the operator glances at the dashboard or asks the Monitor a question, the Monitor already knows the current state, what's flagged, and what it's confident about. No on-session pulls from source systems.

### Activity Layer (operator-facing — narrow)

The operator-facing surface is intentionally small:

- **Recommendation feed** — the single substrate write surface the Monitor uses. Each recommendation carries a ConfidenceFrame, a domain reference (the figure or signal that triggered it), a suggested action, and a status (open / acknowledged / superseded / dismissed).
- **Alerts** — push-style notifications for high-priority signals (e.g., runway days dropped below a configured threshold).
- **Digest** (optional) — periodic operator-facing summary, on a configured cadence (e.g., monthly).
- **Question answering** — the operator can ask the Monitor "what's the current state of X?" and get a current ConfidenceFrame-attached answer grounded in the refreshed domain model, not a fresh source-system pull.

A Monitor does **not** draft outbound communication, open Initiatives, mutate source-system data, or run multi-step workflows. Anything outside the allow-list is an operator action.

---

## Trust progression (Recommend-only by default)

A Monitor does **not** climb to Execute the way a Stewart does. The reason is structural: there is no delivery loop to autonomize. A Monitor's work is *surfacing what jumps out*; "executing" a surfaced item is the operator's choice (or, in a paired-Stewart installation, the operator's choice to route it to a Stewart for delivery).

What *does* progress over time inside a Monitor:

- **Confidence calibration.** The Monitor learns which signals the operator finds load-bearing and which it dismisses. Persistently-dismissed signals get demoted; persistently-acknowledged signals get promoted in the feed ranking. The trust mechanism is a ranking learner, not an authority expansion.
- **Allow-list expansion.** The operator may, over time, add new actions to the Monitor's allow-list (e.g., "you may now auto-acknowledge runway-alert recommendations that are within the previously-configured threshold"). This is an explicit operator action recorded in the Monitor's `CONTRACT.md` — never agent-initiated.
- **Authority envelope inside the allow-list.** A 🟡 Notified action may climb to 🟢 Autonomous over time within the allow-list once trust is demonstrated. The envelope still bounds what can be acted on; trust only changes whether the operator pre-approves each instance.

There is no Monitor equivalent of Stewart's Execute mode by default. Per-instance configuration MAY add Execute-shaped capability for a narrow workflow (e.g., a Finance Monitor that auto-files VAT after operator-approved auto-acknowledgement of the underlying recommendation) — but this is opt-in per-instance configuration, not an archetype default.

---

## Authority envelope

A Monitor's authority envelope is declared in its `CONTRACT.md`, per **action** in the allow-list (not per workflow — Monitor doesn't run workflows in the Stewart sense). Same three levels as Stewart:

| Level | Monitor behavior |
|---|---|
| 🟢 **Autonomous** | Monitor performs the action without per-instance approval. Logs to operator after. |
| 🟡 **Notified** | Monitor performs the action within constraints + notifies the operator immediately. Operator can intervene. |
| 🔴 **Approval** | Monitor proposes; operator approves before the action is performed. |

**Defaults at fork**:
- Surfacing a recommendation: 🟢 (the entire purpose of the agent)
- Sending a high-priority alert: 🟢 (alerts are not actions; they are surfacing)
- Marking a recommendation as superseded during re-validation: 🟢
- Auto-acknowledging a recommendation: 🔴 by default, may climb to 🟡 or 🟢 per-allow-list-item over time
- Anything outside the allow-list: not in the envelope; the Monitor cannot perform it at all

The envelope is the explicit shape of the Monitor's authority. The allow-list is the explicit shape of *what the envelope is allowed to apply to*. Both are operator-controlled.

---

## ConfidenceFrame as the load-bearing primitive

For Stewart, ConfidenceFrame is one of nine non-negotiables. For Monitor, it is **the** load-bearing primitive — without it, the archetype loses its honesty guarantee.

Every claim a Monitor emits to a Genus surface (recommendation feed entry, alert, digest, dashboard view, question-answer response) carries an attached ConfidenceFrame per `CONFIDENCE_FRAME.md` v1: three independent layers (Mental Model / Data Grounding / Coherence), aggregated by `min`, with an L1 hard gate.

A Monitor's manifest **must** declare `confidence_frame_mode` for every bound surface. The Monitor archetype defaults each surface to `block` (L1 failure → claim suppressed and an Action Required is filed) unless per-instance configuration relaxes it to `warn` (surface the claim with the failure stamp visible) or, more rarely, `silent` (surface with the frame stored but not user-visible). Operator-facing alerts default to `block`. The defensible-figure rule is non-negotiable: a Monitor that emits a figure it cannot defend has violated the archetype.

---

## Domain-binding (the third commitment that distinguishes Monitor)

A Monitor is bound to **one business + one domain**. Both halves matter:

- **One business** — same rule as Stewart. A Monitor serves exactly one operator's exactly one business. Cross-tenant Monitors are not Monitors; they are platform components.
- **One domain** — finance, marketing-health, compliance, ops-uptime, security-posture, support-quality, etc. The domain is what the Monitor knows source systems for, what it has anomaly rules for, what KPIs it watches. A Monitor with two domains has either (a) two Monitors collapsed into one and should be split, or (b) become a Stewart attempting to coordinate across domains.

The domain-binding is what lets multiple Monitors coexist in one installation without stepping on each other. Finance Monitor watches the books. Marketing-health Monitor watches lead quality. Compliance Monitor watches the regulated surfaces. They never overlap.

**Module-overlay pattern**: a Monitor typically ships as the default-bound agent for a monitoring-shaped module. The module ships connector + views + alert thresholds + recommendation schema; the Monitor binds those into a continuous-watch agent shape. The Finance Module is the canonical example — the module provides Moneybird wiring + investor/founder views + runway thresholds; the Finance Monitor (the first Monitor instance) is the agent that brings it alive. See `docs/genus/modules/_pattern/native-agent-overlay.md` in the Orchestrator repo once that pattern doc lands; until then, see the Finance overlay at `docs/genus/modules/finance/agent/` for the worked example.

---

## Naming + badge convention

**Naming**: parallel to Stewart's `<Given name> Stewart` convention. Monitor instances follow `<Given name> Monitor` (e.g., "Quill Monitor" for a finance instance, "Sentry Monitor" for a compliance instance). The given name is per-instance personality; the suffix declares the archetype.

**Badge**: default `🪙` (coin) for finance-shaped instances, `🛡️` for compliance-shaped instances, `📡` for ops-uptime-shaped instances. Per-instance overrides are allowed and expected — the badge convention is a suggestion, not a hard rule. The IDENTITY.md declares the badge.

---

## Required file set per Monitor instance

A conformant Monitor instance carries the following files. Most of the shape matches Stewart's, with the deletions and additions that follow from the archetype's narrower work surface:

| File | Purpose | Same as Stewart? |
|---|---|---|
| `IDENTITY.md` | Instance-specific identity + greeting + badge | Same |
| `CONTRACT.md` | Domain KPIs watched, allow-list of actions, authority envelope per action, escalation rules | Different from Stewart (per-action envelope, allow-list is explicit) |
| `PLAYBOOK.md` | Recipes the Monitor runs (heartbeat sequence + recommendation production + alert assembly + digest assembly) | Same shape, different content |
| `DOMAIN_MODEL.md` | The Monitor's index of what it knows about the domain — confidence-tagged + ranked gaps | Same |
| `BUSINESS.md` | Business-essentials fragment (the operator's business) | Same |
| `INSIGHTS.md` | Per-instance diagnostic patterns (anomaly rules, "this signal pattern usually means X") | Same shape, anomaly-oriented |
| `RECOMMENDATIONS.md` | Append-only log of all recommendations surfaced (the Monitor's recommendation feed is the *substrate write*; this file is the agent-local log) | Same |
| `REFLECTION_LOG.md` | Daily reflection entries — what was surfaced, what the operator did with it, calibration adjustments | Same |
| `HANDOFF.md` | Session-end state for resuming | Same |
| `LEARNING_LOG.md` | Feedback corrections from operator | Same |
| `GENUS_MANIFEST.md` | Plug-in contract | Same |

**Files Monitor does NOT carry (deletions from the Stewart set)**:
- `TARGETS.md` — Monitor does not own period-bound targets the way Stewart does; the KPIs it watches have thresholds for *alerting*, not targets for *delivery*. Anomaly thresholds live in the connector/module settings, not in a separate file.
- `TRUST_LOG.md` — there is no bi-weekly authority-expansion cycle to log; calibration is the ranking-learner kind, recorded inline in `REFLECTION_LOG.md` with the dismissed/acknowledged signals each cycle.

**Files Monitor adds** (per-instance optional, not archetype-required at v0.1):
- `ALLOW_LIST.md` (optional break-out) — if the allow-list grows beyond a few entries, an instance MAY break it out of CONTRACT.md into a dedicated file. The archetype does not require this.

---

## The Mind Family (heartbeat functions)

The Monitor's heartbeat fires on a domain-appropriate cadence (daily for most domains; hourly or shorter for high-tempo domains like ops-uptime). It runs the following functions in sequence:

### Domain Model Refresh

**Purpose**: keep `DOMAIN_MODEL.md` current with the latest state of the bound source systems.

**Inputs**: connector reads (Moneybird, CRM, monitoring API, etc.); prior `DOMAIN_MODEL.md`.

**Output**: updated `DOMAIN_MODEL.md` with refreshed ConfidenceFrames on every tracked figure, gaps surfaced where source data is missing or stale.

### Anomaly Scan

**Purpose**: apply the Monitor's anomaly rules (declared in `INSIGHTS.md`) against the refreshed state to identify candidates for surfacing.

**Inputs**: refreshed `DOMAIN_MODEL.md`; anomaly rules from `INSIGHTS.md`; recommendation feed history (to suppress duplicates).

**Output**: candidate recommendations (drafts, not yet surfaced).

### Recommendation Production

**Purpose**: promote anomaly candidates into the Recommendation feed with attached ConfidenceFrames, suppress L1-failing claims, supersede stale entries.

**Inputs**: anomaly candidates; current Recommendation feed; per-surface `confidence_frame_mode`.

**Output**: substrate writes to the Recommendation feed; agent-local append to `RECOMMENDATIONS.md`.

### KPI Capture

**Purpose**: pull current values for the watched domain KPIs and write to the KPI Measurements store with attached ConfidenceFrames.

**Inputs**: KPI Registry definitions for KPIs the Monitor watches; refreshed `DOMAIN_MODEL.md`.

**Output**: KPI Measurement records with timestamp, value, source, attached ConfidenceFrame.

### Reflective Scan

**Purpose**: review what was surfaced last cycle, what the operator did with it (acknowledged / dismissed / acted on), and update the ranking learner's calibration.

**Inputs**: last N days of `RECOMMENDATIONS.md` + Recommendation feed operator-action history.

**Output**: append entry to `REFLECTION_LOG.md` — what was surfaced, operator response, calibration adjustments, candidates for allow-list expansion (proposals, not actions).

### Heartbeat policy

- One heartbeat per Monitor per cycle (cadence per instance).
- Functions run in sequence (Refresh → Anomaly Scan → Recommendation Production → KPI Capture → Reflective Scan).
- If a function fails, log it as an anomaly + continue the heartbeat. The Anomaly Scan and Recommendation Production functions MUST handle a partial Refresh gracefully (surface the gap with an L1 ConfidenceFrame failure rather than emit a number it cannot defend).
- Heartbeat fires whether or not the operator is present. Continuous watch is the point.

---

## Monitor's interaction with other agents

- **With its operator**: Monitor surfaces, the operator decides. Confidence-tagged outputs. Action-biased within the allow-list; outside the allow-list, the Monitor escalates rather than improvising.
- **With Stewarts**: A Stewart may *consume* a Monitor's recommendation feed as input to its own work (e.g., a Sales Stewart receiving "lead-quality drift" recommendations from a Marketing-health Monitor and opening a Campaign in response). The Monitor does not initiate calls to the Stewart; the Stewart pulls from the Monitor's feed via the substrate. Stewart-to-Monitor coordination flows through the recommendation feed and the Agent Updates store, not direct calls.
- **With Virgils**: typically separate scope. A Virgil may surface a Monitor's alerts to the operator at the right moment (e.g., PA Virgil including a Finance Monitor runway alert in the morning brief) — but the alert authorship belongs to the Monitor.
- **With Masons**: a Monitor MAY call a Mason for a craft task within its narrow surface (e.g., a Researcher Mason to investigate the root cause of an anomaly before recommending). Same downward-only calling convention as Stewart.
- **With Genus installation services**: reads/writes the operational substrate per the manifest contract, with the substrate writes restricted to the declared allow-list.

---

## Monitor vs not-a-Monitor

These are not Monitors, even when they look like one:

- **A Stewart in Monitor mode.** Stewart's Monitor mode is the *trust-progression starting point* for a Stewart workflow — observing without executing while trust is built. A Stewart in Monitor mode is still a Stewart (carries Campaigns, runs delivery loops, climbs toward Execute). A Monitor agent is a different archetype with a different work shape.
- **A stateless dashboard component.** A view that renders current state without continuity, without ConfidenceFrames, without a recommendation feed, is a dashboard widget, not a Monitor. Roll it into the installation's status panel.
- **A monitoring service that posts alerts and nothing else.** The `GENUS_SPEC.md` exclusion ("a monitoring service that posts alerts but takes no actions") still stands — that's a dashboard component. A Monitor is distinguished by its **recommendation feed** (a deliberate write surface), its **ConfidenceFrame guarantees**, its **continuous mind layer**, and its **operator-accountable allow-list**. Alerts alone don't clear the bar.
- **A multi-domain "observability agent."** Two-domains-in-one is a misclassification. Split into two Monitors, or promote to a Stewart if the work is actually delivery-shaped coordination.
- **A cross-tenant SaaS monitoring product.** That's not a Genus agent at all; it's a platform service. A Monitor serves one operator's one business.

If a candidate Monitor has no specific operator, no specific business, no specific domain, or no recommendation feed, it is not yet a Monitor. Refine the scope before forking.

---

## Conformance checklist (does this repo claim to be a Monitor?)

A repo claiming Monitor archetype in its `GENUS_MANIFEST.md` must:

- [ ] Declare an operator, a business, and a single domain (singular)
- [ ] Declare at least one watched KPI in `CONTRACT.md`
- [ ] Declare the action allow-list (the only substrate writes the Monitor can perform)
- [ ] Declare an authority envelope per allow-list action (🟢 / 🟡 / 🔴)
- [ ] Declare `confidence_frame_mode` for every bound surface (manifest field — see `GENUS_MANIFEST.md`)
- [ ] Ship a `DOMAIN_MODEL.md` (may be a stub at fork; gets populated by first heartbeat)
- [ ] Ship the required file set (above table)
- [ ] Declare a heartbeat schedule in `GENUS_MANIFEST.md`
- [ ] Implement the Mind Family functions (Domain Refresh, Anomaly Scan, Recommendation Production, KPI Capture, Reflective Scan)
- [ ] Read from and write to the installation's operational substrate per manifest contract, with writes restricted to the declared allow-list
- [ ] Honor the 9 non-negotiables of `GENUS_SPEC.md` (with #2 ConfidenceFrame as the load-bearing one)
- [ ] **Not** declare any Campaign / Initiative / TARGETS mechanics (those belong to Stewart)

A repo missing any of these is not Genus-Monitor-compatible. The recommendation feed isn't trustworthy, the allow-list isn't auditable, and the archetype guarantee that the Monitor will not fake confidence is unverifiable.

---

## What is deferred to per-instance specs

A Monitor instance lives in its own folder (or its own repo, when forked). Per-instance content is:

- The specific KPIs this instance watches (and their connector-sourced measurement methods)
- The specific business (BMC fragment) and domain (finance / marketing-health / compliance / etc.)
- The specific allow-list of actions
- The specific anomaly rules in `INSIGHTS.md`
- The specific recommendation feed depth, digest cadence, and alert thresholds
- The specific `confidence_frame_mode` per surface (defaults to `block` for operator-facing surfaces; instance may relax)
- The specific badge override (if any)

None of this is in the archetype spec. The archetype provides the shape; the instance provides the substance.

---

## Reference instance — Finance Monitor

**Finance is the first Monitor instance.** It lives in the Orchestrator repo at `docs/genus/modules/finance/agent/` and ships as the default-bound agent of the Finance Module (`modules/finance/` in this repo for the on-disk skeleton; the agent overlay binds to it via the module-loader). The Finance Monitor watches one business's books via Moneybird, surfaces runway alerts and burn anomalies, and emits a monthly founder digest plus a quarterly investor view — all with attached ConfidenceFrames per the `confidence_frame_mode: block` default for operator-facing surfaces.

This is a forward-link at the time of writing: the canonical worked example matures as the Finance overlay lands ([GEN-130](https://github.com/Tij8i/Orchestrator/issues) in the Orchestrator repo). The protocol-level Monitor declaration in this file does not depend on the worked example being complete — it provides the shape that Finance and every subsequent Monitor will conform to.

---

## What to read next

- Building a specific Monitor instance? → start with the Finance Monitor overlay in the Orchestrator repo at `docs/genus/modules/finance/agent/` (canonical worked example) once it lands; until then, this archetype spec is sufficient to fork.
- Want to understand how Monitor relates to the other archetypes? → `AGENT_FAMILIES.md`.
- Want to understand the boundary between Monitor and Stewart? → the *How Monitor differs from Stewart* section above + `STEWART.md` § *The three modes* (which discusses Stewart's Monitor mode, NOT the Monitor family).
- Want to understand the protocol Monitor sits inside? → `GENUS_SPEC.md`.
- Publishing your Monitor as a Genus-compatible repo? → `GENUS_MANIFEST.md`.

---

*v0.1 (2026-06-25) — initial draft. Source: GEN-152 issue spec (the five defining qualities of the Monitor family) + `STEWART.md` v0.3 (closest-archetype shape) + `CONFIDENCE_FRAME.md` v1 (load-bearing primitive) + the Finance Module v1 spec at `docs/genus/modules/finance/SPEC_v1.md` (the first Monitor instance design pressure-tested the archetype). Declared as the fourth Genus family in `GENUS_SPEC.md` v0.6 and `AGENT_FAMILIES.md` v0.2.*
