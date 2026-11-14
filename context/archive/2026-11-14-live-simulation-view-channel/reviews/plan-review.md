<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Live Simulation-View Channel Implementation Plan

- **Plan**: context/changes/live-simulation-view-channel/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND (after one structural fix, applied before implementation)
- **Findings**: 1 critical (fixed), 1 warning (fixed), 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (server-run-registry.ts, simulation.ts, simulation.test.ts, react.tsx, trpc route handler), 2/2 symbols ✓ (getLiveRunState, isServerRunActive), brief↔plan ✓.

## Findings

### F1 — Testing Strategy relied on `createCaller` to invoke a subscription procedure, which tRPC's own types forbid

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Implementation Approach, Phase 1 Changes Required, Testing Strategy
- **Detail**: The original draft assumed `createCaller().simulation.watch(...)` would return an async generator, mirroring the existing `start`/`stop` test pattern. Checked against `node_modules/@trpc/server/dist/unstable-core-do-not-import-B8epiErP.d.cts:1440`: `.subscription(...)`'s return type is `TCaller extends true ? TypeError<'Not implemented'> : SubscriptionProcedure<...>` — `createCaller`'s decorated procedures set `TCaller: true`, so invoking a subscription procedure through a server-side caller is a compile-time error. The plan's entire test strategy for this Foundation would not have compiled.
- **Fix**: Extract the generator logic into a plain, exported `watchServerRun` function in `server-run-registry.ts` (the "pure core, thin tRPC shell" pattern this codebase already uses everywhere else). The `watch` procedure becomes a one-line delegate wrapping each yield in `tracked()`. Tests call `watchServerRun` directly — no tRPC transport involved.
  - Strength: Matches the established separation (`computeSingleRunTick` vs. the router that calls it); fully testable; the thin procedure has no independent logic left to test.
  - Tradeoff: One more exported function in `server-run-registry.ts`; the `watch` procedure itself is untested (acceptable — it has no behavior beyond delegation).
  - Confidence: HIGH — grounded directly in tRPC's shipped type definitions, not inference.
  - Blind spot: None significant.
- **Decision**: FIXED — applied directly to plan.md (Implementation Approach, Changes Required #1/#2, Testing Strategy) before any implementation code was written.

### F2 — `signal.aborted` would throw when `signal` is `undefined`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach / Changes Required #1
- **Detail**: tRPC types `signal` as `AbortSignal | undefined` (same file, line ~1345/1478). The plan's original loop guard `while (!signal.aborted)` throws a `TypeError` when `signal` is `undefined` — exactly the case when `watchServerRun` is called directly from a test with no `signal` argument.
- **Fix**: Use `signal?.aborted` throughout, and add a test case passing an already-aborted signal to prove the guard actually works (not just that it doesn't throw on `undefined`).
- **Decision**: FIXED — applied directly to plan.md.
