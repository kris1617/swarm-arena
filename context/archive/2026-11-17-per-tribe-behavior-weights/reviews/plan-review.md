<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Per-tribe boid behavior data model (F-09)

- **Plan**: context/changes/per-tribe-behavior-weights/plan.md
- **Mode**: Deep
- **Date**: 2026-11-17
- **Verdict**: REVISE
- **Findings**: 2 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
Grounding: 7/7 paths ✓, symbols ✓ (`pipeline-perf.test.ts`, `npm run perf:baseline`, `perf-baseline.json` all exist and are runnable), brief↔plan ✓

## Findings

### F1 — Phase 3 has no wall-clock perf gate, repeating a documented incident in this exact file

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Engine: per-tribe perception radii
- **Detail**: `context/foundation/lessons.md`'s "A structural big-O/call-count guard can pass while real wall-clock cost regresses" entry documents a real, already-shipped incident in this same file: a prior spatial-grid change passed `pipeline-perf.test.ts` throughout while making `stepBoids` measurably slower, because that test's fixed dense-population scenario doesn't exercise the grid's narrowing benefit. The verification sub-agent confirmed `pipeline-perf.test.ts:63-79`'s own comment says exactly this. Phase 3 replaces the fixed-radius grid with a max-radius grid + per-boid post-filter — the precise shape of change the lesson warns about — but its Success Criteria list only `npm run typecheck` and a correctness unit test, no wall-clock comparison.
- **Fix**: Add `npm run perf:baseline` (compared against `context/foundation/perf-baseline.json`) as an Automated Verification criterion for Phase 3, per the lesson's explicit rule: require both the structural test and a wall-clock baseline comparison for any simulation-engine perf-sensitive change.
- **Decision**: FIXED (applied directly to plan.md)

### F2 — Phase 2 misses a third `FlockWeights`/`tribeConfigs` call site: `adjustLivePopulation`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Engine: weights and speed bounds per tribe
- **Detail**: Phase 2 says "locate every call site... both the client-staged `start` path and server-owned `startServerRun`" and names only those two. The verification sub-agent found a third real caller: `server-run-registry.ts`'s `adjustLivePopulation` (lines 329-336, 348, 367) — live mid-run boid/predator-count growth — builds its own local `flockWeights` array independently, mirroring `startServerRun`'s derivation. If this isn't also switched to read from `tribeConfigs`, growing a live run's population mid-run seeds new individuals with stale/default weights instead of their tribe's actual configured values — a real correctness gap the plan's own unit-test criteria (which target `createInitialPopulation`/`createInitialPredators` directly) would not catch, since `adjustLivePopulation` constructs its array separately.
- **Fix**: Add `adjustLivePopulation` as a third call site in Phase 2's Changes Required, updating its local weights-construction the same way as the other two sites.
- **Decision**: FIXED (applied directly to plan.md)

### F3 — Phase 6's "live adjustment" scope is implicitly server-run-only but isn't labeled as such

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 — Live adjustment
- **Detail**: The verification sub-agent confirmed `reproducePopulation` is called from a single shared tick core (`computeSingleRunTick`), but the two execution paths reach it differently: the server-owned path reads `run.params` live off the registry's mutable object (so a live `applyLiveTribeConfigs` edit is picked up fresh, as Phase 6 assumes), while the client-staged path (`simulation-canvas.tsx`) owns its own local component state and never touches `server-run-registry.ts`'s live-edit machinery at all — this is pre-existing architecture (not a regression this plan introduces), but Phase 6's text doesn't say "server-owned runs only," so an implementer could reasonably try to wire the same live-edit UI into the client-staged path and discover mid-implementation that no equivalent mechanism exists there.
- **Fix**: Add one sentence to Phase 6's Overview stating live `tribeConfigs` editing applies to server-owned runs only, matching `LiveAdjustableParams`'s own existing scope — client-staged runs have no live-param machinery to extend.
- **Decision**: FIXED (applied directly to plan.md)

### F4 — Two more fixed-shape `LiveAdjustableParams` consumers not named in Phase 6

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 — Live adjustment
- **Detail**: Beyond `server-run-viewer.tsx` (already acknowledged in the plan), the verification sub-agent found two more places that independently derive a fixed list of `LiveAdjustableParams`-shaped fields: `simulation-canvas.tsx` (its own `satisfies readonly (keyof LiveAdjustableParams)[]` list, lines 35/47/59) and `server-run-viewer.test.tsx` (a hand-duplicated, locally-declared `type LiveParams`, not imported from the source type, used as a test fixture shape across ~10 lines). Adding `tribeConfigs` to `LiveAdjustableParams` is additive so neither breaks at compile time, but both are places an implementer could silently leave stale rather than updating deliberately.
- **Fix**: Name both files in Phase 6's Changes Required so the implementer reviews (and updates as needed) `simulation-canvas.tsx`'s derived list and refreshes `server-run-viewer.test.tsx`'s local fixture type.
- **Decision**: FIXED (applied directly to plan.md)
