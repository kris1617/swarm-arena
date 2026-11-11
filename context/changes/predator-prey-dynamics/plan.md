# Predator-Prey Dynamics Implementation Plan

## Overview

Add predators to the existing single-flock boids simulation: predators hunt boids, boids flee
nearby predators, a flock at or below a configurable protection threshold is immune to attack,
and a global food-stock resource whose depletion accelerates boid death (hunger), alongside the
existing natural-lifespan death. This is roadmap slice S-02 (`predator-prey-dynamics`),
prerequisite S-01 (done), covering PRD FR-005 (partial — death/food only, reproduction is
S-03), FR-008 (lifespan + hunger-accelerated death), and FR-009 (protection threshold).

## Current State Analysis

- `src/server/simulation/boids.ts` simulates one flock of `BoidState` (3D, toroidal x/y/z)
  via `stepBoids` (separation/alignment/cohesion steering, hard-floor overlap resolution,
  cruise-speed clamp, lifespan decay + removal), `computeCohesion` (circular-mean-based
  flock tightness metric), and `computeScore` (`elapsedTicks * averageCohesion`). No predator
  type, no food/hunger concept, no multi-flock concept exist.
- `src/server/db/schema.ts`'s `simulationRuns` table stores exactly S-01's input parameters
  (`boidCount`, 3 weights, `maxDurationSeconds`) plus run state (`seed`, `status`, `score`,
  timestamps). No predator/food columns.
