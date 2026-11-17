# Reproducible performance baseline — Implementation Plan

## Overview

Build a new, reproducible wall-clock benchmark measuring `computeSingleRunTick`'s
real per-tick cost across a grid of object counts, area sizes, and
single-process-interleaved concurrent-run counts, using `tinybench` for
proper sampling statistics. Results are tracked in a new committed JSON
file plus a markdown summary extending the existing `capacity-limits.md`
precedent. This is rollout Phase 8 of `context/foundation/test-plan.md` §3.

## Current State Analysis

- `computeSingleRunTick` (`single-run-lifecycle.ts:23-94`) is pure and
  synchronous — directly callable in a loop, no DB/async/router. Production's
  own per-tick cost (`server-run-registry.ts`'s `tick()`, `:445-529`) is this
  same function's cost plus a handful of property reassignments; DB writes
  happen only at `shouldStop`/error milestones, not every tick — so
  benchmarking this function directly reflects real production per-tick cost.
- `src/server/simulation/pipeline-perf.test.ts` already builds populations via
  `createInitialPopulation`/`createInitialPredators` (`boids.ts:322-364,371+`)
  directly, with no router/DB/registry — the correct construction pattern to
  reuse. That file is explicitly NOT a wall-clock benchmark (its own comment,
  line 61, calls wall-clock timing "flaky" for a CI unit test) and must stay
  untouched and separate from this new benchmark.
- No existing benchmark tooling exists in this repo: no `tinybench`/`mitata`/
  `benchmark` package, no `tsx`-runner convention. The one standalone
  non-test script precedent, `scripts/patch-next-forwarded-host.mjs`, is
  plain `.mjs` run via `node` directly.
- No precedent exists for committing benchmark-over-time results as
  structured data. `context/foundation/capacity-limits.md` is a precedent
  for committing measured results as markdown prose/tables (a one-time
  snapshot), the closest existing analog.
- Prior one-off measurements (archived `vps-resource-capacity-limits`,
  `spatial-hash-performance-optimization`, `configurable-area-and-camera-view`)
  used manual/scratch/temporary code, none of which survives in the repo —
  confirming Risk #8's core claim.
- `scripts/corpus/harness.ts` must NOT be extended for this purpose — it is a
  DB/tRPC/admin-settings-widening/mutex-laden fixture generator built for a
  different purpose (research.md, confirmed).

### Key Discoveries:

- `tinybench` v6.2.3 (verified via `npm view`/`npm pack`) supports an exact
  `iterations` option (default 64) alongside a `time` budget (default
  1000ms) — setting `iterations: 8` with a large `time` value gives exactly
  N=8 deterministic samples per configuration, not a time-boxed count.
- The prior one-time curve (`vps-resource-capacity-limits`) measured object
  counts up to 500 at `area=200`; `configurable-area-and-camera-view` only
  confirmed the *direction* of area's effect at `area=400`, never an exact
  curve at the new max `area=1000`. The grid below deliberately re-measures
  the known points (for old-vs-new comparability) plus the two genuinely new
  ones research flagged as never measured.

## Desired End State

A `npm run perf:baseline` command exists that runs a 54-configuration grid
(6 object counts × 3 area sizes × 3 concurrent-run counts) at N=8 samples
each, entirely single-process, and writes results to a committed,
append-only JSON file plus a markdown summary. A real first baseline run
has been executed and its results sanity-checked against the two known
directional facts from prior measurements (cost grows with object count;
cost is lower at larger area for a fixed count). Verify by: running
`npm run perf:baseline` and confirming both output files update with
plausible, monotonic-where-expected numbers.

## What We're NOT Doing

- Not driving real concurrent server-owned simulations via the actual
  `startServerRun`/registry/`setInterval` machinery for the concurrent-run
  grid dimension — that is Phase 9's job (a separate, later rollout phase
  specifically about proving no backlog/leak under genuine concurrent load).
  This phase's concurrent-run dimension is a single-process, round-robin
  interleaving of N independent `computeSingleRunTick` states, which is
  enough to measure shared-CPU cost scaling without pulling in Phase 9's
  heavier scope.
- Not making this benchmark CI-gating — it runs manually/on-demand, per
  `test-plan.md`'s own `benchmark (non-CI-gating)` classification for this
  risk, given wall-clock measurement is inherently noisy under CI's shared
  runners.
