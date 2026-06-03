# Genus — Agent Families

**Version**: 0.1 (draft)
**Status**: Public specification. Companion to `GENUS_SPEC.md`.
**Last updated**: 2026-05-28

---

## Purpose of this document

This is the **intro + decision aid** for the three Genus agent families. Read this before reading the per-family specs (`VIRGIL.md`, `STEWART.md`, `MASON.md`).

What you get here:
- What the three families are, at a glance
- The two axes that discriminate them
- Why exactly three and not four
- Examples and counterexamples for each family
- A decision flowchart for "what family does my new agent belong to?"
- The composition pattern — how the three work together
- What's *not* a Genus agent

What you don't get here: the operational details of each archetype (those are in the per-family specs) or the manifest schema (that's in `GENUS_MANIFEST.md`).

---

## The three families at a glance

| Family | Cadence | Scope | What they own | Memory shape | Canonical example |
|---|---|---|---|---|---|
| **Virgil** | Continuous | Personal | One human's continuity in one personal domain | Rich; domain model + reflection log + handoff | Personal assistant, fitness coach, mental health companion, personal headhunter |
| **Stewart** | Continuous | Business | One business unit's outcomes (KPIs) | Rich; domain model + KPI capture + recommendations + trust log + handoff | A marketing operation's KPI owner; a finance ops Stewart; a sales ops Stewart |
| **Mason** | Per-invocation, no clock of its own | Craft | One craft specialty, called within other agents' flows | Lean; specialty card + craft log only | Designer Mason (visual assets), Engineer Mason (code/infra), Researcher Mason (info gathering), Analyst Mason |

The cadence + scope combination *is* the family. Anything else is a misclassified agent.

---

## The two axes

Two discriminating axes — and exactly two:

### Cadence: continuous vs per-invocation

- **Continuous**: the agent is always *there*. It has a heartbeat (a daily background maintenance cycle), it remembers yesterday, and it can be summoned mid-session. Continuous agents are *persons* in the operational sense — they have continuity of self.
- **Per-invocation**: the agent runs only when called, executes a scoped task, and returns to idle. It has no clock of its own. It is called as part of another agent's flow, not summoned by the operator directly. Per-invocation agents are *contractors* in the operational sense — they show up for the job, then leave.

### Scope: personal, business, or craft

- **Personal**: the agent's orientation is toward one human being's life and outcomes. Personal Virgil agents serve the *individual* — their attention, their goals, their preferences, their domain (fitness, mental health, career, finance).
- **Business**: the agent's orientation is toward one business unit's outcomes. Stewart agents serve the *BU* — its KPIs, its workflows, its operating priorities. They report to an operator who is accountable for the BU.
- **Craft**: the agent's orientation is toward a single specialty — designing visuals, writing code, gathering research, drafting copy. Mason agents serve *whoever calls them*, executing their craft within the caller's context.

---

## Why three, not four

The cadence × scope grid has six cells. Three are filled (Virgil, Stewart, Mason); three are not. Each empty cell would be either a misclassification or a non-agent:

| | Continuous | Per-invocation |
|---|---|---|
| **Personal** | **Virgil** | *Empty.* A per-invocation personal agent is just a tool the operator picks up and puts down — that's a feature of their PA Virgil, not its own archetype. |
| **Business** | **Stewart** | *Empty.* A per-invocation business agent strips persistence from a Stewart and yields a fragile contextless executor — the "Stewart-as-script" anti-pattern. |
| **Craft** | *Empty.* A continuous craft agent with its own clock and KPIs has become a Stewart in disguise — promote it or kill it. | **Mason** |

So three families is a strong commitment, not an accident. If you encounter a candidate agent that fits none of the three, the right move is to refine its scope until it does — not to invent a fourth family.

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

## Stewart — the business-unit owner

**One-liner**: *A Stewart is a continuous business agent that owns the KPIs of one business unit and progressively earns the right to execute on behalf of its operator.*

A Stewart is built around **owned business outcomes**. It maintains a domain model of its BU, captures KPIs on a cadence, recommends interventions to its operator, and over time earns expanded authority to execute autonomously within an envelope.

A Stewart operates in three modes — **Monitor**, **Recommend**, **Execute** — climbing toward Execute as it earns its operator's trust through the Trust Cycle.

### What makes a good Stewart candidate

