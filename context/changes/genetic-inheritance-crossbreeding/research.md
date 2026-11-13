---
date: 2026-11-13T20:57:59+01:00
researcher: Claude Sonnet 5
git_commit: b82dd941524d0f9157f5b15737d562d80ada002f
branch: master
repository: swarm-arena
topic: "S-03: genetic inheritance and inter-flock crossbreeding — what exists, what's genuinely absent, what's undecided"
tags: [research, codebase, simulation, boids, genetics, crossbreeding, flock]
status: complete
last_updated: 2026-11-13
last_updated_by: Claude Sonnet 5
last_updated_note: "Appended a second evidence source — the user's prior Lua/LÖVE2D boids implementation at /mnt/Kids/boids_final/game/ — as design guidance (not code to port). Resolves most Open Questions with a concrete prior pattern; Q2 (crossbreeding gate) is explicitly NOT answered by it — the Lua reference has no crossbreeding toggle at all, so that part remains new design for this project."
---

# Research: S-03 genetic inheritance and inter-flock crossbreeding

**Date**: 2026-11-13T20:57:59+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: b82dd941524d0f9157f5b15737d562d80ada002f
**Branch**: master
**Repository**: swarm-arena

## Research Question

What exists today in the codebase relevant to adding genetic inheritance
(FR-006), reproduction up to the object-count cap (FR-005), and inter-flock
crossbreeding with a product-level toggle (FR-007), and what is genuinely
absent or undecided before this can be planned?

## Summary

**Nothing reproduction/gene/flock-shaped exists in the codebase today.**
`BoidState`/`PredatorState` are purely kinematic (position, velocity,
lifespan) with no gene fields, no color field, no individual ID
(`src/server/simulation/boids.ts:1-28`). There is no reproduction, birth,
offspring, or spawn logic anywhere in `src/server/simulation/` — population
only ever shrinks via starvation/predation/lifespan expiry (confirmed by a
zero-match grep across the whole directory). Color is two fixed global
constants (`BOID_FILL_COLOR`, `PREDATOR_FILL_COLOR` in
`src/styles/theme-colors.ts:12-18`), not per-entity — there is no per-boid
color to blend from today. "Flock" exists in source only as `FlockWeights`
(the three steering-tuning numbers applied uniformly to the whole
population) or as informal prose meaning "the current population" — there
is no `Flock` type, no flock ID, no sub-population data structure anywhere.
Food only depletes/regenerates (`applyHunger`,
`src/server/simulation/boids.ts:433-455`); its only "sufficient food"
branch (`nextFoodStock >= 0` at `boids.ts:443`) currently gates "skip extra
starvation decay," not growth — FR-005's reproduction trigger is entirely
new logic, not an extension of anything existing. The DB schema
(`simulationRuns`, `src/server/db/schema.ts:92-118`) and the client-side
`RunSlot` model (`src/server/simulation/run-slots.ts:9-17`) are both 100%
run-level aggregates — no per-individual record exists anywhere, consistent
with the architecture established since S-01: the client owns the
authoritative live simulation state; the server only issues `start` params
and persists the final reported state at `stop`.

This isn't a gap in an otherwise-ready plan — it's confirmation that S-03 is
the slice that introduces per-individual state, reproduction, and the
multi-flock concept from scratch. S-02's own archived plan says so
explicitly: *"Only one flock exists until S-03 (genetic
inheritance/crossbreeding introduces multiple flocks)"*
(`context/archive/2026-11-11-predator-prey-dynamics/plan.md:46-47`).

## Detailed Findings

### Current `BoidState`/`PredatorState` shape

Both types are identical in shape and purely kinematic:

```ts
export type BoidState = { x; y; z; vx; vy; vz; lifespan: number };
export type PredatorState = { x; y; z; vx; vy; vz; lifespan: number };
```
(`src/server/simulation/boids.ts:1-9`, `:20-28`)

`FlockWeights` (`boids.ts:11-15`, `{ separation, alignment, cohesion }`) is
the only "weights" concept, and it's a single object applied uniformly to
the whole population inside `stepBoids` (`boids.ts:184-188`) — not a
per-boid field. `createInitialBoids`/`createInitialPredators`
(`boids.ts:116-126`, `:128-142`) both take one shared `maxLifespan` applied
to every individual at seed time. No per-individual max-speed, steering
weight, color, or ID field exists on either type today.

