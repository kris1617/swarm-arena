<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Predator Tribe Concept (F-10)

- **Plan**: context/changes/predator-tribe-concept/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE
- **Findings**: 2 critical, 3 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 5/5 paths ✓, 10/10 symbols ✓ (TribeConfig, PredatorGenes, STEERING_FORCE_SCALE, PREDATOR_MIN_SPEED, PREDATOR_MAX_SPEED, CAPTURE_RADIUS, splitCountAcrossFlocks, createInitialPredators, stepPredators, applyPredation — all line numbers match exactly, no drift), brief↔plan ✓

## Findings

### F1 — No DB schema/persistence plumbing for predatorFlockCount/predatorTribeConfigs

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Data model & schema; Migration Notes
- **Detail**: `tribeConfigs`/`flockCount` are real DB columns (`schema.ts:118` `flockCount: d.integer().notNull().default(2)`, `:180` `tribeConfigs: d.text({mode:"json"})`), inserted at `simulation.ts:375,382` inside `insertRunningSimulation` (the shared helper both `start` and `startServer` use), and read back from the DB row at `:895` and `:1277` (the live-edit length check `updateTribeConfigs` performs against `run.flockCount`). The plan's Phase 1 never mentions a `schema.ts` migration for the two new fields, and its own Migration Notes explicitly (and incorrectly) claim "no schema/column change is needed since `predatorTribeConfigs` lives in the same JSON-ish per-run params shape `tribeConfigs` already does" — but `tribeConfigs` itself IS a DB column, not a column-free in-memory-only shape. Without this, a server-owned run has nowhere to persist `predatorFlockCount`/`predatorTribeConfigs` across a save/resume cycle, and Phase 5's `updatePredatorTribeConfigs` mutation has no DB field to read the run's own `predatorFlockCount` from for its length check.
- **Fix**: Add `predatorFlockCount: d.integer().notNull().default(1)` and `predatorTribeConfigs: d.text({mode:"json"})` to `simulationRuns` in `schema.ts`, generate the migration, add both fields to `insertRunningSimulation`'s insert block (`simulation.ts:375-382`), and add a `predatorFlockCount` read to whichever select(s) `updatePredatorTribeConfigs` (Phase 5) needs for its length check, mirroring `updateTribeConfigs`'s existing `run.flockCount` read exactly.
  - Strength: Direct, mechanical mirror of an already-proven pattern (`tribeConfigs`/`flockCount`'s own columns) — no new persistence design needed.
  - Tradeoff: Adds a migration file and a few more insert/select fields across Phase 1/5 — small, bounded scope growth.
  - Confidence: HIGH — the exact columns and call sites to mirror are already identified above.
  - Blind spot: Whether `snapshotServerRun`/`resumeServerRun`'s `ServerRunSnapshot` type (not the DB row) also needs these two fields for the pause/resume-while-running path (separate from the DB row's own persistence) — worth confirming during Phase 1/2 implementation, not just the DB column.
- **Decision**: FIXED — added a `schema.ts` Contract block (2 new columns, same shapes as `flockCount`/`tribeConfigs`), an `insertRunningSimulation`-insert Contract addition, a migration-generation Automated Verification criterion (Phase 1.2), and corrected Migration Notes.

