<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Suggestion-quality corpus test

- **Plan**: context/changes/suggestion-quality-corpus-test/plan.md
- **Mode**: Deep
- **Date**: 2026-11-16
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (fixed) |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, symbols ✓, brief↔plan ✓. A dedicated codebase-verification sub-agent independently re-derived the plan's central claim from scratch (re-reading the real corpus + `buildSweepMatrix()` + `suggestParameterChange`) and got an exact match: `{ parameter: "foodRegenRate", direction: "increase", confidence: "medium", sampleSize: 20 }`, correlation 0.6250155983924791 — confirms this plan's success criteria are grounded in measured fact, not assumption.

## Findings

### F1 — "import type" constraint for harness.ts not stated as a hard requirement

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Contract
- **Detail**: Phase 1 crosses `src/` into `scripts/corpus/` for the first time in the repo (confirmed: zero existing precedent). It's safe only because `harness.ts`'s import is type-only — `verbatimModuleSyntax` erases it at compile time, so none of `harness.ts`'s heavy runtime deps (DB client, drizzle, vitest's `vi`) actually load. The plan showed `import type` in its contract but never stated this must stay a type import.
- **Fix**: Add the constraint explicitly to Phase 1's Contract.
- **Decision**: FIXED

### F2 — CorpusFixtureRow.score: number | null doesn't match SuggestionInputRow.score: number

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Contract / Phase 2
- **Detail**: `CorpusFixtureRow.score` inherited `number | null` from the upstream `CorpusRunRecord.score` type, but `SuggestionInputRow.score` requires plain `number`. The plan didn't say how Phase 2 bridges this gap.
- **Fix**: Loader throws if any run's score is null (consistent with its existing fail-loudly philosophy); `CorpusFixtureRow.score` typed as plain `number`.
- **Decision**: FIXED

## Verification

An independent sub-agent verified, read-only: (A) the `src/` → `scripts/corpus/` import direction resolves correctly under both `tsc --noEmit` and vitest, with no existing repo precedent either direction; (B) re-derived the heuristic's exact output against the real corpus from scratch — exact match; (C) blast-radius sweep of `buildSweepMatrix`, `CorpusRunRecord`, `suggestParameterChange`, `RANGED_PARAMETER_NAMES` found no uncovered callers; (D) confirmed `suggestParameterChange` has zero boolean-exclusion logic and the existing unit test has zero coverage of a boolean parameter varying — the Phase 3 gap claim is accurate.
