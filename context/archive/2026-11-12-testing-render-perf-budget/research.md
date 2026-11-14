---
date: 2026-11-12T19:55:09Z
researcher: Claude (10x-research)
git_commit: 7ac9665090b328a34652c30b270d45a3b993ac5e
branch: master
repository: swarm-arena (10xdevs)
topic: "Rollout Phase 4 of context/foundation/test-plan.md — Risk #3 (render/perf freeze at high population)"
tags: [research, codebase, performance, complexity, boids]
status: complete
last_updated: 2026-11-12
last_updated_by: Claude (10x-research)
---

# Research: Perf-budget guard for render usability (test-plan Phase 4)

**Date**: 2026-11-12T19:55:09Z
**Researcher**: Claude (10x-research)
**Git Commit**: 7ac9665090b328a34652c30b270d45a3b993ac5e
**Branch**: master
**Repository**: swarm-arena (10xdevs)

## Research Question

Ground Risk #3 from `context/foundation/test-plan.md` §2 (no automated check that the composed step pipeline stays within a frame-time budget at the FR-018 max object count): what is the pipeline's actual per-tick cost, is a "structural floor" test meaningful for this risk at all, and what is the cheapest non-flaky, non-tautological layer — including an honest assessment of whether a test is the right control here, or whether the response guidance's framing needs correction.

## Summary

- **The composed pipeline's per-tick cost is dominated by two `O(B²)` terms** (`B` = boid count): `stepBoids`'s neighbor-scan inner loop (`boids.ts:210-236`, every boid scans every other boid once, `B·(B-1)` distance computations) and `resolveOverlaps`'s pairwise-correction loop (`boids.ts:151-163`, `B·(B-1)/2` computations, called once per `stepBoids` invocation). All other terms are `O(B)`, `O(P)`, or `O(B·P)` (`P` = predator count) and are smaller at FR-018's boundary (`boidCount + predatorCount ≤ 500`, enforced server-side in `simulation.ts`'s `start` procedure — confirmed in this and prior phases' research): `stepBoids`'s per-boid speed-clamp and flee-steering loop (`B` and `B·P` respectively), `stepPredators`'s nearest-boid scan (`P·B`), `applyPredation`'s nested scan (`P·B` worst case, `0` if `boids.length ≤ protectionThreshold`), `applyHunger` (`O(B)`, no distance math). At the worst case the constraint allows (`B=P=250`), the `O(B²)`/`O(B·P)` terms are `~62,250` (resolveOverlaps) + `~62,250` (neighbor scan) + `~62,500` (flee) + `~62,500` (stepPredators) + `~62,500` (applyPredation) — all roughly the same order, confirming no single term dominates arbitrarily; the pipeline's overall shape is `O(B² + B·P)`, bounded by the existing cap.
- **A test that asserts an exact global operation count is itself an oracle-problem violation, not a clean regression guard.** Every distance computation in this file calls `Math.hypot` (11 call sites total, mapped individually below) — a global `Math.hypot` spy would count calls from *all* of them combined (neighbor scan, `resolveOverlaps`, flee-steering, speed-clamp magnitude checks, predator nearest-scans, predation scan, and `computeCohesion`'s circular-mean/average-distance math). Deriving the "expected" total requires reading every call site's loop structure — i.e., deriving the oracle from the implementation itself, the same anti-pattern the test-plan's own §1 principle #3 and the oracle-problem guidance (lesson from Phase 1) warn against. Any unrelated future change to any of these 11 sites would shift the exact count and force a test update, making the test brittle in a way disconnected from the actual risk (freezing at scale).
- **The response guidance's framing needs a correction, not a rejection**: the real risk this phase should guard is not "is the current `O(B²)` fast enough" (uncountable without wall-clock timing, which the guidance correctly excludes) but "does a future change silently regress the pipeline's *growth shape* beyond the bound FR-018's cap assumes" — e.g., an accidental `O(B³)` introduced by a careless refactor, or a loop that scans an unbounded quantity (all runs in the database, not just the current run's boids) instead of the capped `B`/`P`. This is testable without an exact magic-number assertion: call the pipeline at two different boid counts (e.g. `B=50` and `B=200`, a 4× increase) and assert the growth in operation count falls within a quadratic-shaped band (e.g. between ~12× and ~20× for a 4× input increase — `4²=16`, with slack for the smaller linear/constant terms), rather than an exact total. This catches a regression to cubic (`4³=64×`, far outside the band) or unbounded (count unrelated to `B`, also outside the band) growth, without hardcoding a count derived from reading the current implementation.
- **No existing precedent for this technique in the project** — confirmed by a repo-wide grep: no test file uses `vi.spyOn` for call-counting anywhere; the only `vi.stubGlobal`/`vi.fn()` usage is the render-loop phase's RAF/canvas stubs (a different technique, stubbing behavior, not counting calls through a real implementation). `vi.spyOn(Math, "hypot")` without a `mockImplementation` is a standard, safe Vitest/Jest technique (the spy passes through to the real implementation while recording `.mock.calls`), but this would be this project's first use of it.
- **Alternative control worth weighing**: given the fragility of any call-counting test (even a scaling-shape one still depends on `Math.hypot` remaining the chosen distance primitive across all 11 sites), `/10x-plan` should explicitly decide between (a) the scaling-shape test described above, cheap and automatable but a genuinely new technique for this codebase, or (b) a documentation-only control — recording the `O(B² + B·P)` bound and the FR-018 cap's role in bounding it directly in `boids.ts`'s module comment and/or `test-plan.md`, with no new test, relying on code review to catch an accidental complexity regression instead of an automated check. Both are legitimate responses to a risk whose own response-guidance cell already hints at this tension ("verified structurally... rather than by wall-clock timing" — but structural counting has the oracle-problem cost described above).

