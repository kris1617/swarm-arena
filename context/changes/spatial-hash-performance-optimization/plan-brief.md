# Spatial-Hash Performance Optimization — Plan Brief

> Full plan: `context/changes/spatial-hash-performance-optimization/plan.md`

## What & Why

Roadmap S-23 / PRD FR-029: boid/predator flocking-force neighbor lookups use spatial partitioning (grid-based) instead of a full O(N²) pairwise scan, cutting per-tick complexity to O(N) — with a hard, non-negotiable constraint: must produce byte-for-byte identical output to the pairwise version for the same seed/parameters. Any deviation is a bug, not an accepted tradeoff.

## Starting Point

`src/server/simulation/boids.ts` has five O(N²)/O(N·M) pairwise scans today. A proven prior implementation of this exact technique exists in this project owner's own earlier LÖVE2D/Lua boids simulator (`/mnt/Kids/boids_final/game/`) — but that world is bounded, not toroidal, so its grid never had to handle wrap-around, which this codebase's `wrap()`/`wrappedDelta()` depend on everywhere.

## Desired End State

`stepBoids` (both its boid-boid and boid-vs-predator loops), `applyPredation`, and `reproducePopulation`'s mate scan all use a shared, wrap-aware spatial-hash grid. Verified via a dedicated before/after determinism test suite — not just "it still runs."

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Scope | Broaden beyond FR-029's literal "separation/alignment/cohesion" wording to also cover `applyPredation` and `reproducePopulation`'s mate scan | User chose the broader option after reviewing the tradeoff (more real-world speedup vs. more surface area to verify) | User (AskUserQuestion) |
| `resolveOverlaps` | Excluded — left as plain pairwise O(N²) | It mutates positions mid-scan; a snapshot grid could use stale positions and silently diverge from the pairwise version in a worst case, violating the hard "identical behavior" constraint | Plan (discovered during planning, not part of the original scope question — see plan body) |
| `stepPredators`' unbounded search | Excluded, unchanged | FR-029's text is scoped to bounded-radius flocking queries; an unbounded nearest-neighbor search needs a materially different algorithm (expanding-ring search), which neither this codebase nor the Lua reference has precedent for | Plan |
| Grid query contract | Always returns candidate indices deduplicated and sorted ascending | This single invariant is what makes `reproducePopulation`'s first-match-by-index rule safe to grid-optimize, without a per-call-site special case | Plan |
| Cell size | One shared cell size per grid, sized to the largest radius queried against it (matches the Lua reference's own convention) | Simpler than per-query cell sizing; the Lua precedent already validates this tradeoff | Plan |
| `stepBoids`' boid-boid loop, despite measuring ~2x slower | Grid-optimize it anyway | Measured directly: `NEIGHBOR_RADIUS=70` covers ~18% of this world's volume, so the grid can't narrow a candidate set that's already most of the population — a geometry fact, not a tuning miss. User chose implementation consistency over leaving this one function pairwise. | User (AskUserQuestion, after measurement) |

## Scope

**In scope:** a new `spatial-grid.ts` utility; grid-optimizing `stepBoids`' two loops, `applyPredation`, and `reproducePopulation`'s mate scan; a before/after determinism test suite; rewriting `pipeline-perf.test.ts`'s now-wrong quadratic-growth assertion.

**Out of scope:** `resolveOverlaps` (self-mutating relaxation pass — see Key Decisions), `stepPredators`' unbounded search, any change to force-calculation math, any new user-facing parameter, any UI change (this is a pure backend/engine change).

## Architecture / Approach

One shared wrap-aware uniform grid utility (ported-but-adapted from the Lua reference's cell-size/bucket-table/candidate-narrow-then-exact-filter pattern, with wrap-around cell iteration added since the Lua world never needed it). Applied in two phases, ordered by risk: order-independent consumers (sums, true-minimums) first, then the one order-dependent consumer (`reproducePopulation`'s first-match rule), so the grid utility itself is proven correct on the cheaper-to-verify cases before the trickier one depends on it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Spatial grid utility + stepBoids | The grid itself, wrap-aware; applied to stepBoids' two loops | Medium — new wrap-around cell-iteration logic is genuinely new code, not a direct port |
| 2. applyPredation + reproducePopulation + test reconciliation | Grid applied to the remaining two safe consumers; pipeline-perf.test.ts rewritten | Medium — reproducePopulation's first-match-by-index rule is the one place the grid's sort invariant is load-bearing, not incidental |

**Prerequisites:** none.
**Estimated effort:** ~1-2 sessions across 2 phases — this is the highest-risk change in the current roadmap batch (correctness/determinism-critical, not just additive).

## Open Risks & Assumptions

- `resolveOverlaps` remains O(N²) — a real, documented gap relative to FR-029's broader framing, not an oversight. Revisit only if profiling shows it's actually a bottleneck at realistic population caps (500).
- `stepBoids`' boid-boid loop is measurably slower with the grid than without it at this world's actual size/radius ratio — an accepted, explicit tradeoff (consistency over raw speed on this one function), not an unnoticed regression. Revisit if the world size or `NEIGHBOR_RADIUS` ever changes enough to shift the density regime.
- The exact post-optimization `pipeline-perf.test.ts` ratio band can't be specified until Phase 2 is actually implemented and measured — the plan requires empirical measurement, not a guessed number, before that test is rewritten.

## Success Criteria (Summary)

- `stepBoids`, `applyPredation`, and `reproducePopulation` all use the grid; `resolveOverlaps`/`stepPredators` are unchanged and the reasons are documented.
- All existing determinism/convergence tests in `boids.test.ts` pass unmodified.
- New targeted tests prove the grid preserves `applyPredation`'s true-nearest rule and `reproducePopulation`'s first-match-by-index rule under adversarial (multiple-candidate) scenarios.
- `pipeline-perf.test.ts` is rewritten around a measured, not guessed, new growth ratio.
