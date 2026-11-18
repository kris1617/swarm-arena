# Implementation Plan: Per-tribe food config (S-41)

## Overview

Give each boid tribe its own contribution to food — a stock share, a regen
share, and its own per-boid consumption rate — that combine into the single
shared food pool, never separate pools (matching the Lua reference and the
roadmap's own resolved scope). Per decisions made during planning, this
slice grew beyond the roadmap's original "config-only" estimate to also
include live mid-run adjustment of all three fields (including a new
delta-injection mechanic for stock) and an actual change to the
resource-management score formula to weight per-tribe balance.

## Current State Analysis

- Food is a single global scalar today: `foodStock` seeded once from
  `params.foodStockInitial`, regenerated each tick by a single flat
  `params.foodRegenRate`, consumed by a single flat
  `FOOD_CONSUMPTION_PER_BOID = 0.5` (`boids.ts:150`) applied uniformly to
  every boid regardless of `flockId` (`applyHunger`, `boids.ts:1086-1108`:
  `depleted = foodStock - boids.length * FOOD_CONSUMPTION_PER_BOID *
  dtSeconds`, `nextFoodStock = depleted + foodRegenRate * dtSeconds`).
- `foodAvailabilityRatio` (`boids.ts:1264-1267`) is a single global ratio
  (`nextFoodStock / foodStockInitial`, clamped [0,1]) feeding the energy-gain
  formula identically for every boid; `foodRatioSamples` accumulates it
  per-tick and feeds `computeResourceManagement` (`boids.ts:1662-1670`, a
  flat time-average) — one of the score's four factors.
- `TribeConfig` (`boids.ts:33-45`) has no food fields at all — this is new
  ground, same as every other F-09 field was before that change.
- `applyLiveTribeConfigs` (`server-run-registry.ts`) does a WHOLESALE
  REPLACE of the `tribeConfigs` array — no per-field diffing exists anywhere
  today; every other live-adjustable field in this codebase (`foodRegenRate`
  itself included, pre-this-change) is "replace and use going forward," never
  a one-time delta injection.
- `ScoredRun`/`ScoredRunDisclosure` (`scored-run.ts`) is the existing
  guardian aggregate for score comparability — today gated only on
  `wasEverThrottled`. This is the established pattern for "this run's score
  may not be directly comparable," already used by the comparison/leaderboard
  views.
- `foodRegenRate` is today live-adjustable as a flat scalar via the existing
  `applyLiveParams`/`LiveAdjustableParams` path (S-27). This slice replaces
  that flat field's role with a derived sum of per-tribe shares.

## What We're NOT Doing

- Not splitting `foodStock` into physically separate per-tribe pools — one
  shared number, per the roadmap's own resolved Unknown and the Lua
  reference's own global-food model.
- Not making per-tribe food config admin-ranged differently per tribe — one
  shared range per field, matching F-09's own precedent.
- Not adding a separate UI section for food — the 3 new fields join each
  tribe's existing per-tribe tab from F-09.
- Not touching `computeAreaPopulationDensity`, `computePhaseQuality`, or the
  other three score factors — only `computeResourceManagement` changes.

## Phase 1: Data model & schema

### Overview
Add the three new per-tribe food fields to `TribeConfig` and the admin-range
machinery, reusing F-09's established array/validation structure wholesale.

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: define the three new per-tribe food contributions.
- **Contract**: add to `TribeConfig` (`boids.ts:33-45`): `foodStockShare:
  number`, `foodRegenShare: number`, `foodConsumptionRate: number`. No change
  to `BoidGenes` — these are tribe-level config, read via
  `tribeConfigs[flockId]`, same category as `neighborRadius`/`burstMult`
  from F-09 (not individual heritable genes).

**`src/server/simulation/parameter-ranges.ts`**:
- **Intent**: one shared admin range per new field, matching every other
  per-tribe field's precedent.
- **Contract**: add `foodStockShare`, `foodRegenShare`,
  `foodConsumptionRate` to `RANGED_PARAMETER_NAMES` and
  `TRIBE_RANGED_FIELD_NAMES`, with defaults chosen so `flockCount` tribes
  each at default reproduce today's exact pre-change behavior:
  `foodStockShare: {min: 0, max: 10_000, default: foodStockInitial's own
  default (100) / flockCount's own default (2) = 50}`,
  `foodRegenShare: {min: 0, max: 1_000, default: foodRegenRate's own default
  (10) / 2 = 5}`, `foodConsumptionRate: {min: 0, max: 10, default:
  FOOD_CONSUMPTION_PER_BOID's existing value, 0.5}`. (The exact default
  numbers are an implementer judgment call within these constraints — the
  invariant that matters is: N tribes at default stock/regen shares must sum
  to the pre-change scalar defaults, so an untouched multi-tribe run's food
  dynamics are unchanged from before this phase lands.)

**`src/server/api/routers/simulation.ts`**:
- **Intent**: validate the 3 new fields the same way F-09's 6 fields are
  validated.
- **Contract**: the `tribeConfigSchema` zod object (used by both
  `startInputSchema.tribeConfigs` and `updateTribeConfigs`'s input) gains the
  3 new `z.number().finite()` fields. `checkAgainstAdminRanges`'s existing
  nested per-tribe loop (iterating `TRIBE_RANGED_FIELD_NAMES`) covers them
  automatically once added to that list — no new loop needed.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/server/api/routers/simulation.test.ts` passes
  (extended: a `tribeConfigs` entry with a food field outside the shared
  admin range rejects)

#### Manual Verification:
- None — pure schema/validation, verified by Phase 7's end-to-end check.

## Phase 2: Engine — pool seeding & regen (sum combination)

### Overview
The shared pool's initial stock and each tick's regen contribution become
sums over the tribes present, replacing the flat scalar reads — with zero
change to `applyHunger`'s regen math itself.

### Changes Required

**`src/server/simulation/server-run-registry.ts`** (and the client-staged
equivalent in `simulation-canvas.tsx`):
- **Intent**: seed `foodStock` from the sum of per-tribe stock shares at run
  creation, not from a free top-level scalar input.
- **Contract**: at `startServerRun`'s (and `simulation-canvas.tsx`'s init
  effect's) `foodStock` seeding site, compute
  `tribeConfigs.reduce((sum, t) => sum + t.foodStockShare, 0)` and use that
  as the seed value in place of `params.foodStockInitial`. The top-level
  `foodStockInitial` schema field stays (read by `parameter-suggestion.ts`/
  corpus scripts/legacy history), but is no longer the actual seed source
  for a run's live pool — document this split clearly in a code comment at
  the seeding site, matching F-09's own precedent for "old scalar field
  still exists in the schema, no longer drives engine behavior."

**`src/server/simulation/boids.ts`** (`runTick`, the `applyHunger` call site
at `boids.ts:1246-1251` — confirmed via plan-review F1; NOT in
`single-run-lifecycle.ts`):
- **Intent**: each tick's regen contribution is the sum of the CURRENT
  per-tribe regen shares (so a live edit to one tribe's share changes the
  effective regen on the very next tick, matching this project's existing
  "live edit takes effect on the next tick" convention from S-27).
- **Contract**: replace the flat `params.foodRegenRate` argument (currently
  at `boids.ts:1250`) with `params.tribeConfigs.reduce((sum, t) => sum +
  t.foodRegenShare, 0)`, computed fresh each call. `applyHunger`'s own
  signature and internal math (`boids.ts:1086-1108`) do NOT change — it still
  takes one flat `foodRegenRate: number`; only the VALUE passed in changes
  from "read a scalar" to "sum an array."

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts
  src/server/simulation/server-run-registry.test.ts` passes (extended: a run
  with two tribes at stock shares 30/70 seeds `foodStock` at exactly 100; a
  run with two tribes at regen shares 4/6 ticks forward with the same food
  trajectory as a pre-change run configured with a flat `foodRegenRate: 10`)

#### Manual Verification:
- None — covered by Phase 7.

## Phase 3: Engine — per-tribe consumption

### Overview
Per-boid food consumption now reads each boid's own tribe's configured rate,
replacing the single flat `FOOD_CONSUMPTION_PER_BOID` constant.

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: a tribe configured for a higher consumption rate depletes the
  shared pool faster per boid than a tribe configured lower.
- **Contract**: `applyHunger` gains a `tribeConfigs: TribeConfig[]`
  parameter (same `= []` optional-default pattern Phase 3 of F-09
  established for `stepBoids`, so every existing direct call in tests
  without `tribeConfigs` keeps today's exact behavior via a fallback
  constant). Replace `boids.length * FOOD_CONSUMPTION_PER_BOID *
  dtSeconds` with a sum over `boids`, each boid contributing
  `(tribeConfigs[boid.genes.flockId]?.foodConsumptionRate ??
  FOOD_CONSUMPTION_PER_BOID) * dtSeconds` — same per-boid-lookup-with-
  fallback convention Phase 3/4 of F-09 established for
  `neighborRadius`/`burstMult`. Thread `tribeConfigs` through from
  `runTick`'s own call site to `applyHunger` (`runTick` already receives
  `params.tribeConfigs` for `stepBoids`, so this is passing an already-
  available value one call further, not acquiring a new one).

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts` passes (extended: two
  tribes with different `foodConsumptionRate` values and equal headcounts
  deplete the shared pool at measurably different rates attributable to each
  tribe's own share; omitting `tribeConfigs` reproduces today's exact
  flat-rate behavior byte-for-byte)

#### Manual Verification:
- None — covered by Phase 7.

## Phase 4: Live adjustment

### Overview
`foodRegenShare` and `foodConsumptionRate` are live-adjustable the same way
every other `TribeConfig` field is (replace-and-use-going-forward, via the
existing `applyLiveTribeConfigs`). `foodStockShare` gets a new mechanic: a
live edit injects the one-time delta against that tribe's own
last-submitted share into the live pool, not a full reseed.

### Changes Required

**`src/server/simulation/server-run-registry.ts`**:
- **Intent**: `foodRegenShare`/`foodConsumptionRate` need no new mechanism —
  `applyLiveTribeConfigs`'s existing wholesale-replace already covers them,
  since Phase 2/3 above read `run.params.tribeConfigs` fresh each tick.
  `foodStockShare` needs its own delta-injection logic, since the pool's
  current level is not something a wholesale config replace should silently
  reset.
- **Contract**: inside `applyLiveTribeConfigs` (or a small helper it calls
  before the wholesale replace), for each tribe index `i`: compute `delta =
  patch[i].foodStockShare - run.params.tribeConfigs[i].foodStockShare`
  (diffing against the CURRENT stored value, i.e. the tribe's own
  last-submitted share — composable across repeated edits, per the decided
  semantics) and add `delta` once to `run.foodStock` (the live pool level),
  clamped to stay non-negative. This runs BEFORE `run.params =
  {...run.params, tribeConfigs: patch}` replaces the stored values, so the
  diff is always against the immediately-prior state, never the original
  run-start value.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/server-run-registry.test.ts` passes
  (extended: a live edit raising tribe 0's `foodStockShare` by 10 adds
  exactly 10 to the live pool once, not repeatedly; a SECOND live edit that
  doesn't change tribe 0's `foodStockShare` at all injects zero delta even
  though the full `tribeConfigs` array was resubmitted; a live edit to
  `foodRegenShare`/`foodConsumptionRate` changes the NEXT tick's regen/
  consumption without affecting the pool's current level directly)

#### Manual Verification:
- None — covered by Phase 7.

## Phase 5: Scoring

### Overview
`computeResourceManagement`'s formula changes to weight per-tribe food
balance, as a strict generalization of the existing formula: a run where
every tribe's net food contribution is proportional to its population share
scores IDENTICALLY to the pre-change formula; only genuine imbalance changes
the score. Runs where imbalance is ever actually measured get a new
disclosure marker, extending the existing `ScoredRun` comparability pattern.

### Changes Required

**`src/server/simulation/boids.ts`**:
- **Intent**: define "per-tribe balance" concretely — not "stock remaining
  for tribe X" (meaningless in a shared-pool model), but whether each
  tribe's net food contribution rate matches what its population share
  would imply.
- **Contract**: new per-tick sample, call it `tribeFoodImbalanceSamples`:
  for each tribe `i`, compute its net rate `net_i = foodRegenShare_i -
  foodConsumptionRate_i * headcount_i`; compute the "proportional" net rate
  each tribe would have if contributions tracked population exactly:
  `fairNet_i = (sum of all net_i) * (headcount_i / totalHeadcount)`; this
  tick's imbalance sample is the mean absolute deviation
  `mean(|net_i - fairNet_i|)` across tribes, normalized by the total
  population's combined consumption so the sample stays comparable across
  different population sizes. A single-tribe run, or a run where every
  tribe's share is already proportional to its headcount, always produces
  imbalance `0` for every sample.
- `computeResourceManagement(foodRatioSamples: number[],
  tribeFoodImbalanceSamples: number[] = [])`: new optional second parameter
  (same `= []` default-value convention as `computeGeneticDiversity`'s
  `tribeConfigs` param in F-09, so every existing caller/test without it
  keeps today's exact return value). New formula: `baseRatio * (1 -
  averageImbalance)`, where `baseRatio` is the existing flat average and
  `averageImbalance` is clamped to `[0, 1]`. When `tribeFoodImbalanceSamples`
  is empty or all-zero, this reduces to exactly `baseRatio * 1` — the
  original formula, unchanged. This is the backward-compatibility guarantee
  this phase must preserve and test explicitly.

**`src/server/simulation/scored-run.ts`**:
- **Intent**: a run that ever actually measured non-zero imbalance gets a
  second, independent reason its score may not be directly comparable to a
  legacy or single-tribe run — extending the existing pattern, not
  replacing it.
- **Contract**: add a `wasEverFoodImbalanced: boolean` constructor
  parameter/DB column (same sticky-marker shape as `wasEverThrottled` — set
  once, true the first tick an imbalance sample exceeds a small epsilon,
  never cleared; copy the exact write-once pattern at
  `server-run-registry.ts:640-663`: a fire-and-forget
  `db.update(simulationRuns).set({wasEverFoodImbalanced: true}).where(...)`
  gated by a new in-memory write-once flag on the run object, flipping to
  `true` only on write success). `disclose()`'s `comparable` becomes
  `!wasEverThrottled && !wasEverFoodImbalanced`; `disclaimer` concatenates
  both reasons when both apply (reuse the existing `?` ternary shape,
  extended to two independent conditions rather than one). `ScoredRun.from()`
  has 3 production call sites (plan-review F2): two (`simulation.ts:815`
  inside `listCompleted`, `simulation.ts:885` inside
  `getParameterSuggestion`) use an explicit `.select({...})` that must add
  `wasEverFoodImbalanced: simulationRuns.wasEverFoodImbalanced` alongside
  their existing `wasEverThrottled` select; the third
  (`simulation.ts:1102`, the comparison path) uses a full-row query and
  needs only the new field passed through, no SELECT change.

**`src/server/db/schema.ts`**:
- **Intent**: persist the new sticky marker.
- **Contract**: add `wasEverFoodImbalanced: d.integer({mode:"boolean"}).
  notNull().default(false)` to `simulationRuns`, same pattern as
  `wasEverThrottled`/`wasAutoStopped`.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npx vitest run src/server/simulation/boids.test.ts
  src/server/simulation/scored-run.test.ts` passes (extended: a
  single-tribe run's `computeResourceManagement` result is byte-identical
  with and without the new parameter; a multi-tribe run with proportional
  shares also reproduces the exact pre-change score; a multi-tribe run with
  deliberately skewed shares scores measurably lower; `ScoredRun.disclose()`
  reports `comparable: false` with both disclaimers present when a run is
  both throttled and imbalanced, and the correct single disclaimer when only
  one applies)

#### Manual Verification:
- None — covered by Phase 7.

## Phase 6: UI

### Overview
The 3 new fields join each tribe's existing per-tribe tab from F-09 — no
new UI structure.

### Changes Required

**`src/app/simulation/page.tsx`**:
- **Intent**: let the user configure each tribe's food stock share, regen
  share, and consumption rate alongside the 11 fields F-09 already put in
  each tribe's tab.
- **Contract**: add 3 more `NumberField` entries to `tribeFieldDefs` (the
  field-descriptor array driving each `TabsContent`'s render loop) and to
  `DEFAULT_TRIBE_CONFIGS`' per-tribe defaults (values matching Phase 1's
  admin-range defaults, split evenly or per the Lua reference if it has an
  equivalent per-tribe food concept — check `config.lua` for this during
  implementation; if no equivalent exists there, even split across tribes
  is the implementer's default). `buildStartInput`'s per-tab
  `tribeConfigsOutput` construction picks these up automatically once
  they're part of each tribe's state object, same as every other field.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes

#### Manual Verification:
- Each tribe's tab shows the 3 new food fields alongside the existing 11;
  values submit correctly and independently per tribe (same check pattern
  as F-09's Phase 8).

## Phase 7: Backward compatibility & verification

### Overview
Legacy-row handling for the new `wasEverFoodImbalanced` column and
gene/value-level manual verification of the full per-tribe food flow,
closing the same class of "UI accepts input is not feature verified" gap
this project's own lessons.md warns about.

### Changes Required

**Analysis/comparison views**: no change expected — per F-09's own Phase 9
finding, no view currently reads `tribeConfigs`-derived data directly; the
new `wasEverFoodImbalanced` flows through the existing `ScoredRun`
abstraction, which every comparability-aware view already consumes via
`disclose()`, so this should be automatically covered without a new
guard — confirm this during implementation rather than assuming it.

### Success Criteria

#### Automated Verification:
- `npm run typecheck` passes
- `npm test` passes (full suite)

#### Manual Verification:
- Start a run with 2+ tribes configured to visibly different stock/regen/
  consumption values; confirm the seeded `foodStock` equals the sum of
  configured stock shares (inspect directly via the registry, not just the
  UI echo — same discipline as F-09's Phase 9).
- Live-edit one tribe's `foodStockShare` mid-run; confirm the live pool
  changes by exactly the delta, once, and a second edit that doesn't change
  that tribe's share injects nothing.
- Live-edit `foodRegenShare`/`foodConsumptionRate`; confirm the next tick's
  pool trajectory changes accordingly.
- Run a deliberately imbalanced multi-tribe scenario to completion; confirm
  the final score differs from an otherwise-identical balanced scenario, and
  that the imbalanced run's `disclose()` reports `comparable: false` with
  the new disclaimer present.
- Open an old (pre-this-change) completed run's analysis/comparison page;
  confirm no error and `comparable: true` (no false-positive imbalance
  marker on a legacy row).

## Performance Considerations

Phase 3's per-boid consumption sum replaces a single multiplication
(`boids.length * constant`) with a loop over `boids` doing one array lookup
each — O(n) either way, no new allocation per tick, no spatial-grid
involvement. No wall-clock regression risk comparable to F-09's Phase 3
(this touches `applyHunger`, not the neighbor-search grid).

## References

- `boids.ts:33-45` (`TribeConfig`), `:150` (`FOOD_CONSUMPTION_PER_BOID`),
  `:1086-1108` (`applyHunger`), `:1264-1267` (`foodAvailabilityRatio`),
  `:1662-1670` (`computeResourceManagement`).
- `server-run-registry.ts` (`applyLiveTribeConfigs`, `LiveRun.foodStock`,
  `startServerRun`'s seeding site).
- `scored-run.ts` (the `ScoredRun`/`disclose()` comparability pattern).
- `parameter-ranges.ts` (`RANGED_PARAMETER_NAMES`,
  `TRIBE_RANGED_FIELD_NAMES`, `DEFAULT_PARAMETER_RANGES`).
- `context/archive/2026-11-17-per-tribe-behavior-weights/plan.md` — the
  direct precedent for nearly every structural decision in this plan
  (per-tribe array shape, admin-range convention, live-edit pattern,
  UI tab structure, backward-compat discipline).
- `context/foundation/lessons.md` — "UI accepts input is not feature
  verified" (the precedent this plan's Phase 7 manual verification exists
  to avoid repeating, a second time, for a second feature).

## Progress

### Phase 1: Data model & schema
#### Automated
- [x] 1.1 npm run typecheck passes — 4ea749a
- [x] 1.2 npm run check passes — 4ea749a
- [x] 1.3 npx vitest run src/server/api/routers/simulation.test.ts passes — 4ea749a

### Phase 2: Engine — pool seeding & regen (sum combination)
#### Automated
- [x] 2.1 npm run typecheck passes — fa6321f
- [x] 2.2 npx vitest run src/server/simulation/boids.test.ts src/server/simulation/server-run-registry.test.ts passes — fa6321f

### Phase 3: Engine — per-tribe consumption
#### Automated
- [x] 3.1 npm run typecheck passes — 82c5242
- [x] 3.2 npx vitest run src/server/simulation/boids.test.ts passes — 82c5242

### Phase 4: Live adjustment
#### Automated
- [x] 4.1 npm run typecheck passes — 3557244
- [x] 4.2 npx vitest run src/server/simulation/server-run-registry.test.ts passes — 3557244

### Phase 5: Scoring
#### Automated
- [x] 5.1 npm run typecheck passes — 72cf5f3
- [x] 5.2 npx vitest run src/server/simulation/boids.test.ts src/server/simulation/scored-run.test.ts passes — 72cf5f3

### Phase 6: UI
#### Automated
- [x] 6.1 npm run typecheck passes — 3b4b4f0
- [x] 6.2 npm run check passes — 3b4b4f0
#### Manual
- [x] 6.3 Each tribe's tab shows the 3 new food fields, submits correctly and independently — 3b4b4f0

### Phase 7: Backward compatibility & verification
#### Automated
- [x] 7.1 npm run typecheck passes — 8d5b413
- [x] 7.2 npm test passes (full suite) — 8d5b413
#### Manual
- [x] 7.3 Seeded foodStock equals sum of configured stock shares (direct inspection) — 8d5b413
- [x] 7.4 Live stock-share delta injects exactly once per actual change — 8d5b413
- [x] 7.5 Live regen/consumption edits change next-tick trajectory — 8d5b413
- [x] 7.6 Imbalanced vs balanced scenario scores differ; disclose() reports correctly — 8d5b413
- [x] 7.7 Legacy run shows no error and comparable: true — 8d5b413
