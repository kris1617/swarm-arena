# Pseudo-3D depth rendering — Plan Brief

> Full plan: `context/changes/pseudo-3d-depth-rendering/plan.md`
> Research: `context/changes/pseudo-3d-depth-rendering/research.md`

## What & Why

Add a real z-axis to the boids simulation (not just a decorative rendering trick) so the flock separates, aligns, and coheres in 3D — giving it genuine room to spread out, as requested — then render depth via a perspective-style scale (closer boids bigger, farther smaller) with correct back-to-front occlusion.

## Starting Point

The simulation (`src/server/simulation/boids.ts`) and renderer (`src/app/simulation/_components/simulation-canvas.tsx`) are strictly 2D today, built and hardened in `basic-flocking-loop`. Research confirmed the persistence/API layer (`simulation.ts`, the Drizzle schema) has zero structural dependency on `BoidState`'s dimensionality — this change is fully contained to the simulation module and the renderer.

## Desired End State

Boids move and flock through a real 3D space; the canvas renders each one at a size reflecting its depth (closer = bigger, farther = smaller), drawn back-to-front so nearer boids correctly occlude farther ones at overlapping screen positions. The flock still flocks (no collapse, no dispersal) — now verified in 3D, not just 2D.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Z's role | Real 3D steering dimension (not decorative) | A decorative-only z wouldn't actually give the flock more room to flock in — it'd just be a visual trick with no behavioral effect | Plan |
| Hard-floor extension | Extend `resolveOverlaps` to 3D | Consistent with z being a real spatial dimension; boids should be able to resolve crowding by spreading in z | Plan |
| Score impact | `computeCohesion` becomes 3D (score values change going forward) | A score blind to a real flocking axis would call a flock "cohesive" when it's actually spread along z | Plan |
| Projection formula | `scale = REFERENCE_DEPTH / (REFERENCE_DEPTH + z)`, clamped | Standard perspective-style falloff; clamping bounds the near-z blow-up | Plan |
| Space sizing | Keep x/y area (200) unchanged; z is additive room | Changing x/y area now would reopen the just-stabilized cruise-speed/steering-scale tuning from the prior change | Plan |
| Testing | Mirror every existing 2D regression test with a 3D variant | Each 2D test exists because that exact bug was found once; the z axis deserves the same guard | Plan |

## Scope

**In scope:**
- `z`/`vz` on `BoidState`, seeded in `createInitialPopulation`
- 3D separation/alignment/cohesion steering, 3D hard-floor overlap resolution, 3D cruise-speed clamp
- 3D `computeCohesion` (score-relevant)
- Depth-scaled triangle rendering + back-to-front draw order
- 3D-mirrored regression tests for collapse, overlap, and multi-seed convergence

**Out of scope:**
- Full 3D camera/parallax projection — only triangle size scales with depth; x/y pixel mapping is unchanged
- Shrinking the x/y simulation area to compensate for the new z-room
- Any change to `simulation.ts`, the Drizzle schema, or tRPC contracts — confirmed unnecessary
- Re-tuning S-02/S-03 (predator-prey, genetics) for 3D
- A new user-facing z-axis parameter — z uses the existing `FlockWeights`

## Architecture / Approach

Two phases: (1) extend every piece of `boids.ts`'s steering/constraint/scoring math to include z, mirroring the existing x/y pattern exactly (including the unit-vector-normalization and cruise-speed-clamp fixes already hardened in 2D) — re-verifying the multi-seed convergence test is what confirms the existing tuned constants still hold once speed/distance are measured in 3D; (2) extend the canvas renderer with a depth-to-scale projection and back-to-front draw ordering, with no changes needed at `stepBoids`/`computeCohesion`'s call sites since their external signatures don't change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. 3D simulation core | z as a real flocking dimension, 3D-tested | Existing tuned constants (speed/steering/radii) may need retuning once measured in 3D instead of 2D — the convergence test is the gate for this |
| 2. Depth-scaled rendering | Perspective scale + correct occlusion | None significant — isolated to one rendering function, no simulation-math risk |

**Prerequisites:** `basic-flocking-loop` (implemented and committed).
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- If the existing speed/steering/radius constants don't hold up in 3D (the convergence test fails), Phase 1 includes retuning them — this is accepted as part of the phase, not a separate change, since it's the same kind of tuning already done once in 2D.
- Scores produced after this ships aren't directly comparable to scores from before it (cohesion now counts z) — not a determinism break, just a one-time behavioral shift, consistent with FR-010's exact scoring formula already being an open PRD question rather than frozen.
- The projection is a simplified depth cue (size only), not a full 3D camera — accepted as sufficient for "pseudo-3D" per the original request's framing.

## Success Criteria (Summary)

- The flock genuinely flocks in 3D (cohesion, separation, alignment all functional along z), not just visually faked.
- Boids render with depth-correct size and occlusion.
- No regression in the 2D guarantees already hardened in `basic-flocking-loop` (determinism, hard non-overlap, cruise-speed convergence).
