<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pre-existing admin-settings flakes Implementation Plan

- **Plan**: context/changes/pre-existing-admin-settings-flakes/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-11-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — New concurrent tests leak fixture rows if an assertion throws mid-test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/corpus/harness.test.ts:354-392` (new standalone-concurrent-calls test); same pre-existing gap at `:306-342`
- **Detail**: The new "two concurrent standalone `startCorpusRun` calls" test's cleanup (`stopServerRun` + `collectAndCleanupCorpusRun` for both A and B) runs as plain sequential `await`s with no `try/finally`. If any earlier `expect` in the test throws, cleanup never runs and both fixture owner rows + simulation runs leak into later tests in the same worker. The pre-existing batch-mode test right above it has the identical gap (not a new regression — matches this file's existing style, where none of its tests use `try/finally`), but it's a real gap in exactly the two tests most likely to throw mid-test (concurrency scenarios).
- **Fix**: Wrap the post-assertion cleanup block in a `try { ...assertions... } finally { ...cleanup... }` in the new standalone test (and optionally the pre-existing batch-mode test, for consistency, though that's pre-existing and out of this change's scope).
- **Decision**: FIXED — wrapped in try/finally (commit pending); verified 10/10 tests still pass, typecheck and lint clean.

## Notes

Both review agents independently confirmed zero drift across all 4 net-changed files, matching the plan's final (twice-revised) intent exactly: the `SESSION` hygiene fix (Phase 3), `withAdminRangesLock`'s correct acquire/release/no-self-deadlock design (Phase 4), its correct wiring into `startCorpusRun` and `runBatch`, and both new Phase 5 tests — including independently verifying the pre-existing concurrent-batch-mode test was left byte-identical, as the plan required. The Phase 1 instrumentation's complete, clean reversion in Phase 6 was independently confirmed via `git diff` showing zero net change on the 3 files it touched.

Both review agents treated this change's two mid-implementation pivots (abandoning the original `getOrSeedAdminSettings` TOCTOU hypothesis after instrumentation disproved it; abandoning the originally-planned Phase 5 test edit after discovering it would have been a no-op) as sound engineering, not scope drift — each was a user-approved, evidence-driven correction documented in research.md's two addenda and the plan's own Progress notes, not an unplanned addition.
