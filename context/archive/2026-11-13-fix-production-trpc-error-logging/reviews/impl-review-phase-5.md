<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production error visibility

- **Plan**: context/changes/fix-production-trpc-error-logging/plan.md
- **Scope**: Phase 5 of 6
- **Reviewed phases**: 5
- **Date**: 2026-11-13
- **Verdict**: APPROVED (after fix)
- **Findings**: 0 critical, 1 warning (fixed), 1 observation (fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → fixed |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Both files' try/catch placement confirmed to wrap the entire `tick` body
including the reschedule call, so there is no path where the catch runs and
a new frame is still scheduled. `cancelAnimationFrame`/unmount-cleanup
interaction confirmed idempotent in both files. Test-isolation technique
(`vi.fn()` wrapping the real implementation, `mockImplementationOnce` armed
immediately before the one triggering call) verified sound with no leakage
between test cases in either file. Single-run's error display (message +
"Start New Run" button) confirmed to match the plan's contract exactly.

## Findings

### F1 — Multi-run's tick-throw error display was a genuine dead end at the parallel-run cap

- **Severity**: WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff the plan explicitly flagged as
  ambiguous, worth pausing on
- **Dimension**: Safety & Quality / Architecture
- **Location**: `src/app/simulation/multi/_components/multi-simulation-stage.tsx`
- **Detail**: The tick-throw catch block set `tickError` and showed a
  text-only message with no button — the plan anticipated this ambiguity
  ("no clear single onFinished target") and left it for review. Traced the
  consequence at `src/app/simulation/multi/page.tsx`: no slot ever
  transitions out of `"running"` (only `stopSlot`/`markStopped` does that,
  and the dead loop can no longer drive it), so the per-slot "Dismiss"
  button never appears, and the start-new-run form is hidden whenever
  `atCap`. If the throw happens while at the parallel-run cap, the user hits
  a genuine dead end: error text, no Dismiss button, no form — only a full
  page reload recovers.
- **Fix**: On a tick throw, force-finish every currently-`"running"` slot
  via `onFinishedRef.current(slot.runId, undefined)` — the same no-score
  path already used for a failed stop mutation (`"Score unavailable (stop
  failed)"`). This makes every slot's "Dismiss" button appear and clears the
  cap, giving the user a way out without inventing a new UI concept.
  - Strength: Reuses an existing, already-tested pattern (`onFinished(id,
    undefined)`) rather than adding new UI; closes the dead end completely
    for any number of running slots, not just one.
  - Tradeoff: None significant — this only changes behavior on the error
    path, which had no prior defined behavior to preserve.
  - Confidence: HIGH — verified via an extended test case
    (`multi-simulation-stage.test.tsx`) asserting `onFinished` is called
    with the running slot's id and `undefined` score after a forced throw,
    red before the fix, green after.
  - Blind spot: None significant — the fix's reach (every "running" slot at
    throw time) was traced against `slotsRef.current`, which the tick
    function already reads as its source of truth.
- **Decision**: FIXED — `src/app/simulation/multi/_components/multi-simulation-stage.tsx`
  and its test updated; full suite re-verified green (101/101) after the
  change.

### F2 — Neither tick-throw catch block logs the error anywhere

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: Both `simulation-canvas.tsx` and `multi-simulation-stage.tsx`
- **Detail**: Neither catch block calls `console.error` — the error only
  becomes visible in the DOM. The phase's contract never required logging
  (that's Phases 1/3/4's job), so this isn't drift, but the phase's own
  stated motivation ("no trace anywhere, in the browser or on the server")
  isn't fully delivered: if the tab closes before anyone reads the on-screen
  message, there's still no trace.
- **Fix**: Added `console.error("simulation tick failed:", error)` to both
  catch blocks, test-first (extended both existing throw tests to assert the
  log call, red before the fix, green after).
  - Strength: Closes the phase's own stated goal ("no trace anywhere") that
    the original implementation left half-delivered; trivial, no behavior
    change beyond adding a log line.
  - Tradeoff: None significant.
  - Confidence: HIGH — verified red→green in both files.
  - Blind spot: None significant.
- **Decision**: FIXED — both `*.tsx` files and their tests updated; full
  suite re-verified green (101/101) after the change.
