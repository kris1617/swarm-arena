<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-run population-dynamics analysis view

- **Plan**: context/changes/run-analysis-view/plan.md
- **Scope**: Phase 1-3 of 3 (Full plan)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning (fixed), 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after fix) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `getRunAnalysis`'s cast on `history` was unchecked for the three required fields

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts` (`getRunAnalysis`)
- **Detail**: `run.history as {...} | null` was unchecked on a schema-less JSON column — only the newer optional `populationCountSamples` field was defensively handled (via `?.`/fallback), not the three pre-existing required fields (`phaseHistory`, `foodRatioSamples`, `survivorGenes`). A legacy or hand-corrupted row whose `history` violates those required fields would throw inside `segmentCompletedCycles`/`computeGeneticDiversity` instead of degrading to the same "no data" response the `null`-history case already gets.
- **Fix**: Added an `Array.isArray` guard on `phaseHistory`/`survivorGenes` before treating `history` as valid, falling back to `null` (same safe-default path) otherwise.
- **Decision**: FIXED — guard added; new test "degrades to the null-history response for a malformed history row instead of throwing" added and passing. Deliberate break-check confirmed: removing the guard made the new test fail with exactly the predicted `TypeError` inside `computeGeneticDiversity`; restored before committing.

### F2 — No numeric validation on the route's `runId` param

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: `src/app/runs/[runId]/page.tsx`
- **Detail**: `Number(runId)` on a non-numeric segment (e.g. `/runs/abc`) produces `NaN`. This doesn't crash — Drizzle's `eq(t.id, NaN)` matches no row, so the router throws `BAD_REQUEST`, already rendered by the page's existing error branch — but the graceful handling is incidental to DB behavior, not explicit validation.
- **Fix**: None needed — no action required; the existing error branch already covers this case correctly.
- **Decision**: SKIPPED (no action warranted — already handled correctly by the existing error path)

### F3 — Unenforced length-parity assumption between `phaseHistory` and `populationCountSamples`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: `src/app/runs/[runId]/page.tsx` (chart data mapping)
- **Detail**: `phase: history?.phaseHistory[tick] ?? "establishment"` silently defaults to "establishment" if the two arrays ever had different lengths. Low risk today — both arrays are written together at every call site (confirmed: `tick()`, `stopServerRun`, `stop` resolver) — but nothing enforces the invariant.
- **Fix**: None needed for this change — no action required; worth a future comment if this invariant is ever at risk.
- **Decision**: SKIPPED (no action warranted — invariant currently holds by construction at every write site)

### F4 — Justified `as any` for Recharts' `dot` prop typing

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/app/runs/[runId]/page.tsx`
- **Detail**: `dot={PhaseDot as any}` with a `biome-ignore` comment explaining Recharts' typing gap. Acknowledged, justified, and explained — not a silent `any`.
- **Fix**: None needed — no action required.
- **Decision**: SKIPPED (no action warranted — already a justified, explained suppression)

## Not flagged as findings (reviewed, found adequate)

- `getRunAnalysis` matches `stop`/`savePause`/`resume`'s ownership-check and status-guard structure exactly.
- `recharts@^3.10.1` (caret, not exact pin) is consistent with every other dependency in `package.json` — the plan's own "check existing convention first" clause correctly overrode its literal "pinned exact version" suggestion; not drift.
- `segmentCompletedCycles`'s refactor is behavior-preserving — proven by the pre-existing `computePhaseQuality` count-based tests passing unchanged.
- The analysis page's header additionally renders the run's `score` — a small, undocumented-but-trivial addition using data already in scope (no new query/dependency); benign, not worth a plan amendment.
- All five "What We're NOT Doing" constraints held: no backfill, no curve-fit overlay, no diversity trend chart, no new UI primitive beyond Recharts, dashboard Running/Saved sections untouched.
- Automated success criteria: `npm run typecheck`, `npm run check`, `npm test` (176/176) all pass as of this review, including F1's fix and its new test.
