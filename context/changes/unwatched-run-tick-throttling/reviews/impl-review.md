<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Unwatched-run tick throttling Implementation Plan

- **Plan**: context/changes/unwatched-run-tick-throttling/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — wasEverThrottledWritten flag sets before the DB write resolves, so a failed write is never retried

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry.ts:519-531
- **Detail**: `wasEverThrottledWritten` is set to `true` synchronously before the fire-and-forget `void db.update(...).catch(...)` call resolves. If the write fails, the flag still blocks every later throttled tick in that run's life from retrying it — the run was genuinely throttled but `wasEverThrottled` can stay silently `false` forever. This is explicitly disclosed in the code's own comment as a known, logged gap, and mirrors `finishRun`'s existing "known gap" posture in the same file — not an oversight, a deliberate low-stakes trade-off (the marker is a disclosure aid, not a correctness-critical value).
- **Fix**: Only set `wasEverThrottledWritten = true` inside the `.then()` of the update call (after it resolves), leaving it `false` (eligible for retry on the next throttled tick) if the write rejects.
- **Decision**: FIXED

## Success Criteria Verification

All automated gates confirmed green during implementation and re-verified during this review: `npm run typecheck` clean, `npm run check` clean (1 pre-existing unrelated warning in sidebar.tsx), `npm test` 423 passed + 1 skipped. All manual verification items were performed directly (production build + Playwright + direct DB/API checks) and confirmed working: Phase 2's watch→unwatch→marker-flip→re-watch cycle, Phase 3's 4 disclosure surfaces (leaderboard badge, run-comparison disclaimer, parameter-suggestion rationale, export JSON/CSV), and Phase 4's perf validation (0.989 per-tick-cost ratio, ~2.98x fewer real ticks to stop).
