# Per-tribe predator config Implementation Plan

## Overview

Give predator tribes a real UI (start-form configuration + live-edit during an active run),
building on F-10's already-shipped engine mechanics (`PredatorTribeConfig`, admin ranges,
DB persistence, the `updatePredatorTribeConfigs` live-edit mutation). Along the way, replace
the single global `crossbreedingEnabled` run-level flag with a per-tribe flag on both
`TribeConfig` and `PredatorTribeConfig` — cross-tribe mating is now allowed only when BOTH
tribes involved have it enabled; same-tribe mating is always allowed regardless.

## Current State Analysis

- F-10 built the full engine/DB/validation side for predator tribes: `PredatorTribeConfig`
  (8 fields), admin ranges for 3 of 8, and `updatePredatorTribeConfigs` (mirrors
  `updateTribeConfigs` exactly). **No UI consumes any of this yet** — `page.tsx`'s
  `buildStartInput` hardcodes a non-interactive bridge (`predatorFlockCount: 1` + one default
  `PredatorTribeConfig`), and no component anywhere calls `updateTribeConfigs` or
  `updatePredatorTribeConfigs`.
- `crossbreedingEnabled` today is one boolean per run (`schema.ts:119`), threaded flat through
  `startInputSchema` → `ServerRunParams`/`single-run-lifecycle.ts` → `runTick` →
  `reproducePopulation`, which gates a cross-flock pair with
  `!params.crossbreedingEnabled && parentA.genes.flockId !== parentB.genes.flockId`
  (`boids.ts:1130-1138`). It also has a scalar live-edit path through `updateRunParams` /
  `LiveAdjustableParams`, rendered as a `<Switch>` in both `server-run-viewer.tsx` and
  `simulation-canvas.tsx`.
- `reproducePopulation` is generic over `BoidState | PredatorState` and called twice inside
  `runTick` (once per species) — `runTick` already has `tribeConfigs`/`predatorTribeConfigs`
  in scope at both call sites, so threading per-tribe config in is a same-file change.
- `maxSpeed`/`minSpeed` have no admin range for either species — the boid tab hardcodes UI
  bounds (`{min:1,max:300}`/`{min:0,max:300}`) in `tribeFieldDefs`. Predator UI will do the
  same unless an admin range is added.
- 3 of `PredatorTribeConfig`'s 8 fields (`separation`, `alignment`, `cohesion`) are seeded into
  predator genes but are currently behaviorally inert — predators don't run the full flocking
  steering loop boids do.
- `updateTribeConfigs`/`updatePredatorTribeConfigs` validate and pass through the **whole**
  tribe-config array wholesale (`applyLiveTribeConfigs`/`applyLivePredatorTribeConfigs`) — once
  a field is added to the zod schema, these two mutations carry it with no further code change.
- `LiveAdjustableParams` (`server-run-registry.ts:83-91`) is a field-enumerated `Pick<>` of
  `ServerRunParams` with no array-shaped equivalent — a per-tribe field cannot live there.
- No prior migration in this project has dropped a column; the `crossbreedingEnabled` column
  has no index/unique/FK, so SQLite's native `ALTER TABLE ... DROP COLUMN` applies directly.

### Key Discoveries:

- `boids.ts:1051-1064` — `reproducePopulation`'s `params` type has no `tribeConfigs` field at
  all today; it needs one, shaped per call site (`TribeConfig[]` for boids, `PredatorTribeConfig[]`
  for predators), to resolve each parent's own tribe's `crossbreedingEnabled`.
- `simulation.ts:1319-1447` — `updateTribeConfigs`/`updatePredatorTribeConfigs` already exist,
  are tested, and need zero code changes to carry a new tribe-config field through.
- `server-run-registry.ts:204-236` — `getLiveRunState`/`LiveRunSnapshot` already exposes
  `tribeConfigs`/`predatorTribeConfigs` as sibling fields to `liveParams`, specifically so a
  future live-edit panel can read from them — confirmed via its own code comment.
- `drizzle/0013_jazzy_thunderbolt.sql` — the project's migration convention is plain
  `ALTER TABLE ... ADD/DROP ...` statements; `npm run db:generate` should be run after the
  schema edit to confirm the exact DROP statement this repo's drizzle-kit version emits.
- `run-export.ts` CSV export has `crossbreedingEnabled` as a flat column with no natural
  per-tribe shape — dropped from the export entirely (see "What We're NOT Doing").

