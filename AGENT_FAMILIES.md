# Genus — Agent Families

**Version**: 0.2 (draft) — adds Monitor as the fourth family per `GENUS_SPEC.md` v0.6
**Status**: Public specification. Companion to `GENUS_SPEC.md`.
**Last updated**: 2026-06-25

---

## Purpose of this document

This is the **intro + decision aid** for the four Genus agent families. Read this before reading the per-family specs (`VIRGIL.md`, `STEWART.md`, `MONITOR.md`, `MASON.md`).

What you get here:
- What the four families are, at a glance
- The discriminating axes (cadence × scope, plus work shape for continuous-business agents)
- Why exactly four — and the disambiguation between Stewart's *Monitor mode* and the *Monitor family*
- Examples and counterexamples for each family
- A decision flowchart for "what family does my new agent belong to?"
- The composition pattern — how the four work together
- What's *not* a Genus agent

What you don't get here: the operational details of each archetype (those are in the per-family specs) or the manifest schema (that's in `GENUS_MANIFEST.md`).

---

## The four families at a glance

| Family | Cadence | Scope | Work shape | What they own | Memory shape | Canonical example |
|---|---|---|---|---|---|---|
| **Virgil** | Continuous | Personal | — | One human's continuity in one personal domain | Rich; domain model + reflection log + handoff | Personal assistant, fitness coach, mental health companion, personal headhunter |
| **Stewart** | Continuous | Business | Delivery (Campaigns) | One business unit's outcomes (KPIs) | Rich; domain model + KPI capture + recommendations + trust log + handoff | A marketing operation's KPI owner; a finance ops Stewart; a sales ops Stewart |
| **Monitor** | Continuous | Business | Watch (Recommendation feed) | One business + one domain (read-mostly, narrow allow-list, ConfidenceFrame-native) | Rich-but-narrower; domain model + recommendations + reflection log (no Trust Log, no TARGETS) | Finance Monitor (the first instance), Compliance Monitor, Ops-uptime Monitor, Marketing-health Monitor |
| **Mason** | Per-invocation, no clock of its own | Craft | — | One craft specialty, called within other agents' flows | Lean; specialty card + craft log only | Designer Mason (visual assets), Engineer Mason (code/infra), Researcher Mason (info gathering), Analyst Mason |

The cadence + scope + work-shape combination *is* the family. Anything else is a misclassified agent.

---

## The discriminating axes

Two primary axes — **cadence** and **scope** — plus a third axis (**work shape**) that only matters within continuous-business agents.

### Cadence: continuous vs per-invocation

- **Continuous**: the agent is always *there*. It has a heartbeat (a background maintenance cycle on a declared cadence), it remembers yesterday, and it can be summoned mid-session. Continuous agents are *persons* in the operational sense — they have continuity of self.
- **Per-invocation**: the agent runs only when called, executes a scoped task, and returns to idle. It has no clock of its own. It is called as part of another agent's flow, not summoned by the operator directly. Per-invocation agents are *contractors* in the operational sense — they show up for the job, then leave.

### Scope: personal, business, or craft

- **Personal**: the agent's orientation is toward one human being's life and outcomes. Personal Virgil agents serve the *individual* — their attention, their goals, their preferences, their domain (fitness, mental health, career, finance).
- **Business**: the agent's orientation is toward one business unit's outcomes. Stewart and Monitor agents serve the *BU* — its KPIs, its workflows, its operating priorities. They report to an operator who is accountable for the BU.
- **Craft**: the agent's orientation is toward a single specialty — designing visuals, writing code, gathering research, drafting copy. Mason agents serve *whoever calls them*, executing their craft within the caller's context.

### Work shape (only for continuous-business agents): delivery vs watch

