<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fix default-parameter simulation start

- **Plan**: context/changes/fix-default-start-failure/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-17
- **Verdict**: NEEDS ATTENTION → APPROVED (after triage fixes)
- **Findings**: 1 critical, 1 warning, 0 observations — both FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unhandled rejection in the sweep can crash the whole server

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/orphan-sweep.ts:23-51, 66-69
- **Detail**: `sweepOrphanedRuns()` has no try/catch anywhere. Invoked as bare `void sweepOrphanedRuns()` inside `setInterval` with no `.catch()`. A transient DB error on any tick becomes an unhandled promise rejection, crashing the whole process every 5 minutes on any transient DB fault. The file's own header comment claims to mirror `retry-worker.ts`, but that file wraps each row's attempt in try/catch specifically to prevent this exact failure mode (`retry-worker.ts:44-55`, citing its own prior impl-review finding F2 for the identical bug). orphan-sweep.ts copied the interval/dedup shape but omitted the defensive handling that shape depends on.
- **Fix**: Wrap the `db.select()` and each row's `db.update()` in try/catch, `console.error` and continue on failure — same per-row discipline `retry-worker.ts` already uses.
  - Strength: Reuses an already-reviewed, already-correct pattern in this exact codebase; eliminates the crash class entirely.
  - Tradeoff: None significant.
  - Confidence: HIGH — the precedent file explicitly documents this as the fix for the identical bug.
  - Blind spot: None significant.
- **Decision**: FIXED (try/catch added around the select and each row's update, console.error + continue, matching retry-worker.ts)

### F2 — Sweep's UPDATE doesn't re-check status, can clobber a concurrent stop/save

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/orphan-sweep.ts:46-49
- **Detail**: The sweep's update filters only by `id`, with no status re-check. Every other terminal-state write in `simulation.ts` (e.g. `stop`, `simulation.ts:596-600`) re-checks `and(eq(id), eq(status, "running"))` as a documented "race-safety net." Without it, a concurrent `stop`/`savePause` between the sweep's select and update can be silently clobbered — the row ends up marked `wasAutoStopped: true`/`stopped` even if the user just saved or stopped it themselves.
- **Fix**: Add `and(eq(simulationRuns.id, row.id), eq(simulationRuns.status, "running"))` to the update's WHERE, matching the file's own established convention.
  - Strength: Reuses the exact established pattern from `stop`'s own handler; makes the race fail safely instead of silently corrupting state.
  - Tradeoff: None significant.
  - Confidence: HIGH — identical pattern, same file, directly comparable call site.
  - Blind spot: None significant.
- **Decision**: FIXED (status re-check added to the update's WHERE, applied together with F1's fix)
