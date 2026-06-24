# ConfidenceFrame — Genus Protocol Primitive

**Status**: v1 (shipped 2026-06-24).
**Owner**: Sage Stewart (Architect / Head of Genus).
**Scope**: Generic Genus protocol primitive — the structured form of non-negotiable #2 (*Confidence honesty*) for any agent emitting claims to a Genus surface.
**Relation to `GENUS_SPEC.md`**: extends non-negotiable #2. The legacy ✅/⚠️/❓ tag is grandfathered for agents that do not emit claims to substrate surfaces (e.g. raw chat output).

---

## 1. Why this primitive exists

Genus non-negotiable #2 already requires *Confidence honesty* — every output carries a confidence tag where uncertainty exists. The original convention is tag-based: ✅ high / ⚠️ partial / ❓ speculative.

That tag is a single-layer self-report. It collapses three independent failure modes into one symbol:

- **Ignorance** — the agent doesn't know what *should* exist for this domain.
- **Staleness** — the data the agent does have is incomplete or out of date.
- **Pattern wrongness** — the data is complete and current but the picture doesn't make sense.

A single-symbol tag invites two-good-signals-cover-for-one-bad-one failure: an agent confidently reports HIGH because its data is current and coherent, while being blind to a missing category it never knew to ask about. The Medivara finance discovery surfaced this sharply: a 90%-reliable cash forecast is *worse than no forecast* because one missed monthly expense can flip a cash-positive forecast to cash-negative.

ConfidenceFrame is the structured replacement for the single-tag convention. It decomposes confidence into three independent layers and aggregates conservatively, so an agent cannot mask ignorance with grounding and coherence.

The Finance Module v1 is the first proven implementation. This spec extracts the module-agnostic shape so other modules and bound agents inherit it.

**One-liner**: *Confidence honesty becomes structured when an agent must self-assess three independent failure modes and aggregate without averaging.*

---

## 2. The three layers

| Layer | The question the agent asks itself | Failure mode it catches |
|---|---|---|
| **L1 — Mental Model** | Do I know what *should* exist in this domain for this operator? | Ignorance — categories the agent doesn't know about can't be evaluated. |
| **L2 — Data Grounding** | Is the data for what I know about actually here, current, complete? Or am I extrapolating? | Staleness — connectors silent past their cadence, missing periods, partial coverage. |
| **L3 — Coherence** | Does the picture make sense? Anything jump out as off? | Pattern wrongness — anomalies, misclassifications, inconsistencies. |

Three layers, not N, because they map to three genuinely distinct failure modes that don't reduce to each other:

