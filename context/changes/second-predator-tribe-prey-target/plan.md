# Second predator tribe with configurable prey target Implementation Plan

## Overview

Give each predator tribe a configurable prey target — boids only, or boids and predators — so a
second predator tribe can hunt the first (never its own tribemates), with outcomes feeding a new
6th scoring factor measuring predator-tribe population balance. UI exposure mirrors S-42's
crossbreeding-flag pattern in both the start-form and live-edit panels.

## Current State Analysis

- `stepPredators` (`boids.ts:902-996`) scans only `boids` for a nearest target, no spatial grid,
  gated by `detectionRadius`; its no-target fallback is "idle wander," not frozen heading.
- `applyPredation` (`boids.ts:1269-1343`) builds one boid-only spatial grid, captures into a
  `Set<BoidState>`, and returns only `BoidState[]` — predators are never candidates and never
  removed. `protectionThreshold` (`:1285-1287`) is the only early-out, boid-population-only.
- Predators today die from exactly one mechanism: natural lifespan expiry (confirmed via
  `PredatorState`'s own doc comment and the absence of any predator-removal step in the
  documented tick pipeline). S-43 introduces the first-ever second death mechanism.
- `PredatorTribeConfig` (`boids.ts:81-94`) has no `target`/`prey` field; neither does
  `predatorTribeConfigSchema` (`simulation.ts:119-131`) or `startInputSchema`.
- `computeScore` (`boids.ts:1992-2014`) is a flat 5-argument multiplicative formula with 3 call
  sites (`server-run-registry.ts`'s `buildFinishPayload`, `simulation.ts`'s `stop` mutation,
  `boids.test.ts`). No per-tick-sampled factor is ever computed from a single final snapshot —
  every existing factor (resourceManagement, phaseQuality, areaPopulationDensity) is time-averaged
  over an accumulated per-tick sample array, following the exact `computeAreaPopulationDensity`
  (S-25) thread: `runTick`'s return → `single-run-lifecycle.ts` → `server-run-registry.ts`
  (`LiveRun`, `tick()`, `buildFinishPayload`, `ServerRunSnapshot`/resume with a `?? []`
  backward-compat fallback) → `simulation.ts` (`stop` mutation + `getRunsComparison`'s optional
  breakdown read).
- There is no score-formula-version flag anywhere in this codebase. Comparability across runs
  that may or may not exercise a newer mechanic uses a **sticky write-once boolean** per concern
  (`wasEverThrottled`, `wasEverFoodImbalanced`) read through `ScoredRun` (`scored-run.ts`, full
  file ~63 lines) — each backed by its own `.notNull().default(false)` DB column, latched once on
  a successful write, never cleared, and surfaced as a plain-language disclaimer via `.disclose()`.
  The persisted `score` itself is never retroactively recomputed; only the comparison view's
  *display* breakdown is.
- The population-wipeout stop condition (`single-run-lifecycle.ts:250-251`,
  `nextBoids.length === 0`) is boid-only today.
- `src/components/ui/` has `Select` (a thin native-`<select>` wrapper) already precedented once
  for a 2-value string enum (`feedback-sheet.tsx`'s category field) — no `RadioGroup` exists.
  `crossbreedingEnabled`'s existing Switch pattern (sibling setter, not a widened numeric setter;
  a dedicated `handleTribeFieldChange` overload in the live-edit panel) is the structural template
  to mirror, substituting `Select`+`<option>` for `Switch` since `preyTarget` is a named enum, not
  a boolean.
- `reproducePopulation`'s crossbreeding gate (`boids.ts:1153-1156`) is the one existing place in
  this codebase where two tribes of the same species interact subject to each tribe's own
  independent per-tribe flag — a "permission to interact" gate, not a "targeting" gate, so not a
  perfect precedent for hunting, but structurally analogous to `preyTarget`'s own cross-tribe gate.

### Key Discoveries:

(see "Current State Analysis" above — consolidated there to avoid duplication)

## Desired End State

