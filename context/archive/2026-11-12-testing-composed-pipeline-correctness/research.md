---
date: 2026-11-12T17:42:09Z
researcher: Claude (10x-research)
git_commit: 3df47f2d93aa3ecad4960022a4d7c295476baf03
branch: master
repository: swarm-arena (10xdevs)
topic: "Rollout Phase 1 of context/foundation/test-plan.md — Risk #1 (step-order/composition regression) and Risk #2 (end-to-end determinism regression)"
tags: [research, codebase, boids, simulation-engine, determinism, tick-loop]
status: complete
last_updated: 2026-11-12
last_updated_by: Claude (10x-research)
---

# Research: Composed-pipeline correctness & determinism (test-plan Phase 1)

**Date**: 2026-11-12T17:42:09Z
**Researcher**: Claude (10x-research)
**Git Commit**: 3df47f2d93aa3ecad4960022a4d7c295476baf03
**Branch**: master
**Repository**: swarm-arena (10xdevs)

## Research Question

Ground Risk #1 (step-order/composition regression) and Risk #2 (end-to-end determinism regression) from `context/foundation/test-plan.md` §2: where does the simulation's per-tick composition actually live, is the response guidance's assumptions correct, what existing tests cover (or don't), and what is the cheapest test layer for `/10x-plan` to target.

## Summary

Both risks are confirmed real and non-speculative, with one correction each to the test-plan's response guidance:

- **Risk #1 is worse than the plan assumed.** There is no composing function anywhere in the codebase (confirmed by a repo-wide grep of `src/server` returning zero callers of `stepBoids`/`stepPredators`/`applyHunger`/`applyPredation` together — `src/server/simulation/boids.ts:1-566`, full file read). The "fixed order" exists only as inline code inside `simulation-canvas.tsx`'s `tick` closure (`src/app/simulation/_components/simulation-canvas.tsx:201-258`), fused with canvas/DOM/RAF refs, with no automated test touching it (zero `*.test.ts`/`*.test.tsx` files exist under `src/app/`). Worse: the second tick implementation in `multi-simulation-stage.tsx:159-232` does not implement the same order at all — it runs a materially different, simplified pipeline (boids-only; no predators, hunger, or predation) by design, confirmed via its own header comment (`src/app/simulation/multi/_components/multi-simulation-stage.tsx:17-23`) referencing the parallel-sim-switching plan's explicit "duplicated, not shared" decision. §2's wording ("composition regression" implying one shared order that could drift) should be read as: the order is single-sourced in exactly one place today (`simulation-canvas.tsx`), untested, and not shared with the second tick implementation by design — not as two copies of the same logic that could merely drift apart.
- **Risk #2 is a real, concrete mechanism, not a vague worry — but not currently proven broken.** `applyPredation` and `stepPredators` (`src/server/simulation/boids.ts:382-393`, `:472-491`) both pick a nearest target via a strict `<` linear scan over the input array's order, with no secondary tie-break and no sort. This means: (a) an exact distance tie between two boids is resolved by array position, not by any seed-derived rule, and (b) when multiple predators compete for the same boid in one tick, the outer `for (const predator of predators)` loop's order decides who claims it first (`src/server/simulation/boids.ts:489`, `captured.add(nearest)`). Today, for a fixed seed, the `boids`/`predators` array order is itself deterministic (no `.sort()`, no `Math.random()`, no non-seeded reordering exists anywhere in `boids.ts` — confirmed by a full-file read), so the composed pipeline is *currently* deterministic by construction. The risk is that this determinism rests on an **unenforced invariant** (array order stays seed-derived and un-reordered) that nothing currently tests, and any future change (e.g. a spatial-partitioning optimization that sorts boids by position) could silently violate it with no automated check noticing.
- **No existing test covers either gap.** `boids.test.ts` (full file, 567 lines) tests each of the four step functions in isolation — never two of them chained in one test, confirmed by reading every `it(...)` block. `rng.test.ts` tests only the raw RNG primitive, explicitly out of scope per this phase's risk framing. No test anywhere runs the same seed+params through a composed multi-step sequence twice and diffs the result.
- **The cheapest test layer for both risks is the same, and needs no DOM/canvas mocking.** `stepBoids`, `stepPredators`, `applyHunger`, `applyPredation` are all plain exported functions (`src/server/simulation/boids.ts:183,367,433,462`) that a Vitest test can call directly in the documented order — exactly reproducing `simulation-canvas.tsx`'s sequence without touching React, canvas, or RAF. This satisfies both risks' "likely cheapest layer" guidance from §2's Risk Response Guidance table.
- **One residual gap `/10x-plan` should decide on explicitly:** even a passing composed-order test in `src/server/simulation/` only proves the *pure functions*, called in the right order, behave correctly and deterministically. It does not, by itself, prove `simulation-canvas.tsx` actually calls them in that order — the test and the UI wiring remain two independently-maintained copies of "the order" unless the UI imports a shared composed function. Extracting such a function (e.g. a `runTick`-style export from `boids.ts` that both the test and `simulation-canvas.tsx` call) is a design choice for `/10x-plan`, not something research should pre-decide — flagging it here so planning doesn't miss it.