## Detailed Findings

### Complexity of each function in the composed pipeline

All 11 `Math.hypot` call sites in `boids.ts`, mapped to their enclosing loop:

| Line | Function | Loop structure | Calls per `runTick` (B boids, P predators) |
|---|---|---|---|
| `:161` | `resolveOverlaps` (called by `stepBoids`) | nested `i<j` over `resolved` (length B) | `B·(B-1)/2` |
| `:217` | `stepBoids` main loop | for each boid, for each other boid | `B·(B-1)` |
| `:265` | `stepBoids` main loop | once per boid, only if `neighborCount > 0` | up to `B` |
| `:275` | `stepBoids` main loop | once per boid, only if `neighborCount > 0` | up to `B` |
| `:299` | `stepBoids` main loop (flee steering) | for each boid, for each predator | `B·P` |
| `:344` | `stepBoids` main loop (speed clamp) | once per boid, unconditional | `B` |
| `:386` | `stepPredators` | for each predator, for each boid | `P·B` |
| `:404` | `stepPredators` (speed clamp) | once per predator, unconditional | `P` |
| `:482` | `applyPredation` | for each predator, for each remaining boid; skipped entirely if `boids.length ≤ protectionThreshold` | up to `P·B`, or `0` |
| `:567` | `circularMean` (called by `computeCohesion`, not `runTick` itself) | once per `circularMean` call (3 calls per `computeCohesion`) | `3` (not B-dependent) |
| `:596` | `computeCohesion`'s `averageDistance` reduce | once per boid | `B` |

`runTick` (`boids.ts:509-546`) itself composes `stepBoids` → `stepPredators` → `applyHunger` → `applyPredation`; `computeCohesion` is called separately by the caller (`single-run-lifecycle.ts`), not inside `runTick`. `applyHunger` (`boids.ts:433-455`) does no distance math — its only loop is a `O(B)` map for the hunger-decay filter.

### FR-018 cap confirmation

