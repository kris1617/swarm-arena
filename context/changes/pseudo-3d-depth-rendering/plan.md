# Pseudo-3D depth rendering Implementation Plan

## Overview

Extend the boids simulation to a real third (z) dimension — boids separate, align, and cohere in 3D rather than 2D — then render depth via a perspective-style scale on each boid's triangle (closer = bigger, farther = smaller), with boids drawn back-to-front for correct visual occlusion.

## Current State Analysis

Per `context/changes/pseudo-3d-depth-rendering/research.md`:

- `BoidState` (`src/server/simulation/boids.ts:1-7`) is strictly 2D: `{ x, y, vx, vy, lifespan }`, no `z`/`vz`.
- Every steering force in `stepBoids` (separation, alignment, cohesion), the hard-floor `resolveOverlaps`, and `computeCohesion`'s centroid-distance metric operate on x/y only, but are fully symmetric across the two axes — extending to z is additive, not a redesign.
- `src/server/api/routers/simulation.ts` only imports `computeScore(cohesionSamples: number[], elapsedTicks: number): number` from `boids.ts` — it never touches `BoidState`'s shape directly. No schema or API change is needed.
- `src/app/simulation/_components/simulation-canvas.tsx`'s `drawBoids` renders every boid at a fixed size (`BOID_LENGTH`/`BOID_WIDTH`) with a flat 2D projection; nothing reads or writes a depth value today.
- Neither `context/foundation/prd.md` nor `context/foundation/roadmap.md` mention a z-axis or 3D anywhere, and nothing in either constrains this change.

### Key Discoveries:

- `src/server/simulation/boids.ts:101-137` — the per-boid neighbor loop computes `distance` once and reuses it for both neighbor and close-neighbor checks; the z-extended version must do the same with 3D distance to preserve this optimization.
- `src/server/simulation/boids.ts:151-170` — alignment/cohesion are normalized to unit vectors (fixed in the prior change, to prevent force-magnitude imbalance); the 3D versions must normalize the same way, including the z component.
- `src/server/simulation/boids.ts:36-41` — `MIN_SPEED`/`MAX_SPEED`/`STEERING_FORCE_SCALE` were tuned together against 2D speed magnitudes; extending speed/steering magnitude to 3D (`Math.hypot(vx, vy, vz)`) changes what counts as "cruise speed" and must be re-verified against the existing convergence regression tests, not just extended mechanically.
- `src/app/simulation/_components/simulation-canvas.tsx:47-48` — the current x/y-to-pixel projection is a flat affine transform with no scale/depth concept; this plan adds a size multiplier only, not a full camera/parallax projection (position itself stays a flat x/y→pixel map, per the decision to keep this a simple depth cue rather than a full 3D camera).

## What We're NOT Doing

- Full 3D camera projection with parallax (position shifting based on viewing angle) — only triangle *size* scales with depth; x/y-to-pixel position mapping is unchanged.
- Shrinking the x/y simulation area (`INITIAL_AREA_SIZE`) to compensate for the new z-room — z is purely additive room, so the just-stabilized x/y tuning (cruise speed, steering force scale, radii) is not reopened.
- Any change to `src/server/api/routers/simulation.ts`, the Drizzle schema, or the `start`/`stop` tRPC contracts — confirmed in research as unnecessary; z is fully contained in `boids.ts` and the canvas renderer.
- Re-tuning predator/genetics mechanics (S-02/S-03) for 3D — out of scope; this change only touches the single-flock S-01 simulation that exists today.
- A UI control for z-axis parameters (e.g. a "depth weight" slider) — z uses the same `FlockWeights` (separation/alignment/cohesion) as x/y; no new user-facing parameter is introduced.

## Implementation Approach

Two phases:

1. **3D simulation core** — `BoidState` gains `z`/`vz`; `createInitialPopulation` seeds them; `stepBoids`'s neighbor loop, separation/alignment/cohesion normalization, hard-floor `resolveOverlaps`, and cruise-speed clamp all extend to include z (mirroring the existing x/y pattern exactly); `computeCohesion`'s centroid and distance become 3D. Unit tests mirror the existing 2D regression tests (collapse, hard-minimum-distance, multi-seed convergence) with a z-axis variant of each, to guard the same bug classes already found once in x/y.
2. **Depth-scaled rendering** — `drawBoids` computes a per-boid scale factor from `z` via `scale = baseScale * (referenceDepth / (referenceDepth + z))`, clamped to a sane min/max range, applied to `BOID_LENGTH`/`BOID_WIDTH` before drawing; boids are sorted back-to-front (descending `z`) before the draw loop so nearer boids correctly occlude farther ones.

Since every z-aware function in Phase 1 keeps its existing external signature (`stepBoids`, `computeCohesion`, `createInitialPopulation` all take the same parameter types, just a richer `BoidState`), Phase 2 requires no changes to `simulation-canvas.tsx`'s call sites for those functions — only `drawBoids` itself changes.