### Reproduction, birth, offspring: zero matches

`grep -rniE "reproduc|offspring|birth|spawn|child" src/server/simulation/*.ts`
returns no matches in any file in that directory (`boids.ts`,
`single-run-lifecycle.ts`, `multi-run-lifecycle.ts`, `run-slots.ts`,
`rng.ts`, or any test file). Population counts only ever decrease:
`stepPredators` filters expired predators (`boids.ts:420-424`),
`applyHunger` filters starved boids (`boids.ts:447-454`), `applyPredation`
filters captured boids (`boids.ts:462-497`). `multi-run-lifecycle.ts:101`
only checks for extinction (`nextBoids.length === 0`), never growth.

### Color: two fixed global constants, not per-entity

```ts
// src/styles/theme-colors.ts:12-18
export const CANVAS_BACKGROUND = "#1e293b";
export const BOID_FILL_COLOR = "#38bdf8";
export const PREDATOR_FILL_COLOR = "#f97316";
```

Both canvas renderers read these same two constants for every entity in
their respective population — `simulation-canvas.tsx:121,129` and
`multi-simulation-stage.tsx:46`. Introducing inherited/blended color
requires adding a new field to `BoidState` and threading it through both
draw loops (they currently read the shared constant, never a per-entity
property).

### Food/resource state has no growth hook today

`applyHunger` (`boids.ts:433-455`) is the only place food is computed per
tick: `depleted = foodStock - boids.length * FOOD_CONSUMPTION_PER_BOID *
dtSeconds`, then `nextFoodStock = depleted + foodRegenRate * dtSeconds`. The
`if (nextFoodStock >= 0)` branch (`boids.ts:443`) is the only existing
"is there enough food" check in the codebase, and it only skips an *extra*
starvation-decay path on the negative side — it never triggers growth. The
function's own comment (`boids.ts:427-432`) frames food explicitly as "one
death mechanism with an accelerant, not two independent ones (FR-008)."
FR-005's "reproduce when enough food is available" is new logic end to end.

### "Flock" as a concept in code: doesn't exist yet

`grep -rni "flock" src/` matches are either the `FlockWeights` identifier
(steering-tuning parameter, consumed in `stepBoids`/`run-slots.ts`/
`single-run-lifecycle.ts`/`simulation-canvas.tsx`/`boids.ts:511`) or
informal prose/test-description usage of "flock" meaning "the whole
current population" (`boids.ts:260,285,457,548,564`;
`boids.test.ts:279,294,296,320,504,528`; `pipeline.test.ts:158,236-237,263`;
two UI page headings). There is no `Flock` type, no flock ID field, and no
data structure representing more than one sub-population within a run
anywhere in the codebase.

### No crossbreeding/flock-count parameter anywhere

- `simulationRuns` DB schema (`src/server/db/schema.ts:92-118`): every
  column is a single run-level scalar (`boidCount`, `separationWeight`,
  `alignmentWeight`, `cohesionWeight`, `maxDurationSeconds`,
  `predatorCount`, `protectionThreshold`, `foodStockInitial`,
  `foodRegenRate`, `status`, `score`, `startedAt`, `stoppedAt`) — no
  crossbreeding column, no per-individual record, no flock-count column.
- `start`'s zod input (`src/server/api/routers/simulation.ts:14-34`): the
  same nine scalar fields plus a combined-cap `.refine()` — confirmed no
  crossbreeding boolean and no flock-count field.
- `src/app/simulation/page.tsx:108-211` (single-run form) and
  `src/app/simulation/multi/page.tsx:107-162` (parallel-run form): neither
  renders a crossbreeding toggle or a flock-count input. The multi-run form
  hardcodes "no predators" defaults (`multi/page.tsx:95-103`) and only
  exposes S-01's original five fields, per its own documented scope
  boundary.

### `RunSlot` is purely run-level, no sub-population granularity

```ts
// src/server/simulation/run-slots.ts:9-17
export type RunSlot = {
  runId; seed; boidCount; weights: FlockWeights; maxDurationSeconds;
  status: "running" | "stopped"; score?: number;
};
```

One slot = one whole run, flat scalars only. The file's own header comment
calls it "a pure, framework-free model of which runs exist, their config,
their status, and which one is active" — same flat, run-as-unit model as
the DB schema, confirmed by `addSlot`/`setActive`/`markStopped`/`removeSlot`
(`run-slots.ts:34-101`) all operating on whole slots, never on anything
inside one.