## Desired End State

A user can, before starting a run: choose how many predator tribes to spawn, tune each
predator tribe's speed bounds, detection radius, capture aggressiveness, mate preference, and
crossbreeding permission — in a tab panel mirroring the existing boid tribe tabs exactly. The
same per-tribe crossbreeding toggle now exists on boid tribes too, replacing the old single
run-level switch. During an active run, a new live-edit panel lets the user adjust any boid or
predator tribe's config (including crossbreeding) without restarting the run, and the engine
actually behaves accordingly on the very next tick.

Verification: `npm run typecheck`, `npm test`, `npm run check`, plus a direct behavioral script
proving (a) same-tribe mating always succeeds regardless of the flag, (b) a cross-tribe pair
mates only when both tribes' flags are true, (c) the start-form predator tab spawns the
configured tribe count/config, and (d) a live-edit panel change alters next-tick behavior.

### Key Discoveries:

(see "Current State Analysis" above — key discoveries are consolidated there to avoid
duplication for this plan)

## What We're NOT Doing

- Adding a second predator tribe via the UI, prey-target selection (boids-only vs.
  boids-and-predators), or inter-predator predation scoring — all explicitly S-43's job.
- Showing the 3 behaviorally-inert `PredatorTribeConfig` fields (`separation`, `alignment`,
  `cohesion`) in any UI — they stay on the type/schema (seeded at spawn, admin-range defaulted)
  but are not rendered.
- Keeping `crossbreedingEnabled` as a CSV export column (`run-export.ts`) — it had no natural
  per-tribe shape, so it is dropped from `RunExportRow`/`CSV_COLUMNS` entirely rather than
  expanded into N per-tribe columns.
- Migrating `corpus-fixture.test.ts`'s committed historical fixture corpus data — only its
  assertion list (`FULL_PARAM_FIELDS`) is adjusted to stop expecting the removed top-level field.
- Regenerating `context/fixtures/parameter-sweep-corpus/index.csv` or its `.json.gz` rows — this
  committed CSV (with a `crossbreedingEnabled` column) and its sibling fixture files stay as
  historical artifacts; Phase 2 #6a's sweep-axis redesign governs only future corpus generation,
  not the already-committed data.
- Cutting any of the 6 phases below if time runs short — the user explicitly decided this
  change ships as one unit, no fallback scope reduction.

## Implementation Approach

Six phases, strictly dependency-ordered: engine semantics first (so every later phase builds
on a correct, tested gate), then the schema/validation/thread-through removal of the old global
flag (the single largest mechanical phase — touches ~12 files), then the two independent
additions (admin range, start-form UI) that don't depend on each other, then the genuinely new
live-edit UI, then end-to-end verification.

## Critical Implementation Details

**Both-tribes-must-allow gate shape.** `reproducePopulation`'s new gate must read:
`!(tribeConfigs[parentA.genes.flockId]?.crossbreedingEnabled && tribeConfigs[parentB.genes.flockId]?.crossbreedingEnabled) && parentA.genes.flockId !== parentB.genes.flockId`
— same-tribe pairs (`flockId` equal) must bypass the tribe-array lookup entirely and always be
allowed, matching today's semantic that the old global flag only ever gated *cross*-flock pairs.

**Live-edit path fork.** `crossbreedingEnabled` moves from the scalar
`updateRunParams`/`LiveAdjustableParams`/`applyLiveParams` path to the array-wholesale-replace
`updateTribeConfigs`/`updatePredatorTribeConfigs`/`applyLiveTribeConfigs` path. These have
different `ParameterChangeEntry` semantics (real before/after value vs. a simplified 0/1
"changed" marker) — Phase 2 removes the old scalar entry; Phase 5's new panel uses the array
path's existing marker convention, consistent with how `applyLiveTribeConfigs` already records
other array-field changes.

## Phase 1: Engine core — per-tribe crossbreeding gate

### Overview

Add `crossbreedingEnabled: boolean` to `TribeConfig` and `PredatorTribeConfig`; rewrite
`reproducePopulation`'s gate to the both-tribes-must-allow rule; thread the tribe arrays into
both call sites inside `runTick`, which already has them in scope.

### Changes Required:

#### 1. Tribe config types and reproduction gate

**File**: `src/server/simulation/boids.ts`

**Intent**: Both species' tribe config types gain a per-tribe crossbreeding flag. The
reproduction gate stops reading one shared boolean and instead resolves each parent's own
tribe's flag, requiring both to be true for a cross-tribe pair.

