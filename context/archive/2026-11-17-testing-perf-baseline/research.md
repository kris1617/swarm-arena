---
date: 2026-11-17T01:36:13+01:00
researcher: Claude Sonnet 5
git_commit: 2d9b2434609e30784fdb97d6433e65dbbacc7b45
branch: master
repository: swarm-arena
topic: "Rollout Phase 8 — reproducible performance baseline (Risk #8, related #7/#9)"
tags: [research, codebase, performance, benchmark, boids, simulation]
status: complete
last_updated: 2026-11-17
last_updated_by: Claude Sonnet 5
---

# Research: Reproducible performance baseline

**Date**: 2026-11-17T01:36:13+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 2d9b2434609e30784fdb97d6433e65dbbacc7b45
**Branch**: master
**Repository**: swarm-arena

## Research Question

Ground rollout Phase 8 of `context/foundation/test-plan.md`: how should a
reproducible, regression-tracked wall-clock performance baseline (Risk #8)
be built, given what already exists in this codebase for performance
measurement and simulation-tick execution?

## Summary

**`computeSingleRunTick`** (`single-run-lifecycle.ts`) is a pure, synchronous
function with no DB/network/async dependency — directly callable in a plain
loop with zero test framework, zero DB, zero tRPC. Production's own
per-tick cost (`server-run-registry.ts`'s `tick()`) is this same function's
cost plus a handful of property reassignments; DB writes happen only at
`shouldStop`/error milestones, not every tick — so benchmarking
`computeSingleRunTick` directly reflects real production per-tick cost.

**`scripts/corpus/harness.ts` is the wrong tool to extend.** It is a
DB/tRPC-backed fixture generator with heavy admin-settings-widening,
ownership, and mutex machinery built for correctness/corpus fixtures — it
never drives ticks itself (that happens inside the real server's own
`setInterval`-driven loop) and its one `vi.advanceTimersByTimeAsync(500)`
call only flushes tRPC's artificial timing middleware, not simulation ticks.
A perf benchmark should bypass it entirely.

**The right pattern already exists**: `src/server/simulation/pipeline-perf.test.ts`
already builds populations via `createInitialPopulation`/`createInitialPredators`
(`boids.ts`) directly — no router, no DB, no registry — then calls
`runTick` in a loop. This is the correct construction pattern for a
benchmark's fixtures. However, that existing test is **explicitly not a
wall-clock benchmark** — its own comment states wall-clock timing "would be
flaky" in a CI unit test, so it measures `Math.hypot` call-count as a
structural proxy instead. The new benchmark must be a **separate,
non-CI-gating** artifact (matching test-plan.md's own `benchmark
(non-CI-gating)` classification for Phase 8), not a modification of that
existing structural guard.

**No existing benchmark tooling exists in this repo**: no `tinybench`,
`mitata`, or `benchmark` package; no `tsx`-runner convention (the one
standalone non-test script, `scripts/patch-next-forwarded-host.mjs`, is
plain `.mjs` run via `node` directly). All three prior one-off performance
measurements (`vps-resource-capacity-limits`, `spatial-hash-performance-optimization`,
`configurable-area-and-camera-view`) used manual, scratch, throwaway
scripts or temporary code patches — none of that tooling survives in the
repo today, confirming Risk #8's core claim that no repeatable mechanism
exists. The one committed-results precedent is `context/foundation/capacity-limits.md`
(a markdown prose/table of the one-time measured curve) — a reasonable
model for where a new, regularly-updated baseline file could live, though
it currently holds a one-time snapshot, not a repeatable benchmark's output.

## Detailed Findings

### computeSingleRunTick — the correct benchmark target

- `single-run-lifecycle.ts:23-94`: signature `computeSingleRunTick(state, timestamp: number, params)`, returns the same-shaped state plus `shouldStop`/`populationCapped`/`hasWarnedDenseClustering`. Imports only from `~/server/simulation/boids` (`single-run-lifecycle.ts:1-11`) — confirmed via grep: no `async` keyword anywhere in this file.
- `server-run-registry.ts:445-529` (`tick()`): calls `computeSingleRunTick` once per tick (`:452-484`), then only reassigns local fields (`:486-498`) — no DB call on a normal tick. DB writes happen only at two milestones: `shouldStop` (`:508`, via `finishRun` → `db.update` at `:419-427`) or a thrown error (`:527`). Production ticks are driven by `setInterval(() => tick(params.runId), TICK_INTERVAL_MS)`, `TICK_INTERVAL_MS = 16` (`:27`, `:592`).
- `createInitialPopulation`/`createInitialPredators` (`boids.ts:322-364`, `:371+`) are directly importable, pure, synchronous population-construction helpers — `pipeline-perf.test.ts` already uses them with zero router/DB/registry involvement.

### scripts/corpus/harness.ts — not the right extension point

- Full file read (331 lines). Exports `ensureAdminRangesAdmit`, `ensureAdminRangesAdmitForBatch`, `withAdminRangesLock`, `startCorpusRun`, `collectAndCleanupCorpusRun`.
- `startCorpusRun` (`:226-290`) goes through a real `createCaller` tRPC router call against a real DB; admin-settings-range widening/restoring (`:87-165`) plus an async mutex (`:177-191`) exist specifically to let out-of-range sweep params through safely under concurrent callers — overhead a perf benchmark doesn't need and shouldn't carry.
- The actual tick-advancement happens inside the real server's own tick loop (`server-run-registry.ts`), not in this harness file; its one `vi.advanceTimersByTimeAsync(500)` call (`:215-220`) only flushes tRPC's timing middleware delay, not simulation ticks.

### pipeline-perf.test.ts — the construction pattern, not the timing mechanism

- Full file read. `buildState(boidCount, predatorCount)` helper builds populations via `createInitialPopulation(boidCount, createRng(1), 100, 1, [WEIGHTS], WORLD_SIZE)` and `createInitialPredators(...)`. `WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 }`, `WORLD_SIZE = { x: 200, y: 200, z: 200 }`. `BASE_PARAMS` includes `dtSeconds: 0.01, foodRegenRate: 10, protectionThreshold: 0, rng: createRng(99), crossbreedingEnabled: true, energyThreshold: 50, mutationChance: 0.1, mutationMagnitude: 0.2, populationCap: 500, foodStockInitial: 1000, worldSize: WORLD_SIZE`.
- Samples 40 boids/10 predators vs. 160/40 (4x scale, 4:1 ratio), spies on `Math.hypot` call count (not wall-clock), asserts ratio in `[10, 22]` (lines 80-106).
- Line 61 (quoted): a direct proxy for total operation count "without timing wall-clock, which would be flaky" — this file is explicitly designed to avoid the exact measurement this rollout phase needs, by design, not oversight. It must not be repurposed or weakened; the new benchmark is additive and separate.

### scripts/corpus/harness.test.ts — one data point on tick-count-at-scale

- Contains a comment (near the "widens maxDurationSeconds to 3600" test) stating a ~225,000-tick run "did not finish inside a 2-minute timeout" at `TICK_INTERVAL_MS=16` — direct evidence that per-tick cost compounds meaningfully at scale, useful context for choosing benchmark tick-count budgets (keep sample runs well below this order of magnitude).
- `VALID_START_INPUT` fixture (`:17-33`): `boidCount: 10, separationWeight: 1, alignmentWeight: 1, cohesionWeight: 1, maxDurationSeconds: 1, predatorCount: 2, protectionThreshold: 3, foodStockInitial: 100, foodRegenRate: 1, flockCount: 2, crossbreedingEnabled: true, energyThreshold: 50, mutationChance: 0.1, mutationMagnitude: 0.2, xyArea: 200, zDepth: 200`.

### Prior one-off measurements — confirms Risk #8, no surviving tooling

None of the three archived changes has a `research.md` (confirmed via `find` — only `plan.md`/`change.md`/`plan-brief.md`/`reviews/` exist in each):

- `vps-resource-capacity-limits/plan.md:9-13`: "direct benchmarking of `runTick`... same inputs `pipeline-perf.test.ts` already uses" — one-off, not committed as a script. Results table persisted to `context/foundation/capacity-limits.md:16-23`.
- `spatial-hash-performance-optimization/plan.md:7,107`: "confirmed by direct benchmarking across cell sizes and population sizes 100-500"; line 107 describes "a scratch script to diff outputs during development" — not landed.
- `configurable-area-and-camera-view/plan.md:15`: "direct benchmarking this session, by temporarily patching `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` and restoring immediately after" — same throwaway pattern.

No script or tool from any of these three changes still exists in the repo. All three are one-off, manual, temporary — exactly the gap Risk #8 names.

### No existing benchmark tooling or committed-benchmark-data convention

- `package.json` (full read): no `bench`/`benchmark` script; no `tinybench`/`mitata`/`benchmark` package in dependencies or devDependencies.
- No `tsx` dependency anywhere. The only standalone non-test script, `scripts/patch-next-forwarded-host.mjs`, is plain `.mjs` run via `node` directly. `scripts/corpus/generate-sweep.ts` is itself Vitest-driven (`"corpus:generate": "vitest run --config vitest.corpus.config.ts --testTimeout=14400000"`, `package.json:11`), not a bare Node entry point.
- Grep for `performance.now|Date.now|console.time|benchmark|perf-budget` across `src/` and `scripts/` found no existing wall-clock benchmark tooling — only incidental, unrelated matches (auth timing, trpc's own timing middleware, test timestamps).
- `context/foundation/capacity-limits.md` is a precedent for committing **measured results as markdown prose/tables**, not raw/structured data or a measuring script. `context/fixtures/parameter-sweep-corpus/` (CSV index + gzipped JSON) is a precedent for committed structured data, but for correctness fixtures, not performance measurements. **No precedent exists for a committed benchmark-results file tracking ms/tick over time or across parameter sweeps** — this would be a new pattern for the repo.

## Code References

- `src/server/simulation/single-run-lifecycle.ts:23-94` — `computeSingleRunTick`, pure/synchronous
- `src/server/simulation/server-run-registry.ts:445-529` — `tick()`, confirms DB-only-at-milestone cost model
- `src/server/simulation/server-run-registry.ts:27,592` — `TICK_INTERVAL_MS = 16`, `setInterval` tick driver
- `src/server/simulation/boids.ts:322-364,371+` — `createInitialPopulation`/`createInitialPredators`
- `src/server/simulation/pipeline-perf.test.ts` (full file, esp. line 61 comment, lines 80-106) — existing structural guard, explicitly not wall-clock
- `scripts/corpus/harness.ts` (full file, esp. `:226-290`, `:177-191`) — wrong extension point
- `scripts/corpus/harness.test.ts` (225k-tick timeout comment, `:17-33` fixture) — scale reference
- `context/foundation/capacity-limits.md:16-23` — prior one-time measured curve, committed as prose/table
- `package.json:6-17` (scripts), `:19-50` (deps) — no benchmark tooling present

## Architecture Insights

This project consistently separates CI-safe, deterministic structural guards (the `Math.hypot` call-count proxy in `pipeline-perf.test.ts`) from genuine wall-clock measurement, which every prior instance of this project treated as inherently manual/ad hoc and explicitly non-CI-gating. The new benchmark should continue that separation rather than blur it — a new, standalone artifact, not a modification of the existing structural test.

## Historical Context (from prior changes)

- `context/archive/2026-11-15-vps-resource-capacity-limits/` — the only prior change with its curve committed anywhere durable (`capacity-limits.md`), but as a one-time snapshot at `area=200`, not a repeatable benchmark.
- `context/archive/2026-11-15-configurable-area-and-camera-view/` — confirmed only the *direction* (bigger area → lower cost at fixed population) at `area=400`; never an exact curve at the new max `area=1000`.
- `context/archive/2026-11-15-spatial-hash-performance-optimization/` — the one prior case where structural big-O (fewer calls) and real wall-clock cost **diverged** (a slower wall-clock despite better big-O for one specific consumer) — the strongest evidence that a wall-clock-blind guard alone is insufficient, and the original motivation test-plan.md's Risk #7/#8 both cite.

## Related Research

- `context/foundation/test-plan.md` §2 Risk Map (#7, #8, #9) and Risk Response Guidance — this research grounds Risk #8's response guidance directly.

## Open Questions

- None blocking. `/10x-plan` can sequence a benchmark script (plain Node/`.mjs` or `.ts` run via `node --experimental-strip-types` or similar, calling `computeSingleRunTick` directly — no new dependency strictly required, though adding a minimal timing library like `tinybench` is a legitimate design option for `/10x-plan` to weigh) and a results-tracking file format directly from this document without further investigation.
