<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Heuristic next-parameter suggestion Implementation Plan

- **Plan**: context/changes/parameter-suggestion-heuristic/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-14
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

### F1 — Pearson correlation has no defensive clamp to [-1, 1]

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/simulation/parameter-suggestion.ts` (`pearsonCorrelation`)
- **Detail**: `numerator / denominator` has no `Math.max(-1, Math.min(1, ...))` clamp. For a near-perfect correlation, floating-point sum-of-squares arithmetic can yield e.g. `1.0000000000000004` (observed during manual verification). This is masked by the test file's `toBeCloseTo(1, 5)` tolerance and by `buildRationale`'s `.toFixed(2)` formatting in the UI — cosmetic only, no functional risk: `confidenceFor`'s `>= 0.7` threshold is unaffected by an overshoot already past that threshold.
- **Fix**: None needed — no action required. Optional defensive clamp if this function is ever reused somewhere that surfaces the raw unrounded value.
- **Decision**: SKIPPED (cosmetic, no functional risk, safe to skip per triage discipline)

## Not flagged as findings (reviewed, found adequate)

- Eligibility logic correctly requires both ≥3 rows and non-zero variance per parameter before correlating it; zero-variance and all-13-constant cases both correctly degrade to `insufficient-data` without crashing or producing `NaN`.
- Confidence threshold mapping matches the plan's Contract exactly (`|r| >= 0.7 && sampleSize >= 5` → high; `|r| >= 0.4` → medium; else low).
- `getParameterSuggestion` uses an explicit allow-listed `.select({...})` (not a spread of the full row) — correctly applied the `run-export` sibling change's lessons.md rule.
- No auto-fill or apply button anywhere in the suggestion card — confirmed no reference to the suggestion's `parameter`/`direction` fields in any of the page's `setXxx` state setters.
- All "What We're NOT Doing" constraints held: single suggestion (not a ranked list), card only on `/simulation` (not dashboard/analysis), no new persistence, `getRunAnalysis`/`getRunsComparison`/`listCompleted` untouched.
- `getParameterSuggestion` correctly scoped to `ctx.session.user.id` only — cross-user isolation explicitly tested (another user's more-strongly-correlated data is confirmed ignored).
- Performance: `.limit(500)` bound + O(13 × rows) linear correlation loop — no concern at this scale.
- The suggestion card's `max-w-xs` width matches this same page's own established sibling-card convention (running/saved-run cards), not a deviation from the dashboard's unrelated `max-w-2xl` layout.
- All 13 `PARAMETER_LABELS` keys match `RANGED_PARAMETER_NAMES` exactly — no typos.
- The one unplanned deviation (strengthening a weak "picks strongest correlation" test caught by its own deliberate break-check) is explicitly documented in its commit message, not a silent side-fix.
- Automated success criteria: `npm run typecheck`, `npm run check`, `npm test` (209/209) all passed at every phase boundary; manual success criteria verified live via dev server + curl/Playwright with real fixture data.