**Contract**: `TribeConfig.crossbreedingEnabled: boolean` and
`PredatorTribeConfig.crossbreedingEnabled: boolean` are new required fields.
`reproducePopulation<T extends BoidState | PredatorState>`'s `params` type drops
`crossbreedingEnabled: boolean` and gains `tribeConfigs: { crossbreedingEnabled: boolean }[]`
(a minimal structural type so one generic function serves both species' differently-shaped
arrays). The gate at `boids.ts:1130-1138` is rewritten per "Critical Implementation Details"
above. Both call sites inside `runTick` (currently passing
`crossbreedingEnabled: params.crossbreedingEnabled`) instead pass
`tribeConfigs: params.tribeConfigs` (boid call) / `tribeConfigs: params.predatorTribeConfigs`
(predator call) — `runTick` already has both arrays in scope. `runTick`'s own params type drops
its top-level `crossbreedingEnabled: boolean` field now that neither call site reads it.

#### 2. Reproduction tests

**File**: `src/server/simulation/boids.test.ts`

**Intent**: `BASE_REPRODUCTION_PARAMS` and the `reproducePopulation` describe block's fixtures
gain a `tribeConfigs` array in place of the flat boolean. The existing guardrail test
("crossbreedingEnabled guardrail...") is rewritten to a 3-tribe scenario distinguishing
true/true (mates), true/false (blocked), false/false (blocked), plus a same-tribe-always-mates
case regardless of the flag.

**Contract**: No new exported symbols; test-only fixture and assertion changes.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- `boids.test.ts` passes: `npx vitest run src/server/simulation/boids.test.ts`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase (pure engine logic, fully covered by automated tests).

---

## Phase 2: Schema, validation, and thread-through removal

### Overview

Remove the global `crossbreedingEnabled` flag end-to-end: DB column, zod schemas, scalar
live-edit path, `ServerRunParams`/`single-run-lifecycle.ts` plumbing, the admin-range entry,
and the CSV export column. Add the field to both tribe-config zod schemas. Update every
affected test fixture.

### Changes Required:

#### 1. DB schema and migration

**File**: `src/server/db/schema.ts`, `drizzle/`

**Intent**: Drop the standalone `crossbreedingEnabled` column — its data now lives inside the
existing `tribeConfigs`/`predatorTribeConfigs` JSON columns as a per-entry key.

**Contract**: Remove the `crossbreedingEnabled` column definition (`schema.ts:119`). Run
`npm run db:generate` to produce the migration and confirm the emitted statement is a direct
`ALTER TABLE ... DROP COLUMN`; apply it the same way prior migrations in this session were
applied (direct SQL via the `@libsql/client` Node API if `db:push`'s destructive-change
classifier blocks it, per this project's established workaround).

#### 2. Tribe config schemas and top-level input schema

**File**: `src/server/api/routers/simulation.ts`

**Intent**: `tribeConfigSchema`/`predatorTribeConfigSchema` each gain `crossbreedingEnabled:
z.boolean()`. `startInputSchema`'s top-level `crossbreedingEnabled` field, `insertRunningSimulation`'s
explicit `crossbreedingEnabled: input.crossbreedingEnabled` insert line, and the `select`
projection at line 957 are removed — the field now flows in through `tribeConfigs`/
`predatorTribeConfigs` wholesale, with zero extra code in `insertRunningSimulation` or
`updateTribeConfigs`/`updatePredatorTribeConfigs`.

**Contract**: `updateRunParams`'s live-edit patch schema drops `crossbreedingEnabled:
z.boolean().optional()`. `TRIBE_RANGED_FIELD_NAMES`/`PREDATOR_TRIBE_RANGED_FIELD_NAMES` do NOT
gain the new boolean field (those loops are numeric min/max checks only). Two independent
"field union" surfaces both currently list `crossbreedingEnabled` and must each be updated —
they are not type-linked to each other: `ParameterChangeEntry.field`'s `keyof LiveAdjustableParams`-derived
union (`server-run-registry.ts`), and this file's separate runtime
`z.enum([...RANGED_PARAMETER_NAMES, "tribeConfigs", "predatorTribeConfigs"])` validation
(`simulation.ts:641-647`) for `parameterChanges[].field`.

#### 3. Live-edit types and server-run registry

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Remove `crossbreedingEnabled` from `ServerRunParams`, `LiveAdjustableParams`,
`getLiveRunState`'s hand-built `liveParams` object, and `startServerRun`'s pass-through into
`computeSingleRunTick`. `ParameterChangeEntry.field`'s union loses the
`crossbreedingEnabled` member automatically (derived from `LiveAdjustableParams`).

**Contract**: No new live-edit entry point is added here — Phase 5 owns the new per-tribe
live-edit UI. This phase only removes the old scalar path.

#### 4. Single-run lifecycle thread-through

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Remove the `crossbreedingEnabled: boolean` field from `computeSingleRunTick`'s
params type and its pass-through into `runTick`.

**Contract**: Two-line deletion (field + pass-through), matching Phase 1's removal from
`runTick`'s own params type.

#### 5. Client start-form and canvas thread-through

**File**: `src/app/simulation/page.tsx`, `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Remove `crossbreedingEnabled` from `ActiveRun`, the top-level form `useState`,
`buildStartInput()`'s returned object, `startRun`'s `onSuccess` copy, and the `SimulationCanvas`
prop. `DEFAULT_TRIBE_CONFIGS`' 4 fixtures each gain `crossbreedingEnabled: true` (Phase 4 will
also move this into the rendered tab UI; this phase only makes the fixture/type shape correct).
The F-10 predator bridge in `buildStartInput` (currently a single hardcoded
`PredatorTribeConfig`) also gains `crossbreedingEnabled: true`.

