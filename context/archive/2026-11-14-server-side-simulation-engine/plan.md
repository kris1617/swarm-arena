# Server-Owned Simulation Execution Engine Implementation Plan

## Overview

Add a server-owned tick loop that can run a simulation to completion
independent of any client connection or browser tab. This is roadmap
Foundation F-03 — it does not add any user-visible UI by itself; it unlocks
F-04 (live view channel) and S-06 (start a server-run simulation), which wire
this engine to an actual start action and a viewer.

## Current State Analysis

Simulation execution today is 100% client-side and `requestAnimationFrame`-
driven:

- `src/app/simulation/_components/simulation-canvas.tsx:207-316` — a run-once
  effect seeds `rngRef` from `createRng(seed)`, builds initial
  boids/predators via `createInitialPopulation`/`createInitialPredators`, then
  an RAF loop (`tick()`) calls `computeSingleRunTick` every frame, writes the
  result back into refs, draws the frame, and on `shouldStop` calls
  `stopRun.mutate({ runId, elapsedTicks, cohesionSamples })` — the **client**
  reports elapsed time and cohesion history to the server at stop time.
- `src/server/simulation/single-run-lifecycle.ts:18-111` — `computeSingleRunTick`
  is already a pure, DOM-free decision core (dt clamp, calls `runTick`,
  appends a cohesion sample, decides `shouldStop`). It is the function this
  plan moves to a server-owned caller — unchanged.
- `src/server/api/routers/simulation.ts:14-180` — `start` validates params,
  enforces the `MAX_PARALLEL_RUNS` cap, inserts a `running` row, returns
  `{runId, seed}`. `stop` is a **client-invoked** mutation taking
  `elapsedTicks`/`cohesionSamples` as input, computing `computeScore`, and
  flipping the row to `stopped`. Neither procedure ticks anything.
