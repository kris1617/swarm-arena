<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Server-Owned Simulation Execution Engine Implementation Plan

- **Plan**: context/changes/server-side-simulation-engine/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND (after inline fixes)
- **Findings**: 0 critical, 1 warning, 1 observation (both fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

7/7 paths ✓ (simulation-canvas.tsx, single-run-lifecycle.ts, simulation.ts router, schema.ts, db/index.ts, boids.ts, simulation.test.ts), 4/4 symbols ✓ (computeScore, createRng, db, MAX_PARALLEL_RUNS), brief↔plan ✓.

## Findings

### F1 — Fake timers + real async DB I/O needs `advanceTimersByTimeAsync`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Testing Strategy — Unit Tests
- **Detail**: The planned test uses `vi.useFakeTimers()` to drive a `setInterval` whose callback performs real async DB writes (libsql). Advancing fake timers synchronously doesn't let those awaits settle, which would make assertions race the DB write or make tests flaky.
- **Fix**: Use `await vi.advanceTimersByTimeAsync(ms)` instead of the synchronous variant, and clear any live interval + call `vi.useRealTimers()` in `afterEach` so a failed test can't leak a ticking interval into later test files in the same worker.
- **Decision**: FIXED — applied directly to plan.md's Testing Strategy section.

### F3 — New test file not listed under Changes Required

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Changes Required
- **Detail**: `server-run-registry.test.ts` was only referenced in Testing Strategy, not listed as its own Changes Required entry alongside the source file it tests.
- **Fix**: Added Changes Required #2 naming the test file and its intent.
- **Decision**: FIXED — applied directly to plan.md.
