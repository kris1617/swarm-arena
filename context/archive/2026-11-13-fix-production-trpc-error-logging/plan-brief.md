# Production error visibility — Plan Brief

> Full plan: `context/changes/fix-production-trpc-error-logging/plan.md`

## What & Why

Fixes the six highest-priority gaps from the observability audit
(`context/audits/observability/2026-11-13_simulation-start-stop.md`): production
tRPC errors leave zero trace in `docker compose logs app`, there's no
client-side error boundary anywhere, three mutation failures are silently
swallowed or unhandled, both RAF tick loops can freeze with no trace, and two
TOCTOU races in `simulation.ts` silently resolve as success instead of
rejecting the losing caller.

## Starting Point

`src/app/api/trpc/[trpc]/route.ts`'s `onError` only fires when
`NODE_ENV === "development"` — confirmed at the `@trpc/server` library source
level to be a plain skip that doesn't affect the client's response, only
server-side visibility. No `error.tsx`, no `instrumentation.ts`, no global
client error handler exist anywhere. `post.create`, single-run `stop`, and
multi-run `stop` each have a gap in their mutation error handling. Both RAF
tick loops have no try/catch. `simulation.ts`'s `stop` and `start` both have
a read-check-then-write race with no affected-row guard.

## Desired End State

Every production failure in this app's main paths leaves a server-side log
line with enough identity (path, user id, run id) to find and diagnose it
without the user having to report it. A client-rendered exception shows a
styled recoverable page instead of a bare digest. A frozen simulation canvas
shows a visible error instead of staying silently stuck. Two concurrent stop
or start calls for the same run/user get a clear rejection instead of a
silent, wrong outcome.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Scope | All 6 of the audit's §6 recommended fixes, not just #1 | User expanded scope explicitly after the initial LOW-complexity (fix #1 only) proposal | Plan |
| `onError`/`instrumentation.ts` overlap | No conflict — don't coordinate them | tRPC's `fetchRequestHandler` always converts thrown errors into a `Response` itself, so `onRequestError` never fires for a tRPC error | Plan (research) |
| `stop` race semantics | Reject the losing caller with `BAD_REQUEST` ("run already stopped") | Keeps the race visible and diagnosable — the entire point of this audit — rather than a friendlier but silent idempotent success | Plan |
| `start` race mechanism | Re-check the running-row count after insert, invalidate the loser | SQLite/libsql has no native partial-unique-on-count constraint; a post-insert re-check works with the actual concurrency model without adding transaction complexity | Plan |
| Root `error.tsx` styling | Styled with this app's existing tokens/components, not plain text | Avoids a jarringly different-looking page from the rest of the app | Plan |
| RAF tick failure UX | Visible "Simulation error: ..." state, same pattern as existing stop-failure display | Consistent with the one error-display convention this app already has | Plan |
| Multi-run scope | Fix both single- and multi-run stop/tick, not single-run only | The multi-run swallowed `onError` (SS-3) was rated critical — worse than the single-run gap it was compared against | Plan |
| Testing approach for races | Pre-stage the race's end state directly via `db.update`/`db.insert`, not literal concurrent threads | Vitest's single-threaded model can't reliably race two overlapping awaits; testing the guard condition is the established correct approach | Plan |

## Scope

**In scope:**
- `onError` wired unconditionally in the tRPC route handler, with an extracted, testable `logTRPCError`
- A styled root `error.tsx`
- `src/instrumentation.ts` with `onRequestError`
- `onError` added to `post.create`, single-run `stop`, and multi-run `stop` mutations
- try/catch around both RAF tick loops with a visible error state
- TOCTOU guards on `simulation.ts`'s `stop` (lost-update) and `start` (cap-bypass)

**Out of scope:**
- An external error tracker (Sentry/etc.) — vendor choice is `/10x-infra-research`'s job
- The audit's lower-priority findings not in the six chosen fixes (SS-5, SS-6, SS-8, SS-10, SS-12, SS-13, SS-14, SS-15, PL-6, PL-7, PL-8)
- `NextAuth`'s swallowed `events.createUser` admin-role failure (PL-2) — library-default behavior, a separate change
- A shared logging/reporting abstraction — each fix uses a plain `console.error`, matching the only existing convention

## Architecture / Approach

No new architecture. Six independent, sequentially-committed phases, ordered
cheapest/highest-blindness-removed first and the two TOCTOU race fixes (the
only phase that changes real write-path behavior, not just adds logging)
last. Each phase extends an existing codebase pattern — the RAF test harness,
the `createCaller`/fixture pattern, the `@trpc/server`-documented `onError`
usage, Next's documented `error.tsx`/`instrumentation.ts` contracts — rather
than inventing new testing infrastructure.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Production tRPC error logging | `logTRPCError`, wired unconditionally | Low — matches the library's own documented pattern |
| 2. Root error boundary | Styled `error.tsx` | Low — cheap, well-documented Next convention |
| 3. instrumentation.ts | `onRequestError` hook | Low — confirmed no overlap with fix #1 |
| 4. Missing onError handlers | Logging on 3 previously-silent/unhandled mutation failures | Low — mechanical, same pattern 3x |
| 5. RAF tick try/catch | Visible error state instead of a frozen canvas, both run modes | Medium — new UI state in two files, needs the extended RAF test pattern done carefully |
| 6. TOCTOU race fixes | Guarded writes on `stop`/`start`, losing caller rejected | Medium-high — the only phase changing real write-path behavior; test strategy proves the guard, not literal concurrency |

**Prerequisites:** none beyond what's already in the repo (test infra, fixtures, and library docs are all already present/verified).
**Estimated effort:** ~6 sessions, one per phase, each independently committable.

## Open Risks & Assumptions

- Phase 6's tests prove the guard condition deterministically, not that a
  real two-request race in production behaves identically — accepted per the
  plan's own testing-strategy rationale (Vitest can't reliably reproduce
  thread-level concurrency).
- Phase 5's multi-run tick catch stops *all* slots on one throw (the shared
  tick call spans every slot) — finer-grained per-slot isolation would be a
  larger architectural change, explicitly out of scope.
- `instrumentation.ts`'s real invocation by Next's server runtime is a
  documented framework contract, verified manually (phase 3), not by an
  automated test that can actually trigger Next's own request lifecycle.

## Success Criteria (Summary)

- A production tRPC error, an RSC-path error, a client-render exception, a
  failed mutation, and a tick exception each leave a findable, structured
  log line where before this plan none of them did.
- A race between two `stop` calls or two `start` calls for the same
  run/user produces a clear rejection for the loser, never a silent wrong
  outcome.
- `npm test`, `npm run typecheck`, and `npm run check` all stay green
  throughout.
