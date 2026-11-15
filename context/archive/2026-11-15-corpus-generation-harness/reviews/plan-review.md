<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Corpus-generation harness

- **Plan**: context/changes/corpus-generation-harness/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: SOUND (after fixes; REVISE before)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (was WARNING) |
| Plan Completeness | PASS (was WARNING) |

## Grounding
6/6 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — `ensureAdminRangesAdmit`'s type signature doesn't match how it's called with a boolean field

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — `ensureAdminRangesAdmit`/`startCorpusRun` contract
- **Detail**: `ensureAdminRangesAdmit`'s signature is typed `Partial<Record<RangedParameterName, number>>`, but `startCorpusRun` is described calling it with the full `startInputSchema`-shaped `params`, which includes `crossbreedingEnabled: boolean` (also a `RangedParameterName`). This won't typecheck as written. `checkAgainstAdminRanges` itself skips booleans entirely (`typeof value === "boolean" ? continue`), so widening this field has zero runtime effect either way — but the existing `updateRunParams` procedure already established the right pattern for this exact tension: coerce via `typeof v === "boolean" ? Number(v) : v` before building a numeric-range-shaped object.
- **Fix**: In `ensureAdminRangesAdmit`'s contract, coerce boolean fields the same way `updateRunParams` does before comparing against ranges — a generic `typeof value === "boolean" ? Number(value) : value` mapping, not a field-name-specific skip.
- **Decision**: FIXED

### F2 — Plan understates the pre-existing shared-`adminSettings`-singleton risk across parallel test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — admin-range widen/restore contract
- **Detail**: The plan implies the immediate widen-then-restore makes concurrent access safe. In fact `adminSettings` is already a known shared-mutable-singleton risk across Vitest's parallel test-file workers (all pointing at the same `db.sqlite` file) — the existing `simulation.test.ts` `afterEach`'s `db.delete(adminSettings)` exists specifically to paper over this, not because prior code was fully race-free. This harness doesn't introduce a new risk class, but the plan should name it rather than imply the restore makes it fully safe.
- **Fix**: Add a one-line risk note acknowledging this is the same pre-existing shared-singleton risk every `adminSettings`-touching test already lives with, not a new exposure this harness introduces.
- **Decision**: FIXED

### F3 — `getOrSeedAdminSettings` must be duplicated, not reused, since it's a private module-local helper

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — `ensureAdminRangesAdmit`'s seed-if-absent logic
- **Detail**: `getOrSeedAdminSettings` (`simulation.ts:86`) has no `export` keyword — only `simulationRouter` is exported from that file. The plan's "seeding it first via the existing `getOrSeedAdminSettings`-equivalent logic" phrasing undersells that this is a genuine duplication (two places to update if the real seeding logic ever changes), not a reuse.
- **Fix**: State explicitly in the plan that this is a deliberate, acknowledged duplication of `getOrSeedAdminSettings`'s seed-if-absent shape, not a shared import.
- **Decision**: FIXED