A user configures a second predator tribe's prey target to "boids and predators" (the first
stays at its default "boids only"); starts or resumes a run; the second tribe's predators hunt
both boids and the first tribe's predators, never their own tribemates, respecting
`protectionThreshold` as a floor against total wipeout of either tribe; the run's final score
includes a 6th factor reflecting how balanced (or lopsided) the two predator tribes' populations
ended up, with existing single-tribe runs scoring that factor as a neutral 1.0 (no-op).

Verification: `npm run typecheck`, `npm test`, `npm run check`, `npm run build`, plus a direct
behavioral script and dedicated unit tests proving the gate, the floor, and the scoring math.

## What We're NOT Doing

- No reciprocal "protection" from a tribe's own `preyTarget` setting — the field controls only
  what a tribe hunts, never whether it can be hunted; this is a deliberate, explicit user decision.
- No self-cannibalization — a tribe targeting "predators" never includes its own tribemates in
  the target search, regardless of `preyTarget`'s value.
- No new, separate capture-radius/multiplier field for inter-predator hunting — reuses the
  existing `CAPTURE_RADIUS`/`captureRadiusMult` mechanic exactly as boid capture already does.
- No new run-ending stop condition for predator-tribe extinction — only total boid-population
  wipeout ends a run early, exactly as today; a predator tribe reaching 0 members is a valid,
  continuing outcome whose balance-factor sample simply reflects the imbalance for the rest of
  the run.
- No analysis-view/genetic-diversity integration — the new 6th factor appears in the final score
  the same way every other factor does, with no new chart/breakdown UI, mirroring F-10's own
  explicit precedent of deferring predator analysis-view work.
- No live-edit UI cut if time runs short — the user explicitly chose "everything ships together,"
  overriding the live-edit-is-the-cut recommendation.
- No score-formula-version flag — comparability for runs where predator-tribe imbalance actually
  occurred follows the existing sticky-boolean + `ScoredRun` pattern, not a new versioning concept.

## Implementation Approach

Five dependency-ordered phases: the engine mechanic first (isolating the riskiest piece — a
breaking return-type change to `applyPredation` — into its own early, independently-gated phase),
then the schema/validation layer that exposes it, then the cross-cutting scoring thread (the
widest blast radius, touching ~6 files end-to-end), then UI in both places, then verification.

## Critical Implementation Details

**Protection-floor reuse, not a new field.** `protectionThreshold` is a single flat run param
checked today only against total boid count. For predator-tribe protection, Phase 1 adds a
**new check** (per predator tribe: if that tribe's own population ≤ `protectionThreshold`, its
members are immune to inter-predator capture) that reuses the existing threshold *value* against
a *different* population figure — it does not add a new per-tribe config field.

**Flat scan, not a new grid, for predator-vs-predator detection.** `stepPredators`'s existing
boid-target scan is already an unconditional flat `for...of` loop with no spatial grid (unlike
`applyPredation`, which does build one). For consistency and because predator counts are
typically small, the new predator-vs-predator scan in `stepPredators` is also a flat loop, not a
second spatial grid — `applyPredation`'s own new predator-capture path, however, does build a
second grid (mirroring its existing boid-grid pattern), since `applyPredation` already uses
`queryRadius` exact-match semantics that a flat scan would duplicate awkwardly.

**`computeScore`'s blast radius before changing its signature.** Before widening `computeScore`
to 6 arguments, grep for every caller — not just the 3 production/test sites research found
(`server-run-registry.ts`, `simulation.ts`, `boids.test.ts`) — specifically check
`scripts/corpus/`/`scripts/perf-baseline.ts` for any direct call, since `per-tribe-predator-config`
Phase 2 found and fixed two such scripts calling `ServerRunParams`-derived types without being in
the plan's own original file list.

## Phase 1: Engine core — cross-tribe predator targeting and capture

### Overview

Add `preyTarget: "boids" | "boids-and-predators"` to `PredatorTribeConfig`; extend
`stepPredators`'s target scan to also consider other-tribe predators when gated; widen
`applyPredation`'s return type to carry predator casualties, with same-tribe always excluded and
`protectionThreshold` reused as a per-tribe floor.

### Changes Required:

#### 1. `PredatorTribeConfig` type and target-search gate

**File**: `src/server/simulation/boids.ts`

