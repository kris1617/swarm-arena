---
date: 2026-11-12T18:57:40Z
researcher: Claude (10x-research)
git_commit: 0139b6246fcbb9562421535c5ca2309e28f7a417
branch: master
repository: swarm-arena (10xdevs)
topic: "Rollout Phase 3 of context/foundation/test-plan.md — Risk #5 (authorization/IDOR gap on simulation.stop)"
tags: [research, codebase, trpc, authorization, idor, foreign-keys]
status: complete
last_updated: 2026-11-12
last_updated_by: Claude (10x-research)
---

# Research: Authorization regression coverage (test-plan Phase 3)

**Date**: 2026-11-12T18:57:40Z
**Researcher**: Claude (10x-research)
**Git Commit**: 0139b6246fcbb9562421535c5ca2309e28f7a417
**Branch**: master
**Repository**: swarm-arena (10xdevs)

## Research Question

Ground Risk #5 from `context/foundation/test-plan.md` §2 (authorization/IDOR gap on `simulation.stop`): where does the ownership check live, what does `UNAUTHORIZED` vs. `FORBIDDEN` each require to reach, whether `start` needs the same treatment, and — critically — what database setup a regression test actually needs, since this is the first test in the project that would write real rows to the shared test database.

## Summary

- **The ownership check is exactly where the risk assumed: inside `stop`'s resolver body, not in middleware.** `simulation.ts:100-102`: `if (run.userId !== ctx.session.user.id) { throw new TRPCError({ code: "FORBIDDEN" }); }`. `UNAUTHORIZED` comes from a different layer entirely — `protectedProcedure`'s middleware (`trpc.ts:118-127`), which both `start` and `stop` are built on, throws `UNAUTHORIZED` before either resolver body ever runs if `ctx.session?.user` is falsy.
- **`start` does not need an ownership-style check and none exists** — confirmed by reading the full file (`simulation.ts:14-81`): `start` always inserts a new row with `userId: ctx.session.user.id` (the caller's own id, `simulation.ts:61`), so there is no existing resource whose ownership could be checked. There is no `simulation.get`/`simulation.list` procedure anywhere in the router or the app — `simulationRouter` (`simulation.ts:13-126`) contains exactly two procedures, `start` and `stop`. `stop` is the only procedure in this app with an ownership check to test.
- **Critical correction to the response guidance's implicit DB assumption**: a regression test for `stop`'s `FORBIDDEN` path cannot reuse `simulation.test.ts`'s existing fabricated-session, no-real-DB-row approach. Confirmed empirically: `@libsql/client` enables `PRAGMA foreign_keys = 1` by default against this project's `db.sqlite` (verified via a direct query), and `simulationRuns.userId` has a `references(() => users.id, { onDelete: "cascade" })` foreign key (`schema.ts:94-97`). An attempted insert into `simulation_run` with a `userId` that has no matching row in `user` fails with `SQLITE_CONSTRAINT_FOREIGNKEY` (verified by direct insert against `db.sqlite`), not a type/validation error. This means a `stop`-ownership test genuinely needs a real `users` row for the run's owner before a `simulationRuns` row can be inserted at all — it is not optional plumbing, it is a hard DB constraint. `simulation.test.ts`'s existing test never hits this, because its one case is designed to fail validation (`BAD_REQUEST`) before the resolver ever reaches the database — its own comment (`simulation.test.ts:37-41`) already names this exact FK risk for a different reason (avoiding a false-positive pass), confirming the project is already aware of the constraint, just hasn't needed to satisfy it yet.
- **The `UNAUTHORIZED` case needs no DB setup at all** — it's rejected by `protectedProcedure`'s middleware (`trpc.ts:118-127`) before any resolver or database call, so a `createCaller` with a `session: null`-equivalent context (no `user`) is sufficient, mirroring the cheapness `simulation.test.ts`'s own test already relies on for its validation-only case.
- **The `FORBIDDEN` case needs: two real `users` rows (owner + attacker) and one real `simulationRuns` row owned by the owner**, inserted directly via `ctx.db`/the shared `db` import before calling `stop` as the attacker. This is new ground for this test file — the project's existing DB-touching test was deliberately designed to avoid ever reaching an actual insert.

## Detailed Findings

### Where `UNAUTHORIZED` and `FORBIDDEN` each come from

- `src/server/api/trpc.ts:118-127` — `protectedProcedure`'s middleware: `if (!ctx.session?.user) { throw new TRPCError({ code: "UNAUTHORIZED" }); }`. Both `simulation.start` and `simulation.stop` are built on `protectedProcedure` (`simulation.ts:14`, `simulation.ts:83`), so an unauthenticated call to either throws `UNAUTHORIZED` before the resolver body runs — confirmed by reading `trpc.ts` in full; no other middleware layer exists between `publicProcedure` and `protectedProcedure`/`adminProcedure` (`trpc.ts:110,118,135`).
- `src/server/api/routers/simulation.ts:91-106` — `stop`'s resolver body, read in full: fetches the run by id (`:92-94`), throws `BAD_REQUEST` if it doesn't exist (`:96-98`), throws **`FORBIDDEN`** if `run.userId !== ctx.session.user.id` (`:100-102`), throws `BAD_REQUEST` if the run isn't `"running"` (`:104-106`). The ownership check is a plain resolver-body comparison against a row already fetched from the DB — not a middleware, not a query-level filter.

### `start` does not need (and does not have) an ownership check

- `simulation.ts:33-81`, read in full: every write always uses `ctx.session.user.id` as the new row's `userId` (`:61`). There is no existing-resource lookup in `start` at all — the only pre-write check is the `MAX_PARALLEL_RUNS` running-count guard (`:39-54`), unrelated to ownership.
- No `simulation.get`, `simulation.list`, or any other procedure exists in this router or elsewhere in `src/server/api/` that reads another user's run by id — confirmed by reading `simulation.ts` in full (2 procedures total) and checking `src/server/api/root.ts` for the full router list (not reproduced here, but `simulationRouter` is the only router touching `simulationRuns`). **`stop` is the only ownership-checked procedure in the app today.**

### The foreign-key constraint is real and enforced by default

- `src/server/db/schema.ts:92-97`: `simulationRuns.userId` is `.notNull().references(() => users.id, { onDelete: "cascade" })`.
- Verified empirically against the actual `db.sqlite` used by this project's tests (same file `simulation.test.ts` connects to via `~/server/db`): `PRAGMA foreign_keys` returns `1` (enabled) with no explicit pragma statement anywhere in `src/server/db/index.ts` — `@libsql/client`'s default behavior for this driver/file combination. A direct `INSERT` into `.bootstrap-scaffold_simulation_run` with a `userId` value that has no matching `.bootstrap-scaffold_user` row fails with `SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed`.
- Consequence: any test that needs an actual `simulationRuns` row to exist (as the `FORBIDDEN` case does — `stop` fetches a real row and compares its `userId`) must first insert a real `users` row for that run's owner. `simulation.test.ts`'s existing test (`simulation.test.ts:29-52`, read in full) never encounters this because its single case asserts `BAD_REQUEST` from the combined-cap `.refine()`, which fires during input validation — before `start`'s resolver body (and its DB insert) ever runs. Its own comment (`:37-41`) explicitly names "a downstream DB error (e.g. a missing FK for this fabricated session's userId)" as a known risk to guard against with a specific `code` assertion, not a generic `.rejects.toThrow()` — confirming the project already knows this constraint exists, it just hasn't had to satisfy it yet.

