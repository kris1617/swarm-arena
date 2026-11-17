---
date: 2026-11-17T20:01:47Z
researcher: Claude (Sonnet 5)
git_commit: 05b54b124c7bb9121924fc1116d1498efa415cde
branch: master
repository: swarm-arena
topic: "Per-tribe boid behavior data model (F-09) — full Lua-reference parity scope"
tags: [research, codebase, boids-engine, per-tribe-config, flocking, genetics]
status: complete
last_updated: 2026-11-17
last_updated_by: Claude (Sonnet 5)
---

# Research: per-tribe boid behavior data model (F-09)

**Date**: 2026-11-17T20:01:47Z
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 05b54b124c7bb9121924fc1116d1498efa415cde
**Branch**: master
**Repository**: swarm-arena

## Research Question

F-09 needs to let a boid tribe's separation/alignment/cohesion weights,
per-behavior perception radii, and behavior multipliers (predator-avoidance,
food-seeking, burst) all be configured per flock/tribe at run-start —
full parity with the Lua reference's `config.lua`. What does the current
engine already support, and what's genuinely new work?

## Summary

**The scope just chosen ("full Lua-reference parity") is substantially
larger than it may have appeared when that decision was made minutes ago,
and the three parts of it have very different risk profiles:**

1. **Weights (separation/alignment/cohesion) are nearly free.** They're
   already fully per-boid (`genes.separationWeight` etc., read directly in
   the force calculation, never a shared scalar), and a per-flock config
   vector (`FlockWeights[]`) already exists as a type — it's just populated
   with identical values for every flock today, from one flat scalar in
   `startInputSchema`. Making these genuinely vary per tribe is almost
   entirely plumbing (API/schema/UI), **not** a change to the per-tick
   force-calculation hot loop.

2. **`maxSpeed`/`minSpeed` are the same story** — already per-boid genes,
   seeded once at spawn, same low-risk plumbing-only change.

3. **Perception radii, burst, and real mate-preference-as-selector are
   genuinely new engine work, not plumbing.** Every perception radius
   (`NEIGHBOR_RADIUS`, `SEPARATION_RADIUS`, `PREDATOR_DETECTION_RADIUS`,
   etc.) is a single global constant baked directly into one spatial-grid
   build per population per tick — making these vary per tribe needs a
   real architecture change (either a max-radius grid plus a per-boid
   distance re-filter, or separate per-flock grids). The burst mechanic
   (`burstMult`/`burstCostMult`) does not exist at all — no speed-boost or
   energy-cost-multiplier logic anywhere in this codebase. `matePreference`
   exists as a heritable gene and is scored in the diversity metric, but is
   never actually read by the mate-selection loop — it's functionally inert
   today, so making it a real per-tribe selector means building selection
   logic from scratch, not extending something that exists.
   `maxForce` doesn't exist as a per-boid or per-flock concept at all —
   only a single uniform global constant (`STEERING_FORCE_SCALE`) applied
   to every boid and predator alike.

No prior change anywhere in `context/changes/**` or `context/archive/**`
discusses per-tribe/per-flock behavior differentiation — this is new
ground, confirmed by a full-repo search for those terms.

**One directly-applicable existing lesson** (`context/foundation/lessons.md`,
"UI accepts input is not feature verified"): a near-identical trap already
bit this exact trio of fields once — S-27 shipped live-adjustment for
`separationWeight`/`alignmentWeight`/`cohesionWeight` that updated the
DB/UI but never reached `genes.*` (the actual decision-time read), because
those fields are genetic, not read fresh from `run.params`. The same trap
applies here: F-09/S-40's manual verification must confirm a newly-spawned
boid in tribe N actually has tribe N's configured weight baked into its
genes — not just that the DB/API returns the right per-tribe array.

## Detailed Findings

### Weights and speed bounds are already per-boid (low-risk part)

- The per-tick force calculation (`stepBoids`, inside the per-boid `.map()`
  callback) reads directly from `boid.genes.separationWeight` /
  `.alignmentWeight` / `.cohesionWeight` (`src/server/simulation/boids.ts:606-629`)
  — never a shared/global scalar. The old shared-`FlockWeights`-as-live-value
  model is already dead; the comment at `boids.ts:17-24` confirms this.
