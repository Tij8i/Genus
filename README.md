# Genus

> The non-technical agent operating model. An open protocol for governing AI agents at scale.

Genus is an **open-source agent operating protocol** — a standard that defines how non-technical operators describe, deploy, and govern AI agents. The protocol specifies the primitives (Goals, KPIs, Workflows, Tasks, Campaigns, Constraints, Approval Gates, Artifacts, Permissions, Memory), the shared operational substrate (Task store, KPI Registry, Workflow Registry, Agent Updates, Approval Log, Artifact index, Campaign store), and the conformance contract (`GENUS_MANIFEST.md`) every Genus-compatible agent declares.

Genus sits **above** the technical runtime — n8n, LangGraph, CrewAI, OpenAI Agents SDK, Make, Zapier, custom code. It turns business intent into governed agentic execution. It does not compete with those frameworks; it sits on top of them.

> *"Genus defines the species. Sensible Flow puts it to work."*

[Sensible Flow](https://sensible-flow.com) is the first implementation agency built on Genus — the commercial complement. Genus itself stays open-source and free.

## What's in this repo

| File | Purpose |
|---|---|
| [`GENUS_SPEC.md`](./GENUS_SPEC.md) | The protocol specification — primitives, substrate, governance model, runtime adapters |
| [`AGENT_FAMILIES.md`](./AGENT_FAMILIES.md) | The three archetypes and how they compose (Stewart · Virgil · Mason) |
| [`STEWART.md`](./STEWART.md) | Stewart archetype — business-unit agents (Monitor → Recommend → Execute) |
| [`MASON.md`](./MASON.md) | Mason archetype — per-invocation craft specialists |
| [`VIRGIL.md`](./VIRGIL.md) | Virgil archetype — personal-OS agents |
| [`GENUS_MANIFEST.md`](./GENUS_MANIFEST.md) | The manifest contract every Genus-conformant agent declares |

## Reading order

- **An operator** (deploying agents to run a business): read `GENUS_SPEC.md` then the archetype most relevant to your first agent.
- **An agent builder**: read everything, then study `GENUS_MANIFEST.md` — that's the contract your agent declares.
- **A runtime integrator**: read the *Runtime adapters* section in `GENUS_SPEC.md` + `GENUS_MANIFEST.md` — that's what your runtime must honor for Genus governance to work.

## Status

**Genus v0.3** — public specification. Phase B retrofitted three reference agents (a Stewart instance, a Virgil instance, a Designer Mason) and folded the findings into the spec.

Companion open-source agents:

- [Tij8i/virgil](https://github.com/Tij8i/virgil) — reference Virgil agent (personal-OS, runs in Claude Code)
- [Tij8i/Stewart](https://github.com/Tij8i/Stewart) — Stewart starter (planned migration into `agent-families/stewart/` inside this repo)

## Runtime support (v0.3)

Genus v0.1+ commits to **one runtime**: Claude Code. All other runtimes (n8n, LangGraph, CrewAI, OpenAI Agents SDK, Make, Zapier, custom code) are documented as *future, adopter-pull* in `GENUS_SPEC.md` § Runtime adapters. No speculative adapter work — the spec is pressure-tested under one runtime first, multi-runtime support comes after.

## License

MIT — see [LICENSE](./LICENSE).

## About Sensible Flow

[Sensible Flow](https://sensible-flow.com) is the implementation agency that designs, builds, and operates Genus ecosystems for entrepreneurs and organizations. Genus itself is open-source and free; Sensible Flow is the commercial vehicle that helps you put it to work — readiness audits, operating-model design, implementation sprints, managed operations, fractional AI COO.
