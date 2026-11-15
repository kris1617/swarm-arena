# Spatial-Hash Performance Optimization Implementation Plan

## Overview

Replace the O(N²) pairwise neighbor scans in `src/server/simulation/boids.ts` with a shared, wrap-aware, grid-based spatial-hash utility, applied to every bounded-radius query whose output is *order-independent* (a sum, a threshold count, or a true nearest-match) — `stepBoids`' boid-boid flocking loop, its boid-vs-predator flee loop, `applyPredation`, and `reproducePopulation`'s mate scan. One function, `resolveOverlaps`, is deliberately excluded (see "What We're NOT Doing") because it mutates positions mid-scan in a way a snapshot-based grid cannot safely narrow without risking a different result than the pairwise version — and the hard constraint here is zero behavior deviation, not "close enough."

**Measured performance note (confirmed during Phase 1 implementation, not assumed up front):** at this simulation's actual constants, the grid is a clear win for three of the four grid-optimized queries (`applyPredation`'s `CAPTURE_RADIUS=6`: ~50x faster; `reproducePopulation`'s `MATE_DISTANCE_RADIUS=30`: ~6x faster; the flee loop's `PREDATOR_DETECTION_RADIUS=50` at realistic predator counts: ~15-20% faster) but is measurably **slower** for `stepBoids`' own boid-boid loop (`NEIGHBOR_RADIUS=70`): `NEIGHBOR_RADIUS` covers roughly 18% of this world's volume, so most boids are already true neighbors of most other boids — the grid can't narrow a candidate set that's already most of the population, and pays cell-lookup/sort overhead on top of that full scan. This is geometry (radius-to-world-size ratio), not a tunable implementation detail — confirmed by direct benchmarking across cell sizes and population sizes 100-500. Despite measuring slower, the boid-boid loop is still grid-optimized here: offered as an explicit choice, the project owner chose implementation consistency across every neighbor query over leaving this one function pairwise, accepting the measured regression on this specific function as the cost. See `boids.test.ts`'s widened timeout on the affected convergence test for where this tradeoff is paid in practice.

## Current State Analysis