- Not modifying `pipeline-perf.test.ts` — it stays exactly as-is, a separate,
  deterministic, CI-safe structural guard.
- Not automating a pre-flight "no other npm test is running" check inside
  the benchmark script itself — cross-platform process detection from within
  a benchmark script is its own source of fragility for a non-CI-gating dev
  tool. Instead, the single-process precondition is documented (script
  comment + cookbook entry) as something the person running it confirms
  manually (e.g. `pgrep -af "vitest|npm test"` returns nothing), matching
  how this project already documents this discipline elsewhere (`lessons.md`).

## Implementation Approach

Phase 1 adds `tinybench` and the core benchmark script — population
construction via the existing `pipeline-perf.test.ts` pattern, tick-driving
via direct `computeSingleRunTick` calls, and the concurrent-run dimension as
single-process round-robin interleaving. Phase 2 adds the two output
artifacts (JSON + markdown) and the npm script. Phase 3 is the real proof
run plus documentation.

## Phase 1: tinybench dependency + core benchmark script

### Overview

Add `tinybench` and build the benchmark script that constructs the grid,
drives ticks, and collects per-configuration timing statistics.

### Changes Required:

#### 1. Add tinybench devDependency

**File**: `package.json`

**Intent**: Enable proper benchmark sampling statistics (mean, variance,
percentiles) instead of hand-rolling them.

**Contract**: Add `"tinybench": "^6.2.3"` (or the then-current 6.x) to
`devDependencies`.

#### 2. Benchmark script — grid construction and tick-driving

**File**: `scripts/perf-baseline.ts` (new)

**Intent**: For each of the 54 configurations (object count × area ×
concurrent-run count), construct the matching population(s) and run them
through `computeSingleRunTick` via `tinybench`, collecting per-config timing
stats at N=8 iterations.

**Contract**:
- Object counts: `[100, 200, 300, 400, 500, 1000]` (boid:predator ratio
  matching the existing `pipeline-perf.test.ts`/`vps-resource-capacity-limits`
  convention — confirm the exact ratio used there and reuse it, rather than
  inventing a new one).
- Area sizes: `[200, 400, 1000]` (re-measuring the two known points plus the
  new max).
- Concurrent-run counts: `[1, 2, 4]`.
- Population construction: `createInitialPopulation`/`createInitialPredators`
  (`boids.ts`), same pattern as `pipeline-perf.test.ts`'s `buildState` helper.
- Concurrent-run dimension: for a count of `N`, construct `N` independent
  simulation states (each its own population/params at the configured object
  count and area) and advance all `N` by one tick each, round-robin, for a
  fixed number of total ticks per sample — a single-process interleaving,
  never the real `setInterval`/registry scheduler.
- Per configuration: `new Bench({ iterations: 8, time: Number.POSITIVE_INFINITY })`
  (confirm against the installed `tinybench` version's actual default/type
  for an unbounded time budget — use whatever the library's own
  documented mechanism is for "iteration count is the only limit"), one
  `.add(...)` task running a fixed number of ticks across the `N`
  interleaved states, `await bench.run()`, read the resulting `Task`'s
  latency statistics from `bench.tasks`/`task.result`.
- Export a function returning the full grid's results (array of
  `{ objectCount, area, concurrentRuns, meanMs, stdDevMs, samples: 8 }` or
  similar) so Phase 2 can import it rather than this script doing its own
  file I/O directly — keep construction/measurement and output-writing
  separable.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None yet — a real run is Phase 3's job; this phase just needs the script
  to exist and typecheck.

---

## Phase 2: Results tracking + npm script

### Overview

Wire the benchmark's output into two committed artifacts and a discoverable
npm script.

### Changes Required:

#### 1. JSON results file

**File**: `context/foundation/perf-baseline.json` (new)

**Intent**: An append-only, structured record of every benchmark run, so
future runs can be compared against history programmatically.

**Contract**: An array; each entry has `{ date, gitCommit, nodeVersion,
results: [...grid rows from Phase 1...] }`. The benchmark script appends
one new entry per run — never overwrites prior entries.

#### 2. Markdown summary

**File**: `context/foundation/capacity-limits.md`