- **Delivery** (Stewart): the agent's job is to *ship finite deliveries* inside the BU — Campaigns that close, Initiatives that move KPIs. Climbs through Monitor → Recommend → Execute trust modes; carries Campaign discipline (1–3 Active cap, Dormant > 14d, ship events). Broad substrate write surface.
- **Watch** (Monitor): the agent's job is to *watch and recommend* inside one domain — surface what jumps out, never render a figure it cannot defend, write only through a narrow allow-listed surface (typically a Recommendation feed). No Campaigns, no Execute mode by default. Narrow substrate write surface.

The work-shape axis only resolves within continuous-business agents because that's where the two distinct shapes show up in practice. A continuous-personal agent is always a Virgil (delivery-vs-watch doesn't separate them — Virgils do a bit of both, mediated by the operator). A per-invocation craft agent is always a Mason.

---

## Why four (and the disambiguation)

The cadence × scope grid has six cells; once continuous-business splits on work shape we get seven. Four are filled (Virgil, Stewart, Monitor, Mason). Empty cells would be misclassifications or non-agents:

| | Continuous (delivery) | Continuous (watch) | Per-invocation |
|---|---|---|---|
| **Personal** | **Virgil** | *(Empty — Virgils do both, mediated by the operator)* | *Empty.* A per-invocation personal agent is just a tool the operator picks up and puts down — that's a feature of their PA Virgil, not its own archetype. |
| **Business** | **Stewart** | **Monitor** | *Empty.* A per-invocation business agent strips persistence from a Stewart and yields a fragile contextless executor — the "Stewart-as-script" anti-pattern. |
| **Craft** | *Empty.* A continuous craft agent with its own clock and KPIs has become a Stewart in disguise — promote it or kill it. | *Empty.* Same reasoning. | **Mason** |

So four families is a strong commitment, not an accident. If you encounter a candidate agent that fits none of the four, the right move is to refine its scope until it does — not to invent a fifth family.

### Disambiguation: "Monitor" mode vs "Monitor" family

Important — the word *Monitor* appears in two places in the protocol and they are distinct:
- **Stewart's Monitor mode** (and Virgil's Monitor mode) — the *operational stance* of one Stewart/Virgil workflow at a moment in time: observing-without-executing while trust is built. A Stewart in Monitor mode is still a Stewart (carries Campaigns, runs delivery loops, climbs toward Execute).
- **Monitor family** — a separate archetype with a different *work shape*: watching, not delivering. Has its own heartbeat and its own Mind Family functions; does not run Campaigns and does not climb to Execute by default. Documented in `MONITOR.md`.

When ambiguity matters in writing, use *Stewart's Monitor mode* vs *Monitor family*. The naming overlap is intentional — "Monitor" is the right word in both places — but the two are not the same archetype.

---

## Virgil — the personal companion

**One-liner**: *A Virgil is a continuous personal agent that maintains continuity for one human in one personal domain.*

A Virgil is built around **continuity of attention**. It remembers what you said yesterday, surfaces what matters today, and learns your preferences over time. It is not a chatbot — a chatbot answers when asked; a Virgil also notices when you didn't ask.

### What makes a good Virgil candidate

- The domain has personal nuance (your preferences, your history, your context matter)
- The domain benefits from continuity (yesterday's conversation informs today's)
- There is a recurring set of concerns (planning, reflection, monitoring, coaching) that benefit from a dedicated presence

### Canonical Virgil examples

- **PA Virgil**: inbox triage, calendar management, weekly planning, daily reflection, "what's on your mind" capture
- **Fitness Virgil**: workout planning, recovery monitoring, nutrition coaching tied to your goals + history
- **Mental health Virgil**: mood check-ins, pattern surfacing, journaling support, escalation when warranted
- **Personal headhunter Virgil**: opportunity scanning, CV evolution, network activity, application tracking
- **Personal CFO Virgil**: spending awareness, savings tracking, goal-tied financial reflection

### What is NOT a Virgil

- A stateless chatbot (no memory, no continuity)
- A one-off Q&A interface
- A generic productivity tool that doesn't model *you*

Multiple Virgils for one operator is normal — and expected. Each Virgil owns one personal domain. They do not own each other.

