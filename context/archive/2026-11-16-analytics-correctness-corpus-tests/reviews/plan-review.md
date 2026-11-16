<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Analytics-correctness corpus tests

- **Plan**: context/changes/analytics-correctness-corpus-tests/plan.md
- **Mode**: Deep
- **Date**: 2026-11-16
- **Verdict**: SOUND (after fixes)
- **Findings**: 2 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, symbols ✓, brief↔plan ✓. A dedicated codebase-verification sub-agent independently confirmed the plan's params-shape claim (VALID_START_INPUT ≡ StartCorpusRunParams exactly), listLeaderboard's return shape, and getRunsComparison's discriminated union — all accurate. It also caught two pre-implementation defects that would have blocked or flaked the plan as originally written.

## Findings

### F1 — Phase 1's insert omits the required `seed` column

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Contract
- **Detail**: `simulationRuns.seed` is NOT NULL with no DB default, and is excluded from `StartCorpusRunParams`/`CorpusFixtureRow.params`. A plain insert using exactly the plan's stated fields would fail the NOT NULL constraint.
- **Fix**: Add `seed: <loop index>` to each inserted row, matching the existing `simulation.test.ts` fixture-insert precedent.
- **Decision**: FIXED

### F2 — Email prefix collides with an existing cleanup LIKE pattern

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details
- **Detail**: The originally-proposed `corpus-db-<uuid>@example.com` prefix is claimed distinguishable from the generation harness's `corpus-<uuid>@example.com`, but SQL `LIKE 'corpus-%@example.com'` is a substring match, not anchored — it matches `corpus-db-*` too. `generate-sweep.ts`/`generate-sweep.smoke.test.ts` run this exact cleanup in the default `npm test` suite against the same SQLite file, risking cross-test row deletion.
- **Fix**: Rename the prefix to `db-fixture-<uuid>@example.com` — cannot match `corpus-%@example.com` under any substitution.
- **Decision**: FIXED

### F3 — getRunsComparison's breakdown requires elapsedSeconds in history

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Contract
- **Detail**: `breakdown` is only non-null when `history.elapsedSeconds` is a number. Confirmed during planning the real corpus always has it, but the plan didn't say so explicitly.
- **Fix**: Added a clarifying sentence to Phase 3's Contract.
- **Decision**: FIXED

## Verification

An independent sub-agent verified, read-only: (A) `VALID_START_INPUT` and `StartCorpusRunParams` are field-for-field identical; found the missing `seed` requirement. (B) `listLeaderboard`'s exact return shape, ordering, and non-null-score filter all match the plan's claims. (C) `getRunsComparison`'s 2-4 id bound and discriminated union match the plan's claims, with the `elapsedSeconds` caveat noted. (D) No existing precedent for a 10+-row batch insert under one owner; found the real email-prefix collision risk (F2).
