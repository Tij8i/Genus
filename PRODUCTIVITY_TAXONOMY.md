# Productivity Taxonomy — the 4-layer stack

**Part of the Genus v0.4 specification**
**Status**: Public specification.

This document defines the canonical 4-layer model Genus-conformant agents use to align strategic intent with executable work. The model encodes a specific ownership inversion principle: human authorship dominates at the top, agent authorship dominates at the bottom. This is what makes Genus a non-technical-operator agent operating model rather than yet another task tracker.

---

## 1. The stack

```
Goal (Strategic Intent)             ← human only · months to year+
    ↓ 1..N
Initiative                          ← human canonical, agent contributes bottom-up
    ↓ 1..N                            weeks to months
Package                             ← agent primary author, human adds tasks
    ↓ 1..N                            one session
Task                                ← agent execution, human as coach
                                      minutes to hours
```

The system converts strategic intent into executed work — and shifts authorship from human to agent as you descend.

---

## 2. The four layers

### 2.1 Goal (Strategic Intent)

A stable, long-term outcome the operator wants the system to chase.

| Property | Value |
|---|---|
| Horizon | months to year+ |
| Volatility | low |
| Ownership | **Human only** — operator is the canonical author |
| Agent role | Observer + proposer. Never executor at this layer. |
| Cap | 3-5 per Business Unit at a time (soft guidance) |
| Closure | Goals don't close in the operational sense — they're *achieved*, *abandoned*, or *rolled forward* as horizons shift |

**The agent's KPI-model role**: even though the human owns the Goal, the agent maintains an internal model of *how KPIs in the BU connect to possible Goals*. The agent can say *"that target depends on conversion rate, which is currently 1.8% vs the 3% your Goal implies — here's the gap"*, rather than just accepting the input passively.

### 2.2 Initiative

A coherent outcome path that produces a *measurable change* in the system. The unit at which strategic intent gets translated into bets.

