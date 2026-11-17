# Concurrent-load capacity test — Plan Brief

> Full plan: `context/changes/testing-concurrent-load-capacity/plan.md`
> Research: `context/changes/testing-concurrent-load-capacity/research.md`

## What & Why

Rollout Phase 9 of `context/foundation/test-plan.md` (Risk #9): multiple
server-owned simulation runs compete for one CPU core, bounded only by an
admission-time ceiling that's never re-checked once runs are ticking — and
no automated test exercises this today. This change adds a test proving the
real scheduler stays correct under 4-run concurrent load, and specifically
documents that the aggregate ceiling can be exceeded post-admission by
natural population growth.

## Starting Point

`server-run-registry.test.ts` already has a working 2-run concurrent-tick
pattern under `vi.useFakeTimers()` (lines 317-363), but nothing exercises
more than 2 runs or tests capacity/admission behavior. Research confirmed
two separate admission-time-only ceilings (`MAX_PARALLEL_RUNS=4` per-user,
`maxConcurrentObjectCount=150` aggregate) and confirmed the feared
fake-timer hang (documented in this project's `test-plan.md` §6.7) is
router-specific and does not apply to direct registry function calls.

## Desired End State

A new test file proves 4 real server-owned runs tick correctly together
under the actual scheduler (no backlog, leak, or drop), and a second test
proves that reproduction-driven population growth can push the aggregate
object count past the 150 ceiling with nothing re-checking it — documenting
a confirmed, accepted gap rather than reproducing a crash.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| N runs / size | 4 runs @ ~35 objects each (140 total) | Matches the real `MAX_PARALLEL_RUNS` ceiling exactly; sits just under the 150 default | Research + Plan |
| Tick volume | ~5000 fake ms (≈300 ticks) | Research's suggested order of magnitude; long enough for reproduction to matter, still instant wall-clock | Research + Plan |
| Backlog assertion | Compare `elapsedSeconds` across sibling runs | Directly tests the registry's own bookkeeping field; no real OS contention to observe at this layer | Plan |
| Exercise the gap | Yes, as a named Phase 2 scenario | Documents research's most concrete finding as a test artifact, not just prose | Plan |
| File location | New sibling file, not an extension | User's explicit choice over the recommended same-file option; costs a duplicated fixture helper (no cross-test-file import precedent exists) | Plan |
| DB/registry divergence bug | One-line acknowledgment comment only | Documents awareness for a future reader without scope creep | Plan |

## Scope

**In scope:**
- New `server-run-registry-capacity.test.ts` with its own parameterized fixture helper
- 4-run baseline concurrency correctness (backlog/leak/drop)
- Admission-time-ceiling-gap scenario (population growth exceeds the aggregate cap)
- `test-plan.md` §6.9 cookbook entry; §3 Phase 9 marked `complete`

**Out of scope:**
- Fixing the admission-time-ceiling gap (product decision, not this QA rollout's job)
- The unrelated `finishRun` DB/registry divergence bug (`:433-437`) — acknowledged, not fixed or tested
- Real OS-level CPU contention / actual wall-clock timer drift
- Cross-user partitioning (`MAX_PARALLEL_RUNS` is per-user; Risk #9 is about one user's aggregate load)
- Modifying the existing `server-run-registry.test.ts` file

## Architecture / Approach

Two tests in one new file, both driving `server-run-registry.ts`'s real
`setInterval`-based scheduler directly (never through the tRPC router)
under `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` — extending
the existing 2-run precedent to 4 runs, then to a population-growth
scenario that proves the known ceiling gap.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. New test file + baseline concurrency | 4-run no-backlog/leak/drop proof | Round-robin firing-order tolerance must be tight enough to still catch real drift |
| 2. Admission-time-gap scenario + cookbook | Proves the ceiling gap is real; closes out Phase 9 | Reproduction timing to visibly exceed the ceiling may need tuning beyond the Phase 1 tick budget |

**Prerequisites:** None beyond this project's existing Vitest setup.
**Estimated effort:** ~1 session across 2 phases (single new test file, no new infra).

## Open Risks & Assumptions

- The exact fake-time duration needed for reproduction to visibly exceed
  the 150 ceiling in Phase 2 is an estimate (~5000ms, reused from Phase 1)
  — the plan explicitly allows extending it if empirically needed.
- The no-backlog tolerance (Phase 1) must distinguish legitimate
  round-robin ordering noise from genuine drift; this is a judgment call
  made during implementation, not pre-specified to an exact number.

## Success Criteria (Summary)

- 4 concurrent server-owned runs tick correctly together under the real
  scheduler with no detectable backlog, leak, or drop.
- The aggregate `maxConcurrentObjectCount` ceiling is proven, via a real
  test, to be exceedable post-admission by natural population growth —
  not just asserted in research prose.
- `test-plan.md` reflects this as a shipped, documented pattern; rollout
  Phase 9 is `complete`.