**Intent**: A human-readable summary of the latest run, extending this
file's existing precedent for committed perf prose/tables rather than
inventing an unrelated format.

**Contract**: A new section (e.g. "## Reproducible Benchmark Results") with
a table summarizing the latest run's key rows, plus a pointer to
`perf-baseline.json` for full historical data.

#### 3. npm script

**File**: `package.json`

**Intent**: Make the benchmark discoverable and runnable without memorizing
a raw `node`/`tsx` invocation.

**Contract**: Add `"perf:baseline": "<runner> scripts/perf-baseline.ts"` to
`scripts` (confirm the correct runner invocation given no `tsx` dependency
currently exists — either add `tsx` as a minimal additional devDependency
for ergonomic TS execution, or use Node's native TypeScript-stripping flag
if the project's installed Node version supports it; pick whichever needs
the smaller footprint and document the choice in the script's own header
comment).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None yet — Phase 3 runs the script for real.

---

## Phase 3: First real baseline run + cookbook update

### Overview

Run the benchmark for real, sanity-check the results, document the
single-process precondition, and close out this rollout phase.

### Changes Required:

#### 1. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Document how to run and extend this benchmark, so a future
session doesn't need to rediscover the grid/tooling/output-format decisions
made in this plan.

**Contract**: New `### 6.8 Adding/running a wall-clock performance
benchmark` subsection, following the existing `### 6.N` format (Location,
Pattern, Reference, Run command) — explicitly naming the single-process
precondition (confirm `pgrep -af "vitest|npm test"` is empty before running,
per `lessons.md`) and the Phase 8/Phase 9 scope boundary (this benchmark's
concurrent-run dimension is single-process-interleaved; real concurrent-load
testing is Phase 9's job).

#### 2. Mark rollout Phase 8 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Flip Phase 8's §3 Status cell to `complete` once this plan's
Progress is fully `[x]`.

**Contract**: Edit the `| 8 | Reproducible performance baseline | ... |`
row's Status cell.

### Success Criteria:

#### Automated Verification:

- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- Confirm single-process (`pgrep -af "vitest|npm test"` returns nothing),
  then run `npm run perf:baseline` once for real.
- Confirm `context/foundation/perf-baseline.json` gained one new entry with
  all 54 grid rows, and `context/foundation/capacity-limits.md` gained a
  matching summary section.
- Sanity-check the results against the two known directional facts: cost
  increases with object count at a fixed area; cost is lower at a larger
  area for a fixed object count (matching `configurable-area-and-camera-view`'s
  confirmed direction at area=400).

---

## Testing Strategy

### Unit Tests:

- None — this is benchmark tooling, not application code with its own unit
  tests. `npm run typecheck` is the correctness gate for the script itself.

### Integration Tests:

- None.

### Manual Testing Steps:

1. After Phase 1-2, confirm the script typechecks and the npm script is
   wired correctly (can be invoked without crashing on a tiny trial grid,
   if useful during development — not a formal success criterion).
2. Phase 3: run the real benchmark once, single-process-verified, and
   sanity-check the results as described above.

## References

- Research: `context/changes/testing-perf-baseline/research.md`
- Existing construction pattern: `src/server/simulation/pipeline-perf.test.ts`
- Prior one-time measurement precedent: `context/foundation/capacity-limits.md`
- Rollout phase definition: `context/foundation/test-plan.md` §3, Phase 8

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: tinybench dependency + core benchmark script

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — bc6ac79
- [x] 1.2 Lint passes: `npm run check` — bc6ac79

### Phase 2: Results tracking + npm script

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 8d1c3de
- [x] 2.2 Lint passes: `npm run check` — 8d1c3de

### Phase 3: First real baseline run + cookbook update

#### Automated

- [x] 3.1 Full suite still passes: `npm test`
- [x] 3.2 Typecheck passes: `npm run typecheck`
- [x] 3.3 Lint passes: `npm run check`

#### Manual

- [x] 3.4 Confirm single-process, run `npm run perf:baseline` once for real
- [x] 3.5 `perf-baseline.json` gained one entry (54 rows); `capacity-limits.md` gained a matching summary
- [x] 3.6 Results sanity-check against known directional facts (cost ↑ with object count; cost ↓ at larger area for fixed count)
