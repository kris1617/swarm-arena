# Production error visibility — Implementation Plan

## Overview

Fixes the six highest-priority gaps from the observability audit
(`context/audits/observability/2026-11-13_simulation-start-stop.md`): production
tRPC errors leave zero trace, there's no client-side error boundary anywhere,
several mutation failures are silently swallowed, and two TOCTOU races in
`simulation.ts` resolve as ordinary-looking success. Test-driven per this
lesson's hard rule — each fix gets a red test before the code that makes it
green, wherever the fix is testable at all.

## Current State Analysis

- `src/app/api/trpc/[trpc]/route.ts:24-31` — `onError` only fires when
  `NODE_ENV === "development"`; confirmed at the `@trpc/server` source level
  (`procedure.ts:114-120`, `resolveResponse.ts`) that this is a plain skip via
  optional chaining — the client still gets a correct error response.
- No `src/app/error.tsx`, no `src/instrumentation.ts`, no client-side global
  error handler anywhere in `src/` (audit report §2, confirmed by `find`/grep).
- `src/app/_components/post.tsx:12-16` — `createPost.useMutation` has only
  `onSuccess`.
- `src/app/simulation/_components/simulation-canvas.tsx:163,194-201,254-261` —
  `stopRun = api.simulation.stop.useMutation()` has no error callback at all;
  the RAF `tick` function (`:204-238`) has no try/catch.
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:137-142` —
  `stopSlot`'s `onError` discards the error object entirely; its `tick`
  function (`:147-181`) also has no try/catch.
- `src/server/api/routers/simulation.ts` — `stop` (`:92-122`) reads
  `run.status`, checks it's `"running"`, then updates by `id` alone with the
  result never inspected (TOCTOU: a second concurrent stop can silently
  overwrite the first's score). `start` (`:39-74`) counts running rows, then
  inserts, with no re-check (TOCTOU: two concurrent starts can both pass the
  cap check).

### Key Discoveries:

- `src/app/simulation/_components/simulation-canvas.test.tsx` and
  `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`
  already establish the exact test pattern this plan needs for the RAF fixes:
  `@vitest-environment happy-dom`, `vi.mock("~/trpc/react")`, a captured
  `requestAnimationFrame` callback driven manually, a fake 2D canvas context.
  No new testing infrastructure is needed.
- `src/server/api/routers/simulation.test.ts` already establishes the pattern
  for the race tests: `createCaller` with a fabricated session, an
  `insertOwnedRunningRun()` helper inserting a real `users` + `simulationRuns`
  row (required because `@libsql/client` enforces foreign keys).
- `@trpc/server`'s own shipped docs
  (`node_modules/@trpc/server/skills/error-handling/SKILL.md:157-175`) show
  `onError` wired unconditionally as the standard pattern — this plan's fix #1
  matches the library's own intended usage, not a workaround.
- Next's `instrumentation.ts` `onRequestError` contract (confirmed against
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`,
  since this project's Next version may differ from training-data
  assumptions per `AGENTS.md`): stable since v15, no config flag needed, goes
  in `src/instrumentation.ts` (this project uses a `src` folder). tRPC's
  `fetchRequestHandler` always converts a thrown error into a `Response`
  itself — it never re-throws into Next's own Route Handler exception path —
  so `onRequestError` will never fire for a tRPC error and cannot double-log
  with fix #1's `logTRPCError`.

## Desired End State

Every production failure in this app's main paths leaves a server-side trace
with enough identity to find it: tRPC procedure errors (any router), RSC/
middleware errors outside the tRPC path, client-rendered exceptions, and the
specific mutation/tick failures the audit named. The two TOCTOU races reject
their losing caller with a clear error instead of silently resolving as
success.

**Verification:** `docker compose logs app`-equivalent (a local production
build) shows a structured log line for each of these failure classes when
deliberately triggered; `npm test` is green; the two race fixes have tests
that deterministically exercise the guard condition.

## What We're NOT Doing

- No external error tracker (Sentry/Datadog/etc.) — this plan only ensures
  the application code hands a failure *something* to log; choosing a vendor
  is `/10x-infra-research`'s job, not this lesson's.
- Not fixing the audit's lower-priority findings not covered by the six
  chosen fixes: SS-5/SS-6 (generic error codes/messages on `stop`'s
  not-found/not-running cases and `start`'s insert failure), SS-8/SS-10 (the
  timing middleware's lack of identity — closed incidentally by fix #1 for
  the `onError` path, but the timing log itself is untouched), SS-12
  (`elapsedTicks` clamping goes unlogged), SS-13/SS-14/SS-15 (low severity),
  PL-6/PL-7/PL-8 (low severity). These stay candidates for a future change.
