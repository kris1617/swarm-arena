<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Start a Server-Run Simulation Implementation Plan

- **Plan**: context/changes/start-server-run-simulation/plan.md
- **Scope**: Phase 1 of 1 / Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-14
- **Verdict**: APPROVED (after one fix)
- **Findings**: 0 critical, 1 warning (fixed), 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `startServerRun` called unwrapped; a thrown error leaves the row stuck at `"running"`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts (startServer procedure, originally lines 151-157)
- **Detail**: `startServerRun(...)` was called synchronously, unwrapped, right after `insertRunningSimulation` committed the row as `status: "running"`. If `startServerRun` threw before registering the run (e.g. `createInitialPopulation`/`createInitialPredators` failing), the mutation rejected to the client but the DB row was left stuck at `"running"` with nothing tracking it — no log, no rollback. The row would occupy a `MAX_PARALLEL_RUNS` slot indefinitely, recoverable only via a direct out-of-band `stop` call (the UI exposes no stop control for a server run yet).
- **Fix**: Wrap the call in try/catch. On failure: log loudly, flip the row to `"stopped"` (so it stops counting against the cap), and throw `INTERNAL_SERVER_ERROR` to the caller instead of a false-positive success.
- **Decision**: FIXED — applied directly (commit 3abbfe9), with a new test ("marks the row stopped and surfaces an error when startServerRun throws") proving the catch path.

### F2 — Extraction is a faithful, behavior-preserving refactor of `start`'s body

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/server/api/routers/simulation.ts (insertRunningSimulation)
- **Detail**: Same cap pre-check, same insert field order, same race-safety recheck-and-invalidate, same error codes as the original `start` body. `start`'s own behavior is unchanged (confirmed: existing `describe("simulationRouter.start — parallel-run cap race")` test, which injects a sabotaging `Proxy` via `createCaller({ db: sabotagingDb, ... })`, still passes — proving the `ctx.db`-threading correction documented in the plan actually preserves that injection point).
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F3 — UI token usage and button semantics are correct

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/page.tsx
- **Detail**: The new button and confirmation panel reuse `bg-input text-foreground` / `hover:bg-foreground/35` tokens exactly as the existing "Start" button — no literal colors, consistent with this project's UI convention. `type="button"` on "Start on server" is spec-safe: it never triggers form submission on click or Enter-key activation, so no accidental double-submit risk despite sitting inside the same `<form>`.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F4 — Test cleanup discipline matches the established pattern

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/api/routers/simulation.test.ts
- **Detail**: `trackedServerRunIds` + `stopServerRun` in `afterEach` matches `server-run-registry.test.ts`'s `activeRunIds` pattern exactly (push on start, drain-and-stop in cleanup).
- **Fix**: None needed.
- **Decision**: ACCEPTED.

## Additional verification

- Re-ran all Phase 1 Automated Verification commands at current HEAD (post-fix): `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/api/routers/simulation.test.ts` PASS (16/16, up from 15/15), `npm test` PASS (146/146, up from 145/145).
- Manual verification re-confirmed as part of this review's own re-check: no regression to the staging flow; the server-run survival guarantee (proven via the E2E test-auth bypass + direct DB read during implementation) is unaffected by this fix, which only changes the error path.
