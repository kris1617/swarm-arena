# Sources: documents

- documents: 9 requirements/foundation, 67 narrative (1 active change + 65 archived + 1 toolkit README), 1 reference (README.md), 2 engineering-adjacent (AGENTS.md/CLAUDE.md, listed as reference per this skill's own carve-out since they describe business flows)

## Domain documents

| path | kind | what it is about |
|---|---|---|
| `context/foundation/prd.md` | requirements | the product requirements document: vision, persona, success criteria, non-goals, business logic, functional requirements |
| `context/foundation/roadmap.md` | requirements/narrative | milestone-sequenced slice decomposition of the PRD, with per-slice outcomes and status; also the most up-to-date running log of what shipped and why |
| `context/foundation/shape-notes.md` | requirements | pre-PRD discovery notes from the shaping conversation |
| `context/foundation/capacity-limits.md` | engineering | measured server capacity ceilings (object counts, concurrency) — not domain vocabulary, but names the "aggregate object count" concept |
| `context/foundation/test-plan.md` | engineering | risk-first test strategy; names risk scenarios in business terms |
| `context/foundation/lessons.md` | narrative | append-only register of recurring project rules/mistakes — some are domain-adjacent (e.g. color/genetics bugs) |
| `context/foundation/infrastructure.md`, `tech-stack.md`, `stack-assessment.md`, `test-stack.md`, `health-check.md` | engineering | stack/infra decisions — read for rules only, not vocabulary |
| `context/changes/sim-engine-feature-analysis/` (research.md) | narrative | the active 10xArchitect M4L3 feature-analysis artifact on the sim-engine capability |
| `context/archive/*/` (65 directories) | narrative | every completed change's change.md/research.md/plan.md/reviews — the richest source of "how the team actually talks about this," since each is a real decision record |
| `README.md` | reference | top-level repo README |
| `AGENTS.md`, `CLAUDE.md` | reference (agent instructions describing business flows) | repo-level conventions; `CLAUDE.md` also documents the 10xDevs toolkit skill chain, which is process, not product |

## Product goals

Quoted from `context/foundation/prd.md`:

- Vision (`prd.md:23`): "A hobbyist experimenting with swarm algorithms (boids + predator-prey dynamics) has no tool that lets them configure a simulation, score the outcome against explicit evaluation criteria, and compare variants side by side."
- Vision, continued (`prd.md:25`): "The gap isn't swarm simulation itself; it's turning trial-and-error tuning into a measurable, resumable experimentation loop, built as a learning exercise in both the domain (swarm behavior) and in agentic development."
- Primary success criterion (`prd.md:40`): "A logged-in user can start a boids+predator simulation, configure its parameters, watch it run, stop/save it, resume it later, and receive a score once it ends (automatically or by user stop)."
- Primary success criterion (`prd.md:41`): "A real (non-staging) simulation executes on the server, independent of any client connection, and keeps running if the browser tab closes; the user can view exactly one server-run simulation at a time, rendered live from server-pushed state."
- Primary success criterion (`prd.md:43`): "From a completed run, the user opens an analysis view — population-over-time chart, phase/cycle breakdown, final genetic-diversity value — to decide what to change in the next run."
- Secondary success criteria (`prd.md:47-54`): parameter-change suggestion heuristic, cross-run comparison, export, leaderboard, run-specific optimization suggestion, modern UI, reference pages, temporary admin elevation.
- Persona (`prd.md:28`): "the builder themselves — a self-learner experimenting with swarm/boids algorithms and predator-prey dynamics for personal exploration, not for an external audience... No secondary persona — single user, self-directed use."

## Change goals

Each of the 65 archived changes states its own narrower goal (e.g. "server-owned execution," "genetic inheritance and crossbreeding," "spatial-hash performance optimization"). These are change goals, not product goals — read by the code-rules/code-language agents only incidentally if they open a change folder for a specific term's history, not used here to judge the Core subdomain.

## Limitations

- The PRD is well-populated (not a hollow/TODO-riddled document) — this distillation can rest on genuine product vocabulary, not just code+README inference.
- 65 archived changes is a large narrative corpus; this inventory does not read every one — the docs-language and synthesis agents sample the ones most likely to carry vocabulary (PRD-adjacent, scoring-adjacent, genetics-adjacent) rather than exhaustively reading all 65.