- `src/server/api/routers/simulation.ts`'s `start`/`stop` procedures mirror that same
  parameter set 1:1; `start` enforces `boidCount <= 500` server-side (FR-018 guardrail, fixed
  in S-01's plan review) and generates the run's seed.
- `src/app/simulation/_components/simulation-canvas.tsx` runs the per-frame loop: calls
  `stepBoids`, samples `computeCohesion`, draws via a depth-scaled canvas routine (closer
  boids render bigger, using `REFERENCE_DEPTH`/`MIN_SCALE`/`MAX_SCALE`, back-to-front sorted
  by `z`), and calls `stop` when `maxDurationSeconds` elapses or the population is wiped out.
- `src/app/simulation/page.tsx` has the S-01 form (boid count + 3 weights + duration) and
  renders `SimulationCanvas` once a run starts.
- `src/styles/theme-colors.ts` holds `CANVAS_BACKGROUND`/`BOID_FILL_COLOR` as the
  canvas-only color tokens (hand-kept in sync with `globals.css`, per `ui-simulation-tokens`'
  established pattern — no literal colors in the view).
- `src/server/simulation/boids.test.ts` deterministically tests `stepBoids`/`computeCohesion`/
  `computeScore` with fixed seeds — the pattern this plan's new tests extend.

### Key Discoveries

- FR-008 is explicitly one death mechanism, not two independent ones ("hunger accelerates
  death" — PRD: "to nie są w pełni niezależne mechanizmy"). The plan applies hunger as an
  *extra* lifespan decay layered on top of the existing per-tick decay, never a separate
  death check.
- The PRD's own US-01 acceptance criterion — "a flock at or below the protection threshold is
  never attacked by a predator" — is the one invariant this slice must prove with an automated
  test, not just visually.
- Only one flock exists until S-03 (genetic inheritance/crossbreeding introduces multiple
  flocks). "Flock size" for the protection-threshold check in this slice means the total count
  of currently-alive boids — there is nothing else it could mean yet.

## Desired End State

Starting a simulation spawns both boids and predators. Predators steer toward the nearest
boid and move faster than boids' cruise range; boids steer away from a predator once it's
within detection range. While the alive-boid count is at or below the configured protection
threshold, no predator may capture a boid. Above the threshold, a predator within capture
range of a boid kills it instantly (removed like a lifespan expiry). A global food-stock value
depletes with population size and partially regenerates each tick; when it can't cover the
population, boids age faster than normal. Predators are visually distinct from boids (separate
color token + shape). The existing score formula is untouched — predator effects only show up
indirectly through survival time.

Verified by: `npm run typecheck`, `npm run check`, `npx vitest run src/server/simulation/boids.test.ts`,
and manually starting a run with a small population and threshold to watch predators hunt,
flee behavior trigger, and the threshold hold (no captures at/below it).

## What We're NOT Doing

- No predator reproduction, no boid reproduction, no genetic inheritance (S-03).
- No admin-configurable parameter ranges, no save/resume, no full 3-part score (S-04).
- No spatial food particles rendered on the canvas — food is a single per-run scalar, not an
  entity. No per-boid food-seeking steering.
- No predator hunger/energy mechanic and no post-kill cooldown — predators die only from
  natural lifespan expiry in this slice (the "instant kill, no energy transfer" decision
  means predator survival is never tied to hunting success here).
- No change to `computeScore` or the scoring formula — that stays S-04's explicit scope.
- No per-boid local-neighborhood protection check — the threshold compares against total
  alive-boid count only.

## Implementation Approach

Extend `boids.ts` with a `PredatorState` type and four composable step functions (hunt
steering, flee steering folded into the existing `stepBoids`, hunger/food, predation/capture)
run in a fixed order each tick, rather than one monolithic function — mirrors the existing
`stepBoids` → `resolveOverlaps` composition already in the file. Persist the new run-input
parameters as discrete typed columns on `simulationRuns`, matching every existing column's
pattern. Render predators through a second semantic color token plus a distinct shape,
reusing the existing depth-scaled triangle routine's structure.

## Phase 1: Simulation engine — predators, flee/hunt steering, hunger, protection threshold

### Overview

Add predator state and behavior, prey flee steering, the global food-stock/hunger mechanic,
and the protection-threshold capture rule to `boids.ts`, with deterministic tests — including
the PRD's named acceptance criterion.

### Changes Required

#### 1. Predator type, constants, and creation

**File**: `src/server/simulation/boids.ts`

**Intent**: Give predators their own state shape and tuning constants, and a way to spawn an
initial population, mirroring `BoidState`/`createInitialPopulation`.

**Contract**: Export `PredatorState` (`x`/`y`/`z`, `vx`/`vy`/`vz`, `lifespan` — same shape as
`BoidState`, no hunger field on predators per the "no predator hunger" scope decision above).
Export `createInitialPredators(count, rng, maxLifespan): PredatorState[]`, spawning over the
same `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` volume as boids. New constants, faster than boids'
`MIN_SPEED`/`MAX_SPEED` (15–40) so a predator can close the gap on a fleeing boid:
`PREDATOR_MIN_SPEED = 20`, `PREDATOR_MAX_SPEED = 55`. New `CAPTURE_RADIUS = 6` (just above
`MIN_SEPARATION_DISTANCE`, well below `SEPARATION_RADIUS`) for the predation check in change 4.

#### 2. Predator hunt steering

**File**: `src/server/simulation/boids.ts`

**Intent**: Each tick, every predator steers toward its nearest living boid (straight-line
pursuit, no separation/alignment/cohesion among predators — out of scope for this slice) and
cruises within its own speed bounds, wrapping toroidally like boids.

**Contract**: Export `stepPredators(predators: PredatorState[], boids: BoidState[], dtSeconds: number): PredatorState[]`.
Per predator: find the nearest boid by `wrappedDelta`-aware 3D distance (reuse the existing
`wrappedDelta`/`wrap` helpers — do not duplicate the minimum-image logic); steer as a unit
vector toward it scaled by the same `STEERING_FORCE_SCALE` convention as `stepBoids`; clamp
resulting speed to `[PREDATOR_MIN_SPEED, PREDATOR_MAX_SPEED]`; wrap position; decay `lifespan`
by `dtSeconds`; filter out predators whose `lifespan <= 0`. A predator with no boids left to
target (empty `boids`) holds its current heading unsteered rather than erroring.

#### 3. Prey flee steering

**File**: `src/server/simulation/boids.ts`

**Intent**: A boid within detection range of any predator steers away from the nearest one,
strongly enough to override normal flocking — a predator nearby should visibly scatter a
flock, not get casually absorbed into cohesion.

**Contract**: `stepBoids` gains a new parameter, `predators: PredatorState[]` (defaults to `[]`
so the existing test calls that omit it keep compiling and behaving identically). New constants
`PREDATOR_DETECTION_RADIUS = 50` (between `SEPARATION_RADIUS` and `NEIGHBOR_RADIUS`) and a fixed
`FLEE_WEIGHT = 2` (not a user-tunable `FlockWeights` field — same class as
`STEERING_FORCE_SCALE`, an engine constant). When a predator is within
`PREDATOR_DETECTION_RADIUS` of a boid, add a unit vector pointing away from the nearest such
predator to that boid's steering sum, weighted by `FLEE_WEIGHT`, before the existing
speed-clamp step. No predators in range → behavior is bit-for-bit identical to today.

#### 4. Food stock, hunger, and protection-threshold predation

**File**: `src/server/simulation/boids.ts`

**Intent**: Maintain a single global food-stock number across ticks; when it can't cover the
current boid population, boids age faster. Separately, let predators capture boids only when
the alive-boid count exceeds the protection threshold.

**Contract**: Export two pure functions (no module-level mutable state — callers thread the
values through, matching this file's existing pure-function style):

- `applyHunger(boids: BoidState[], foodStock: number, dtSeconds: number, foodRegenRate: number): { boids: BoidState[]; foodStock: number }`.
  New constants `FOOD_CONSUMPTION_PER_BOID = 0.5` (stock units/boid/second) and
  `FOOD_REGEN_RATE` is a caller-supplied parameter (not a constant — it's one of the new
  persisted run parameters from Phase 2), `HUNGER_EXTRA_DECAY_RATE = 1` (extra lifespan
  units/second, layered on top of the unconditional per-tick decay `stepBoids` already applies
  — never a separate death check, per FR-008). Depletes `foodStock` by
  `boids.length * FOOD_CONSUMPTION_PER_BOID * dtSeconds`, then regenerates by the caller's
  regen-rate parameter; when the resulting stock is negative, subtracts an extra
  `HUNGER_EXTRA_DECAY_RATE * dtSeconds` from every boid's `lifespan` and filters out any that
  drop to `<= 0`.
- `applyPredation(boids: BoidState[], predators: PredatorState[], protectionThreshold: number): BoidState[]`.
  If `boids.length <= protectionThreshold`, returns `boids` unchanged — this is the PRD's
  named invariant. Otherwise, for each predator, finds the nearest boid within
  `CAPTURE_RADIUS` (if any) and removes it (instant kill, no cooldown/energy transfer per the
  "What We're NOT Doing" scope). A boid already captured by an earlier predator in the same
  tick is not captured again.

### Critical Implementation Details

**Per-tick ordering.** The four step functions must run in this fixed order inside the
canvas's tick loop (Phase 3 wires this): `stepBoids` (with `predators` passed in for flee
steering) → `stepPredators` → `applyHunger` → `applyPredation`. Predation must run after both
populations have moved this tick, so capture-range checks use current-tick positions; hunger
runs before predation so a boid that starved this tick is already removed and cannot also be
"captured" redundantly by the same tick's predation pass.

### Success Criteria

#### Automated Verification

- `npx vitest run src/server/simulation/boids.test.ts` passes, including new tests:
  - A flock at or below the protection threshold, with a predator placed adjacent and long
    boid/predator lifespans (isolating predation from natural death), never loses a boid
    across several ticks of `applyPredation`.
  - The same setup with the flock *above* the threshold does lose a boid to a nearby predator
    — proving the mechanism actually fires, not just stays inert.
  - A boid within `PREDATOR_DETECTION_RADIUS` of a predator steers measurably away from it
    (mirrors the existing separation test's before/after distance comparison).
  - `stepPredators` clamps predator speed into `[PREDATOR_MIN_SPEED, PREDATOR_MAX_SPEED]`
    regardless of starting speed (mirrors the existing boid speed-clamp test).
  - `applyHunger` applies the extra hunger decay only when `foodStock` goes negative, and
    none when it stays non-negative (contrast test).
  - `stepBoids` called without a `predators` argument behaves identically to its current
    (pre-change) test expectations — confirms the default-empty-array backward-compat claim.
- `npm run typecheck` passes.
- `npm run check` passes.

#### Manual Verification

- None for this phase — it's pure simulation logic with no rendering yet; Phase 3 carries the
  manual visual check.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Persistence & API — predator/food parameters

### Overview

Add the new run-input parameters to the database schema and the `start` procedure, plus a
server-side FR-018 total-object-count guardrail covering boids + predators together.

### Changes Required

#### 1. Schema columns

**File**: `src/server/db/schema.ts`

**Intent**: Persist the new run-input parameters as discrete typed columns on
`simulationRuns`, matching every existing column (`boidCount`, `separationWeight`, etc.) —
these are inputs to a run, not live mid-run state, same as the S-01 parameters.

**Contract**: Add `predatorCount` (integer, not null), `protectionThreshold` (integer, not
null), `foodStockInitial` (real, not null), `foodRegenRate` (real, not null) to the
`simulationRuns` table definition. Run `npm run db:push` to apply (no migration history exists
yet for this table — see S-01's precedent).

#### 2. `start` procedure input and insert

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Accept and persist the four new parameters, and enforce the combined FR-018 object
cap across boids + predators (extending the existing `boidCount <= 500` guardrail rather than
duplicating a second, inconsistent limit).

**Contract**: `start`'s input schema gains `predatorCount: z.number().int().nonnegative().max(500)`,
`protectionThreshold: z.number().int().nonnegative()`, `foodStockInitial: z.number().positive()`,
`foodRegenRate: z.number().nonnegative()`, plus a `.refine()` (or equivalent) rejecting
`boidCount + predatorCount > 500` — the same 500 ceiling `boidCount` alone already enforces,
now covering the total. The insert into `simulationRuns` passes all four new fields through
unchanged, same as the existing fields.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes.
- `npm run check` passes.
- A request with `boidCount + predatorCount > 500` is rejected by the `start` procedure's
  input validation (covered by a Vitest test alongside any existing router tests, or verified
  via the Phase 3 manual check if no router test file exists yet for this router).

#### Manual Verification

- None for this phase — covered by Phase 3's end-to-end manual check.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Rendering & UI — predator visuals and form fields

### Overview

Render predators distinctly from boids on the canvas, and expose the four new parameters in
the simulation setup form, wiring the Phase 1 step functions into the per-frame tick loop in
the required order.

### Changes Required

#### 1. Predator color token

**File**: `src/styles/theme-colors.ts`

**Intent**: Add a second canvas-only color constant for predators, following this file's
existing pattern (hand-kept in sync with `globals.css`, no literal colors in the view layer).

**Contract**: Export `PREDATOR_FILL_COLOR`, a hex value visually distinct from
`BOID_FILL_COLOR` (`#38bdf8`) against `CANVAS_BACKGROUND` (`#1e293b`) — e.g. a warm tone
(red/orange family) contrasting with the existing cool blue, consistent with a
"predator = danger" visual convention.

#### 2. Predator rendering

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Draw predators using the distinct color token *and* a distinct shape (per the
"both color and shape" decision, for robustness beyond color alone), reusing the existing
depth-scaled, back-to-front-sorted triangle routine's structure rather than duplicating the
depth-scale math.

**Contract**: `drawBoids` (or a renamed/extended equivalent covering both populations) accepts
both `boids: BoidState[]` and `predators: PredatorState[]`, merges them into one
z-sorted draw list tagged by type, and for predators uses `PREDATOR_FILL_COLOR` and a visibly
different shape (e.g. a wider/diamond silhouette vs. the boid's narrow triangle) at the same
depth-scale factor. Component state gains a `predatorsRef` (mirroring `boidsRef`) and a
`foodStockRef` (mirroring `elapsedSecondsRef`), seeded from the new props in change 4.

#### 3. Tick loop wiring

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Run the Phase 1 functions in their required fixed order every frame, replacing the
current bare `stepBoids` call.

**Contract**: The `tick` function's per-frame body becomes: `stepBoids(boids, weights,
dtSeconds, predators)` → `stepPredators(predators, boids, dtSeconds)` → `applyHunger(boids,
foodStock, dtSeconds, foodRegenRate)` → `applyPredation(boids, predators, protectionThreshold)`
— see Phase 1's Critical Implementation Details for why this exact order matters. The existing
"stop when population is wiped out or duration elapses" condition now also triggers on
predators-caused depletion (it already checks `nextBoids.length === 0`, which composes
unchanged with the new predation step).

#### 4. Setup form fields

**File**: `src/app/simulation/page.tsx`

**Intent**: Let the user set the four new parameters before starting a run, following the
existing labeled-`Input` pattern (`htmlFor`/`id` pairs, token-based classNames) exactly.

**Contract**: Four new `Input` fields — predator count, protection threshold, initial food
stock, food regen rate — with accompanying `useState` and passed through `startRun.mutate(...)`
and into `ActiveRun`/`SimulationCanvas` props, mirroring `boidCount`'s existing clamp-on-submit
pattern (`Math.min(Math.max(...), ...)`) for predator count against the same 500 ceiling used
server-side in Phase 2.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes.
- `npm run check` passes.
- `npx vitest run` (full suite) passes.

#### Manual Verification

- Starting a run with a small boid count, a few predators, and a low protection threshold:
  predators visibly hunt (distinct color + shape, moving toward boids), boids visibly scatter
  when a predator closes in, and population never drops below the configured protection
  threshold via predation (only via hunger/age, if at all, once below the threshold).
- Starting a run with the same setup but a protection threshold of 0 (or population well
  above any reasonable threshold): predators do capture boids over time, visibly reducing the
  population count.
- No regression in the S-01 happy path (no predators / predator count 0): simulation behaves
  exactly as before.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests

- Protection-threshold invariant (at/below → never attacked; above → does get attacked) —
  the PRD's named acceptance criterion.
- Flee steering direction, predator speed clamp, hunger-triggered extra decay vs. no decay
  when food stock is non-negative, `stepBoids` backward-compatibility with no `predators` arg.

### Integration Tests

- None added — no router test file exists yet for `simulation.ts`; the FR-018 combined-cap
  rejection is covered either by a new lightweight router test or, if that infrastructure
  isn't already in place, documented as a manual check in Phase 2.

### Manual Testing Steps

1. Start a run with predators and a threshold above the boid count — confirm no captures.
2. Start a run with predators and a threshold of 0 — confirm captures happen and population
   drops.
3. Watch for visibly distinct predator rendering and flee behavior.
4. Re-run the S-01 happy path with predator count 0 — confirm no regression.

## Performance Considerations

Predator hunt steering and predation checks are each an additional O(boids × predators) pass
per tick, on top of `stepBoids`'s existing O(boids²) neighbor pass. At the existing 500-object
FR-018 ceiling (now shared between boids and predators) this stays well within the same
order of magnitude already proven acceptable in S-01 — no new performance work needed this
slice.

## Migration Notes

No existing `simulation_run` rows need backfilling — no real runs have been created against
this schema yet (single-user hobby project, pre-launch of this feature). `npm run db:push`
applies the new not-null columns directly.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-02: Predator-prey dynamics with flock
  protection.
- Prior slice (pattern to follow): `context/changes/basic-flocking-loop/plan.md`.
- Existing engine: `src/server/simulation/boids.ts`.
- Existing tests (style to match): `src/server/simulation/boids.test.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Simulation engine — predators, flee/hunt steering, hunger, protection threshold

#### Automated

- [x] 1.1 Protection-threshold invariant: never attacked at/below threshold — 0cafe2f
- [x] 1.2 Protection-threshold invariant: does get attacked above threshold — 0cafe2f
- [x] 1.3 Flee steering moves a boid away from a nearby predator — 0cafe2f
- [x] 1.4 Predator speed clamps into PREDATOR_MIN_SPEED/MAX_SPEED — 0cafe2f
- [x] 1.5 Hunger applies extra decay only when foodStock goes negative — 0cafe2f
- [x] 1.6 stepBoids with no predators arg is behavior-identical to pre-change tests — 0cafe2f
- [x] 1.7 npm run typecheck passes — 0cafe2f
- [x] 1.8 npm run check passes — 0cafe2f

### Phase 2: Persistence & API — predator/food parameters

#### Automated

- [x] 2.1 npm run typecheck passes — de94ca4
- [x] 2.2 npm run check passes — de94ca4
- [x] 2.3 boidCount + predatorCount > 500 is rejected by start's input validation — de94ca4

### Phase 3: Rendering & UI — predator visuals and form fields

#### Automated

- [x] 3.1 npm run typecheck passes — 5e0a9d8
- [x] 3.2 npm run check passes — 5e0a9d8
- [x] 3.3 npx vitest run (full suite) passes — 5e0a9d8

#### Manual

- [x] 3.4 Predators hunt, boids flee, threshold holds (no captures at/below it)
- [x] 3.5 Predators do capture boids when population is above threshold
- [x] 3.6 S-01 happy path (predator count 0) shows no regression
