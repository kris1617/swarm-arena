# Live Simulation-View Channel Implementation Plan

## Overview

Add a tRPC subscription that pushes a running server-owned simulation's
current tick state to exactly one connected viewer, via Server-Sent Events.
This is roadmap Foundation F-04 — no UI consumes it yet; it unlocks S-07
(the actual viewer).

## Current State Analysis

- `src/server/simulation/server-run-registry.ts` (F-03, just shipped) exposes
  `getLiveRunState(runId): LiveRunSnapshot | undefined` (boids, predators,
  elapsedSeconds, populationCapped) and `isServerRunActive(runId): boolean` —
  exactly the read surface this channel needs, already built for this purpose.
- `src/server/api/routers/simulation.ts:13-181` — the only two procedures
  today are `start` and `stop`, both mutations. No subscription procedure
  exists.
- `src/app/api/trpc/[trpc]/route.ts:1-24` — the route handler has no
  `export const runtime = "edge"` override, so it runs on the Node runtime by
  default, which supports the long-lived streaming response SSE needs.
- `src/trpc/react.tsx:1-70` — the client uses a single `httpBatchStreamLink`
  for everything. tRPC subscriptions need a dedicated link
  (`httpSubscriptionLink`) split out from batched query/mutation traffic via
  `splitLink`.
- `package.json` already pins `@trpc/client`/`@trpc/server`/`@trpc/react-query`
  at `^11.0.0` — confirmed via `node_modules/@trpc/server/dist/index.d.cts`
  and `node_modules/@trpc/client/dist/index.d.cts` to export `tracked`
  (server) and `httpSubscriptionLink` (client) respectively. No dependency
  bump needed.

### Key Discoveries:

- tRPC v11's native SSE subscription support means this Foundation needs
  **no new transport** — no custom WebSocket server, no separate Route
  Handler. A subscription procedure is just a procedure whose resolver
  returns an `AsyncIterable`; the existing `fetchRequestHandler` already
  knows how to stream it as SSE.
- **Correction made during plan-review (before any code was written):**
  tRPC's own types (`node_modules/@trpc/server/dist/unstable-core-do-not-import-B8epiErP.d.cts:1440`)
  show `.subscription(...)`'s return type is
  `TCaller extends true ? TypeError<'Not implemented'> : SubscriptionProcedure<...>`
  — `createCaller`'s decorated procedures set `TCaller: true`, so **a
  subscription procedure cannot be invoked through `createCaller` at all**.
  The original draft of this plan assumed `simulation.test.ts`'s existing
  `createCaller` pattern would work for `watch` the same way it works for
  `start`/`stop`; it does not. Fix: extract the generator logic into a
  plain, exported async generator function — `watchServerRun` — in
  `server-run-registry.ts`, following this codebase's established "pure
  core, thin tRPC shell" separation (exactly how `computeSingleRunTick` is
  separate from the router that calls it). The tRPC procedure becomes a
  one-line delegate. Tests call `watchServerRun` directly as a plain
  function — no `createCaller`, no tRPC transport involved at all.

## Desired End State

Calling the `simulation.watch` subscription (ownership-checked, targeting an
active server run) yields a snapshot of that run's current tick state
repeatedly until the run stops or the subscriber disconnects — all without
the viewer owning or affecting execution. Verify: iterate the subscription
directly via `createCaller` while a server run (started via F-03's
`startServerRun`) is ticking, and observe multiple distinct snapshots with
advancing `elapsedSeconds`, entirely without a browser.

## What We're NOT Doing

- Not building the actual viewer UI/canvas that consumes this channel —
  that's S-07.
- Not adding a WebSocket server or any transport beyond tRPC's existing SSE
  subscription support — would duplicate infrastructure tRPC v11 already
  provides.
- Not pushing on every tick (~16ms). The channel polls `getLiveRunState` on
  its own, coarser cadence (150ms — see Implementation Approach) since a
  human watching a canvas render doesn't need 60fps state pushes, and a
  coarser cadence means far less serialization/network work per viewer.
- Not supporting more than one viewer per `watch` call sharing load —
  concurrent viewers of the same run each get their own generator polling
  the same in-memory `getLiveRunState` snapshot; this is cheap (a plain
  object read, no extra DB query) so no shared-subscription optimization is
  needed yet.
