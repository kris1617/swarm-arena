# Start a Server-Run Simulation Implementation Plan

## Overview

Add a distinct "Start on server" action to the existing simulation setup
page that starts a real simulation owned by F-03's server-run engine,
alongside the existing client-side staging start — both sharing the same
parameter form. This is roadmap Slice S-06, the north star of the
2026-11-14 server-execution extension: the first user-facing proof that the
server-owned engine actually works end-to-end.

## Current State Analysis

- `src/app/simulation/page.tsx:32-75` — `SimulationPage` holds 14 pieces of
  form state (boidCount, weights, etc.) and one mutation,
  `api.simulation.start`, whose `onSuccess` sets `activeRun`, which renders
  `<SimulationCanvas>` (client-owned RAF loop, unchanged by this plan).
- `src/app/simulation/page.tsx:99-147` — the form's `onSubmit` clamps every
  field to its validated range (matching the server's zod schema exactly)
  before calling `startRun.mutate(...)`.
- `src/server/api/routers/simulation.ts:14-117` — `start` validates input
  (zod schema + `.refine()` combined-cap check), enforces
  `MAX_PARALLEL_RUNS` (count + insert + race-recheck), inserts a `running`
  row, returns `{runId, seed}`. This capacity-check-and-insert logic is
  exactly what `startServer` also needs — only what happens *after* the
  insert differs (client ticks it vs. `startServerRun` ticks it).
- `src/server/simulation/server-run-registry.ts` (F-03, done) exports
  `startServerRun(params: ServerRunParams): void`, where `ServerRunParams`
  is `{ runId, seed, boidCount, separationWeight, alignmentWeight, cohesionWeight, maxDurationSeconds, predatorCount, protectionThreshold, foodStockInitial, foodRegenRate, flockCount, crossbreedingEnabled, energyThreshold, mutationChance, mutationMagnitude }`
  — field-for-field identical to `start`'s validated input plus `runId`/`seed`.

### Key Discoveries:

- `start`'s input schema (the `z.object({...}).refine(...)` literal at
  `simulation.ts:16-38`) and `ServerRunParams`'s fields line up exactly —
  `startServer` needs the same validation, the same capacity check, the
  same insert, and then one extra call. Duplicating all of that inline
  would drift from `start` over time; extracting a shared helper is the
  smallest change that keeps both paths honest.
- Nothing in `MAX_PARALLEL_RUNS`'s cap logic (`simulation.ts:46-61`,
  `96-114`) is specific to client execution — it counts rows by
  `status: "running"`, which a server-started row also has. No change
  needed there: server-run and staging-run rows share the same per-user cap
  pool automatically, which is the right behavior (both are real resource
  consumers).

## Desired End State

