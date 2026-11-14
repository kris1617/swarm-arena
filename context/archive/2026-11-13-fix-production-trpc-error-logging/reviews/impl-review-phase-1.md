<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production error visibility

- **Plan**: context/changes/fix-production-trpc-error-logging/plan.md
- **Scope**: Phase 1 of 6
- **Reviewed phases**: 1
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

Clean, 3-file phase: `src/server/api/trpc.ts` (new `logTRPCError` export),
`src/app/api/trpc/[trpc]/route.ts` (wired unconditionally, dev-only gate
removed), `src/server/api/trpc.test.ts` (3 test cases, written before the
implementation — confirmed by this session's own TDD transcript: RED on
`logTRPCError is not a function`, then GREEN). Both review sub-agents found
MATCH on every planned change, no scope creep, no drift. All four automated
success-criteria commands (`npm run typecheck`, `npm run check`,
`npx vitest run src/server/api/trpc.test.ts`, `npm test`) were re-run live
during this review and passed (92/92 tests). The one manual criterion
(trigger a real tRPC error against a local production build, confirm the
structured log line) was performed earlier in this session with observed
evidence (`[tRPC] { path: 'simulation.stop', userId: '6ecae3ec-...' } Error
[TRPCError]: ...`) and is recorded in `## Progress` with its commit SHA.

## Findings

### F1 — Production logs now carry the full error object unconditionally

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — this is the intended effect of the change, not a defect
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/trpc.ts:86`, `src/app/api/trpc/[trpc]/route.ts:23`
- **Detail**: Before this phase, `onError` was dev-only and logged just
  `error.message` (a string). Now it's always on and logs the full
  `TRPCError` object, including `.cause` — which can wrap a `ZodError` whose
  issues sometimes include a `received` field with the actual invalid input
  value. This stays within server-side stdout (`docker compose logs app`),
  never reaching the client, and is exactly the fix this phase set out to
  make (per the audit: the dev/prod split should control verbosity, not
  whether logging happens at all). No PII-handling policy exists in this
  project yet for logs, so there's nothing to violate today.
- **Fix**: No action required now. Worth a one-line reminder if/when this
  project's logs are ever shipped to a third-party aggregator — confirm no
  PII-handling policy is violated before that happens.
- **Decision**: FIXED — added a doc-comment note on `logTRPCError`
  (`src/server/api/trpc.ts`) flagging the `.cause`/PII consideration for
  whoever adds a third-party log sink later.

## Verified independently (not findings)

- `logTRPCError` never throws (confirmed by reading the full body — only
  optional-chaining property access and a `console.error` call; no
  `JSON.stringify`, no I/O that can reject).
- `logTRPCError`'s declared parameter type intentionally omits `input` —
  confirmed against the real `@trpc/server` adapter type
  (`ErrorHandlerOptions<TContext>`); passing a function with a narrower
  parameter type to a callback site expecting the richer type is safe
  (excess-property checks don't apply to a variable, only an object
  literal) — `npm run typecheck` already confirms this compiles.
- Test file's structure (`describe`/flat `it`, `afterEach(vi.restoreAllMocks)`)
  matches `simulation.test.ts` and `post.test.ts`'s existing style. The
  same-directory relative import (`from "./trpc"`) doesn't contradict
  AGENTS.md's `~/*`-alias rule, which targets multi-level `../../` chains.
- No N+1/DB/network concerns — the function does no I/O at all.
