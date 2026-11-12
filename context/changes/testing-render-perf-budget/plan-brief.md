# Perf-Budget Guard for Render Usability — Plan Brief

> Full plan: `context/changes/testing-render-perf-budget/plan.md`
> Research: `context/changes/testing-render-perf-budget/research.md`

## What & Why

This is rollout Phase 4 of `context/foundation/test-plan.md`: close Risk #3 — no automated check that the composed pipeline stays within a usable frame-time budget at the FR-018 max object count (500). Research found the real risk isn't "is the current cost fast enough" (uncountable without flaky wall-clock timing) but "could a future change silently regress the pipeline's growth shape" — and that a naive exact-count test would itself violate the oracle-problem principle this project already applies elsewhere.

## Starting Point

The pipeline's dominant cost terms (`resolveOverlaps`, `stepBoids`'s neighbor scan, flee-steering, `stepPredators`, `applyPredation`) are all `O(B²)`-or-`O(B·P)`-shaped today, correctly, bounded by FR-018's server-enforced cap. No test in this project measures operation counts or scaling behavior.

## Desired End State

A new test calls `runTick` at two combined boid+predator scales (4× apart) and asserts the `Math.hypot` call-count growth falls within a quadratic-shaped band — catching a future regression to cubic or unbounded growth without asserting a brittle exact total.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test vs. documentation | Scaling-shape test | Catches a real future complexity regression automatically, not just at code-review time | Plan (user-confirmed) |
| Sample pair / band | 50→200 total objects (4×), band 10×–22× | Clear separation between quadratic (~16×) and cubic (~64×) with slack for known fuzz sources | Plan (user-confirmed) |
| Predator scope | Scale boid AND predator count together (4:1 ratio) | More complete coverage of the full composed pipeline — and the quadratic prediction still holds since all dominant terms are products of two linearly-scaling quantities | Plan (user-confirmed) |

## Scope

**In scope:**
- One scaling-shape test in a new `pipeline-perf.test.ts`
- `test-plan.md` §6.4 cookbook entry

**Out of scope:**
- Any production code change
- Exact operation-count assertions (oracle-problem violation)
- Wall-clock timing assertions
- A documentation-only alternative (test was chosen instead)

## Architecture / Approach

A pass-through `vi.spyOn(Math, "hypot")` counts real distance-math calls across two `runTick` invocations at different, proportionally-scaled input sizes. The assertion is a ratio band derived from the Big-O requirement ("must not be worse than quadratic"), not a count derived from reading the implementation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scaling-shape perf-budget test | New test file + cookbook entry | `applyPredation`'s capture-dependent skip and conditional align/cohesion terms introduce some fuzz into the exact ratio — the chosen band (10×–22×) is wide enough to absorb this without being wide enough to admit a real cubic regression |

**Prerequisites:** None beyond what's already in the repo.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- The test's regression-catching power depends on `Math.hypot` remaining the shared distance primitive across all the pipeline's cost terms — if a future refactor replaced it with a different function (e.g. a manual squared-distance comparison avoiding the sqrt), the spy would stop counting those calls and the test would need updating. This is the inherent fragility research flagged; accepted as a reasonable tradeoff for a real regression signal.

## Success Criteria (Summary)

- A future change that accidentally regresses the pipeline's growth shape (e.g. an added unbounded inner loop, or a careless refactor to cubic complexity) will fail this test instead of only surfacing as a production slowdown.
