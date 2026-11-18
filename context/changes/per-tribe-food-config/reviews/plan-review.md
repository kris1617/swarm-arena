<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Per-tribe food config (S-41)

- **Plan**: context/changes/per-tribe-food-config/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding
Grounding: 7/7 paths ✓, symbols ✓ (confirmed `applyHunger`'s single production caller, `foodRegenRate`'s exact read site, `computeResourceManagement`'s 5 callers, `ScoredRun.from()`'s 4 callers, the `wasEverThrottled` write-once DB pattern, and no `TribeConfig` field-name collision), brief↔plan ✓

## Findings

### F1 — Phase 2's file reference for the `foodRegenRate` read site is wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Engine: pool seeding & regen
- **Detail**: Phase 2's Contract says to find the regen read site in `single-run-lifecycle.ts`, hedged with "(confirm the exact call site before editing)." The verification sub-agent confirmed it's actually in `boids.ts`'s `runTick`, at the single `applyHunger` call site (`boids.ts:1246-1251`, the `params.foodRegenRate` argument at line 1250) — not in `single-run-lifecycle.ts` at all.
- **Fix**: Correct Phase 2's Contract to name `boids.ts:1246-1251` (inside `runTick`) directly, removing the hedge since the location is now confirmed.
- **Decision**: FIXED (applied directly to plan.md)

### F2 — Phase 5 doesn't flag which `ScoredRun.from()` call sites need a new SELECT column

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — Scoring
- **Detail**: `ScoredRun.from()` has 3 production call sites. Two (`simulation.ts:815` inside `listCompleted`, `simulation.ts:885` inside `getParameterSuggestion`) use an explicit `.select({...})` that enumerates `wasEverThrottled` — these need `wasEverFoodImbalanced: simulationRuns.wasEverFoodImbalanced` added to their SELECT lists, or the new field will be missing from the row entirely. The third (`simulation.ts:1102`, inside the comparison path) uses a full-row query and needs no SELECT change, only passing the field through. TypeScript's own type-checking against `ScoredRun.from()`'s widened input type will catch a caller that omits the field entirely, but won't by itself tell the implementer WHERE the fix belongs (SELECT list vs. pass-through) — worth naming explicitly so the implementer doesn't have to rediscover this.
- **Fix**: Add a sentence to Phase 5's `scored-run.ts` Contract naming the 2 explicit-select call sites (`simulation.ts:815`, `:885`) as needing a new SELECT column, and the 3rd (`simulation.ts:1102`) as needing only pass-through.
- **Decision**: FIXED (applied directly to plan.md)