### What each of this phase's two cases needs, concretely

- **`UNAUTHORIZED` (no session)**: no DB setup — `createCaller({ db, headers: new Headers(), session: null })` (or whatever shape represents "no user" for this app's session type) calling `stop` with any input hits `protectedProcedure`'s middleware first and throws before the resolver runs.
- **`FORBIDDEN` (wrong user)**: needs, in order: (1) insert a real `users` row for an "owner" (e.g. via `ctx.db.insert(users).values({...})`, letting `id` default via `crypto.randomUUID()` per `schema.ts:38-41`, or supplying one); (2) insert a real `simulationRuns` row with that owner's id as `userId` and `status: "running"` (so `stop`'s earlier `BAD_REQUEST` status check doesn't fire first and mask the ownership check); (3) call `stop` via `createCaller` with a session representing a *different* user (does not need its own `users` row, since `stop`'s resolver never writes anything keyed to the caller's id — it only reads `ctx.session.user.id` for the comparison at `:100`); (4) assert the rejection's `code` is specifically `"FORBIDDEN"`, matching `simulation.test.ts`'s existing pattern of asserting the exact `TRPCError` code rather than any throw.
- **Cleanup**: this project's test suite has no DB-reset/transaction-rollback harness today (`vitest.config.ts`'s `env` block only sets connection/auth env vars, not an isolation strategy) — `simulation.test.ts`'s existing test never needed one because it never writes. This phase's `FORBIDDEN` test will be the first test in the project to actually insert rows into the shared `db.sqlite`; whether to clean up the inserted `users`/`simulationRuns` rows afterward (e.g. in an `afterEach`) is a design decision for `/10x-plan`, not something this research resolves.

