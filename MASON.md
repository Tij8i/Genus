# Genus — Mason Archetype

**Version**: 0.2 (draft) — Phase B retrofit additions: MASON_CARD input/output contracts, `context_inputs` concept, legacy-file coexistence pattern
**Status**: Public specification. Part of the Genus archetype family docs.
**Last updated**: 2026-05-28

---

## What this document is

The archetype specification for **Mason** — the per-invocation craft specialist. Read this if you are:
- Building a Mason (Designer Mason, Engineer Mason, Researcher Mason, etc.)
- Publishing a Mason to the Genus ecosystem
- Integrating a runtime that needs to host Mason agents

Prior reading: `GENUS_SPEC.md` (the protocol) and `AGENT_FAMILIES.md` (the four families overview).

---

## What a Mason is

**One-liner**: *A Mason is a per-invocation craft agent with no clock of its own, called from within another agent's flow, executing one well-defined craft, returning an artifact and craft notes.*

A Mason is built around three commitments:

1. **Deep craft, narrow scope.** A Mason knows one craft well — visual design, code, research, copywriting, analysis — and nothing else. The narrowness is the point. Craft accumulates over invocations because the scope holds.
2. **No clock of its own.** A Mason has no heartbeat, no scheduled wake-up, no continuous loop. It is called from within a Stewart's flow (or a Virgil's, less commonly), which has its own rhythm. The Mason executes, returns, goes idle.
3. **Earns its place via comparison.** A Mason that cannot outperform a baseline (default: a simple model call with the same brief) gets deprecated. Comparison is built into the protocol, not bolted on.

A Mason is a **contractor**, not an employee. No payroll, no schedule. Shows up when the project plan says so, does the work, leaves.

---

## Cadence and invocation model

Mason has **no clock of its own**. This is non-negotiable. A Mason that wakes itself up to do work has become a Stewart in disguise.

A Mason is invoked when a calling agent (typically a Stewart) reaches a step in its workflow that requires the Mason's craft:

```
Stewart workflow runs → step requires Designer Mason's craft → Stewart calls Designer Mason
                                                                        │
                                                Designer Mason executes the brief
                                                                        │
                                                Designer Mason returns artifact + craft notes
                                                                        │
                                                Stewart resumes the workflow
```

The Mason's "cadence" is therefore inherited from the calling Stewart's flow — whether that flow is triggered by a Stewart heartbeat, a scheduled workflow, or an operator-triggered task. The Mason itself has no opinion about when it runs.

**Mason invocation rules**:

- Mason is called *within* a workflow, not invoked at will by the operator outside one.
- The calling Stewart provides full business context for this invocation. The Mason does not maintain business context between invocations.
- The Mason executes synchronously from the workflow's perspective: input → execution → artifact + notes → return.
- The Mason cannot initiate calls upward (to its caller, to other Stewarts, to the operator directly). Communication is downward only.

---

## Memory shape (craft, not context)

Mason carries **only craft memory**. The calling Stewart carries the business memory.

| Memory | What it is | Where it lives |
|---|---|---|
| **Craft memory** | Technique, style, signatures, accumulated practice in the craft | The Mason's `CRAFT_LOG.md` |
| **Business memory** | Why the work was needed, which campaign, which KPI, which audience | The calling Stewart's `DOMAIN_MODEL.md`, `RECOMMENDATIONS.md`, etc. |

This split is what keeps Mason narrow. A Mason that starts remembering *why* it did things (the business context) has begun absorbing Stewart's job. Push back: business context goes back to the Stewart; the Mason gets clean briefs, every invocation.

The `CRAFT_LOG.md` is append-only. It records:
- What technique was used
- What worked, what didn't
- Style signatures that emerged
- References used (e.g., brand kits, prior artifacts of the same shape)
- Notes about edge cases for next time

The craft log is what makes Mason's 100th invocation better than its first. It is the reputation, made auditable.

---

## Required file set per Mason

A conformant Mason carries the following files. Smaller set than Stewart by design — Masons are simpler agents.