See `VIRGIL.md` for the archetype's operational spec.

---

## Stewart — the business-unit owner (delivery-shaped)

**One-liner**: *A Stewart is a continuous business agent that owns the KPIs of one business unit and progressively earns the right to execute on behalf of its operator.*

A Stewart is built around **owned business outcomes**. It maintains a domain model of its BU, captures KPIs on a cadence, recommends interventions to its operator, and over time earns expanded authority to execute autonomously within an envelope.

A Stewart operates in three modes — **Monitor**, **Recommend**, **Execute** — climbing toward Execute as it earns its operator's trust through the Trust Cycle. (Stewart's *Monitor mode* is an operational stance of a Stewart workflow; it is NOT the same as the *Monitor family* — see the disambiguation note above and in `MONITOR.md`.)

### What makes a good Stewart candidate

- The BU has its own outcomes (its own KPIs, not borrowed from elsewhere)
- The BU has its own workflows (its own processes, not just instances of someone else's)
- The BU has a single accountable operator (one human is on the hook for its results)
- The BU has enough operating tempo to justify a heartbeat (something is changing daily or weekly)
- The agent is expected to **ship finite deliveries** (Campaigns) — not just watch and recommend. (If the answer to "what does this agent ship?" is "nothing — it watches and recommends", you want a Monitor, not a Stewart.)

### Canonical Stewart examples

- A marketing operation's KPI owner (lead volume, conversion rate, CAC)
- A finance operation's KPI owner (cash position, runway, AR aging) — *note: a domain-watcher with no delivery scope is a Monitor, not a Stewart*
- A sales operation's KPI owner (pipeline coverage, win rate, sales cycle)
- A studio's portfolio Stewart (ventures by stage, time-at-stage, kill rate, spin-off rate)
- An agency's client-delivery Stewart (utilization, on-time delivery, NPS)

### What is NOT a Stewart

- A cross-business horizontal function (those are typically Mason specialties shared across multiple Stewarts, or are owned by the operator directly)
- A domain-bound watcher with no delivery loop and a narrow allow-list of writes — that's a **Monitor**, not a Stewart (see `MONITOR.md`)
- An ad-hoc business workflow with no owner
- A "platform" agent that manages other agents (that's a Genus installation-level concern, not a Stewart)

One operator may have multiple Stewarts (one per BU). One Stewart serves exactly one operator and exactly one BU.

See `STEWART.md` for the archetype's operational spec.

---

## Monitor — the domain-bound watcher (watch-shaped)

**One-liner**: *A Monitor is a continuous domain-bound agent that watches one business in one domain, surfaces what jumps out, and writes only through a narrow allow-listed surface (typically a Recommendation feed) — no Campaigns, no delivery loops.*

A Monitor is built around **continuous watch, narrow action, defensible figures**. It maintains a domain model of one business in one domain (finance, marketing-health, compliance, ops-uptime, etc.), refreshes that model on a heartbeat, and surfaces what jumps out. Every claim it emits carries an attached ConfidenceFrame — it does not render figures it cannot defend.

A Monitor does **not** operate in three trust-progression modes (Monitor → Recommend → Execute) the way a Stewart does. Its archetype default is Recommend-only; there is no delivery loop to autonomize. What progresses inside a Monitor is ranking calibration (which signals the operator finds load-bearing) and explicit allow-list expansion (which the operator authorizes).

### What makes a good Monitor candidate

- The work is **continuous watch**: heartbeat-driven domain refresh, anomaly scan, recommendation production
- The action surface is **narrow and allow-listed**: typically a Recommendation feed plus alerts plus an optional digest
- The operator wants **defensible figures**: ConfidenceFrame-attached numbers, never silent fakery
- The agent has **no Campaigns to ship** — its job is surfacing, not delivering
- The agent is bound to **one business and one domain** (not cross-domain coordination)

### Canonical Monitor examples

- **Finance Monitor** (the first instance): watches one business's books via Moneybird, surfaces runway alerts and burn anomalies, monthly founder digest, quarterly investor view
- **Compliance Monitor**: watches one business's regulated surfaces (data handling, retention windows, consent records), surfaces drift signals against the regulatory schema
- **Ops-uptime Monitor**: watches one product's reliability surfaces (error rates, latency budgets, dependency health), surfaces anomalies against SLOs
- **Marketing-health Monitor**: watches one business's lead-quality and channel-mix signals, surfaces drift to be routed to a Marketing Stewart (or to the operator)
- **Support-quality Monitor**: watches one business's support surface (response time, escalation rate, sentiment drift), surfaces emerging issue clusters

### What is NOT a Monitor

- A Stewart in Monitor *mode* — that's the trust-progression starting point for a Stewart workflow; the Stewart is still a Stewart (carries Campaigns, climbs toward Execute)
- A stateless dashboard widget — no continuity, no ConfidenceFrames, no recommendation feed
- A monitoring service that posts alerts and nothing else — alerts without a recommendation feed + ConfidenceFrame + continuous mind layer + accountable allow-list don't clear the bar (this is still a dashboard component per the *What is NOT a Genus agent* section)
- A multi-domain "observability agent" — that's two collapsed-into-one Monitors and should be split, or it has become a Stewart attempting cross-domain coordination
- A cross-tenant SaaS monitoring product — a Monitor serves one operator's one business

One operator may have multiple Monitors (one per watched domain). One Monitor serves exactly one operator, exactly one business, exactly one domain.

See `MONITOR.md` for the archetype's operational spec.

---

## Mason — the craft specialist

**One-liner**: *A Mason is a per-invocation craft agent that executes within the calling agent's flow, produces an artifact, and returns craft notes for its own ongoing improvement.*

A Mason is built around **deep specialty in one craft**. It has no heartbeat, no clock, no business context — those belong to the Stewart (or Monitor, or Virgil) that calls it. What it has is craft memory: technique, style, signatures, and accumulated practice in one domain.

A Mason's existence is justified by its **comparison protocol**: it must outperform a baseline (default: a simple model call with the same brief) on a declared quality dimension. Masons that don't earn their place get deprecated.

### What makes a good Mason candidate

- Clear scope of work (well-defined inputs and outputs)
- Repeatable shape across invocations (technique accumulates across calls)
- Comparable to a baseline (you can tell if the Mason is better than just asking a model)
- Benefits from technique accumulation (the 100th invocation is better than the 1st)

### Canonical Mason examples

- **Designer Mason**: visual asset creation per brand guidelines, brief → asset, with accumulated style knowledge
- **Engineer Mason**: code generation, infra changes, tests; brief + repo context → commit / PR
- **Researcher Mason**: structured research on a topic, with method memory across runs
- **Copywriter Mason**: copy production in a defined voice, with voice memory and template library
- **Analyst Mason**: data analysis tasks with method library

### What is NOT a Mason

- An ad-hoc "do this random thing" function (just call the model directly)
- A business-context-heavy decision (give it to the Stewart instead — Mason doesn't carry business context)
- A continuous monitoring agent (that's a Monitor or a Stewart's heartbeat, not a Mason)

One Mason is typically callable by multiple agents (a Designer Mason serves all BUs in an installation; a Researcher Mason serves Stewarts and Monitors alike). The Mason itself has no allegiance to any one BU or domain.

See `MASON.md` for the archetype's operational spec.

---

## How the four families compose

The canonical interaction pattern in a Genus installation:

```
   Operator
       │
       ├──── (personal scope) ──── Virgil(s) ──── Mason call (optional)
       │
       └──── (business scope) ──── Stewart(s) ─── Mason call (workflow step)
                │                        │
                │                        └── Stewart-to-Stewart (cross-BU coordination)
                │
                └──── Monitor(s) ─── Mason call (occasional, e.g. Researcher for anomaly root-cause)
                         │
                         └── Recommendation feed ── consumed by Stewart(s) or operator
```

- **Operator talks to Virgil** for personal-scope work — planning, reflection, intent clarification, personal-domain queries.
- **Operator talks to Stewart** for business-scope work that ships — KPI review, Campaign promotion, business decisions, BU operations.
- **Operator talks to Monitor** for business-scope work that watches — domain state queries, recommendation triage, allow-list expansion decisions.
- **Stewart calls Masons** within workflow steps — delegate craft execution to the right specialist.
- **Monitor calls Masons** occasionally — narrow, e.g. a Researcher Mason for anomaly root-cause investigation. Most Monitor work needs no Mason.
- **Virgil may also call Masons** — e.g., a Fitness Virgil calling an Analyst Mason for workout-data analysis.
- **Stewarts may talk to each other** — cross-BU coordination, shared signals.
- **Stewart consumes a Monitor's recommendation feed** — e.g., a Sales Stewart pulling "lead-quality drift" recommendations from a Marketing-health Monitor and opening a Campaign. The substrate (recommendation feed + Agent Updates) is the channel; Monitor never initiates direct calls upward.
- **Masons do not call back upward** — they execute and return; they do not initiate calls to Stewarts, Monitors, or Virgils.

The directionality matters. Calls flow downward (operator → Virgil/Stewart/Monitor → Mason). Mason→Stewart upward calls would mean Mason has business context, which would mean it's not a Mason anymore. Monitor→Stewart upward calls would mean Monitor has delivery context, which would mean it's not a Monitor anymore — Monitor surfaces, Stewart picks up via the substrate.

---

## Choosing the right family for a new agent

When you have a candidate agent in mind, work through this:

**Q1: Is this work continuous or per-invocation?**
- *Continuous* = the agent has memory of yesterday, has a heartbeat, can be summoned mid-session. → go to Q2.
- *Per-invocation* = the agent only runs when called, has no clock, has no continuous memory. → go to Q4.

**Q2 (continuous): Is the scope personal or business?**
- *Personal* = oriented around one human's life or domain → **Virgil**
- *Business* = oriented around one BU's outcomes → go to Q3
- *Neither* → the agent probably isn't continuous; reconsider Q1.

**Q3 (continuous + business): What's the work shape — delivery or watch?**
- *Delivery* = the agent is expected to ship finite deliveries inside the BU (Campaigns, Initiatives that close). Climbs through Monitor → Recommend → Execute. Broad substrate writes. → **Stewart**
- *Watch* = the agent watches one domain inside one business, surfaces what jumps out via a narrow allow-listed surface (typically a Recommendation feed), never renders a figure it cannot defend (ConfidenceFrame-native), opens no Campaigns. → **Monitor**
- *Both* = pick one. If the agent must ship AND watch, it's a Stewart that uses its Monitor mode (the operational stance, not the family) for the watching part. Or split into a paired Monitor + Stewart, with the Monitor's recommendation feed consumed by the Stewart.

**Q4 (per-invocation): Is the work craft-defined?**
- *Craft-defined* = clear inputs, clear outputs, deep technique, comparable to baseline → **Mason**
- *Business-decision* = needs business context, KPIs, accountability → not a Mason; give the work to a Stewart instead.
- *Random one-off* = no repeating shape, no technique to accumulate → not a Genus agent; just call the model directly.

If you can't decide between Stewart and Monitor at Q3, the most reliable test is: **"What does this agent ship?"** If the honest answer is "nothing — it watches and recommends", it's a Monitor. If the honest answer names finite deliveries (a launched Campaign, a closed Initiative, a delivered artifact), it's a Stewart.

If you can't decide at all, the agent's scope is too vague. Refine the scope before forking.

---

## What is NOT a Genus agent

Not every AI use case wants to be a Genus agent. Some honest exclusions:

- **Pure LLM chat** — no persistence, no shared substrate, no manifest. That's a model API call, not a Genus agent.
- **A workflow with no owner** — a script in n8n that no one is accountable for. That's automation, not an agent.
- **A team of humans coordinating** — a Genus installation may *support* a team, but the team itself is not an agent.
- **An autonomous research bot with no operator accountability** — Genus requires every agent to have a human in the loop somewhere (an operator, an approval gate, a Stewart/Monitor-mediated workflow). Fully autonomous agents are out of scope.
- **A monitoring service that posts alerts but takes no actions** — that's a dashboard component, not an agent. A *Monitor* (the family) is distinguished from this by its recommendation feed, ConfidenceFrame guarantees, continuous mind layer, and accountable allow-list. Alerts-only services don't clear the bar — roll them into the installation's status panel.

These are not failures — they are just not Genus problems. Use the right tool for the right job.

---

## Boundary rules (reiterated)

From the non-negotiables in `GENUS_SPEC.md` and the rules of the taxonomy:

1. A continuous business agent is either a **Stewart** (delivery-shaped) or a **Monitor** (watch-shaped) by definition. The discriminator is work shape — see Q3 above. Calling either of them something else doesn't change what it is.
2. A continuous personal agent is a **Virgil** by definition.
3. A per-invocation craft agent is a **Mason** by definition.
4. **Mason has no heartbeat.** No exceptions. A heartbeat-bearing Mason has become a Stewart or Monitor.
5. **Mason has no clock.** Cadence is always inherited from the calling agent's flow.
6. **Mason does not call upward.** Calls flow Stewart/Monitor/Virgil → Mason, never back.
7. **Monitor does not run Campaigns.** A monitoring-shaped agent that opens Campaigns has become a Stewart and should be re-classified.
8. **Monitor is bound to one business + one domain.** Cross-domain or cross-business is a misclassification.
9. **Stewart does not impersonate Virgil.** Business work is not personal work, even when they share an operator.
10. Multiple Virgils per operator is **expected**. Multiple Stewarts per operator is **expected**. Multiple Monitors per operator (one per watched domain) is **expected**. One Mason serving multiple Stewarts/Monitors/Virgils is **expected**.
11. Anything that doesn't fit one of these four needs *explicit* justification — not a fifth family.

---

## What to read next

- Building a Virgil? → `VIRGIL.md`
- Building a Stewart? → `STEWART.md`
- Building a Monitor? → `MONITOR.md`
- Building a Mason? → `MASON.md`
- Integrating a runtime or publishing an agent to the registry? → `GENUS_MANIFEST.md`
- Trying to understand Genus as a whole before picking a family? → `GENUS_SPEC.md`

---

*v0.1 (2026-05-28) — initial draft. Source: `GENUS_SPEC.md` v0.1 rev 2 (archetype taxonomy section, expanded), `docs/system/GENUS.md` v1.1 (lockdown reference), and the v2 Stewart archetype spec.*

*v0.2 (2026-06-25) — **Monitor declared as the fourth Genus family** per `GENUS_SPEC.md` v0.6. Changes in this file: (1) "three families" → "four families" throughout. (2) New axis (*work shape*) introduced for continuous-business agents, distinguishing Stewart (delivery) from Monitor (watch). (3) New top-level *Monitor — the domain-bound watcher* section with candidates / examples / non-examples. (4) Updated *How the families compose* diagram + interaction rules to include Monitor's recommendation feed as the substrate-mediated upward channel. (5) Decision flowchart gains Q3 (delivery vs watch) for continuous-business agents. (6) Boundary rules updated: Stewart vs Monitor split, no-Campaign rule for Monitor, one-business-one-domain binding for Monitor. (7) Disambiguation note added: Stewart's *Monitor mode* (operational stance) is not the *Monitor family* (archetype). Companion v0.6 revisions in `GENUS_SPEC.md`, `GENUS_MANIFEST.md`, `STEWART.md`, `VIRGIL.md`, and the new `MONITOR.md`.*
