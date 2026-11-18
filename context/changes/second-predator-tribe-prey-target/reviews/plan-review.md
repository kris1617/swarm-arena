<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Second predator tribe with configurable prey target Implementation Plan

- **Plan**: context/changes/second-predator-tribe-prey-target/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, symbols ✓ (applyPredation, computeScore, ScoredRun, Select component all confirmed), brief↔plan ✓. No `docs/reference/contract-surfaces.md` in this repo — skipped.

## Findings

### F1 — Phase 1's "update every call site" list omits `pipeline.test.ts`'s 4 direct `applyPredation` callers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Changes Required #2
- **Detail**: `applyPredation`'s return type widens from `BoidState[]` to `{ boids, predators }` — a breaking signature change. `src/server/simulation/pipeline.test.ts:207,260,329,341` has 4 direct calls (e.g. `const result = applyPredation(...); expect(result).toHaveLength(1);`) that will fail to compile/assert correctly once the shape changes, but Phase 1's contract text only mentions updating `runTick` and "every direct test caller in `boids.test.ts`" — `pipeline.test.ts` is never named, even though the plan's own Phase 2 already lists this same file for an unrelated reason.
- **Fix**: Add `pipeline.test.ts`'s 4 call sites to Phase 1's "update every call site" list.
- **Decision**: FIXED (added to Phase 1, Changes Required #2)

### F2 — Phase 2's file list is missing `scripts/corpus/harness.test.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Changes Required #2
- **Detail**: `scripts/corpus/harness.test.ts:43-55` defines its own `DEFAULT_PREDATOR_TRIBE_CONFIG` literal, used at line 73 against a `PredatorTribeConfig[]`-typed field — not in Phase 2's named file list, which will fail to typecheck once `preyTarget` becomes required. Every other `PredatorTribeConfig`-shaped literal found repo-wide (`generate-sweep.*.test.ts`, `sweep-matrix.ts`, `corpus-fixture.test.ts`, `parameter-suggestion.*`) turned out to be a false positive (boid `TribeConfig`, not `PredatorTribeConfig`) — this is the one genuine miss.
- **Fix**: Add `scripts/corpus/harness.test.ts` to Phase 2's file list.
- **Decision**: FIXED (added to Phase 2, Changes Required #2)

### F3 — Existing structural precedent for cross-tribe-same-species interaction not cited

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Current State Analysis
- **Detail**: `reproducePopulation`'s crossbreeding gate (`boids.ts:1153-1156`) already implements "two tribes of the same species interact, gated by each side's own independent per-tribe flag" — structurally analogous to `preyTarget`'s own cross-tribe gate, just for mating permission rather than targeting. Not a perfect precedent (permission vs. targeting), and its absence doesn't block anything, but worth a one-line mention for a future reader tracing this decision's lineage.
- **Fix**: Add one sentence to Current State Analysis noting this precedent.
- **Decision**: FIXED (added to Current State Analysis)
