# Composed Simulation Pipeline Correctness & Determinism Implementation Plan

## Overview

Extract the simulation's per-tick composition (`stepBoids` → `stepPredators` → `applyHunger` →
`applyPredation`) out of `simulation-canvas.tsx`'s inline UI closure into a single exported,
DOM-free `runTick` function in `boids.ts`, then add a dedicated test file proving the composed
order is load-bearing, the array-order tie-break is an intentional contract, contested predator
captures can't double/zero-count, and the full pipeline is deterministic for identical
seed+params. This is rollout Phase 1 of `context/foundation/test-plan.md` (Risk #1:
step-order/composition regression; Risk #2: end-to-end determinism regression).

## Current State Analysis

- `boids.ts` exports four independent pure step functions (`stepBoids`, `stepPredators`,
  `applyHunger`, `applyPredation`) plus `computeCohesion`/`computeScore` — no function in this
  566-line file composes more than one of them, confirmed by a full-file read and a repo-wide
  grep of `src/server` returning zero other callers.
- The only place all four are composed together is `simulation-canvas.tsx`'s `tick` closure
  (`src/app/simulation/_components/simulation-canvas.tsx:211-239`), fused with canvas/DOM/RAF
  refs, with zero automated tests anywhere under `src/app/`.
- `stepPredators` (`boids.ts:382-393`) and `applyPredation` (`boids.ts:462-497`) both resolve
  nearest-target lookups via a strict `<` linear scan over array order — no secondary tie-break,
  no sort. For a fixed seed this is currently deterministic by construction (no `Math.random()`,
  no `.sort()`, no object/Map-iteration dependency exists anywhere in `boids.ts`), but the
  invariant that keeps it so is unenforced and untested.
- `boids.test.ts` (567 lines) tests each of the four step functions in isolation only — no test
  chains two or more in sequence, and no test runs a composed sequence twice from the same seed
  to compare results.

### Key Discoveries:

- `simulation-canvas.tsx:211-217`'s own comment already documents the ordering rationale
  (hunger must run before predation so a starved boid is already removed and can't be captured
  redundantly) — this plan's Phase 1 test 4 is the first automated check of that rationale.
- `multi-simulation-stage.tsx` (the other tick-loop implementation) runs a boids-only subset by
  design and never calls `stepPredators`/`applyHunger`/`applyPredation` at all — it is out of
  scope for `runTick` and untouched by this plan (confirmed via `research.md`).

## Desired End State

`boids.ts` exports a `runTick` function that composes the documented 4-step order and is the
single source of truth for it; `simulation-canvas.tsx` calls `runTick` instead of inlining the
sequence; a new `pipeline.test.ts` proves the composed order is deterministic, the tie-break
behavior is an intentional, tested contract, contested captures resolve to exactly one removal,
and swapping step order measurably changes the outcome (proving the order matters, not just that
it's documented).

**Verification:** `npm run typecheck`, `npm run check`, `npx vitest run` (full suite) all pass;
manually starting a run in the browser behaves identically to before the refactor.

## What We're NOT Doing

- Not touching `multi-simulation-stage.tsx` — it has no predator/hunger/predation logic to
  compose (confirmed in research), so `runTick` doesn't apply there; its own tick-loop lifecycle
  risk is test-plan Risk #4 / rollout Phase 2, not this phase.
- Not adding a render-loop/RAF-level integration test — that's also Risk #4 / rollout Phase 2.
  This phase's tests exercise `runTick` and the lower-level step functions directly, never a real
  `requestAnimationFrame` or canvas context.
- Not changing any simulation constant, formula, or behavior — this is a pure extraction
  (Phase 2) plus new tests (Phase 1); the simulation's actual math is untouched.
- Not adding a perf/timing budget test — that's Risk #3 / rollout Phase 4.
- Not adding authorization tests — that's Risk #5 / rollout Phase 3.

## Implementation Approach

Phase 1 adds `runTick` to `boids.ts` (a straight extraction of the exact call sequence already
in `simulation-canvas.tsx`, so its contract is fixed by that existing code, not invented) and a
new `pipeline.test.ts` exercising it and the lower-level functions it composes. Phase 2 swaps
`simulation-canvas.tsx`'s inline composition for a `runTick` call — a behavior-preserving
refactor — and fills in the `test-plan.md` §6.1 cookbook entry.

## Phase 1: Extract `runTick` and add composed-pipeline tests

### Overview

Add the composed, DOM-free `runTick` function to `boids.ts` and a new test file proving
composition correctness, the tie-break contract, contested-capture handling, and full-pipeline
determinism. Purely additive — `simulation-canvas.tsx` is untouched until Phase 2.

### Changes Required:

#### 1. Composed tick function

**File**: `src/server/simulation/boids.ts`

**Intent**: Give the single-run pipeline one composed, directly-testable entry point for the
documented 4-step order, instead of that order existing only as inline UI code.

**Contract**: Export `runTick(state: { boids: BoidState[]; predators: PredatorState[]; foodStock: number }, params: { weights: FlockWeights; dtSeconds: number; foodRegenRate: number; protectionThreshold: number }): { boids: BoidState[]; predators: PredatorState[]; foodStock: number }`. Composes the existing four exports in the documented fixed order — `stepBoids` (with `state.predators` for flee steering) → `stepPredators` → `applyHunger` → `applyPredation` — and returns `{ boids: <post-predation>, predators: <post-stepPredators>, foodStock: <post-hunger> }`. This must match exactly what `simulation-canvas.tsx`'s current inline sequence computes (`simulation-canvas.tsx:218-239`), since Phase 2 replaces that inline code with a call to this function and must not change behavior.

#### 2. Composed-pipeline test suite

**File**: `src/server/simulation/pipeline.test.ts` (new)

**Intent**: Prove the four risks this phase targets: (a) the composed order is deterministic
end-to-end, not just the RNG primitive; (b) the array-order tie-break in `applyPredation` is an
intentional, documented contract, not an accident; (c) a contested capture (two predators, one
shared target) resolves to exactly one removal; (d) the documented order is load-bearing — a
differently-ordered composition produces a measurably different result for the same input.

**Contract**: Four Vitest cases:

- **Composed-order determinism** — call `runTick` in a loop for 20 ticks twice, from two
  independently-constructed but identical initial states (same seed-derived boid/predator
  arrays, same params); assert the two runs' final `{ boids, predators, foodStock }` are deeply
  equal (`toEqual`). The oracle here is "two runs from identical input produce identical output"
  — a run-twice-compare, the same pattern already used in `boids.test.ts`'s and `rng.test.ts`'s
  existing determinism tests — not a hand-computed expected value.
- **Tie-break contract** — call `applyPredation` directly with two boids placed at exactly the
  same distance from a single predator, both within `CAPTURE_RADIUS`; assert the captured boid
  is specifically the first one in the input array, not the second. The oracle is the documented
  scan rule itself (strict `<`, first-encountered-at-minimum-distance wins, per
  `research.md`'s citation of `boids.ts:472-491`) — the fixture is constructed to exercise that
  exact rule, not copied from running the function first.
- **Contested capture** — call `applyPredation` directly with two predators both within
  `CAPTURE_RADIUS` of one shared boid (the only target in range for either); assert exactly one
  boid is removed (not zero, not two, and no error), locking in the `captured` Set's
  single-claim invariant under predator contention.
- **Order-matters regression guard** — construct a boid whose lifespan will reach exactly `0`
  from `applyHunger`'s extra decay this tick (i.e., it starves and is removed under the
  documented hunger-before-predation order), while also being within `CAPTURE_RADIUS` of a
  predator above the protection threshold. Run the documented order (`applyHunger` then
  `applyPredation`) and assert the boid is absent from the final array via starvation, not
  predation. Then run the same two steps in the swapped order (`applyPredation` then
  `applyHunger`) on a fresh copy of the same input and assert the boid is captured instead —
  proving the order genuinely changes the outcome, not just that it's documented. This directly
  tests the rationale already written in `simulation-canvas.tsx:211-217`'s comment.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New tests pass: `npx vitest run src/server/simulation/pipeline.test.ts`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Wire `simulation-canvas.tsx` to `runTick` and update the cookbook

### Overview

Replace `simulation-canvas.tsx`'s inline 4-call composition with a single `runTick` call —
closing the gap between "the pure composition is tested" and "the UI actually uses that exact
order" — and record the pattern this phase shipped in `test-plan.md` §6.1.

### Changes Required:

#### 1. Tick-loop composition

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Make the UI's tick loop call the same composed function Phase 1 tested, so a
passing `pipeline.test.ts` is a real guarantee about production behavior, not a parallel,
independently-maintained copy of the order.

**Contract**: Replace the inline sequence at `simulation-canvas.tsx:218-239` with:
`const { boids: nextBoids, predators: steeredPredators, foodStock: nextFoodStock } = runTick({ boids: boidsRef.current, predators: predatorsRef.current, foodStock: foodStockRef.current }, { weights, dtSeconds, foodRegenRate, protectionThreshold });`.
Update the import block (`simulation-canvas.tsx:6-17`) to import `runTick` from
`~/server/simulation/boids` in place of `applyHunger`, `applyPredation`, `stepBoids`,
`stepPredators` (keep `computeCohesion`, `createInitialPopulation`, `createInitialPredators`,
and the type imports unchanged — they're still used elsewhere in the file). No other change to
`tick`'s body: the subsequent ref assignments, cohesion sampling, `drawScene` call, and stop
conditions are untouched. This is a pure refactor — behavior must be identical to before.

#### 2. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record the pattern this phase shipped so a future agent adding a similar
composed-pipeline test doesn't start from zero.

**Contract**: Replace §6.1's `TBD — see §3 Phase 1` placeholder with: location
(`src/server/simulation/pipeline.test.ts`), the pattern (compose via an exported `runTick`-style
function shared with the UI; assert determinism via run-twice-compare; pin tie-breaks as
explicit contracts with constructed-tie fixtures rather than leaving them implicit; prove
ordering is load-bearing via a swapped-order contrast test), a reference test name, and the run
command (`npx vitest run src/server/simulation/pipeline.test.ts`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite passes with no regression: `npx vitest run`

#### Manual Verification:

- Starting a run at `/simulation` behaves identically to before the refactor: boids flock,
  predators hunt, hunger/predation still occur, and stopping the run still computes a score —
  confirming the refactor preserved production behavior (the one thing the automated suite
  can't directly prove, since `pipeline.test.ts` exercises `runTick` directly, not the
  component).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- Composed-order determinism (run-twice-compare over 20 ticks).
- Tie-break contract (exact-distance tie resolves to the first array element).
- Contested-capture single-claim invariant (two predators, one shared boid).
- Order-matters regression guard (hunger-before-predation vs. the swapped order produce
  different outcomes for the same constructed input).

### Integration Tests:

- None added this phase — `runTick` itself is the integration surface (composing four
  previously-isolated pure functions); no DOM/canvas/RAF integration is in scope (that's Risk
  #4 / rollout Phase 2 of the test plan).

### Manual Testing Steps:

1. Start a run at `/simulation` with a few predators and a low protection threshold; confirm
   boids flock, predators hunt, and captures/hunger still occur as before the refactor.
2. Stop the run; confirm a score still computes and displays.
3. No regression to the existing manual checks already recorded in
   `context/archive/2026-11-11-predator-prey-dynamics/plan.md`.

## Performance Considerations

None — `runTick` is a direct extraction of existing per-tick work with no added computation;
the new tests run a fixed 20-tick loop with small fixtures, no performance risk.

## Migration Notes

None — no schema or data changes; this is test code plus an internal refactor of an existing
component.

## References

- Research: `context/changes/testing-composed-pipeline-correctness/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risks #1, #2; §3 Phase 1)
- Existing composition (to be replaced in Phase 2): `src/app/simulation/_components/simulation-canvas.tsx:211-239`
- Existing per-function tests (style to match): `src/server/simulation/boids.test.ts`
- Ordering rationale (already documented, now tested): `context/archive/2026-11-11-predator-prey-dynamics/plan.md` ("Critical Implementation Details")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract runTick and add composed-pipeline tests

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — a72258a
- [x] 1.2 Linting passes: `npm run check` — a72258a
- [x] 1.3 New tests pass: `npx vitest run src/server/simulation/pipeline.test.ts` — a72258a
- [x] 1.4 Full suite passes with no regression: `npx vitest run` — a72258a

### Phase 2: Wire simulation-canvas.tsx to runTick and update the cookbook

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite passes with no regression: `npx vitest run`

#### Manual

- [x] 2.4 Starting a run at /simulation behaves identically to before the refactor (flocking, hunting, hunger/predation, score on stop)