| Property | Value |
|---|---|
| Horizon | weeks to months (typically 2-12 weeks) |
| Ownership | **Human canonical author**, agent contributes bottom-up |
| Closure | Completed when its measurable change is delivered, or Discarded |
| Cap | 1-3 Active per BU at a time (inherits Pattern #12 close-before-open discipline) |
| Cadence sanity | **5-20 Initiatives per Goal** (see §4) |

**The agent's bottom-up contribution**: while the human approaches Initiatives top-down ("to hit my Goal I'll relaunch the website"), the agent's job is to fill in from below using its KPI model. Often: "website relaunch alone won't hit 3 paying customers because conversion from the relaunch alone is unlikely to clear the rate × volume target — here are 2-3 additional Initiatives the KPI math suggests are missing." This is the human-as-strategist + agent-as-systems-thinker dynamic.

**Active Hypothesis (required at promotion)**: every Initiative promoted to `Active` must carry a one-sentence written prediction of what KPI will move and by how much if the Initiative succeeds. Example: *"This will land 1 paying client at €30-60K engagement within 90 days."* Rough is fine — the discipline of writing *something* forces the thinking. When the Initiative closes, the hypothesis is tested against actuals — that's how the system learns. An Initiative cannot transition from `Not started` to `Active` without this field populated.

**Renamed from Campaign** at v0.4. The v0.3 "Campaign" primitive split into two distinct layers: Initiative (the multi-week meaning) + Package (single-session bundles). Pattern #12's close-before-open discipline still applies, now at the Initiative layer.

### 2.3 Package

A cohesive set of Tasks executable together without re-negotiation — a single-session unit of work.

| Property | Value |
|---|---|
| Horizon | hours to one session |
| Ownership | **Agent primary author**, human adds tasks ad-hoc |
| Closure | All bundled Tasks done |
| Granularity | One Package ≈ what an agent ships in one session |

**The agent's authoring role**: this is the layer where the agent does most of the structural work. Given an Initiative, the agent proposes Packages that fulfill it. As the human surfaces individual Tasks ("file a task to do X"), the agent groups them into existing Packages or proposes new ones.

The Package layer unlocks **autonomous agent throughput** — when a human commits time ("I have 2 hours for this Initiative right now"), the answer isn't a flat task list; it's *"work Package P3 — these 6 Tasks together, ship them in this session."*

### 2.4 Task

The smallest executable unit of work.

| Property | Value |
|---|---|
| Horizon | minutes to hours |
| Ownership | **Agent execution**, human as coach |
| Requirements | Single actor · single outcome · verifiable completion · no embedded planning |

The human's role at this layer is **coaching, not executing**: helping the agent execute better (workflow improvements, Mason spawning, prompt refinement, calibration). Day-to-day Task execution should be agent-autonomous. If the human is regularly executing Tasks themselves, that's a signal the agent is under-equipped — investigate the cause, don't accept it as steady state.

---

## 3. Vertical binding rules

Strict structural constraints. Violations produce false-completion patterns.

| Rule | Constraint |
|---|---|
| **A** | Every Task belongs to **exactly one** Package |
| **B** | Every Package belongs to **exactly one** Initiative |
| **C** | Each Initiative maps to **1–3** Goals (M:N relation) |
| **D** | Orphans (Task with no Package, Package with no Initiative, Initiative with no Goal) are **temporarily-tolerated, actively-resolved** — never steady-state |

**What "orphan" means in practice**: the operator often surfaces work ad-hoc as it occurs to them. These items arrive into the system unconnected. The agent's job is to **triage them immediately**:

1. **First choice — bundle into an existing Package**: if the item fits an in-flight Package within an Active Initiative, route it there.
2. **Second choice — file as a new Package under an existing Initiative**: if it serves an Active Initiative but doesn't fit any current Package, propose a new Package.
3. **Third choice — flag as a candidate new Initiative**: surface it to the operator as *"this work suggests a new Initiative — want to file one?"*. Operator approves (or kills).
4. **Fourth choice — backlog with explicit "no current home" flag**: if it's a real piece of work but no Initiative justifies it yet, place it in a triage area where it remains visible but **not actionable** until promoted.

Items in state 4 are the closest thing to "permanent orphans" — and they're the failure mode. Agents should surface BUs with high state-4 counts as a signal that Initiative coverage is too thin OR ad-hoc Tasks aren't being absorbed cleanly.

**Until placed, orphans do not get worked on.** They sit in the backlog. The agent doesn't execute on un-placed work.

---

## 4. Cadence sanity check — the 5-20 rule

**Pattern**: a Goal takes between **5 and 20 Initiatives** to achieve. Outside this band, the system is in a failure mode.

| Initiative count | Diagnosis |
|---|---|
| < 5 | **Micro-thinking** — under-ambitious. Either the Goal is too small, or the agent isn't surfacing missing Initiatives bottom-up. |
| 5-20 | **Healthy** — proportional ambition. Each Initiative is a meaningful bet; together they have plausible path to the Goal. |
| > 20 | **Micro-managing** — overstructured. Initiatives have been split too granularly; many should be Packages within fewer Initiatives. |

**Scale-down for sprint Goals**: short-horizon Goals (2-3 weeks) realistically have 2-4 Initiatives, not 5-20. The band scales with horizon. For Goals < 1 month, use 2-5; for Goals > 6 months, use 5-20. Outside both bands is still a signal.

This is a **system check, not a hard constraint**. Outliers exist. But the band is a useful pulse-check and Stewart heartbeats should surface BUs that fall outside it.

---

## 5. Ownership matrix — the inversion principle

The crucial dynamic: **authorship shifts from human to agent as you descend the stack.**

| Layer | Author | Approver | Contributor | Executor |
|---|---|---|---|---|
| Goal | Human | Human | Agent (KPI-informed proposals) | — |
| Initiative | Human | Human | Agent (bottom-up gap-filling) | — |
| Package | Agent | Human (review) | Human (adds Tasks ad-hoc) | Agent |
| Task | Agent | Agent | Human (coaching, Mason spawning) | Agent |

**This is the heart of the model.** A common failure shape is to either (a) have the agent author everything and lose strategic alignment, or (b) have the human author everything and burn out at the execution layer. The 4-layer ownership inversion makes both ends honest: human owns *what matters*, agent owns *how to ship it*.

---

## 6. Operating rhythm

| Layer | Cadence | Forum |
|---|---|---|
| Goal | Quarterly review (operator + Stewart) | Strategic session |
| Initiative | Weekly priority check + on-demand promotion | Stewart heartbeat + operator session |
| Package | Daily / per-session (when a budget block opens) | Budget-allocation recipe |
| Task | Continuous (during a Package execution) | Agent autonomous loop |

The further down the stack, the more continuous the cadence.

---

## 7. KPI grounding — the agent's underlying model

The agent's contribution at the upper layers (Goal + Initiative) depends entirely on **understanding the KPI universe of the BU**. Without this, the agent can only mirror what the human says.

Per BU, the agent's KPI model should answer:

1. **What KPIs matter at all** for this business?
2. **How are the KPIs causally linked** (conversion → revenue, lead volume → conversion → revenue, etc.)?
3. **What Goals are reachable** given current KPI values, and what's the gap?
4. **Which Initiatives move which KPIs**, and by how much?
5. **Where are the leverage points** — KPIs whose movement disproportionately affects Goal achievement?

This model lives in the Stewart's `DOMAIN_MODEL.md` and is refreshed daily by the Mind Family Domain Refresh function. Without it, the agent's "bottom-up contribution" at the Initiative layer is hollow.

---

## 8. Substrate hints

Genus is substrate-agnostic — implementations can use Notion, Airtable, a custom DB, etc. The reference Notion implementation uses one DB per layer with `Area` (BU) as the filter dimension:

```
Goals DB              ← strategic outcomes per BU
Initiatives DB        ← finite deliveries; Parent Goals relation (1..3)
Packages DB           ← single-session bundles; Parent Initiative relation (1)
Tasks DB              ← atomic units; Parent Package relation (1)
```

Relations are bidirectional (M:N from Initiative to Goals; M:1 from Package to Initiative and Task to Package).

Implementations that use a different substrate shape (e.g., one DB per Stewart with per-BU isolation) are valid as long as the vertical binding rules (Rule A, B, C) are enforced.

---

## 9. Relationship to v0.3

| v0.3 primitive | v0.4 evolution |
|---|---|
| **Stream** | Becomes implicit — the BU itself is the Stream. Optional to keep as an explicit primitive; not load-bearing. |
| **Campaign** | **Splits into Initiative + Package.** Multi-week meaning becomes Initiative; single-session meaning becomes Package. |
| **Task** | Unchanged structurally; gains a mandatory Parent Package relation. |
| **Goal** (informal) | Promoted to first-class primitive with formal substrate. |

**Pattern #12 ("Close campaigns before opening new ones")** still applies. The discipline is real and important. At v0.4 it's framed at the Initiative layer: don't open new Initiatives while existing Active Initiatives have un-shipped Packages.

---

## 10. Anti-patterns at v0.4

| Anti-pattern | Diagnosis |
|---|---|
| A Task with no Parent Package | Rule A violation. File missing Package or convert to standalone marker. |
| An Initiative with 0 or 1 Packages | Under-decomposed. Agent hasn't done its Package authoring job. Or Initiative is wrongly sized (probably a Package masquerading as an Initiative). |
| A Goal with > 20 Initiatives | Micro-managing per §4. Consolidate. |
| A Goal with no Initiatives | The strategic intent isn't being chased. File the missing Initiatives or retire the Goal. |
| Initiatives without a Parent Goal | Strategic drift. Either file a Goal this Initiative serves, or kill the Initiative. |
| Human authoring Packages routinely | Inverted ownership. Investigate why the agent isn't authoring; usually a workflow / Mason gap. |
| Agent authoring Initiatives without operator approval | Inverted ownership the other way. Initiatives are human canonical; agent can propose only. |
| Initiative promoted to Active without Active Hypothesis | Bypasses hypothesis-driven discipline. The system can't learn from this Initiative's closure. |

---

*v0.4 (2026-06-04) — Productivity Taxonomy promoted to public spec. 4-layer model (Goal → Initiative → Package → Task), ownership inversion principle, 5-20 cadence rule, Active Hypothesis required-at-Active. Companion to GENUS_SPEC.md. See STEWART.md for archetype-specific application.*