### F2 — The actual production thread-through path for predatorTribeConfigs/rng into stepPredators/applyPredation is absent from the plan

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Detection radius & idle wander; Phase 4 — Genes wiring & capture aggressiveness
- **Detail**: Phase 3's Contract says `runTick`'s `stepPredators` call site "passes `params.rng` ... and the new `predatorTribeConfigs`" — but `runTick`'s own `params` type (`boids.ts:1216-1243`) has no `predatorTribeConfigs` field today, only boid-side `tribeConfigs: TribeConfig[]`. That field must propagate from `single-run-lifecycle.ts`'s `computeSingleRunTick` params type (which forwards `tribeConfigs: params.tribeConfigs` into `runTick` today) through BOTH of its real production callers — `server-run-registry.ts:639` (the server-owned tick loop) and `simulation-canvas.tsx:814` (the client-staged tick loop) — plus `single-run-lifecycle.test.ts`'s own shared `PARAMS` fixture (~40 call sites). None of `single-run-lifecycle.ts`, its two callers' params-construction sites, or its test file appear anywhere in Phase 3/4's Changes Required or the plan's References section. Without this, Phase 3's own contract has no source to actually read `predatorTribeConfigs` from in a real running simulation — it would only work in a hand-built unit test that passes the new param directly to `stepPredators`.
- **Fix**: Add `predatorTribeConfigs: PredatorTribeConfig[]` to `runTick`'s params type and to `computeSingleRunTick`'s params type (`single-run-lifecycle.ts`), threading it through from both `server-run-registry.ts`'s tick loop and `simulation-canvas.tsx`'s tick loop (both of which already construct a params object for `computeSingleRunTick` from `run.params`/the client's own refs) — same mechanical addition as every other per-tribe field already threaded this way. Name `single-run-lifecycle.ts` + `single-run-lifecycle.test.ts` explicitly in Phase 3's Changes Required and Success Criteria.
  - Strength: Mirrors exactly how `tribeConfigs` itself already propagates through this same chain — no new architecture, just completing an already-established pattern for the new field.
  - Tradeoff: Widens Phase 3's file list by 2-3 files; `single-run-lifecycle.test.ts`'s shared fixture will need the new field added once, which then satisfies all ~40 call sites at once (not 40 separate edits).
  - Confidence: HIGH — the exact propagation chain is already fully mapped (file:line for every link).
  - Blind spot: None significant — this is the same kind of thread-through Phase 2 already handles correctly for `createInitialPredators`'s own two call sites.
- **Decision**: FIXED — added `single-run-lifecycle.ts`/`single-run-lifecycle.test.ts`/`server-run-registry.ts`/`simulation-canvas.tsx` as named Changes Required in Phase 3, updated its Automated Verification + Progress row 3.2, and added all 4 files to the References section.

### F3 — matePreference wording describes a nonexistent "second range entry" mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Data model & schema
- **Detail**: `matePreference` is already a single literal in `RANGED_PARAMETER_NAMES` and `TRIBE_RANGED_FIELD_NAMES`, with one shared range keyed by that one string (`ParameterRanges = Record<RangedParameterName, ParameterRange>` has no mechanism for two distinct ranges under the same name). The plan's wording — "`matePreference` needs its own range entry since `PredatorTribeConfig`'s copy is a distinct admin-ranged name from boids' `TribeConfig.matePreference`" — describes something that can't exist in this type system and isn't needed anyway, since the plan itself says to reuse the identical `{min:0,max:1,default:0.5}` values.
- **Fix**: Reuse the existing `"matePreference"` name directly in the new `PREDATOR_TRIBE_RANGED_FIELD_NAMES` array (permitted by the `satisfies readonly RangedParameterName[]` constraint, since it's already a union member) — delete the "needs its own range entry" sentence from Phase 1's Contract.
- **Decision**: FIXED — corrected Phase 1's Contract wording to state `matePreference` reuses the existing name/range directly.

### F4 — TOP_LEVEL_RANGED_PARAMETER_NAMES's filter will misclassify the two new predator-only fields

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Data model & schema
- **Detail**: `TOP_LEVEL_RANGED_PARAMETER_NAMES = RANGED_PARAMETER_NAMES.filter((name) => !TRIBE_RANGED_FIELD_NAMES.includes(...))` only subtracts the boid-side `TRIBE_RANGED_FIELD_NAMES` set. Once `detectionRadius`/`captureRadiusMult` are added to `RANGED_PARAMETER_NAMES` (required for `PREDATOR_TRIBE_RANGED_FIELD_NAMES` to typecheck) but are absent from `TRIBE_RANGED_FIELD_NAMES` (correctly — they're predator-only), this filter will silently misclassify them as top-level scalar fields — exactly the bug class `parameter-ranges.ts:43-50`'s own comment was written to prevent for this project's other consumers of `RangedParameterName` (`parameter-suggestion.ts`, the reference-parameters page).
- **Fix**: Update the filter to also exclude `PREDATOR_TRIBE_RANGED_FIELD_NAMES` (e.g. `!TRIBE_RANGED_FIELD_NAMES.includes(...) && !PREDATOR_TRIBE_RANGED_FIELD_NAMES.includes(...)`, or merge both into one combined tribe-ranged-names set before filtering) — add this explicitly to Phase 1's Contract.
- **Decision**: FIXED — added an explicit filter-fix Contract block to Phase 1, plus explicit instructions to add `detectionRadius`/`captureRadiusMult` to `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES`.

### F5 — Three files that call the changing function signatures aren't named in any phase's scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Independent predator-tribe spawning; Phase 3/4
- **Detail**: `scripts/perf-baseline.ts:140`, `src/server/simulation/pipeline.test.ts` (lines 117, 186, 237, 305, 316), and `src/server/simulation/pipeline-perf.test.ts:66` all call `createInitialPredators`/`applyPredation`/`runTick` with current (pre-change) signatures and are named nowhere in plan.md's Changes Required or References. Once `createInitialPredators`'s signature changes (Phase 2) and `applyPredation`/`runTick`'s params gain `predatorTribeConfigs` (Phase 3/4), these become straight compile errors.
- **Fix**: Add `scripts/perf-baseline.ts`, `src/server/simulation/pipeline.test.ts`, and `src/server/simulation/pipeline-perf.test.ts` to Phase 2's (for the `createInitialPredators` signature change) and Phase 3/4's (for `applyPredation`/`runTick` params) Changes Required/References, so the implementer isn't surprised by compile failures outside the named file list.
- **Decision**: FIXED — added explicit fixture-update Contract blocks to Phase 2 (createInitialPredators) and Phase 4 (applyPredation/runTick), and all 3 files to the plan's References section.
