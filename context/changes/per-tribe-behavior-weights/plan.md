# Implementation Plan: Per-tribe boid behavior data model (F-09)

## Overview

Give every boid tribe (flock) its own behavior profile — the three existing
weights and speed bounds, three new per-behavior perception radii groups, a
predator-flee burst mechanic, and a real color-distance mate-preference
selector — configurable at run start and live mid-run, with full Lua-reference
parity. Research confirmed weights/speed bounds are nearly free (already
per-boid genetics, seeded from a per-flock vector); perception radii, burst,
and mate-preference selection are genuinely new engine capability with no
existing scaffolding. See `research.md` for the full evidence base and
`context/foundation/lessons.md`'s "UI accepts input is not feature verified"
entry, which this plan's Phase 9 verification step exists specifically to
avoid repeating.

## Current State Analysis

- `BoidGenes` (`boids.ts:25-35`) already carries `separationWeight`/
  `alignmentWeight`/`cohesionWeight`/`maxSpeed`/`minSpeed`/`matePreference`
  per individual, seeded once at spawn from a per-flock `FlockWeights[]`
  (`{separation, alignment, cohesion}`, `boids.ts:11-15`) that today holds
  identical values for every flock.
- Perception radii (`NEIGHBOR_RADIUS`, `SEPARATION_RADIUS`,
  `PREDATOR_DETECTION_RADIUS`, `CAPTURE_RADIUS`, `COHESION_REFERENCE_RADIUS`,
  `MATE_DISTANCE_RADIUS`) are fixed module-level constants baked into single
  per-tick `buildSpatialGrid` calls (`boids.ts:84-120, 447-452, 484-488`).
- No burst mechanic exists. `matePreference` exists as a gene but is never
  read by the mate-match loop (`boids.ts:827-916`) — purely decorative today.
- `LiveAdjustableParams` (`server-run-registry.ts:70-78`) is a `Pick` over
  scalar/boolean `ServerRunParams` fields, diffed into `ParameterChangeEntry`
  as numbers — it has no slot for an array-shaped field.
- `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES`
  (`parameter-ranges.ts:5-69`) and `checkAgainstAdminRanges`
  (`simulation.ts:241-265`) assume one scalar value per ranged field — no
  array-of-tribes validation exists.
- `simulationRuns` already has two JSON-mode TEXT columns (`savedState`,
  `history`; `schema.ts:142-163`) — precedent for a third.
- No `Tabs` component exists yet in `src/components/ui/`.

## What We're NOT Doing

- Not making `flockCount` itself live-adjustable (unchanged — still start-time
  only, per the existing architecture's "structurally invasive" live-flock
  constraint).
- Not adding per-tribe *admin ranges* — one shared `{min,max,default}` range
  per new field applies identically across all tribes (decided).
- Not backfilling a synthetic per-tribe config for legacy completed runs —
  their analysis/comparison views treat the new fields as not-applicable,
  same as other legacy markers (decided).
- Not touching `checkLiveParamRangesSoft`'s scalar-only signature for
  non-tribe fields — only the new tribe-config live-adjust path is additive.

## Phase 1: Data model & schema

### Overview
Add the `tribeConfigs` JSON column, the per-tribe field definitions, the
admin-range entries, and the `startInputSchema` + validation support for an
array-of-tribes payload.

### Changes Required

**`src/server/simulation/boids.ts`** (or a new `tribe-config.ts` sibling file
if the existing file is judged too large to extend further — implementer's
call, follow whichever existing convention this file's own size already
suggests):
- **Intent**: define the per-tribe config shape that seeds a tribe's boids'
  genes at spawn and reproduction, extending `FlockWeights` with the new
  dimensions research identified as missing (perception radii, multipliers,
  burst, matePreference range... matePreference is a per-boid heritable gene
  already, not per-tribe-config — the per-tribe piece for it is the *starting*
  value new boids in that tribe spawn with, matching how `separationWeight`
  etc. already work).
- **Contract**: `TribeConfig = { separation: number; alignment: number;
  cohesion: number; maxSpeed: number; minSpeed: number; matePreference:
  number; neighborRadius: number; separationRadius: number;
  predatorDetectionRadius: number; burstMult: number; burstCostMult: number;
  }`. `tribeConfigs: TribeConfig[]`, index = `flockId` (decided).

**`src/server/db/schema.ts`**:
- **Intent**: persist each run's per-tribe config, following the existing
  `savedState`/`history` JSON-column pattern exactly.