**Intent**: `PredatorTribeConfig` gains the new field. `stepPredators` resolves each predator's
own tribe's `preyTarget` and, when it includes `"boids-and-predators"`, also scans `predators`
(excluding same-`flockId` and self) as a second nearest-candidate alongside the existing
boid-nearest-candidate, choosing whichever is actually nearer (or whichever is in range, if only
one is) — falling back to the existing idle-wander branch when neither is found/in-range.

**Contract**: `PredatorTribeConfig.preyTarget: "boids" | "boids-and-predators"` is a new required
field. `stepPredators`'s signature is unchanged (it already receives `predatorTribeConfigs`); the
gate reads via the existing module-private `predatorTribeField` helper, same pattern as
`detectionRadius`.

#### 2. `applyPredation`'s parallel predator-capture path

**File**: `src/server/simulation/boids.ts`

**Intent**: Add a second spatial grid over `predators` (mirroring the existing boid-grid build)
and a parallel capture loop: for each predator whose own tribe's `preyTarget` includes
`"boids-and-predators"`, query the predator grid within its `captureRadius` (same
`CAPTURE_RADIUS * captureRadiusMult` formula already used for boids), skip same-`flockId`
candidates and anything already captured this tick, and capture the nearest eligible other-tribe
predator. A predator tribe whose own population is at or below `protectionThreshold` is immune —
checked per-tribe, not via the existing boid-population-only early-out.

**Contract**: `applyPredation`'s return type widens from `BoidState[]` to
`{ boids: BoidState[]; predators: PredatorState[] }` — a breaking signature change. Update every
call site: `runTick` (destructure the new shape, build `agedPredators` from the predated
population instead of straight from `steeredPredators`), every direct test caller in
`boids.test.ts`, and `pipeline.test.ts`'s 4 direct callers (lines 207, 260, 329, 341 as of
plan-review — confirm current line numbers at implementation time).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- `boids.test.ts` passes: `npx vitest run src/server/simulation/boids.test.ts`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase (pure engine logic, fully covered by automated tests).

---

## Phase 2: Schema, validation, and bridge defaults

### Overview

Expose `preyTarget` through the zod layer (one schema shared by the start-form submit path and
the live-edit mutation), default it to `"boids"` everywhere for zero behavior change on existing
runs, and update affected test fixtures.

### Changes Required:

#### 1. Zod schema

**File**: `src/server/api/routers/simulation.ts`

**Intent**: `predatorTribeConfigSchema` gains `preyTarget: z.enum(["boids", "boids-and-predators"])`.
Since this single schema backs both `startInputSchema.predatorTribeConfigs` and
`updatePredatorTribeConfigs`'s input, one edit covers both the start-form and live-edit paths —
`applyLivePredatorTribeConfigs` already does a wholesale array replace, so no further code change
is needed in that mutation body.

**Contract**: `preyTarget` must NOT be added to `PREDATOR_TRIBE_RANGED_FIELD_NAMES` — it is a
fixed 2-value enum, not an admin-rangeable number.

#### 2. Default bridges and fixtures

**File**: `src/app/simulation/page.tsx`, test fixtures across the project

**Intent**: `DEFAULT_PREDATOR_TRIBE_CONFIG`/any other named predator-tribe fixture gains
`preyTarget: "boids"` — matches today's actual behavior exactly (predators have never hunted
anything but boids), so no existing or default-configured run changes behavior.