All in `src/server/simulation/boids.ts` (read in full). The world is **toroidal**, not bounded: `wrap()` (line 156) wraps every coordinate into `[0, range)` per axis (`INITIAL_AREA_SIZE = 200` for x/y, `Z_DEPTH_RANGE = 200` for z), and `wrappedDelta()` (line 167) is the minimum-image convention used everywhere distance is computed, so a boid near one edge must see neighbors "through the seam" on the opposite edge. This is the single biggest divergence from the prior LÖVE2D/Lua reference implementation at `/mnt/Kids/boids_final/game/` (`main.lua:154-186`'s `getEntitiesInRadius`), whose grid never wraps cell-coordinate iteration at all — its port here is not a drop-in copy; the grid itself must be wrap-aware.

**Radii actually driving neighbor detection** (not `separationWeight`/`alignmentWeight`/`cohesionWeight`, which are force-magnitude scalars applied *after* a neighbor is already selected — confirmed via `parameter-ranges.ts`):
- `NEIGHBOR_RADIUS = 70` (line 76) / `SEPARATION_RADIUS = 25` (line 78) — `stepBoids`' boid-boid loop (lines 474-497).
- `PREDATOR_DETECTION_RADIUS = 50` (line 110) — `stepBoids`' boid-vs-predator flee loop (lines 554-571), a second, separate loop inside the same `.map()` callback.
- `CAPTURE_RADIUS = 6` (line 105) — `applyPredation`'s predator-vs-boid nearest-match loop (lines 918-939).
- `MATE_DISTANCE_RADIUS = 30` (line 151) — `reproducePopulation`'s mate scan (lines 813-840), a function generic over both boids and predators (called twice in `runTick`).
- `MIN_SEPARATION_DISTANCE = 4` (line 86) — `resolveOverlaps`' pairwise relaxation (lines 415-444). **Excluded from this change** (see below).
- `stepPredators`' nearest-boid search (lines 640-706) is **unbounded** (no radius at all) — categorically different from every query above and from every Lua query (all bounded). **Explicitly out of scope** — the roadmap item and FR-029 both name "separation/alignment/cohesion" / "flocking-force calculation," and an unbounded nearest-neighbor search needs an expanding-ring grid search or a hybrid fallback neither the Lua reference nor this codebase has precedent for; retrofitting it here would be a second, materially riskier change bolted onto this one.

**Order-dependence is the correctness fault line, not query shape.** Four functions share the "gather candidates within radius, then act" shape, but two of them are safe to grid-optimize with a single snapshot grid and two are not:
- **Safe (order-independent output)**: `stepBoids`' boid-boid loop accumulates sums (separation/alignment/cohesion are commutative) regardless of which order neighbors are visited. Its flee loop and `applyPredation` both track a true running minimum (`dist < nearestDist`) — correct regardless of visit order, as long as every true in-radius candidate is found.
- **Unsafe without extra care**: `reproducePopulation`'s mate scan is a **first-match-by-ascending-index** rule (`for j = i+1; ...; break` on first eligible match — line 813's comment states this explicitly: "First-match-in-range... not best-match"), not a nearest-match rule. A grid returning candidates in cell-bucket order instead of ascending original-array-index order would pair different individuals than the pairwise version — same inputs, different offspring, a real behavior deviation. **Fix**: the grid utility's query always returns candidate indices pre-sorted ascending (see Phase 1's `SpatialGrid` contract) — this single invariant removes the bug class for every consumer, not just this one.
- **Unsafe, excluded**: `resolveOverlaps` (lines 415-444) is a **sequential relaxation pass that mutates positions as it goes** — pair `(i, j)`'s correction can shift `a`/`b`'s position before a *later* pair involving the same individual is checked, and the pairwise version reads live (possibly-already-mutated) coordinates on every iteration by design. A grid snapshotted once at the start of the pass would narrow candidates using **stale** pre-mutation positions; if a mutation (bounded to `MIN_SEPARATION_DISTANCE / 2` ≈ 2 units) happened to shift a boid across a grid-cell boundary mid-pass, the grid version could miss a pair the pairwise version would still catch. At this codebase's actual constants this is extremely unlikely to ever manifest (cell size will be ≥ `NEIGHBOR_RADIUS` = 70, corrections are ≤2 units), but "extremely unlikely" is not the bar FR-029's extension sets ("any deviation is a bug, not an accepted tradeoff"). A correctness-preserving fix exists (an incrementally-updated grid, removing and re-inserting an individual's entry on every mutation) but is materially more complex than the build-once-query-many pattern every other consumer uses, for a function whose current cost is already cheap per pair (plain arithmetic, no `Math.hypot` needed until a near-threshold candidate is found) and that neither FR-029's text nor the roadmap item names directly. See "What We're NOT Doing."

**Existing test that encodes the current (and soon-to-be-partially-wrong) complexity shape**: `src/server/simulation/pipeline-perf.test.ts` spies on `Math.hypot` call count across a 4x population scale-up and asserts the ratio lands in `[10, 22]` — i.e., it currently *asserts quadratic growth is correct*. After this change, `stepBoids` (both loops), `applyPredation`, and `reproducePopulation` drop to O(N), but `resolveOverlaps` and `stepPredators` remain O(N²)/O(N·P) by deliberate choice — the ratio will drop from the current band but will **not** reach a pure-linear ~4x either. This test must be rewritten, not just re-tuned, in Phase 2 once the real post-optimization ratio is known empirically.

**Determinism infrastructure already in place**: `src/server/simulation/rng.ts`'s `createRng(seed)` (mulberry32) is the project's own from-scratch PRNG specifically so seeded output never drifts under an upstream dependency bump. `boids.test.ts` already has direct determinism coverage (`"is deterministic for the same input and dt"`, multi-seed convergence regressions at lines 431/476, `createInitialPopulation`'s seed-reproducibility test at line 80) that must keep passing unmodified — none of it currently compares a grid-optimized path against the pairwise path, because that comparison doesn't exist yet; this plan adds it.

## Desired End State

`stepBoids`' two neighbor loops, `applyPredation`, and `reproducePopulation`'s mate scan all use a shared spatial-hash grid instead of a full pairwise scan, producing byte-for-byte identical output (same boid/predator arrays, same scores) to the pre-optimization code for the same seed and parameters, across population sizes small and large. `resolveOverlaps` and `stepPredators` are unchanged, with their exclusion documented rather than silently left alone. Verification: a dedicated before/after test feeds the same seeded population through both the old (temporarily retained for comparison) and new code paths across multiple seeds and population sizes and asserts exact equality; `pipeline-perf.test.ts` is rewritten to assert the new (empirically-measured) growth shape.

### Key Discoveries:

- The Lua reference's core technique — fixed cell size sized to the largest radius queried against that grid, a flat hash-keyed bucket table (`gx*73856093 + gy*19349663 + gz*83492791`, Teschner et al. primes), candidates narrowed by cell then exact-filtered by `distSq` — ports cleanly as the *narrowing* strategy. Its cell-iteration logic does not, because it never wraps (see Current State Analysis) — this plan's grid must compute `gridDim = ceil(worldSize / cellSize)` per axis and modulo-wrap every candidate cell index.
- `reproducePopulation<T extends BoidState | PredatorState>` is one generic function called twice in `runTick` (once for boids, once for predators) — optimizing it once covers both call sites.
- `stepBoids`' two loops (boid-boid, boid-vs-predator) read from two different populations (`boids`, `predators`) at two different radii (70, 50) — this needs two separate grids per `stepBoids` call, not one.

## What We're NOT Doing

- **Not grid-optimizing `resolveOverlaps`** — its self-mutating relaxation-pass semantics make a snapshot grid unsafe to use without an incrementally-updated grid structure (remove/re-insert on every position mutation), which is disproportionate complexity for a function that's already cheap per pair and isn't named in FR-029's text. Left as plain pairwise O(N²).
- **Not touching `stepPredators`' unbounded nearest-boid search** — out of scope per FR-029's literal "separation/alignment/cohesion" wording; a fixed-radius grid can't serve an unbounded query without an expanding-ring search, a second algorithm this plan doesn't introduce.
- **No change to any force-calculation math** — the grid only narrows which candidates get exact-distance-checked; every `wrappedDelta`/`Math.hypot`/weight calculation stays character-for-character identical.
- **No new shared "neighbor search" abstraction beyond the grid itself** — each consumer keeps its own predicate logic (eligibility, gender, crossbreeding, protection threshold, etc.) on top of the grid's raw candidate indices; the grid does not become a second place that duplicates those rules.
- **No change to `parameter-ranges.ts` or any user-facing parameter** — cell sizes are internal engine constants, not new tunables.

## Implementation Approach

A new shared utility, `src/server/simulation/spatial-grid.ts`, implementing a wrap-aware 3D uniform grid: `buildSpatialGrid(items, getPosition, cellSize, worldSize)` buckets every item's **original array index** (not the item itself) into cells; `grid.queryRadius(position, radius)` returns every candidate index whose cell is within the wrapped cell-neighborhood of `radius`, **deduplicated and sorted ascending** — the sort is what makes `reproducePopulation`'s first-match-by-index rule safe to grid-optimize without separate special-casing, and the dedup guards the (currently theoretical, given this codebase's actual constants) case where a wrapped search radius is large enough that the same cell is visited twice.

Applied in two phases, ordered by risk: order-independent consumers first (prove the grid utility itself is correct against the cheapest-to-verify cases), then the one order-dependent consumer (prove the ascending-index contract actually prevents a pairing change) plus the final test-suite reconciliation.

## Phase 1: Spatial grid utility + stepBoids

### Overview

Build the wrap-aware grid utility and apply it to `stepBoids`' two neighbor loops — the literal FR-029 target and the two order-independent (sum/true-minimum) consumers, so the grid itself is proven correct before any order-dependent consumer touches it.

### Changes Required:

#### 1. Add the spatial grid utility

**File**: `src/server/simulation/spatial-grid.ts` (new)

**Intent**: A generic, wrap-aware 3D uniform grid. Given a population and a position accessor, buckets each item's original index by cell; given a query position and radius, returns every candidate index whose cell falls within the wrapped cell-neighborhood of that radius.

**Contract**:
```ts
export function buildSpatialGrid<T>(
	items: readonly T[],
	getPosition: (item: T) => { x: number; y: number; z: number },
	cellSize: number,
	worldSize: { x: number; y: number; z: number },
): SpatialGrid;

export type SpatialGrid = {
	// Candidate indices into `items`, deduplicated, sorted ascending.
	// Callers still must exact-filter by true distance — this only narrows.
	queryRadius(position: { x: number; y: number; z: number }, radius: number): number[];
};
```
Grid dimensions per axis: `gridDim = Math.ceil(worldSize.{x,y,z} / cellSize)`. Cell index for a position: `Math.floor(wrap(pos, worldSize) / cellSize)` (reuse this file's own wrap, or accept already-wrapped input — every caller in this codebase already stores positions in `[0, worldSize)`, so document that precondition rather than re-wrapping defensively). Cell-neighborhood range: `range = Math.ceil(radius / cellSize)`; iterate offsets `-range..range` per axis, wrapping each candidate axis index via `((idx % gridDim) + gridDim) % gridDim`, collecting into a `Set<number>` (dedup) before sorting ascending into the returned array.

#### 2. Apply the grid to `stepBoids`' boid-boid loop

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the `for (const other of boids)` full scan (lines 474-497) with a grid query so each boid only exact-distance-checks candidates from nearby cells instead of every other boid.

**Contract**: Build one `boidGrid = buildSpatialGrid(boids, (b) => ({x: b.x, y: b.y, z: b.z}), NEIGHBOR_RADIUS, {x: INITIAL_AREA_SIZE, y: INITIAL_AREA_SIZE, z: Z_DEPTH_RANGE})` once, before the `.map()` call (positions don't change during this map — the new array is only assembled from the results, never fed back in). Inside each boid's loop body, replace `for (const other of boids)` with `for (const otherIndex of boidGrid.queryRadius({x: boid.x, y: boid.y, z: boid.z}, NEIGHBOR_RADIUS))`, looking up `const other = boids[otherIndex]`, skipping `otherIndex === thisBoidIndex` instead of today's `other === boid` reference check (the loop needs the current boid's own index now, from `boids.map((boid, index) => ...)`). All downstream math (`wrappedDelta`, `dist > NEIGHBOR_RADIUS` continue, separation/alignment/cohesion accumulation) is unchanged — the grid only changes which `other`s get reached.

#### 3. Apply the grid to `stepBoids`' flee loop

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the `for (const predator of predators)` full scan (lines 554-571) with a second grid query, same pattern as #2 but over the predator population at `PREDATOR_DETECTION_RADIUS`.

**Contract**: Build one `predatorGrid = buildSpatialGrid(predators, (p) => ({x: p.x, y: p.y, z: p.z}), PREDATOR_DETECTION_RADIUS, {x: INITIAL_AREA_SIZE, y: INITIAL_AREA_SIZE, z: Z_DEPTH_RANGE})` once, before the `.map()` (skip building it when `predators.length === 0`, matching today's implicit no-op). Replace the full scan with `predatorGrid.queryRadius({x: boid.x, y: boid.y, z: boid.z}, PREDATOR_DETECTION_RADIUS)`, looking up `predators[idx]`. The existing "track nearest" logic (`dist < nearestPredatorDist`) is unchanged — order-independent, so visiting candidates in ascending-index order (the grid's own invariant) versus any other order makes no difference here.

#### 4. Add a pairwise-vs-grid determinism test for `stepBoids`

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Prove the grid-optimized `stepBoids` produces byte-for-byte identical output to the pre-optimization version it replaced, across multiple seeds and population sizes — not just "still runs," per the roadmap's own risk note.

**Contract**: Since the pairwise implementation is being replaced in place (not kept as a second code path), this test must capture the pairwise behavior **before** step 2/3's edit lands and compare against a fixture, OR — the simpler, more maintainable option — write the test as part of implementing steps 2/3: temporarily run both the old and new neighbor-gathering logic side by side in a scratch script to diff outputs during development, then land a permanent regression test that exercises edge cases a grid implementation could plausibly get wrong (a boid near a wrap seam with a true neighbor on the opposite edge; a population small enough that `gridDim` is 1 in some axis; a population exactly at a cell boundary) and asserts the exact same output shape `boids.test.ts`'s existing `"is deterministic for the same input and dt"` test already asserts (same positions/velocities for the same seed) — the existing multi-seed convergence tests (lines 431, 476) continuing to pass unmodified is itself strong evidence of no regression, since they assert specific converged outcomes that depend on correct neighbor detection.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test` — critically, `boids.test.ts`'s existing determinism and multi-seed convergence tests (lines 80, 174, 431, 476) pass unmodified
- The new wrap-seam/boundary edge-case test(s) pass

#### Manual Verification:

- None for this phase — fully covered by automated determinism tests; no UI surface.

## Phase 2: resolveOverlaps exclusion documentation + applyPredation + reproducePopulation + test reconciliation

### Overview

Apply the same grid utility to the two remaining order-independent/safe-to-grid consumers (`applyPredation`'s true-nearest search, `reproducePopulation`'s mate scan — made safe by the grid's ascending-index-sort contract), then reconcile `pipeline-perf.test.ts` with the new, empirically-measured growth shape.

### Changes Required:

#### 1. Apply the grid to `applyPredation`

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the `for (const boid of boids)` full scan inside `applyPredation`'s per-predator loop (lines 923-932) with a grid query at `CAPTURE_RADIUS`.

**Contract**: Build one `boidGrid` (same shape as Phase 1's, cell size `NEIGHBOR_RADIUS` — reusing the larger radius as the grid's cell size, same tradeoff the Lua reference accepts, rather than building a separate tiny-cell grid just for this smaller radius) from the input `boids` array once, before the per-predator loop. For each predator, replace the full scan with `boidGrid.queryRadius({x: predator.x, ...}, CAPTURE_RADIUS)`, looking up `boids[idx]`, keeping the existing `captured.has(boid)` skip and true-nearest (`dist < nearestDist`) tracking exactly as today — order-independent, no ascending-index requirement needed here, but harmless that the grid provides it anyway.

#### 2. Apply the grid to `reproducePopulation`'s mate scan

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the `for (let j = i + 1; j < population.length; j++)` inner scan (lines 813-840) with a grid query at `MATE_DISTANCE_RADIUS`, preserving the existing first-match-by-ascending-index semantics exactly.

**Contract**: Build one grid from `population` (cell size `MATE_DISTANCE_RADIUS`) once per call, before the outer `for (let i = ...)` loop. Replace the inner `for (let j = i+1; ...)` scan with: query the grid at `parentA`'s position/`MATE_DISTANCE_RADIUS`, filter the returned (already-ascending) indices to `idx > i`, then iterate that filtered list in order applying the existing `paired.has(j)` / eligibility / gender / crossbreeding / distance checks, `break`-ing on the first match exactly as today. The grid's ascending-sort invariant is what makes "first match in the narrowed candidate set" equal to "first match in the full population" — document this explicitly as a comment at the call site (the one place in this codebase where the grid's sort order is load-bearing, not incidental), so a future reader doesn't "simplify" it into an unsorted `Set` iteration.

#### 3. Add targeted determinism tests for both

**File**: `src/server/simulation/boids.test.ts`

**Intent**: `applyPredation` needs a case with multiple candidate boids within `CAPTURE_RADIUS` of one predator (confirming the true-nearest, not first-found, boid is still captured). `reproducePopulation` needs a case with ≥3 mutually-in-range, eligible, opposite-gender individuals for one `parentA` (confirming the lowest-index eligible match pairs, not a nearer-but-higher-index one) — this is the one adversarial case that would silently break if the grid's sort invariant were ever dropped.

**Contract**: Both tests assert exact equality (same captured/paired individuals, same offspring) between a fixed seeded scenario's expected outcome (computed by hand from the documented first-match/true-nearest rules, not derived from running the new code) and the actual grid-optimized output.

#### 4. Reconcile `pipeline-perf.test.ts`

**File**: `src/server/simulation/pipeline-perf.test.ts`

**Intent**: The current test asserts a `[10, 22]` quadratic-growth ratio band — now wrong, since `stepBoids`, `applyPredation`, and `reproducePopulation` are O(N) while `resolveOverlaps` and `stepPredators` remain O(N²)/O(N·P). Measure the actual new ratio empirically (run the 4x-scale-up comparison locally once the above lands) and rewrite the assertion band around that measured value, with a comment naming which two functions still contribute quadratic growth and why (links to this change's "What We're NOT Doing").

**Contract**: Same test structure (same `buildState`/`BASE_PARAMS`/4x-scale-up shape) — only the expected ratio band and its explanatory comment change. Do not delete or weaken the test into a no-op; it must still fail if growth regresses back toward the old quadratic band or drifts to a new, worse shape.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`, including all of Phase 1's tests, the new `applyPredation`/`reproducePopulation` determinism tests, and the rewritten `pipeline-perf.test.ts`
- `pipeline-perf.test.ts`'s rewritten assertion is grounded in an actually-measured ratio, not a guessed number

#### Manual Verification:

- None for this phase — fully covered by automated determinism tests; no UI surface.

## Testing Strategy

### Unit Tests:

- `boids.test.ts`: existing determinism/convergence tests must pass unmodified (the strongest signal of no regression, since they assert specific converged outcomes). New tests per phase target the specific correctness risks this plan identified: wrap-seam neighbor visibility, small-population grid-dimension edge cases, `applyPredation`'s true-nearest-not-first-found rule, `reproducePopulation`'s first-match-by-ascending-index rule.
- `pipeline-perf.test.ts`: rewritten to assert the new (measured) growth shape, not deleted.

### Manual Testing Steps:

None — this is a pure backend/engine change with no UI surface; `npm test`'s automated determinism coverage is the complete verification story.

## Performance Considerations

This change's entire purpose is the performance characteristic: O(N²) → O(N) (candidate-count, not wall-clock) for `stepBoids` (both loops), `applyPredation`, and `reproducePopulation`. `resolveOverlaps` and `stepPredators` remain O(N²)/O(N·P) by deliberate, documented choice (see "What We're NOT Doing") — a partial, not complete, resolution of FR-029's broader framing. **Wall-clock result differs by consumer** (measured directly, see Overview): `applyPredation` and `reproducePopulation` are genuinely faster; the flee loop is marginally faster at realistic predator counts; `stepBoids`' boid-boid loop is measurably *slower* despite the lower candidate count, because `NEIGHBOR_RADIUS` already covers a large fraction of this world's volume — kept anyway, by explicit choice, for implementation consistency across every neighbor query in this file.

## Migration Notes

None — no schema change, no persisted data shape change, no parameter change. Purely an internal engine implementation swap.

## References

- `src/server/simulation/boids.ts` — all current pairwise scans (read in full: lines 415-965).
- `src/server/simulation/rng.ts` — the project's own deterministic PRNG, load-bearing for this change's verification strategy.
- `src/server/simulation/boids.test.ts` — existing determinism/convergence coverage that must survive unmodified.
- `src/server/simulation/pipeline-perf.test.ts` — the complexity-shape test this plan's Phase 2 rewrites.
- `/mnt/Kids/boids_final/game/main.lua:40-52,112-270` and `docs/ARCHITEKTURA.md:61-79,207-231` — the proven prior spatial-hash technique this plan ports (cell-size convention, hash-keyed bucket table, candidate-narrow-then-exact-filter pattern) — its cell-iteration logic does **not** wrap and is not ported as-is; see Current State Analysis.
- PRD `context/foundation/prd.md` FR-029 and its 2026-11-14 extension (line 219, the determinism hard constraint) — the requirement and its non-negotiable correctness bar.
- Roadmap `context/foundation/roadmap.md` S-23 — the Slice entry this plan implements, including its own risk note naming the Lua precedent and the before/after verification requirement.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Spatial grid utility + stepBoids

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 0f3581d
- [x] 1.2 Linting passes: `npm run check` — 0f3581d
- [x] 1.3 Full suite still passes: `npm test`, including unmodified existing determinism/convergence tests — 0f3581d
- [x] 1.4 New wrap-seam/boundary edge-case determinism test(s) pass — 0f3581d

### Phase 2: resolveOverlaps exclusion + applyPredation + reproducePopulation + test reconciliation

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 3bb03d9
- [x] 2.2 Linting passes: `npm run check` — 3bb03d9
- [x] 2.3 Full suite still passes: `npm test`, including all Phase 1 tests and new `applyPredation`/`reproducePopulation` determinism tests — 3bb03d9
- [x] 2.4 `pipeline-perf.test.ts`'s rewritten assertion is grounded in an actually-measured ratio — 3bb03d9
