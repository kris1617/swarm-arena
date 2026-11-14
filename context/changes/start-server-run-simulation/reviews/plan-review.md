<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Start a Server-Run Simulation Implementation Plan

- **Plan**: context/changes/start-server-run-simulation/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND (after two inline fixes)
- **Findings**: 0 critical, 2 warnings (fixed), 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

4/4 paths ✓ (page.tsx, simulation.ts, simulation.test.ts, server-run-registry.ts), 3/3 symbols ✓ (startServerRun, ServerRunParams, isServerRunActive), brief↔plan ✓.

## Findings

### F1 — Unnecessary `ctx` threading through the extracted helper

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, Changes Required #1
- **Detail**: The draft contract threaded `ctx` through `insertRunningSimulation` for no reason — the extracted body only ever uses `ctx.db`, and `db` is already importable as a module-level singleton (the same pattern `server-run-registry.ts` already uses). Passing `ctx` would require typing the whole tRPC context shape for one helper with no benefit.
- **Fix**: Use the imported `db` singleton directly inside `insertRunningSimulation`; drop `ctx` from its signature.
- **Decision**: FIXED, then **REVERTED during implementation** — `simulation.test.ts`'s existing `describe("simulationRouter.start — parallel-run cap race")` test injects a sabotaging `Proxy` via `createCaller({ db: sabotagingDb, ... })` to reproduce an exact concurrent-insert race. Reading the module-level `db` singleton directly instead of the `db` instance threaded through `ctx` would have silently bypassed that injection and broken the existing test — a real regression this plan-review finding's own fix would have introduced. `insertRunningSimulation` now takes `db` as an explicit parameter (`typeof dbSingleton`, a type-only import), with both `start` and `startServer` passing `ctx.db`. Recorded here rather than silently re-fixed, since the original finding's reasoning (avoid unnecessary context-threading) was sound in isolation but missed this codebase-specific testing convention.

### F2 — Inconsistent naming for the client mutation hook (`startServerRun` vs. `startServerMutation`)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Changes Required #3
- **Detail**: The draft declared the client-side mutation hook as `startServerRun` in one sentence, then referred to it as `startServerMutation` in a later sentence — an implementer would hit a contradiction mid-phase.
- **Fix**: Settled on `startServerMutation` consistently, with a one-line note explaining why it's deliberately not named `startServerRun` (that name belongs to the server-only function in a different file).
- **Decision**: FIXED — applied directly to plan.md.
