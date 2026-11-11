---
date: 2026-11-11T10:40:37+01:00
researcher: Claude Sonnet 5
git_commit: 53016a676bde0aa1479fb905d436223a54fa29cf
branch: master
repository: swarm-arena
topic: "Codebase state relevant to adding a z-axis to boids with depth-scaled rendering"
tags: [research, codebase, simulation, rendering, boids]
status: complete
last_updated: 2026-11-11
last_updated_by: Claude Sonnet 5
---

# Research: Adding a z-axis to boids with depth-scaled rendering

**Date**: 2026-11-11T10:40:37+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 53016a676bde0aa1479fb905d436223a54fa29cf
**Branch**: master
**Repository**: swarm-arena

## Research Question

What's the current state of the codebase relevant to adding a z-axis to the boids simulation with depth-scaled rendering (closer boids bigger, farther smaller)? Specifically: (1) the exact current contract of `src/server/simulation/boids.ts`; (2) how `src/server/api/routers/simulation.ts` depends on that contract; (3) the current canvas rendering in `src/app/simulation/_components/simulation-canvas.tsx`; (4) whether the roadmap/PRD constrain or conflict with a z-axis.

## Summary

The entire simulation is currently strictly 2D: `BoidState` (`src/server/simulation/boids.ts:1-7`) has only `x`/`y` position and `vx`/`vy` velocity, and every piece of steering math (separation, alignment, cohesion), the hard-overlap resolver, and `computeCohesion`'s distance metric operate on 2D coordinates only. The persistence/API layer (`src/server/api/routers/simulation.ts`) has **no structural dependency on the 2D-ness of `BoidState`** — it only calls `computeScore(cohesionSamples: number[], elapsedTicks: number): number`, a signature that doesn't change if `computeCohesion`'s internal distance calculation becomes 3D. The canvas renderer (`src/app/simulation/_components/simulation-canvas.tsx`) draws every boid at a fixed size (`BOID_LENGTH`/`BOID_WIDTH`, lines 26-27) with no depth/scale concept at all. Neither `context/foundation/prd.md` nor `context/foundation/roadmap.md` mention a z-axis, depth, or 3D anywhere, and nothing in either document precludes adding one — FR-004 (flock-color visualization) and the FR-018 rendering-freeze guardrail are the only visualization-related requirements, and neither assumes 2D-only.

## Detailed Findings

### `boids.ts`'s current 2D contract

- `BoidState` (`src/server/simulation/boids.ts:1-7`): `{ x: number; y: number; vx: number; vy: number; lifespan: number }` — no `z`/`vz` fields exist.
- `createInitialPopulation(count, rng, maxLifespan)` (`boids.ts:47-59`): seeds `x`/`y` uniformly over `[0, INITIAL_AREA_SIZE]` (200, line 16) and `vx`/`vy` from `(rng() - 0.5) * INITIAL_SPEED` (2, line 18). A z-axis would need an analogous `z`/`vz` seeding step here.
- `resolveOverlaps(boids)` (`boids.ts:66-94`): computes pairwise `dist = Math.hypot(dx, dy)` (line 77) in 2D only and pushes overlapping pairs apart along that 2D line. A 3D version would need `Math.hypot(dx, dy, dz)` and a 3D push direction.
- `stepBoids`'s per-boid neighbor loop (`boids.ts:101-137`): computes `dist = Math.hypot(dx, dy)` (line 121) in 2D to decide neighbor/close-neighbor membership, and the separation/alignment/cohesion accumulation (lines 106-170) is entirely 2D (`sepSumX/Y`, `sumVx/Vy`, `sumX/Y`). Every one of these would need a `z` component added in parallel with `x`/`y` if boids are meant to separate/align/cohere in 3D rather than just being assigned a static or independently-drifting `z` for rendering only.
- `computeCohesion(boids)` (`boids.ts:208-223`): computes a 2D centroid (`centroidX`/`centroidY`, lines 213-214) and 2D `distance()` (line 43, used at line 217) to that centroid. This is the one function `src/server/api/routers/simulation.ts` calls (via the score path) that would need its internal distance metric extended to 3D if z should count toward the cohesion score — functionally straightforward since its **external signature** (`(boids: BoidState[]) => number`) does not change.
- `computeScore(cohesionSamples, elapsedTicks)` (`boids.ts:225-236`): takes only `number[]`/`number`, has zero awareness of `BoidState`'s shape at all — unaffected by any dimensionality change to `BoidState` itself.