- `src/server/db/schema.ts:92-127` — `simulationRuns` stores only run
  configuration and terminal fields (`status`, `score`, `startedAt`,
  `stoppedAt`); no per-tick state. No schema change is needed for this
  Foundation — live state lives in server memory, not the DB (see "What We're
  NOT Doing").
- `src/server/db/index.ts:1-17` — `db` is a module-level singleton (cached on
  `globalThis` in dev to survive HMR), importable directly outside any tRPC
  request context. This is what makes a server-owned background loop
  possible without an active HTTP request.
- `src/server/simulation/rng.ts` — `createRng(seed)` is a pure, deterministic
  mulberry32 PRNG matching what the client's init effect already uses.
- `src/server/simulation/boids.ts:1124-1135` — `computeScore(cohesionSamples,
  elapsedTicks)` is pure; reused unchanged.

### Key Discoveries:

- `computeSingleRunTick` takes a plain `timestamp: number` and an opaque
  `rng: () => number` — nothing about it is browser-specific. The only thing
  that changes is *who calls it on a timer* (a browser's RAF vs. a server
  `setInterval`), not the function itself.
- The existing client effect's tick-error handling
  (`simulation-canvas.tsx:299-312`) explicitly does **not** attempt to score a
  broken run — it logs and stops. This plan's server-side error path follows
  the same rule (see Phase 1, Changes Required #1).
- `tech-stack.md` already names the reason the deploy target (persistent
  Docker container, not serverless) was chosen: "an always-on simulation loop
  and any WebSocket/SSE push to the live view" — this Foundation is not a
  surprise to the deployment architecture.
- `src/server/api/routers/simulation.test.ts:46-80` establishes the project's
  pattern for DB-touching tests: insert a real fixture `users` row (FK
  enforced by `@libsql/client`), insert a real `simulationRuns` row, run the
  code under test against the real `db` singleton, clean up in `afterEach`.
  This plan's tests follow the same pattern.

## Desired End State

A plain function call — `startServerRun(params)` — begins ticking a
simulation forward on a server-owned timer. No client connection is involved.
When the run naturally ends (duration elapsed or population wiped) or is
told to stop early (`stopServerRun(runId)`), the engine computes the score
with the existing `computeScore` and writes `status: "stopped"`, `score`,
`stoppedAt` to the run's `simulationRuns` row directly — no client round-trip.
Verify: call `startServerRun`, advance time, observe the DB row transition
from `running` to `stopped` with a score, entirely without a browser.

### Key Discoveries:

(see Current State Analysis above — all discoveries are grounded there)

## What We're NOT Doing

- Not adding a tRPC mutation or any UI to *start* a server run from the
  browser — that's S-06. This Foundation only builds the engine; nothing
  calls `startServerRun` yet except its own tests.
- Not adding a push/subscription channel to *view* a server run — that's
  F-04.
- Not persisting live per-tick state to the database or surviving a server
  process restart — an in-flight server run is lost on restart, exactly the
  same limitation client-side execution has today (losing the state on tab
  close). Restart-durability is S-04's concern (full save/resume), not this
  Foundation's.
- Not running simulations faster than real time. The tick cadence
  approximates the client's ~60fps RAF loop (one tick per ~16ms via
  `setInterval`) so a server run's `elapsedSeconds` means the same thing it
  means today — wall-clock seconds, not simulated seconds at an arbitrary
  multiplier. Faster-than-real-time execution is a separate, un-roadmapped
  idea, not part of MS-01/MS-02.
- Not changing `simulationRuns`'s schema. No new columns.
- Not changing the existing client-side staging path
  (`simulation-canvas.tsx`, `simulation.stop` mutation) at all. It keeps
  working exactly as today for the single-run staging flow (MS-03).
- Not adding worker threads or a separate process for execution. Each active
  server run is one `setInterval` in the main Node process — adequate for
  this project's declared scale (`target_scale.users: small`); revisit only
  if a future performance budget says otherwise.

## Implementation Approach

A new module, `src/server/simulation/server-run-registry.ts`, owns an
in-memory `Map<runId, LiveRun>` (survives dev HMR via the same
`globalThis`-caching pattern `src/server/db/index.ts` uses for `db`). Each
`LiveRun` holds exactly the state `simulation-canvas.tsx`'s refs hold today
(boids, predators, foodStock, cohesionSamples, elapsedSeconds, lastTimestamp,
rng) plus the run's immutable parameters and its `setInterval` handle.
`startServerRun` seeds a `LiveRun` the same way the client's init effect does
today, then starts an interval that calls `computeSingleRunTick` every tick
using `Date.now()` in place of an RAF timestamp. On `shouldStop`, or on
`stopServerRun(runId)`, the interval is cleared, the run is removed from the
registry, and — if it hadn't already reached a terminal DB state — the score
is computed and written directly via `db.update(simulationRuns)...`, mirroring
what `simulation.stop`'s resolver does today but without a client supplying
the numbers. A read-only `getLiveRunState(runId)` accessor is added now (even
though nothing calls it yet) because F-04, the very next Foundation, needs it
to read a running simulation's current tick state — building it here avoids
F-04 reaching back into this module's private `Map`.

## Phase 1: Server-owned tick loop, completion scoring, and manual stop

### Overview

Build `server-run-registry.ts` with `startServerRun`, `stopServerRun`, and
`getLiveRunState`; prove it end-to-end with DB-backed tests that never touch
a browser.

### Changes Required:

#### 1. Server-owned run registry

**File**: `src/server/simulation/server-run-registry.ts` (new)

**Intent**: Own the live state and timer for every currently-executing
server-run simulation, independent of any client connection, reusing the
existing pure tick core and scoring function unchanged.

**Contract**:
- `startServerRun(input: { runId: number; seed: number; boidCount: number; separationWeight: number; alignmentWeight: number; cohesionWeight: number; maxDurationSeconds: number; predatorCount: number; protectionThreshold: number; foodStockInitial: number; foodRegenRate: number; flockCount: number; crossbreedingEnabled: boolean; energyThreshold: number; mutationChance: number; mutationMagnitude: number }): void`
  — throws if `runId` is already registered (caller's bug, not a user-facing
  error path since nothing calls this from a request yet). Initializes state
  exactly as `simulation-canvas.tsx:207-234` does (same `maxLifespan`
  derivation, same `FlockWeights` broadcast to `flockCount` copies, same
  `createInitialPopulation`/`createInitialPredators` calls), then registers a
  `setInterval` tick at the same ~16ms cadence the client's RAF loop
  approximates.
- `stopServerRun(runId: number): Promise<void>` (ADAPT from the originally
  planned synchronous `void` signature — made awaitable so a caller, test or
  otherwise, can wait for the DB write to actually land rather than racing a
  fire-and-forget update; the no-return-value intent is unchanged) — no-op
  if `runId` isn't registered
  (idempotent; a caller racing a natural completion against a manual stop
  should not throw). Otherwise clears the interval, computes the score from
  whatever `cohesionSamples`/`elapsedSeconds` have accumulated so far (mirrors
  FR-011 "user can stop a simulation at any point and save its state" — this
  Foundation covers the scoring half; full state-fidelity save/resume is
  S-04), writes `status: "stopped"`, `score`, `stoppedAt` to the matching
  `simulationRuns` row, and removes the entry from the registry.
- `getLiveRunState(runId: number): { boids: BoidState[]; predators: PredatorState[]; elapsedSeconds: number; populationCapped: boolean } | undefined`
  — read-only snapshot; returns `undefined` if the run isn't currently
  registered (already finished, or never started). Callers must not mutate
  the returned arrays.
- On a tick throwing (mirrors `simulation-canvas.tsx:299-312`'s rule): log via
  `console.error`, clear the interval, remove the run from the registry, and
  write `status: "stopped"` with `score` left `null` (not computed) — explicitly
  do not attempt to score a run that errored mid-tick, same rule the existing
  client path follows.
- On `shouldStop` from natural completion (duration elapsed or population
  wiped): same write as `stopServerRun`, triggered internally rather than by
  an external caller.

#### 2. Registry tests

**File**: `src/server/simulation/server-run-registry.test.ts` (new)

**Intent**: Prove natural completion, manual stop, the tick-error path, and
`getLiveRunState`'s snapshot behavior — all against the real DB singleton,
following `simulation.test.ts`'s fixture pattern (real `users` row, real
`simulationRuns` row, cleanup in `afterEach`).

**Contract**: See "Testing Strategy" below for the specific cases.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test file passes: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- With the dev server running (`npm run dev`), from a scratch Node REPL or
  script that imports `startServerRun` directly and calls it against a real
  `simulationRuns` row (no browser tab, no `fetch`, no UI), confirm the row's
  `status` transitions from `running` to `stopped` with a non-null `score`
  once `maxDurationSeconds` elapses — proving execution genuinely does not
  depend on a client connection.

**Implementation Note**: After automated verification passes, pause for the
manual spot-check above before committing — it's the one check that proves
the "independent of any client connection" guarantee this Foundation exists
to deliver, which a unit test with fake timers can assert but can't fully
demonstrate the way a real wall-clock run can.

---

## Testing Strategy

### Unit Tests:

- `server-run-registry.test.ts`: use `vi.useFakeTimers()` to drive the
  interval without waiting real wall-clock time. The tick callback performs
  real async DB I/O (the libsql client), so advance time with
  `await vi.advanceTimersByTimeAsync(ms)` — not the synchronous
  `vi.advanceTimersByTime` — so each tick's awaited DB write actually settles
  before assertions run. Call `stopServerRun` (or otherwise ensure no run is
  left registered) and `vi.useRealTimers()` in `afterEach`, so a test that
  fails mid-run can't leave a live interval ticking into a later test file in
  the same worker. Cases:
  - `startServerRun` followed by advancing fake time past
    `maxDurationSeconds` ends with the matching DB row `status: "stopped"`
    and a non-null `score` — natural completion path.
  - `stopServerRun` called mid-run ends with `status: "stopped"` and a score
    computed from the partial `cohesionSamples` collected so far — manual
    stop path.
  - `stopServerRun` called on an unregistered `runId` is a no-op (does not
    throw, does not touch the DB).
  - `getLiveRunState` returns a snapshot with the expected shape while a run
    is active, and `undefined` once it has stopped.
  - A population wipe (all boids/predators die) stops the run with
    `shouldStop` exactly like the client path's existing wipe handling.

### Integration Tests:

- N/A beyond the DB-backed unit tests above — this Foundation adds no tRPC
  procedure or HTTP surface yet (that's S-06).

### Manual Testing Steps:

1. See Phase 1's Manual Verification — a real wall-clock run against the real
   SQLite DB, started from a plain function call, with no browser tab open.

## Performance Considerations

Each active server run is one `setInterval` (~16ms cadence) in the main Node
process. This project's declared scale (`target_scale.users: small`) makes
many concurrent intervals a non-issue; if a future phase needs many more
concurrent server runs than a single Node event loop comfortably services,
that's a new, separately-scoped performance question — not addressed here.

## Migration Notes

None — no schema change.

## References

- Roadmap: `context/foundation/roadmap.md` F-03 (server-side-simulation-engine)
- Existing pure tick core: `src/server/simulation/single-run-lifecycle.ts:18-111`
- Existing client caller (pattern to mirror server-side):
  `src/app/simulation/_components/simulation-canvas.tsx:207-316`
- Existing scoring function: `src/server/simulation/boids.ts:1124-1135`
- DB singleton pattern to follow for registry's `globalThis` caching:
  `src/server/db/index.ts:1-17`
- DB-backed test pattern to follow: `src/server/api/routers/simulation.test.ts:1-80`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server-owned tick loop, completion scoring, and manual stop

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 9bf0e66
- [x] 1.2 Linting passes: `npm run check` — 9bf0e66
- [x] 1.3 New test file passes: `npx vitest run src/server/simulation/server-run-registry.test.ts` — 9bf0e66
- [x] 1.4 Full suite still passes: `npm test` — 9bf0e66

#### Manual

- [x] 1.5 Real wall-clock run via direct function call (no browser) ends with `status: "stopped"` and a non-null score — 9bf0e66