## Code References

- `src/server/simulation/boids.ts:1-28` — `BoidState`/`PredatorState`, purely kinematic, no genes/color/ID
- `src/server/simulation/boids.ts:11-15,184-188` — `FlockWeights`, population-wide not per-boid
- `src/server/simulation/boids.ts:116-142` — `createInitialBoids`/`createInitialPredators`, single shared `maxLifespan`
- `src/server/simulation/boids.ts:420-497` — population-shrinking filters (expiry, starvation, predation); no growth anywhere
- `src/server/simulation/boids.ts:427-455` — `applyHunger`, the only food-sufficiency branch, gates decay not growth
- `src/server/simulation/boids.ts:508-545` — `runTick`, the composed per-tick pipeline, no reproduction step
- `src/styles/theme-colors.ts:12-18` — the two fixed, population-wide color constants
- `src/app/simulation/_components/simulation-canvas.tsx:121,129` — single-run canvas reads the shared color constants
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:46` — multi-run canvas, same pattern
- `src/server/db/schema.ts:92-118` — `simulationRuns`, 100% run-level aggregate columns
- `src/server/api/routers/simulation.ts:14-34` — `start`'s full zod input, no crossbreeding/flock-count field
- `src/app/simulation/page.tsx:108-211` — single-run form, nine fields, no crossbreeding/flock-count
- `src/app/simulation/multi/page.tsx:95-162` — multi-run form, five fields, predator/food hardcoded off
- `src/server/simulation/run-slots.ts:9-22,34-101` — `RunSlot`/`RunSlotsState`, flat run-level model

## Architecture Insights

- **Client owns live simulation state; server only issues params and
  persists the final reported outcome** — established since S-01's plan
  (`context/archive/.../basic-flocking-loop/plan.md`) and still the pattern
  today (confirmed by the DB schema and `RunSlot` both being run-level
  aggregates, never per-individual). Any new per-individual gene/color data
  this slice adds will live in client-side `BoidState` extensions by
  default, following this established pattern, unless the plan explicitly
  decides otherwise.
- **Pure-function core, DOM-free, directly unit-testable** is the
  established pattern for every piece of simulation logic (`stepBoids`,
  `applyHunger`, `computeSingleRunTick`, `computeMultiRunTick`) — a
  reproduction step should follow the same shape (pure input state →
  output state, no DOM/network), matching `boids.test.ts`'s existing test
  style.
- **FR-018's object-count cap is enforced today only at `start`-time**
  (`boidCount + predatorCount <= 500`) — nothing currently re-checks the
  cap mid-run, because nothing currently grows the population mid-run.
  Reproduction will need a new runtime enforcement point.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-predator-prey-dynamics/plan.md:18` — "No
  predator type, no food/hunger concept, no multi-flock concept exist."
  (pre-S-02 state)
- `context/archive/2026-11-11-predator-prey-dynamics/plan.md:46-47` —
  **"Only one flock exists until S-03 (genetic inheritance/crossbreeding
  introduces multiple flocks). 'Flock size' for the protection-threshold
  check in this slice means the total count of currently-alive boids —
  there is nothing else it could mean yet."** This is the clearest prior
  signal that multi-flock is S-03's job, deliberately deferred.
- `context/archive/2026-11-11-predator-prey-dynamics/plan.md:68` — "No
  predator reproduction, no boid reproduction, no genetic inheritance
  (S-03)." Confirms FR-005's *predator* reproduction (not just boid
  reproduction) is also this slice's responsibility, not already covered.
- `context/archive/2026-11-11-parallel-sim-switching/plan.md:101` — just
  documents the same flat `RunSlot` shape found in `run-slots.ts`; no
  flock/gene discussion in that plan.
- `context/foundation/roadmap.md:127` — S-03's stated outcome: "User sees
  the population reproduce with individually inherited genes (including a
  blended color when parents differ), and can toggle inter-flock
  crossbreeding on or off."
- `context/foundation/roadmap.md:134` — the PRD's explicit guardrail this
  slice must hold: "a run with crossbreeding disabled must never produce a
  blended-flock-color offspring."
