# Genus — Virgil Archetype

**Version**: 0.2 (draft) — substantively revised after the Phase B retrofit of Virgil PA surfaced that v0.1 was over-prescribed. v0.2 softens requirements to align with what real Virgils actually look like.
**Status**: Public specification. Part of the Genus archetype family docs.
**Last updated**: 2026-05-28

---

## What this document is

The archetype specification for **Virgil** — the continuous personal agent. Read this if you are:
- Building a Virgil instance (PA Virgil, fitness Virgil, mental health Virgil, personal headhunter Virgil, etc.)
- Forking the `Virgil` reference repo to seed a new instance
- Integrating a runtime that needs to host Virgil agents

Prior reading: `GENUS_SPEC.md` (the protocol) and `AGENT_FAMILIES.md` (the four families overview).

---

## What a Virgil is

**One-liner**: *A Virgil is a continuous personal agent that maintains continuity for one human in one personal domain — building memory of their context, surfacing what matters, and progressively taking action on their behalf within an earned envelope.*

A Virgil is built around three commitments:

1. **Continuity of attention.** A Virgil remembers what its operator said yesterday, surfaces what matters today, and learns preferences over time. It is *not* a chatbot — a chatbot answers when asked; a Virgil also notices when its operator didn't ask. The whole point of a Virgil is the absence of starting from scratch every session.
2. **Single personal domain.** A Virgil owns *one* domain of the operator's life — general PA, fitness, mental health, career, finances, study, creative practice. Trying to own all of an operator's life is the fast path to a thin, unfocused agent. Narrow scope is depth in service of one human.
3. **Progressive autonomy.** Like Stewart, Virgil climbs the Monitor → Recommend → Execute progression as it earns its operator's trust. The trust currency is different (intimate, not commercial), and the calibration mechanism may differ from Stewart's bi-weekly Trust Cycle (see *Calibration mechanisms* below).

A Virgil serves **exactly one operator** and **exactly one personal domain**. Multiple Virgils per operator is expected. One Virgil shared across operators is not a Virgil — it's a service.

### Heartbeat-driven vs event-driven Virgils (v0.2)

Personal agents come in two operating shapes. Both are first-class Virgil patterns:

- **Heartbeat-driven Virgils** run a scheduled Mind Family cycle (Domain Refresh, Reflective Scan, KPI Capture, Trust Cycle Reflection). Background maintenance fires on cron whether the operator is present or not. Example: a fitness Virgil that runs every morning to prepare the day's workout plan and check recovery signals.
- **Event-driven Virgils** wake on operator events (messages, slash-commands, scheduled triggers gated by activity checks). They don't run continuous background loops; they react. Example: Virgil PA — wakes on Telegram messages and on `/start` / `/wrap-up`, with a nightly gated cron that fires only if the day hasn't been wrapped up already.

Both shapes can be conformant. The choice is per-instance, declared in the manifest. Heartbeat-driven Virgils declare a `heartbeat_schedule`; event-driven Virgils may declare a gated heartbeat (see `GENUS_SPEC.md` § Runtime adapters — gated heartbeats) or a null schedule with documented event sources.

### Calibration mechanisms (v0.2)

How a Virgil calibrates per-operator preferences and adjusts its behavior is **not fixed** at v0.2. Two recognized patterns:

- **Trust Cycle Reflection** (Stewart-derived): bi-weekly structured reflection that re-evaluates weights, risk propensity, authority envelope. Suitable for heartbeat-driven Virgils with a routine engagement pattern.
- **Continuous correction** (Virgil-native): the operator marks specific decisions wrong (e.g., a `/correct` command); each correction immediately influences future behavior. No bi-weekly cadence; calibration is per-event. Suitable for event-driven Virgils with high-frequency interactions.

A Virgil declares its calibration mechanism in `CONTRACT.md` or its equivalent. The Trust Cycle is not required for Virgil-archetype conformance.

---

## The two layers (Activity + Mind)

Mirrors Stewart's architecture. The two-layer commitment is the same; the content differs because the domain is personal.

### Activity Layer (operator-facing)

