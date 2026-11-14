# Composed Simulation Pipeline Correctness & Determinism — Plan Brief

> Full plan: `context/changes/testing-composed-pipeline-correctness/plan.md`
> Research: `context/changes/testing-composed-pipeline-correctness/research.md`

## What & Why

This is rollout Phase 1 of `context/foundation/test-plan.md`: close the gap between two
confirmed risks — the documented 4-step simulation tick order exists only as untested inline UI
code, and the pipeline's determinism rests on an unenforced array-order tie-break invariant.
Research confirmed both mechanisms concretely (no composing function exists anywhere; strict-`<`
scans resolve ties by array position), so this phase makes the composition explicit, testable,
and shared with the UI.

## Starting Point

`boids.ts` exports four independent pure step functions; nothing composes them except
`simulation-canvas.tsx`'s inline `tick` closure, which has zero tests. `stepPredators` and
`applyPredation` resolve nearest-target ties via plain array-order scans — currently
deterministic by construction, never asserted.

## Desired End State

A new `runTick` export in `boids.ts` is the single source of truth for the documented tick
order; `simulation-canvas.tsx` calls it instead of inlining the sequence; a new
`pipeline.test.ts` proves the order is deterministic, the tie-break is an intentional contract,
contested captures can't double/zero-count, and swapping the order genuinely changes the result.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Shared composition | Extract `runTick` into `boids.ts`; UI imports it | Closes research's flagged gap — a passing test becomes a real guarantee about production behavior, not a parallel untested copy | Plan (user-confirmed) |
| Tie-break handling | Pin as an explicit, tested contract (constructed-tie fixture) | Turns an accidental implementation detail into a guarded invariant — the exact mechanism research found | Plan (user-confirmed) |
| Contested capture | Dedicated test case (2 predators, 1 shared boid) | Directly tests the mechanism research identified, not a generic proxy | Plan (user-confirmed) |
| Determinism assertion scope | Full derived state (boids/predators/foodStock), not just score | Catches a non-determinism bug anywhere in the pipeline, not only where it happens to move the score | Plan (user-confirmed) |
| Test file location | New `src/server/simulation/pipeline.test.ts` | Keeps `boids.test.ts`'s per-function unit tests separate from this phase's integration-style composed tests, matching the project's one-concept-per-file convention | Plan (user-confirmed) |
| Tick count | Fixed 20 ticks | Enough for predator/hunger/predation interaction; mirrors `boids.test.ts`'s existing bounded-loop convergence tests | Plan (user-confirmed) |

## Scope

**In scope:**
- `runTick` export composing the four existing step functions in the documented order
- `pipeline.test.ts`: composed-order determinism, tie-break contract, contested-capture
  invariant, order-matters regression guard
- Wiring `simulation-canvas.tsx` to call `runTick`
- `test-plan.md` §6.1 cookbook entry

**Out of scope:**
- `multi-simulation-stage.tsx` (no predator/hunger/predation logic to compose there)
- Render-loop/RAF-level integration tests (test-plan Risk #4 / rollout Phase 2)
- Perf/timing budget tests (Risk #3 / rollout Phase 4)
- Authorization tests (Risk #5 / rollout Phase 3)
- Any change to simulation constants, formulas, or behavior

## Architecture / Approach

`boids.ts` gains `runTick(state, params)`, a pure composition of its own four existing exports
in the fixed order already documented in code comments. `pipeline.test.ts` exercises `runTick`
(for determinism) and the lower-level `applyPredation`/`stepPredators` directly (for the
tie-break and contested-capture contracts, where a smaller, more precise fixture is clearer).
`simulation-canvas.tsx` then imports `runTick` in place of its four individual step-function
imports, so the tested composition and the production composition are the same function.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract runTick and add composed-pipeline tests | New `runTick` export + `pipeline.test.ts` (4 tests), purely additive | Test fixtures must reproduce the exact tie-break/contested-capture conditions precisely — a near-miss fixture would silently test nothing |
| 2. Wire simulation-canvas.tsx to runTick and update cookbook | Production UI uses `runTick`; `test-plan.md` §6.1 filled in | The refactor must be behavior-preserving — manual verification is the only check that catches a wiring mistake the automated suite can't see |

**Prerequisites:** None beyond what's already in the repo — all four composed functions already exist and are exported.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The order-matters regression guard (Phase 1, test 4) assumes a fixture can be constructed
  where hunger-driven starvation and predation-eligibility coincide on the same tick for the
  same boid — this is derived from the existing constants (`HUNGER_EXTRA_DECAY_RATE`,
  `CAPTURE_RADIUS`) and should be straightforward, but the exact numeric fixture is an
  implementation detail for whoever executes Phase 1.
- Phase 2's manual verification is the only safety net against a wiring mistake in the
  `runTick` call (e.g. swapped argument order) that the automated suite wouldn't catch, since
  `pipeline.test.ts` tests `runTick` directly, not through the component.

## Success Criteria (Summary)

- A future change to the simulation's tick order or composition must edit `runTick` and will
  fail `pipeline.test.ts` if it breaks the documented order, the tie-break contract, or
  determinism.
- `simulation-canvas.tsx` and the test suite share one source of truth for the composed order —
  no more silent drift between "what's tested" and "what the UI runs."
