# Predator Tribe Concept (F-10) — Implementation Plan

## Overview

Give predators a fully independent tribe system — their own count
(`predatorFlockCount`), their own `flockId` space, and their own per-tribe
config array (`PredatorTribeConfig[]`) — mirroring the machinery
`per-tribe-behavior-weights` (F-09) already built for boids, decoupled from
boids' own `flockCount`/`tribeConfigs[]` entirely. Two previously-vestigial
genetics fields (`genes.maxSpeed`/`genes.minSpeed`) get wired into real
predator behavior for the first time, and two new per-tribe fields
(detection radius, capture-radius multiplier) give predator tribes a
genuine behavioral identity. No new UI ships in this change — `S-42`
("per-tribe-predator-config") owns exposing this through the form; this
foundation is verified directly against the engine/registry.

## Current State Analysis

- **Predators today silently reuse boids' exact tribe system.**
  `createInitialPredators` (`boids.ts:416`) and `createInitialPopulation`
  (`boids.ts:367`) are both called with the *same* `params.flockCount`/
  `params.tribeConfigs` at every call site: `server-run-registry.ts:779-792`
  (initial spawn), `:460-465`/`:479-484` (`adjustLivePopulation`'s live
  growth path), and the client-staged equivalent
  (`simulation-canvas.tsx:772,780`). There is no independent predator-tribe
  concept anywhere in the codebase — confirmed via research, not assumed.
- **`PredatorGenes` is a hard type alias**: `export type PredatorGenes =
  BoidGenes;` (`boids.ts:96`). `reproducePopulation`/`inheritGenes`
  (`boids.ts:945`, `:887`) are already fully generic across both species —
  this change does not touch them.
- **Confirmed dead code / stale comment**: `BoidGenes`'s own doc comment
  (`boids.ts:58-65`) claims `maxSpeed`/`minSpeed` "replace the global
  MAX_SPEED/MIN_SPEED (or PREDATOR_MAX_SPEED/PREDATOR_MIN_SPEED) constants
  — both are now sourced per individual." This is false for predators today:
  `stepPredators`' speed clamp (`boids.ts:858-861`) ignores
  `genes.maxSpeed`/`genes.minSpeed` entirely and hardcodes
  `PREDATOR_MIN_SPEED`/`PREDATOR_MAX_SPEED` (`boids.ts:145-146`). Predator
  genetics already inherit and mutate `separationWeight`/`alignmentWeight`/
  `cohesionWeight`/`maxSpeed`/`minSpeed` every generation with **zero
  behavioral effect** — the only genes fields with real effect today are
  `flockId`, `color`, `matePreference`, `maxLifespan`. This is the same
  "value written but never read at decision time" class of bug
  `lessons.md`'s `per-tribe-behavior-weights` entry already records for a
  different field (`matePreference`).
- **No detection-radius gate exists at all.** `stepPredators`
  (`boids.ts:820-870`) scans every boid unconditionally each tick looking
  for the nearest one (`boids.ts:835-847`) — no radius bound, no per-tribe
  awareness, no `rng` parameter. A predator with literally zero boids in
  the world holds its current heading unsteered (the existing `nearestDist
  === Infinity` fallback, `boids.ts:847-849`) — this is the only "no
  target" case the engine has ever had to handle.
- **`applyPredation`** (`boids.ts:1141-1180`) queries a fixed
  `CAPTURE_RADIUS` (`boids.ts:150`, value `6`) per predator with no
  per-tribe scaling.