## Code References

- `src/server/api/routers/simulation.ts:100-102` - the ownership check itself (`FORBIDDEN`)
- `src/server/api/routers/simulation.ts:96-98` - `BAD_REQUEST` if the run doesn't exist (fires before the ownership check if the id is wrong, not relevant to this phase but adjacent)
- `src/server/api/routers/simulation.ts:104-106` - `BAD_REQUEST` if the run isn't `"running"` (must be avoided in the FORBIDDEN fixture by setting `status: "running"` on insert)
- `src/server/api/trpc.ts:118-127` - `protectedProcedure`'s middleware (`UNAUTHORIZED` source)
- `src/server/db/schema.ts:37-50` - `users` table (`id` defaults via `crypto.randomUUID()`)
- `src/server/db/schema.ts:92-97` - `simulationRuns` table, the FK that must be satisfied
- `src/server/api/routers/simulation.test.ts:19-27,37-41` - existing fabricated-session pattern and its own comment anticipating the FK risk this phase must now actually handle

## Architecture Insights

- This codebase's `createCaller`-with-fabricated-session pattern (already established in `simulation.test.ts`) is still the right tool for this phase — no new test infrastructure or mocking library is needed, unlike the render-loop lifecycle phase. The only genuinely new element is that this test must perform real `ctx.db.insert` calls to set up fixture rows, which no existing test in this project does yet.
- The ownership check's placement (resolver body, not middleware) is consistent with it being resource-specific (needs the fetched row to compare against) rather than role-specific (which `adminProcedure`'s middleware pattern handles generically for any procedure built on it).

## Historical Context (from prior changes)

- `context/archive/2026-11-10-gate-product-routes/plan.md` Progress items 2.6/2.7 are about `role` assignment (`admin` vs `member` from `ADMIN_EMAILS`), not about `simulation.stop`'s ownership check — this is a different manual-verification gap than Risk #5's actual target. Risk #5's real manual-only precedent is `context/changes/basic-flocking-loop/plan.md`'s Progress items 2.6 ("Calling either procedure without a session throws UNAUTHORIZED") and 2.7 ("Calling simulation.stop on another user's run throws FORBIDDEN") — both checked `[x]` as manually verified, never automated.

## Related Research

- None — this is the first `/10x-research` pass for this change folder.

## Open Questions

- Whether the `FORBIDDEN` test's fixture rows (owner `users` row, `simulationRuns` row) should be cleaned up after the test (e.g. `afterEach` deletes), or left as disposable local-dev data — a design decision for `/10x-plan`, not resolved here. This project's `db.sqlite` is gitignored and already treated as disposable local state (confirmed in the prior rollout phase's manual DB backfill), so either choice is defensible.
- Whether the attacker session in the `FORBIDDEN` case needs its own real `users` row — research concludes **no**, since `stop`'s resolver only reads `ctx.session.user.id` as a plain string comparison (`:100`) and never writes anything keyed to the caller's id, but this is worth `/10x-plan` confirming explicitly since it's the kind of assumption a test author could get wrong without re-reading the resolver closely.