## Detailed Findings

### Simulation engine composition (`src/server/simulation/boids.ts`)

- Exported functions and signatures: `createInitialPopulation(count, rng, maxLifespan)` (`boids.ts:112`), `createInitialPredators(count, rng, maxLifespan)` (`boids.ts:128`), `stepBoids(boids, weights, dtSeconds, predators = [])` (`boids.ts:183`), `stepPredators(predators, boids, dtSeconds)` (`boids.ts:367`), `applyHunger(boids, foodStock, dtSeconds, foodRegenRate)` (`boids.ts:433`), `applyPredation(boids, predators, protectionThreshold)` (`boids.ts:462`), `computeCohesion(boids)` (`boids.ts:526`), `computeScore(cohesionSamples, elapsedTicks)` (`boids.ts:555`).
- No function inside this 566-line file composes more than one of `stepBoids`/`stepPredators`/`applyHunger`/`applyPredation`, confirmed by a full read of the file. A repository-wide grep for these four names outside `boids.ts` and `boids.test.ts` under `src/server/` returned zero matches — nothing in the server tree calls them together.
- `stepPredators`'s nearest-boid search (`boids.ts:382-393`) and `applyPredation`'s nearest-boid-per-predator search (`boids.ts:472-491`) are both plain single-pass linear scans using strict `<` (never `<=`), so the first array element at the minimum distance wins on an exact tie, and `applyPredation`'s outer loop over `predators` resolves contested captures by array order (earlier predator in the array claims the boid via `captured.add(nearest)` at `boids.ts:489`, checked by later predators via `captured.has(boid)` at `boids.ts:476`).
- A full-file scan found zero occurrences of `Math.random()`, zero occurrences of `.sort()`, and no `Map`/object-iteration-order dependency anywhere in `boids.ts`; the only `Set` (`captured`, `boids.ts:471`) is used purely for membership checks, not order-dependent iteration. The RNG (seeded, from `rng.ts`) is consulted only in `createInitialPopulation`/`createInitialPredators` to generate field values, never to permute array order.

### Tick-loop composition (`src/app/simulation/_components/simulation-canvas.tsx` and `.../multi/_components/multi-simulation-stage.tsx`)

- `simulation-canvas.tsx`'s `tick` function (`:201-258`, inside a `useEffect` at `:163`, scheduled via `requestAnimationFrame` at `:257,260`) calls, in this order: `stepBoids(boidsRef.current, weights, dtSeconds, predatorsRef.current)` → `stepPredators(predatorsRef.current, steeredBoids, dtSeconds)` → `applyHunger(steeredBoids, foodStockRef.current, dtSeconds, foodRegenRate)` → `applyPredation(fedBoids, steeredPredators, protectionThreshold)` (`simulation-canvas.tsx:218-239`), preceded by a comment citing the same "Critical Implementation Details" ordering rationale documented in `context/archive/2026-11-11-predator-prey-dynamics/plan.md`. This sequencing is hard-coded inline in the component's closure — not imported from any shared composed function.
- `multi-simulation-stage.tsx`'s `tick` function (`:159-232`, inside a `useEffect` at `:114`) calls, per running slot (loop at `:179-215`), only `stepBoids(runState.boids, slot.weights, dtSeconds)` — no 4th `predators` argument, and `stepPredators`/`applyHunger`/`applyPredation` are neither called nor imported in this file (confirmed via its import list, `:6-11`, and a full-file read). `computeCohesion` is called for scoring purposes only.
- The two tick implementations are not structurally comparable copies of one order — they implement different pipelines by design: single-run mode runs the full 4-stage pipeline, multi-run mode runs a boids-only subset with no predator/hunger/predation concept at all. This is intentional per `multi-simulation-stage.tsx:17-23`'s own header comment, which cites the parallel-sim-switching plan's "deliberately duplicated from (not imported from) simulation-canvas.tsx" decision.
- Neither file extracts its tick composition into a DOM-free, directly-testable function — in both, the step-function calls are fused in the same closure that reads/writes canvas refs (`canvasRef`, `ctx`) and `useRef`-held mutable state (`boidsRef`, `predatorsRef`, `foodStockRef`, etc. in `simulation-canvas.tsx`; a `Map`-based `runStatesRef` plus a tRPC `stopRun.mutate` call in `multi-simulation-stage.tsx`). A Vitest test cannot call "the tick-loop's composition logic" from either component today without mocking `requestAnimationFrame`, a canvas 2D context, and (for the multi-run case) the tRPC mutation.
- `run-slots.ts` (`src/server/simulation/run-slots.ts`, full file read) is confirmed pure and DOM-free: `MAX_PARALLEL_RUNS` (`:26`) and `addSlot`/`setActive`/`markStopped`/`removeSlot` (`:34-101`) each take and return a plain `RunSlotsState` object with no refs, no DOM, no canvas. Not directly relevant to Risk #1/#2 (it has no simulation-stepping logic), but confirmed here because it was in scope for the second research worker and is the pattern this phase's new tests should mirror for testability.

