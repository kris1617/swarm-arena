<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Concurrent-load capacity test

- **Plan**: context/changes/testing-concurrent-load-capacity/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Both phases implement the plan faithfully — no drift, no unplanned scope. The widened `insertOwnedRunningRun` signature (optional `paramOverrides`) is a reasonable, plan-anticipated extension. The one real finding: test 1 has no explicit Vitest timeout and falls back to the 5000ms default, while this project's own `vitest.config.ts` already documents worker-contention-driven spurious timeout failures on slow-but-correct tests as a known risk class here — test 2 already guards against this with an explicit `60_000` timeout; test 1 should too. The 3 observations (seed reuse, backlog tolerance, test-2 runtime) all check out as non-issues on inspection.

## Findings

### F1 — Test 1 has no explicit timeout, relies on Vitest's 5000ms default

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry-capacity.test.ts:122
- **Detail**: Test 1 drives 4 real `startServerRun` runs (140 combined agents) through ~300 real-CPU ticks via `vi.advanceTimersByTimeAsync(5000)`, with no explicit per-test timeout. `vitest.config.ts:82-85` documents, in this exact repo, that worker-count contention can cause "spurious testTimeout/hookTimeout failures on slow-but-correct tests" — a named risk class here, not hypothetical. Test 2 (heavier workload, ~1.67x the ticks) already sets an explicit `60_000` timeout; test 1 should follow the same established pattern rather than relying on the global default.
- **Fix**: Add an explicit generous timeout to test 1 (e.g. `}, 30_000);`), matching test 2's and this project's established pattern for fake-timer-driven multi-run tests.
- **Decision**: FIXED — added `}, 30_000);` to test 1, verified via `npx tsc --noEmit` and `npx vitest run` (2/2 passing).

### F2 — Seed reuse across sibling files (non-issue, confirmed safe)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry-capacity.test.ts (seeds 50-53, 60-63)
- **Detail**: Seed 50 is also used in the sibling `server-run-registry.test.ts:171`. Confirmed non-issue: `seed` is only an RNG input stored per-row, not a uniqueness/dedup key — every fixture row gets a fresh `crypto.randomUUID()` owner email and autoincrement run id regardless of seed value.
- **Fix**: None needed.
- **Decision**: FIXED — shifted seeds to 150-153/160-163 (outside the sibling file's 1-50 range) for cleanliness, verified via `npx tsc --noEmit` and `npx vitest run` (2/2 passing). Confirmed non-functional change — seed was never a collision risk.

### F3 — No-backlog tolerance (0.05s) confirmed safely loose, not flaky

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry-capacity.test.ts:164, 304
- **Detail**: Under `vi.useFakeTimers()`, all 4 intervals register at the same fake "now" with identical 16ms period and synchronous tick callbacks, so true expected variance across runs is near-zero, not just small. The 0.05s (~3 ticks) tolerance sits comfortably above that — generous, not at risk of false positives.
- **Fix**: None needed.
- **Decision**: FIXED — tightened both occurrences from 0.05s to 0.02s (just over 1 tick's margin, TICK_INTERVAL_MS=16ms), confirmed via 4 consecutive clean runs (per lessons.md's "a single green run proves nothing about flakiness" rule).

### F4 — Test 2's ~28s runtime / 60s timeout confirmed proportionate

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry-capacity.test.ts:322
- **Detail**: The reproduction-growth scenario genuinely needs enough ticks for `reproducePopulation` to visibly grow the aggregate past 150 with the chosen reproduction-favorable params — a smaller advance/population risks the core `toBeGreaterThan(150)` assertion becoming non-deterministic in the opposite direction. This is a dev-only, non-CI-gating test per `test-plan.md` §6.9, so the runtime is acceptable as-is.
- **Fix**: None needed.
- **Decision**: FIXED — reduced timeout from 60_000 to 45_000 (still ~1.6-2x margin over the consistently-observed 23-28s runtime across 6 total runs this session), left the tick budget untouched since that's load-bearing for the core assertion's reliability, not the runtime.