On the simulation setup page, a user can click "Start on server" (using the
same form values as the existing "Start" button) and see a confirmation
that a server-owned run has begun — without any canvas rendering, without
needing to keep the tab open. Verify: start a server run, close the tab
(or just navigate away), wait past `maxDurationSeconds`, and confirm (via
the DB, same as F-03's own manual check) that the run reached `status:
"stopped"` with a score — proving the server, not the page, drove it to
completion.

## What We're NOT Doing

- Not building any way to *view* a server run's live state — that's S-07.
  This slice's UI only confirms the run started; it does not render
  anything about its progress.
- Not changing the existing "Start" (staging) button, its validation, or
  `SimulationCanvas` at all.
- Not changing `MAX_PARALLEL_RUNS` or the cap-check logic's shape — only
  reusing it via extraction, not altering its behavior.
- Not adding a way to manually stop a server run from this page — F-03's
  `stopServerRun` primitive exists, but wiring a "stop" button is S-08's
  job (the list/switch slice), not this one.
- Not retiring the old client multi-run page (`/simulation/multi`) — that's
  S-08.

## Implementation Approach

Extract `start`'s capacity-check-and-insert logic into a shared async
function, `insertRunningSimulation(ctx, userId, input)`, returning
`{ runId, seed }`. Both `start` (unchanged behavior) and a new `startServer`
procedure call it; `startServer` additionally calls `startServerRun` with
the same validated `input` plus the fresh `runId`/`seed`, right after the
insert succeeds. On the client, add a second button to the existing form
that calls a new `startServer` mutation with the same clamped values the
"Start" button already computes, and on success shows a small confirmation
panel (not the canvas) with the new run's id.

## Phase 1: `startServer` procedure + "Start on server" UI action

### Overview

Add the shared insert helper, the `startServer` procedure, and the UI
action + confirmation panel; prove the server-owned run actually completes
without the page's involvement.

### Changes Required:

#### 1. Extract the shared capacity-check-and-insert helper

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Let `start` and the new `startServer` share identical
validation/capacity/insert behavior without duplicating it, so the two
paths can never silently drift apart.

**Contract**:
- Extract `start`'s existing input schema (currently the inline
  `z.object({...}).refine(...)` literal) into a module-level const,
  `startInputSchema`, reused by both `start.input(startInputSchema)` and
  `startServer.input(startInputSchema)`.
- Extract `start`'s body (lines 40-116: capacity count, insert, race
  recheck) into `async function insertRunningSimulation(db: typeof dbSingleton, userId: string, input: z.infer<typeof startInputSchema>): Promise<{ runId: number; seed: number }>`.
  **Correction made during implementation** (this plan's earlier draft, per
  its own plan-review fix, had dropped `ctx`/`db`-threading in favor of the
  module-level `db` singleton — that was wrong and has been reverted here):
  `simulation.test.ts`'s existing race-condition test
  (`describe("simulationRouter.start — parallel-run cap race")`) injects a
  sabotaging `Proxy` via `createCaller({ db: sabotagingDb, ... })` to
  reproduce an exact concurrent-insert timing. Reading the module-level `db`
  singleton directly, instead of the `db` instance threaded through `ctx`,
  would silently bypass that injection and break the existing test. The
  helper must take `db` as its first parameter (typed `typeof dbSingleton`,
  a type-only import), and both call sites pass `ctx.db`. `start`'s
  resolver becomes `const userId = ...; if (!userId) throw UNAUTHORIZED; return insertRunningSimulation(ctx.db, userId, input);` — behavior-identical to today.

#### 2. `startServer` procedure

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Start a real simulation whose execution is owned by the server
from the moment it's created — no client tick loop involved at all.

**Contract**:
- `startServer: protectedProcedure.input(startInputSchema).mutation(async ({ ctx, input }) => { ... })`
- Resolves `userId` the same way `start` does (guard against `undefined`,
  throw `UNAUTHORIZED`).
- Calls `insertRunningSimulation(ctx.db, userId, input)` to get `{runId, seed}`.
- Calls `startServerRun({ runId, seed, ...input })` (imported from
  `~/server/simulation/server-run-registry`) — this is the one line that
  makes the run server-owned instead of client-owned.
- Returns `{ runId, seed }` — same shape `start` returns, so the client
  code that handles the response needs no new type.

#### 3. "Start on server" UI action

**File**: `src/app/simulation/page.tsx`

**Intent**: Let the user start a server-owned run from the same form that
drives the staging start, without conflating the two code paths.

**Contract**:
- Add `const startServerMutation = api.simulation.startServer.useMutation({ onSuccess: (data) => setServerRunConfirmation({ runId: data.runId }) })`
  (named `startServerMutation`, not `startServerRun`, to keep it visually
  distinct from the server-only `startServerRun` function in
  `server-run-registry.ts` — never imported client-side, but the name
  overlap would be needlessly confusing to a reader of this file).
- Add `const [serverRunConfirmation, setServerRunConfirmation] = useState<{ runId: number } | null>(null)`.
- Add a second submit-triggering control. Since both buttons submit the
  same validated values, factor the existing `onSubmit`'s clamping logic
  out of the `<form>`'s `onSubmit` into a plain function, `buildStartInput()`,
  called by both the existing "Start" button's handler (now
  `startRun.mutate(buildStartInput())`) and the new button's handler
  (`startServerMutation.mutate(buildStartInput())`). Render the new button
  next to the existing "Start" button, label "Start on server", disabled
  while its own mutation is pending, with its own error message paragraph
  (mirroring the existing `startRun.error` rendering).
- Render a confirmation panel when `serverRunConfirmation` is set (and
  independent of `activeRun`, so starting a server run doesn't hide the
  staging form): `Server run #{serverRunConfirmation.runId} started — it
  keeps running even if you close this tab. Viewing it live is a future
  update.` Styled consistently with existing panel-ish elements in this
  file (reuse `bg-input text-foreground` token classes, no new literal
  colors — per this project's UI convention).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Updated/new tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- On `/simulation`, click "Start on server" with default form values;
  confirm the confirmation panel appears with a run id, and that the
  existing "Start" button / staging flow still works unchanged.
- Confirm (via a DB read, same approach as F-03's own manual check) that
  the server-started run's row reaches `status: "stopped"` with a score
  after `maxDurationSeconds`, even if the `/simulation` tab is closed
  immediately after clicking "Start on server".

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Testing Strategy

### Unit Tests:

- Extend `src/server/api/routers/simulation.test.ts` with a
  `describe("simulationRouter.startServer")` block:
  - Enforces the same `MAX_PARALLEL_RUNS` cap as `start` (reuse the
    existing cap-breach fixture pattern, asserting `BAD_REQUEST`).
  - On success, the inserted row's `status` is `"running"` (same as
    `start`) — this procedure doesn't change the DB contract, only what
    ticks the run afterward.
  - On success, `isServerRunActive(runId)` (imported from
    `server-run-registry.ts`) is `true` immediately after the call —
    proving the run is actually server-owned, not just inserted.
  - Call `stopServerRun(runId)` in the test's cleanup so no interval leaks
    into a later test file (same discipline `server-run-registry.test.ts`
    already follows).

### Integration Tests:

- N/A beyond the `createCaller`-based tests above (this procedure is a
  plain mutation, unlike `watch`, so `createCaller` works fine here).

### Manual Testing Steps:

1. See Phase 1's Manual Verification.

## Performance Considerations

None beyond what F-03 already established — `startServer` adds one
synchronous `startServerRun` call to an existing insert path.

## Migration Notes

None — no schema change.

## References

- Roadmap: `context/foundation/roadmap.md` S-06 (start-server-run-simulation)
- Server-run engine (F-03): `src/server/simulation/server-run-registry.ts`
- Existing `start`/cap-check logic to extract: `src/server/api/routers/simulation.ts:14-117`
- Existing form/UI to extend: `src/app/simulation/page.tsx`
- Existing DB-backed test pattern: `src/server/api/routers/simulation.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `startServer` procedure + "Start on server" UI action

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 Updated/new tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- [x] 1.4 Full suite still passes: `npm test`

#### Manual

- [x] 1.5 "Start on server" shows confirmation; existing staging "Start" still works unchanged
- [x] 1.6 A server-started run reaches `status: "stopped"` with a score even if the tab closes immediately