**Contract**: Update every fixture that constructs a `PredatorTribeConfig` literal (mirrors the
exact file list `per-tribe-predator-config`'s own Phase 2 touched for `crossbreedingEnabled`):
`src/server/api/routers/simulation.test.ts`, `src/server/simulation/boids.test.ts`,
`src/server/simulation/server-run-registry.test.ts`,
`src/server/simulation/server-run-registry-capacity.test.ts`,
`src/server/simulation/pipeline.test.ts`, `src/server/simulation/pipeline-perf.test.ts`,
`src/server/simulation/single-run-lifecycle.test.ts`,
`src/app/simulation/_components/simulation-canvas.test.tsx`,
`src/app/simulation/_components/server-run-viewer.test.tsx`, `scripts/perf-baseline.ts`,
`scripts/corpus/harness.test.ts` (its own locally-defined `DEFAULT_PREDATOR_TRIBE_CONFIG`
literal, confirmed via plan-review's blast-radius sweep). Grep for every `PredatorTribeConfig`-shaped
literal before considering this phase complete — this file list is a starting point from
precedent, not guaranteed exhaustive.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase.

---

## Phase 3: Scoring — new 6th factor and comparability flag

### Overview

Add a new per-tick-sampled score factor measuring predator-tribe population balance (1.0 when
fewer than 2 predator tribes exist or they're perfectly balanced, lower when imbalanced),
threaded through the full S-25-precedent pipeline, plus a sticky comparability flag for runs
where imbalance actually occurred.

### Changes Required:

#### 1. New compute function and `runTick` sample

**File**: `src/server/simulation/boids.ts`

**Intent**: A new exported `compute*` function (naming mirrors `computeAreaPopulationDensity`'s
own shape) takes a per-tick balance sample array and returns the time-averaged factor, doing its
own normalization at aggregation time — not collection time — exactly like
`computeAreaPopulationDensity` does. `runTick` computes one raw per-tick sample (a ratio of the
smaller predator tribe's population to the larger, defaulting to `1.0` when fewer than 2 tribes
have any members) and returns it as a new field, mirroring how `tribeFoodImbalanceSample` already
flows out of `runTick`'s own return type.

**Contract**: `computeScore`'s signature widens to 6 arguments — grep for every caller first (see
"Critical Implementation Details"), not just the 3 already-known sites, before changing it.

#### 2. Thread the new sample through the full pipeline

**File**: `src/server/simulation/single-run-lifecycle.ts`, `src/server/simulation/server-run-registry.ts`, `src/server/api/routers/simulation.ts`

**Intent**: Mirror the `populationDensitySamples` (S-25) thread exactly, hop by hop:
`computeSingleRunTick`'s `state`/params/return types gain the new array;
`LiveRun`/`tick()`/`buildFinishPayload`/`ServerRunSnapshot` in `server-run-registry.ts` each gain
the field, with `resumeServerRun` restoring it via a `?? []` fallback (the exact precedent
guarding against a pre-existing saved run with no such key); `simulation.ts`'s client-staged
`stop` mutation gains the array in its zod input and history write; `getRunsComparison`'s
backward-compat breakdown read treats the field as optional with an `Array.isArray` guard,
computing `null` for historical rows that never collected it.

**Contract**: No change to `getLiveRunState`/`LiveRunSnapshot` — per-tick sample arrays are never
exposed live today (`populationDensitySamples` isn't either), only final-score-time aggregates.

#### 3. Comparability flag

**File**: `src/server/db/schema.ts`, `src/server/simulation/scored-run.ts`, `src/server/simulation/server-run-registry.ts`, `src/server/api/routers/simulation.ts`

**Intent**: A new sticky write-once boolean (e.g. `wasEverPredatorTribeImbalanced`), identical
shape to `wasEverFoodImbalanced`: a new DB column (`.notNull().default(false)`, additive
migration), a new `LiveRun`-level latch set once on a successful DB write (never cleared), a new
`ScoredRun` constructor param + disclose-reason, and the client-staged `stop` mutation's
equivalent derived-once-in-one-shot logic.

**Contract**: The persisted `score` itself is never retroactively recomputed — only the
comparison view's display breakdown reads the new factor as `null`/neutral for historical rows
that predate this change.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:generate` (dry-run review)
- Typecheck passes: `npm run typecheck`
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase (scoring math fully covered by automated tests in Phase 5; this phase is
  the plumbing).

---

## Phase 4: UI — prey-target control, start-form and live-edit

### Overview

Add a `preyTarget` `Select` inside each predator tribe tab in both `page.tsx`'s start-form and
`server-run-viewer.tsx`'s live-edit panel, each with its own sibling setter/overload — not
reusing `crossbreedingEnabled`'s boolean-typed path.

### Changes Required:

#### 1. Start-form Select

**File**: `src/app/simulation/page.tsx`

**Intent**: A `Select` with two `<option>`s ("Boids only" / "Boids and predators") inside each
predator tribe tab, alongside the existing `crossbreedingEnabled` Switch — mirrors
`feedback-sheet.tsx`'s own 2-value-enum `Select` usage, the established precedent for this exact
shape.

**Contract**: A new `updatePredatorTribePreyTarget(index: number, value: "boids" | "boids-and-predators")`
sibling setter (not a widened `updatePredatorTribeField`, matching `updatePredatorTribeCrossbreeding`'s
own precedent). `buildStartInput`'s per-tribe output gains a `preyTarget: tribeConfig.preyTarget`
pass-through line (no admin-range clamping needed, same as the boolean field).

#### 2. Live-edit Select

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: A new `renderTribePreyTargetSelect(index, value)` render helper, called only from the
predator-tribe render block (boids have no `preyTarget`-equivalent), alongside the existing
`renderTribeCrossbreedingSwitch` call.

**Contract**: A new `handleTribeFieldChange` overload specifically for
`field: "preyTarget", value: "boids" | "boids-and-predators"` (species narrowed to `"predator"`
only) — not reusing the existing boolean overload.

#### 3. Test updates

**File**: `src/app/simulation/_components/simulation-canvas.test.tsx` (if it references predator-tribe fixtures directly), `src/app/simulation/_components/server-run-viewer.test.tsx`

**Intent**: Add coverage for the new Select rendering and its setter/overload wiring in both
files, mirroring the existing `crossbreedingEnabled` Switch test coverage shape.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Component tests pass: `npx vitest run src/app/simulation/`
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- Configure 2 predator tribes via the start-form, set tribe 2's prey target to "boids and
  predators," start a run, and confirm (via direct DB/live-state inspection) the configured value
  round-trips correctly.
- Mid-run, use the live-edit panel to change a tribe's prey target; confirm the change persists
  through the next subscription push.

---

## Phase 5: Verification

### Overview

Dedicated behavioral tests proving the gate, the protection floor, and the scoring math, plus an
end-to-end verification script composing the full feature.

### Changes Required:

#### 1. Dedicated behavioral tests

**File**: `src/server/simulation/boids.test.ts`, `src/server/simulation/server-run-registry.test.ts`

**Intent**: Tests proving: (a) same-tribe predators are always safe regardless of `preyTarget`;
(b) a cross-tribe predator is hunted only when the hunting tribe's own `preyTarget` includes
`"boids-and-predators"`, never when it's `"boids"`; (c) a predator tribe at or below
`protectionThreshold` is immune to capture by another tribe; (d) `computeScore`'s new factor
returns exactly `1.0` for fewer than 2 predator tribes (the neutral/no-op case) and a correct
ratio for an imbalanced 2-tribe scenario.

**Contract**: Each test traces to a concrete, named assertion — no mirror-implementation tests
(assert against the oracle semantics decided in this plan, not against whatever the code happens
to compute).

#### 2. End-to-end verification script

**File**: scratch script (deleted after use, per this project's established verification
pattern — never committed)

**Intent**: Using the real engine functions (mirroring `per-tribe-predator-config`'s own Phase 6
script), construct a scenario with 2 predator tribes (one `"boids"`, one `"boids-and-predators"`),
advance ticks, and confirm: the second tribe's population grows at the first tribe's expense (or
at least that captures occur), the first tribe never captures anyone from the second, same-tribe
members are never captured, and the balance factor's computed value reflects the resulting
imbalance.

**Contract**: No production code changes — this phase is pure verification.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full build succeeds: `npm run build`

#### Manual Verification:

- Verification script's assertions all pass, confirmed via script output before the script is
  deleted.

---

## Testing Strategy

### Unit Tests:

- `stepPredators`'s cross-tribe target gate (same-tribe-safe, gated by `preyTarget`) — Phase 1.
- `applyPredation`'s parallel predator-capture path and protection-floor check — Phase 1.
- `computeScore`'s new 6th factor, including the <2-tribe neutral case — Phase 3/5.
- Schema validation for `preyTarget` across both the start-form and live-edit paths — Phase 2.
- Component tests for the new Select control in both UI locations — Phase 4.

### Integration Tests:

- A real server-run-backed test driving `updatePredatorTribeConfigs` to flip `preyTarget` mid-run
  and asserting actual next-tick capture behavior changes, not just the stored config (per this
  project's "UI accepts input ≠ feature verified" lesson) — Phase 5.
- End-to-end verification script — Phase 5.

### Manual Testing Steps:

1. Configure 2 predator tribes via the start-form, one targeting boids only, one targeting boids
   and predators; start a run; confirm the second tribe's population grows while the first
   shrinks or holds steady.
2. Mid-run, toggle a tribe's prey target via the live-edit panel; confirm the change takes effect
   within a few ticks.
3. Reduce one predator tribe's population near `protectionThreshold` (via a long-running
   scenario or a direct snapshot/resume) and confirm it stops being hunted once at or below the
   floor.

## Performance Considerations

`stepPredators`'s new cross-tribe scan is an additional flat `for...of predators` loop per
predator per tick, same O(predators²) shape the existing boid scan already has at O(predators ×
boids) — negligible at this project's typical population scales (predator counts are small
relative to boid counts). `applyPredation`'s new predator grid build is a second, smaller
`buildSpatialGrid` call per tick, mirroring the existing boid-grid cost.

## Migration Notes

The new `wasEverPredatorTribeImbalanced` DB column is a plain additive `.notNull().default(false)`
column — the same low-risk shape every prior `wasEverX` column in this project has used, requiring
no special migration handling beyond the standard `npm run db:generate` + apply flow. Historical
rows' `score` values are never recomputed; only the comparison view's display breakdown treats
the new factor as absent for those rows.

## References

- S-42 (per-tribe-predator-config) plan and plan-brief: `context/archive/2026-11-18-per-tribe-predator-config/plan.md`, `context/archive/2026-11-18-per-tribe-predator-config/plan-brief.md`
- F-10 (predator-tribe-concept) plan: `context/archive/2026-11-18-predator-tribe-concept/plan.md`
- `applyPredation`/`stepPredators`: `src/server/simulation/boids.ts:902-996`, `1269-1343`
- `computeAreaPopulationDensity` (S-25 precedent for the new 6th factor): `src/server/simulation/boids.ts:1974-1990`
- `ScoredRun` comparability pattern: `src/server/simulation/scored-run.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine core — cross-tribe predator targeting and capture

#### Automated

- [x] 1.1 Typecheck passes (clean for Phase 1's files; remaining errors confined to Phase 2/4's scope) — ff9c149
- [x] 1.2 boids.test.ts passes (110/110, includes pipeline.test.ts) — ff9c149
- [x] 1.3 Lint passes — ff9c149

### Phase 2: Schema, validation, and bridge defaults

#### Automated

- [x] 2.1 Typecheck passes (clean except the known UI-layer territory deferred to Phase 4) — 104916c
- [x] 2.2 Full test suite passes (495/496, 1 pre-existing skip) — 104916c
- [x] 2.3 Lint passes — 104916c

### Phase 3: Scoring — new 6th factor and comparability flag

#### Automated

- [x] 3.1 Migration generated and reviewed (applied: 117 rows preserved, zero data loss) — b404d13
- [x] 3.2 Typecheck passes (clean except the known UI-layer territory deferred to Phase 4) — b404d13
- [x] 3.3 Full test suite passes (502/503, 1 pre-existing skip) — b404d13
- [x] 3.4 Lint passes — b404d13

### Phase 4: UI — prey-target control, start-form and live-edit

#### Automated

- [x] 4.1 Typecheck passes (fully clean, repo-wide) — 95f5fe2
- [x] 4.2 Component tests pass (39/39) — 95f5fe2
- [x] 4.3 Full test suite passes (503/504, 1 pre-existing skip) — 95f5fe2
- [x] 4.4 Lint passes — 95f5fe2

#### Manual

- [x] 4.5 Start-form-configured prey target round-trips correctly — 95f5fe2
- [x] 4.6 Live-edit prey-target change persists through the next subscription push — 95f5fe2

### Phase 5: Verification

#### Automated

- [x] 5.1 Full test suite passes (510/511, 1 pre-existing skip)
- [x] 5.2 Typecheck passes
- [x] 5.3 Lint passes
- [x] 5.4 Full build succeeds

#### Manual

- [x] 5.5 Verification script's assertions all pass