- `context/foundation/prd.md:86-91` (FR-005/FR-006/FR-007, Polish original)
  — FR-006: "każdy boid ma własny, indywidualny zestaw genów (maks.
  prędkość, długość życia, wagi separacji/kohezji/wyrównania itd.); stado
  definiuje jedynie wartości średnie podane jako parametr wejściowy, od
  których startują osobniki. Potomek dziedziczy geny po obu rodzicach,
  łącznie z kolorem będącym blendem kolorów rodziców." (each boid has its
  own individual gene set — max speed, lifespan, separation/cohesion/
  alignment weights, etc.; the flock only defines the starting average
  values given as an input parameter; offspring inherits genes from BOTH
  parents, including a color that's a blend of the parents' colors.) This
  confirms a **two-parent** reproduction model, not asexual cloning.

## Related Research

None — this is the first research document for this change, and no other
active `context/changes/**/research.md` touches genetics/flocks/crossbreeding.

## Additional Evidence: Prior Lua Implementation (user-supplied, 2026-11-13)

The user pointed to their own prior LÖVE2D/Lua boids simulation at
`/mnt/Kids/boids_final/game/` as design guidance (explicitly *not* code to
port — this project stays TypeScript, keeps the existing 10x-skillset
pure-function/client-authoritative architecture). It already implements
genetics, sexual reproduction, and two species (boid + predator), so it
answers most of the open questions below with a concrete, battle-tested
pattern — while also revealing that one PRD requirement (the crossbreeding
toggle) has **no precedent there at all**.

- **Gene representation** (`Boid.lua:79-102`, `config.lua:46-67`): a flat
  table — `tribe`, `color` (RGB triple), `maxSpeed`/`minSpeed`/`maxForce`,
  five squared-perception-radius genes (`sepPerceptionSq`,
  `aliPerceptionSq`, `cohPerceptionSq`, `predPerceptionSq`,
  `foodPerceptionSq`), `hardSepRadiusSq`, `safetyRadiusSq`, burst-speed
  multipliers, `matePreference`, and five per-behavior force multipliers.
  Non-inherited per-instance fields: `pos`/`vel`/`acc`, `energy`,
  `gender` (randomized fresh at birth, **never inherited**).
- **Reproduction trigger** (`Boid.lua:503-537`, `config.lua:9,14,37`): a
  combination of (a) individual energy ≥ a threshold, (b) population cap
  not yet hit, (c) a global resource-ratio floor (food/maxFood for boids;
  opposite-population ratio for predators). Checked every tick, no
  cooldown or probability roll for boids.
- **Mate selection** (`Boid.lua:511-527`): sexual, two parents required,
  opposite gender, within a mate-distance radius, **mutual color-distance
  preference** (`matePreference`, itself an evolvable gene) — first
  eligible match wins, no scoring. Predator uses the same gates plus a
  cooldown timer and a maturity/age check, and *does* score candidates
  (energy/color/distance weighted) rather than first-match
  (`Predator.lua:148-217`).
- **Inheritance rule** (`Boid.lua:19-75`): per numeric gene, arithmetic
  mean of both parents, then a per-gene independent mutation roll (~10%
  chance, ±20% multiplicative jitter). `color` is per-RGB-channel mean +
  independent per-channel mutation, clamped to [0,1] — linear RGB, no HSL.
  `tribe` is the one exception: a coin-flip pick of one parent's whole
  value, never blended.
- **Flock/species concept — and the crossbreeding gap**: three fixed
  `tribe` templates exist, but **`tribe` never gates mating eligibility in
  this implementation** — it only restricts flocking *forces*
  (separation/alignment/cohesion computed only against same-tribe
  neighbors, `Boid.lua:457`). Inter-tribe mating is implicitly always
  allowed; nothing resembling a crossbreeding on/off switch exists anywhere
  in `config.lua`/`constants.lua`. **This means the PRD's crossbreeding
  toggle (FR-007) is new design work with no prior pattern to lean on** —
  the Lua reference narrows Q1 (tribes-as-templates) but does not resolve
  Q2 at all.
- **Object-count cap**: enforced as an early-return guard right at the
  reproduction call site each tick (`if population + pendingAdds >= cap
  then return`) — not a separate pass.
- **Predator reproduction**: shares Boid's exact inheritance function
  (literal reuse), just with stricter gating (cooldown + maturity + scored
  mate selection) — not simpler, not geneless.
- **Notable absences in the Lua reference** (don't carry these over
  unexamined): no lifespan/max-age gene or old-age death for either species
  (death is starvation-only there, unlike this project's existing
  placeholder lifespan-decay mechanic from S-01/S-02); no fitness or
  genetic-diversity score anywhere; gender is never inherited.