- L1 failure is unbounded (you can't bound what you don't know).
- L2 failure is bounded by what L1 enumerated (you know what's missing because L1 told you what to expect).
- L3 failure is bounded by what L2 grounded (you can only spot anomalies in data you have).

Compressing to two layers loses the L1/L2 distinction — the most operationally important one (the Medivara failure mode is specifically L1 ignorance masquerading as L2/L3 strength). Expanding to four layers adds cognitive load without catching a fourth distinct failure mode that observation has surfaced.

Each layer's state is one of: `high` / `medium` / `low` / `unknown`. **Numeric scores are not permitted on the protocol surface** — they invite false precision about agent uncertainty. (Internal implementations may use richer signals to drive the categorical output; the wire format stays categorical.)

`unknown` is distinct from `low`. `unknown` means *the layer cannot evaluate* (e.g. L1 during onboarding before the operator confirms expected categories; L2 if a required connector is in an error state). `low` means *the layer evaluated and found a problem*.

---

## 3. Aggregation rules

### 3.1 — Aggregation operator: `min`, never average

Within a single claim, the claim's confidence is `min(L1, L2, L3)` under the ordering:

```
unknown ≤ low ≤ medium ≤ high
```

`unknown` aggregates as *worse than* `low` — don't render a number you don't know how to evaluate.

Averaging is forbidden. Averaging is the "two good signals cover for one bad one" failure mode the primitive exists to prevent.

### 3.2 — L1 hard gate

If L1 is `low` or `unknown` for a claim, the claim's overall confidence is forced to `low` regardless of L2/L3 state.

Rationale: L2 and L3 evaluate against what L1 enumerated. If L1 is ignorant, L2 and L3 are confidently judging the wrong things. L1 ignorance is unbounded; L2/L3 problems are bounded. The hard gate makes this asymmetry explicit.

The L1 hard gate is part of the protocol — implementations that report `overall: high` while `mental_model: low` are non-conformant.

### 3.3 — Per-claim, not per-module headline

Confidence attaches to the **specific claim** (figure, recommendation, prediction, data row), not to the module as a whole.

A real surface contains claims with wildly different confidence. Rendering one module-level headline averages meaningful signal away. The Finance Module v1 rejected the module-headline pattern after the agreed design proposed it, on three grounds:

1. **Mixed-confidence reality** — high-confidence rent and low-confidence ad-hoc receivables coexist on the same screen. Average is dishonest.
2. **Inline marker is more actionable** — *"this specific number is uncertain — here's why"* directs the operator to the gap; *"the module is uncertain, somewhere"* doesn't.
3. **Aggregate views stay clean** — coarser audience-level indicators (e.g. an investor Health indicator) can be derived from per-claim confidence as a separate computation, not replaced by it.

Where a downstream computation depends on N inputs (e.g. runway projection depends on every cash line item), its confidence is `min(per-claim confidence)` over its inputs. Tainted inputs taint their aggregates, but they do NOT taint claims they don't feed.

---

## 4. Continuous update — not a one-shot tag

ConfidenceFrame is a continuously maintained state, not a value computed at emit time and frozen. Implementations update on these classes of event:

| Event class | Layer(s) touched |
|---|---|
| Mental-model change (operator confirms / unconfirms expected category, business-model snapshot updates) | L1 |
| Data flowing (new record from a connector, manual entry, connector going silent) | L1 (steady-state alert), L2 |
| Operator interaction (confirms / dismisses an L3 flag, resolves a gap) | The flagged layer |

The bound agent's working memory holds the current state; render-time emits the current state. There is no "stamp confidence at output time and freeze." Re-render is cheap; staleness in the confidence itself is the failure to avoid.

Persistence of the working state is an agent / runtime concern, not a protocol concern.

---

## 5. UI affordances

Four affordances are reserved on the protocol surface. Modules and the shell choose which to use per claim:

| Affordance | When to use | Visual treatment |
|---|---|---|
| **Badge** | The default. Inline marker next to the claim's value when the policy says it should surface. | Small subdued icon (warning hue, not red). MUST NOT visually outweigh the claim's value. |
| **Hover** | Expander on the badge providing the *"why this might be wrong"* detail. | One-sentence summary + the underlying gap in operator-language + a direct action link if one exists. |
| **Hidden** | The claim is not rendered (or rendered as `—` / `unavailable`). Used when the policy says low-confidence claims must not surface at all. | Empty slot or explicit placeholder. |
| **Blocking** | The claim is rendered but the operator cannot act on it (button disabled, recommendation suppressed) until confidence improves. | Disabled state plus an actionable explanation. |

Layer names (L1/L2/L3) and internal vocabulary MUST NOT surface to operators. Operators see *"the May invoice from Rent is missing"*, never *"L2 = low"*. The layer model is an internal contract between bound agents and the protocol, not a UI element.

---

## 6. Low-confidence policy modes

Each surface declares one of three policy modes for how it handles low-confidence claims. The mode is a property of the surface (configured per module / per view), not of the claim itself.

| Mode | Render behavior | When to use |
|---|---|---|
| **silent** | High-confidence claims render with no marker; medium renders as high; low and unknown render with a badge + hover. No global headline. No blocking. | The default for operator-facing module views. The Finance Module v1 uses this (silent-low-only). Suits surfaces where operators read claims continuously and would suffer warning fatigue from per-claim chatter. |
| **warn** | Medium and low render with a badge; low+material claims also raise an alert on a separate surface. | Surfaces where downstream automated action depends on the claim (e.g. an agent about to send an outbound based on a "qualified lead" claim). Warning shifts to alerting at materiality threshold. |
| **block** | Low-confidence claims are either `hidden` or `blocking`-rendered. Operator cannot act on them until confidence improves. | Surfaces tied to irreversible or external actions — outbound messages, payments, contractual commitments. Combines with Approval Gates (Genus non-negotiable #3). |

**Mode selection is not the protocol's choice.** The protocol guarantees the modes exist; the surface picks. The Finance Module v1 chose `silent` after explicit analysis; other modules will choose differently.

**Materiality threshold** (used in `warn` and `block`) is a per-surface configuration, not a protocol value. The protocol guarantees the concept of materiality; the surface defines what counts as material.

---

## 7. Wire format

The wire format attaches ConfidenceFrame to any claim. Two shapes are conformant:

### 7.1 — Compact form (minimum)

```json
{
  "value": <any>,
  "confidence": "high"
}
```

`confidence` is a string literal: `"high"` / `"medium"` / `"low"` / `"unknown"`. This is the form for HIGH-confidence claims on `silent`-mode surfaces — the wire stays small.

### 7.2 — Structured form (when surfacing concerns)

```json
{
  "value": <any>,
  "confidence": {
    "overall": "low",
    "layers": {
      "mental_model": "high",
      "data_grounding": "low",
      "coherence": "high"
    },
    "concerns": [
      {
        "layer": "data_grounding",
        "summary": "May invoice from Rent vendor missing — expected by 7th of each month, today is 2026-06-24",
        "action": {
          "label": "Audit invoices",
          "kind": "operator-confirm",
          "href": "<surface-specific-action-ref>"
        }
      }
    ]
  },
  "evidence": [
    { "kind": "ledger-entry", "ref": "moneybird://entries/abc123" }
  ]
}
```

**Field rules:**

- `confidence.overall` — required. Same enum as the compact form. MUST equal `min(layers.*)` if `layers` is present (consumer can verify).
- `confidence.layers` — optional. When present, every layer key is required (`mental_model`, `data_grounding`, `coherence`) so the breakdown is interpretable.
- `confidence.concerns` — optional. Free-form structured list. Each entry MUST name the layer it came from and a summary in operator-language. `action` is optional; when present, `kind` ∈ {`operator-confirm`, `connect-source`, `audit-data`, `recategorize`, `dismiss`, `custom`}.
- `evidence` — optional. Pointers to underlying records (ledger entries, source rows, prior agent outputs). Opaque to the protocol; bound-agent and surface coordinate the schema.
- `policy` — NOT in the wire. The mode (`silent`/`warn`/`block`) is the surface's property, not the claim's.

**Equivalence**: the compact form is exactly equivalent to a structured form with `{ "overall": <value>, "layers": null, "concerns": [] }`. Consumers MAY normalize on the way in.

**Validation**: protocol validation is consumer-side. The protocol doesn't ship a runtime validator; the manifest declares ConfidenceFrame support, and consumers are expected to handle malformed payloads gracefully (treat as `unknown` and emit a warning).

---

## 8. What's specialized per module (NOT in this spec)

The protocol stays small. Per-module decisions:

| Concern | Decided by |
|---|---|
| The specific L1 categories (income streams for finance, market hypotheses for strategy, etc.) | The module's bound-agent identity package. |
| The specific connectors L2 maps onto | The module's instruction package. |
| The specific L3 patterns the bound agent watches | The bound agent (memory of what proved diagnostic in this domain). |
| The surface's policy mode (`silent`/`warn`/`block`) | The module's view spec. |
| Materiality threshold | The module's settings (operator-tunable per surface). |
| UI affordance choices (badge glyph, hover layout) | The Genus shell's design system; module views inherit shell defaults. |

The protocol guarantees the *contract*. Modules supply the *content*.

---

## 9. Conformance test

A bound agent claims conformance with ConfidenceFrame v1 if, for every claim it emits to a Genus surface:

1. It attaches a ConfidenceFrame in compact or structured form (§7).
2. It computes `overall` using the `min` rule (§3.1).
3. It enforces the L1 hard gate (§3.2) — `overall: high` is impossible with `mental_model: low` or `mental_model: unknown`.
4. It updates the ConfidenceFrame state on the event classes in §4 (not just at emit time).
5. It does not surface internal layer vocabulary to operators (§5 closing rule).

The conformance test is observable: the test inspects emitted claims plus a small set of operator-facing concern summaries. It does not require introspecting the bound agent's internals.

Non-conformant agents continue to function — they just don't participate in Genus shell features that depend on ConfidenceFrame (uniform badge rendering, alerts integration, cross-module aggregation when that lands).

---

## 10. Cross-references and dependencies

- [GENUS_SPEC.md](./GENUS_SPEC.md) — non-negotiable #2 (*Confidence honesty*) references this doc as the structured form.
- [GENUS_MANIFEST.md](./GENUS_MANIFEST.md) — declares `confidence_frame_mode: silent | warn | block` on bound-agent / module bindings that emit claims to Genus surfaces.
- Finance Module v1 — the proving implementation. Where the two specs disagree, the protocol abstraction wins for new modules; Finance Module v1 keeps its locked refinements.

---

*v1 (2026-06-24) — initial protocol-level spec. Extracts the module-agnostic shape from the Finance Module v1 ConfidenceFrame design. Shipped alongside the GENUS_SPEC v0.5 non-negotiable #2 rewrite and the GENUS_MANIFEST `confidence_frame_mode` field.*
