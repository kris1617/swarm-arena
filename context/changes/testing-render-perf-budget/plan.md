# Perf-Budget Guard for Render Usability Implementation Plan

## Overview

Add a scaling-shape test proving the composed simulation pipeline's operation count grows quadratically (not cubically or unboundedly) as both boid and predator count scale together — closing Risk #3 of `context/foundation/test-plan.md`. No production code changes; the pipeline's current complexity is already correct, this phase only guards against a future regression to its growth shape.

## Current State Analysis

- The pipeline's dominant cost terms are all `O(B²)`-or-`O(B·P)`-shaped: `resolveOverlaps` (`boids.ts:151-163`, `B·(B-1)/2`), `stepBoids`'s neighbor scan (`boids.ts:210-236`, `B·(B-1)`), flee-steering (`boids.ts:295-306`, `B·P`), `stepPredators`'s nearest-boid scan (`boids.ts:382-393`, `P·B`), and `applyPredation`'s nested scan (`boids.ts:472-491`, up to `P·B`). Every one of these calls `Math.hypot` unconditionally before any early-exit check inside its loop (confirmed by reading each call site), so call counts are deterministic regardless of the actual (random) positions involved, except `applyPredation`'s count, which is reduced below its `P·B` worst case once a boid is captured and skipped by later predators in the same tick — a bounded reduction, not a different order of growth.
- `FR-018`'s combined cap (`simulation.ts:28`: `boidCount + predatorCount <= 500`) is the product requirement that makes "must not be worse than quadratic" meaningful — if the composed pipeline's growth were cubic or unbounded, this cap would not actually keep the pipeline tractable.
- No test in this project currently measures operation counts or scaling behavior of any kind; this phase introduces that technique for the first time, via a pass-through `vi.spyOn(Math, "hypot")` (no `mockImplementation`, so real computation and real random positions still happen).

### Key Discoveries:

- Because all the dominant terms are products of two quantities that each scale linearly with a shared factor `k` (boid count × `k`, predator count × `k`), scaling both `boidCount` and `predatorCount` by the same factor `k` together makes every dominant term grow by `k²` — the same quadratic prediction holds for the combined-scaling test as it would for a boid-count-only test, so the chosen band (10×–22× for a 4× input increase, centered on the quadratic prediction of 16×) is valid either way.
- `applyPredation`'s early return (`boids.ts:467-469`: `if (boids.length <= protectionThreshold) return boids;`) means the test's fixtures must set `protectionThreshold: 0` in both samples, or that term's cost (and its contribution to the scaling signal) would be skipped entirely.

## Desired End State

A new `src/server/simulation/pipeline-perf.test.ts` calls `runTick` twice — once with 40 boids + 10 predators (total 50), once with 160 boids + 40 predators (total 200, the same 4:1 ratio scaled 4×) — counting `Math.hypot` calls via a pass-through spy, and asserts the growth ratio falls between 10× and 22×. `test-plan.md` §6.4 records the pattern and its known fuzz sources.

**Verification:** `npm run typecheck`, `npm run check`, `npx vitest run src/server/simulation/pipeline-perf.test.ts`, `npx vitest run` (full suite) all pass.

## What We're NOT Doing

- Not asserting an exact operation-count total — that would itself be an oracle-problem violation (the expected value would have to come from reading the implementation, not the product requirement). Only a growth-ratio band is asserted.
- Not using wall-clock timing — explicitly excluded by test-plan.md's own anti-pattern guidance (flaky in CI).
- Not changing any simulation constant, formula, or behavior — this is a pure test addition.
- Not adding a documentation-only control instead of a test — the scaling-shape test was chosen over that alternative (see research.md's Open Questions).

## Implementation Approach

One new test file, `pipeline-perf.test.ts`, sibling to `pipeline.test.ts` (Phase 1's composed-pipeline test file) — same `runTick`-level composition, different concern (growth shape, not correctness/determinism).

## Phase 1: Scaling-shape perf-budget test

### Overview

Add the test and the cookbook entry.

### Changes Required:

#### 1. Scaling-shape perf-budget test

**File**: `src/server/simulation/pipeline-perf.test.ts` (new)

**Intent**: Prove the composed pipeline's operation count grows quadratically (not cubically or unboundedly) as boid and predator count scale together, without asserting an exact total or wall-clock time.

**Contract**: One Vitest case. Build two fixtures via `createInitialPopulation`/`createInitialPredators` (same pattern as `pipeline.test.ts`): sample A — 40 boids, 10 predators (total 50); sample B — 160 boids, 40 predators (total 200, same 4:1 ratio, 4× scale). Both samples use `protectionThreshold: 0` (so `applyPredation`'s scan is reachable in both, not short-circuited) and identical `weights`/`dtSeconds`/`foodRegenRate`. Wrap `vi.spyOn(Math, "hypot")` (no `mockImplementation` — real computation still happens) around one `runTick` call for sample A, record `callCountA`; reset the spy's call count (`mockClear()`); run one `runTick` call for sample B, record `callCountB`. Assert `callCountB / callCountA` is between `10` and `22` (quadratic prediction for a 4× input scale-up is `16×`; the band absorbs the fuzz from `applyPredation`'s capture-dependent skip and the conditional `alignMag`/`cohMag` terms, described in Current State Analysis, without being wide enough to admit a cubic regression's `~64×`). Restore the spy (`mockRestore()`) after the assertion.

#### 2. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record the pattern this phase shipped, including why it's a ratio/band assertion and not an exact count, so a future agent doesn't reintroduce the oracle-problem violation research flagged.

**Contract**: Add a new `### 6.4 Adding a scaling-shape perf-budget test` entry (replacing the `TBD` placeholder for Phase 4, if one exists under that number — otherwise append after §6.3), with: location (`src/server/simulation/pipeline-perf.test.ts`), the pattern (pass-through `vi.spyOn` on a shared primitive, two input samples scaled by a known factor, assert a ratio band derived from the expected Big-O shape — never an exact count), the known fuzz sources (capture-dependent skips, conditional terms), a reference test name, and the run command.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test passes: `npx vitest run src/server/simulation/pipeline-perf.test.ts`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- One scaling-shape test asserting `Math.hypot` call growth falls within a quadratic-shaped band across a 4× combined boid+predator scale-up.

### Integration Tests:

- N/A for this phase.

### Manual Testing Steps:

- None required — this phase is pure test-code addition with no production behavior change; the automated suite is the complete verification.

## Performance Considerations

The test itself runs `runTick` twice at bounded sizes (max 200 total objects) — negligible test-suite runtime cost.

## Migration Notes

None.

## References

- Research: `context/changes/testing-render-perf-budget/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #3; §3 Phase 4)
- Dominant cost terms: `src/server/simulation/boids.ts:151-163,210-236,295-306,382-393,472-491`
- FR-018 cap: `src/server/api/routers/simulation.ts:28`
- Sibling pattern to follow: `src/server/simulation/pipeline.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scaling-shape perf-budget test

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New test passes: `npx vitest run src/server/simulation/pipeline-perf.test.ts`
- [x] 1.4 Full suite passes with no regression: `npx vitest run`