- `simulation.ts:28` (confirmed in this and prior phases' research): `start`'s input schema `.refine((input) => input.boidCount + input.predatorCount <= 500, ...)` — server-enforced, not merely client-side.

### Why an exact-count assertion is an oracle-problem violation

- To write `expect(hypotSpy).toHaveBeenCalledTimes(N)` for a specific `N`, the test author must read and sum every call site in the table above — the "expected" value is derived entirely from the implementation under test, not from an independent requirement (the PRD's NFR only says "stays usable... no freezing," which says nothing about an exact operation count). This is the same oracle problem the project's own lessons/Phase-1 work already identified: a test whose expected value comes from reading the code it tests can't fail for the right reason, and locks in whatever the current implementation happens to do — including any already-present inefficiency.
- A **scaling-shape** assertion avoids this: the expected *band* (e.g. "between 12× and 20× growth for a 4× input increase") is derived from the product requirement itself (the algorithm must not be worse than quadratic, because FR-018's cap of 500 is sized assuming quadratic cost stays tractable) — not from counting the current code's exact calls. This is the same class of distinction the project already applies elsewhere (Phase 1's tie-break tests pin a *documented* rule, not a value copied from running the code first).

### Existing test precedent

- Repo-wide grep for `vi.spyOn` across `*.test.ts`/`*.test.tsx`: zero matches. The render-loop lifecycle phase's tests (`simulation-canvas.test.tsx`, `multi-simulation-stage.test.tsx`) use `vi.stubGlobal`/`vi.fn()` to replace `requestAnimationFrame`/`cancelAnimationFrame` entirely (behavior stubbing), not to count calls through a real implementation. `vi.spyOn(Math, "hypot")` with no `mockImplementation` (pass-through spy) would be a new, but standard and safe, technique for this project.
- No test anywhere in the repo currently measures performance, operation counts, or scaling behavior of any kind.

## Code References

- `src/server/simulation/boids.ts:151-163` - `resolveOverlaps`, the pairwise-correction `O(B²)` loop
- `src/server/simulation/boids.ts:210-236` - `stepBoids`'s neighbor-scan `O(B²)` loop
- `src/server/simulation/boids.ts:295-306` - flee-steering `O(B·P)` loop
- `src/server/simulation/boids.ts:382-393` - `stepPredators`'s nearest-boid `O(P·B)` loop
- `src/server/simulation/boids.ts:472-491` - `applyPredation`'s nested `O(P·B)` loop (conditional)
- `src/server/simulation/boids.ts:509-546` - `runTick`, the composed pipeline this risk concerns
- `src/server/api/routers/simulation.ts:28` - FR-018's server-enforced combined cap

## Architecture Insights

- This codebase's established pattern (per-function pure math, no hidden global state) makes a pass-through spy on a shared primitive (`Math.hypot`) a clean enough instrumentation point — there's no need to modify production code to add a counter, unlike if the distance math were split across incompatible helper functions.
- The dominant cost terms (`resolveOverlaps`, `stepBoids`'s neighbor scan) are both `O(B²)` and of comparable magnitude at the FR-018 boundary — no single function needs to be singled out as "the" bottleneck; a scaling-shape test should cover the composed `runTick` call as a whole (matching how Phase 1's tests already treat `runTick` as the unit of composition), not one function in isolation.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-predator-prey-dynamics/plan.md` "Performance Considerations" section already noted the `O(boids × predators)` additional cost from predator logic stays "within the same order of magnitude already proven acceptable in S-01" — this phase's research confirms that assessment was correct in shape, though it was never backed by an automated check.

## Related Research

- None — this is the first `/10x-research` pass for this change folder.

## Open Questions

- Whether `/10x-plan` should implement the scaling-shape `Math.hypot`-spy test (new technique, genuine regression signal, some inherent fragility since it still depends on `Math.hypot` remaining the distance primitive across all sites) or a documentation-only control (zero new test, relies on code review) — research lays out both options with their tradeoffs but does not resolve this; it is a cost×signal judgment call for planning, not something the codebase evidence settles on its own.
- If the scaling-shape test is chosen, the exact boid-count pair to test at (e.g. 50 vs. 200, or 100 vs. 400) and the exact acceptable band width are implementation details for `/10x-plan` to fix, not resolved here.
