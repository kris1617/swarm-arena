<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Live Simulation-View Channel Implementation Plan

- **Plan**: context/changes/live-simulation-view-channel/plan.md
- **Scope**: Phase 1 of 1 / Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations (all accepted, no fix required)

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

### F1 — Bounded, self-healing resource leak on unclean disconnect

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry.ts (watchServerRun, the `while (!opts.signal?.aborted)` loop)
- **Detail**: If the underlying HTTP connection drops without the `AbortSignal` firing promptly (slow/absent FIN, proxy buffering, client crash), the generator keeps polling `getLiveRunState` every 150ms with no subscriber reading the output. No unbounded leak exists, though: every server run hard-stops at `maxDurationSeconds` (≤600s) via `finishRun`, which deletes the registry entry regardless of whether anyone is watching — so an orphaned watcher self-terminates within at most ~10 minutes. Cost per orphaned watcher is one cheap Map read + timer tick per cycle.
- **Fix**: None required now — the run's own duration cap is an adequate, if indirect, safety net for this Foundation's scope. A future phase could add early cleanup via a connection-close hook if orphaned watchers in practice turn out to matter.
- **Decision**: ACCEPTED (bounded, low severity, no user-visible or data-exposure impact).

### F2 — Redundant `UNAUTHORIZED` re-check in `watch`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/api/routers/simulation.ts (watch procedure)
- **Detail**: `protectedProcedure`'s middleware already narrows `ctx.session.user` to non-nullable before the resolver runs, so the subsequent `if (!userId) throw UNAUTHORIZED` is guaranteed never to fire via a real request — but it is load-bearing for TypeScript, since `ctx.session.user.id` itself is still typed `string | undefined` (from `@auth/core`'s `User.id?: string`), and `watchServerRun`'s `userId: string` parameter requires the narrowed value. `start` follows the same pattern; `stop` doesn't need it since it never passes the id as a strictly-typed parameter.
- **Fix**: None needed — required for typecheck, not dead code.
- **Decision**: ACCEPTED.

### F3 — Per-watcher polling, not shared/broadcast across watchers of one run

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/server/simulation/server-run-registry.ts (`WATCH_INTERVAL_MS` comment + `watchServerRun`)
- **Detail**: Each concurrent viewer of the same run runs its own independent 150ms poll/serialize cycle rather than one shared computation fanned out to N viewers. Explicitly acknowledged as this Foundation's deliberate scope boundary in the plan's "What We're NOT Doing" section — the one-viewer-per-run product requirement (S-07/S-08) doesn't yet need multi-viewer sharing.
- **Fix**: None needed now — revisit only if a future slice needs many concurrent viewers of one run.
- **Decision**: ACCEPTED.

## Additional verification

- Re-ran all Phase 1 Automated Verification commands at current HEAD: `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/simulation/server-run-registry.test.ts` PASS (12/12), `npm test` PASS (142/142).
- Plan-drift check: all 3 planned changes (`watchServerRun`, `watch` procedure, client `splitLink` wiring) MATCH with no scope creep. One justified adaptation (the `UNAUTHORIZED` guard, F2 above) required by TypeScript, not drift.
- Confirmed `splitLink`'s `condition: (op) => op.type === "subscription"` is the documented, correct way to route by operation type (verified against `@trpc/client`'s `Operation` type definition).
- Confirmed the ownership check happens entirely before the first `yield` — no state-leak path to another user's run data.
