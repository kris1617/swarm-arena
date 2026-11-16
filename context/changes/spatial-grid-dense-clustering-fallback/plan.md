# Keep spatial-grid neighbor queries bounded when boids cluster densely — Implementation Plan

## Overview

Bound `queryRadius`'s (`spatial-grid.ts`) worst-case candidate count to a fixed cap so dense clustering — confirmed to occur at low `separationWeight` — can no longer degrade `stepBoids`/`stepPredators`/`reproducePopulation`'s per-tick neighbor queries toward O(n), which compounds into catastrophic non-linear slowdown on long runs. Thread a per-run "already warned about truncation" flag through the existing tick-state pipeline so a real clustering event logs exactly once per run, on both the client-staged and server-owned execution paths.

## Current State Analysis

- **Confirmed empirically, not guessed**: isolated reproductions of `parameter-sweep-corpus-generation`'s real sweep batch 1 (all 4 rows share `separationWeight: 0.5`, the sweep's lowest value) completed cleanly at `maxDurationSeconds` 20s/45s/300s (91 real seconds for the 300s case), but a 900s run never finished even after 1800s (30 real minutes) of wall-clock time — a ~20x+ disproportionate slowdown for only 3x more simulated duration. Default-parameter (`separationWeight: 1`) runs showed no such degradation at any duration tested.
- **Three functions, four call sites, one shared mechanism** (corrected during plan review — `stepPredators` has no spatial-grid query at all; it was misidentified): `stepBoids` (`boids.ts:457-`) builds two grids and calls `queryRadius` twice per boid — a boid-boid neighbor query (`NEIGHBOR_RADIUS=70`, cohesion/alignment/separation) and a boid-predator flee-detection query against its own `predatorGrid` (`PREDATOR_DETECTION_RADIUS`). `applyPredation` (`boids.ts:974-1021`) builds its own `boidGrid` and calls `queryRadius` once per predator (`CAPTURE_RADIUS`) to find a capturable boid. `reproducePopulation` (`boids.ts:838-877`) builds its own `mateGrid` and calls `queryRadius` per eligible individual for mate-scanning (`MATE_DISTANCE_RADIUS`). `stepPredators` (`boids.ts:686-746`) finds each predator's nearest boid via a plain nested loop with no spatial grid at all — a separate, unrelated O(predators × boids) cost, out of scope for this change. All four `queryRadius` call sites degrade identically when many individuals land in the same few grid cells.
- **Cell size is tied to query radius, not a free tuning knob**: `buildSpatialGrid`'s cell size is set to the radius being queried (e.g. `NEIGHBOR_RADIUS=70` for `stepBoids`), which is what makes the 1-cell-range search correct. With the default `xyArea: 200`, that's only `ceil(200/70) = 3` cells per axis — 27 cells total. There is no "make cells finer" lever available without changing what the radius itself means; the grid is already coarse by construction for small worlds.
- **`queryRadius` already returns a correctness-relevant ordering**: `spatial-grid.ts`'s own comment states candidates are returned "sorted ascending" and that `reproducePopulation`'s first-match-by-ascending-index rule depends on it — any fix must preserve this ordering contract, not replace it with a distance-sort.
- **Population growth compounds the cost over a long run**: `reproducePopulation` (`boids.ts:811-937`) rebuilds the population array via `[...population, ...offspring]` every tick (not itself broken — Phase 1 of `parameter-sweep-corpus-generation` deliberately scoped only `single-run-lifecycle.ts`'s six *sample* arrays, not this one) and grows toward `populationCap: 500` when `crossbreedingEnabled` and food are generous. A clustered population that also grows larger means more individuals doing more work in a shrinking number of effectively-occupied cells — the two effects compound.
- **`computeSingleRunTick`'s shared tick-state shape already carries sibling per-tick-derived flags across both execution paths**: `single-run-lifecycle.ts`'s state object persists `lastTimestamp`/`populationCapped` across ticks, and both `server-run-registry.ts` (`run.populationCapped`, a plain object field) and `simulation-canvas.tsx` (`populationCapped` React state, `lastTimestampRef` plain ref) already thread these same-shaped fields from that one shared tick core. A new "has this run already warned" flag follows the exact same existing pattern — a plain, non-rendered field/ref (not React state, since nothing needs to re-render on it), mirroring `lastTimestampRef` rather than `populationCapped`.
- **No fixture-export or corpus-generation code is touched by this change** — this is a `src/server/simulation/` engine fix only. `parameter-sweep-corpus-generation`'s own real 20-row generation re-run is explicitly deferred to a separate follow-up once this change lands (see "What We're NOT Doing").

### Key Discoveries:

- `spatial-grid.ts:79-120` — `buildSpatialGrid`'s `queryRadius` collects every bucket index in the `(2*range+1)³` cell block around the query point, then does one final `result.sort((a, b) => a - b)` before returning — this sort is the natural truncation point: slicing the already-sorted array to a cap preserves the existing ascending-index-order contract with zero additional sort cost.
- `boids.ts:1045-1164` (`runTick`) is the single composition point that calls `stepBoids`, `stepPredators`, and (via each's own internal call) `reproducePopulation` once per tick — the natural place to own one shared warn-sink for the whole tick and pass it down to all three.

## Desired End State

`queryRadius` never returns more than 64 candidates for any single call, regardless of how many individuals share a cell neighborhood. The three call sites' simulation output (steering forces, mate selection, population growth) is byte-for-byte unchanged versus today whenever the true candidate count is ≤ 64 (true for every default-parameter and moderate-density scenario already covered by existing tests). The first time any call in a given run actually truncates, that run logs one `console.warn`; every subsequent truncation in the same run stays silent. A deliberately dense synthetic scenario (10,000+ items in one cell) resolves `queryRadius` within a tight, fixed wall-clock budget instead of scaling with candidate count.

### Verification

- `npx vitest run src/server/simulation/spatial-grid.test.ts` — existing tests pass unmodified; new tests prove the cap triggers under dense clustering and never triggers under the existing sparse/normal-density fixtures.
- `npx vitest run src/server/simulation/boids.test.ts` — existing tests pass unmodified; new tests prove `stepBoids`/`stepPredators`/`reproducePopulation` surface exactly one warn-sink trip under deliberately dense synthetic input, and produce identical output to today under normal density.
- `npx vitest run src/server/simulation/single-run-lifecycle.test.ts src/server/simulation/server-run-registry.test.ts` and the client canvas's own test file — existing tests pass unmodified; new tests prove the warned-flag persists correctly (starts false, flips once, stays true) across many ticks within one run, on both execution paths.
- Full suite passes: `npm test`.

## What We're NOT Doing

- Not re-attempting `parameter-sweep-corpus-generation`'s real 20-row generation (S-33's Phase 4) as part of this plan — that is explicitly deferred to a separate follow-up once this fix lands, to keep this change's own scope and verification to the engine fix itself, not a slow, contention-prone real-data run.
- Not changing `NEIGHBOR_RADIUS`, `SEPARATION_RADIUS`, `MATE_DISTANCE_RADIUS`, or any `DEFAULT_PARAMETER_RANGES` value — the fix is entirely inside `queryRadius`'s own candidate-count bound, not a change to simulation tuning constants.
- Not implementing adaptive/variable cell sizing — cell size stays tied to the query radius exactly as today; only the returned candidate *count* is bounded.
- Not using a distance-sort to choose which candidates survive truncation — the existing ascending-index order is kept and simply truncated, per the approved design decision (preserves `reproducePopulation`'s documented ordering contract and avoids adding a sort pass).
- Not fixing `reproducePopulation`'s own per-tick `[...population, ...offspring]` array-rebuild — that is the same category of issue Phase 1 of `parameter-sweep-corpus-generation` already fixed for the six sample arrays, deliberately scoped there to exclude this function; out of scope here too unless a future change opens it.
- Not adding any new UI-visible indicator for truncation — the signal is a `console.warn`, not a rendered state change (unlike `populationCapped`, which the canvas UI does render).

## Implementation Approach

Fix the bound at its source first (Phase 1: `spatial-grid.ts`), since every other phase depends on the cap and warn-sink existing. Then thread the warn-sink through the three call sites that actually trigger it (Phase 2: `boids.ts`), since that's where "this run saw dense clustering" becomes knowable. Finally persist the resulting flag across ticks on both execution paths (Phase 3), since that's what turns "warned once per tick-call" into the approved "warned once per run."

## Phase 1: Cap `queryRadius` and add a warn-sink

### Overview

Truncate `queryRadius`'s already-sorted candidate list to a fixed cap of 64, and accept an optional mutable warn-sink the caller can inspect to learn whether this specific call truncated.

### Changes Required:

#### 1. Candidate cap + warn-sink parameter

**File**: `src/server/simulation/spatial-grid.ts`

**Intent**: After the existing `result.sort((a, b) => a - b)`, if `result.length` exceeds the cap, slice it down to the cap and (if a warn-sink was passed) mark it as triggered. The cap applies uniformly to every caller — no per-call-site exemption.

**Contract**:
```ts
export const DENSE_CLUSTER_CANDIDATE_CAP = 64;
export type DenseClusterWarnSink = { triggered: boolean };

// queryRadius gains an optional third parameter; omitting it preserves
// today's exact behavior for any caller that doesn't care (e.g. existing
// spatial-grid.test.ts fixtures, which never exceed the cap).
queryRadius(position: Position3, radius: number, warnSink?: DenseClusterWarnSink): number[]
```
When the sorted result exceeds `DENSE_CLUSTER_CANDIDATE_CAP`, slice to that length (truncating the end of the ascending-index-sorted array — not re-sorted by distance) and, if `warnSink` was provided, set `warnSink.triggered = true`. Below the cap, behavior and return value are identical to today.

#### 2. Perf regression tests

**File**: `src/server/simulation/spatial-grid.test.ts`

**Intent**: Prove the cap actually bounds cost (not just that the code compiles) and that normal density is unaffected.

**Contract**: Two new tests — (a) build a grid with 10,000+ items placed in the exact same cell, call `queryRadius`, assert the returned array's length is exactly `DENSE_CLUSTER_CANDIDATE_CAP`, assert the call's own wall-clock duration stays under a small fixed budget (e.g. a few milliseconds — generous enough to not be CI-flaky, tight enough to fail if the cap were removed), and assert a passed warn-sink's `triggered` becomes `true`; (b) reuse one of the existing sparse/normal-density fixtures already in this file, assert the returned candidate set is byte-for-byte identical to what it is today, and assert a passed warn-sink's `triggered` stays `false`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/spatial-grid.test.ts` — all existing tests still pass unmodified, plus the two new tests above
- Full suite passes: `npm test`

#### Manual Verification:

- None — this phase is a pure, deterministic function change with no user-visible behavior; the dense-cluster and sparse-density tests above are the complete signal.

---

## Phase 2: Thread the warn-sink through `boids.ts`'s real call sites

### Overview

`stepBoids`, `applyPredation`, and `reproducePopulation` each pass a shared warn-sink into their own `queryRadius` calls; `runTick` owns and creates one warn-sink per tick call and forwards it to all three, so a single tick's worth of dense-clustering truncation (in any of the three) is visible to the tick's caller as one combined signal. `stepPredators` is not part of this phase — corrected during plan review, it has no `queryRadius` call (see Current State Analysis).

### Changes Required:

#### 1. `stepBoids` and `applyPredation` accept and use a warn-sink

**File**: `src/server/simulation/boids.ts`

**Intent**: Both functions already build their own `SpatialGrid`(s) per call. `stepBoids` (`boids.ts:457-`) queries twice per boid (boid-boid neighbor query and boid-predator flee-detection query) — both calls forward the same sink. `applyPredation` (`boids.ts:974-1021`) queries once per predator via its own `boidGrid`. Add an optional warn-sink parameter to each function, passed straight through to every `queryRadius` call inside.

**Contract**:
```ts
export function stepBoids(
	boids: BoidState[],
	dtSeconds: number,
	worldSize: WorldSize,
	predators?: PredatorState[],
	warnSink?: DenseClusterWarnSink,
): BoidState[]

export function applyPredation(
	boids: BoidState[],
	predators: PredatorState[],
	protectionThreshold: number,
	worldSize: WorldSize,
	warnSink?: DenseClusterWarnSink,
): BoidState[]
```
Omitting `warnSink` preserves today's exact behavior (no tracking) — existing callers that don't pass one are unaffected. `stepPredators`'s own signature is untouched by this plan.

#### 2. `reproducePopulation` accepts and uses a warn-sink

**File**: `src/server/simulation/boids.ts`

**Intent**: Same pattern — `reproducePopulation`'s own `mateGrid.queryRadius` call (`boids.ts:877`) forwards the sink it's given.

**Contract**: `reproducePopulation`'s `params` object gains an optional `warnSink?: DenseClusterWarnSink` field, passed through to its internal `queryRadius` call. No change to its existing return shape (`{ population, capped }`).

#### 3. `runTick` owns one warn-sink per tick and forwards it

**File**: `src/server/simulation/boids.ts`

**Intent**: `runTick` (`boids.ts:1045-1164`) creates one fresh `{ triggered: false }` warn-sink at the start of its own call, passes it into `stepBoids`, `applyPredation`, and both `reproducePopulation` calls (boids' and predators'), and returns whether it was triggered — the caller (`computeSingleRunTick`, Phase 3) is responsible for persisting that across ticks. `stepPredators` is still called by `runTick` exactly as today, with no sink parameter (it has nothing to forward it to).

**Contract**: `runTick`'s return shape gains one new field: `hasWarnedDenseClustering: boolean` (true if any of the four internal `queryRadius`-backed calls triggered the shared sink this tick). `runTick`'s own parameter list is unchanged — it doesn't need to accept a sink from its caller, since it owns the sink for the duration of one tick and only reports the outcome.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/boids.test.ts` — existing tests pass unmodified; new tests prove: (a) a deliberately dense synthetic scenario (many boids at the same position) passed through `stepBoids`/`applyPredation`/`reproducePopulation` each trip their own warn-sink, and `runTick` surfaces `hasWarnedDenseClustering: true` when any of them does; (b) normal-density existing fixtures produce identical output to today and `hasWarnedDenseClustering: false`
- Full suite passes: `npm test`

#### Manual Verification:

- None — pure function changes with deterministic test coverage.

---

## Phase 3: Persist the warned-flag across ticks on both execution paths

### Overview

Add one new field to `computeSingleRunTick`'s shared tick-state shape, threaded by both callers that already persist its sibling fields (`populationCapped`, `lastTimestamp`): `server-run-registry.ts`'s run object and `simulation-canvas.tsx`'s client ref. Once a run's flag is `true`, later ticks skip calling `console.warn` again for that run.

### Changes Required:

#### 1. `computeSingleRunTick` persists the flag and logs on first trip

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Add `hasWarnedDenseClustering: boolean` to both the input `state` shape and the return shape, mirroring exactly how `lastTimestamp`/`populationCapped` already thread through this function. After calling `runTick` (which now returns its own per-tick `hasWarnedDenseClustering`), if the tick's own flag is `true` and the incoming persisted flag was `false`, call `console.warn` once (naming the run is not possible here — this function has no run-identifying context — so the message should describe the condition generically, e.g. "dense clustering truncated a spatial-grid query this tick") and set the persisted flag to `true` for the return value; if the incoming persisted flag was already `true`, never call `console.warn` again regardless of this tick's own result.

**Contract**: `computeSingleRunTick`'s `state` parameter and return type both gain `hasWarnedDenseClustering: boolean` alongside the existing `lastTimestamp`/`populationCapped`-style fields. External signature shape otherwise unchanged.

#### 2. Both callers persist the new field across ticks

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The server-owned run registry entry already carries `populationCapped: boolean` as a plain object field, reassigned each tick (`run.populationCapped = result.populationCapped`). Add `hasWarnedDenseClustering: boolean` the same way — initialized to `false` when a run is registered, reassigned from `computeSingleRunTick`'s result each tick, read back in on resume exactly like `lastTimestamp`.

**Contract**: One new plain field on the run registry's internal type and on `ServerRunParams`/snapshot shapes wherever `populationCapped` already appears, following that field's exact existing pattern (not React state, no new UI).

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: The client-staged path already owns `lastTimestampRef` (a plain `useRef`, not React state, since nothing re-renders on it) alongside `populationCapped` (which IS React state, because the UI renders it). The new flag needs no UI, so it follows `lastTimestampRef`'s pattern, not `populationCapped`'s.

**Contract**: `hasWarnedDenseClusteringRef = useRef(false)`, read into `computeSingleRunTick`'s state on each tick call and written back from its result, mirroring `lastTimestampRef.current` exactly.

#### 3. Regression tests proving per-run persistence

**File**: `src/server/simulation/single-run-lifecycle.test.ts`, `src/server/simulation/server-run-registry.test.ts`

**Intent**: Prove the flag starts `false`, flips to `true` and logs exactly once (spy on `console.warn`) the first tick that triggers it, and stays `true` with no further `console.warn` calls across many subsequent ticks within the same run — following the existing start-two-runs-and-tick-together test pattern already in `server-run-registry.test.ts`.

**Contract**: No production-code changes from this item — test additions only, one per file, each driving a deliberately dense synthetic scenario across several ticks and asserting `console.warn`'s call count stays at exactly 1.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/single-run-lifecycle.test.ts src/server/simulation/server-run-registry.test.ts` — existing tests pass unmodified, plus new tests proving one-warn-per-run persistence
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — existing tests pass unmodified; one new test drives several ticks via the file's existing `requestAnimationFrame`-mock pattern (looping `act(() => capturedCallback?.(ts))`) and asserts `hasWarnedDenseClusteringRef.current` flips exactly once and `console.warn`'s call count stays at 1
- Full suite passes: `npm test`

#### Manual Verification:

- None — the flag has no UI surface; its only observable effect is a `console.warn` line, which the automated tests above directly assert on.

## Testing Strategy

### Unit Tests:

- `spatial-grid.test.ts`: cap triggers under deliberate density, never triggers under existing sparse fixtures, wall-clock budget holds under a 10,000+-candidate synthetic scenario.
- `boids.test.ts`: `stepBoids`/`stepPredators`/`reproducePopulation`/`runTick` each correctly surface a warn-sink trip under dense synthetic input, and produce unchanged output under normal density.
- `single-run-lifecycle.test.ts`/`server-run-registry.test.ts`: the persisted flag starts false, flips once, and never re-logs across many ticks in one run.

### Integration Tests:

- None new — the existing full-suite run (`npm test`) is the integration signal that nothing downstream (phase classification, scoring, analysis) changed for any already-passing scenario.

### Manual Testing Steps:

None — this phase's correctness is fully covered by the automated tests above; there is no user-facing surface to manually exercise.

## Performance Considerations

This change exists specifically to fix a performance pathology (dense-clustering degradation toward O(n²) per tick). Phase 1's perf regression test is the direct proof; no further manual benchmarking is planned as part of this change. Re-validating the real `parameter-sweep-corpus-generation` scenario that originally surfaced this is deliberately deferred to a separate follow-up (see "What We're NOT Doing").

**Open risk, stated explicitly (plan-review F3)**: capping candidates at 64 turns the affected call sites' per-tick cost from O(population²) to O(population × 64) — quadratic to linear, not constant. For a population that grows toward the 500 cap, that is still ~32,000 candidate-scan operations per tick per capped call site, not a negligible cost. This is expected to help substantially with the motivating 3600s/batch-1 scenario, but this plan does not prove it is sufficient on its own — only the deferred follow-up's real re-run can confirm that.

## Migration Notes

None — no schema changes, no persisted-data migration. The new `hasWarnedDenseClustering` field on server-run-registry run objects and run snapshots is additive; existing in-flight runs (if any) simply never had a dense-clustering warning, which remains true until their next tick after this change deploys.

## References

- Discovered while validating `context/changes/parameter-sweep-corpus-generation/plan.md`'s Phase 4 (real 20-row corpus generation) — see that change's own `change.md` Notes for the motivating investigation.
- Spatial grid: `src/server/simulation/spatial-grid.ts`
- Real call sites: `src/server/simulation/boids.ts` (`stepBoids:457-`, `applyPredation:974-1021`, `reproducePopulation:811-937`, `runTick:1045-1164`) — `stepPredators:686-746` has no spatial-grid query and is not part of this change
- Shared tick-state threading pattern: `src/server/simulation/single-run-lifecycle.ts`, `src/server/simulation/server-run-registry.ts`, `src/app/simulation/_components/simulation-canvas.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cap `queryRadius` and add a warn-sink

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run check`
- [ ] 1.3 `npx vitest run src/server/simulation/spatial-grid.test.ts` (existing + 2 new tests)
- [ ] 1.4 Full suite passes: `npm test`

### Phase 2: Thread the warn-sink through `boids.ts`'s three call sites

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 `npx vitest run src/server/simulation/boids.test.ts` (existing + new dense/sparse tests)
- [ ] 2.4 Full suite passes: `npm test`

### Phase 3: Persist the warned-flag across ticks on both execution paths

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/server/simulation/single-run-lifecycle.test.ts src/server/simulation/server-run-registry.test.ts` (existing + new persistence tests)
- [ ] 3.4 `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` (existing tests, plus new multi-tick persistence test)
- [ ] 3.5 Full suite passes: `npm test`