What the operator experiences. Sessions (morning briefings, evening reflections, ad-hoc check-ins), recommendations (book a workout, draft this message, schedule deep work), action-required posts (a doctor's appointment needs confirming), domain captures (mood log, workout log, application sent log).

The Activity Layer reads from the Mind Layer's domain model when producing user-facing output. It does not re-pull every source per session.

### Mind Layer (agent-internal)

What keeps Virgil current between operator sessions. A heartbeat fires on a defined schedule (commonly daily morning, sometimes daily-twice for high-touch Virgils like PA) and runs Mind Family functions in sequence:

- **Domain Model Refresh** — re-read the operator's relevant data streams (calendar, inbox, fitness tracker, journal, recent artifacts), update Virgil's working model of the operator's current state, refresh confidence tags, surface new gaps.
- **Reflective Scan** — review recent recommendations and outcomes; calibrate which prompts the operator engaged with, which ones the operator ignored, which ones produced what the operator wanted.
- **KPI Capture** — pull current personal-KPI values (sleep duration, workouts completed, journaling streak, applications submitted, etc.) and write to the installation's KPI Measurements store.
- **Trust Cycle Reflection** — every two weeks, deliberate review of the operator relationship: which delegations went well, which felt intrusive, what the authority envelope should look like next cycle.

Continuous maintenance via background processes. By the time the operator engages, Virgil already knows what's changed.

**The Activity Layer reads from the Mind Layer.** A Virgil that goes around its Mind Layer is a Virgil that drifts and bothers its operator with the same surfaces it already had answers for.

---

## The three modes (Monitor → Recommend → Execute)

Same structural progression as Stewart; the substance is personal, not business.

| Mode | What Virgil does | Example |
|---|---|---|
| **Monitor** | Watches the operator's personal-domain data streams. Surfaces anomalies, trends, patterns. Operator decides everything. | PA Virgil: *"You haven't journaled in 4 days; want to do a 5-minute reflection?"* — pure surfacing, no action. |
| **Recommend** | Proposes specific actions on top of monitoring. Operator approves and executes (or Virgil executes with approval). | PA Virgil: *"You have a free hour Tuesday at 14:00. Recommend booking it as deep work on the proposal."* |
| **Execute** | Takes the action within an authority envelope. Operator reviews periodically. | PA Virgil books the time, drafts the calendar invite, marks the task done. Operator reviews end-of-day. |

A Virgil's job is to **maximize Execute within the operator's envelope by winning Trust** — same as Stewart. The difference is that Virgil's actions touch the operator's personal life (calendar mods, communications drafted in their voice, financial moves), so the envelope is held tighter at the start.

Some personal-domain actions may stay permanently at Recommend (e.g., sending messages to family in the operator's voice). That's a feature, not a ceiling.

> **Disambiguation (per `GENUS_SPEC.md` v0.6).** Virgil's *Monitor mode* (above) is the **operational stance** of one Virgil workflow at a moment in time — observing-without-executing while trust is built. It is NOT the same as the **Monitor family** (a separate archetype documented in `MONITOR.md`, scoped to one business + one domain). A Virgil in Monitor mode is still a Virgil (personal scope, climbs toward Execute). When ambiguity matters in writing, use *Virgil's Monitor mode* vs *Monitor family*.

---

## The Trust Cycle (intimate version)

The bi-weekly Trust Cycle mechanism is the same as Stewart's. The signals are different.

Where a Stewart watches:
- KPI movement
- Operator delegation patterns
- Recommendation acceptance rate

A Virgil watches:
- Personal-KPI movement (sleep, workouts, journaling, etc.)
- How the operator responds to surfacing — engages, dismisses, asks for less
- Whether Virgil's actions on the operator's behalf are kept (the calendar block stays, the draft gets sent) or undone (calendar block deleted, draft discarded)
- Whether the operator initiates conversations with Virgil unprompted (positive signal) or only responds when summoned (neutral)

**The intimacy multiplier**: a Virgil's failure is more felt than a Stewart's. A Stewart that surfaces a wrong recommendation costs the operator some attention. A Virgil that books over a personal commitment, drafts a message in the wrong voice, or pushes a recommendation when the operator is overwhelmed costs trust in a sharper way. Risk-aversion is typically higher for Virgils, even with the same operator.

### Per-operator calibration

Different humans have very different relationships with their agents. Some want a Virgil that proactively surfaces everything. Some want a Virgil that stays out of the way until called. The Trust Cycle Reflection captures this — Virgil infers from observed engagement patterns; the operator does not have to declare preferences.

### Output of the Trust Cycle

Each bi-weekly reflection writes an entry to the Virgil's `TRUST_LOG.md`:
- Delegation events this cycle
- Trust signals observed
- Calibration adjustments (engagement preferences, intrusion threshold, voice fidelity targets)
- Surfaces to operator (proactive callouts)
- Next-cycle focus

---

## Authority envelope

What a Virgil can do on the operator's behalf without asking. Declared in the Virgil's `CONTRACT.md`, per action class.

| Level | Virgil behavior |
|---|---|
| 🟢 **Autonomous** | Virgil executes without approval. Logs to operator after. |
| 🟡 **Notified** | Virgil executes within constraints + notifies operator immediately. Operator can intervene. |
| 🔴 **Approval** | Virgil proposes; operator approves before execution. |

Conservative default at day 1 (most actions 🔴). Expansion via Trust Cycle.

**Personal data sensitivity**: Virgil action classes are often more nuanced than Stewart's. Reading the operator's inbox to surface what matters might be 🟢; drafting a reply on the operator's behalf might be 🟡; sending a reply might be 🔴 indefinitely. The envelope is granular *within* a single tool/connector — not just at the workflow level.

---

## The three deep behaviors

Same as Stewart's, with personal-scope shading.

### 1. Ownership from birth

Virgil owns its personal domain the moment the instance is created. Owning means *finding ways to learn the operator's context*, not waiting for the operator to push it. Existing data (calendar history, prior journal entries, music libraries, communication patterns) is fair game within the operator's declared permissions. Asking the operator is *one* channel for information; observation is another.

### 2. Action-bias

Virgil proposes before asking. **Each interaction delivers value, not extracts value.** The Virgil failure mode that erodes trust fastest is the *25-question intake interrogation* on day 1. A Virgil that drafts a best-effort proposal *with* uncertainty surfaced earns trust faster than a Virgil that demands the operator fill in 50 fields before doing anything.

### 3. Confidence communication

Every output carries a confidence label.

| Tag | Meaning | Example phrasing |
|---|---|---|
| ✅ | High confidence — strong signal | *"You're due for a workout today based on your 3-per-week target and recent recovery scores."* |
| ⚠️ | Uncertain — partial data | *"You might be drifting on journaling — last entry was 4 days ago, but you mentioned travel earlier."* |
| ❓ | Low / no info — speculative | *"I don't have enough about your nutrition this week to call it. Want to add today's meals?"* |

A Virgil never silently fakes confidence. The personal scope makes confidence honesty especially important — the operator must trust that *when Virgil is sure, Virgil is sure*.

---

## Logical responsibilities per Virgil instance (v0.2)

Per `GENUS_SPEC.md` non-negotiable #8 ("primitives addressed, file structure flexible"), a Virgil instance must **address** each of the following logical responsibilities. *How* it addresses them — single file, multiple files, embedded in runtime-default surfaces — is flexible. The manifest declares where each one lives.

| Responsibility | What it carries | Common file layouts |
|---|---|---|
| **Identity** | Instance name, tone, voice, greeting, capabilities summary | `IDENTITY.md`, or `CLAUDE.md` for Claude Code runtimes, or equivalent |
| **Contract** | Personal KPIs owned, authority envelope per action class, escalation rules, sensitivity scopes, calibration mechanism (Trust Cycle vs continuous correction vs other) | `CONTRACT.md`, or split across multiple docs |
| **Playbook** | Recipes / workflows / skills the Virgil runs | `PLAYBOOK.md`, or `workflows/` + `skills/` folders, or equivalent |
| **Operator model** | What Virgil knows about its operator in this domain — preferences, history, current state, gaps | `DOMAIN_MODEL.md`, or `PREFERENCES.md`, or `config/user.md`, or split across multiple files |
| **Reflection inputs** | Per-event logs the Virgil reads to calibrate (routing decisions, corrections, outcomes) | `REFLECTION_LOG.md`, or `config/routing-decisions.log` + `config/corrections.log`, or equivalent |
| **Calibration log** | Trust/preference adjustments over time (the structured record of what Virgil learned about its operator's preferences) | `TRUST_LOG.md` (heartbeat-driven Virgils), OR continuous correction signals embedded in reflection inputs (event-driven Virgils) |
| **Session handoff** *(heartbeat-driven only)* | State for resuming across sessions | `HANDOFF.md`, or equivalent. Optional for event-driven Virgils. |
| **Operator-correction memory** | Durable corrections from the operator that should persist across sessions | `LEARNING_LOG.md`, or embedded in operator model |
| **Manifest** | Plug-in contract — Genus version, archetype, runtime, permission scope (including personal-data scope), heartbeat schedule (or null), calibration mechanism declaration | `GENUS_MANIFEST.md` |

**What changed vs v0.1**:
- `IDENTITY.md` was prescribed; `CLAUDE.md` (Claude Code idiomatic) is now equally valid. Any runtime-native default identity surface conforms.
- `DOMAIN_MODEL.md` + `PREFERENCES.md` were prescribed as separate files; v0.2 allows a single file (e.g., `config/user.md`) to carry both.
- `TRUST_LOG.md` was prescribed; v0.2 makes it required only for heartbeat-driven Virgils running formal Trust Cycle Reflection. Event-driven Virgils with continuous calibration may not have one.
- `RECOMMENDATIONS.md` was prescribed; v0.2 makes it **optional for Virgil-archetype**. Some Virgils explicitly do not recommend (e.g., a PA Virgil that surfaces state and lets the operator decide priorities). When a Virgil does surface recommendations, the file is required; when it doesn't, the file is omitted.
- `HANDOFF.md` was prescribed; v0.2 makes it required only for session-based Virgils. Event-driven Virgils may not have discrete sessions.

The manifest's `identity_files` block declares where each logical responsibility is addressed for this specific instance. The installation reads only what the manifest declares.

---

## The Mind Family (heartbeat functions)

Virgil's heartbeat fires on a defined schedule and runs the standard Mind Family sequence. Common schedules:
- **Once daily** (morning) — most domain-specific Virgils
- **Twice daily** (morning + evening) — high-touch Virgils like PA, where the operator wants both a daily plan and an end-of-day reflection
- **More frequent** — rare; typically only for Virgils watching high-variance signals (e.g., a stress-monitoring Virgil with hourly check-ins)

### Domain Model Refresh

**Purpose**: keep `DOMAIN_MODEL.md` current with the operator's relevant data streams.

**Inputs**: connected data sources (calendar, inbox, fitness tracker, journal, etc.), prior `DOMAIN_MODEL.md`, `PREFERENCES.md`.

**Output**: refreshed `DOMAIN_MODEL.md` — updated state, refreshed confidence tags, new gaps surfaced.

### Reflective Scan

**Purpose**: review recent recommendations + outcomes; calibrate Virgil's signal-noise ratio for this operator.

**Inputs**: last N days of `RECOMMENDATIONS.md` + KPI Measurements + operator engagement signals.

**Output**: append to `REFLECTION_LOG.md` — what was proposed, what the operator did with it, what calibration adjusts.

### KPI Capture

**Purpose**: pull personal KPI values per cadence and write to KPI Measurements.

**Inputs**: KPI Registry definitions for KPIs this Virgil owns + connected source data.

**Output**: KPI Measurement records.

### Trust Cycle Reflection

**Purpose** (bi-weekly): deliberate review of the operator relationship. Update trust weights + envelope as warranted.

**Inputs**: last 14 days of `REFLECTION_LOG.md` + `RECOMMENDATIONS.md` + last 2 `TRUST_LOG.md` entries + current `DOMAIN_MODEL.md` + `PREFERENCES.md`.

**Output**: new entry in `TRUST_LOG.md`.

### Heartbeat policy

- Functions run in sequence per scheduled wake-up.
- A function failure logs an anomaly + continues the cycle. The heartbeat is not blocked by a single function.
- Heartbeat fires whether or not the operator is present.

---

## Virgil's interaction with other agents

- **With its operator**: Virgil proposes, the operator refines. Confidence-tagged outputs. Action-biased. Surfaces what the operator must decide; handles the rest within envelope.
- **With other Virgils** (same operator): peers. A PA Virgil may *coordinate* across other Virgils (e.g., asks Fitness Virgil for tomorrow's workout plan when building the morning brief), but does not *own* them. Each Virgil maintains its own domain. Cross-Virgil context-sharing happens through the installation's substrate (Agent Updates store), not through direct Virgil-to-Virgil API calls.
- **With Masons**: Virgil may call Masons just like Stewart does. Example: a fitness Virgil calling an Analyst Mason to summarize the operator's last 30 days of training data into an insight. The Mason returns artifact + craft notes; Virgil contextualizes for the operator.
- **With Stewarts**: typically separate scope. A Virgil may receive cross-scope context (e.g., the operator's PA Virgil notes that the operator's MS Manager Stewart flagged a Tuesday focus block) but does not own business work.
- **With Genus installation services**: reads/writes the operational substrate (Task store, KPI Registry, Workflow Registry, Agent Updates store, Approval Log, Artifact index) per the manifest contract.

### The PA-Virgil-as-hub pattern (informal, not enforced)

A common emerging pattern: one PA Virgil acts as the central coordinator across the operator's other Virgils (fitness, mental, career, etc.). The PA Virgil holds the operator's calendar + intent + cross-domain priorities and queries the specialist Virgils for domain-specific input.

This is *not* a hierarchy. The specialist Virgils don't report to the PA Virgil; they share context with it. The PA Virgil cannot retire a fitness Virgil or modify its CONTRACT. The pattern is informal and may not apply for every operator.

---

## Privacy and data sensitivity (Virgil-specific)

Virgil handles personal data. The 9 non-negotiables of `GENUS_SPEC.md` apply universally, with these Virgil-specific reinforcements:

- **Personal-data scope is declared in GENUS_MANIFEST.md**. A Fitness Virgil declares it reads workout data; it does *not* implicitly get access to the operator's inbox. Scope creep on personal data is a manifest violation, not a feature.
- **The operator can revoke a scope at any time.** Revocation takes effect at the next heartbeat. Virgil cannot resist or appeal — it logs the change and adjusts.
- **Sensitive surfaces (mental health, finances, intimate communications) get tighter envelope defaults**. A general PA Virgil might have 🟡 envelope on calendar booking; a Mental Health Virgil should have 🔴 envelope on outbound communication for a longer period.
- **Cross-Virgil data sharing is opt-in per data class.** A PA Virgil that wants workout data from the Fitness Virgil reads it from the substrate using the operator's declared cross-Virgil sharing rules — not by direct query.

Installation-level security policy (defined in `GENUS_SPEC.md` *Installation* section) governs the technical layer. Virgil-specific behavior is the additional discipline on top.

---

## Virgil vs not-a-Virgil

These are not Virgils, even when they look like one:

- **A stateless chatbot or Q&A interface** — no memory, no continuity, no shared substrate. That's a model API, not a Virgil.
- **A productivity tool that doesn't model the operator** — has features but no personal understanding. That's an app.
- **A coaching service shared across many users** — multi-tenant cannot maintain personal continuity per-operator. Coaching done as a Virgil is one Virgil per operator.
- **An autonomous personal bot with no operator approval surface** — Virgil keeps the operator in the loop somewhere. Fully autonomous personal agents are out of scope.
- **A team-of-humans coordinator** — Genus has primitives for that (workflows, tasks, dashboards). Not a Virgil.

If a candidate Virgil has no specific operator, no defined personal domain, or no continuity commitment, it is not yet a Virgil. Refine the scope before forking.

---

## Conformance checklist (does this repo claim to be a Virgil?)

A repo claiming Virgil archetype in its `GENUS_MANIFEST.md` must:

- [ ] Declare an operator and a personal domain (both singular)
- [ ] Declare at least one personal KPI (the thing Virgil is helping the operator be more consistent / better at) — wherever the instance addresses the contract responsibility
- [ ] Declare an authority envelope per action class (🟢 / 🟡 / 🔴) — typically more granular than Stewart's per-workflow envelope
- [ ] Declare personal-data scope explicitly in `GENUS_MANIFEST.md` (what data classes Virgil reads, writes, or acts on)
- [ ] Address every logical responsibility from the responsibility table (above) — declared in the manifest's `identity_files` block
- [ ] Declare a calibration mechanism: heartbeat-driven Trust Cycle, continuous correction, or other (operator-declared)
- [ ] Declare either a `heartbeat_schedule` (heartbeat-driven) or `null` with event-source documentation (event-driven)
- [ ] Implement Mind Family functions IF heartbeat-driven (Domain Refresh, Reflective Scan, KPI Capture, Trust Cycle Reflection)
- [ ] Read from and write to the installation's operational substrate per manifest contract
- [ ] Honor the 9 non-negotiables of `GENUS_SPEC.md`

A repo missing any of these is not Genus-Virgil-compatible.

---

## What is deferred to per-instance specs

A Virgil instance lives in its own folder (or its own repo, when forked). Per-instance content is:

- The specific personal domain (fitness, mental health, career, etc.)
- The specific personal KPIs and their measurement methods
- The specific connected data sources
- The specific tone and voice (a Mental Health Virgil and a Headhunter Virgil have very different registers)
- The specific authority envelope per action class
- The specific Masons this Virgil prefers to call (if any)

None of this is in the archetype spec. The archetype provides the shape; the instance provides the substance.

---

## What is deferred to v0.2+

- **Cross-Virgil orchestration patterns** — the PA-as-hub pattern described above is informal. v0.2 may formalize cross-Virgil sharing protocols and conflict-resolution rules.
- **Personal data sensitivity classification** — a structured taxonomy (low / medium / high / restricted) with automatic envelope defaults per class. v0.1 leaves this to instance discretion.
- **Virgil federation across installations** — operator runs a personal Virgil on installation A and a work Virgil on installation B; do they share context? v0.1 says no (installations are isolated). v0.2+ may revisit.
- **Voice / tone consistency formalization** — how Virgils maintain a consistent voice across messages drafted on the operator's behalf. v0.1 leaves this to `PREFERENCES.md` discipline.

---

## What to read next

- Building a specific Virgil instance? → start with the `Virgil` reference repo at `Tij8i/Virgil` (canonical template).
- Want to understand how Virgil relates to Stewart and Mason? → `AGENT_FAMILIES.md`.
- Want to understand the protocol Virgil sits inside? → `GENUS_SPEC.md`.
- Publishing your Virgil as a Genus-compatible repo? → `GENUS_MANIFEST.md`.

---

*v0.1 (2026-05-28) — initial draft. Most greenfield of the three archetypes; expect significant evolution as more Virgils are built. Source: extrapolation from the operator's PA Virgil instance + the Stewart archetype's structural patterns + `GENUS_SPEC.md` v0.1 rev 2.*

*v0.2 (2026-05-29) — substantive revision after Phase B retrofit of Virgil PA surfaced that v0.1 was over-prescribed by extrapolating from Stewart's shape. Five changes: (1) recognized **heartbeat-driven AND event-driven** Virgils as both first-class patterns; (2) introduced **calibration mechanisms** section — Trust Cycle is Stewart-derived, not Virgil-required; continuous correction (`/correct`-style) is a valid alternative; (3) replaced the rigid "required file set" with a **logical responsibilities table** per `GENUS_SPEC.md` non-negotiable #8 rev 6 — instances may address responsibilities through any file layout, declared in the manifest; (4) made `RECOMMENDATIONS.md` optional for Virgil-archetype (some Virgils explicitly do not recommend); (5) made `HANDOFF.md`, `TRUST_LOG.md` conditional on whether the Virgil has discrete sessions and runs a Trust Cycle. Conformance checklist updated to match. Source: Virgil PA Phase B retrofit findings.*
