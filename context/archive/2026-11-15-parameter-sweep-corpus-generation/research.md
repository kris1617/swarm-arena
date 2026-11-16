---
date: 2026-11-15T22:33:22Z
researcher: Claude Sonnet 5
git_commit: 4ad0a446512a8b36ff089687bb6ee52feeb941aa
branch: master
repository: swarm-arena
topic: "How to generate and export the ~20-run structured parameter-sweep corpus (S-33), given F-08's harness, the 60-simulated-minute-per-run / up-to-4-parallel requirement, and the shared-adminSettings race F-08's impl-review flagged"
tags: [research, codebase, simulation, corpus-generation, performance, concurrency]
status: complete
last_updated: 2026-11-15
last_updated_by: Claude Sonnet 5
---

# Research: Parameter-sweep corpus generation (S-33)

**Date**: 2026-11-15T22:33:22Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 4ad0a446512a8b36ff089687bb6ee52feeb941aa
**Branch**: master
**Repository**: swarm-arena

## Research Question

S-33 must generate and export a ~20-run structured parameter-sweep corpus (varying flocking weights, food regen rate, and crossbreeding), up to 4 runs ticking concurrently at a time, each capped at 60 simulated minutes (3600s), using F-08's harness (`scripts/corpus/harness.ts`), to a reusable JSON/CSV fixture file. Three open questions block planning:

1. Is a full 3600s/225,000-tick run actually tractable to generate, given F-08's own impl-review flagged `single-run-lifecycle.ts`'s per-tick array rebuilds as a performance risk?
2. How should concurrent `startCorpusRun` calls avoid the shared-`adminSettings`-row race F-08's impl-review (finding F3) explicitly deferred to this slice?
3. What parameter matrix, phase-targeting logic, and export format should the corpus use, and is any of this already decided or built?

## Summary

**(1) Performance is a real blocker, not a theoretical one.** `single-run-lifecycle.ts` rebuilds six per-tick arrays via full-array spread every tick, with no bound or ring buffer — confirmed at `src/server/simulation/single-run-lifecycle.ts:124-165`. At `TICK_INTERVAL_MS = 16` (`src/server/simulation/server-run-registry.ts:27`), a 3600s run is 225,000 ticks, and F-08's own harness test (`scripts/corpus/harness.test.ts:174-183`) records that 225,000 ticks "did not finish inside a 2-minute timeout" under this exact O(n²) cost — this phase's plan must either fix the array-growth pattern or find another way to make a full-duration run tractable at the ~20-run scale this slice needs. This is a genuine decision for `/10x-plan`'s interview, not something research can resolve unilaterally.

**(2) The concurrency race is real but has a clean fix.** Confirmed at `server-run-registry.ts:519-581,735-737` and `server-run-registry.test.ts:904-947`: Vitest's fake clock is global, so one `vi.advanceTimersByTimeAsync(ms)` call ticks every currently-registered run together — "up to 4 parallel" is naturally free once 4 runs are registered. The per-user object-count caps (`simulation.ts:125-155,182-222`) are scoped by `userId`, and since `startCorpusRun` already mints a fresh fixture user per call, concurrent runs never collide there. The one real hazard is the shared `adminSettings.parameterRanges` singleton row `ensureAdminRangesAdmit` widens/restores per call (`scripts/corpus/harness.ts:87-119,154-189`) — confirmed by F-08's own Risk Notes and impl-review F3 to race under concurrent calls (A restores to A's pre-widen snapshot, clobbering B's still-in-flight wider range). The cleanest fix, fitting this harness's own "generic coercion" convention, is widening once up front to the union of the whole batch's ranged-param values before starting any run in it, then restoring once after all are started — not a per-call widen/restore for each of the (up to) 4 concurrent starts.

**(3) The parameter matrix and phase-targeting hooks already exist in the engine; the export format does not exist anywhere yet.** `DEFAULT_PARAMETER_RANGES` (`parameter-ranges.ts:35-67`) gives concrete min/max/default for all 16 ranged fields. The five-phase classification (`"establishment"|"growth"|"overshoot"|"crash"|"recovery"`, `boids.ts:1286-1403`) is exactly the vocabulary the roadmap's "healthy-growth/crash/overshoot-recovery" language refers to, and is driven by population trend + food-availability ratio over a 20-tick window — useful for deliberately engineering sweep combinations that land in each named phase. FR-015's cross-run suggestion heuristic (`parameter-suggestion.ts:107-160`) needs ≥3 runs with actual variance in a given field and ≥5 for "high" confidence — this bounds how many sweep points per varied field S-34 will need later. No fixture-export code (JSON/CSV writer, `context/fixtures/`, or any `package.json` script) exists anywhere in the repo — this part is genuinely greenfield; `CorpusRunRecord` (`harness.ts:44-57`) is the closest existing precedent for a per-run record shape, and the only prior export-shape convention in the project is FR-017's flat CSV (params + score, no nested history) for a single run's own download, not a multi-run corpus.