## Phase 1: 3D simulation core

### Overview

Extend `boids.ts`'s domain model and all steering/constraint math to a real z dimension, with 3D-mirrored regression tests.

### Changes Required:

#### 1. Domain model and seeding

**File**: `src/server/simulation/boids.ts`

**Intent**: Add `z`/`vz` to `BoidState` and seed them in `createInitialPopulation`, so every boid occupies and moves through 3D space from the start.

**Contract**:
- `BoidState` gains `z: number` and `vz: number`.
- `createInitialPopulation` seeds `z: rng() * Z_DEPTH_RANGE` and `vz: (rng() - 0.5) * INITIAL_SPEED`, where `Z_DEPTH_RANGE` is a new constant sized comparably to `INITIAL_AREA_SIZE` (200) so the simulation volume is roughly cubic rather than a thin 2D slab with an awkwardly large or small z range.

#### 2. 3D steering, hard-floor, and speed clamp

**File**: `src/server/simulation/boids.ts`

**Intent**: Extend every steering force (separation, alignment, cohesion), the hard-overlap floor, and the cruise-speed clamp to operate in 3D, exactly mirroring the existing x/y pattern for z — including the unit-vector normalization fix and the single-pass neighbor loop, both already hardened against specific bugs in 2D.

**Contract**:
- The per-boid neighbor loop (`stepBoids`'s single pass) computes 3D distance (`Math.hypot(dx, dy, dz)`) once per other-boid and reuses it for both neighbor and close-neighbor membership, same as the existing 2D optimization.
- Separation accumulates a 3D unit vector (`dx/dist, dy/dist, dz/dist`), same averaging as today.
- Alignment and cohesion compute their raw 3D vectors (`avgVx - boid.vx` etc., including `z`) and normalize to 3D unit vectors before weighting — the same fix already applied to x/y, now consistently covering all three axes so z-cohesion can't reintroduce the force-magnitude-imbalance bug in the new dimension.
- `resolveOverlaps` computes 3D pairwise distance and, for any pair closer than `MIN_SEPARATION_DISTANCE`, pushes them apart along the 3D line between them (same algorithm, one more axis); the degenerate exact-overlap fallback direction also needs a z component (e.g. `(1, 0, 0)`).
- The cruise-speed clamp computes 3D speed (`Math.hypot(steeredVx, steeredVy, steeredVz)`) and clamps it into `[MIN_SPEED, MAX_SPEED]`, scaling all three velocity components proportionally — not just vx/vy — so a boid's total 3D speed respects the cruise range, not just its x/y-plane speed.
- `STEERING_FORCE_SCALE`, `MIN_SPEED`, `MAX_SPEED`, `NEIGHBOR_RADIUS`, `SEPARATION_RADIUS`, and `MIN_SEPARATION_DISTANCE` keep their current numeric values initially; Phase 1's convergence tests (below) are what determines whether any need retuning now that speed/distance are measured in 3D instead of 2D.

#### 3. 3D cohesion scoring

**File**: `src/server/simulation/boids.ts`

**Intent**: Extend `computeCohesion`'s centroid and distance calculation to include z, so the score reflects the flock's actual 3D shape rather than only its x/y footprint.

**Contract**: `computeCohesion` computes a 3D centroid (`centroidX`, `centroidY`, `centroidZ`) and each boid's 3D distance to it; the rest of the function (normalization against `COHESION_REFERENCE_RADIUS`, clamping to `[0, 1]`) is unchanged. `computeScore`'s signature and behavior are unaffected (it only ever received the resulting `number[]`).

#### 4. 3D-mirrored regression tests

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Guard the z axis against the same bug classes already found and fixed once in x/y — an untested z-specific regression (e.g. unnormalized z-cohesion, or z excluded from the hard floor) would otherwise be invisible to the existing 2D-only test suite.

**Contract**: For each of the following existing tests, add a z-axis variant following the same pattern (boids placed/compared along the z axis instead of, or in addition to, x/y):
- A "separation increases 3D distance" test (z-offset pair, separation-only weights).
- A "never lets two boids end a step closer than the hard minimum 3D distance" test (two boids coincident in 3D, cohesion-only weights, asserting 3D distance never drops below `MIN_SEPARATION_DISTANCE`).
- The multi-seed "converges to a stable flock rather than dispersing" regression test, re-run with the 3D `createInitialPopulation`/`computeCohesion` — this one test, re-verified, also confirms the existing tuned constants still produce stable convergence in 3D (per Key Discoveries above); if it fails, retune `STEERING_FORCE_SCALE` and/or the radii and document the new values with the same reasoning comments as the existing ones.
- A "clamps 3D speed into the cruise range" test mirroring the existing speed-clamp test, with a nonzero starting `vz`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Unit tests pass: `npx vitest run src/server/simulation/boids.test.ts`

#### Manual Verification:

- None — this phase has no observable surface outside its own tests (rendering is Phase 2).

---

## Phase 2: Depth-scaled rendering

### Overview

Render each boid's triangle at a size derived from its z depth (closer = bigger, farther = smaller), drawn back-to-front so nearer boids correctly occlude farther ones.

### Changes Required:

#### 1. Depth-to-scale projection and draw order

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Give `drawBoids` a per-boid size scale derived from depth, and draw boids in back-to-front order so overlapping triangles occlude correctly (a nearer boid should visually cover a farther one at the same screen position, not the reverse).

**Contract**:
- New constants: `REFERENCE_DEPTH` (tunable; start at roughly half of `boids.ts`'s `Z_DEPTH_RANGE` so the falloff curve is well-centered on the typical z range) and `MIN_SCALE`/`MAX_SCALE` clamp bounds (e.g. `0.3` to `2.0`) on the computed scale factor, since the inverse-linear formula can otherwise grow large as `z` approaches 0.
- Per-boid scale: `scale = clamp(REFERENCE_DEPTH / (REFERENCE_DEPTH + boid.z), MIN_SCALE, MAX_SCALE)`, applied by multiplying `BOID_LENGTH`/`BOID_WIDTH` by `scale` before the `moveTo`/`lineTo` calls that draw the triangle (position/rotation logic is otherwise unchanged — x/y-to-pixel mapping stays a flat projection, per "What We're NOT Doing").
- `drawBoids` sorts a local copy of `boids` by descending `z` (farthest first) before the draw loop, so nearer boids are drawn last and visually occlude farther ones at overlapping screen positions.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- Boids visibly vary in size during a run — some larger (nearer), some smaller (farther) — rather than all rendering at a uniform size.
- A boid that moves from far to near over a run visibly grows; one that moves from near to far visibly shrinks.
- When two boids' projected x/y positions overlap on screen, the nearer one (smaller `z`) visually covers the farther one.
- The flock still visibly flocks (moves as a cohesive group, doesn't collapse to a point or disperse) — confirms Phase 1's 3D steering tuning holds up in the actual browser, not just in the unit tests.
- A run at the clamped max boid count (500) does not visibly freeze or drop to an unusable frame rate (the added sort in `drawBoids` is O(n log n), negligible next to `stepBoids`'s existing O(n²) pass at this scale).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/server/simulation/boids.test.ts` — 3D-mirrored regression tests per Phase 1, item 4.

### Integration Tests:

- None — consistent with the prior change's testing-approach decision (unit-test the math, leave rendering/visual behavior to manual checks).

### Manual Testing Steps:

1. Log in, start a run at `/simulation`, watch boids for ~15-20 seconds.
2. Confirm boids visibly vary in size as they move through z (nearer bigger, farther smaller), and that a boid's size visibly changes as its depth changes over the run.
3. Confirm the flock still flocks (cohesive group, no collapse, no dispersal) — same visual check as the prior change's Phase 3, now in 3D.
4. Confirm occlusion: watch for two boids crossing paths on screen and confirm the nearer one draws on top.
5. Start a run at the max boid count (500) and confirm no visible freeze.

## Performance Considerations

`drawBoids`'s added sort is O(n log n) per frame; at the existing 500-boid cap this is negligible next to `stepBoids`'s O(n²) neighbor pass (per the prior change's own benchmarking, ~22ms/tick at n=500 — the sort adds well under 1ms). No new performance risk introduced.

## Migration Notes

Not applicable — no schema or persisted-data change; `z`/`vz` are new in-memory fields on a value that was never persisted (confirmed in research: `simulation_run` stores only the final score and run parameters, never per-tick boid state).

## References

- Related research: `context/changes/pseudo-3d-depth-rendering/research.md`
- Extends: `context/changes/basic-flocking-loop/plan.md` (the 2D steering/overlap/speed-clamp design this change mirrors into z), `context/changes/basic-flocking-loop/reviews/plan-review.md` (the guarantees — server-side boidCount cap, stop input validation — this change does not reopen)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: 3D simulation core

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 2f3375a
- [x] 1.2 Linting passes: `npm run check` — 2f3375a
- [x] 1.3 Unit tests pass: `npx vitest run src/server/simulation/boids.test.ts` — 2f3375a

### Phase 2: Depth-scaled rendering

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — c185b53
- [x] 2.2 Linting passes: `npm run check` — c185b53

#### Manual

- [x] 2.3 Boids visibly vary in size during a run (nearer bigger, farther smaller) — c185b53
- [x] 2.4 A boid moving from far to near visibly grows; near to far visibly shrinks — c185b53
- [x] 2.5 Nearer boids visually occlude farther ones at overlapping screen positions — c185b53
- [x] 2.6 The flock still visibly flocks in 3D (no collapse, no dispersal) — c185b53
- [x] 2.7 A run at the clamped max boid count (500) does not visibly freeze — c185b53