- The BU has its own outcomes (its own KPIs, not borrowed from elsewhere)
- The BU has its own workflows (its own processes, not just instances of someone else's)
- The BU has a single accountable operator (one human is on the hook for its results)
- The BU has enough operating tempo to justify a heartbeat (something is changing daily or weekly)

### Canonical Stewart examples

- A marketing operation's KPI owner (lead volume, conversion rate, CAC)
- A finance operation's KPI owner (cash position, runway, AR aging)
- A sales operation's KPI owner (pipeline coverage, win rate, sales cycle)
- A studio's portfolio Stewart (ventures by stage, time-at-stage, kill rate, spin-off rate)
- An agency's client-delivery Stewart (utilization, on-time delivery, NPS)

### What is NOT a Stewart

- A cross-business horizontal function (those are typically Mason specialties shared across multiple Stewarts, or are owned by the operator directly)
- An ad-hoc business workflow with no owner
- A "platform" agent that manages other agents (that's a Genus installation-level concern, not a Stewart)

One operator may have multiple Stewarts (one per BU). One Stewart serves exactly one operator and exactly one BU.

See `STEWART.md` for the archetype's operational spec.

---

## Mason — the craft specialist

**One-liner**: *A Mason is a per-invocation craft agent that executes within the calling Stewart's flow, produces an artifact, and returns craft notes for its own ongoing improvement.*

A Mason is built around **deep specialty in one craft**. It has no heartbeat, no clock, no business context — those belong to the Stewart that calls it. What it has is craft memory: technique, style, signatures, and accumulated practice in one domain.

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
- A continuous monitoring agent (that's the Stewart's heartbeat, not a Mason)

One Mason is typically callable by multiple Stewarts (a Designer Mason serves all BUs in an installation). The Mason itself has no allegiance to any one BU.

See `MASON.md` for the archetype's operational spec.

---

## How the three families compose

The canonical interaction pattern in a Genus installation:

```
   Operator
       │
       ├──── (personal scope) ──── Virgil(s) ──── Mason call (optional)
       │
       └──── (business scope) ──── Stewart(s) ─── Mason call (workflow step)
                                       │
                                       └── Stewart-to-Stewart (cross-BU coordination)
```

- **Operator talks to Virgil** for personal-scope work — planning, reflection, intent clarification, personal-domain queries.
- **Operator talks to Stewart** for business-scope work — KPI review, business decisions, BU operations.
- **Stewart calls Masons** within workflow steps — delegate craft execution to the right specialist.
- **Virgil may also call Masons** — e.g., a Fitness Virgil calling an Analyst Mason for workout-data analysis.
- **Stewarts may talk to each other** — cross-BU coordination, shared signals (e.g., a marketing Stewart surfacing a lead to a sales Stewart).
- **Masons do not call back upward** — they execute and return; they do not initiate calls to Stewarts or Virgils.

The directionality matters. Calls flow downward (operator → Virgil/Stewart → Mason). Mason→Stewart upward calls would mean Mason has business context, which would mean it's not a Mason anymore.

---

## Choosing the right family for a new agent

When you have a candidate agent in mind, work through this:

**Q1: Is this work continuous or per-invocation?**
- *Continuous* = the agent has memory of yesterday, has a heartbeat, can be summoned mid-session. → go to Q2.
- *Per-invocation* = the agent only runs when called, has no clock, has no continuous memory. → go to Q3.

**Q2 (continuous): Is the scope personal or business?**
- *Personal* = oriented around one human's life or domain → **Virgil**
- *Business* = oriented around one BU's outcomes → **Stewart**
- *Neither* → the agent probably isn't continuous; reconsider Q1.

**Q3 (per-invocation): Is the work craft-defined?**
- *Craft-defined* = clear inputs, clear outputs, deep technique, comparable to baseline → **Mason**
- *Business-decision* = needs business context, KPIs, accountability → not a Mason; give the work to a Stewart instead.
- *Random one-off* = no repeating shape, no technique to accumulate → not a Genus agent; just call the model directly.

If you can't decide, the agent's scope is too vague. Refine the scope before forking.

---

## What is NOT a Genus agent

Not every AI use case wants to be a Genus agent. Some honest exclusions:

- **Pure LLM chat** — no persistence, no shared substrate, no manifest. That's a model API call, not a Genus agent.
- **A workflow with no owner** — a script in n8n that no one is accountable for. That's automation, not an agent.
- **A team of humans coordinating** — a Genus installation may *support* a team, but the team itself is not an agent.
- **An autonomous research bot with no operator accountability** — Genus requires every agent to have a human in the loop somewhere (an operator, an approval gate, a Stewart-mediated workflow). Fully autonomous agents are out of scope.
- **A monitoring service that posts alerts but takes no actions** — that's a dashboard component, not an agent. Roll it into the installation's status panel.

These are not failures — they are just not Genus problems. Use the right tool for the right job.

---

## Boundary rules (reiterated)

From the non-negotiables in `GENUS_SPEC.md` and the rules of the taxonomy:

1. A continuous business agent is a **Stewart** by definition. Calling it something else doesn't change what it is.
2. A continuous personal agent is a **Virgil** by definition.
3. A per-invocation craft agent is a **Mason** by definition.
4. **Mason has no heartbeat.** No exceptions. A heartbeat-bearing Mason has become a Stewart.
5. **Mason has no clock.** Cadence is always inherited from the calling Stewart's flow.
6. **Mason does not call upward.** Calls flow Stewart → Mason, never back.
7. **Stewart does not impersonate Virgil.** Business work is not personal work, even when they share an operator.
8. Multiple Virgils per operator is **expected**. Multiple Stewarts per operator is **expected**. One Mason serving multiple Stewarts is **expected**.
9. Anything that doesn't fit one of these three needs *explicit* justification — not a fourth family.

---

## What to read next

- Building a Virgil? → `VIRGIL.md`
- Building a Stewart? → `STEWART.md`
- Building a Mason? → `MASON.md`
- Integrating a runtime or publishing a Mason to the registry? → `GENUS_MANIFEST.md`
- Trying to understand Genus as a whole before picking a family? → `GENUS_SPEC.md`

---

*v0.1 (2026-05-28) — initial draft. Source: `GENUS_SPEC.md` v0.1 rev 2 (archetype taxonomy section, expanded), `docs/system/GENUS.md` v1.1 (lockdown reference), and the v2 Stewart archetype spec.*