- **The boid-side precedent to mirror** (`per-tribe-behavior-weights`,
  archived at `context/archive/2026-11-17-per-tribe-behavior-weights/`):
  - `TribeConfig` (`boids.ts:33-56`) full current shape: `separation`,
    `alignment`, `cohesion`, `maxSpeed`, `minSpeed`, `matePreference`,
    `neighborRadius`, `separationRadius`, `predatorDetectionRadius`,
    `burstMult`, `burstCostMult`, `foodStockShare`, `foodRegenShare`,
    `foodConsumptionRate`. None of the boid-only fields
    (`predatorDetectionRadius`, `burstMult`, `burstCostMult`, the 3 food
    fields) have a predator analog — `PredatorTribeConfig` is its own type,
    sharing only the genuinely-common subset.
  - `flockId` assignment is a contiguous block split via
    `splitCountAcrossFlocks(count, flockCount)` (`boids.ts:348-354`), not
    `index % flockCount` — `createInitialPredators` already uses this
    helper (`boids.ts:428`-ish) with `tribeConfigs[flockId]` seeding
    (`boids.ts:443-453`); this change only needs to point it at an
    independent `predatorTribeConfigs`/`predatorFlockCount` instead.
  - `TRIBE_RANGED_FIELD_NAMES` (`parameter-ranges.ts:51-61`) is the sibling
    const feeding both `RANGED_PARAMETER_NAMES` and
    `checkAgainstAdminRanges`'s nested per-tribe loop
    (`simulation.ts:310-321`) — **one shared range across all tribes**, an
    explicit decision, not an oversight.
  - `tribeConfigSchema` (`simulation.ts:86`) is a flat `z.object` with every
    field `z.number().finite()`, reused by both `startInputSchema` and the
    live-edit mutation's input — avoids two schemas drifting.
  - `applyLiveTribeConfigs` (`server-run-registry.ts:311-364`) is a
    **wholesale array replace** (`run.params = {...run.params, tribeConfigs:
    patch}`), not a per-field patch, with one simplified `ParameterChangeEntry`
    marker (`field: "tribeConfigs", oldValue: 0, newValue: 1`) since an array
    doesn't fit the numeric before/after shape. `foodStockShare`'s delta-
    injection (`:342-361`) is a special case for a live mutable resource
    pool — the new predator-tribe fields (detection radius, capture
    multiplier) are pure multipliers/radii with no such pool, so they need
    no equivalent special case.
  - `updateTribeConfigs` (`simulation.ts:1254`-ish): ownership check,
    `status === "running"` + `isServerRunActive` check, hard length-match
    against `flockCount`, soft (warn-don't-block) range check, then calls
    `applyLiveTribeConfigs`.

## Desired End State

A run can configure `predatorFlockCount` (independent of boids'
`flockCount`) and a `predatorTribeConfigs: PredatorTribeConfig[]` array.
Each predator spawns into one of these tribes via the same contiguous-block
split boids use, inheriting that tribe's starting `maxSpeed`/`minSpeed`/
`matePreference`/flocking-weight values into its genes exactly as boids do.
`stepPredators` now actually reads each predator's own `genes.maxSpeed`/
`genes.minSpeed` for its speed clamp (replacing the fixed constants), gates
its nearest-boid search by that predator's own tribe's detection radius
(no boid in range → small random wander force, not a frozen heading), and
`applyPredation` scales `CAPTURE_RADIUS` by that predator's own tribe's
capture-radius multiplier. A running simulation's predator tribes can be
live-edited the same way boid tribes already can. Verified entirely by a
direct script against the registry (no UI exists yet for this).

### Key Discoveries

- Predators and boids reproduce through the exact same generic
  `reproducePopulation`/`inheritGenes` with no same-tribe mating
  restriction for boids today (`inheritGenes`'s `flockId` coin-flip,
  `boids.ts:921`-ish) — predators get the identical unrestricted rule,
  requiring zero change to that machinery.
- `predatorCount`'s own admin range already exists
  (`parameter-ranges.ts:92`: `{min:0, max:500, default:5}`) and is
  untouched by this change — only `predatorFlockCount` is new.

## What We're NOT Doing

- No new UI. `page.tsx` gets no predator-tribe tab/count control — `S-42`'s
  own stated outcome ("User configures a predator tribe's own behavior
  tuning") owns that.
- No predator genetic-diversity-trend or analysis-view integration
  (`computeGeneticDiversity`'s `TRIBE_LEVEL_DIVERSITY_FIELDS`-style split is
  boid-only today, `boids.ts:1514`) — out of scope for this foundation.
- No same-tribe mating restriction for predators — mirrors boids' existing
  unrestricted rule exactly.
- No change to `reproducePopulation`/`inheritGenes` — both are already
  fully generic across species.
- No new predator-tribe-food or hunger mechanic — predators have no hunger
  field (`PredatorState`'s own doc comment, `boids.ts:98-100`) and this
  change doesn't add one.

## Implementation Approach

Six phases: data model & schema (the type/zod/admin-range plumbing, no
engine-behavior change yet) → independent spawning (point `createInitialPredators`
and the live-growth path at the new config instead of boids') → detection
radius & idle wander (the first genuinely new predator behavior) → genes
wiring & capture aggressiveness (make genetics real, add the second new
field) → live adjustment (parity with boids' live-edit path) → verification
(a direct script, since there's no UI to click through).

## Phase 1: Data model & schema

### Overview

Define `PredatorTribeConfig`, thread `predatorFlockCount`/
`predatorTribeConfigs` through the top-level schema and admin-range
machinery, with zero engine-behavior change yet.

### Changes Required:

**`src/server/simulation/boids.ts`**:
- **Intent**: define the predator-tribe-specific fields a `createInitialPredators`
  seeding pass and the later engine phases will read.
- **Contract**: new type, placed near `TribeConfig`:
  ```ts
  export type PredatorTribeConfig = {
    separation: number;
    alignment: number;
    cohesion: number;
    maxSpeed: number;
    minSpeed: number;
    matePreference: number;
    detectionRadius: number;
    captureRadiusMult: number;
  };
  ```
  `separation`/`alignment`/`cohesion` are seeded into genes exactly like
  boids' equivalents (required because `PredatorGenes = BoidGenes` still
  needs every heritable field populated at spawn) but stay behaviorally
  inert for predators today, same as boids' own `separationWeight`/etc. are
  inert for predators regardless of tribe independence — document this
  explicitly in a code comment so a future reader doesn't assume these do
  something they don't. `detectionRadius`/`captureRadiusMult` are the two
  genuinely new fields Phases 3-4 wire in.

**`src/server/simulation/parameter-ranges.ts`**:
- **Intent**: one shared admin range per new predator-tribe field, and the
  new `predatorFlockCount` top-level param — same posture as every other
  ranged field.
- **Contract**: add `predatorFlockCount` to `RANGED_PARAMETER_NAMES`
  (top-level, NOT added to `TRIBE_RANGED_FIELD_NAMES`) with
  `{min: 1, max: 8, default: 1}` — `min`/`default` of `1` deliberately
  reproduce today's effective single-undifferentiated-predator-tribe
  behavior for any run that doesn't explicitly configure more, unlike
  boids' own `flockCount` floor/default of `2`. A run that never touches
  this new param sees zero behavior change from this plan at the
  tribe-count level (the detection-radius/capture-multiplier/gene-wiring
  behavior changes still apply even at `predatorFlockCount: 1`, since
  those are per-tribe-config values, not tribe-count-dependent). Add a new sibling const
  `PREDATOR_TRIBE_RANGED_FIELD_NAMES = ["detectionRadius", "captureRadiusMult",
  "matePreference"] as const satisfies readonly RangedParameterName[]` —
  `matePreference` reuses the EXACT SAME existing name/range boids'
  `TribeConfig.matePreference` already uses (`ParameterRanges` has no
  mechanism for two distinct ranges under one string key, and none is
  needed here since the same `{min:0, max:1, default:0.5}` values apply to
  both species — plan-review F3). `detectionRadius` default should let a
  tribe at
  default reproduce today's unconditional-scan behavior as closely as
  possible — pick a generous ceiling (e.g. `{min:1, max:500, default:200}`,
  large enough relative to this project's `xyArea`/`zDepth` defaults of 200
  that a default-configured predator tribe rarely misses a target in
  practice) rather than a small value that would silently change today's
  behavior for every existing run. `captureRadiusMult` default `1` (no
  change from today's fixed `CAPTURE_RADIUS`): `{min: 0.1, max: 5, default: 1}`.
  `separation`/`alignment`/`cohesion`/`maxSpeed`/`minSpeed` reuse the exact
  same admin ranges `TribeConfig`'s own fields already use (no new range
  entries needed — same `RangedParameterName`s, shared across both boid and
  predator tribes, since the underlying field semantics are identical even
  though predator values are currently inert). `detectionRadius`/
  `captureRadiusMult` are genuinely new names — explicitly add both to
  `RANGED_PARAMETER_NAMES` and give both an entry in
  `DEFAULT_PARAMETER_RANGES` (the values given above), mirroring exactly
  how the archived `per-tribe-behavior-weights` plan's own Phase 1
  instructed adding its new per-tribe names.
- **Contract (filter fix, plan-review F4)**:
  `TOP_LEVEL_RANGED_PARAMETER_NAMES`'s derivation
  (`parameter-ranges.ts:68-70`, currently `RANGED_PARAMETER_NAMES.filter((name)
  => !TRIBE_RANGED_FIELD_NAMES.includes(...))`) only subtracts the boid-side
  set. Update it to also exclude `PREDATOR_TRIBE_RANGED_FIELD_NAMES` (e.g.
  `!TRIBE_RANGED_FIELD_NAMES.includes(name as TribeRangedFieldName) &&
  !PREDATOR_TRIBE_RANGED_FIELD_NAMES.includes(name as
  PredatorTribeRangedFieldName)`), or merge both sets into one combined
  tribe-ranged-names array before filtering. Without this,
  `detectionRadius`/`captureRadiusMult` would be silently misclassified as
  top-level scalar fields by every other consumer of `RangedParameterName`
  (`parameter-suggestion.ts`, the reference-parameters page) — the exact
  bug class this file's own `:43-50` comment was written to prevent.

**`src/server/db/schema.ts`**:
- **Intent**: persist the two new fields the same way `flockCount`/
  `tribeConfigs` already are (plan-review F1 — these are real DB columns,
  not an in-memory-only shape; the plan's own prior Migration Notes claim
  was wrong and is corrected below).
- **Contract**: add `predatorFlockCount: d.integer().notNull().default(1)`
  and `predatorTribeConfigs: d.text({mode:"json"})` to `simulationRuns`,
  same column shapes as `flockCount`/`tribeConfigs` respectively. Generate
  the migration (`npm run db:generate`).

**`src/server/api/routers/simulation.ts`**:
- **Intent**: validate the new top-level param and the new per-tribe config
  array, mirroring `tribeConfigSchema`/`checkAgainstAdminRanges` exactly;
  persist both new fields into the DB row at run creation, mirroring
  `flockCount`/`tribeConfigs`'s own insert.
- **Contract (persistence, plan-review F1)**: add
  `predatorFlockCount: input.predatorFlockCount, predatorTribeConfigs:
  input.predatorTribeConfigs` to `insertRunningSimulation`'s insert block
  (`:375-382`), the shared helper both `start` and `startServer` use.
  Phase 5's `updatePredatorTribeConfigs` mutation reads the run's own
  `predatorFlockCount` from the DB row for its length check, mirroring
  `updateTribeConfigs`'s existing `run.flockCount` read exactly (add
  `predatorFlockCount` to whichever select(s) that mutation's ownership/
  active-run lookup uses).
- **Contract**: new `predatorTribeConfigSchema = z.object({...8 fields,
  each z.number().finite()})`, reused by both `startInputSchema`'s new
  `predatorFlockCount: z.number().int()` + `predatorTribeConfigs:
  z.array(predatorTribeConfigSchema)` fields and a new (Phase 5)
  `updatePredatorTribeConfigs` mutation's input, same
  one-schema-two-consumers pattern as `tribeConfigSchema`.
  `checkAgainstAdminRanges` (`simulation.ts:276-321`) gains: a
  `predatorFlockCount` check added to the existing top-level loop (automatic
  once it's in `RANGED_PARAMETER_NAMES`, since `TOP_LEVEL_RANGED_PARAMETER_NAMES`
  derives from the difference — verify `predatorFlockCount` is NOT
  accidentally added to `TRIBE_RANGED_FIELD_NAMES`, which would misclassify
  it); a new hard length check
  (`input.predatorTribeConfigs.length !== input.predatorFlockCount` →
  `BAD_REQUEST`, mirroring the existing `tribeConfigs.length !==
  flockCount` check at `:304-309`); a second nested per-tribe loop over
  `input.predatorTribeConfigs` × `PREDATOR_TRIBE_RANGED_FIELD_NAMES`,
  structurally identical to the existing boid-tribe loop (`:310-321`).

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm run db:generate` produces a clean additive migration for the 2 new
  `simulationRuns` columns (plan-review F1), and `npm run db:push` (or
  `db:migrate`) applies it without a destructive-change warning
- `npx vitest run src/server/api/routers/simulation.test.ts` passes
  (extended: a `predatorTribeConfigs` entry with a field outside the shared
  admin range rejects; a length mismatch between `predatorTribeConfigs` and
  `predatorFlockCount` rejects)

#### Manual Verification:
- None — covered by Phase 6.

## Phase 2: Independent predator-tribe spawning

### Overview

`createInitialPredators` and the live-growth path read the new
`predatorFlockCount`/`predatorTribeConfigs` instead of boids'
`flockCount`/`tribeConfigs` — predators now spawn into their own,
independent tribe space.

### Changes Required:

**`src/server/simulation/boids.ts`**:
- **Intent**: a predator's `genes.flockId` now indexes into its own
  independent tribe space, seeded from that tribe's own config.
- **Contract**: `createInitialPredators`'s signature changes from
  `(predatorCount, ..., flockCount: number, tribeConfigs: TribeConfig[],
  ...)` to take `predatorFlockCount: number, predatorTribeConfigs:
  PredatorTribeConfig[]` in place of the shared params — same
  `splitCountAcrossFlocks`/per-flock-loop structure (`boids.ts:416-461`),
  just reading `predatorTribeConfigs[flockId]` instead of `tribeConfigs[flockId]`
  and seeding genes from its `separation`/`alignment`/`cohesion`/`maxSpeed`/
  `minSpeed`/`matePreference` fields exactly like the boid seeding block
  does.

**`src/server/simulation/server-run-registry.ts`**:
- **Intent**: thread the new independent params through every call site
  that currently passes boids' `flockCount`/`tribeConfigs` to
  `createInitialPredators`.
- **Contract**: `ServerRunParams` gains `predatorFlockCount: number;
  predatorTribeConfigs: PredatorTribeConfig[];` (alongside the existing
  `flockCount`/`tribeConfigs`, `server-run-registry.ts:45-71`). Update all 3
  current call sites that pass `params.flockCount, params.tribeConfigs` to
  `createInitialPredators`: `startServerRun` (`:787-792`),
  `adjustLivePopulation`'s predator-growth branch (`:479-484`) — note
  `adjustLivePopulation`'s BOID-growth branch (`:460-465`) stays
  unchanged, still reading `params.flockCount`/`params.tribeConfigs`. The
  client-staged equivalent in `simulation-canvas.tsx` (`:780`) needs the
  same change at its own `createInitialPredators` call.

**`scripts/perf-baseline.ts`, `src/server/simulation/pipeline.test.ts`,
`src/server/simulation/pipeline-perf.test.ts`** (plan-review F5 — these
call `createInitialPredators` directly with the current signature and
aren't covered by this phase's named test targets):
- **Intent**: keep these fixtures compiling once `createInitialPredators`'s
  signature changes.
- **Contract**: update each direct `createInitialPredators(...)` call to
  pass `predatorFlockCount`/`predatorTribeConfigs` in place of the old
  `flockCount`/`tribeConfigs` arguments, using a `PredatorTribeConfig[]`
  fixture (e.g. a single-tribe array at default values) in place of
  whatever `TribeConfig[]` fixture each currently passes.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/server-run-registry.test.ts` passes
  (extended: `createInitialPredators` with 2 predator tribes at different
  `maxSpeed`/`matePreference` values seeds each predator's genes from its
  own tribe, independent of whatever `flockCount`/`tribeConfigs` boids are
  configured with in the same run — e.g. a run with `flockCount: 2` boid
  tribes and `predatorFlockCount: 3` predator tribes spawns predators split
  3 ways, not 2)

#### Manual Verification:
- None — covered by Phase 6.

## Phase 3: Detection radius & idle wander

### Overview

`stepPredators` gains per-tribe awareness: each predator's nearest-boid
search is gated by its own tribe's `detectionRadius`; a predator with no
boid in range applies a small random wander force instead of holding its
heading frozen.

### Changes Required:

**`src/server/simulation/boids.ts`**:
- **Intent**: a low-detection-radius predator tribe visibly hunts
  differently from a high-detection-radius one — targeting becomes a real,
  bounded decision instead of an unconditional global scan.
- **Contract**: `stepPredators`'s signature gains `predatorTribeConfigs:
  PredatorTribeConfig[]` and `rng: () => number` params (`boids.ts:820-825`).
  Inside the per-predator loop: after finding `nearestDist` via the existing
  scan (`:835-847`), look up `predatorTribeConfigs[predator.genes.flockId]?.
  detectionRadius` and treat `nearestDist > detectionRadius` the same as
  the existing `nearestDist === Infinity` no-target case. In that no-target
  branch (currently zero steering force, `boids.ts:847-849`), apply instead
  a small random-direction steering force using `rng()` for each axis
  (normalized, then scaled by a small fraction of `STEERING_FORCE_SCALE` —
  pick a magnitude clearly smaller than the pursuit force so wandering
  looks idle, not erratic; this project's existing `mutationMagnitude`-style
  "small jitter" scale is a reasonable reference point). `runTick`'s own
  params type (`boids.ts:1216-1243`) gains `predatorTribeConfigs:
  PredatorTribeConfig[]` alongside its existing `tribeConfigs`, and its
  `stepPredators` call site (`boids.ts:1275`-ish) passes `params.rng` (the
  same RNG instance already threaded for boids/reproduction) and the new
  `params.predatorTribeConfigs`.

**`src/server/simulation/single-run-lifecycle.ts`** (plan-review F2 —
this file and its production callers are the actual path that gets
`predatorTribeConfigs` into `runTick` for a real running simulation; the
plan previously only edited `runTick`'s own internal call site, which has
no source to read the new field from without this):
- **Intent**: thread the new field from each caller's own config into
  `runTick`, mirroring exactly how `tribeConfigs` itself already
  propagates through this same chain.
- **Contract**: `computeSingleRunTick`'s params type gains
  `predatorTribeConfigs: PredatorTribeConfig[]` alongside its existing
  `tribeConfigs` field; its internal `runTick` call adds
  `predatorTribeConfigs: params.predatorTribeConfigs` to the params object
  it builds, next to the existing `tribeConfigs: params.tribeConfigs` line.

**`src/server/simulation/server-run-registry.ts`** and
**`src/app/simulation/_components/simulation-canvas.tsx`** (plan-review
F2 — `computeSingleRunTick`'s two real production callers):
- **Intent**: each caller's own params-construction site for
  `computeSingleRunTick` gains the new field, sourced from
  `run.params.predatorTribeConfigs` (server-owned) or the client's own
  `predatorTribeConfigs` state/prop (client-staged) — same pattern each
  caller already follows for `tribeConfigs`.
- **Contract**: add `predatorTribeConfigs` to the params object each
  caller passes into `computeSingleRunTick`, at the same site each already
  passes `tribeConfigs`.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/single-run-lifecycle.test.ts` passes
  (extended: a predator whose tribe's `detectionRadius` is smaller than its
  distance to the only boid in the world does NOT steer toward that boid —
  its velocity direction changes from a deterministic seed in a way
  attributable to the wander force, not the pursuit force; a predator
  whose tribe's `detectionRadius` comfortably covers the same distance
  DOES steer toward the boid, confirming the gate is genuinely two-sided,
  not just "always wanders now"; `single-run-lifecycle.test.ts`'s shared
  fixture compiles and passes with the new required field added once)

#### Manual Verification:
- None — covered by Phase 6.

## Phase 4: Genes wiring & capture aggressiveness

### Overview

`stepPredators`' speed clamp reads each predator's own inherited
`genes.maxSpeed`/`genes.minSpeed` instead of the fixed
`PREDATOR_MIN_SPEED`/`PREDATOR_MAX_SPEED` constants; `applyPredation`
scales `CAPTURE_RADIUS` by each predator's own tribe's capture-radius
multiplier.

### Changes Required:

**`src/server/simulation/boids.ts`**:
- **Intent**: predator-tribe genetics (and now-independent per-tribe
  `maxSpeed`/`minSpeed` starting values) finally have a real behavioral
  effect — closing the exact "inherited but never read" gap this plan's
  Current State Analysis documents.
- **Contract**: `stepPredators`'s speed clamp (`boids.ts:858-861`,
  currently `Math.min(Math.max(speed, PREDATOR_MIN_SPEED),
  PREDATOR_MAX_SPEED)`) reads `predator.genes.minSpeed`/`predator.genes.maxSpeed`
  in place of the two module constants. `PREDATOR_MIN_SPEED`/
  `PREDATOR_MAX_SPEED` (`boids.ts:145-146`) stay defined (used as the seed
  values a `PredatorTribeConfig` left at its own admin-range default would
  reproduce, mirroring how boids' own removed global constants are
  documented as "replaced by the per-individual gene" rather than deleted)
  but are no longer read inside `stepPredators` itself.
- **Intent**: a higher-aggressiveness predator tribe catches prey from
  further away than a lower one.
- **Contract**: `applyPredation`'s signature gains `predatorTribeConfigs:
  PredatorTribeConfig[]` (`boids.ts:1141-1146`). Its per-predator
  `boidGrid.queryRadius(..., CAPTURE_RADIUS, ...)` call (`:1168-1171`)
  becomes `CAPTURE_RADIUS * (predatorTribeConfigs[predator.genes.flockId]?.
  captureRadiusMult ?? 1)`, computed once per predator before the query —
  same optional-chaining-with-fallback convention every other
  `tribeConfigs[x.genes.flockId]?.field ?? default` read in this file
  already uses. `runTick`'s `applyPredation` call site needs the new
  argument threaded through.

**`src/server/simulation/pipeline.test.ts`,
`src/server/simulation/pipeline-perf.test.ts`** (plan-review F5 — direct
`applyPredation(...)` callers at `pipeline.test.ts:186,237,305,316` and
`runTick(...)` callers via `BASE_PARAMS` in both files, not covered by
this phase's named test target):
- **Intent**: keep these fixtures compiling once `applyPredation`/
  `runTick`'s params gain `predatorTribeConfigs`.
- **Contract**: add a `predatorTribeConfigs` fixture (e.g. a single
  default-valued entry) to each direct `applyPredation(...)` call and to
  each file's shared `BASE_PARAMS`/params object passed into `runTick`.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended: two
  predator tribes with different `maxSpeed` values reach measurably
  different top speeds under the same steering force, attributable to each
  tribe's own gene value, not the removed fixed constants; a predator in a
  tribe with `captureRadiusMult: 2` captures a boid at a distance the fixed
  `CAPTURE_RADIUS` alone would have missed, while an otherwise-identical
  predator in a `captureRadiusMult: 1` tribe does not)

#### Manual Verification:
- None — covered by Phase 6.

## Phase 5: Live adjustment

### Overview

A running simulation's predator tribes can be live-edited the same way
boid tribes already can — full parity with `applyLiveTribeConfigs`/
`updateTribeConfigs`, even though no UI exists yet to trigger it (reachable
via direct tRPC call or the Phase 6 verification script).

### Changes Required:

**`src/server/simulation/server-run-registry.ts`**:
- **Intent**: mirror `applyLiveTribeConfigs` exactly for the independent
  predator-tribe array — a wholesale replace, since none of the new
  predator-tribe fields tie to a live mutable resource pool the way
  `foodStockShare` does.
- **Contract**: new `applyLivePredatorTribeConfigs(runId: number, patch:
  PredatorTribeConfig[]): ApplyLiveParamsResult`, structurally identical to
  `applyLiveTribeConfigs` (`:311-364`) minus the `foodStockShare`
  delta-injection block (`:342-361`) — no equivalent special case applies
  here. Pushes one `ParameterChangeEntry` marker with a new `field:
  "predatorTribeConfigs"` literal, added to `ParameterChangeEntry.field`'s
  existing union (`:99-103`). Sets `run.params = {...run.params,
  predatorTribeConfigs: patch}`.

**`src/server/api/routers/simulation.ts`**:
- **Intent**: the router-level entry point for the new live-edit path,
  mirroring `updateTribeConfigs`'s exact ownership/active-run/length/
  soft-range-check shape.
- **Contract**: new `updatePredatorTribeConfigs` mutation taking
  `{runId: number, predatorTribeConfigs: z.array(predatorTribeConfigSchema).min(1)}`
  — same ownership check, `status === "running"` + `isServerRunActive`
  check, hard length-match against the run's own `predatorFlockCount`
  (read from the DB row, same as `updateTribeConfigs` reads `flockCount`),
  soft per-field range warning (not a hard reject) using
  `PREDATOR_TRIBE_RANGED_FIELD_NAMES`, then calls
  `applyLivePredatorTribeConfigs`.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts` passes
  (extended: a live edit to `predatorTribeConfigs` changes a subsequent
  tick's predator behavior — e.g. a live edit raising one tribe's
  `detectionRadius` makes a previously-wandering predator in that tribe
  start pursuing a boid it previously couldn't detect — not just the
  stored value, per this project's own "UI accepts input is not feature
  verified" lesson applied to the live-edit path itself)

#### Manual Verification:
- None — covered by Phase 6.

## Phase 6: Verification

### Overview

Since this foundation ships with no new UI, manual verification is a
direct script against the registry/engine functions — the same discipline
this session's own `per-tribe-food-config` Phase 7 used — proving every
field this plan names actually changes behavior, not just stored config.

### Changes Required:

None — this phase is verification only, no source changes.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm test` passes (full suite)

#### Manual Verification:
- Start a run with 2+ predator tribes configured to visibly different
  `maxSpeed`/`detectionRadius`/`captureRadiusMult`/`matePreference` values;
  confirm via direct registry inspection (not the UI, which doesn't exist
  for this yet) that predators actually split across tribes per
  `splitCountAcrossFlocks`'s contiguous-block rule, independent of whatever
  `flockCount` boids are using in the same run.
- Confirm the low-`detectionRadius` tribe's predators visibly fail to
  pursue a boid outside their radius (wander, don't chase) while a
  high-`detectionRadius` tribe's predators pursue the same boid.
- Confirm the high-`captureRadiusMult` tribe's predators capture boids from
  a measurably greater distance than the low-multiplier tribe, over
  otherwise-identical conditions.
- Live-edit one predator tribe's config mid-run; confirm the next tick's
  behavior changes accordingly (not just the stored value).
- Confirm cross-tribe predator mating still occurs (no silent same-tribe
  restriction was introduced).
- Confirm a run with `predatorFlockCount: 1` (today's effective
  single-tribe behavior) still starts and ticks without error.

## Performance Considerations

`stepPredators`/`applyPredation` each gain one extra array lookup
(`predatorTribeConfigs[predator.genes.flockId]`) per predator per tick —
identical cost shape to the `tribeConfigs[boid.genes.flockId]` lookups
`stepBoids` already does per boid per tick, which this project's own
`per-tribe-behavior-weights` change measured as having no wall-clock
regression. Predator counts are typically far smaller than boid counts in
this project's own capacity limits (`context/foundation/capacity-limits.md`),
so this is lower-risk than the boid-side equivalent, not higher.

## Migration Notes

A genuine, additive schema migration (plan-review F1 corrected this):
`predatorFlockCount`/`predatorTribeConfigs` are new DB columns, same shapes
as `flockCount`/`tribeConfigs`. `predatorFlockCount` defaults to `1` and
existing rows have `predatorTribeConfigs: null` — no run created before
this change references predator tribes, and `predatorFlockCount`'s default
of `1` reproduces today's undifferentiated-predator behavior at the
tribe-count level exactly for any run that never configures this new
param.

## References

- Boid-side precedent (fully archived):
  `context/archive/2026-11-17-per-tribe-behavior-weights/plan.md`
- `boids.ts:33-56` (`TribeConfig`), `:66-76` (`BoidGenes`), `:96`
  (`PredatorGenes`), `:101-113` (`PredatorState`), `:145-150` (predator
  speed/capture constants), `:348-354` (`splitCountAcrossFlocks`),
  `:367-412`/`:416-461` (spawn functions), `:820-870` (`stepPredators`),
  `:887-944` (`inheritGenes`/`reproducePopulation` boundary), `:945`
  (`reproducePopulation`), `:1141-1180` (`applyPredation`).
- `parameter-ranges.ts:5-96` (`RANGED_PARAMETER_NAMES`,
  `TRIBE_RANGED_FIELD_NAMES`, `DEFAULT_PARAMETER_RANGES`).
- `simulation.ts:86-104` (`tribeConfigSchema`), `:276-321`
  (`checkAgainstAdminRanges`), `:1254` (`updateTribeConfigs`).
- `server-run-registry.ts:45-114` (`ServerRunParams`/`LiveRun`/
  `ParameterChangeEntry`), `:311-364` (`applyLiveTribeConfigs`), `:460-484`
  (`adjustLivePopulation`), `:639` (`computeSingleRunTick` call site in the
  tick loop), `:779-792` (`startServerRun`).
- `schema.ts:118` (`flockCount` column), `:180` (`tribeConfigs` column) —
  the exact shapes `predatorFlockCount`/`predatorTribeConfigs` mirror
  (plan-review F1).
- `single-run-lifecycle.ts` (`computeSingleRunTick`'s params type and its
  `runTick` call) and `single-run-lifecycle.test.ts` (its shared `PARAMS`
  fixture) — the actual production thread-through path for
  `predatorTribeConfigs`/`rng` into `runTick` (plan-review F2).
- `simulation-canvas.tsx:814` (`computeSingleRunTick`'s client-staged call
  site — the other of the two real production callers).
- `scripts/perf-baseline.ts`, `src/server/simulation/pipeline.test.ts`,
  `src/server/simulation/pipeline-perf.test.ts` — call the changing
  function signatures directly with current (pre-change) arguments;
  need fixture updates once Phases 2-4 land (plan-review F5).
- `context/foundation/roadmap.md` — F-10's own entry (Outcome,
  Prerequisites, Unknowns), and S-42's entry (the scope boundary this plan
  deliberately stays on the F-10 side of).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data model & schema

#### Automated

- [x] 1.1 npm run typecheck passes — 4be59b5
- [x] 1.2 npm run db:generate produces a clean additive migration; db:push/db:migrate applies it without a destructive-change warning — 4be59b5
- [x] 1.3 npx vitest run src/server/api/routers/simulation.test.ts passes — 4be59b5

### Phase 2: Independent predator-tribe spawning

#### Automated

- [x] 2.1 npm run typecheck passes
- [x] 2.2 npx vitest run src/server/simulation/boids.test.ts src/server/simulation/server-run-registry.test.ts passes

### Phase 3: Detection radius & idle wander

#### Automated

- [ ] 3.1 npm run typecheck passes
- [ ] 3.2 npx vitest run src/server/simulation/boids.test.ts src/server/simulation/single-run-lifecycle.test.ts passes

### Phase 4: Genes wiring & capture aggressiveness

#### Automated

- [ ] 4.1 npm run typecheck passes
- [ ] 4.2 npx vitest run src/server/simulation/boids.test.ts passes

### Phase 5: Live adjustment

#### Automated

- [ ] 5.1 npm run typecheck passes
- [ ] 5.2 npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts passes

### Phase 6: Verification

#### Automated

- [ ] 6.1 npm run typecheck passes
- [ ] 6.2 npm test passes (full suite)

#### Manual

- [ ] 6.3 Predators split across independent predator tribes, independent of boids' flockCount
- [ ] 6.4 Low-detectionRadius tribe wanders instead of pursuing out-of-range boids; high-detectionRadius tribe pursues the same boid
- [ ] 6.5 High-captureRadiusMult tribe captures from a measurably greater distance than low-multiplier tribe
- [ ] 6.6 Live-edit to a predator tribe changes next-tick behavior, not just the stored value
- [ ] 6.7 Cross-tribe predator mating still occurs
- [ ] 6.8 predatorFlockCount: 1 starts and ticks without error