| File | Purpose | Read by Mason | Written by |
|---|---|---|---|
| `MASON_CARD.md` | Specialty + capabilities + constraints + signature style + **input contract** (what a calling Stewart's brief includes) + **output contract** (what the Mason returns) + `context_inputs` (files the Mason reads at every invocation) | Loaded at every invocation | Author at fork; rarely after |
| `CRAFT_LOG.md` | Append-only log of techniques learned across invocations | Loaded at every invocation | Mason at end of each invocation |
| `COMPARISON.md` | Declares the Mason's quality dimensions + measurement method + baseline | Loaded at evaluation time | Author at fork; revisited as craft evolves |
| `RATING_LOG.md` | Append-only log of ratings per invocation (Stewart-auto + operator-manual). Drives aggregate rating + lifecycle. | Loaded at every invocation (for current aggregate); read by registry queries | Calling Stewart (auto, post-invocation) + operator (manual override / proactive) |
| `GENUS_MANIFEST.md` | Plug-in contract — Genus version, archetype claim, identity files, runtime, permissions, current aggregate rating | Read by installation at registry time | Author at fork; aggregate rating updated by Mason after each invocation |

No `IDENTITY.md`, `CONTRACT.md`, `PLAYBOOK.md`, `DOMAIN_MODEL.md`, `REFLECTION_LOG.md`, `TRUST_LOG.md`, `HANDOFF.md` are required for Mason. Those exist for continuous agents that maintain state across sessions; a *new* Mason should not author them.

**Legacy-file coexistence** (v0.2 addition): a Mason retrofitted from a pre-Mason agent (e.g., a Stewart-shaped Tier 3 that's being promoted into a Mason) may preserve its legacy files (`IDENTITY.md`, `CONTRACT.md`, `PLAYBOOK.md`, etc.) as institutional memory. The manifest declares only the Mason primitives in `identity_files`; the installation reads only those. Legacy files are inert from Genus's perspective but are not deleted. This pattern lets retrofits preserve history without breaking the archetype.

**Context inputs** (v0.2 addition): a Mason that reads files OTHER than its own card/log/comparison at every invocation declares those as `context_inputs` in the manifest. Example: a Designer Mason that reads a saved taste-reference library on every invocation declares the references file as a context input. This is what lets the installation surface the Mason's "background knowledge" to the operator and audit which files influence each invocation. Distinct from craft memory (which the Mason itself writes) — context inputs are read-only configuration.

The uniformity of file structure within the Mason family is what makes Masons interchangeable for the same craft — a Designer Mason from one author plugs into the same Stewart workflow as a Designer Mason from another, because the card + log + comparison shape is the same.

---

## The comparison protocol

This is the **mechanism that justifies Mason's existence**. Without it, a Mason is just an LLM call with extra steps. The protocol has two parts: a declaration (what "good" means) and a measurement system (rating, applied at every invocation).

### What COMPARISON.md declares

Every Mason ships with a `COMPARISON.md` that specifies:

1. **Quality dimension(s)** — what "good" means for this craft. Examples:
   - Designer Mason: visual quality + brand-kit adherence
   - Engineer Mason: test pass rate + code-review delta + ticket-fit
   - Researcher Mason: source coverage + signal-to-noise + brief-fit
   - Copywriter Mason: voice-fit + brief-fit + operator acceptance
2. **Baseline** — what the Mason is compared against. Default: a simple model call with the same brief, no Mason-specific scaffolding. Authors may declare richer baselines (a competing Mason, a human contractor benchmark, a prior Mason version).
3. **Measurement method** — how each dimension is scored: operator rating, automated eval, structural check, A/B test on production output, etc.

### A Mason that can't define "good" doesn't deserve to exist

If a candidate Mason cannot declare a `COMPARISON.md`, it is not yet a Mason. Refine the craft scope until "good" is definable.

### The rating system

Every Mason invocation generates a rating, written to the Mason's `RATING_LOG.md`. The rating is a 1-5 score (integer or 0.5 increments) reflecting the dimensions declared in `COMPARISON.md`.

**Two raters**:

| Rater | When | Weight |
|---|---|---|
| **The calling Stewart** (automated) | At the end of every workflow that called the Mason. Stewart applies the COMPARISON.md dimensions to the artifact and scores 1-5. | **1×** |
| **The operator** (human, manual) | Proactively (browsing the dashboard, reviewing artifacts) OR when explicitly asked. Operator may override the Stewart's prior rating, or add a fresh rating for an unrated invocation. | **10×** |

The 10× weighting anchors quality at the operator's judgment without requiring the operator to rate every invocation. A single operator rating outweighs ten Stewart ratings in the aggregate. The operator stays sovereign on quality; the Stewart's auto-rating fills in the gaps.

**Aggregation**: rolling weighted average over the last 30 invocations. The Mason's *current* rating is what surfaces in the registry and what a Stewart sees when choosing among candidate Masons for a job.

**Rating entry shape** (one row per invocation in `RATING_LOG.md`):

| Field | Value |
|---|---|
| Invocation ID | Unique identifier; links to the artifact + the calling workflow |
| Timestamp | When the rating was applied |
| Rater | Stewart name (auto) OR `operator` (manual) |
| Score | 1-5 (integer or 0.5 increments) |
| Notes | Optional — why this score; which dimension drove it |

### How rating drives discovery

When a Stewart needs a Mason for a job, the **rating is the primary sort key**. The Stewart-side lookup loop is:

> *"I'm about to do X. Among Masons whose card declares X as their specialty, which has the highest current rating?"*

The rating system is therefore a discovery mechanism, not just a deprecation signal. Better Masons get called more; worse Masons get called less; the system self-curates. This is what prevents the marketplace-graveyard failure mode that hits every skill/plugin registry.

---

## Birth and lifecycle

How a Mason comes into being and how it leaves.

### Birth — Stewart proposes, operator approves

The standard birth path is **Stewart-proposed**:

1. A Stewart performs the same-shape task N times (default: N=3, tunable per Stewart).
2. The Stewart recognizes the pattern and proposes forking a Mason to take over the work.
3. The Stewart drafts a proposed `MASON_CARD.md` (specialty + signature style accumulated so far) and `COMPARISON.md` (quality dimension the Stewart has been using implicitly).
4. The operator approves the fork (🔴) — this is non-negotiable for v0.1. Autonomous Mason forking is explicitly out of scope.
5. The Mason is created, registered with the installation, and added to the Stewart's preferred-callable list.

A Mason can also be **operator-initiated** (the operator decides they want a particular craft specialist) or **forked from existing community Masons** (clone, customize the card, re-publish).

### Three lifecycle states

| State | Definition | Discoverable to other Stewarts |
|---|---|---|
| **Probationary** | New Mason with < 5 rated invocations. Insufficient data to evaluate. | Yes, but tagged Probationary in the registry. Stewart picks accept the risk. |
| **Active** | ≥ 5 rated invocations AND current weighted rating ≥ 3.0 (on the 1-5 scale). In good standing. | Yes, ranked by current rating. |
| **Retired** | Current weighted rating < 2.5 for 10+ recent invocations OR explicitly retired by operator. No further invocations route to it. | No — filtered out of registry queries. |

A Mason transitions automatically based on its rating and invocation count. There is no committee, no manual review gate. The protocol is the curator.

**Probationary → Active**: hits 5 rated invocations with current weighted rating ≥ 3.0.

**Active → Retired**: current weighted rating drops below 2.5 for 10+ recent invocations. Or the operator explicitly retires.

**Retired → Active**: rare. Requires explicit operator action and resetting probation (the Mason starts over at zero invocations with the new craft log carried forward).

### Death

A retired Mason's files are preserved. The craft log is institutional memory; it may inform a future Mason in the same craft. But no new invocations route to it. Cleanly removed from the discovery surface; not deleted.

*Earn your place, or leave it.*

---

## Improvement model — selection pressure, not learning loops

Mason **does not improve via autonomous self-study**. There is no Mason heartbeat that wakes up to study its own outputs and refactor itself. That re-introduces the Stewart shape and is explicitly out of scope.

Mason improves through three mechanisms:

1. **Craft log accumulation.** Every invocation appends to `CRAFT_LOG.md`. The 100th invocation reads the prior 99 before drafting; technique compounds.
2. **Operator selection pressure.** Operators choose which Masons to keep using. Underperformers stop getting called. Stewarts forward this signal via their preferred-callable lists.
3. **The comparison protocol.** Masons that consistently fail the comparison get deprecated automatically.

This is **human-in-the-loop selection pressure**, not self-directed machine learning. The system improves by removing what doesn't work, not by training what does.

If you find yourself building autonomous improvement loops into a Mason, you are either (a) prematurely optimizing or (b) building a Stewart. Step back.

---

## The fallback rule — Stewart never amputates skills

When a Mason is forked from a Stewart-as-doer, **the Stewart's `PLAYBOOK.md` keeps the underlying recipe**. The recipe gets a wrapper:

```
Preferred: call Designer Mason with brief X.
Fallback: execute inline (the original Stewart recipe).
```

The Stewart still knows how to do the work. It just prefers to delegate. This matters because:

- **Mason might be deprecated**. Stewart still needs to function.
- **Mason might be unavailable** (registry outage, runtime issue, permission lapse). Stewart still needs to function.
- **A new Mason might be on probation**. Stewart can do the work itself while comparison data accumulates on the new Mason.
- **The work might be edge-case**. The Mason's brief might not cover it; Stewart absorbs the edge case directly.

**Stewart never amputates skills.** The Mason is an optimization, not a dependency.

---

## Mason's interaction with other agents

- **With the calling Stewart**: Stewart provides business context (in the brief) + structured inputs. Mason returns artifact + craft notes. Communication is downward (Stewart → Mason); Mason does not call back.
- **With other Masons**: typically none. A Mason that calls another Mason is composing crafts, which usually means the calling agent should be a Stewart instead. Edge case: a coordinator Mason that arranges other Masons' outputs is allowed but rare.
- **With Virgils**: Virgil may also call Masons (Fitness Virgil calling Analyst Mason on workout data). Same shape as Stewart→Mason.
- **With the operator directly**: not by default. Mason's outputs surface to the operator through the calling agent's existing surfaces (Stewart's RECOMMENDATIONS, Stewart's HANDOFF, the installation dashboard).
- **With Genus installation services**: reads/writes the Artifact index for the artifacts it produces; reads its registry entry; honors the installation's permission pool and connector pool.

---

## Mason vs not-a-Mason

These are not Masons, even when they look like one:

- **An ad-hoc "just do this random thing" function** — no repeating shape, no technique to accumulate, no comparison possible. Just call the model directly.
- **A business-context-heavy decision** — needs to know the BU, the KPI, the operator's risk profile. Give the work to a Stewart instead.
- **A continuous monitoring service** — wakes up regularly, watches something, posts when patterns detected. That's a Stewart heartbeat function, not a Mason.
- **A multi-step process with internal state** — Mason executes one craft, returns, goes idle. State across invocations lives in `CRAFT_LOG.md` (technique), not in the Mason's working memory.
- **A "smart" workflow with branching logic** — that's a workflow, hosted on a runtime. The workflow may *call* Masons at specific steps, but the workflow itself is not a Mason.

If a candidate Mason has no clear craft scope, no measurable quality dimension, or needs business context to operate, it is not yet a Mason. Refine the scope before forking.

---

## Conformance checklist (does this repo claim to be a Mason?)

A repo claiming Mason archetype in its `GENUS_MANIFEST.md` must:

- [ ] Declare a single craft specialty (not a portfolio of crafts)
- [ ] Ship a `MASON_CARD.md` declaring specialty + capabilities + constraints + signature style
- [ ] Ship a `COMPARISON.md` declaring quality dimension(s) + baseline + measurement method
- [ ] Ship a `CRAFT_LOG.md` (may be empty at fork; populates with invocations)
- [ ] Ship a `RATING_LOG.md` (may be empty at fork; populates with rated invocations)
- [ ] Declare NO heartbeat schedule (Mason has no clock; declaring one is a manifest error)
- [ ] Declare its runtime requirement + tool/MCP requirements + permission scope
- [ ] Expose current aggregate rating in `GENUS_MANIFEST.md` so the registry can rank it
- [ ] Honor the 9 non-negotiables of `GENUS_SPEC.md`
- [ ] Never call upward (no `RECOMMENDATIONS` write to a Stewart, no operator-facing surface of its own)

A repo missing any of these is not Genus-Mason-compatible.

---

## What is deferred to v1.1+

The following are intentionally not in v0.1:

- **A centralized Mason registry index.** v0.1 Masons are discovered by browsing `Tij8i/genus-mason-*` repos and reading their `GENUS_MANIFEST.md` (which exposes the current aggregate rating). v1.1 adds a JSON manifest in `Tij8i/Genus` aggregating all known Masons + their ratings + cards for fast Stewart-side lookup. Rating-driven selection itself is in v0.1; what's deferred is the central index that makes it efficient.
- **Automated Mason birth** (Stewart auto-forking a Mason without operator approval). Unlocked per-installation in v0.2+ once the rating + comparison protocol has been pressure-tested.
- **Cross-Mason composition** (Masons calling other Masons systematically). v0.1 treats this as anti-pattern; v0.2 may formalize a coordinator Mason if it earns its place via rating.
- **Broader optimization protocol** — extends Mason-level rating to workflow-level optimization (best Mason + best runtime + best path to a goal). Lives in `OPTIMIZATION_AND_COMPARISON.md` at v0.2.
- **Per-dimension rating breakdown** — v0.1 records a single overall score per invocation; v0.2 may add per-dimension granularity for cases where the COMPARISON.md declares multiple dimensions with very different signal shapes.

---

## What to read next

- Forking the canonical Mason template? → start with the `Mason` reference repo at `Tij8i/Mason`.
- Want to understand how Masons relate to Stewart and Virgil? → `AGENT_FAMILIES.md`.
- Want to understand the protocol Mason sits inside? → `GENUS_SPEC.md`.
- Publishing your Mason as a Genus-compatible repo? → `GENUS_MANIFEST.md`.

---

*v0.1 (2026-05-28) — initial draft. Source: `docs/system/GENUS.md` v1.1 (Mason operating spec, locked earlier today), `AGENT_FAMILIES.md` v0.1, and `GENUS_SPEC.md` v0.1 rev 2.*

*v0.1 rev 2 (2026-05-28, same day) — added the rating system (1-5 scale, Stewart-auto at 1× weight + operator-manual at 10× weight, rolling weighted average over last 30 invocations); replaced 5-state lifecycle with 3-state (Probationary / Active / Retired) driven by rating thresholds; added `RATING_LOG.md` to required file set; rating-driven discovery becomes the Stewart-side Mason picker. Reframed registry deferral: rating mechanism in v0.1, centralized index in v1.1. Source: operator's rating-system clarification.*

*v0.2 (2026-05-29) — Phase B retrofit of Designer Mason surfaced three additions: (1) MASON_CARD.md now requires **input contract** and **output contract** sections (what a brief includes; what the Mason returns) — without them, a calling Stewart doesn't know what shape of brief to send; (2) introduced **`context_inputs`** concept — files the Mason reads at every invocation that are neither brief inputs nor accumulated craft memory (e.g., a saved taste-reference library) — declared in the manifest so the installation can surface "background knowledge"; (3) documented **legacy-file coexistence pattern** for retrofits of pre-Mason agents (manifest declares only Mason primitives in `identity_files`; legacy files remain inert as institutional memory).*
