<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production error visibility

- **Plan**: context/changes/fix-production-trpc-error-logging/plan.md
- **Scope**: Phase 6 of 6
- **Reviewed phases**: 6
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

The highest-risk phase (the only one changing real write-path behavior) got
the deepest scrutiny: both guards confirmed MATCH against the plan's
contract by reading `simulation.ts` in full. Both race tests were traced
call-by-call to confirm they genuinely exercise the *new* guards specifically
— not the pre-existing early-read checks — including a hypothetical-revert
walkthrough for each ("if this guard were removed, would the test fail for
the right reason?" — confirmed yes for both). The stop-race test's
assertion on the preserved sabotage score (0.1) independently proves the
losing caller's write never landed, not just that an error was thrown. The
start-race test's final count assertion can only hold if the invalidation
genuinely ran. Test fixture cleanup (via `trackedOwnerIds` cascade delete)
confirmed complete for both new tests. Automated criteria re-run live:
`npm run typecheck`, `npm run check`, `npx vitest run
src/server/api/routers/simulation.test.ts`, `npm test` all pass.

## Findings

### F1 — start's re-check can over-reject under N-way (3+) concurrent contention

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — safe direction (never breaches the cap), just
  conservative
- **Dimension**: Architecture
- **Location**: `src/server/api/routers/simulation.ts` (start's post-insert
  re-check)
- **Detail**: Under 3+ truly simultaneous `start` calls racing past the cap,
  every racer that still sees `count > MAX_PARALLEL_RUNS` at its own
  recheck self-invalidates — potentially more rejections than strictly
  necessary (e.g., 3 concurrent callers at a cap of 2 could all three
  self-invalidate instead of exactly one). Never unsafe, just a known
  fairness tradeoff under heavy contention, which this project's actual
  usage pattern (`MAX_PARALLEL_RUNS = 4`, a single browser session) makes
  very unlikely to matter.
- **Fix**: None needed.
- **Decision**: SKIPPED

### F2 — Both race tests are tightly coupled to the resolver's current method-chain shape

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/server/api/routers/simulation.test.ts`
- **Detail**: The Proxy-based interception matches `.update().set().where().returning()` /
  `.select().from().where()` exactly as written today. A future refactor of
  the resolver's call shape (reordering chain calls, wrapping in an explicit
  transaction) would silently break these tests' interception rather than
  the production guard — already documented in the tests' own comments as a
  deliberate, known tradeoff for deterministic race reproduction without
  real concurrency.
- **Fix**: None needed now; worth a mental note for whoever next refactors
  `simulation.ts`'s write paths.
- **Decision**: SKIPPED
