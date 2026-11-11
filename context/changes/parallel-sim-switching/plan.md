# Parallel Simulation Switching Implementation Plan

## Overview

Let a user run up to 4 simulations in parallel on a new `/simulation/multi` route and switch
which one they're actively viewing, without interrupting or slowing the others. This is
roadmap slice S-05 (`parallel-sim-switching`), prerequisite S-01 (done), covering PRD FR-013
and FR-014. Purely client-side orchestration — no server/schema changes.

## Current State Analysis

- `src/app/simulation/page.tsx` + `src/app/simulation/_components/simulation-canvas.tsx`
  support exactly one run at a time: the page holds one `ActiveRun | null`, and
  `SimulationCanvas` owns its own `requestAnimationFrame` loop that steps `boids.ts`'s pure
  functions, samples cohesion, draws to a canvas, and calls `api.simulation.stop` on finish or
  manual stop.
- `api.simulation.start`/`stop` (`src/server/api/routers/simulation.ts`) are already per-run
  procedures (each call creates/updates one `simulationRuns` row by its own `runId`) — nothing
  about the server assumes a single global run, so this slice needs **no backend changes**.
- `boids.ts`'s `stepBoids`/`computeCohesion`/`createInitialPopulation` are pure functions
  operating on one population array — safe to call once per active run per tick from a single
  driving loop.
- **S-02 (`predator-prey-dynamics`) is being planned in parallel** and will edit `boids.ts`,
  `schema.ts`, `simulation.ts`, `theme-colors.ts`, `simulation-canvas.tsx`, and `page.tsx`.
  This plan deliberately touches **none** of those files — it only *imports* from `boids.ts`,
  `theme-colors.ts`, and the `api` client, and adds new files under `src/app/simulation/multi/`
  plus one new pure module. This is what makes the roadmap's "S-02 parallel with S-05"
  annotation actually true at the file level.

### Key Discoveries

- The PRD's own risk note calls parallel simulations "the most expensive element of the MVP,
  consciously accepted" and requires that switching not measurably slow the other runs — this
  is the one hard constraint shaping the step-loop architecture below.
- Confirmed with the user: only one run's canvas is ever displayed at a time (never a grid of
  live thumbnails), so a single shared step loop that draws just the active run is both
  sufficient and the cheapest option — not a compromise.
- Reusing `simulation-canvas.tsx`'s draw routine or `page.tsx`'s form by extracting a shared
  component would touch exactly the files S-02 is concurrently editing. This plan duplicates
  the start form and the draw routine into the new route's own files instead — a deliberate,
  confirmed tradeoff (see "What We're NOT Doing").

## Desired End State

