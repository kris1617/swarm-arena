# Implementation Plan: Score phase quality per completed lifecycle cycle

## Overview

`computePhaseQuality` (`src/server/simulation/boids.ts:1254`) currently applies
a single yes/no "does at least one crash→recovery pair exist anywhere in the
run" resilience bonus, flat `×1.2`, regardless of how many full cycles the
population actually completed. A population that survives three crashes and
recovers each time scores identically to one that barely survives a single
cycle. This plan replaces the boolean detection with a count of completed
crash→recovery cycles and scales the bonus with that count, capped with
diminishing returns, while leaving the time-weighted average term (which
already correctly reflects overall time-in-good-phases, cycle-count-agnostic)
untouched.

**Scope note on "LOW complexity, no interview":** per `change.md`'s notes,
the gap itself was already confirmed by direct code inspection (not a
hypothesis), the function's signature does not change (same
`(phaseHistory: PopulationPhase[]): number)`), no caller needs updating, and
the one open design decision (exact per-cycle aggregation formula) was
explicitly deferred to this planning step as "implementer's call." This plan
makes that call directly rather than running the standard question interview.

## Current State Analysis

- `classifyPopulationPhase` (`boids.ts:1196`) already re-classifies correctly
  every tick from a rolling window — multi-cycle detection at the
  classification level is not broken. A population can genuinely cycle
  through `growth → overshoot → crash → recovery → growth → overshoot →
  crash → recovery → ...` within one run, and each transition is correctly
  labeled.
- `computePhaseQuality` (`boids.ts:1254-1281`) does two things:
  1. Computes `average` — the flat mean of `PHASE_QUALITY_WEIGHTS[phase]`
     (`boids.ts:1240-1246`) across *every* tick in `phaseHistory`. This part
     is not being changed — it already weights time spent in each phase
     correctly, independent of cycle count, and there's no stated gap here.
  2. Detects `hasCrashToRecovery` (`boids.ts:1262-1275`) — a nested loop that
     sets a boolean `true` the moment ANY `"crash"` tick is followed by ANY
     later `"recovery"` tick anywhere in the array, then stops scanning
     (`break` at `boids.ts:1272-1274`). This is the confirmed gap: it counts
     existence, not occurrences.
  3. Applies `withBonus = hasCrashToRecovery ? average * RESILIENCE_BONUS_MULTIPLIER (1.2) : average`, clamped to `[0, 1]` (`boids.ts:1277-1280`).
- Callers of `computePhaseQuality` (no signature change needed, confirmed by
  reading all three): `computeScore`'s call sites in
  `src/server/simulation/server-run-registry.ts` (`tick()`'s `shouldStop`
  branch, and `stopServerRun`) and `src/server/api/routers/simulation.ts`'s
  `stop` resolver. All three pass a plain `PopulationPhase[]` and read back a
  plain number — untouched by this fix.
- Existing tests (`boids.test.ts:1036-1069`, `describe("computePhaseQuality")`)
  cover: empty history → 0; growth-only beats crash-only; one genuine
  crash→recovery beats crash-only (the existing resilience-bonus test, using
  exactly one cycle); never exceeds 1. All four must continue passing
  unchanged — the fix is designed to preserve the exact `1.2×` magnitude for
  the one-cycle case.

## What We're NOT Doing

- Not changing the flat time-weighted `average` computation — no stated gap
  there, and changing it would risk regressing the "spends most of the run in
  growth/recovery scores well" property that's already correct.
- Not changing `classifyPopulationPhase`, `PHASE_QUALITY_WEIGHTS`, or any
  other exported function in `boids.ts` — the gap is isolated to the
  resilience-bonus half of `computePhaseQuality`.
- Not changing `computePhaseQuality`'s signature, so no caller in
  `server-run-registry.ts` or `simulation.ts` needs any change.
