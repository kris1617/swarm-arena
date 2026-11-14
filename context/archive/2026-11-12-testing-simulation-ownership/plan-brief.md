# Authorization Regression Coverage — Plan Brief

> Full plan: `context/changes/testing-simulation-ownership/plan.md`
> Research: `context/changes/testing-simulation-ownership/research.md`

## What & Why

This is rollout Phase 3 of `context/foundation/test-plan.md`: close Risk #5 — `simulation.stop`'s cross-user ownership check and the shared `UNAUTHORIZED` auth gate are only manually verified today (basic-flocking-loop's Progress 2.6/2.7). Research confirmed the check's exact location and a real constraint the fix must satisfy: foreign keys are enforced by default, so the negative test needs real fixture rows, not just a fabricated session.

## Starting Point

`simulation.ts`'s `stop` resolver already correctly throws `FORBIDDEN` on cross-user access and `UNAUTHORIZED` flows through shared middleware — nothing is broken. `simulation.test.ts` has one test, designed to never reach the database. No test in this project currently writes to `db.sqlite`.

## Desired End State

`simulation.test.ts` gains four regression tests (cross-user `FORBIDDEN`, owner-succeeds contrast, `UNAUTHORIZED` on `stop`, `UNAUTHORIZED` on `start`) backed by a shared fixture helper with `afterEach` cleanup, plus a `test-plan.md` §6.3 cookbook entry.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fixture cleanup | `afterEach` delete (cascade via owner-user delete) | Keeps `db.sqlite` from accumulating test rows across repeated local runs | Plan (user-confirmed) |
| Contrast test | Add owner-succeeds case alongside `FORBIDDEN` | Proves the check isn't trivially always-`FORBIDDEN` — a real regression the negative test alone wouldn't catch | Plan (user-confirmed) |
| `UNAUTHORIZED` scope | Test both `stop` and `start` | More complete coverage of the shared `protectedProcedure` middleware, even though it's one piece of generic code | Plan (user-confirmed) |
| Fixture construction | Shared local helper (`insertOwnedRunningRun`) | Avoids duplicating the same insert logic across the `FORBIDDEN` and contrast tests | Plan (user-confirmed) |
| File location | Extend existing `simulation.test.ts`, not a new file | Already imports `createCaller`/`db` and establishes the pattern this phase reuses | Plan (research-grounded) |

## Scope

**In scope:**
- Fixture helper inserting a real owner `users` row + `"running"` `simulationRuns` row, with `afterEach` cleanup
- 4 new test cases in `simulation.test.ts`
- `test-plan.md` §6.3 cookbook entry

**Out of scope:**
- Any production code change (the ownership check already works)
- A `simulation.get`/`simulation.list` procedure (none exists)
- A database-isolation harness (transactions/in-memory DB) for the whole suite
- Role-based (`adminProcedure`) access testing — unrelated to this ownership check

## Architecture / Approach

One new local helper in `simulation.test.ts` inserts real FK-satisfying fixture rows (required because `@libsql/client` enforces foreign keys by default); the `UNAUTHORIZED` cases need no fixture at all, since `protectedProcedure`'s middleware rejects them before either resolver runs. Every assertion checks the specific `TRPCError.code`, matching the existing test's own stated convention.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Authorization regression tests | Fixture helper + 4 tests + cookbook entry | Fixture must set `status: "running"` or the earlier `BAD_REQUEST` status check masks the ownership check being tested |

**Prerequisites:** None beyond what's already in the repo.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- The `FORBIDDEN` test's "different caller" session assumes no real `users` row is needed for the attacker — research confirmed `stop`'s resolver never writes anything keyed to the caller's id, only reads `ctx.session.user.id` for the comparison. If a future refactor makes `stop` write anything caller-keyed, this test's fixture would need to grow a second real user row.

## Success Criteria (Summary)

- A future refactor of `trpc.ts` or `simulation.ts` that breaks the ownership check or the shared auth gate will fail a test, not wait for a manual check.
- The owner-succeeds contrast test guards against a regression that makes the check reject everyone, not just attackers.