**Contract**: `simulation-canvas.tsx`'s `crossbreedingEnabledRef`/`liveFieldRefs` entry and its
`renderLiveField` branch for this field are removed in this phase (the component's `LIVE_FIELDS`/
`FUTURE_OFFSPRING_FIELDS` constants drop the entry) — Phase 4 handles removing the equivalent
`<Switch>` from `server-run-viewer.tsx` since that removal is coupled to adding the new
per-tribe Switch in the same UI pass.

#### 6a. Corpus sweep-matrix redesign

**File**: `scripts/corpus/sweep-matrix.ts`, `scripts/corpus/harness.ts`, `scripts/corpus/generate-sweep.ts`, `scripts/perf-baseline.ts`

**Intent**: `sweep-matrix.ts`'s corpus generator currently sweeps `crossbreedingEnabled` as one
of 3 top-level scalar axes (`separationWeight × foodRegenRate × crossbreedingEnabled`). Since
the field moves to per-tribe scope, this axis is redesigned to sweep tribe 0's
`crossbreedingEnabled` specifically, with the swept scenario requiring ≥2 tribes (tribes 1+
stay at their default `true`) so the axis remains a meaningful variable — a single-tribe run
has no cross-tribe pair to gate.

**Contract**: `StartCorpusRunParams`/`SweepRunParams` (`harness.ts`) drop the top-level
`crossbreedingEnabled` field (it no longer exists on `ServerRunParams`) and instead set
`tribeConfigs[0].crossbreedingEnabled` to the swept boolean, holding `tribeConfigs[1..N-1]`
at `true`. `generate-sweep.ts`'s CSV column (`crossbreedingEnabled`) is kept, now reading from
`tribeConfigs[0].crossbreedingEnabled`. `perf-baseline.ts`'s flat fixture value moves into its
own `tribeConfigs[0]` entry.

#### 6. Admin-range and CSV-export cleanup

**File**: `src/server/simulation/parameter-ranges.ts`, `src/server/simulation/run-export.ts`

**Intent**: Remove the now-dead `crossbreedingEnabled` entry from `RANGED_PARAMETER_NAMES`/
`DEFAULT_PARAMETER_RANGES` (parameter-ranges.ts:16,149). Remove `crossbreedingEnabled` from
`RunExportRow` and `CSV_COLUMNS` in `run-export.ts` — per "What We're NOT Doing," dropped
entirely, not expanded into per-tribe columns.

**Contract**: `parameter-suggestion.test.ts`'s boolean-parameter test (currently targeting
`crossbreedingEnabled` as "the one boolean-typed field") is updated to either retarget another
boolean top-level field if one exists, or — if none does — the boolean-handling branch in
`parameter-suggestion.ts` and its test are removed together, since there would be no remaining
boolean-typed top-level ranged parameter to exercise it. Check which applies during
implementation and document the choice as an inline comment. `parameter-suggestion.ts`'s own
`PARAMETER_LABELS` (`Record<TopLevelRangedParameterName, string>`) also carries a
`crossbreedingEnabled` entry and must drop it — a `Record` literal over this type fails to
typecheck with an unknown/excess property otherwise.

