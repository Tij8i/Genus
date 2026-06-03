# Genus — Specification

**Version**: 0.3 (draft)
**Status**: Public specification.
**Last updated**: 2026-05-29 (v0.3 draft — adds Campaign as 13th primitive per Pattern #12 reflection)

---

## What Genus is

Genus is a non-technical **Agent Operating Model**. It is a protocol — a small set of conventions and primitives — that lets a non-technical user define what AI agents should do, how they should be governed, and how their work connects to goals, KPIs, workflows, and tasks.

Genus serves **two intertwined purposes**:

**1. A protocol of communication** between agents and humans, and between agents themselves. The 13 primitives are the shared vocabulary. The operational substrate (see *Operational substrate* below) is the shared medium. When a Stewart says *"task complete"*, every other agent and every dashboard in the installation understands what that means at the protocol level — because they all read and write to the same Task store, with the same task lifecycle, against the same completion conditions. Genus is what turns a collection of agents into a coherent operation.

**2. A learning system.** The protocol exists so the system can progressively reduce human-in-the-loop reliance. Every Genus installation maintains feedback loops — operator corrections, comparison protocols on Mason output, hypothesis-driven workflow improvement, trust calibration on Stewart authority — that aggregate into installation-level learning about the operator, their goals, and their preferences. The North Star: an installation that needs less of its operator's attention over time without losing fidelity to the operator's intent.

Genus sits **above** technical agent frameworks (n8n, LangGraph, CrewAI, OpenAI Agents SDK, Make, Zapier, custom Python). It does not replace them. It gives them a shared business-facing vocabulary, a shared accountability model, and a shared way to be composed.

**One-liner**: *Genus turns business intent into governed, learning agentic execution.*

Genus is open-source and free. Its commercial complement, Sensible Flow, is the first implementation agency built on top of Genus — but Genus itself is independent and forkable.

## What Genus is NOT

Genus is **not**:
- An agent framework (it does not execute agents; runtimes do that)
- A workflow automation tool (it does not run workflows; runtimes do that)
- A chatbot builder
- An LLM
- An autonomous agent platform

Genus is the **layer above** all of these. It is to agent runtimes what an operating model is to a business: a way of organizing the work, not a way of doing it.

---

## The stack

```
Business intent (goals, KPIs, workflows, tasks, constraints, approvals)
                            ↓
       Genus — non-technical agent operating layer
                            ↓
Technical runtime (n8n, LangGraph, CrewAI, OpenAI SDK, Claude Code, custom code)
                            ↓
       Execution (agents, tools, automations, dashboards, artifacts)
```

A user begins with the work. Genus structures it. The runtime executes it.

---

## The 13 primitives

Every Genus deployment is built from thirteen primitives. They are deliberately small in number, deliberately business-centric in language, and deliberately runtime-neutral.

### 1. Goal

What the agent system is trying to achieve, stated as a desired outcome.

Goals are written in plain language. They are owned by humans. They are the reason the agents exist at all. *Example: "Grow qualified inbound leads from our website to 50 per month by Q3."*

### 2. KPI

How success is measured. A quantitative function attached to a Goal.

Every Goal has at least one Primary KPI. A KPI has a name, a unit, a measurement method, and a target. *Example: "Qualified inbound leads per month, measured from CRM, target 50."*

### 3. Workflow

The process through which work moves from intent to artifact. A named sequence of steps.

Workflows are the level at which Genus tracks repeatable work. Each workflow has a primary KPI it influences, a set of levers (degrees of freedom), and a current hypothesis about which levers move the KPI. *Example: "Inbound lead capture → qualification → handoff to sales."*

### 4. Campaign

A **finite delivery inside a permanent Stream**. The unit at which Genus distinguishes ongoing stewardship from shippable work.

A Stewart owns a continuous Stream (one business unit) and runs Campaigns inside it. A Campaign has a name, a one-sentence **success criterion**, a **status** (Not started / Active / Dormant / Paused / Completed / Discarded), a target close date, a priority score, and bound Tasks. When the success criterion is met, the Campaign Completes and its Outcome Artifacts are referenceable from outside the agent's memory. *Example: "Ship the Q3 paid-acquisition test (success: ≥30 qualified leads/month at CAC ≤ $80 by 2026-09-30)."*

Campaigns are what let an installation answer the question *"what is this agent currently trying to ship?"* — not just *"what is it generally doing?"* They are also what let an operator detect scope creep: a Campaign exists with a declared scope; the work done either fits the scope or doesn't. Without Campaigns, every Stream collapses into infinite ongoing stewardship, and the system cannot distinguish progress from drift.

**Hard discipline (per `STEWART.md`)**: a Stewart caps Active Campaigns at **1–3 per Stream**. New Campaigns don't open while existing Active ones have un-shipped tasks. Active Campaigns idle for >14 days auto-flag as **Dormant** — an operator decision (resume / pause / discard) is required.

Campaigns are NOT Workflows. A Workflow is a repeatable process; a Campaign is a one-time finite delivery that may use one or more Workflows + ad-hoc tasks to ship.

### 5. Task

A discrete executable unit. The smallest grain of work tracked by Genus.

Tasks are the atomic operating currency. They have a clear outcome, an owner agent, a status, and an artifact. Tasks belong to a **Campaign** (the finite delivery they contribute to) and reference the **Workflow** (the repeatable process they execute, when applicable). *Example: "Qualify the 12 leads received this morning."*

### 6. Agent Family

The archetype of an agent. There are exactly three: **Virgil**, **Stewart**, **Mason**.

The Family discriminates an agent's *cadence* (continuous vs called) and *scope* (business vs personal vs craft). See "Archetype taxonomy" below.

### 7. Constraint

What the system is **not** allowed to do.

Constraints live alongside Goals. They are how non-negotiables enter the operating model — risk tolerances, regulatory requirements, brand boundaries, never-do rules. Constraints bind every agent operating within their scope. *Example: "Never send outbound email from a domain we don't own."*

### 8. Approval Gate

A point in a workflow where human judgment is required before execution proceeds.

Approval Gates are how Genus keeps a human in the loop without forcing humans to be in every loop. They are declared at design time, not improvised. Gates have a scope (the actions they cover), an approver (a human role), and an escalation path. *Example: "Any outbound message to a Tier-1 prospect requires operator approval."*

### 9. Artifact

The output produced by a task or workflow. The thing that exists in the world after the work is done.

Artifacts are referenceable: file path, URL, document ID, commit SHA, CRM record, etc. A task is not done until its artifact exists and is referenceable. A Campaign Completes when its declared success criterion has been met and its Outcome Artifacts are populated. *Example: "PDF proposal saved to /clients/acme/proposal-v1.pdf."*

### 10. Runtime

The technical system that executes the work — n8n, LangGraph, CrewAI, OpenAI Agents SDK, Claude Code, custom code, etc.

Genus is runtime-neutral. A single Genus deployment can use multiple runtimes simultaneously (one workflow on n8n, another on Claude Code). Runtime selection is an implementation choice, not a Genus-level decision.

### 11. Dashboard

The human-facing control and monitoring surface. Where operators see what their agents are doing, what state things are in, and where attention is needed.

Dashboards are how Genus turns continuous agent activity into intermittent human supervision. Every Genus deployment has at least one Dashboard view per Stewart-family agent and one portfolio view across them. Dashboards surface the Campaign portfolio (Active / Not started / Dormant rollup) so operators can see at-a-glance what is being shipped, what is stalled, and what is waiting for promotion.

### 12. Memory

The structured record of decisions, outputs, context, and learning that an agent maintains over time.

Memory is what makes a continuous-cadence agent better than a stateless prompt. Stewart and Virgil maintain rich memory (domain models, KPI capture logs, reflection logs, handoffs). Mason maintains a craft log only — focused on technique, not context. Memory is auditable.

### 13. Permission

What tools, data, and actions an agent is allowed to access.

Permissions are declared per agent and per workflow. Expanding an agent's permission scope is an explicit operator action — agents never grant themselves new permissions. *Example: "Designer Mason has access to Canva, no email, no CRM."*

---

## Archetype taxonomy

Three agent families, discriminated on two axes — **cadence** (continuous vs called) and **scope** (business vs personal vs craft):

| | Continuous cadence (heartbeat-bearing) | Per-invocation cadence (called as needed) |
|---|---|---|
| **Business scope** | **Stewart** | — |
| **Personal scope** | **Virgil** | — |
| **Craft scope** | — | **Mason** |

### Stewart — business-unit owner

Continuous cadence. Owns the KPIs of one business unit. Operates in three modes (Monitor / Recommend / Execute), climbing toward Execute as it earns operator trust. Has a heartbeat (daily background maintenance cycle), a domain model, a contract with its operator, and an authority envelope. Coordinates work across workflows. Delegates execution to Masons when craft specialists are appropriate.

*See `STEWART.md` for the archetype spec.*

### Virgil — personal agent

Continuous cadence. Operates in personal scope — companion, planner, coach, PA. Maintains continuity for the individual user. Helps clarify intent and translate it into operating priorities. Multiple Virgils are expected (fitness, mental, headhunter, etc.). Each Virgil is independent.

*See `VIRGIL.md` for the archetype spec.*

### Mason — craft specialist

Per-invocation cadence with **no clock of its own**. Mason is never invoked at will — it is called as part of the calling Stewart's flow, which has its own rhythm (heartbeat, scheduled workflow, or operator-triggered task). When called, Mason executes within structured context provided by the Stewart; produces an artifact; returns craft notes; goes idle. No heartbeat. No continuous mind layer.

The contractor analogy sharpens: contractor has no payroll *and* no schedule of its own. They show up when the project plan says they should, do the work, and leave.

*See `MASON.md` for the archetype spec.*

### Hard rules of the taxonomy

- A persistent business agent **is** a Stewart by definition.
- A persistent personal agent **is** a Virgil by definition.
- A per-invocation craft agent **is** a Mason by definition.
- Mason does NOT get a heartbeat or continuous mind layer. That re-introduces the Stewart shape and erodes the boundary.
- Mason does NOT have a clock of its own. Cadence is inherited from the calling Stewart's flow.
- Anything that doesn't fit one of the three needs explicit justification — not a fourth box.

---

## Non-negotiables

The conventions that make an agent Genus-compatible. These are checked by the plug-in contract (see below).

1. **Identity transparency.** Every agent declares its archetype, capabilities, constraints, and operator in a human-readable identity file. No black-box agents.
2. **Confidence honesty.** Every output carries a confidence tag where uncertainty exists (✅ high, ⚠️ partial, ❓ speculative). Silent fakery erodes trust faster than any failure mode.
3. **Approval gates.** Every action with irreversible or external impact passes through a declared Approval Gate. Agents never act outside their authority envelope without explicit approval.
4. **Memory persistence.** Continuous-cadence agents (Stewart, Virgil) maintain auditable memory between sessions. State is not held in conversation context alone.
5. **Permission boundary.** Every agent operates within a declared permission scope. Expanding scope requires explicit operator action — never agent-initiated.
6. **Heartbeat (Stewart only).** Continuous business agents run a daily background maintenance cycle that refreshes their domain model, reflects on outcomes, and surfaces anomalies — independent of operator presence.
7. **Comparison protocol (Mason only).** Every Mason declares a quality dimension and a baseline (default: simple model call with the same brief). Masons that fail to outperform baseline get deprecated.
8. **Primitives addressed, file structure flexible.** Every conformant agent addresses the same primitives — identity, contract, workflows/skills, memory, manifest. The *file layout* through which these primitives are addressed may vary per archetype and per runtime convention. A Stewart may use a top-level `IDENTITY.md`; a Virgil hosted on Claude Code may use `CLAUDE.md` for the same purpose; both are conformant if the primitives are visible to the installation through the manifest. **Document architecture alignment is recommended for consistency but not required for conformance.** What is required is that the primitives are addressed and that the manifest declares where each one lives — so the Genus app can map and manage them. The necessary-and-sufficient test: can the installation discover and operate against every primitive via the manifest? If yes, the agent conforms.
9. **Universal primitives, configurable definitions.** The 12 primitives, the 3 archetypes, the 7 prior non-negotiables, and the manifest contract are universal across all installations. The *specific definitions* — which KPIs an installation tracks, which thresholds, which workflow shapes, which constraints, which approval gates — are configurable per installation. The protocol layer is immutable; the operating culture is shaped by the operator.

A repo that does not honor these conventions is not Genus-compatible.

---

## The plug-in contract (manifest)

Every Genus-compatible agent repo ships with a `GENUS_MANIFEST.md` declaring:

- **Genus protocol version** it conforms to (e.g., 0.1)
- **Archetype claim** (Virgil / Stewart / Mason)
- **Identity files** (paths to IDENTITY, CONTRACT, PLAYBOOK or equivalent)
- **Runtime requirements** (which technical runtime — Claude Code, n8n, custom, etc.)
- **Tool / MCP requirements** (external integrations needed)
- **Permission scope** (declared, not assumed)
- **Heartbeat schedule** (Stewart only)
- **Comparison protocol** (Mason only — quality dimension + baseline + measurement method)
- **Composability flags** (does this agent operate standalone? what other agents does it expect?)

The full schema lives in `GENUS_MANIFEST.md`. The contract above is the shape; the schema is the field-by-field definition.

A non-conformant manifest means the agent does not participate in Genus governance — Dashboards don't see it, Approval Gates can't be enforced on it, Memory isn't auditable. There is no enforcement engine that prevents non-conformance; conformance is the price of admission to the ecosystem.

---

## Operational substrate

The 12 primitives are concepts. An installation makes them real by providing **shared canonical stores** that every conformant agent reads from and writes to. Without these stores, the primitives are unenforceable and the dashboards are blind.

A Genus installation provides (at minimum):

| Store | Holds | Primary primitive | Written by | Read by |
|---|---|---|---|---|
| **Task store** | All open and closed tasks across the installation | Task | Any agent | Any agent + Dashboard |
| **Campaign store** | All Campaigns across the installation (Not started / Active / Dormant / Paused / Completed / Discarded), per owner Stewart | Campaign | Stewart (Active set + Completed); Operator (Not started intake + L1 promotion + Discarded) | Any agent + Dashboard |
| **KPI Registry** | KPI definitions, units, measurement methods, owners | KPI | Stewart (definition); any agent (measurement) | Any agent + Dashboard |
| **Workflow Registry** | Workflow definitions, primary KPI, levers, active hypothesis | Workflow | Stewart | Any agent |
| **Agent Updates store** | Cross-agent communication: session updates, recommendations, action-required posts, "Campaign Shipped" events | (cross-cutting) | Any agent | Operator + other agents |
| **Approval Log** | Approval gate triggers, decisions, rationales | Approval Gate | Operator (decisions) + agents (triggers) | Any agent |
| **Artifact index** | Pointers to artifacts produced by any task, workflow, or Campaign closure | Artifact | Any agent | Any agent + Dashboard |

These stores are what make Genus an operating system, not just a manifesto. They are how an agent learns what other agents are doing without being told. They are how a dashboard shows installation state without polling agents. They are how an operator queries *"what's open this week"* without scripting per-agent.

A conformant agent **must** read and write to these stores using the Genus-defined schemas (defined in v0.2). Holding state only in agent-internal files breaks installation-level visibility and disqualifies the agent from Genus governance.

**Implementation freedom**: the storage layer is implementation-neutral. v0.1 reference installations use Notion + GitHub. Future installations may use Airtable, Postgres, custom databases, or a Genus-native store. What matters is that the schema is honored and the read/write contract is preserved.

---

## Genus installation

A Genus *installation* is a deployment of the protocol for one operator (or one organization). An installation contains:

1. **Operational substrate** — the canonical stores above.
2. **Connector pool** — MCP connectors, API credentials, tool integrations. Connectors are configured *once per installation* and shared across all conformant agents that declare a permission for them. Set up Canva MCP once at the installation level; any agent with `canva` in its permission scope can use it without re-configuration.
3. **Agent registry** — the set of conformant agents installed (Virgil instances + Stewart instances + Mason inventory). Manifest of each agent's archetype, version, identity files, and current status.
4. **Dashboard surface** — the human-facing views: per-Stewart KPI panels, portfolio-level rollups, task queues, approval inbox, anomaly alerts.
5. **Status panel** — operational health: which connectors are up, which heartbeats fired today, which agents are degraded, which approvals are pending.
6. **Installation-level configuration** — the moldable defaults referenced in non-negotiable #9: KPI definitions, thresholds, approval gate scopes, constraint declarations, workflow shapes.

The **Genus app** (Phase D, future) is the operator-facing **package manager + control panel** for an installation. Through the app, a non-technical operator can install the Genus substrate in their chosen location, install Virgil / Stewart / Mason agents from public repos, configure connectors, grant permissions, approve actions, view dashboards, and monitor status — all without git knowledge.

**The app is the easy path, not the only path.** Technical users can clone repos directly, edit manifests by hand, configure substrate stores manually, and point a runtime at them. The protocol works without the app; the app makes the protocol usable for non-technical operators. The relationship parallels **npm** (the registry / protocol) and `npm install` (the user tool), or **PyPI** and **pip** — the underlying ecosystem is open and usable raw; the tool is the user-friendly interface that the majority will use.

Until the app exists, an installation is operated through the underlying stores and a CLI.

**One installation, multiple runtimes.** An installation can have agents running on Claude Code, on n8n, on LangGraph, on custom code — simultaneously. The installation governs them uniformly via the manifest contract; the runtimes execute them independently.

**One operator, possibly multiple installations.** An individual could run a personal installation (their Virgils + a Stewart for side projects) and be the operator of a separate organizational installation (Stewarts for the company's BUs + shared Masons). Genus does not assume one-installation-per-operator.

**Cross-cutting policies live at installation level, not in individual agents.** Security/credential governance, context budgets, comparison/optimization strategy — these are installation-level concerns, decided once and applied to every conformant agent. An agent cannot redefine these for itself. v0.1 ships these as installation-level configuration; v0.2 formalizes them in dedicated specs (`SECURITY_MODEL.md`, `CONTEXT_GOVERNANCE.md`, `OPTIMIZATION_AND_COMPARISON.md`).

---

## Runtime adapters

The protocol is runtime-neutral, but every Genus installation runs on a concrete technical runtime. A **runtime adapter** is the mapping that lets a runtime host Genus agents — how the protocol's primitives implement in that runtime's mechanisms.

### What a runtime adapter provides

For any supported runtime, the adapter defines how five things implement:

1. **Identity loading** — how an agent's identity files (`IDENTITY.md`, `CONTRACT.md`, `PLAYBOOK.md`, etc.) become part of the agent's runtime context.
2. **Heartbeat triggering** — how a Stewart or Virgil's scheduled heartbeat fires (cron, scheduled workflow, scheduled function, etc.).
3. **Substrate access** — how the agent reads from and writes to the installation's operational substrate (Task store, KPI Registry, Workflow Registry, Agent Updates store, Approval Log, Artifact index).
4. **Connector authorization** — how the agent gains access to declared connectors per its permission scope (MCP servers, API integrations, native runtime tools).
5. **Activity Layer surfaces** — how operator-facing interactions happen (sessions, dashboard views, action-required notifications).

The adapter is a short mapping document plus a reference implementation. It is not the protocol; it is the bridge from the protocol to one runtime.

### v0.1 supported runtimes

| Runtime | Status | Notes |
|---|---|---|
| **Claude Code** | ✅ Supported in v0.1 | Reference adapter. All v0.1 reference agents run here. |
| n8n | ⏸️ Future, adopter-pull | Added when an adopter with an existing n8n footprint forces it. |
| LangGraph | ⏸️ Future, adopter-pull | Same rule. |
| CrewAI | ⏸️ Future, adopter-pull | Same rule. |
| OpenAI Agents SDK | ⏸️ Future, adopter-pull | Same rule. |
| Make / Zapier | ⏸️ Future, adopter-pull | Same rule. |
| Custom code | ⏸️ Future, adopter-pull | Bespoke adapter per implementation. |

### The adopter-pull rule

Genus does NOT speculatively add runtime adapters. A new adapter is built only when a real adopter has a real footprint on that runtime and is committed to implementing on Genus. Speculative adapter work without an adopter is wasted engineering and obscures spec failures.

When the next runtime adapter is built, it ships as `<RUNTIME>_ADAPTER.md` in the Genus repo with the 5-point mapping above, plus a reference agent retrofitted onto that runtime.

### Why one runtime at a time

With multiple runtimes supported simultaneously, any failure is ambiguous — spec issue or runtime adapter issue? With one runtime, every failure is unambiguously a spec failure, which means fast iteration on the protocol. Adding the second runtime is what *pressure-tests* runtime-neutrality of the spec. Adding it before the first runtime is solid is premature.

### Heartbeat — a first-class promise

Scheduled execution is not optional. Stewart and Virgil archetypes fail their continuity commitments without reliable heartbeats — the whole learning system depends on background maintenance firing on cadence whether the operator is present or not.

**The runtime adapter must provide**:
- Reliable scheduled execution independent of operator-local state (laptop closed, machine off, multiple devices).
- Heartbeat success/failure surfaced to the installation's status panel.
- A documented fallback pattern if the runtime's native scheduling has caps or limits (external trigger source → runtime API call — e.g., a Cloudflare Worker, GitHub Actions schedule, AWS EventBridge, or self-hosted cron calling the runtime's API at the right time).

**Runtimes that cannot deliver reliable scheduling are Mason-hosting only.** Mason has no heartbeat — runtimes without scheduling can still host Mason agents. Stewart and Virgil require the heartbeat guarantee.

**The Genus app does NOT fire heartbeats.** It is an interface — view state, configure agents, approve actions. Heartbeats run in the runtime's infrastructure. Close the Genus app, restart your laptop, change devices: the agents keep firing on schedule.

**The protocol does NOT host a cron service.** Scheduling is delegated to the runtime adapter. Operators who want managed scheduling without infrastructure burden hire Sensible Flow (or any Genus implementation agency) — that's the commercial value, not Genus's job.

#### Gated heartbeats (recommended pattern, v0.2)

A heartbeat does not have to fire blindly. A common useful pattern: the scheduler runs a small gating check first; only if the gate condition is met does the agent actually wake.

Example: a personal Virgil that wraps up the day at midnight. The gate script checks whether today's daily note already contains a wrap-up section. If yes — operator already wrapped up — the gate returns "skip" and the agent is not woken. If no, the gate wakes the agent to run `/wrap-up`.

This pattern saves compute, reduces noise for the operator, and avoids redundant work on days when the operator already completed the task themselves. Recommended for personal-domain agents and any heartbeat whose work is sometimes already done by the time it fires.

The gating logic lives in the runtime adapter / host orchestration, not in the agent itself. The agent is summoned only when the gate says "wake."

#### Host orchestration vs. agent runtime

A subtle but useful distinction surfaced during retrofit. Many real installations have **two layers** under the `runtime` umbrella:

- **Agent runtime** — where the agent's code/prompts execute (e.g., Claude Code).
- **Host orchestration** — the surrounding infrastructure that provides scheduling, networking bridges, container management, message bridges (e.g., NanoClaw hosting Claude Code agents and providing Telegram bridge + scheduled-task service; or Anthropic's own claude.ai Triggers infrastructure providing cron for Claude Code agents).

For Genus v0.2, the manifest's `runtime` field declares the agent runtime. An optional `host` field declares the host orchestration when relevant. Adapter docs should clarify which combinations they support.

---

## Composability principle

Genus is the protocol layer. The agent families ship as separate, independently-forkable open-source repos:

- `Genus` — the spec + the protocol primitives + reference dashboards
- `Virgil` — the personal archetype + reference instances
- `Stewart` — the business archetype + reference instances
- `Mason` — the craft archetype + reference instances + registry

Each repo must be:
- **Independently forkable** — someone can clone just `Virgil` and use it standalone, without `Genus` or `Stewart` present.
- **Independently usable** — each repo delivers value on its own.
- **Composable together** — the highest-value experience is all four together, but that's additive value, not a precondition.

This rules out designs where (e.g.) Virgil depends on Genus runtime, or Stewart can't load without Mason. The Genus manifest is the contract that lets the four compose without coupling.

---

## Versioning + compatibility

Genus uses semantic versioning at the protocol level (MAJOR.MINOR).

- **MAJOR**: breaking changes to the 12 primitives, the archetype taxonomy, or the manifest contract. Existing conformant agents may need updates.
- **MINOR**: additions to the spec that do not break existing conformance.

Every conformant repo declares the Genus version it targets. A repo targeting 0.1 must continue working when Genus 0.2 ships. A repo targeting 1.0 may not work under 2.0 without migration.

---

## What this spec does NOT yet define

Deferred to v0.2 — written after one reference implementation pressure-tests v0.1:

- `SECURITY_MODEL.md` — agent identity, credential boundaries, audit trails, escalation rules, human override semantics. Jurisdiction is claimed at installation level in v0.1 (see *Genus installation*); the full spec lands in v0.2. If/when a dedicated security agent is warranted, it operates at Genus installation level, above individual agents.
- `CONTEXT_GOVERNANCE.md` — token budgets per agent/task, what loads at session start, runtime-specific context optimization. Becomes critical when Mason agents are invoked via API at scale. Jurisdiction is at installation level; v0.1 ships configuration-only, v0.2 formalizes the spec.
- `OPTIMIZATION_AND_COMPARISON.md` — extends Mason's comparison protocol from "vs baseline" to "vs alternatives" and "best path to goal". v0.1 ships Mason-vs-baseline only; v0.2 generalizes to: best Mason for a job, best runtime for a workflow, best path to a goal.
- `ARTIFACT_STANDARDS.md` — naming conventions, referenceability rules, retention.
- `DASHBOARD_CONVENTIONS.md` — required views, alerting, drill-down patterns.
- `REFERENCE_IMPLEMENTATION.md` — the canonical worked example end-to-end.
- `SENSIBLE_FLOW_IMPLEMENTATION_GUIDE.md` — how the commercial agency uses Genus to deliver client engagements.

These are intentionally deferred. The protocol is more useful underspecified than over-specified at v0.1.

---

## How to read this spec next

If you are:
- A non-technical operator: read the *What Genus is* / *12 primitives* / *Archetype taxonomy* sections. Skip the manifest details.
- An agent builder: read everything, then read `VIRGIL.md` / `STEWART.md` / `MASON.md` (whichever archetype you're building) and `GENUS_MANIFEST.md`.
- A runtime integrator: read the *Runtime* primitive and `GENUS_MANIFEST.md` — that's the contract your runtime must honor for Genus governance to work.

---

*v0.1 (2026-05-28) — initial draft authored during the lockdown window. Source: internal lockdown reference + v2 Stewart archetype spec.*

*v0.1 rev 2 (2026-05-28, same day) — substantive revision per operator's 10-point clarification. Added: Genus-as-communication-protocol and Genus-as-learning-system as the two top-level purposes; Operational substrate section (Task store, KPI Registry, Workflow Registry, Agent Updates store, Approval Log, Artifact index); Genus installation section (substrate + connector pool + agent registry + dashboard + status panel + configuration); non-negotiables 8 (uniform documentation architecture) and 9 (universal primitives, configurable definitions); Mason no-clock clarification (cadence inherited from calling Stewart). Deferred to v0.2: CONTEXT_GOVERNANCE.md, OPTIMIZATION_AND_COMPARISON.md (in addition to prior deferrals).*

*v0.1 rev 3 (2026-05-28, same day) — added "Runtime adapters" section locking the v0.1 runtime commitment: Claude Code is the only supported runtime; all others (n8n, LangGraph, CrewAI, OpenAI Agents SDK, Make, Zapier, custom code) are documented as future, adopter-pull. The adopter-pull rule explicitly prohibits speculative adapter work. Captures the "one runtime at a time" rationale: spec failures are unambiguous under one runtime; multi-runtime support comes after pressure-testing.*

*v0.1 rev 4 (2026-05-28, same day) — extended "Runtime adapters" section with "Heartbeat — a first-class promise" subsection. Locks the rules: heartbeat is a runtime adapter responsibility (NOT a Genus app responsibility); runtimes without reliable scheduling can only host Masons; the protocol does NOT host a cron service; managed scheduling is a Sensible Flow commercial concern. Documents the fallback pattern (external trigger source → runtime API call) for runtimes with scheduling caps or limits.*

*v0.1 rev 5 (2026-05-29) — expanded the Genus app description in § Installation. The app is framed as a package manager + control panel (analogous to npm install / pip), making the protocol usable for non-technical operators. Explicit "easy path, not only path" framing: the protocol works without the app; technical users can clone repos directly and operate manually. Closes the naming-overload pushback by sharpening the protocol-vs-app distinction.*

*v0.1 rev 6 (2026-05-29) — softened non-negotiable #8 from "uniform documentation architecture" to "primitives addressed, file structure flexible." Conformance is now defined by the necessary-and-sufficient test: can the installation discover and operate every primitive via the manifest? File-layout uniformity is recommended but not required. Surfaced by the Phase B retrofit of Virgil PA (CLAUDE.md as identity surface; distributed `config/` files for preferences + reflection inputs). Per operator framing: "necessary and sufficient that all agents address certain primitives, so that these can be mapped and managed through the Genus app."*

*v0.2 draft (2026-05-29) — Phase B retrofit findings folded into the spec. Two new subsections under § Runtime adapters → Heartbeat: (a) **gated heartbeats** (a gating check runs before waking the agent; recommended for personal-domain agents and any work that's sometimes already done) and (b) **host orchestration vs agent runtime** (the manifest's `runtime` field declares the agent runtime; an optional `host` field declares the host orchestration when relevant — e.g., NanoClaw hosting Claude Code). Companion v0.2 revisions in `VIRGIL.md`, `STEWART.md`, `MASON.md`, and `GENUS_MANIFEST.md`.*

*v0.3 draft (2026-05-29) — adds **Campaign** as the 13th primitive (positioned between Workflow and Task; updates primitive count from 12 to 13 throughout). Adds **Campaign store** to the Operational substrate table. Captures the missing layer between atomic Tasks (close) and permanent Streams (don't close) — the finite delivery shape that converts continuous stewardship into shippable, recognizable outcomes. Surfaced by an Architect reflection on 2026-05-29: an installation without Campaign as a first-class primitive cannot distinguish progress from drift, has no scope to creep against, and forces operators to mentally track campaign-shaped work that isn't represented anywhere in the substrate. Companion v0.3 revisions in `STEWART.md` (cap, finish-first ranking, ship-not-stew mandate, Dormant > 14d auto-surface) and `GENUS_MANIFEST.md` (optional `campaigns_store` + `campaign_status_enum` fields). The discipline ports the internal `THINKING_PATTERNS.md` Pattern #12 into the public protocol.*
