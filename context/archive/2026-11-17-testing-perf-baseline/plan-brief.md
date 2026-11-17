# Reproducible performance baseline — Plan Brief

> Full plan: `context/changes/testing-perf-baseline/plan.md`
> Research: `context/changes/testing-perf-baseline/research.md`

## What & Why

No repeatable, regression-tracked wall-clock performance baseline exists —
every performance number on record (from `vps-resource-capacity-limits`,
`spatial-hash-performance-optimization`, `configurable-area-and-camera-view`)
was a one-time, manual, scratch measurement that no longer survives in the
repo. This is rollout Phase 8 of `context/foundation/test-plan.md`,
building the "reference for further optimization" explicitly requested at
M-9's kickoff.

## Starting Point

`computeSingleRunTick` is pure and synchronous — directly callable in a
loop with no DB/async/router, and its cost is what production actually
pays per tick (DB writes happen only at run-completion milestones).
`pipeline-perf.test.ts` already shows the right population-construction
pattern but is deliberately not a wall-clock benchmark. No benchmark
tooling or committed-results convention exists in this repo yet.

## Desired End State

`npm run perf:baseline` runs a 54-configuration grid (object count × area
× concurrent-run count) at 8 samples each, entirely single-process, and
appends results to a committed JSON file plus a markdown summary. A real
first run has been executed and sanity-checked.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Concurrent-run dimension | Single-process round-robin interleaving of N independent tick states | Node is single-threaded anyway; avoids pulling in Phase 9's heavier real-concurrency scope | Plan (user-confirmed) |
| Parameter grid | Object counts {100,200,300,400,500,1000} × area {200,400,1000} × concurrent-run {1,2,4} = 54 configs | Re-measures the prior curve's known points for comparability, plus the two genuinely new points research flagged as never measured | Plan (user-confirmed) |
| Results format | Committed JSON (`perf-baseline.json`) + markdown summary (`capacity-limits.md`) | JSON is diffable/comparable by future tooling; markdown extends the one real existing precedent | Plan (user-confirmed) |
| Tooling | `tinybench` (new devDependency) | Proper sampling statistics (warmup, variance, percentiles) instead of hand-rolled timing | Plan (user-confirmed) |
| Sample count | N=8 per configuration | Satisfies lessons.md's documented N≥5-10 floor while keeping the large grid's total runtime reasonable | Plan (user-confirmed) |

## Scope

**In scope:** a new benchmark script, a committed results JSON + markdown
summary, an npm script, a real first baseline run, a cookbook entry.

**Out of scope:** driving real concurrent server-owned simulations via the
actual registry/scheduler (Phase 9's job); making this CI-gating; modifying
`pipeline-perf.test.ts`; automating a cross-platform single-process
pre-check inside the script itself (documented as a manual precondition
instead).

## Architecture / Approach

Phase 1 builds the core script (grid construction + tick-driving via direct
`computeSingleRunTick` calls, matching `pipeline-perf.test.ts`'s population
pattern). Phase 2 wires the two output artifacts and the npm script. Phase
3 runs it for real and documents the pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. tinybench + core script | Grid construction, tick-driving, timing stats | Confirming tinybench's exact `iterations`/`time` option shape for a fixed-N, non-time-boxed run |
| 2. Results tracking + npm script | perf-baseline.json + capacity-limits.md summary + npm script | Keeping the two output files in sync on each run |
| 3. First real run + cookbook | Real baseline data; §6.8 cookbook entry; Phase 8 marked complete | Results must look directionally sane against prior one-off numbers |

**Prerequisites:** None.
**Estimated effort:** 3 phases; Phase 1 is the most implementation-heavy, Phases 2-3 are comparatively light.

## Open Risks & Assumptions

- Assumes the 54-config × 8-sample grid's total runtime stays reasonable
  for a manually-invoked, non-CI-gating tool (likely several minutes) —
  if it proves too slow in practice, the grid can be trimmed in a follow-up
  without changing the plan's architecture.
- Assumes Node's native TypeScript support (or a minimal `tsx` addition) is
  sufficient to run the new script without a build step — confirmed during
  Phase 2's npm-script wiring, not before.

## Success Criteria (Summary)

- `npm run perf:baseline` runs the full grid and writes both output files.
- The first real run's numbers are directionally consistent with the two
  known prior facts (cost ↑ with object count; cost ↓ at larger area for a
  fixed count).
- `test-plan.md` §6 gains a reusable cookbook entry; rollout Phase 8 is
  marked `complete`.