#### 6b. Other Record-literal and filter-based references

**File**: `src/app/reference/parameters/page.tsx`, `src/app/admin/settings/_components/admin-settings-form.tsx`, `scripts/perf-baseline.ts`

**Intent**: `reference/parameters/page.tsx`'s `PARAMETER_DESCRIPTIONS`/`PARAMETER_LABELS`
(both `Record<TopLevelRangedParameterName, string>`) and its
`.filter((name) => name !== "crossbreedingEnabled")` line, and
`admin-settings-form.tsx`'s identical filter pattern, all break once the union member is
removed and must drop their `crossbreedingEnabled` entries/filters. `perf-baseline.ts`'s flat
`crossbreedingEnabled: true` fixture value moves into its scenario's `tribeConfigs[0]` entry
(see Phase 2 #6a).

#### 7. Fixture updates across affected tests

**File**: `src/server/api/routers/simulation.test.ts`, `src/server/simulation/server-run-registry-capacity.test.ts`,
`src/server/simulation/pipeline.test.ts`, `src/server/simulation/pipeline-perf.test.ts`,
`src/server/simulation/single-run-lifecycle.test.ts`, `src/server/simulation/run-export.test.ts`,
`src/server/simulation/corpus-fixture.test.ts`, `src/app/api/runs/export.test.ts`,
`src/app/simulation/_components/simulation-canvas.test.tsx`, `src/app/simulation/_components/server-run-viewer.test.tsx`,
`src/server/simulation/server-run-registry.test.ts`, `scripts/corpus/harness.test.ts`,
`scripts/corpus/generate-sweep.smoke.test.ts`

**Intent**: Remove the flat `crossbreedingEnabled` fixture field everywhere it appears as a
top-level params value; add `crossbreedingEnabled: true` to `VALID_TRIBE_CONFIG`/
`VALID_PREDATOR_TRIBE_CONFIG` and any other named tribe-config fixture. The large behavioral
test in `simulation.test.ts` ("toggling crossbreedingEnabled via the router actually changes
whether inter-flock reproduction occurs...") is rewritten to flip one tribe's
`crossbreedingEnabled` via `updateTribeConfigs` against a 3+-tribe scenario, asserting the
true/true, true/false, and false/false pairings — this is the direct carry-forward of that
test's original intent, not a new test. `single-run-lifecycle.test.ts`'s
`boidCountAfter(crossbreedingEnabled: boolean)` helper is reworked to vary tribe-config arrays
instead of a flat boolean. `corpus-fixture.test.ts`'s `FULL_PARAM_FIELDS` assertion list drops
the removed top-level field (its committed `.json.gz` fixture files do not themselves contain
this field — `params` is reconstructed from `sweep-matrix.ts` at test time, per Phase 2 #6a's
redesign). `server-run-registry.test.ts`'s dedicated "live-crossbreeding-toggle" test block is
rewritten to use `applyLiveTribeConfigs` against a tribe array instead of `applyLiveParams`
with the flat field. `scripts/corpus/harness.test.ts`/`generate-sweep.smoke.test.ts` are updated
to match Phase 2 #6a's `tribeConfigs[0]`-scoped sweep axis. The
`simulation-canvas.test.tsx`/`server-run-viewer.test.tsx` tests
asserting the old global `#live-param-crossbreedingEnabled` Switch are removed here (their
functional replacement is Phase 5's new panel, tested there) — Phase 4 is where the
`server-run-viewer.tsx` Switch itself is deleted, so hold these two test files' edits until
Phase 4 if sequencing is cleaner; either way both must land before Phase 2's gate runs green on
the full suite.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Migration applies cleanly and matches the generated SQL: `npm run db:generate` (dry-run review)
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase (schema/validation/plumbing fully covered by automated tests).

---

## Phase 3: Predator speed admin range

### Overview

Add a real admin range for predator `maxSpeed`/`minSpeed`, closing the gap F-10 left open
(mirrored from boids' own long-standing gap for the same two fields).

### Changes Required:

#### 1. New admin-range entries

**File**: `src/server/simulation/parameter-ranges.ts`

**Intent**: Give predator `maxSpeed`/`minSpeed` real admin-configurable bounds, replacing the
hardcoded 55/20 defaults the F-10 bridge currently uses.

**Contract**: New entries in `RANGED_PARAMETER_NAMES` (or `PREDATOR_TRIBE_RANGED_FIELD_NAMES`,
whichever array this project's convention uses for a per-tribe-scoped numeric field — follow
`detectionRadius`'s existing placement) and `DEFAULT_PARAMETER_RANGES`, with sensible bounds
(e.g. `maxSpeed: {min:1, max:300, default:55}`, `minSpeed: {min:0, max:300, default:20}` —
matching the UI-hardcoded bounds already in use for the boid-side equivalents, per "no cut
line" scope this creates an intentional asymmetry with boids, which still lack this range).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- `parameter-ranges.test.ts` (if present) or `simulation.test.ts`'s range-validation tests pass: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase.

---

## Phase 4: Start-form UI — predator tribe tabs + per-tribe crossbreeding Switch

### Overview

Build the predator-tribe count control and tab panel, mirroring the boid tribe tab pattern
exactly. Move `crossbreedingEnabled` into each tribe tab (both species) as a `Switch`, and
remove the old global Switch from `server-run-viewer.tsx` and `page.tsx`.

### Changes Required:

#### 1. Predator-tribe count control and tab panel

**File**: `src/app/simulation/page.tsx`

**Intent**: Add a `predatorFlockCount` `NumberField` mirroring the existing `flockCount` one.
Add a `predatorTribeConfigs` `useState` array and an `updatePredatorTribeField` setter mirroring
`tribeConfigs`/`updateTribeField`. Render a second `<Tabs>` block for predator tribes, using a
new `predatorTribeFieldDefs` array covering only the 6 non-inert fields (`maxSpeed`, `minSpeed`,
`matePreference`, `detectionRadius`, `captureRadiusMult`, plus the new `crossbreedingEnabled`
Switch) — `separation`/`alignment`/`cohesion` stay on the type/schema but are not rendered, per
"What We're NOT Doing."

**Contract**: `buildStartInput()`'s predator bridge is replaced with the real
`predatorFlockCount`/`predatorTribeConfigs` state, clamped the same way the boid side clamps
(`predatorTribeConfigs.slice(0, clampedPredatorFlockCount)`, ranged-field clamping against
`ranges.*`).

#### 2. Per-tribe crossbreeding Switch in both tab panels

**File**: `src/app/simulation/page.tsx`

**Intent**: Add a `crossbreedingEnabled` `<Switch>` inside each `TabsContent` (boid and
predator), alongside the existing per-field `NumberField`s — this can't go in `tribeFieldDefs`/
`predatorTribeFieldDefs` (numeric-only field-def arrays), so it's rendered as its own branch
inside the tab content, analogous to how `server-run-viewer.tsx` special-cases this field inside
its shared renderer today.

**Contract**: `updateTribeField`'s numeric-only value type is widened (or a sibling
`updateTribeCrossbreeding(index, value: boolean)` setter is added) to set the boolean field on
the per-index tribe-config array.

#### 3. Remove old global Switch

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Remove `crossbreedingEnabled` from `LIVE_FIELDS`/`FUTURE_OFFSPRING_FIELDS`, the
`renderLiveField` branch for it, and the outgoing-payload boolean-widening logic in
`handleApplyLiveParams` that existed only to carry this one field.

**Contract**: The 5 remaining `LIVE_FIELDS` entries are untouched; `LiveFormValues =
Record<LiveField, number>` no longer needs any boolean-coercion special-casing.

#### 4. Test updates

**File**: `src/app/simulation/_components/simulation-canvas.test.tsx`, `src/app/simulation/_components/server-run-viewer.test.tsx`, `src/app/simulation/page.test.tsx` (if present, else create minimal coverage)

**Intent**: Remove the old global-Switch DOM assertions (carried over from Phase 2 if not
already done there). Add coverage for the new predator-tribe count control, predator tab
rendering, and the per-tribe crossbreeding Switch in both tab panels.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Component tests pass: `npx vitest run src/app/simulation/`
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- Start a run with 2 predator tribes configured with visibly different `detectionRadius`/
  `captureRadiusMult` values via the new tab panel; confirm the run starts successfully and the
  configured values round-trip (visible in the DB row or a live snapshot).
- Toggle a tribe's `crossbreedingEnabled` Switch off in the start form before starting; confirm
  the started run's persisted config reflects it.

---

## Phase 5: Per-tribe live-edit panel

### Overview

Build a new live-edit UI panel (boid and predator) that generalizes `server-run-viewer.tsx`'s
Apply/cooldown/flash pattern to array/tribe-scoped fields, wired to `updateTribeConfigs`/
`updatePredatorTribeConfigs` — the first UI consumer of either mutation.

### Changes Required:

#### 1. New tribe-array live-edit panel component

**File**: `src/app/simulation/_components/server-run-viewer.tsx` (new section/sub-component within)

**Intent**: For each tribe (boid and predator) in the active run, render one editable row/card
per ranged field plus the crossbreeding Switch, with its own dirty/applied/flash tracking keyed
by `(species, tribeIndex, field)` rather than the existing flat `LiveField` key — the existing
pattern's `LiveFormValues = Record<LiveField, number>` shape doesn't fit an array, so this is a
parallel state structure, not a widened one.

**Contract**: On Apply, send the **whole** tribe's config object (not a per-field patch) via
`api.simulation.updateTribeConfigs`/`updatePredatorTribeConfigs`, matching those mutations'
existing wholesale-array-replace contract. Reuse `getLiveRunState`'s already-exposed
`tribeConfigs`/`predatorTribeConfigs` snapshot fields (confirmed via `server-run-registry.ts`'s
own comment that these exist specifically for this purpose) to pre-fill the panel and to detect
server-side changes the way `syncLiveParams` does for the scalar panel.

#### 2. Client-staged mirror (pre-start preview, if applicable)

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Determine during implementation whether the client-staged tick loop (used before a
server-run is active) needs an equivalent live-edit panel, or whether live-edit for tribe config
only makes sense once a server-run exists (since `updateTribeConfigs`/`updatePredatorTribeConfigs`
are server-run-scoped mutations). Default: client-staged runs do NOT get this panel — only
server-backed runs do, consistent with those mutations' own `isServerRunActive` gate.

**Contract**: No new props added to `SimulationCanvas` for this feature unless the
during-implementation check above finds a client-staged use case.

#### 3. Tests

**File**: `src/app/simulation/_components/server-run-viewer.test.tsx`

**Intent**: New test coverage mirroring the existing scalar live-edit tests' shape — dirty
tracking, Apply sends the whole tribe object, a successful Apply flashes/clears dirty, a
behavioral test proving a live crossbreeding-flag edit actually changes whether a subsequent
tick allows a cross-tribe pairing (per this project's "UI accepts input is not feature verified"
lesson).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Component tests pass: `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx`
- Full test suite passes: `npm test`
- Lint passes: `npm run check`

#### Manual Verification:

- Start a server-backed run, open the live-edit panel, change a predator tribe's
  `detectionRadius` and Apply; confirm predators visibly change behavior within a few ticks.
- Toggle a tribe's crossbreeding flag off mid-run via the panel; confirm no new cross-tribe
  offspring appear afterward (same-tribe offspring continue appearing).

---

## Phase 6: Verification + cookbook

### Overview

End-to-end verification script proving the full feature works together, plus closing out any
remaining documentation (code comments explaining the inert-fields-hidden decision, the
asymmetric predator-only speed-range addition).

### Changes Required:

#### 1. End-to-end verification script

**File**: scratch script (deleted after use, per this project's established verification
pattern — never committed)

**Intent**: Using `snapshotServerRun`/`resumeServerRun`, construct a scenario with ≥3 tribes per
species with distinct `crossbreedingEnabled` values; advance ticks; assert (a) same-tribe
offspring appear regardless of the flag, (b) cross-tribe offspring appear only between
both-true tribe pairs, (c) the start-form predator-tab-configured tribe count/fields match the
spawned predator population's genes, (d) a live-edit panel Apply changes next-tick predator
behavior (not just the stored config).

**Contract**: No production code changes — this phase is pure verification.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full build succeeds: `npm run build`

#### Manual Verification:

- Verification script's 4 assertions (a)-(d) above all pass, confirmed via script output before
  the script is deleted.

---

## Testing Strategy

### Unit Tests:

- `reproducePopulation`'s both-tribes-must-allow gate (true/true, true/false, false/false,
  same-tribe-always-allowed) — Phase 1.
- Every router/registry mutation path (`updateTribeConfigs`, `updatePredatorTribeConfigs`,
  `start`, `startServer`) correctly carries the new field through — Phase 2.
- New admin-range validation for predator `maxSpeed`/`minSpeed` — Phase 3.
- Component tests for the new predator tab panel and per-tribe Switch — Phase 4.
- Component tests for the new live-edit panel, including a behavioral (not just DOM) assertion — Phase 5.

### Integration Tests:

- The rewritten `simulation.test.ts` behavioral test driving a real server run through
  `updateTribeConfigs` and asserting actual cross-flock reproduction outcomes — Phase 2.
- End-to-end verification script — Phase 6.

### Manual Testing Steps:

1. Configure 2 predator tribes with distinct behavior tuning via the start form; start a run;
   confirm both tribes' predators behave distinctly (speed, capture radius).
2. Toggle crossbreeding off for one boid tribe in the start form; start a run; confirm that
   tribe's members never produce cross-tribe offspring while same-tribe offspring continue.
3. Mid-run, open the new live-edit panel and change a predator tribe's `detectionRadius`;
   confirm the change takes effect within a few ticks without restarting the run.

## Performance Considerations

None expected beyond what F-10 already established — adding one boolean field to two existing
per-tribe config arrays and one more array-lookup in the reproduction gate is O(1) per
reproduction attempt, not a hot-loop concern.

## Migration Notes

The `crossbreedingEnabled` DB column drop is the project's first column drop. Existing rows'
historical global value is NOT individually backfilled into their `tribeConfigs`/
`predatorTribeConfigs` JSON arrays — those arrays' `crossbreedingEnabled` key will be absent on
historical rows (read as `undefined`). Any code reading a tribe config's `crossbreedingEnabled`
after this migration must tolerate `undefined` the same way other optional-shaped historical
JSON fields are tolerated elsewhere in this codebase (e.g. `predatorTribeField`'s `?? default`
pattern) — resolve the exact read-site default during Phase 2 implementation; new rows always
have the field since the zod schema makes it required going forward.

## References

- F-10 (predator-tribe-concept) plan and plan-brief: `context/archive/2026-11-18-predator-tribe-concept/plan.md`, `context/archive/2026-11-18-predator-tribe-concept/plan-brief.md`
- `reproducePopulation` gate: `src/server/simulation/boids.ts:1130-1138`
- Existing scalar live-edit pattern to generalize: `src/app/simulation/_components/server-run-viewer.tsx:33-330`
- Existing wholesale-array live-edit mutations (unused by any UI today): `src/server/api/routers/simulation.ts:1319-1447`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine core — per-tribe crossbreeding gate

#### Automated

- [x] 1.1 Typecheck passes — 4dd58aa
- [x] 1.2 boids.test.ts passes — 4dd58aa
- [x] 1.3 Lint passes — 4dd58aa

### Phase 2: Schema, validation, and thread-through removal

#### Automated

- [x] 2.1 Typecheck passes (clean except 2 files explicitly deferred to Phase 4) — c27440d
- [x] 2.2 Migration generated and matches expected DROP COLUMN statement — c27440d
- [x] 2.3 Full test suite passes (490/494; 3 failures confined to the Phase-4-deferred Switch tests) — c27440d
- [x] 2.4 Lint passes — c27440d

### Phase 3: Predator speed admin range

#### Automated

- [x] 3.1 Typecheck passes — 0af10f1
- [x] 3.2 Range-validation tests pass — 0af10f1
- [x] 3.3 Lint passes — 0af10f1

### Phase 4: Start-form UI — predator tribe tabs + per-tribe crossbreeding Switch

#### Automated

- [x] 4.1 Typecheck passes
- [x] 4.2 Component tests pass
- [x] 4.3 Full test suite passes
- [x] 4.4 Lint passes

#### Manual

- [x] 4.5 2 predator tribes with distinct config start successfully and persist correctly
- [x] 4.6 Start-form crossbreeding Switch toggle persists to started run's config

### Phase 5: Per-tribe live-edit panel

#### Automated

- [ ] 5.1 Typecheck passes
- [ ] 5.2 Component tests pass
- [ ] 5.3 Full test suite passes
- [ ] 5.4 Lint passes

#### Manual

- [ ] 5.5 Live detectionRadius edit visibly changes predator behavior within a few ticks
- [ ] 5.6 Live crossbreeding-flag-off edit stops new cross-tribe offspring mid-run

### Phase 6: Verification + cookbook

#### Automated

- [ ] 6.1 Full test suite passes
- [ ] 6.2 Typecheck passes
- [ ] 6.3 Lint passes
- [ ] 6.4 Full build succeeds

#### Manual

- [ ] 6.5 Verification script's 4 assertions (a)-(d) all pass
