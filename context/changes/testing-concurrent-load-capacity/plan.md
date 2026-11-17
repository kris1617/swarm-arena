# Concurrent-load capacity test Implementation Plan

## Overview

Add a new integration test file proving that 4 real server-owned simulation
runs — driven through the actual `setInterval`-based scheduler in
`server-run-registry.ts` under `vi.useFakeTimers()`, never through the
tRPC router — tick correctly together with no backlog, leak, or drop, and
specifically document the confirmed gap that the aggregate
`maxConcurrentObjectCount` ceiling is never re-checked once runs are
already ticking. This is rollout Phase 9 of `context/foundation/test-plan.md`
§3.

## Current State Analysis

- `server-run-registry.test.ts` (1,514 lines) already has a working 2-run
  concurrent-tick precedent under `vi.useFakeTimers()` at lines 317-363:
  two `startServerRun(...)` calls followed by one shared
  `await vi.advanceTimersByTimeAsync(...)` call that advances both runs'
  independent `setInterval`s together. No existing test drives more than 2
  simultaneous runs, and none asserts anything about `MAX_PARALLEL_RUNS`,
  admission-time capacity, or aggregate-load correctness — only per-run
  state isolation under concurrent ticking (research.md §6).
- Two separate concurrency ceilings exist, both enforced **only at
  admission** and never re-checked against already-running simulations:
  `MAX_PARALLEL_RUNS = 4` (`src/server/simulation/run-slots.ts:4`,
  per-user, enforced in `simulation.ts`'s `insertRunningSimulation`) and
  `admin_settings.maxConcurrentObjectCount` (default 150,
  `schema.ts:178`, enforced via `assertWithinConcurrentObjectCeiling`,
  `simulation.ts:125-155`, called only from `startServer`/`resume`).
  Population grows mid-run via `reproducePopulation`
  (`boids.ts:1151-1180`), capped only per-run (`populationCap`/
  `maxObjectCount`) — nothing re-validates the aggregate ceiling against
  that growth (research.md §2, confirmed in code).
- The feared fake-timer hang this project's own `test-plan.md` §6.7
  documents is specific to `caller.simulation.*` calls made **through the
  tRPC router**. Calling `server-run-registry.ts`'s own exported
  functions directly does not reproduce it — proven 37 times over in the
  existing test file, including DB-touching functions like `finishRun`
  and `watchServerRun` (research.md §4).
- `getLiveRunState(runId)` (`server-run-registry.ts:149-169`) exposes
  `elapsedSeconds`, `boids`, `predators`, and `foodStock` for a live run —
  everything needed to assert no-backlog (compare `elapsedSeconds` across
  sibling runs) and to observe population growth (`boids.length` +
  `predators.length`) without needing any new instrumentation.
- `insertOwnedRunningRun(seed)` (`server-run-registry.test.ts:52-88`) is a
  private, unexported helper — not importable by a sibling test file. It
  hardcodes `boidCount`/`predatorCount` from a shared `BASE_PARAMS`
  constant rather than accepting them as parameters.

### Key Discoveries:

- `startServerRun({ runId, seed, ...params })` is synchronous and
  DB-free — it only reads already-fetched arguments and starts the
  `setInterval` (`server-run-registry.ts:531-595`, confirmed via
  research.md §1 and §4). The only DB I/O in the scheduler's own code
  path is `finishRun`'s fire-and-forget write on natural completion/error
  (`:419-427`), which the existing double-`advanceTimersByTimeAsync`
  idiom (`:118-119`) lets settle before asserting against the DB row.
- No cross-test-file import precedent exists anywhere in `src/` (confirmed
  via repo-wide grep) — a new sibling test file cannot import
  `insertOwnedRunningRun` from the existing file and must duplicate a
  minimal, parameterized version of it instead.

## Desired End State

A new test file exists proving: (1) 4 concurrent server-owned runs at
~35 objects each tick together for ~5000 fake ms with no run's
`elapsedSeconds` drifting from its siblings, and with clean registry
state (no leaked intervals, no dropped runs) after all 4 stop; and (2) a
named scenario where population growth pushes the aggregate boid+predator
count past the 150 default ceiling post-admission, with the scheduler
continuing to tick all runs correctly regardless (documenting the gap as
a known, accepted characteristic — there is no blocking mechanism to
assert against). `test-plan.md` §6.9 documents the pattern; §3 Phase 9 is
marked `complete`. Verify by: `npx vitest run src/server/simulation/server-run-registry-capacity.test.ts`
passing, plus a full-suite run with no regressions.

## What We're NOT Doing

- Not fixing the confirmed admission-time-ceiling gap — this phase is a
  **test** proving the gap exists and that the scheduler itself stays
  correct regardless, per `test-plan.md`'s own `benchmark (non-CI-gating)`-
  adjacent framing for this rollout; closing the gap (e.g. re-checking
  the aggregate ceiling periodically) is a product decision out of this
  QA-rollout's scope.
- Not touching the already-documented, unrelated `finishRun` DB/registry
  divergence bug (`server-run-registry.ts:433-437` — a DB write failure
  on natural completion leaves the row stuck at `status: "running"` even
  though registry cleanup succeeds). Acknowledged with a one-line code
  comment near the new test if it becomes visible, never tested or
  fixed here.
- Not testing real OS-level CPU contention or actual wall-clock timer
  drift — `vi.useFakeTimers()` advances deterministically with no real
  scheduling jitter to observe. This test proves the registry's own
  bookkeeping (tick counts, `elapsedSeconds`, cleanup) stays correct when
  the scheduler fires on a controlled clock; it does not simulate a
  genuinely overloaded process. Real-world backlog under actual CPU
  contention remains a production-observability concern, not something
  this layer can prove either way.
- Not modifying `server-run-registry.test.ts` itself — the new file is
  fully additive, so the existing 1,514-line file and its 2-run precedent
  stay untouched.
- Not involving a second user — `MAX_PARALLEL_RUNS` is confirmed per-user
  (research.md §2), but Risk #9 as stated is about one user's aggregate
  load on shared CPU, not cross-user partitioning; a second-user
  isolation test would be a different risk, not this one.

## Implementation Approach

Phase 1 adds the new test file with its own minimal, parameterized fixture
helper and proves baseline 4-run concurrent-scheduling correctness (no
backlog/leak/drop). Phase 2 adds a second test in the same file that
specifically engineers the admission-time-gap scenario, then closes out
the rollout phase (cookbook entry + §3 status flip).

## Phase 1: New test file + baseline concurrency scenario

### Overview

Create the new test file with a parameterized fixture helper, and prove
that 4 concurrent server-owned runs tick correctly together under the
real scheduler with no backlog, leak, or drop.

### Changes Required:

#### 1. New test file with parameterized fixture helper

**File**: `src/server/simulation/server-run-registry-capacity.test.ts`
(new)

**Intent**: A sibling file (not an extension of `server-run-registry.test.ts`)
dedicated to aggregate concurrent-load scenarios, importing the same
public functions (`startServerRun`, `stopServerRun`, `getLiveRunState`)
the main file already imports from `~/server/simulation/server-run-registry`.

**Contract**: A duplicated, minimal version of `insertOwnedRunningRun`
(same owner-insert + `simulationRuns` row pattern as
`server-run-registry.test.ts:52-88`), extended to accept
`boidCount`/`predatorCount` as explicit parameters instead of reading
them from a fixed `BASE_PARAMS` constant — this phase needs ~35
combined objects per run (e.g. `boidCount: 28, predatorCount: 7`,
matching this project's existing 80/20 convention from
`perf-baseline.ts`/`pipeline-perf.test.ts`), not the main file's
hardcoded 10/2. Same `trackedOwnerIds`/`activeRunIds` tracking arrays and
`afterEach` cleanup pattern as the main file (own module-level arrays,
not shared/imported — this file's test lifecycle is independent).

#### 2. Baseline 4-run concurrency test

**File**: `src/server/simulation/server-run-registry-capacity.test.ts`

**Intent**: Prove the real scheduler ticks 4 concurrent runs correctly —
the core Risk #9 proof — using the existing 2-run pattern
(`server-run-registry.test.ts:317-363`) extended to 4.

**Contract**:
- `vi.useFakeTimers()`, then 4 `insertOwnedRunningRun(seed, 28, 7)` +
  `startServerRun({ runId, seed, ...params })` calls (4 distinct seeds,
  same `boidCount`/`predatorCount`, aggregate = 4 × 35 = 140, just under
  the 150 default ceiling).
- One shared `await vi.advanceTimersByTimeAsync(5000)` (≈300 ticks at
  `TICK_INTERVAL_MS = 16`) advancing all 4 runs together, followed by the
  existing `await vi.advanceTimersByTimeAsync(0)` flush idiom.
- **No-backlog assertion**: read `getLiveRunState(runId).elapsedSeconds`
  for all 4 runs and assert they are equal to each other (or within a
  tight tolerance reflecting legitimate round-robin ordering within one
  fake-time advance, not real drift) — a run falling behind its siblings
  after an identical fake-time advance is the regression this assertion
  catches.
- **No-leak/no-drop assertion**: after `stopServerRun(runId)` for all 4,
  assert `getLiveRunState(runId)` is `undefined` for all 4 (registry
  entry + interval both cleaned up) — mirrors the existing single-run
  pattern (`server-run-registry.test.ts:121`) across all 4 runs.
- Regression this test catches: a future change to the scheduler (e.g.
  switching from per-run `setInterval` to a shared/batched scheduler,
  or changing how `tick()` reads `Date.now()`) that introduces drift or
  cross-run interference under concurrent load — something only a true
  multi-run test can catch, where the existing 1-2 run tests cannot.
- Edge case covered: uneven round-robin firing order within a single
  `advanceTimersByTimeAsync` call (4 independent intervals registered at
  slightly different real moments during setup) — the assertion
  tolerance must account for this without being so loose it would also
  pass a genuinely drifting run.
- Anti-pattern avoided: no real wall-clock `setTimeout`/sleep anywhere;
  no `createCaller`/tRPC router involvement (direct registry function
  calls only, per research.md §4's confirmed-safe pattern).

### Success Criteria:

#### Automated Verification:

- New test file passes: `npx vitest run src/server/simulation/server-run-registry-capacity.test.ts`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None yet — this phase's own automated test is the verification; no
  separate manual step needed for a backend scheduler test with no UI
  surface.

---

## Phase 2: Admission-time-gap scenario + cookbook update

### Overview

Add a second test specifically exercising the confirmed admission-time
ceiling gap, document the pattern in `test-plan.md` §6, and close out
rollout Phase 9.

### Changes Required:

#### 1. Admission-time-gap scenario

**File**: `src/server/simulation/server-run-registry-capacity.test.ts`

**Intent**: Prove the research's single most concrete finding as an
actual test artifact — the aggregate ceiling is a point-in-time
admission check, not an invariant maintained for already-running runs —
rather than leaving it as prose-only in `research.md`.

**Contract**:
- Start the same 4 runs as Phase 1 (aggregate 140, near the 150
  ceiling), but with `crossbreedingEnabled: true` and a generous
  `foodStockInitial`/`energyThreshold` configuration favorable to
  reproduction (matching this project's existing convention for
  reproduction-friendly test params, e.g. `simulation.test.ts`'s
  behavioral-effects tests).
- Advance fake time far enough (reuse the ~5000ms / ≈300-tick budget
  from Phase 1, extending only if reproduction needs more ticks to
  visibly grow population — confirm empirically while implementing, not
  guessed in advance) for at least one run's `boids.length + predators.length`
  (via `getLiveRunState`) to grow measurably past its starting 35.
- Assert: (a) the aggregate across all 4 runs' live `boids.length +
  predators.length` now exceeds the 150 ceiling (proving the gap is
  real, not merely theoretical), and (b) all 4 runs are still ticking
  correctly afterward — same no-backlog/no-leak assertions as Phase 1,
  confirming the scheduler's own correctness is unaffected by the
  now-exceeded soft ceiling (there is no blocking/throttling mechanism
  to assert triggered — this test documents an accepted gap, not a bug
  with an expected error).
- One-line code comment near this test acknowledging the separate,
  out-of-scope `finishRun` DB/registry divergence bug
  (`server-run-registry.ts:433-437`) exists adjacent to this code path,
  per "What We're NOT Doing" — informational only, no assertion against
  it.
- Regression this test catches: if a future change *does* add aggregate
  re-validation to the tick loop (closing the gap), this test's assertion
  that the ceiling CAN be exceeded would start failing — a signal that
  the gap was closed and this test (and its documentation) need
  revisiting, not a false alarm.
- Anti-pattern avoided: this is not a mirror-implementation test — the
  expected behavior (scheduler keeps working, ceiling is exceedable) is
  asserted from the research's independently-verified reading of the
  code's actual enforcement boundaries, not from re-deriving the same
  value the production code would compute.

#### 2. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Document how to extend this concurrent-load pattern, so a
future session doesn't need to rediscover the duplicated-fixture-helper
decision or the confirmed admission-time gap.

**Contract**: New `### 6.9 Adding a concurrent-load / scheduler-correctness
test` subsection, following the existing `### 6.N` format (Location,
Pattern, Reference, Run command) — naming: the new file's location and
why it's a sibling file rather than an extension of
`server-run-registry.test.ts` (no cross-test-file import precedent in
this repo); the confirmed-safe direct-registry-function pattern (never
`createCaller`/tRPC router, per §6.7's router-specific hang); the
admission-time-ceiling gap as a known, accepted characteristic (not a
bug) that Phase 10 (wall-clock-aware optimization guardrail) or a future
product decision may revisit.

#### 3. Mark rollout Phase 9 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Flip Phase 9's §3 Status cell to `complete` once this plan's
Progress is fully `[x]`.

**Contract**: Edit the `| 9 | Concurrent-load capacity test | ... |` row's
Status cell.

### Success Criteria:

#### Automated Verification:

- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None — this phase's assertions are fully automated; the "gap is real"
  claim is proven by the test itself, not by manual inspection.

---

## Testing Strategy

### Unit Tests:

- None beyond this phase's own new integration tests — see Integration
  Tests below.

### Integration Tests:

- Phase 1: 4-run baseline concurrency (no backlog/leak/drop).
- Phase 2: admission-time-gap scenario (aggregate ceiling exceeded
  post-admission, scheduler stays correct).

### Manual Testing Steps:

- None — this is a backend scheduler/concurrency test with no UI
  surface; both phases' assertions are fully automated.

## References

- Research: `context/changes/testing-concurrent-load-capacity/research.md`
- Existing 2-run precedent: `src/server/simulation/server-run-registry.test.ts:317-363`
- Existing single-run pattern + double-flush idiom: `src/server/simulation/server-run-registry.test.ts:106-162`
- Rollout phase definition: `context/foundation/test-plan.md` §3, Phase 9
- Phase 8 cookbook precedent (format to follow for §6.9): `context/foundation/test-plan.md` §6.8

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: New test file + baseline concurrency scenario

#### Automated

- [x] 1.1 New test file passes: `npx vitest run src/server/simulation/server-run-registry-capacity.test.ts`
- [x] 1.2 Typecheck passes: `npm run typecheck`
- [x] 1.3 Lint passes: `npm run check`

### Phase 2: Admission-time-gap scenario + cookbook update

#### Automated

- [ ] 2.1 Full suite still passes: `npm test`
- [ ] 2.2 Typecheck passes: `npm run typecheck`
- [ ] 2.3 Lint passes: `npm run check`