### Existing test coverage

- `boids.test.ts` (567 lines, read fully): every `it(...)` block exercises exactly one of `stepBoids`/`stepPredators`/`applyHunger`/`applyPredation` (some looped repeatedly, e.g. the protection-threshold tests loop `applyPredation` alone 10×). The "flee steering" test passes a `predators` array into `stepBoids` but never calls `stepPredators` itself. No test chains two or more of the four functions in sequence.
- `rng.test.ts` (31 lines, read fully): 3 tests, all against the raw `createRng` primitive only — same-seed repeatability, cross-seed divergence, and a `RangeError` on a non-integer seed. No boids/predation logic touched.
- `run-slots.test.ts` (158 lines, read fully): 11 tests, all against the pure slot-bookkeeping reducers; never calls any of the four simulation step functions.
- Zero `*.test.ts`/`*.test.tsx` files exist anywhere under `src/app/` (confirmed by a direct `find`), so neither tick-loop implementation has any automated coverage today.
- No test anywhere runs the same seed+params through a composed, multi-step sequence twice and asserts the two runs produce identical derived results — full-pipeline determinism (as distinct from the RNG primitive's own determinism, already covered by `rng.test.ts`) is untested.

## Code References

- `src/server/simulation/boids.ts:183` - `stepBoids` export, takes an optional `predators` array (default `[]`)
- `src/server/simulation/boids.ts:367` - `stepPredators` export
- `src/server/simulation/boids.ts:433` - `applyHunger` export
- `src/server/simulation/boids.ts:462` - `applyPredation` export
- `src/server/simulation/boids.ts:382-393` - `stepPredators`'s strict-`<` nearest-boid scan (tie-break by array order)
- `src/server/simulation/boids.ts:472-491` - `applyPredation`'s nested strict-`<` scan and `captured` Set (contested-capture tie-break by `predators` array order)
- `src/app/simulation/_components/simulation-canvas.tsx:201-258` - single-run `tick`, full 4-stage composition inline
- `src/app/simulation/_components/simulation-canvas.tsx:218-239` - exact composed call sequence with ordering rationale comment
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:159-232` - multi-run `tick`, boids-only subset
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:202` - the single `stepBoids` call (no predators arg)
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:17-23` - header comment documenting the intentional non-shared duplication
- `src/server/simulation/run-slots.ts:34-101` - pure, DOM-free reducer pattern to mirror for new tests
- `src/server/simulation/boids.test.ts` (full file) - confirms per-function-only test coverage
- `src/server/simulation/rng.test.ts` (full file) - confirms RNG-primitive-only determinism coverage

## Architecture Insights

- The codebase consistently keeps simulation logic in pure, exported functions (`boids.ts`, `run-slots.ts`) and keeps all framework/DOM concerns (React refs, canvas, RAF, tRPC calls) in the `src/app/` component layer. This pattern is exactly what makes the recommended Phase 1 tests cheap: the pure functions can be composed and asserted on directly, with no need to touch the untested, DOM-fused tick-loop closures.
- The single-run and multi-run tick loops are independently maintained by explicit project decision (not an oversight) — any Phase 1 test should scope itself to the single-run `simulation-canvas.tsx` ordering (where the full 4-stage pipeline and all of Risk #1/#2's concerns actually live) and leave the multi-run loop's lifecycle behavior to test-plan Phase 2 (render-loop lifecycle, Risk #4), which already covers it.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-predator-prey-dynamics/plan.md` - "Critical Implementation Details" section (lines 175-182 of that plan) is the source of the documented fixed order; confirmed its exact wording is echoed verbatim in a comment at `simulation-canvas.tsx:208-214`, but the plan never specified an automated test for the order itself — Phase 1's new tests close that gap.
- `context/archive/2026-11-11-parallel-sim-switching/plan.md` - "What We're NOT Doing" section explicitly chose to duplicate rather than share tick-loop logic between single-run and multi-run surfaces, confirming the divergence found above is by design, not drift.

## Related Research

- None — this is the first `/10x-research` pass for this change folder.

## Open Questions

- Whether `/10x-plan` wants to extract a shared, DOM-free composed-tick function (e.g. `runTick`) that both a new test and `simulation-canvas.tsx` import, closing the residual "test proves the pure composition; UI wiring is still a separate, unverified copy" gap — or accept that gap for this phase and leave it to a future refactor. This is a design decision, not something research resolved.
- Whether Phase 1's determinism test should assert on exact derived values (population count, positions, score) or on a serialized snapshot of full state — a plan-level choice affecting test brittleness, not investigated here since it doesn't change what code to read.