- **Contract**: add `tribeConfigs: d.text({ mode: "json" })` to
  `simulationRuns` (nullable — legacy rows have none). Drizzle migration via
  `npm run db:generate` + the project's established manual-SQL-apply fallback
  if `db:migrate` hits the same local tracking-table gap documented in
  `context/foundation/lessons.md`/this change's own prior session history.

**`src/server/simulation/parameter-ranges.ts`**:
- **Intent**: let an admin bound the legal value for each new per-tribe field
  — one shared range for all tribes (decided).
- **Contract**: add `neighborRadius`, `separationRadius`,
  `predatorDetectionRadius`, `burstMult`, `burstCostMult`, `matePreference`
  (if not already ranged — it isn't, today's `matePreference` has no admin
  range since it was never a start-time input) to `RANGED_PARAMETER_NAMES` and
  `DEFAULT_PARAMETER_RANGES`, with defaults matching today's fixed global
  constants (`NEIGHBOR_RADIUS=70`, `SEPARATION_RADIUS=25`,
  `PREDATOR_DETECTION_RADIUS=50`) so a tribe left at default behaves
  identically to pre-change behavior.

**`src/server/api/routers/simulation.ts`**:
- **Intent**: accept a per-tribe array in `start`/`startServer`'s input,
  validated per-tribe against the new shared ranges.
