<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production error visibility

- **Plan**: context/changes/fix-production-trpc-error-logging/plan.md
- **Scope**: Phase 4 of 6
- **Reviewed phases**: 4
- **Date**: 2026-11-13
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

## Summary

All three planned changes (`post.tsx`'s `onError`, `simulation-canvas.tsx`'s
`stopRun.useMutation` options, `multi-simulation-stage.tsx`'s `stopSlot`
`onError`) confirmed MATCH by reading every production and test file in
full, cross-checked against `git show d3c5414 --stat` to confirm no scope
creep beyond the three files + their tests + `plan.md`. TanStack Query's
`onError(error, variables, context)` signature verified against actual usage
in `simulation-canvas.tsx` — `variables.runId` correctly resolves to what's
passed to `.mutate()`. All three test files' mocking techniques verified
sound, including `multi-simulation-stage.test.tsx`'s use of a mocked
`computeMultiRunTick` as a means to reach `stopSlot`'s `onError`, not as the
test's actual focus. Automated criteria re-run live: `npm run typecheck`,
`npm run check`, and all three extended/new test files plus `npm test` pass.

## Findings

### F1 — Logging shape differs between Phase 1's `logTRPCError` and these three client-side handlers

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/server/api/trpc.ts` vs. the three Phase 4 files
- **Detail**: `logTRPCError` logs a 3-arg structured shape
  (`"[tRPC]", {path, userId}, error`); the three client-side handlers each
  use a 2-arg `console.error(message, error)` shape. Different layers
  (server dispatcher with session context vs. per-mutation client handler
  with none available) and explicitly sanctioned by the plan's own "What
  We're NOT Doing" (no shared logging abstraction).
- **Fix**: None — this is the plan's deliberate, documented choice.
- **Decision**: SKIPPED (already an accepted, documented tradeoff — no
  action needed)
