<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Unwatched-run tick throttling Implementation Plan

- **Plan**: context/changes/unwatched-run-tick-throttling/plan.md
- **Mode**: Deep
- **Date**: 2026-11-17
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — run-export.ts not covered by the marker's reach

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Cross-run surfaces
- **Detail**: Verified against current code: `src/server/simulation/run-export.ts`'s `RunExportRow` type passes `run.history` straight through for the single-run JSON/CSV export feature (`src/app/api/runs/[runId]/export/route.ts`), with no `wasEverThrottled` field in `RunExportRow` or `CSV_COLUMNS`. The plan names 3 surfaces (leaderboard, run-comparison, parameter-suggestion) but is silent on export — not listed as in-scope, not listed in "What We're NOT Doing" either. A user exporting a throttled run's data gets no indication its score may not be comparable, even though export is a close cousin of run-comparison's exact disclosure need. (Separately, the 20-run parameter-sweep test corpus in `corpus-db-fixture.ts`/`corpus-fixture.ts` predates this feature and is harmless by construction — worth a one-line mention in "What We're NOT Doing" so a future reader doesn't wonder why corpus runs never show the badge, but this is cosmetic, not a functional gap.)
- **Fix A ⭐ Recommended**: Add `wasEverThrottled` as a 4th surface in Phase 3
  - Strength: Closes the actual gap — export is read by the same users for the same comparability purpose as run-comparison; the field is already selected from the DB row, just needs adding to `RunExportRow`/`CSV_COLUMNS`.
  - Tradeoff: One more file touched in Phase 3 (`run-export.ts` + its test), small addition to an already-planned phase.
  - Confidence: HIGH — the pattern is identical to the other 3 surfaces, just a field pass-through.
  - Blind spot: None significant.
- **Fix B**: Explicitly exclude export in "What We're NOT Doing" with a stated reason
  - Strength: No new code in this change.
  - Tradeoff: Leaves a real, if minor, disclosure gap live in production until a follow-up change closes it.
  - Confidence: MEDIUM — depends on how often users actually export throttled runs' data for comparison purposes outside the app.
  - Blind spot: Haven't checked how heavily the export feature is actually used.
- **Decision**: FIXED (Fix A — added run-export.ts as a 4th surface in Phase 3, plus a "What We're NOT Doing" note on the corpus fixtures)

### F2 — try/finally placement for watcher-set teardown is underspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Viewer tracking on `LiveRun`
- **Detail**: Verified against `watchServerRun`'s actual body (`server-run-registry.ts:773-802`): the plan's contract says to remove the watcher id "in a `try`/`finally` wrapping the polling loop," which is ambiguous about whether the try/finally wraps the entire `while` statement once (correct — add before the loop, remove once after) versus being placed per-iteration inside the loop body (wrong — would add/remove the same watcher on every 150ms poll tick instead of once per generator lifetime). The three early `TRPCError` throws at `:782/:785/:789` happen before the loop and don't need the try/finally, but the implementer needs that stated explicitly so the id is added only after those guard clauses pass.
- **Fix**: Tighten Phase 2's contract text to state explicitly: one `try { watcherIds.add(id); while (...) {...} } finally { watcherIds.delete(id); ...} ` placed after the three early-throw guard clauses, wrapping the entire `while` statement exactly once for the generator's whole lifetime — not re-entered per poll iteration.
- **Decision**: FIXED (contract text tightened in Phase 2)