- A per-flock config vector already exists as a *type*: `FlockWeights[]`
  (`boids.ts:11-15`, `{separation, alignment, cohesion}`), passed into
  `createInitialPopulation`/`createInitialPredators`
  (`boids.ts:301-302, 350-351`) and used **only** to seed each boid's genes
  at spawn (`boids.ts:293-296`: "Each boid's genes seed from its flock's
  FlockWeights exactly ... no variance at gen 0"). It is never re-read
  after spawn.
- Today, every element of that `FlockWeights[]` array is constructed from
  the *same* single flat scalar from `startInputSchema` — there is no
  per-tribe array anywhere between the router and `boids.ts` yet
  (`src/server/api/routers/simulation.ts:77-96`, all scalar fields).
- `maxSpeed`/`minSpeed` are the same shape: already `BoidGenes` fields
  (`boids.ts:31-32`), seeded once from global constants at spawn
  (`boids.ts:330-331, 379-380`), inherited/mutated normally
  (`boids.ts:778-779`), read per-boid in the cruise-speed clamp
  (`boids.ts:638-645`).

### Perception radii are global constants with no per-boid plumbing (new architecture)

- `NEIGHBOR_RADIUS = 70` (`boids.ts:86`, alignment/cohesion),
  `SEPARATION_RADIUS = 25` (`boids.ts:88`),
  `PREDATOR_DETECTION_RADIUS = 50` (`boids.ts:120`),
  `CAPTURE_RADIUS = 6` (`boids.ts:115`),
  `MIN_SEPARATION_DISTANCE = 4` (`boids.ts:96`),
  `COHESION_REFERENCE_RADIUS = 100` (`boids.ts:91`),
  `MATE_DISTANCE_RADIUS = 30` (`boids.ts:161`) — all fixed module-level
  constants.
- The spatial grid is built once per population per tick with a single
  radius argument: `buildSpatialGrid(boids, ..., NEIGHBOR_RADIUS, worldSize)`
  (`boids.ts:447-452`), queried via `.queryRadius({x,y,z}, NEIGHBOR_RADIUS, ...)`
  (`boids.ts:484-488`). Nothing today varies these per boid or per flock.
- Making perception radii vary per tribe needs either a max-radius grid
  with a per-boid post-filter, or separate per-flock grids — a real change
  to the neighbor-search strategy, not a config/schema change.

### Burst and real mate-preference selection don't exist at all

- No burst/speed-boost mechanic, no `burstMult`/`burstCostMult` equivalent,
  confirmed by full-file read and grep — only steady cruise-speed clamping
  exists.
- `matePreference` exists as a `BoidGenes` field (`boids.ts:34`), seeded
  randomly at spawn (`boids.ts:333, 382`), blended with mutation in
  `inheritGenes` (`boids.ts:781`), and counted in the genetic-diversity
  metric (`boids.ts:1245`) — but `reproducePopulation`'s actual mate-match
  loop (`boids.ts:827-916`) never reads it; matching is purely
  first-match-in-range by gender + flockId/crossbreeding-gate + distance.
  It is present as a heritable/scored trait but functionally inert for
  pairing decisions today.
- `maxForce` is not a concept anywhere — the only related value is the
  single global `STEERING_FORCE_SCALE = 120` (`boids.ts:103-106`), applied
  uniformly to every boid's and every predator's steering vector
  (`boids.ts:701-703` for predators too).

### flockId: immutable at birth, coin-flip (never blended) inheritance

- Assigned once per boid inside the flock-bucket spawn loop in
  `createInitialPopulation`/`createInitialPredators`
  (`boids.ts:308-334`, `346-375+`) — never mutated after creation outside
  reproduction.
- `inheritGenes` (`boids.ts:734-783`): `flockId: rng() < 0.5 ? parentA.flockId
  : parentB.flockId` (`boids.ts:768`) — a coin flip, explicitly never
  blended ("a crossbred offspring belongs to exactly one flock,"
  `boids.ts:766-768`). Every other numeric gene (weights, speed bounds,
  lifespan, matePreference, color) is blended with independent mutation
  rolls.
- The crossbreeding gate (`reproducePopulation`, `boids.ts:874-878`):
  `if (!params.crossbreedingEnabled && parentA.genes.flockId !== parentB.genes.flockId) continue;`
  — cross-flock pairs are blocked unless `crossbreedingEnabled` is true.
- `createFlockColors`/`splitCountAcrossFlocks` (`boids.ts:265-291`) return
  only color and headcount respectively — no hidden per-flock behavior
  config lives in either helper.
- `flockCount` is hard-capped `{min: 2, max: 4, default: 2}`
  (`parameter-ranges.ts:49`), confirming the per-tribe array this feature
  needs is always small (2-4 entries).

### Schema/plumbing is straightforward; validation needs new code

- `simulationRuns` already has 2 JSON-mode TEXT columns
  (`savedState: d.text({mode:"json"})` `schema.ts:144`;
  `history: d.text({mode:"json"})` `schema.ts:150`) — a new per-tribe-configs
  column follows an established pattern, not a first-of-its-kind addition.
  At the SQL/migration level a JSON-mode column is just a plain `text`
  column (`drizzle/0003_red_master_mold.sql:7`,
  `drizzle/0004_colorful_slyde.sql:1`) — no special migration syntax needed.
- `adminSettings.parameterRanges` is also already JSON-mode
  (`schema.ts:179`, `notNull()`) — a new per-tribe range shape could be
  added inside this existing column without a new typed column or migration
  on the `admin_settings` side specifically.
- `checkAgainstAdminRanges` (`simulation.ts:241-265`) iterates the fixed
  `RANGED_PARAMETER_NAMES` array reading `input[name]` as a single scalar
  per field, compared against one `{min,max}` pair. This cannot validate an
  array of N per-tribe objects as-is — genuinely new validation code
  (a nested loop over tribes × ranged fields) is needed, not a drop-in
  extension.
- `startInputSchema` has no array-shaped field today (every field is a
  scalar, `simulation.ts:77-96`) — though the general zod-array pattern is
  well established in *sibling* schemas in the same file
  (e.g. `runIds: z.array(z.number()).min(2).max(4)`, `simulation.ts:935`),
  just not yet inside `startInputSchema` itself.

## Code References

- `src/server/simulation/boids.ts:17-24` — comment confirming the
  shared-`FlockWeights`-as-live-value model is already dead.
- `src/server/simulation/boids.ts:606-629` — per-boid force calc reading
  `genes.separationWeight`/`.alignmentWeight`/`.cohesionWeight`.
- `src/server/simulation/boids.ts:11-15` — `FlockWeights` type.
- `src/server/simulation/boids.ts:293-334, 346-375` — `createInitialPopulation`/
  `createInitialPredators`, flock-bucket spawn seeding.
- `src/server/simulation/boids.ts:86-120` — fixed global perception-radius
  constants.
- `src/server/simulation/boids.ts:447-452, 484-488` — single-radius spatial
  grid build/query.
- `src/server/simulation/boids.ts:103-106, 701-703` — global
  `STEERING_FORCE_SCALE`, applied uniformly to boids and predators.
- `src/server/simulation/boids.ts:734-783` — `inheritGenes`, flockId
  coin-flip + blended numeric genes.
- `src/server/simulation/boids.ts:827-916` — `reproducePopulation`'s
  mate-match loop (no `matePreference` read).
- `src/server/simulation/boids.ts:265-291` — `createFlockColors`/
  `splitCountAcrossFlocks`.
- `src/server/simulation/parameter-ranges.ts:49` — `flockCount` hard range
  `{min:2, max:4}`.
- `src/server/db/schema.ts:144, 150, 179` — existing JSON-mode columns.
- `src/server/api/routers/simulation.ts:77-96` — `startInputSchema`
  (all-scalar today).
- `src/server/api/routers/simulation.ts:241-265` — `checkAgainstAdminRanges`.
- `drizzle/0003_red_master_mold.sql:7`, `drizzle/0004_colorful_slyde.sql:1`
  — JSON-mode-column migration precedent (plain `text`, no special syntax).

## Architecture Insights

- This codebase's genetics system has a clean "seed-time differentiation,
  no live re-lookup" pattern already proven for weights and speed bounds —
  extending it to more fields (more `FlockWeights`-shaped data) is low-risk
  and consistent with the existing design.
- The spatial-grid neighbor search, by contrast, is architected around one
  global radius per population per tick — this is a structural boundary
  this feature's "full parity" scope runs directly into, not an oversight.
- `matePreference` and `maxForce` being absent/inert isn't a bug — they
  were simply never part of the original invariant/scoring design this
  codebase was built around; adding real behavior for them is net-new
  product surface, not a fix.

## Historical Context (from prior changes)

- `context/archive/2026-11-13-genetic-inheritance-crossbreeding/plan.md`
  (lines 134-173, 479-507, 562, 639) built the original `flockCount`/
  `FlockWeights`/`createInitialPopulation` mechanism this change extends —
  it does not propose or discuss per-tribe differentiated behavior beyond
  the existing 3-weight seeding scheme.
- `context/foundation/lessons.md` ("UI accepts input is not feature
  verified", lines 61-66) — directly on-point: a live-adjustment feature
  for these exact 3 genetic fields once passed every check except the one
  that mattered (did the value reach `genes.*` at decision time). This
  change's own manual verification must apply the same rigor, scoped to
  "does spawn-time per-tribe seeding actually land in each new boid's
  genes," since the fields are genetic (seeded once), not live-read.

## Related Research

- None found under `context/changes/**/research.md` or
  `context/archive/**/research.md` addressing per-tribe behavior
  configuration specifically.

## Open Questions

1. **Given the risk-profile split found here, does the "full Lua-reference
   parity" scope choice still stand, or should it be narrowed?** The
   weights/speed-bounds part is low-risk plumbing; perception radii, burst,
   and real mate-preference selection are each separate, non-trivial new
   engine capabilities with no existing scaffolding. Owner: user — this is
   exactly the kind of scope question that should go back to the person
   who made the "full parity" call, now that its actual cost is concretely
   known, rather than silently splitting or deferring part of it inside
   `/10x-plan`.
2. **If perception radii are in scope, which grid strategy?** A max-radius
   grid with a per-boid post-filter (simpler, still one grid build) vs.
   separate per-flock grids (cleaner per-tribe isolation, more grid-build
   overhead per tick, flockCount ≤ 4 so bounded). This is an implementation
   decision for `/10x-plan`, not a blocking roadmap-level question — noting
   it here so the plan doesn't have to rediscover the tradeoff.