## Detailed Findings

### Per-tick array growth (performance)

- `single-run-lifecycle.ts:124-165` rebuilds six arrays every tick via `[...array, next]`, none bounded: `cohesionSamples` (124-127), `foodRatioSamples` (128-131), `populationCountSamples` (132-135), `populationDensitySamples` (143-146), `geneticDiversitySamples` (150-153), `phaseHistory` (165).
- `phaseHistoryWindow` (154-160) additionally `.map`s over the full, already-grown `nextPopulationCountSamples`/`nextFoodRatioSamples` every tick to feed `classifyPopulationPhase` — a second O(current length) cost layered on the same per-tick call.
- Total cost for a run of N ticks is therefore O(N²), not O(N). `TICK_INTERVAL_MS = 16` (`server-run-registry.ts:27`, used at lines 579 and 735's `setInterval`).
- For `maxDurationSeconds: 3600`: `3600 / 0.016 = 225,000` ticks.
- `scripts/corpus/harness.test.ts:174-183` records, from direct prior investigation while building F-08: "a run of even a few thousand ticks already takes real seconds, and 225,000 ticks did not finish inside a 2-minute timeout." No test anywhere in the repo exceeds `maxDurationSeconds: 600` (37,500 ticks) while actually ticking to completion; `server-run-registry.test.ts` tops out at 600s, and F-08's own 3600s test only *starts* the run (to prove the admin-range-widen path reaches the real `startServer` gate) then calls `stopServerRun` immediately rather than ticking to natural completion.
- No fix exists yet anywhere in the codebase for this O(n²) pattern (no `.slice(-N)`, ring buffer, or similar bound on any of the six arrays).

### Concurrent-run ticking mechanics

- `server-run-registry.ts` keeps one module-level `Map<number, LiveRun>` (`registry`, 119-127, cached on `globalThis` to survive HMR). Each run gets its own `setInterval(() => tick(params.runId), TICK_INTERVAL_MS)` (started at 579, resumed at 735); `stopServerRun`/snapshot paths `clearInterval` (405, 650).
- Because all registered runs share Vitest's one global fake clock, a single `vi.advanceTimersByTimeAsync(ms)` call fires every currently-registered run's interval together — confirmed directly by `server-run-registry.test.ts:904-947`, which starts run A, advances time with only A registered, then starts run B and issues one `advanceTimersByTimeAsync(160)` that ticks both A and B in lockstep (including correctly through a snapshot/resume round-trip). No test registers more than 2 runs concurrently, but the mechanism (one global clock, N independent intervals) has no special-casing by run count, so it generalizes to 4 without new code.
- Per-user object-count caps are unaffected by concurrency across different fixture users: `assertWithinConcurrentObjectCeiling` (`simulation.ts:125-155`) and `checkConcurrentObjectCapSoft` (182-222) both filter by `eq(simulationRuns.userId, userId)` (141, 198); `checkAgainstAdminRanges` (224-248) checks only the single input's own `boidCount + predatorCount`, no cross-run query at all. Since `startCorpusRun` mints one fresh fixture user per call, concurrent harness calls never share a `userId` and never interact via these caps.

### The `adminSettings` race (confirmed, not yet fixed)

- `ensureAdminRangesAdmit` (`harness.ts:87-119`) reads the singleton `adminSettings` row (id=1), generically widens every `RangedParameterName` present in the caller's params (min floored down, max raised up — never narrows), writes it back, and returns the pre-widen snapshot.
- `startCorpusRun` (`harness.ts:154-189`) calls this, runs `startServer`, and in a `finally` restores the row to **the snapshot it personally captured before its own widen** — regardless of what any concurrently-running call may have since written.
- Race (documented in the archived F-08 plan's Risk Notes and impl-review finding F3, already read and incorporated into F-08's plan before this research): call A widens; call B widens further (on top of A's write); A's `startServer` succeeds; A's `finally` restores to A's own pre-widen snapshot, clobbering B's wider range mid-flight; B's `startServer` then either spuriously rejects (range too narrow again) or starts with an unintended narrower range than B actually asked for. No mutex or serialization exists anywhere in `harness.ts`. This is expected: F-08's plan explicitly scoped the batch/concurrency problem out, naming it as this slice's job.
- Two structurally different fixes are available, with no existing code implementing either yet:
  - **Union-widen-once**: before starting any run in a batch, fold every planned run's ranged-param values together (same per-field min/max logic `ensureAdminRangesAdmit` already does, just over N param sets instead of 1), widen once, start all N runs, restore once at the end. Preserves full start-time parallelism and reuses the existing generic-coercion convention without adding new concurrency-control code — the batch's parameter sets must be known before any run starts (true here, since the sweep matrix is planned up front).
  - **Serialize the widen→start window**: gate `startCorpusRun`'s widen+start step behind a mutex/queue so only one call is mid-widen at a time; once a run is registered, its ticking is fully concurrent with the others regardless. Needs no change to `ensureAdminRangesAdmit`'s existing per-call semantics, only an ordering gate, at the cost of serializing (cheap) start calls.

### Parameter matrix inputs

- `DEFAULT_PARAMETER_RANGES` (`parameter-ranges.ts:35-67`), all 16 `RANGED_PARAMETER_NAMES` fields as `{min, max, default}`: `boidCount` {1,500,100}; `separationWeight` {0,10,1}; `alignmentWeight` {0,10,1}; `cohesionWeight` {0,10,1}; `maxDurationSeconds` {1,600,30}; `predatorCount` {0,500,5}; `protectionThreshold` {0,500,10}; `foodStockInitial` {0.1,10000,100}; `foodRegenRate` {0,1000,10}; `flockCount` {2,4,2}; `crossbreedingEnabled` {0,1,1} (boolean-as-numeric); `energyThreshold` {0.1,500,50}; `mutationChance` {0,1,0.1}; `mutationMagnitude` {0,1,0.2}; `xyArea` {200,1000,200}; `zDepth` {200,1000,200}.
- Phase classification (`boids.ts:1286-1403`): `PopulationPhase = "establishment"|"growth"|"overshoot"|"crash"|"recovery"`, computed by `classifyPopulationPhase` over a 20-tick rolling window (`PHASE_WINDOW_SIZE`) using population trend + a 0.3 food-availability-ratio threshold and a -10% crash threshold; quality-weighted via `PHASE_QUALITY_WEIGHTS` (establishment 0.5, growth 1.0, overshoot 0.7, crash 0.2, recovery 0.9) plus a crash→recovery resilience bonus (`computePhaseQuality`, 1360-1403). This is the exact vocabulary the roadmap's "healthy-growth/crash/overshoot-recovery" sweep-targeting language refers to, and gives concrete signal thresholds (food ratio, population trend %) to reason about which parameter combinations should land in each phase.
- FR-015's cross-run suggestion heuristic (`src/server/simulation/parameter-suggestion.ts:107-160`, PRD `prd.md:152-153`): `suggestParameterChange(rows)` needs `rows.length >= 3` (`MIN_SAMPLE_SIZE`), skips any param with zero variance across rows, picks the param with max `|Pearson correlation|` against score; confidence is `high` only at `|r|>=0.7 && sampleSize>=5`. This is a downstream (S-34) consumer, not this phase's concern, but it bounds how many distinct values per varied field the sweep should include if S-34 is to exercise "high confidence" at all.

### Export format and prior art

- No fixture-export code exists anywhere in the repo: no `context/fixtures/` directory, no checked-in JSON/CSV fixture data files, no `package.json` script named anything like "generate"/"export"/"corpus"/"fixture" (only `build`/`check`/`db:*`/`dev`/`preview`/`start`/`test`/`typecheck`). This part of the design is genuinely greenfield.
- `CorpusRunRecord` (`harness.ts:44-57`) — `{ params: {boidCount, predatorCount, foodStockInitial, foodRegenRate, protectionThreshold}, score, history, completedCycles, finalGeneticDiversity, runOptimizationSuggestion }` — is the closest existing precedent for a per-run record shape; it's a strict subset of what `getRunAnalysis` returns and is already what F-08's harness hands back per run.
- The only prior export-shape convention in this project is FR-017 (`prd.md:156-157`), a flat per-run CSV download (params + score, no nested history/survivorGenes) — a single-run, not multi-run, precedent, and it deliberately excludes the nested data a corpus almost certainly needs to keep (full `history`, `phaseHistory`, etc., for S-34/S-35's later use).
- Roadmap M-8 (`roadmap.md` milestone section, ~line 23-34) and S-33's own row say the corpus must be "an exported JSON/CSV fixture file (not live DB rows)... so it survives a DB reset," varying "flocking weights, food regen rate, and crossbreeding... deliberately targeting healthy-growth/crash/overshoot-recovery phases, not random sampling" — but neither source pins down one-file-vs-one-per-run or an exact JSON schema. That remains an open design choice for `/10x-plan`.

## Code References

- `src/server/simulation/single-run-lifecycle.ts:124-165` — six unbounded per-tick array rebuilds (the O(n²) cost)
- `src/server/simulation/server-run-registry.ts:27` — `TICK_INTERVAL_MS = 16`
- `src/server/simulation/server-run-registry.ts:519-581,735-737` — per-run `setInterval` registration (start/resume)
- `src/server/simulation/server-run-registry.test.ts:904-947` — proof that one fake-timer advance ticks multiple concurrently-registered runs together
- `src/server/api/routers/simulation.ts:125-155,182-222,224-248` — per-`userId` object-count caps, isolated across fixture users
- `scripts/corpus/harness.ts:87-119,154-189` — `ensureAdminRangesAdmit`/`startCorpusRun`, including the per-call restore that races under concurrency
- `scripts/corpus/harness.ts:44-57` — `CorpusRunRecord`, the closest existing per-run export-record precedent
- `scripts/corpus/harness.test.ts:174-183` — direct evidence that 225,000 ticks did not finish inside a 2-minute timeout
- `src/server/simulation/parameter-ranges.ts:35-67` — `DEFAULT_PARAMETER_RANGES`, all 16 fields
- `src/server/simulation/boids.ts:1286-1403` — `PopulationPhase` enum, `classifyPopulationPhase`, `PHASE_QUALITY_WEIGHTS`, `computePhaseQuality`
- `src/server/simulation/parameter-suggestion.ts:107-160` — FR-015's `suggestParameterChange` (downstream S-34 consumer)
- `context/foundation/prd.md:152-153,156-157,229-237` — FR-015, FR-017, FR-019 text

## Architecture Insights

- This codebase's established convention for admin-range handling is "generic coercion over whatever fields are present" (seen in `updateRunParams` and reused verbatim in `ensureAdminRangesAdmit`) — any batching fix for the concurrency race should extend this same per-field fold rather than introduce field-specific branching or an unrelated locking primitive.
- Vitest's fake-timer clock is a single global resource per test file; this project has no per-run timer isolation anywhere, so "4 runs ticking in parallel" is already free once 4 runs are registered — the real design work for "parallel" batching is entirely about the shared `adminSettings` row, not about timer mechanics.
- The O(n²) tick-cost issue is the dominant open risk for this slice: it was identified during F-08, explicitly deferred as out of F-08's scope, and this research confirms no fix exists yet. Planning for S-33 cannot assume full-duration (3600s) runs are cheap to generate as currently written.

## Historical Context (from prior changes)

- `context/archive/2026-11-15-corpus-generation-harness/plan.md` (Risk Notes, Performance Considerations) — first documented the O(n²) cost and the admin-range race, both explicitly scoped out of F-08 and handed to this slice.
- `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md` (finding F3) — the concurrency race, accepted-not-fixed at F-08 time, with the same union-widen-once fix already proposed there as "Fix A ⭐ Recommended."
- `context/archive/2026-11-15-area-aware-population-insight/` and `context/archive/2026-11-15-spatial-hash-performance-optimization/` — prior examples in this project of performance claims being settled by direct measurement rather than assumption (per `context/foundation/lessons.md`'s recorded pattern); the same discipline applies here: the O(n²) claim in this research is grounded in an actual observed 2-minute-timeout failure, not a theoretical worst case.

## Related Research

- None — this is the first research document for this change.

## Open Questions

- **Performance fix scope** (blocks planning): should S-33's plan include fixing `single-run-lifecycle.ts`'s six unbounded per-tick arrays (e.g. converting to a bounded/ring-buffer or mutate-in-place growth) as a prerequisite phase, or should the corpus instead avoid full 3600s natural-completion ticking some other way (e.g. generating at an accelerated/sampled fidelity, or accepting a long one-time generation run outside the normal test-timeout constraints)? This is a genuine product/engineering tradeoff for `/10x-plan`'s interview, not something this research resolves.
- **Export file shape**: one JSON file holding an array of per-run records, vs. one file per run — and whether CSV is also required per the roadmap's "JSON/CSV" phrasing, or whether JSON alone satisfies it (S-34/S-35 are the actual downstream consumers and haven't been planned yet, so their exact read-shape needs aren't fixed).
- **Exact sweep matrix**: how many distinct values per varied field (separation/alignment/cohesion weight, food regen rate, crossbreeding on/off) combine into ~20 runs, and which specific combinations are expected to land in each of the five phases — this needs a concrete proposal in `/10x-plan`, grounded in `classifyPopulationPhase`'s actual thresholds documented above.