- **Contract**: extend `startInputSchema` with
  `tribeConfigs: z.array(z.object({...TribeConfig fields...})).length(input.flockCount)`
  — zod can't cross-reference a sibling field inside `z.object`, so validate
  the length match inside `checkAgainstAdminRanges` (or a sibling check)
  instead, throwing the same `TRPCError` shape on mismatch. Extend
  `checkAgainstAdminRanges` with a nested loop: for each tribe config, for
  each of the new ranged field names, check against the shared range (same
  structure as the existing per-field loop, one level deeper).

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/server/api/routers/simulation.test.ts` passes (existing
  suite extended with: a per-tribe-config payload with one tribe
  out-of-range rejects; a length-mismatched `tribeConfigs` array rejects)

#### Manual Verification:
- None — pure schema/validation, verified by Phase 9's end-to-end spawn check.

## Phase 2: Engine — weights and speed bounds per tribe

### Overview
Wire real per-tribe values into the existing seeding path for both
`createInitialPopulation` and `createInitialPredators`.

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: each flock's boids seed their weights/speed-bound genes from
  that flock's own `TribeConfig`, not an identical shared value.
- **Contract**: `createInitialPopulation`/`createInitialPredators` already
  accept a `flockWeights: FlockWeights[]` parameter and index it by the spawn
  loop's `flockId` (`boids.ts:308-334, 346-375`) — replace that parameter's
  type/usage with `tribeConfigs: TribeConfig[]`, reading
  `tribeConfigs[flockId].separation/.alignment/.cohesion/.maxSpeed/.minSpeed`
  in place of the old `flockWeights[flockId].separation` etc. No change to
  the per-tick force-calculation hot loop (`boids.ts:606-629`) — it already
  reads from `genes.*`.

**`src/server/simulation/server-run-registry.ts`** and
**`src/server/api/routers/simulation.ts`**:
- **Intent**: thread the validated `tribeConfigs` array from the router input
  through to the `createInitialPopulation`/`createInitialPredators` call
  sites, replacing whatever currently constructs a flat `FlockWeights[]` from
  the single scalar inputs.
- **Contract**: locate every call site passing a `FlockWeights[]`-shaped
  argument. Confirmed (plan-review F2) to be three, not two: the
  client-staged `start` path, server-owned `startServerRun`
  (`server-run-registry.ts:628,636`), AND `adjustLivePopulation`
  (`server-run-registry.ts:329-336,348,367`) — live mid-run population
  growth builds its own local `flockWeights` array independently of the
  other two and must also switch to `tribeConfigs`, or boids/predators added
  to a running simulation seed with stale/default weights instead of their
  tribe's actual config.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended:
  two tribes with distinct `separation`/`maxSpeed` values produce boids
  whose `genes.separationWeight`/`genes.maxSpeed` match their own tribe's
  config, not a shared value)

#### Manual Verification:
- None — covered by Phase 9's gene-inspection step, which exercises all
  per-tribe fields together.

## Phase 3: Engine — per-tribe perception radii

### Overview
Replace the fixed-radius spatial grid strategy with a shared max-radius grid
plus a per-boid distance re-filter, for every force calculation currently
keyed to `NEIGHBOR_RADIUS`/`SEPARATION_RADIUS`/`PREDATOR_DETECTION_RADIUS`
(decided: max-radius-grid approach, not per-flock separate grids).

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: a boid's separation/alignment/cohesion/predator-detection
  perception radius comes from its own tribe's `TribeConfig`, not a single
  global constant — while keeping one grid build per population per tick.
- **Contract**: at each `buildSpatialGrid` call site (`boids.ts:447-452` and
  the predator-detection build), size the grid's `cellSize` to
  `Math.max(...tribeConfigs.map(t => t.neighborRadius / .separationRadius /
  .predatorDetectionRadius))` (the largest radius across all tribes present
  this run), then after `queryRadius` returns candidates, filter each
  candidate by actual distance against the *querying boid's own*
  `tribeConfigs[boid.genes.flockId].<relevant radius>` before it contributes
  to that boid's separation/alignment/cohesion/flee force. This is the one
  genuinely new piece of engine architecture in this plan — no existing code
  to pattern-match against; implement the filter inline at each of the three
  force-contribution loops inside `stepBoids`, reusing `wrappedDelta` (already
  used elsewhere in this file for toroidal distance) for the actual distance
  check.
- Mutation/inheritance: no change — `neighborRadius`/`separationRadius`/
  `predatorDetectionRadius` are *tribe-level* config (read via
  `genes.flockId` lookup), not individual heritable genes, so they don't need
  an `inheritGenes` entry.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended: a
  boid in a tribe with a small `separationRadius` ignores a neighbor at a
  distance that a large-radius tribe's identical boid would react to —
  same population, two tribes, distinguishing distance)
- `npm run perf:baseline` run and compared against
  `context/foundation/perf-baseline.json` — per
  `context/foundation/lessons.md`'s "A structural big-O/call-count guard can
  pass while real wall-clock cost regresses" entry (a documented incident in
  this exact file), `pipeline-perf.test.ts` passing alone is not sufficient
  evidence of no regression for a spatial-grid strategy change; this
  explicit wall-clock comparison is required

#### Manual Verification:
- None — functional behavior verified by the automated test above; visual
  confirmation folded into Phase 9's manual pass (one run with visibly
  different per-tribe clustering tightness).

## Phase 4: Engine — burst mechanic

### Overview
A boid bursts (applies `burstMult` to its speed) while fleeing a nearby
predator, paying `burstCostMult`-multiplied energy cost for the duration
(decided: predator-flee trigger, sustained per-tick cost, no new
timer/cooldown state).

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: reuse the existing predator-detection flee condition as the
  burst trigger — a boid within its tribe's `predatorDetectionRadius` of a
  predator bursts for as long as that condition holds.
- **Contract**: at the existing flee-detection site (`boids.ts:566-598`,
  which already computes `nearestPredatorDist <= PREDATOR_DETECTION_RADIUS`
  per boid — now per-tribe radius per Phase 3), when true: multiply the
  boid's post-clamp speed by `tribeConfigs[flockId].burstMult` before writing
  `vx`/`vy`/`vz` for this tick (after the existing `minSpeed`/`maxSpeed`
  clamp at `boids.ts:638-645`, so burst can exceed the tribe's own
  `maxSpeed`), and multiply this tick's existing per-tick energy-move cost by
  `tribeConfigs[flockId].burstCostMult` for that boid only. No new per-boid
  state field — the condition recomputes every tick from existing
  predator-proximity data, exactly like the flee force itself.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended: a
  boid with a predator inside `predatorDetectionRadius` moves faster and
  loses more energy this tick than an otherwise-identical boid with no
  nearby predator)

#### Manual Verification:
- None — covered by Phase 9.

## Phase 5: Engine — mate-preference selector

### Overview
Two mate candidates pair only if their color distance is below BOTH
candidates' own `matePreference` value (decided — ports the Lua reference's
own logic directly).

### Changes Required

**`src/server/simulation/color.ts`**:
- **Intent**: a reusable squared-distance helper between two colors, since
  none currently exists on `Color`.
- **Contract**: add `Color.distanceSq(a: Color, b: Color): number` (sum of
  squared per-channel differences) — or a free function if that fits this
  file's existing export style better; implementer's call based on the
  file's own convention.

**`src/server/simulation/boids.ts`**:
- **Intent**: gate the existing mate-match loop on both parents' preference
  thresholds, in addition to the existing gender/flock/distance checks.
- **Contract**: in `reproducePopulation`'s inner match loop
  (`boids.ts:859-885`), after the existing `crossbreedingEnabled`/flock-gate
  check and before pairing, add: compute `colorDistSq` between `parentA.genes
  .color` and `parentB.genes.color`; reject the match (continue scanning) if
  `colorDistSq > parentA.genes.matePreference² OR colorDistSq >
  parentB.genes.matePreference²` (both-sides-must-agree, decided). No change
  to `inheritGenes`'s existing blending of `matePreference` itself.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended: two
  eligible, in-range, opposite-gender boids with very different colors and
  low `matePreference` do NOT pair; the same two boids with high
  `matePreference` DO pair)

#### Manual Verification:
- None — covered by Phase 9.

## Phase 6: Live adjustment

### Overview
Extend live mid-run tribe-config editing, following the `mutationChance`/
`mutationMagnitude` precedent: a live edit updates `run.params.tribeConfigs`,
and `reproducePopulation` reads it fresh at each call rather than from a
value frozen at population creation (decided — confirmed NOT the S-27 trap,
since this is the same "affects future offspring, not already-alive
individuals" semantic already proven for those two fields).

**Scope (plan-review F3)**: server-owned runs only, matching
`LiveAdjustableParams`'s own existing scope. The client-staged path
(`simulation-canvas.tsx`) owns its own local component state and never
touches `server-run-registry.ts`'s live-edit machinery at all — this is
pre-existing architecture, not a gap this phase introduces or needs to
close.

### Changes Required

**`src/server/simulation/server-run-registry.ts`**:
- **Intent**: a dedicated live-edit path for `tribeConfigs`, separate from
  `applyLiveParams`'s existing numeric/boolean-only changelog machinery
  (`ParameterChangeEntry.oldValue/newValue: number` can't represent an array
  diff cleanly).
- **Contract**: new exported function `applyLiveTribeConfigs(runId: number,
  patch: TribeConfig[]): ApplyLiveParamsResult`, sharing `applyLiveParams`'s
  not-found/throttle checks and `lastParamUpdateAt` update (same
  `PARAM_UPDATE_THROTTLE_MS` floor), but replacing `run.params.tribeConfigs`
  wholesale rather than diffing field-by-field — record one simplified
  changelog entry (e.g. a `tribeConfigsChanged` boolean marker, not a
  per-field numeric diff) if the existing `parameterChanges` UI needs
  *something* to display; implementer's call on exact changelog shape,
  consistent with how this file already separates `adjustLivePopulation`
  from `applyLiveParams` as its own sibling function with its own changelog
  entry.
- `getLiveRunState`'s returned `liveParams` snapshot: add `tribeConfigs:
  run.params.tribeConfigs` so the live-edit panel can pre-fill from it.

**`src/app/simulation/_components/simulation-canvas.tsx`** and
**`src/app/simulation/_components/server-run-viewer.test.tsx`**
(plan-review F4):
- **Intent**: two more places independently derive a fixed
  `LiveAdjustableParams`-shaped field list; adding `tribeConfigs` is additive
  so neither breaks at compile time, but both should be reviewed
  deliberately rather than left stale.
- **Contract**: `simulation-canvas.tsx` has its own
  `satisfies readonly (keyof LiveAdjustableParams)[]` derived list — review
  whether it needs updating. `server-run-viewer.test.tsx` hand-duplicates a
  local `type LiveParams` test-fixture type (not imported from
  `server-run-registry.ts`) — refresh it to include `tribeConfigs` so test
  fixtures stay representative of the real shape.

**`src/server/api/routers/simulation.ts`**:
- **Intent**: expose the new live-edit path as a tRPC mutation, mirroring
  `updateRunParams`'s existing shape (soft-range-check via
  `checkLiveParamRangesSoft`, call the registry function, return the
  result).
- **Contract**: new procedure (name following this router's existing
  `updateRunParams` convention, e.g. `updateTribeConfigs`), input validated
  against the same per-tribe shape as `start`'s `tribeConfigs` field, calling
  `applyLiveTribeConfigs`.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/server-run-registry.test.ts` passes
  (extended: `applyLiveTribeConfigs` updates `run.params.tribeConfigs`; a
  subsequent `reproducePopulation` call for that run produces offspring
  seeded from the NEW config, not the one at run start; an already-alive
  boid's own genes are unaffected by the live edit)

#### Manual Verification:
- None — covered by Phase 9.

## Phase 7: Diversity metric expansion

### Overview
Fold the new per-tribe genes into the existing genetic-diversity calculation
(decided).

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: diversity should reflect the new dimensions tribes now vary
  across, not just the original three weights + speed bounds + lifespan +
  matePreference.
- **Contract**: `GENETIC_DIVERSITY_FIELDS` (`boids.ts:1238-1246`) is a
  `readonly (keyof BoidGenes)[]` — if the new per-tribe fields
  (`neighborRadius`/`separationRadius`/`predatorDetectionRadius`/
  `burstMult`/`burstCostMult`) become individual `BoidGenes` fields (seeded
  per-tribe like `separationWeight` is, inherited/mutated like any other
  gene), append their names to this array; `computeGeneticDiversity` needs no
  other change — it already iterates the array generically. **Decision
  needed at implementation time** (not blocking the plan, but flag if it
  resurfaces): whether these become true heritable/mutable `BoidGenes`
  fields (consistent with `separationWeight`'s own precedent) or stay
  purely tribe-level lookups (per Phase 3/4's design) — if the latter,
  diversity must instead read `tribeConfigs[g.flockId].<field>` per boid
  rather than `g.<field>` directly, since the field wouldn't exist on
  `BoidGenes`. Phase 3/4 above treat them as tribe-level (not per-boid
  heritable), so this phase's `coefficientOfVariation` call must map each
  boid to its tribe's value via `flockId`, not add new `BoidGenes` fields.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended:
  `computeGeneticDiversity` on a population split across tribes with
  identical weights but different `neighborRadius` values returns a higher
  score than an otherwise-identical single-tribe population)

#### Manual Verification:
- None — covered by Phase 9.

## Phase 8: UI

### Overview
Tabbed per-tribe configuration on the simulation start form, with varied
Lua-reference-matching defaults (decided).

### Changes Required

**`src/components/ui/tabs.tsx`** (new, via `npx shadcn@latest add tabs`):
- **Intent**: this repo has no `Tabs` primitive yet; add it the same way
  every other missing shared component in this codebase is sourced, per
  `AGENTS.md`.

**`src/app/simulation/page.tsx`**:
- **Intent**: let the user configure each tribe's weights/speed
  bounds/radii/burst/matePreference independently, switching between tribes
  via tabs scoped to the current `flockCount` (decided: tabs, not accordion
  or side-by-side columns).
- **Contract**: a `Tabs` strip with one `TabsTrigger`/`TabsContent` pair per
  tribe index `0..flockCount-1` (re-rendering as `flockCount` changes between
  2 and 4), each tab's content reusing the existing `NumberField`-style
  inputs (per `AGENTS.md`'s shared-component convention) for that tribe's
  `TribeConfig` fields. Default values for tribe 0/1/2 match the Lua
  reference's own three named tribes (decided); tribe 3 (only shown when
  `flockCount=4`) needs a reasonable fourth default — implementer's call,
  consistent in spirit with the other three.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes

#### Manual Verification:
- Starting a run with `flockCount=4` shows 4 tabs; switching `flockCount`
  down to 2 hides tabs 3/4 without losing their entered values if the user
  raises it back up.
- Each tribe's tab independently holds and submits distinct values.

## Phase 9: Backward compatibility & verification

### Overview
Legacy-row handling on analysis/comparison pages, and the gene-level spawn
verification the research explicitly flagged as necessary given this
project's own precedent bug (S-27).

### Changes Required

**Analysis/comparison pages** (wherever `wasEverThrottled`'s existing
legacy-row "not applicable" pattern lives, e.g. `dashboard/page.tsx`,
`runs/[runId]/page.tsx`, `runs/compare/page.tsx`):
- **Intent**: a run with `tribeConfigs: null` (pre-this-change row) renders
  nothing for per-tribe fields, rather than erroring or showing a misleading
  default (decided).
- **Contract**: wherever this change surfaces per-tribe data in these views,
  guard on `run.tribeConfigs != null` the same way existing legacy-marker
  guards already do.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm test` passes (full suite)

#### Manual Verification:
- Start a run with 2+ tribes configured to visibly different
  `separationWeight`/`neighborRadius`/`burstMult`/`matePreference` values.
  Inspect the actual spawned population's genes (via the existing debug/dev
  population-snapshot surface, or a temporary diagnostic log read during
  this verification only) and confirm tribe N's boids carry tribe N's
  configured values — not just that the start API echoes the right array
  back. This closes the exact gap `context/foundation/lessons.md`'s
  "UI accepts input is not feature verified" entry documents for this same
  trio of fields once before.
- Live-edit a running simulation's tribe 0 config mid-run; confirm
  already-alive tribe-0 boids are unaffected and a newly-born tribe-0
  offspring (observed via the same inspection method) reflects the new
  values.
- Open an old (pre-this-change) completed run's analysis page; confirm no
  error and no misleading per-tribe display.

## Performance Considerations

Phase 3's max-radius grid strategy keeps one `buildSpatialGrid` call per
population per tick (same cost shape as today) at the cost of a slightly
larger candidate set when tribes' radii differ — bounded by `flockCount ≤ 4`,
so the worst case is small. No change to the engine's overall O(n) grid-based
neighbor search complexity.

## References

- `research.md` — full evidence base for every decision above.
- `boids.ts:11-35, 84-120, 265-375, 447-488, 566-645, 734-916, 1238-1281` —
  genes, constants, spawn seeding, grid build/query, flee/speed clamp,
  reproduction/mate loop, diversity.
- `server-run-registry.ts:60-250` — `ServerRunParams`, `LiveAdjustableParams`,
  `applyLiveParams`, `adjustLivePopulation` (sibling-function precedent).
- `parameter-ranges.ts` — `RANGED_PARAMETER_NAMES`,
  `DEFAULT_PARAMETER_RANGES`, `checkLiveParamRangesSoft`.
- `simulation.ts:77-96, 241-265` — `startInputSchema`,
  `checkAgainstAdminRanges`.
- `schema.ts:142-163, 173-193` — `simulationRuns` JSON columns,
  `adminSettings`.
- `context/foundation/lessons.md` — "UI accepts input is not feature
  verified" (S-27 precedent).
- `AGENTS.md` — shared-component convention (`NumberField`, `shadcn@latest
  add`).

## Progress

### Phase 1: Data model & schema
#### Automated
- [x] 1.1 npm run typecheck passes — 331e4ab
- [x] 1.2 npm run check passes — 331e4ab
- [x] 1.3 npx vitest run src/server/api/routers/simulation.test.ts passes — 331e4ab

### Phase 2: Engine — weights and speed bounds per tribe
#### Automated
- [x] 2.1 npm run typecheck passes — 4a7ad2c
- [x] 2.2 npx vitest run src/server/simulation/boids.test.ts passes — 4a7ad2c

### Phase 3: Engine — per-tribe perception radii
#### Automated
- [x] 3.1 npm run typecheck passes — 162798d
- [x] 3.2 npx vitest run src/server/simulation/boids.test.ts passes — 162798d
- [x] 3.3 npm run perf:baseline compared against perf-baseline.json shows no regression — 162798d

### Phase 4: Engine — burst mechanic
#### Automated
- [x] 4.1 npm run typecheck passes — 52b8999
- [x] 4.2 npx vitest run src/server/simulation/boids.test.ts passes — 52b8999

### Phase 5: Engine — mate-preference selector
#### Automated
- [x] 5.1 npm run typecheck passes — 69cff75
- [x] 5.2 npx vitest run src/server/simulation/boids.test.ts passes — 69cff75

### Phase 6: Live adjustment
#### Automated
- [x] 6.1 npm run typecheck passes
- [x] 6.2 npx vitest run src/server/simulation/server-run-registry.test.ts passes

### Phase 7: Diversity metric expansion
#### Automated
- [ ] 7.1 npm run typecheck passes
- [ ] 7.2 npx vitest run src/server/simulation/boids.test.ts passes

### Phase 8: UI
#### Automated
- [ ] 8.1 npm run typecheck passes
- [ ] 8.2 npm run check passes
#### Manual
- [ ] 8.3 flockCount tab show/hide preserves values
- [ ] 8.4 Each tribe tab independently holds and submits distinct values

### Phase 9: Backward compatibility & verification
#### Automated
- [ ] 9.1 npm run typecheck passes
- [ ] 9.2 npm test passes (full suite)
#### Manual
- [ ] 9.3 Spawn-time gene inspection confirms per-tribe values reach genes
- [ ] 9.4 Live-edit reflected in new offspring only, not existing boids
- [ ] 9.5 Legacy run analysis page shows no error / no misleading display
