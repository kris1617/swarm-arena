<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Admin-settings range backfill

- **Plan**: context/changes/admin-settings-range-backfill/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-18
- **Verdict**: APPROVED (triaged — both findings FIXED)
- **Findings**: 0 critical, 2 warnings, 0 observations — all FIXED

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

### F1 — Dirty-check is key-order-sensitive, not value-sensitive

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:198
- **Detail**: `JSON.stringify(merged) !== JSON.stringify(existingRanges)` is key-order-sensitive, not value-sensitive — a future caller that re-serializes the same key set in a different order would trigger a spurious "different" detection. Harmless today (just an extra no-op write), but fragile to an assumption that isn't guaranteed to hold forever.
- **Fix**: Replace the stringify compare with an explicit missing-keys check — `RANGED_PARAMETER_NAMES.some((name) => !(name in existingRanges))`.
- **Decision**: FIXED

### F2 — Narrow TOCTOU race against a concurrent admin update

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:187-216
- **Detail**: Read-modify-write with no transaction or version check. If an admin's full-replace `updateParameterRanges` call lands between this function's read and write, the backfill write could silently overwrite the admin's fresh edit. Low likelihood (rarely-edited singleton row, single-admin usage), but a real lost-update with no error surfaced if it happens.
- **Fix A ⭐ Recommended**: Accept the risk, document it with a one-line comment
  - Strength: Zero new pattern introduced; no existing `db.transaction` usage in this codebase to extend.
  - Tradeoff: The race technically still exists — just acknowledged.
  - Confidence: HIGH — matches the subagent's own independent assessment.
  - Blind spot: None significant.
- **Fix B**: Wrap the read+write in a transaction
  - Strength: Closes the race entirely.
  - Tradeoff: Introduces a genuinely new pattern for a low-likelihood, low-impact race on a singleton row.
  - Confidence: MEDIUM — libsql/Drizzle transaction support for this exact shape unverified.
  - Blind spot: Isolation level support in the current libsql driver not checked.
- **Decision**: FIXED (Fix B — wrapped the read + conditional write in `db.transaction`, the first use of this pattern in the codebase; typecheck/lint/full suite all green)
