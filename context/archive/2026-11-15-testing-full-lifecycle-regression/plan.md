# Full User-Journey Regression Test Implementation Plan

## Overview

Add one new integration-level test that drives `simulationRouter` through
the real cross-procedure user journey — start a client-staged run, start a
server-owned run, pause it, resume it, finish both, list them, compare
them (FR-016's 2-4-run comparison), then delete the test data and verify
every list-returning procedure reports empty for that user again. No
production code changes.

## Current State Analysis

- `src/server/api/routers/simulation.test.ts` has 12 `describe` blocks,
  each testing one procedure's input validation, authorization, and
  edge-case behavior against fixture rows it inserts directly with
  `db.insert(simulationRuns)` — none of them chain real mutations end to
  end (e.g. no test calls `start` and then feeds that exact `runId` into
  `stop` and then into `getRunsComparison`).
- `savePause`/`resume` only operate on server-owned runs (an
  `isServerRunActive` registry entry from `startServer`); the plain
  `start`/`stop` path has no pause concept — this is real product shape,
  not a gap to fix.
- A server-owned run's tick loop runs on a real `setInterval`
  (`TICK_INTERVAL_MS = 16`, `src/server/simulation/server-run-registry.ts`).
  `server-run-registry.test.ts` already establishes the pattern for
  deterministic, non-flaky control of this: `vi.useFakeTimers()` +
  `await vi.advanceTimersByTimeAsync(ms)`, restoring real timers
  afterward so other test files in the same worker are unaffected.
- `stop` explicitly rejects a server-owned active run
  (`"Run is server-owned — use savePause instead of stop"`) — a
  server-owned run only reaches `"stopped"` by natural completion
  (duration elapsed or population wipe), which the tick loop drives via
  `finishRun`. Advancing fake time past `maxDurationSeconds` reproduces
  that naturally, with no direct call to an internal (non-tRPC) function
  needed.
- There is no `delete`/cleanup procedure anywhere in `simulationRouter` or
  any other router — "delete my test data" is implemented the same way
  every existing test's `afterEach` already does it: `db.delete(users)`
  on the fixture owner, which cascades to `simulationRuns` via its
  `onDelete: "cascade"` FK. This is not a missing feature; it is the
  correct test-cleanup pattern already established in this file.

### Key Discoveries:

- `getRunsComparison`'s per-row `breakdown` is non-null only when
  `history.elapsedSeconds` is present — both the client-staged `stop` path
  and the server-owned natural-completion path write this field
  (`compare-runs-side-by-side` Phase 1), so both runs in this test should
  surface a real breakdown, not an `error` marker.
- `computeResourceManagement([])` returns `0` (no throw), so a
  server-owned run advanced by only a few fake-timer ticks before being
  paused is safe even with small sample arrays.

## Desired End State

A new `describe("simulationRouter full lifecycle regression", ...)` block
in `src/server/api/routers/simulation.test.ts`, after the existing
`getParameterRanges`/`savePause`/`resume` blocks, with one `it` that
performs the full journey and asserts an empty dashboard at the end.

**Verification:** `npm run typecheck`, `npm run check`, `npx vitest run
src/server/api/routers/simulation.test.ts`, `npx vitest run` (full suite)
all pass.

## What We're NOT Doing

- Not adding a `delete`/cleanup tRPC procedure — none exists in the
  product today, and inventing one would be outside the task's "don't
  invent features" instruction. Test cleanup uses the same direct-DB
  pattern every other test in this file already uses.
- Not adding Playwright/E2E coverage for this flow — no E2E setup exists
  in this repo yet (`/10x-e2e-setup` has not been run: `playwright.config.ts`
  exists but there is no `tests/e2e/` directory and no seed test), and the
  router/`createCaller` layer already gives real signal on every procedure
  in the chain (start, pause, resume, stop, list, compare) without that
  setup cost. Flagged as a follow-up, not attempted here.
- Not promoting this into `context/foundation/test-plan.md` §3 as a named
  rollout phase — that is `/10x-test-plan --refresh`'s call (Lesson 1),
  not this change's. `change.md` records the gap for that future refresh.
- Not changing any simulation formula, router behavior, or schema.

## Implementation Approach

One new `describe` block, one `it`, appended to the existing router test
file (this repo's established "tests live beside the code they cover"
convention — one file per router, not a new file for a cross-cutting
scenario on the same router).

## Phase 1: Full lifecycle regression test

### Changes Required:

#### 1. Full lifecycle test

**File**: `src/server/api/routers/simulation.test.ts`

**Contract**: New `describe` block, fake timers scoped to its own `it`
(set up and torn down inside the test, or via a block-local
`afterEach(() => vi.useRealTimers())`, so no other test in the file is
affected). Steps, each with a real assertion (not just "did not throw"):

1. Insert a fixture owner user; build a `createCaller` session for them.
2. `start` a client-staged run (`runIdA`). Assert it appears in
   `listRunning`.
3. `startServer` a second, server-owned run (`runIdB`,
   `maxDurationSeconds: 1`). Assert `isServerRunActive(runIdB)` and that it
   appears in `listRunning` alongside `runIdA`.
4. Advance fake time by a few ticks (e.g. 64ms). `savePause({runId:
   runIdB})`. Assert the row's status is `"saved"`, it appears in
   `listSaved`, and it no longer appears in `listRunning`.
5. `resume({runId: runIdB})`. Assert status is back to `"running"`,
   `isServerRunActive(runIdB)` is true again, and it is back in
   `listRunning`, not `listSaved`.
6. Advance fake time past `maxDurationSeconds` (e.g. 1200ms) so run B
   finishes naturally via the tick loop. Assert its row reaches
   `"stopped"` with a non-null `score` (poll/await, since `finishRun` is
   fire-and-forget off the tick callback — flush with a trailing
   `await vi.advanceTimersByTimeAsync(0)`).
7. `stop` run A with representative sample arrays. Assert a numeric
   `score` comes back and the row is `"stopped"`.
8. `listCompleted` and `listLeaderboard` both return exactly these two
   runs for this user.
9. `getRunsComparison({runIds: [runIdA, runIdB]})` returns two rows,
   neither carrying an `error` field, each with a non-null `breakdown`.
10. Delete the fixture owner (`db.delete(users).where(eq(users.id,
    ownerId))`) — cascades to both `simulationRuns` rows.
11. Re-run `listRunning`, `listSaved`, `listCompleted`, `listLeaderboard`
    with the same (now-orphaned) session — all four must return `[]`,
    proving the "finish clean / empty dashboard" requirement.
12. Restore real timers.

#### 2. Cookbook note (optional, recorded only if time allows)

Not required by `test-plan.md`'s §6 (this change isn't a named rollout
phase) — skipped. `change.md`'s Notes already records the gap for a
future `--refresh` to consider.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] New test passes: `npx vitest run src/server/api/routers/simulation.test.ts`
- [ ] Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human.
This is the final phase (per the orchestrating session's explicit
"perform manual verification yourself" preference, a human checkpoint is
still named per `/10x-implement` convention, but the top-level session may
waive it).

---

## Testing Strategy

### Unit Tests:

N/A — this change adds only an integration-level test.

### Integration Tests:

- One full-journey test as specified in Phase 1.

### Manual Testing Steps:

None required — the automated test is the complete verification of the
described scenario.

## Performance Considerations

Uses fake timers for the server-run tick loop — no real wall-clock delay,
negligible suite runtime impact.

## Migration Notes

None.

## References

- Router under test: `src/server/api/routers/simulation.ts`
- Registry (pause/resume/finish mechanics): `src/server/simulation/server-run-registry.ts`
- Fake-timer pattern precedent: `src/server/simulation/server-run-registry.test.ts`
- Cascade-delete cleanup precedent: `src/server/api/routers/simulation.test.ts`'s existing `afterEach`
- PRD FR-016 (bounded 2-4-run comparison): `context/foundation/prd.md`
- Test plan (for future `--refresh` consideration): `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Full lifecycle regression test

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — ae40d6b
- [x] 1.2 Linting passes: `npm run check` — ae40d6b
- [x] 1.3 New test passes: `npx vitest run src/server/api/routers/simulation.test.ts` — ae40d6b
- [x] 1.4 Full suite passes with no regression: `npx vitest run` — ae40d6b