A user on `/simulation/multi` can start up to 4 simulations, each configured with its own
boid count / weights / duration (S-01's exact parameter set). A switcher UI lists every slot
(label, status, elapsed time or final score) and lets the user click any one to view its live
canvas; only the viewed run draws each frame, but all running slots keep stepping their
physics every frame regardless of which is viewed. A finished run keeps its slot (showing its
score) until the user explicitly dismisses it, freeing that slot for a new start. Starting a
5th run while 4 are occupied is rejected.

Verified by: `npm run typecheck`, `npm run check`, `npx vitest run src/server/simulation/run-slots.test.ts`,
and manually running 4 simulations at once, switching between them, confirming elapsed time
keeps advancing on background runs, and confirming a 5th start is blocked.

## What We're NOT Doing

- No changes to `src/app/simulation/page.tsx`, `simulation-canvas.tsx`, `boids.ts`,
  `schema.ts`, `simulation.ts`, or `theme-colors.ts` — those are S-02's concurrent scope.
- No shared `Button`/form extraction between `/simulation` and `/simulation/multi` — the new
  route's start form is an independent duplicate of S-01's, per the confirmed decision.
- No shared draw-routine extraction — the new route implements its own canvas draw function,
  duplicated from (not imported from) `simulation-canvas.tsx`'s, for the same file-independence
  reason.
- No live thumbnail previews for background (non-viewed) runs — only derived text (elapsed
  time / population count / final score) in the switcher list.
- No predator/food parameters in the new route's form — it mirrors S-01 only; S-02's fields
  land in a later follow-up change once S-02 ships.
- No persistence of "which runs are open" across a page reload — closing the tab loses the
  client-side slot state (the underlying `simulationRuns` rows are unaffected; this matches
  today's single-run page, which has the same property).

## Implementation Approach

A pure, framework-free run-slot manager (`src/server/simulation/run-slots.ts`) owns the
slot list, the 4-run cap, and which slot is active — unit-tested like `boids.ts`. A client
component drives one shared `requestAnimationFrame` loop that steps every `"running"` slot's
boid state each frame (via `boids.ts`'s existing pure functions) but calls the canvas draw
routine only for the active slot. The new route wires the two together with its own
(duplicated) start form and a switcher list.

## Phase 1: Run-state manager

### Overview

A pure module managing the list of run slots, enforcing the 4-run cap, and tracking which
slot is active — independently testable with no React or canvas involved.

### Changes Required

#### 1. Run-slot types and pure state transitions

**File**: `src/server/simulation/run-slots.ts`

**Intent**: Model "which runs exist, their config, their status, and which one is active" as
one plain, serializable state object with pure transition functions — the same style as
`boids.ts`'s pure stepping functions, so it's trivially unit-testable and has no hidden
mutable module state.

**Contract**: Export `RunSlot` (`runId`, `seed`, `boidCount`, `weights: FlockWeights`,
`maxDurationSeconds`, `status: "running" | "stopped"`, `score?: number`), `RunSlotsState`
(`slots: RunSlot[]`, `activeRunId: number | null`), and `MAX_PARALLEL_RUNS = 4`. Export pure
functions, each taking and returning a `RunSlotsState`:

- `addSlot(state, slot: Omit<RunSlot, "status">): RunSlotsState` — appends a new `"running"`
  slot and makes it active. If `state.slots.length >= MAX_PARALLEL_RUNS`, returns `state`
  unchanged (caller is responsible for not offering the start form at the cap — see Phase 3).
- `setActive(state, runId): RunSlotsState` — changes only `activeRunId`; no-op if `runId`
  isn't present.
- `markStopped(state, runId, score): RunSlotsState` — flips that slot's `status` to
  `"stopped"` and sets `score`; no-op if `runId` isn't present or is already `"stopped"`.
- `removeSlot(state, runId): RunSlotsState` — removes the slot **only if** its `status` is
  `"stopped"` (returns `state` unchanged for a `"running"` slot — dismissing a live
  simulation without going through `markStopped`/the server `stop` call first is not a
  supported transition). If the removed slot was active, `activeRunId` becomes the first
  remaining slot's `runId`, or `null` if none remain.

### Success Criteria

#### Automated Verification

- `npx vitest run src/server/simulation/run-slots.test.ts` passes, including:
  - `addSlot` rejects a 5th slot once 4 exist (state unchanged, cap holds).
  - `addSlot` makes the newly added slot active.
  - `setActive` changes `activeRunId` without altering any slot's other fields.
  - `markStopped` sets `status`/`score` and is a no-op on an already-`"stopped"` slot.
  - `removeSlot` is a no-op on a `"running"` slot and succeeds on a `"stopped"` one.
  - `removeSlot` reassigns `activeRunId` to a remaining slot (or `null`) when the active slot
    is removed.
- `npm run typecheck` passes.
- `npm run check` passes.

#### Manual Verification

- None for this phase — pure logic with no UI yet; Phase 3 carries the manual check.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Shared step-loop runner

### Overview

A client component holding one shared `requestAnimationFrame` loop that steps every
`"running"` slot's boid simulation state each frame, drawing only the currently active one.

### Changes Required

#### 1. Multi-run simulation stage

**File**: `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

**Intent**: Drive all running slots' physics every frame from one loop (so background runs
never stall), while only the viewed slot pays the canvas-draw cost — the architecture decision
that satisfies the PRD's "switching doesn't slow the others" guardrail.

**Contract**: A component accepting `slots: RunSlot[]`, `activeRunId: number | null`, and
callbacks `onFinished(runId, score)` (called once per slot when its `maxDurationSeconds`
elapses or its population is wiped out — same two stop conditions `simulation-canvas.tsx`
already uses) and `onStopRequested` wiring for a manual Stop action on the active slot. Holds
a `Map<runId, { boids: BoidState[]; cohesionSamples: number[]; elapsedSeconds: number }>` in a
ref, seeded via `createInitialPopulation(boidCount, createRng(seed), maxLifespan)` per slot
when it first appears in `slots`. One `requestAnimationFrame` loop: each frame, for every
slot whose `status` is `"running"`, calls `stepBoids`, pushes a cohesion sample, advances
elapsed time, and checks the two stop conditions (calling `onFinished` and the
`api.simulation.stop` mutation once, same as today's `SimulationCanvas.stop()`/`handleManualStop()`
pair). Draws to the `<canvas>` only for the entry matching `activeRunId`, using this
component's own draw routine — duplicated from, not imported from, `simulation-canvas.tsx`'s
`drawBoids` (see "What We're NOT Doing"), reusing `CANVAS_BACKGROUND`/`BOID_FILL_COLOR` from
`theme-colors.ts` by import only. Entries for slots removed from `slots` (dismissed) are
dropped from the map on the next frame.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes.
- `npm run check` passes.

#### Manual Verification

- With 2+ runs started, the non-viewed run's elapsed time (shown in Phase 3's switcher list)
  keeps advancing while a different run is being viewed — proves background stepping isn't
  paused.
- Switching the active run redraws the newly active one immediately with no restart (no
  population reset, no elapsed-time jump).

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Route & UI

### Overview

The `/simulation/multi` route itself: an independent start form (S-01's parameter set only),
a switcher list over the run slots, and the dismiss action for finished runs.

### Changes Required

#### 1. Multi-run page

**File**: `src/app/simulation/multi/page.tsx`

**Intent**: Host the `RunSlotsState` (via Phase 1's pure functions) and the duplicated start
form, wiring `api.simulation.start`'s result into `addSlot` and rendering the switcher list
plus `MultiSimulationStage`.

**Contract**: Owns `RunSlotsState` in `useState`, initialized to `{ slots: [], activeRunId: null }`.
A start form — independently duplicated from `src/app/simulation/page.tsx`'s (boid count, 3
weights, duration; same `Input`/`Button` token-based classNames, same `htmlFor`/`id` pairs,
same `MAX_BOID_COUNT = 500` clamp) — calls `api.simulation.start.useMutation`, and on success
calls `addSlot`. The form is hidden/disabled once `slots.length >= MAX_PARALLEL_RUNS`, with a
message explaining the cap. Renders a switcher list: one row per slot showing a label
(`Run <n>`), status, elapsed time or final score, a "View" action (`setActive`), and — only
for `"stopped"` slots — a "Dismiss" action (`removeSlot`). Renders `MultiSimulationStage`
below the list, passing `slots`/`activeRunId` and wiring `onFinished` to call
`api.simulation.stop.useMutation` then `markStopped`.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes.
- `npm run check` passes.
- `npx vitest run` (full suite) passes.

#### Manual Verification

- Starting 4 runs with different parameters, switching between each, confirms each keeps its
  own distinct population/behavior and none resets when switched away from and back.
- A 5th start attempt while 4 slots are occupied is blocked (form hidden/disabled, no 5th
  slot created).
- Stopping the currently-viewed run shows its score in the switcher list; the slot persists
  until "Dismiss" is clicked, at which point the slot disappears and (if it was active) another
  remaining run becomes active, or the view goes empty if none remain.
- No regression to `/simulation` (the existing single-run page) — confirms this slice truly
  touched no shared files.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests

- Run-slot cap enforcement, active-slot reassignment, stopped-only dismissal — the three
  concrete invariants this slice introduces (`run-slots.test.ts`).

### Integration Tests

- None added — the step-loop/canvas/route layers are client-rendering code with no existing
  component-test harness in this repo; covered by the manual steps below instead.

### Manual Testing Steps

1. Start 2 runs, switch between them, confirm the non-viewed one's elapsed time keeps
   advancing.
2. Start 4 runs; confirm a 5th is blocked.
3. Stop one run, confirm its score shows and the slot persists until dismissed.
4. Dismiss a stopped run, confirm the slot frees and (if needed) another becomes active.
5. Visit `/simulation` (unchanged) and confirm no regression there.

## Performance Considerations

One shared `requestAnimationFrame` loop steps up to 4 populations per frame (each an O(n²)
neighbor pass, same cost as today's single run) but draws only one — the PRD's "switching
doesn't slow the others" guardrail is satisfied by this being additive stepping cost only
(bounded by the existing 500-object-per-run cap × 4 runs), not additive drawing cost.

## Migration Notes

None — no schema changes in this slice.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-05: Parallel simulations with view
  switching.
- Prior slice (pattern to follow): `context/changes/basic-flocking-loop/plan.md`.
- Existing single-run implementation (not modified, duplicated from where needed):
  `src/app/simulation/page.tsx`, `src/app/simulation/_components/simulation-canvas.tsx`.
- Existing pure engine (imported, not modified): `src/server/simulation/boids.ts`.
- Concurrent change touching the same engine (confirmed file-disjoint with this plan):
  `context/changes/predator-prey-dynamics/plan.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Run-state manager

#### Automated

- [x] 1.1 addSlot rejects a 5th slot once 4 exist — 1b68769
- [x] 1.2 addSlot makes the newly added slot active — 1b68769
- [x] 1.3 setActive changes only activeRunId — 1b68769
- [x] 1.4 markStopped sets status/score, no-op if already stopped — 1b68769
- [x] 1.5 removeSlot no-ops on a running slot, succeeds on a stopped one — 1b68769
- [x] 1.6 removeSlot reassigns activeRunId when the active slot is removed — 1b68769
- [x] 1.7 npm run typecheck passes — 1b68769
- [x] 1.8 npm run check passes — 1b68769

### Phase 2: Shared step-loop runner

#### Automated

- [x] 2.1 npm run typecheck passes — f6e5c1d
- [x] 2.2 npm run check passes — f6e5c1d

#### Manual

- [ ] 2.3 Background run's elapsed time keeps advancing while another is viewed
- [ ] 2.4 Switching active run redraws immediately with no restart/reset

### Phase 3: Route & UI

#### Automated

- [x] 3.1 npm run typecheck passes
- [x] 3.2 npm run check passes
- [x] 3.3 npx vitest run (full suite) passes

#### Manual

- [ ] 3.4 4 runs with distinct parameters stay independent across switches
- [ ] 3.5 5th start attempt is blocked at the cap
- [ ] 3.6 Stopped run's score persists until dismissed; dismiss frees the slot
- [ ] 3.7 /simulation (existing single-run page) shows no regression