### `simulation.ts`'s dependency on the contract

- `src/server/api/routers/simulation.ts:7` imports only `computeScore` from `boids.ts` — never imports or touches `BoidState`, `createInitialPopulation`, or `stepBoids` directly.
- `stop`'s mutation (`simulation.ts:57-91`) calls `computeScore(input.cohesionSamples, clampedElapsedTicks)` (line 79) where `cohesionSamples` is a plain `number[]` reported by the client (via `computeCohesion` run client-side each tick, per `simulation-canvas.tsx:134`). **Conclusion**: adding a `z` dimension to `BoidState` and extending `computeCohesion`'s internal distance metric to 3D requires zero changes to `simulation.ts`, the Drizzle schema (`simulationRuns` table, `src/server/db/schema.ts:92-?`), or the `start`/`stop` procedure contracts — the z-axis is fully contained within the client-side simulation module and, if `computeCohesion` is extended, affects only the *value* of the score, not any interface.

### Canvas rendering's current no-depth state

- `drawBoids(ctx, boids)` (`simulation-canvas.tsx:41-65`) draws every boid as a fixed-size triangle: `BOID_LENGTH = 6`, `BOID_WIDTH = 4` (lines 26-27), with no per-boid scale factor anywhere in the draw call (lines 57-61 use the constants directly).
- Projection from simulation space to canvas pixels today is a flat 2D affine transform only: `x = boid.x * RENDER_SCALE + RENDER_OFFSET_X`, `y = boid.y * RENDER_SCALE + RENDER_OFFSET_Y` (lines 47-48, `RENDER_SCALE = 2` at line 21). A depth-scaled projection would need to additionally scale `BOID_LENGTH`/`BOID_WIDTH` (and optionally the x/y projection itself, for a true perspective effect) by a factor derived from each boid's `z`.
- The canvas is a fixed `600x400` (`CANVAS_WIDTH`/`CANVAS_HEIGHT`, lines 15-16); nothing in this file currently reads or writes a `z`-like value.
- `tick(timestamp)` (`simulation-canvas.tsx:122-148`) calls `stepBoids` (line 132) and `computeCohesion` (line 134) exactly once per frame with the full `boids` array — both already receive whatever shape `BoidState` has, so no call-site changes are needed in this file beyond `drawBoids`'s own scaling logic, provided `BoidState` itself grows a `z` field compatibly (additive, not a breaking rename).

### Roadmap/PRD constraints

- `context/foundation/prd.md`: FR-004 (`prd.md:81-82`) requires only that boids be observable in real time "z boidami wizualnie oznaczonymi kolorem przynależności do stada" (visually marked by flock-affiliation color) — says nothing about dimensionality, 2D or 3D. The NFR at `prd.md:129` ("A simulation with the maximum configured number of objects (FR-018) renders without visibly freezing...") is dimensionality-agnostic and would still apply to any depth-scaled rendering. No FR, NFR, or Business Logic section in this inspected document mentions "3D", "z-axis", "depth", or restricts the simulation to two dimensions.
- `context/foundation/roadmap.md`: S-01's entry (the already-implemented slice; `roadmap.md`, `### S-01` section) describes "basic boid flocking (one flock, no predators yet)" with no dimensionality statement. S-02 (predator-prey) and S-03 (genetics) entries likewise describe behavioral/population mechanics with no stated assumption that positions are 2D. **No roadmap item in this inspected file references a z-axis, depth, or 3D rendering at all** — this change is not currently represented anywhere in the roadmap's Slices/Foundations list.