- Not touching `src/app/simulation/kitchen-sink/page.tsx` — confirmed it
  doesn't use the `stop` mutation or a RAF tick loop of its own.
- Not adding a shared `reportError`/logging abstraction across client and
  server — each fix uses a plain `console.error` at its own call site,
  matching the only existing convention in this codebase.

## Implementation Approach

Six phases, ordered cheapest/highest-blindness-removed first, riskiest
(the two TOCTOU races, which change real write-path behavior) last — mirrors
the audit's own §6 fix order. Each phase is independently testable and
independently committable; later phases don't depend on earlier ones except
phase 1's extracted `logTRPCError` pattern (dev-only `console.error` →
always-on, structured) being the template phase 4 follows for the client-side
`onError` handlers.

## Phase 1: Production tRPC error logging

### Overview

Makes the only existing server-side error-capture boundary fire unconditionally,
with enough identity to correlate a log line to a run/user.

### Changes Required:

#### 1. Extract a testable, always-on error logger

**File**: `src/server/api/trpc.ts`

**Intent**: The current `onError` callback is an inline anonymous arrow inside
`route.ts`'s config object — not independently testable, and dev-gated.
Extract it as a named export next to this file's other cross-cutting tRPC
plumbing (`timingMiddleware`), so it can be unit-tested directly and reused.

**Contract**: export `logTRPCError(opts: { path: string | undefined; error: TRPCError; ctx: Awaited<ReturnType<typeof createTRPCContext>> | undefined }): void`.
Logs via `console.error` the path, the full `error` object (not `.message` —
this is what the audit flagged as `identity-lost` even in the dev-only
version), and `ctx?.session?.user?.id` when present. Must not throw when
`ctx` is `undefined` (context creation itself failed) or `ctx.session` is
`null` (an unauthenticated request).

#### 2. Wire it unconditionally

**File**: `src/app/api/trpc/[trpc]/route.ts`

**Intent**: Remove the `NODE_ENV === "development"` gate — per the audit and
`@trpc/server`'s own documented pattern, the dev/prod split should control
verbosity/formatting, never whether logging happens at all.

**Contract**: `onError: logTRPCError` (imported from `~/server/api/trpc`),
replacing the ternary.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/server/api/trpc.test.ts` passes, covering: logs error +
  path + user id with an authenticated `ctx`; logs error + path without
  throwing when `ctx` is `undefined`; logs without a user id (no throw) when
  `ctx.session` is `null`
- `npm test` passes (no regressions)

#### Manual Verification:

- Against a local production build (`npm run build && node
  .next/standalone/server.js`, matching `playwright.config.ts`'s webServer),
  trigger a real tRPC error (e.g. call `simulation.stop` with a non-existent
  `runId` while signed in) and confirm the terminal shows the structured log
  line with path, error, and user id — where before this phase it showed
  nothing.

---

## Phase 2: Root error boundary

### Overview

Gives users something besides Next's generic digest-only page when a
client-rendered exception occurs, and logs it.

### Changes Required:

#### 1. Add a styled root error boundary

**File**: `src/app/error.tsx` (new)

**Intent**: Catch client-rendered exceptions at the root of the route tree,
log them, and offer a way back in instead of a dead end — styled consistently
with the rest of the app rather than plain text.

**Contract**: `"use client"` default export matching Next's documented
`error.tsx` signature, `({ error, reset }: { error: Error & { digest?: string }; reset: () => void })`.
Logs via `useEffect(() => console.error(error), [error])`. Renders using this
app's existing gradient-background `<main>` pattern (e.g.
`src/app/simulation/page.tsx`'s `className="from-primary to-background ..."`)
and the shared `Button` component (`~/components/ui/button`) wired to call
`reset()`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/app/error.test.tsx` passes (new, `happy-dom`, same
  pattern as `simulation-canvas.test.tsx`): renders the component with a fake
  `Error` and a `reset` spy; asserts `console.error` was called with that
  error; asserts the reset button is present and calling it invokes `reset`
- `npm test` passes

#### Manual Verification:

- Temporarily throw inside a client component reachable from `/`, confirm the
  styled error page renders (not Next's generic one) with a working reset
  button, then revert the deliberate throw.

---

## Phase 3: `instrumentation.ts`

### Overview

Adds Next's purpose-built `onRequestError` hook so RSC/Route Handler/
middleware errors outside the tRPC path get a code-controlled, correlatable
log line instead of relying only on Next's unrelated default stdout logging.

### Changes Required:

#### 1. Add the instrumentation hook

**File**: `src/instrumentation.ts` (new)

**Intent**: Give every error Next's request lifecycle sees (that tRPC hasn't
already absorbed — see Current State Analysis) a structured log line with
route context. No `register()` export is needed; this project has no OTel/
tracer to initialize.

**Contract**: `export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => { ... }` (type imported from `next`).
Logs via `console.error` the error, `request.path`, `context.routePath`, and
`context.routeType`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/instrumentation.test.ts` passes (new): calls
  `onRequestError` directly with a fake error/request/context, asserts
  `console.error` was called including the error, path, and route context —
  this tests the function's own logic; that Next actually invokes it on a
  real request is a documented framework contract, verified manually below
- `npm test` passes

#### Manual Verification:

- Against a local production build, temporarily throw inside a Server
  Component outside the tRPC path, confirm the instrumentation log line
  appears (alongside Next's own default log), then revert the deliberate
  throw.

---

## Phase 4: Missing `onError` handlers

### Overview

Closes the three mutation-failure gaps the audit found: `post.create` has no
error handling at all, and both the single-run and multi-run `stop` mutations
either have none or discard the error object.

### Changes Required:

#### 1. `post.create`

**File**: `src/app/_components/post.tsx`

**Intent**: A failed post creation currently leaves nothing anywhere — not
even a console line. Log it.

**Contract**: add `onError: (error) => console.error(\`post.create failed: ${error.message}\`, error)` to the existing `createPost.useMutation({...})` options object, alongside the existing `onSuccess`.

#### 2. Single-run stop

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: `stopRun.error.message` is already shown to the user (existing
behavior, unchanged); add the missing server-side-equivalent trace so a
responder can find this without the user reporting it.

**Contract**: add `onError: (error, variables) => console.error(\`simulation.stop failed for run ${variables.runId}: ${error.message}\`, error)` to `api.simulation.stop.useMutation({...})`'s definition (currently called with no options) — applies to both the manual-stop and auto-stop-on-duration call sites, since both share this one mutation instance.

#### 3. Multi-run stop

**File**: `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

**Intent**: `stopSlot`'s existing `onError` (`:137-142`) already handles the
UI state correctly (force-finishing the slot) but discards the error object
entirely — this was the audit's highest-severity finding in this cluster
(SS-3, critical).

**Contract**: add `console.error(\`simulation.stop failed for run ${slot.runId}: ${error.message}\`, error)` as the first line of the existing `onError` callback, before its current body. The callback's parameter list gains `error` (currently unused/omitted).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/app/_components/post.test.tsx` passes (new, `happy-dom`):
  mocks `api.post.create.useMutation` to invoke its `onError` with a fake
  error, asserts `console.error` was called
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` passes, extended with a case asserting `stopRun`'s `onError` logs with the run id
- `npx vitest run src/app/simulation/multi/_components/multi-simulation-stage.test.tsx` passes, extended with a case asserting `stopSlot`'s `onError` now logs the error before force-finishing the slot
- `npm test` passes

(No manual verification — these are logging-only changes with no new
user-visible behavior.)

---

## Phase 5: RAF tick try/catch

### Overview

The RAF tick loops (single-run and multi-run) have no exception boundary —
a future bug in the pure simulation math would freeze the canvas with no
trace anywhere, in the browser or on the server. Wraps both in try/catch with
a visible error state, matching the existing stop-failure display convention.

### Changes Required:

#### 1. Single-run tick

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Catch an exception from `computeSingleRunTick` (or `drawScene`),
stop the loop cleanly instead of leaving it to fail silently, and tell the
user something broke instead of showing a dead canvas.

**Contract**: wrap `tick`'s body (`:204-238`) in try/catch. On catch:
`cancelAnimationFrame(rafIdRef.current)`, set a new `tickError: string | null`
state to the caught error's message, and do not call `stop()` (the tick
computation's own state may be unreliable; don't attempt to score a broken
run). Render, below the canvas, when `tickError` is set: `Simulation error: {tickError}` plus a button calling `onFinished()` directly — same text pattern as the existing `Failed to score run: ...` display, same "way back" as `Start New Run`.

#### 2. Multi-run tick

**File**: `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

**Intent**: Same fix, for the shared multi-run tick loop. A throw here
(`computeMultiRunTick` operates across all slots in one call) stops every
slot, not just one — there is no finer-grained isolation available without a
larger architectural change, which is out of scope here.

**Contract**: wrap `tick`'s body (`:147-181`) in try/catch. On catch:
`cancelAnimationFrame(rafIdRef.current)`, set a new local `tickError: string | null`
state, render it below the canvas in the same style as single-run's fix (this
component has no existing error-display convention of its own to match, so it
adopts single-run's).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` passes, extended with a case that mocks `computeSingleRunTick` to throw on the captured RAF callback's invocation, asserts no further frame is scheduled (`cancelAnimationFrame` called, `requestAnimationFrame` not called again) and the error text is rendered
- `npx vitest run src/app/simulation/multi/_components/multi-simulation-stage.test.tsx` passes, extended with the equivalent case for `computeMultiRunTick`
- `npm test` passes

#### Manual Verification:

- Temporarily force a throw inside one pure simulation step function, run a
  simulation in the browser, confirm the canvas stops cleanly with a visible
  "Simulation error: ..." message instead of freezing silently, then revert
  the deliberate throw.

---

## Phase 6: TOCTOU race fixes

### Overview

The most invasive phase, done last. Fixes the two races the audit found in
`simulation.ts`: a lost-update on `stop`, and a cap-bypass on `start`. Tested
by deterministically pre-staging the race's end state (the guard condition
the fix adds), not by reproducing literal thread-level concurrency — Vitest's
single-threaded model can't reliably race two overlapping awaits, and testing
the guard condition directly is the established, correct way to test this
class of bug.

### Changes Required:

#### 1. Guard `stop`'s update, reject the losing caller

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Two concurrent `stop` calls for the same run can both pass the
early `run.status !== "running"` read-time check before either writes; the
second `.update()` currently overwrites the first's score silently. Make the
race itself fail loudly instead.

**Contract**: change the update (`:115-122`) to also filter on
`eq(simulationRuns.status, "running")` in its `.where(...)`, and add
`.returning({ id: simulationRuns.id })`. If the returned array is empty
(nothing matched — someone else's write landed first), throw
`new TRPCError({ code: "BAD_REQUEST", message: "Run already stopped" })`
instead of returning `{ score }`. The existing early check stays — it's a
cheap, clear-message fast path for the common (non-race) case; this guard is
the narrow race-safety net.

#### 2. Re-check `start`'s cap after insert, invalidate the loser

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Two concurrent `start` calls from the same user can both read a
pre-cap count and both insert, breaching `MAX_PARALLEL_RUNS`. Catch it
immediately after the insert instead of trusting the pre-insert count alone.

**Contract**: after the insert (`:58-74`) and before returning, re-count
`running` rows for `userId` (same query shape as the existing pre-insert
count). If the count now exceeds `MAX_PARALLEL_RUNS`, update the just-inserted
row's `status` to `"stopped"` (invalidating it — it was never really
running) and throw the same
`TRPCError({ code: "BAD_REQUEST", message: "Already running N simulations..." })`
the pre-insert check already throws, rather than returning `{ runId, seed }`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npx vitest run src/server/api/routers/simulation.test.ts` passes, extended
  with: (a) a `stop` race case — pre-set a run's status to `"stopped"`
  directly via `db.update` between reading it and calling the procedure (same
  `insertOwnedRunningRun()` fixture, then flip status before invoking
  `caller.simulation.stop`), asserting `BAD_REQUEST`; (b) a `start` race case
  — pre-insert `MAX_PARALLEL_RUNS` running rows for the test user, then call
  `caller.simulation.start` and assert it throws `BAD_REQUEST` with the
  already-running row count unchanged afterward (confirming the invalidation
  actually ran)
- `npm test` passes (including the existing "allows the owner's own call to
  succeed" contrast case, confirming the guard doesn't false-positive on the
  non-race path)

(No manual verification — this is server-side logic with no new
user-visible UI; the existing `stopRun.error.message` / `startRun.error`
displays already show whatever message a thrown `BAD_REQUEST` carries.)

---

## Testing Strategy

### Unit Tests:

- `logTRPCError` (Phase 1): authenticated ctx, undefined ctx, null session.
- `error.tsx` (Phase 2) and `src/instrumentation.ts` (Phase 3): rendered/
  invoked directly with fakes, asserting the logging call — not the
  framework's own guarantee that it gets invoked (that's the manual step).
- Each `onError` handler (Phase 4): invoked via the existing mocked-mutation
  test pattern, asserting `console.error` content.
- RAF try/catch (Phase 5): forced throw on the captured tick callback,
  asserting the loop stops and the error renders — extends the exact pattern
  already in both `*.test.tsx` files.

### Integration Tests:

- The two TOCTOU guards (Phase 6): `createCaller` against the real test
  database, pre-staging the race's end state directly via `db.update`/
  `db.insert` rather than true concurrency.

### Manual Testing Steps:

1. Phase 1: trigger a real tRPC error against a local production build,
   confirm the structured log line.
2. Phase 2: force a client-render throw, confirm the styled error page +
   working reset button.
3. Phase 3: force an RSC-path throw, confirm the instrumentation log line.
4. Phase 5: force a tick throw, confirm the canvas stops cleanly with a
   visible message instead of freezing.

## Migration Notes

None — no schema changes, no data migration. Phase 6's query changes are
backward-compatible (the `WHERE status = 'running'` addition only narrows
which rows a correctly-sequenced call would already have matched).

## References

- Audit report: `context/audits/observability/2026-11-13_simulation-start-stop.md`
  (§5 findings PL-1, PL-2 [not in scope — NextAuth library behavior, separate
  change], PL-3, PL-4, PL-5, SS-2, SS-3, SS-4, SS-7, SS-11; §6 recommended fix
  order)
- `@trpc/server`'s own error-handling pattern:
  `node_modules/@trpc/server/skills/error-handling/SKILL.md:157-175`
- Next's `instrumentation.ts` contract:
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`
- Existing RAF test pattern:
  `src/app/simulation/_components/simulation-canvas.test.tsx`,
  `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`
- Existing race-test fixture pattern:
  `src/server/api/routers/simulation.test.ts`'s `insertOwnedRunningRun()`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Production tRPC error logging

#### Automated

- [x] 1.1 npm run typecheck passes — c897806
- [x] 1.2 npm run check passes — c897806
- [x] 1.3 src/server/api/trpc.test.ts passes (authenticated ctx, undefined ctx, null session) — c897806
- [x] 1.4 npm test passes — c897806

#### Manual

- [x] 1.5 Local production build: trigger a real tRPC error, confirm the structured log line — c897806

### Phase 2: Root error boundary

#### Automated

- [x] 2.1 npm run typecheck passes — 8c59741
- [x] 2.2 npm run check passes — 8c59741
- [x] 2.3 src/app/error.test.tsx passes — 8c59741
- [x] 2.4 npm test passes — 8c59741

#### Manual

- [x] 2.5 Force a client-render throw, confirm the styled error page + working reset button — 8c59741

### Phase 3: instrumentation.ts

#### Automated

- [x] 3.1 npm run typecheck passes — 2aa7b89
- [x] 3.2 npm run check passes — 2aa7b89
- [x] 3.3 src/instrumentation.test.ts passes — 2aa7b89
- [x] 3.4 npm test passes — 2aa7b89

#### Manual

- [x] 3.5 Local production build: force an RSC-path throw, confirm the instrumentation log line — 2aa7b89

### Phase 4: Missing onError handlers

#### Automated

- [x] 4.1 npm run typecheck passes — d3c5414
- [x] 4.2 npm run check passes — d3c5414
- [x] 4.3 src/app/_components/post.test.tsx passes — d3c5414
- [x] 4.4 simulation-canvas.test.tsx passes (extended: stopRun onError logs run id) — d3c5414
- [x] 4.5 multi-simulation-stage.test.tsx passes (extended: stopSlot onError logs the error) — d3c5414
- [x] 4.6 npm test passes — d3c5414

### Phase 5: RAF tick try/catch

#### Automated

- [x] 5.1 npm run typecheck passes — 9bf342e
- [x] 5.2 npm run check passes — 9bf342e
- [x] 5.3 simulation-canvas.test.tsx passes (extended: forced tick throw stops the loop, renders error) — 9bf342e
- [x] 5.4 multi-simulation-stage.test.tsx passes (extended: forced tick throw stops the loop, renders error) — 9bf342e
- [x] 5.5 npm test passes — 9bf342e

#### Manual

- [x] 5.6 Force a tick throw, confirm the canvas stops cleanly with a visible message — 9bf342e

### Phase 6: TOCTOU race fixes

#### Automated

- [x] 6.1 npm run typecheck passes
- [x] 6.2 npm run check passes
- [x] 6.3 simulation.test.ts passes (extended: stop race case, start race case, existing contrast case)
- [x] 6.4 npm test passes