- Not changing the client-side staging path or `simulation.start`/`stop` at
  all.
- Not persisting anything — this is a read-only, ephemeral push channel over
  state F-03 already owns.

## Implementation Approach

Add a plain, exported async generator `watchServerRun({ runId, userId, signal })`
to `server-run-registry.ts`: it first verifies the caller owns the run and
that it's an active server run (same ownership-check shape `stop` already
uses — read the row, compare `userId` — plus the `isServerRunActive` check),
then loops `while (!signal?.aborted)`, yielding a plain snapshot from
`getLiveRunState(runId)` every 150ms, and returning (ending the stream) once
`getLiveRunState` returns `undefined` (the run has stopped) or the signal
aborts (the subscriber disconnected). The `simulationRouter.watch` procedure
is a thin delegate: `protectedProcedure.input(...).subscription(async function* ({ input, ctx, signal }) { let eventId = 0; for await (const snapshot of watchServerRun({ runId: input.runId, userId: ctx.session.user.id, signal })) { yield tracked(String(eventId++), snapshot); } })` —
`tracked()` (tRPC's SSE event-id wrapper) stays in this thin layer since it's
a transport concern, not part of the testable core. Client-side, add
`httpSubscriptionLink` behind a `splitLink` keyed on `op.type === "subscription"`
in `src/trpc/react.tsx`, alongside the existing `httpBatchStreamLink` for
queries/mutations — the standard tRPC v11 wiring for mixing batched HTTP
with SSE subscriptions on one client.

## Phase 1: `watch` subscription procedure, client SSE wiring, and tests

### Overview

Add the subscription procedure to the simulation router, wire the client to
support it, and prove the channel end-to-end via `createCaller` against a
real F-03 server run — no browser involved.

### Changes Required:

#### 1. `watchServerRun` — the testable core

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Let an authenticated owner of an active server-run simulation
receive a live stream of its current tick state, without granting any
ability to affect execution — as a plain async generator function, callable
directly from tests with no tRPC transport involved (see "Key Discoveries"
for why `createCaller` cannot be used here).

**Contract**:
- `export async function* watchServerRun(opts: { runId: number; userId: string; signal?: AbortSignal }): AsyncGenerator<LiveRunSnapshot, void, unknown>`
- Before the first yield: read the `simulationRuns` row for `opts.runId`;
  throw `TRPCError({ code: "BAD_REQUEST" })` if it doesn't exist, `FORBIDDEN`
  if `row.userId !== opts.userId` — same two checks `stop` already makes, in
  the same order.
- If `isServerRunActive(opts.runId)` is `false` at call time, throw
  `TRPCError({ code: "BAD_REQUEST", message: "Run is not an active server-run simulation" })`
  — this channel is for watching a *currently ticking* server run, not for
  replaying a finished one (that's a plain DB read, unrelated to this
  Foundation).
- Loop: `while (!opts.signal?.aborted)`, read `getLiveRunState(opts.runId)`;
  if `undefined` (run just stopped), `return` to end the stream; otherwise
  `yield snapshot` then wait 150ms (`await new Promise((r) => setTimeout(r, 150))`)
  before the next iteration.

#### 2. `watch` subscription procedure — the thin tRPC shell

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Expose `watchServerRun` as an SSE subscription, wrapping each
yield in tRPC's `tracked()` envelope for `Last-Event-ID` resumability — a
transport concern that stays out of the testable core.

**Contract**:
```ts
watch: protectedProcedure
  .input(z.object({ runId: z.number() }))
  .subscription(async function* ({ input, ctx, signal }) {
    let eventId = 0;
    for await (const snapshot of watchServerRun({
      runId: input.runId,
      userId: ctx.session.user.id,
      signal,
    })) {
      yield tracked(String(eventId++), snapshot);
    }
  })
```

#### 3. Client SSE link wiring

**File**: `src/trpc/react.tsx`

**Intent**: Let the React client actually open and consume a `watch`
subscription, without changing how existing queries/mutations are sent.

**Contract**: Replace the single `httpBatchStreamLink` entry in the `links`
array with `splitLink({ condition: (op) => op.type === "subscription", true: httpSubscriptionLink({ transformer: SuperJSON, url: ... }), false: httpBatchStreamLink({ ...existing options... }) })`, importing `splitLink`/`httpSubscriptionLink` from `@trpc/client` alongside the existing `httpBatchStreamLink`/`loggerLink` imports. The subscription link's `url` and header-setting callback mirror the existing `httpBatchStreamLink`'s exactly (same endpoint, same `x-trpc-source` header) — only the transport link class differs.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- With the dev server running (`npm run dev`), open the browser's network
  tab, authenticate, and confirm that opening the app does not itself open
  any SSE connection (no component calls `watch` yet — this Foundation adds
  no UI). This is a negative check: confirming the subscription link wiring
  doesn't change existing page behavior.

**Implementation Note**: After automated verification passes, pause for the
manual spot-check above before committing.

---

## Testing Strategy

### Unit Tests:

- Extend `src/server/simulation/server-run-registry.test.ts` with a `describe("watchServerRun")` block, following its existing DB-fixture pattern (real `users`/`simulationRuns` rows, `afterEach` cleanup):
  - Rejects with `FORBIDDEN` when `userId` doesn't match the run's owner (call `watchServerRun(...).next()` and assert the returned promise rejects with `TRPCError({code: "FORBIDDEN"})`, same assertion shape `simulation.test.ts` already uses for `stop`'s ownership check).
  - Rejects with `BAD_REQUEST` when `runId` doesn't exist.
  - Rejects with `BAD_REQUEST` when the run exists but isn't an active server run (a row inserted directly via fixture, never passed to `startServerRun`).
  - For an active run (started via `startServerRun` against a real fixture row): call `watchServerRun`, take 2-3 values via `for await`, and assert each yielded snapshot's `elapsedSeconds` is non-decreasing across iterations. Then call `stopServerRun` and confirm the generator's next iteration ends the stream (no further yield) rather than yielding a stale/undefined snapshot.
  - Passing an already-aborted `AbortSignal` ends the stream after at most one yield (proves the `signal?.aborted` guard actually stops the loop, not just that it doesn't throw on `undefined`).
- The `watch` tRPC procedure itself is NOT covered by a `createCaller`-based test (impossible per the Key Discoveries correction above) — its only logic is the thin `tracked()`-wrapping delegation shown in its Contract, which has no independent behavior to assert beyond what `watchServerRun`'s tests already cover. This is a deliberate, documented gap, not an oversight.

### Integration Tests:

- N/A beyond the `createCaller`-based tests above — no real SSE/EventSource
  client is exercised in this Foundation (that happens implicitly once S-07
  builds a browser consumer).

### Manual Testing Steps:

1. See Phase 1's Manual Verification — confirm the link rewiring is
   transport-neutral for the app's existing (non-subscription) traffic.

## Performance Considerations

150ms polling per viewer against an in-memory snapshot (no DB query) is
cheap; this project's declared small scale makes per-viewer cost a non-issue.
Revisit only if a future phase needs many concurrent viewers of the same run.

## Migration Notes

None — no schema change.

## References

- Roadmap: `context/foundation/roadmap.md` F-04 (live-simulation-view-channel)
- Live-state read surface (F-03): `src/server/simulation/server-run-registry.ts`
- Existing ownership-check pattern to mirror: `src/server/api/routers/simulation.ts:130-144` (`stop`'s ownership check)
- Existing DB-backed test fixture pattern: `src/server/api/routers/simulation.test.ts:1-97`
- tRPC v11 SSE subscription APIs confirmed present: `node_modules/@trpc/server/dist/index.d.cts` (`tracked`), `node_modules/@trpc/client/dist/index.d.cts` (`httpSubscriptionLink`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `watch` subscription procedure, client SSE wiring, and tests

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — b3af369
- [x] 1.2 Linting passes: `npm run check` — b3af369
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts` — b3af369
- [x] 1.4 Full suite still passes: `npm test` — b3af369

#### Manual

- [x] 1.5 Subscription link rewiring doesn't change existing (non-subscription) page/network behavior — b3af369