## Open Questions

These are genuine product/design decisions, not implementation details.
The Lua reference above gives a concrete candidate answer for most; `/10x-
plan`'s interview should still confirm each explicitly with the user before
writing phases, since "a prior project did X" is inspiration, not a
requirement:

1. **How many flocks does a run start with, and how is each one
   configured?** Neither the PRD, shape-notes, nor roadmap specifies a
   "number of flocks" parameter anywhere (confirmed by grep — see Code
   References), and FR-002's parameter list has no such field. **Lua
   reference's candidate pattern**: a small fixed number (3) of
   pre-configured "tribes," each a complete base-gene template (color +
   behavior multipliers) chosen at design time, not a runtime parameter.
   Still open: does this project want a fixed count, a configurable count,
   or the alternative "one homogeneous population that diverges into
   color-lineages over generations" reading floated in the original
   research pass?
2. **What does "flock membership" mean operationally for the
   crossbreeding-disabled guardrail?** **Not answered by the Lua
   reference** — its `tribe` field never gates mating at all (see above),
   so this project has no prior pattern to lean on for the one guardrail
   the PRD explicitly calls out ("crossbreeding disabled must never produce
   a blended-flock-color offspring"). This is the single most
   load-bearing open decision for `/10x-plan`'s interview: a persistent
   `flockId` that hard-blocks cross-flock mating when the toggle is off, a
   color-distance preference gate (Lua's `matePreference` mechanic,
   repurposed to actually block rather than just bias), or something else.
3. **What exactly triggers reproduction?** **Lua reference's candidate
   pattern**: individual energy/resource threshold + population-cap check +
   a global resource-abundance-ratio floor, evaluated every tick with no
   cooldown (boid) — still needs this project's own equivalent of "energy"
   defined (today's `BoidState` has no energy field, only `lifespan`) or a
   decision to key the threshold off `foodStock` directly instead.
4. **How does two-parent mate selection work?** FR-006 confirms offspring
   inherit from *both* parents (`context/foundation/prd.md:88`). **Lua
   reference's candidate pattern**: proximity + opposite-gender + mutual
   color-preference, first-eligible-match (boid) or best-scored-match
   (predator) — a concrete, portable pairing algorithm, but needs a
   decision on which variant (or a simpler single rule for both species) to
   use here, and nothing in the current neighbor-scan logic
   (`stepBoids`'s existing O(n) pass) is reused for this today.
5. **Do predators reproduce with genes/color/crossbreeding too, or more
   simply?** **Lua reference's candidate pattern**: predators reproduce
   with the *same* inheritance machinery as boids, just gated more strictly
   (cooldown + maturity/age + scored mate selection vs. boid's first-match)
   — not a simpler, geneless mechanic. This directly answers the PRD's
   FR-005 predator-reproduction requirement in a way consistent with
   FR-006's general inheritance rule; still a product decision to confirm
   adopting this symmetry rather than a simpler predator-only rule.
6. **Runtime enforcement of FR-018's object-count cap during
   reproduction.** **Lua reference's candidate pattern**: an early-return
   guard checked at the reproduction call site itself each tick, before
   attempting to find a mate — simple and directly portable; low-risk to
   just adopt.

Additional questions raised by the Lua reference, not in the original pass:

7. **Does this project want a "maturity"/age-based reproduction gate (like
   Predator's `predMaturityAge`), or should every individual be eligible
   once the energy/resource threshold is met (like Lua's Boid)?** Ties into
   whether "age" becomes a new tracked field distinct from the existing
   `lifespan` countdown.
8. **Should "energy" become an explicit new field on `BoidState`/
   `PredatorState` (as it is in the Lua reference, separate from
   lifespan), or should reproduction eligibility key off the existing
   `lifespan` and/or `foodStock` fields instead, avoiding a new per-entity
   field?** The current codebase has no energy concept at all (only
   lifespan countdown + a shared `foodStock` pool) — this is a real
   architectural choice, not just a naming one.
9. **Should `matePreference`-style evolvable choosiness be adopted, or is
   a simpler fixed rule (e.g. always same-flock when crossbreeding is off,
   always any-flock when on) enough for this project's scope?** The Lua
   reference's mate preference is itself a mutating gene, which is an
   elegant but non-trivial mechanic beyond the PRD's literal ask.
