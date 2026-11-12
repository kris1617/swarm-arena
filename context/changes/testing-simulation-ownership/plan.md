# Authorization Regression Coverage Implementation Plan

## Overview

Add regression tests proving `simulation.stop`'s cross-user ownership check throws `FORBIDDEN`, that both `simulation.stop` and `simulation.start` throw `UNAUTHORIZED` without a session, and that the owner's own `stop` call still succeeds (contrast case) — closing Risk #5 of `context/foundation/test-plan.md`, today only manually verified. No production code changes; the ownership check already works correctly.

## Current State Analysis

- `simulation.stop`'s ownership check (`simulation.ts:100-102`) throws `FORBIDDEN` when `run.userId !== ctx.session.user.id`. `UNAUTHORIZED` comes from `protectedProcedure`'s middleware (`trpc.ts:118-127`), shared by both `start` and `stop`.
- `simulation.test.ts`'s one existing test uses `createCaller` with a fabricated session and never reaches the database — its case is designed to fail input validation (`BAD_REQUEST`) before `start`'s resolver body runs.
- `@libsql/client` enforces foreign keys by default against this project's `db.sqlite` (empirically verified: an insert with a non-existent `userId` fails with `SQLITE_CONSTRAINT_FOREIGNKEY`). `simulationRuns.userId` references `users.id` with `onDelete: "cascade"`.

### Key Discoveries:

- This phase's tests will be the first in the project to actually write rows to the shared `db.sqlite` — no existing test does this, since the one DB-adjacent test today is designed to fail before reaching the database.
- Deleting the fixture owner's `users` row in cleanup cascade-deletes its `simulationRuns` row automatically (`onDelete: "cascade"`), so cleanup needs only one delete per test, not two.

## Desired End State

`simulation.test.ts` gains: a shared fixture helper that inserts a real owner `users` row and a real `"running"` `simulationRuns` row (with `afterEach` cleanup via cascade delete); a test proving `stop` throws `FORBIDDEN` for a different caller; a contrast test proving the owner's own `stop` call still succeeds; and two tests proving `stop` and `start` each throw `UNAUTHORIZED` with no session.

**Verification:** `npm run typecheck`, `npm run check`, `npx vitest run src/server/api/routers/simulation.test.ts`, `npx vitest run` (full suite) all pass.

## What We're NOT Doing

- Not changing any production code — the ownership check already works; this phase only adds regression coverage.
- Not adding a `simulation.get`/`simulation.list` procedure or testing one — none exists (confirmed in research).
- Not adding a database-isolation harness (transactions, in-memory DB) for the whole test suite — out of scope; this phase's `afterEach` cleanup is sufficient for the rows it creates.
- Not testing `adminProcedure`/role-based access — `stop`'s check is ownership-based, not role-based; no role logic is touched by this phase.

## Implementation Approach

Extend the existing `simulation.test.ts` in place (not a new file) — it already imports `createCaller`/`db` and establishes the fabricated-session pattern this phase reuses. A new local helper inserts the real fixture rows the `FORBIDDEN` and contrast cases need; the `UNAUTHORIZED` cases need no fixture at all, since they're rejected before either resolver runs.

## Phase 1: Authorization regression tests

### Overview

Add the fixture helper and four new test cases to `simulation.test.ts`, then update the test-plan cookbook.

### Changes Required:

#### 1. Authorization regression tests

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Prove the ownership check and the shared auth middleware behave correctly under both the attack case (`FORBIDDEN`) and the no-session case (`UNAUTHORIZED`), plus a contrast case proving the owner's own call still works — so the `FORBIDDEN` test alone can't pass vacuously if the check were broken to reject everyone.

**Contract**: Add a local async helper, e.g. `insertOwnedRunningRun()`, that: inserts a `users` row (letting `id` default via `crypto.randomUUID()`, matching `schema.ts`'s own default) and a `simulationRuns` row with that id as `userId`, `status: "running"`, and the same kind of placeholder numeric fields `VALID_START_INPUT` already uses; returns `{ ownerId, runId }`. Track inserted owner ids in a module-level array populated by the helper; an `afterEach` deletes each tracked `users` row via `ctx.db.delete(users).where(eq(users.id, ownerId))` (cascade-deletes the matching `simulationRuns` row automatically) and clears the array.

Add a new `describe("simulationRouter.stop authorization", ...)` block with three cases:
- **FORBIDDEN**: call `insertOwnedRunningRun()`, then `caller.simulation.stop({...})` with a `createCaller` session whose `user.id` is a *different* string than `ownerId` (no real `users` row needed for this caller — `stop`'s resolver never writes anything keyed to it). Assert `.rejects.toMatchObject({ code: "FORBIDDEN" })`.
- **Contrast (owner succeeds)**: same fixture, but the caller's session `user.id` equals `ownerId`. Assert the call resolves (not rejects) and returns a `score`.
- **UNAUTHORIZED**: `createCaller` with `session: null`, no fixture needed. Assert `.rejects.toMatchObject({ code: "UNAUTHORIZED" })`.

Add one case to the existing `describe("simulationRouter.start", ...)` block (or a sibling `describe` if clearer): **UNAUTHORIZED** — `createCaller` with `session: null`, call `start` with `VALID_START_INPUT`. Assert `.rejects.toMatchObject({ code: "UNAUTHORIZED" })`.

Every new assertion follows the existing test's own stated convention: assert the specific `TRPCError.code`, never a bare `.rejects.toThrow()`.

#### 2. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record the pattern this phase shipped so a future agent adding an authorization test doesn't rediscover the FK constraint from scratch.

**Contract**: Add a new `### 6.3 Adding an authorization/ownership regression test` entry replacing the `TBD — see §3 Phase 3` placeholder, with: location (`src/server/api/routers/simulation.test.ts`, extending the existing `createCaller` pattern), the pattern (fabricated sessions for the caller; real `users`+resource rows only when the checked procedure reads an existing row — required here because `@libsql/client` enforces foreign keys by default; `afterEach` cleanup via cascade delete; always pair a negative case with a contrast positive case), a reference test name, and the run command.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- N/A — this phase adds integration tests only (see below); no new pure functions.

### Integration Tests:

- `FORBIDDEN` on cross-user `stop`, owner-succeeds contrast, `UNAUTHORIZED` on `stop` with no session, `UNAUTHORIZED` on `start` with no session (4 cases, via `createCaller`).

### Manual Testing Steps:

- None required — this phase is pure test-code addition with no production behavior change; the automated suite is the complete verification.

## Performance Considerations

None — four small inserts/deletes per test run, negligible.

## Migration Notes

None — no schema changes; `db.sqlite` is gitignored/disposable local state, and the new tests clean up their own fixture rows via `afterEach`.

## References

- Research: `context/changes/testing-simulation-ownership/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #5; §3 Phase 3)
- Ownership check: `src/server/api/routers/simulation.ts:100-102`
- Shared auth middleware: `src/server/api/trpc.ts:118-127`
- Existing test pattern to extend: `src/server/api/routers/simulation.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Authorization regression tests

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- [x] 1.4 Full suite passes with no regression: `npx vitest run`
