# Plan Brief: Deduplicate the wasEverX retry-write branches

Full plan: `context/changes/refactor-opportunities-refresh/plan.md`

## What & Why

`server-run-registry.ts` has three structurally identical "retry-write-on-next-tick" blocks, each copy-paste-propagated into the codebase by a separate feature change over time (not a deliberate three-way duplication — confirmed via `git log -S` history). None of the three has a test forcing its DB write to fail and verifying the retry actually happens. This plan characterizes current behavior first (test-first, per the project's refactor discipline), then extracts one shared helper.

This change folder is the 10xArchitect M4L4 artifact: the ranked refactor candidate from `research.md`, taken through to an accepted implementation plan.

## Starting Point

Three hand-copied blocks at `server-run-registry.ts:781-852`, each: fire-and-forget DB write, latch an in-memory flag on success, log-and-swallow + retry-next-tick on failure. Zero test coverage for any of the three (`grep -c` confirms 0 hits in `server-run-registry.test.ts`). An existing `sabotagingDb` fixture in `simulation.test.ts` already does exactly the kind of DB-failure injection these tests need.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Target shape | One shared `latchOnceWithRetry` helper, column name as a restricted union type | Smallest change that removes the duplication; no schema/migration impact |
| Test-first order | Characterize (Phase 1) before extracting (Phase 2) | Mandatory per the refactor discipline — proves current behavior before anything changes |
| Candidate B (client-bundled server code) | Explicitly out of scope this round | Larger, riskier, no evidence of current harm — a future analysis, not "one safe change" today |
| Test consolidation | 3 characterization tests → 1 parameterized test once the helper exists | Avoids the "redundant copies" anti-pattern once all 3 call sites are provably identical |

## Phases

1. **Characterize current behavior** — 3 tests via the existing `sabotagingDb` fixture, against unchanged production code
2. **Extract and swap** — shared helper, 3 call sites swapped, tests re-verified, then consolidated into 1 parameterized test

**Prerequisites**: none beyond what's in the repo today. **Estimated effort**: 2 small phases, well under a session each.

## What We're NOT Doing

- Candidate B (client-bundled server simulation code)
- A guard test for the separately-identified hand-synced tick-composition duplication
- Schema/migration changes
- Adding tests for `camera.ts`/`use-camera.ts`/`startServerRun`'s double-registration guard (test-coverage gaps, not this plan's code-structure target)

## References

- `context/changes/refactor-opportunities-refresh/research.md` (ranked candidates, ast-grep-verified)
- `context/changes/sim-engine-feature-refresh/research.md` (source Technical debt findings)
- `src/server/api/routers/simulation.test.ts:899-930` (the reusable `sabotagingDb` fixture pattern)