- Not retroactively recomputing already-archived runs' stored scores — this
  only changes how future runs are scored (per `change.md`'s notes).
- Not building any UI to show the per-cycle breakdown — that's roadmap item
  S-11 (run-analysis-view), which depends on this slice (S-09) and on F-05
  (persist-run-history) landing first.

## Implementation Approach

Replace the boolean `hasCrashToRecovery` detection with a count of completed
crash→recovery cycles, then scale the resilience bonus multiplicatively with
that count using diminishing returns, capped so the bonus never exceeds a
fixed ceiling:

```
bonusMultiplier = 1 + RESILIENCE_BONUS_STEP * min(cycleCount, RESILIENCE_BONUS_CAP_CYCLES)
```

With `RESILIENCE_BONUS_STEP = 0.2` and `RESILIENCE_BONUS_CAP_CYCLES = 3`:
- 0 cycles → `×1.0` (no change — matches today's "no bonus" case exactly)
- 1 cycle → `×1.2` (matches today's existing magnitude exactly — the 4
  existing tests stay green unchanged)
- 2 cycles → `×1.4`
- 3+ cycles → `×1.6` (capped — avoids unbounded reward for endless
  crash-cycling, which the final `[0, 1]` clamp would otherwise just flatten
  to 1.0 anyway once `average` is reasonably high)

A "completed cycle" is counted as: a `"crash"` tick followed later by a
`"recovery"` tick, where the recovery is not already claimed by an earlier
counted cycle (i.e., scan forward through the array counting non-overlapping
crash→recovery pairs, same style as the existing nested-loop scan but
counting instead of early-exiting on the first match).

### Changes Required:

#### 1. Count crash→recovery cycles instead of detecting existence

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the existence-only scan with one that counts
non-overlapping crash→recovery pairs, so a run with multiple completed
resilience cycles is distinguishable from one with exactly one.

**Contract**: Add a module-private helper
`function countCrashToRecoveryCycles(phaseHistory: PopulationPhase[]): number`.
Scans forward through `phaseHistory` once: on finding a `"crash"` tick not
yet consumed by an earlier counted cycle, scans forward for the next
`"recovery"` tick; if found, increments the count and continues scanning
from just after that `"recovery"` tick (so the same recovery can't be
double-counted against a later crash, and ticks already "spent" on a
counted cycle aren't rescanned). O(n) single pass — no nested loop, unlike
the function it replaces.

#### 2. Scale the resilience bonus by cycle count, capped

**File**: `src/server/simulation/boids.ts`

**Intent**: Make `computePhaseQuality` reward each additional completed
cycle, with diminishing returns, instead of a flat bonus for "at least one."

**Contract**: Replace the `RESILIENCE_BONUS_MULTIPLIER` constant
(`boids.ts:1252`) and the `hasCrashToRecovery` block (`boids.ts:1262-1278`)
with:
- `const RESILIENCE_BONUS_STEP = 0.2;` — per-cycle increment, chosen so 1
  cycle reproduces today's exact `1.2×` magnitude.
- `const RESILIENCE_BONUS_CAP_CYCLES = 3;` — cycles beyond this stop adding
  further bonus (diminishing returns; prevents unbounded reward for
  degenerate endless-crash-cycling runs).
- `computePhaseQuality` calls `countCrashToRecoveryCycles(phaseHistory)`,
  computes `bonusMultiplier = 1 + RESILIENCE_BONUS_STEP * Math.min(cycleCount, RESILIENCE_BONUS_CAP_CYCLES)`,
  and applies `withBonus = average * bonusMultiplier`, keeping the existing
  `Math.max(0, Math.min(1, withBonus))` clamp unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Updated/new tests pass: `npx vitest run src/server/simulation/boids.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- None required — this is a pure function change with no UI, no new wire
  shape, and no DB change; the automated tests (including the new
  multi-cycle test) are the full verification surface. (Consistent with this
  session's own precedent: `rng.ts`'s Phase 1 fix in `full-score-save-resume`
  needed only automated verification for the same reason — pure function,
  no UI/DB surface.)

## Testing Strategy

### Unit Tests (all in `src/server/simulation/boids.test.ts`):

- `countCrashToRecoveryCycles` is not separately exported/tested — it's
  covered indirectly through `computePhaseQuality`'s new test below, matching
  this file's existing convention of not separately testing small private
  helpers that only exist to decompose one exported function (e.g.
  `coefficientOfVariation` is tested only via `computeGeneticDiversity`).
- New test in `describe("computePhaseQuality")`: "rewards two completed
  crash→recovery cycles above exactly one, holding total phase-weight
  average equal" — construct two phase-history arrays with the identical
  flat average (same count of each phase label) but one array has two
  separate crash→recovery pairs and the other has one; assert the
  two-cycle array scores strictly higher.
- New test: "caps the resilience bonus at RESILIENCE_BONUS_CAP_CYCLES cycles"
  — construct an array with more than the cap's worth of crash→recovery
  pairs (all at a low enough average that the `[0,1]` clamp doesn't already
  saturate it) and assert its score equals the score of an array with
  exactly the cap's worth of cycles (same average), proving cycles beyond
  the cap add nothing further.
- Existing 4 tests in `describe("computePhaseQuality")` must continue
  passing unchanged, in particular "rewards a genuine crash-then-recovery
  run above a crash-only run" (exactly 1 cycle, must still show the `1.2×`
  relationship) and "never exceeds 1" (clamp still applies).

### Manual Testing Steps:

1. None — see Manual Verification above.

## Performance Considerations

`countCrashToRecoveryCycles` is a single forward pass, O(n) in
`phaseHistory.length` — strictly cheaper than the nested loop it replaces
(which was O(n²) in the worst case, since `hasCrashToRecovery`'s original
loop nested a second forward scan inside the first on every unconsumed
crash tick, before its early-exit `break`). No regression; a slight
improvement.

## Migration Notes

None — pure in-memory function, no schema, no persisted shape change.

## References

- Roadmap: `context/foundation/roadmap.md` S-09 (phase-quality-per-cycle-scoring), MS-06
- PRD: `context/foundation/prd.md` v2 — FR-019, FR-010 (full)
- Gap confirmed at: `src/server/simulation/boids.ts:1254-1281` (`computePhaseQuality`)
- Callers (unaffected, signature unchanged): `src/server/simulation/server-run-registry.ts` (`tick()`, `stopServerRun`), `src/server/api/routers/simulation.ts` (`stop` resolver)
- Existing tests to preserve: `src/server/simulation/boids.test.ts:1036-1069`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Count-based resilience bonus for computePhaseQuality

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 7f31696
- [x] 1.2 Linting passes: `npm run check` — 7f31696
- [x] 1.3 Updated/new tests pass: `npx vitest run src/server/simulation/boids.test.ts` — 7f31696
- [x] 1.4 Full suite still passes: `npm test` — 7f31696