## Code References

- `src/server/simulation/boids.ts:1-7` — `BoidState` type (2D only).
- `src/server/simulation/boids.ts:47-59` — `createInitialPopulation` (2D seeding).
- `src/server/simulation/boids.ts:66-94` — `resolveOverlaps` (2D hard-floor constraint).
- `src/server/simulation/boids.ts:101-137` — per-boid neighbor/steering accumulation loop (2D).
- `src/server/simulation/boids.ts:208-223` — `computeCohesion` (2D centroid distance).
- `src/server/simulation/boids.ts:225-236` — `computeScore` (shape-agnostic, unaffected).
- `src/server/api/routers/simulation.ts:7` — only imports `computeScore` from `boids.ts`.
- `src/server/api/routers/simulation.ts:79` — the one call site that would be affected if `computeCohesion`'s score changes (score *value* only, not interface).
- `src/app/simulation/_components/simulation-canvas.tsx:41-65` — `drawBoids` (fixed-size rendering, no depth scale).
- `src/app/simulation/_components/simulation-canvas.tsx:47-48` — current flat x/y-to-pixel projection.

## Architecture Insights

- The boundary between the pure simulation module (`boids.ts`) and everything downstream (the tRPC router, the canvas renderer) is already clean: both consumers depend only on `BoidState`'s field names being present, not on it being exactly 2D, and on `computeScore`'s plain-data signature. This means a `z`/`vz` addition is additive and low-blast-radius for the persistence/API layer specifically — the real design work is entirely within `boids.ts` (should z be a real steering dimension or purely decorative for rendering?) and `simulation-canvas.tsx` (the depth-to-scale projection math).
- Today's steering math (separation/alignment/cohesion) is fully symmetric across `x`/`y` — every sum, average, and normalization in `stepBoids` treats both axes identically — so extending to a third axis is mechanically a matter of repeating each existing `x`/`y` line for `z`, not redesigning the algorithm.

## Historical Context (from prior changes)

- `context/changes/basic-flocking-loop/plan.md` and its Phase 1 section — the original 2D design decisions (Reynolds steering, hard-floor separation, cruise-speed clamp) this change would extend. Notably, `plan.md`'s "What We're NOT Doing" section does not mention a z-axis or 3D either — this was entirely unscoped in the original plan.
- `context/changes/basic-flocking-loop/reviews/plan-review.md` — the review that hardened several of `boids.ts`'s current guarantees (server-side `boidCount` cap, `stop` input validation bounds); any z-axis change should preserve these without reopening them.

## Related Research

- `context/changes/basic-flocking-loop/research.md` — the prior research for the slice this change extends; largely superseded for simulation internals by this document's more detailed read of the (now further-evolved) `boids.ts`, but still accurate on F-01/F-02 and tRPC/Drizzle conventions, which this change does not touch.

## Open Questions

- **Is `z` a real steering dimension or purely a rendering/visual-space extension?** The user's request ("add a z-axis... giving the flock more space to spread out") suggests `z` should be a real axis boids can move and flock along (affecting `computeCohesion`'s distance metric and all three steering forces), not just a cosmetic per-boid depth value assigned once and never updated. This is the single most consequential design decision for the plan — it determines whether `stepBoids`'s steering math needs a third dimension added throughout, or whether `z` can be a simpler, separately-evolving decorative value.
- **Does the score change if `computeCohesion` becomes 3D?** Extending the cohesion metric to include `z` changes the *numeric value* of every future run's score relative to before this change — not a determinism break (same seed+params still produce the same score), but a one-time behavioral shift worth calling out explicitly in the plan rather than treating as invisible.
- **Perspective projection formula**: "closer bigger, farther smaller" implies a scale factor as a function of `z` (e.g. `scale = baseScale / (1 + z / referenceDepth)` or similar) — no existing convention in this codebase to follow; the plan will need to pick and justify a concrete formula.
