# Basic flocking loop (S-01) Implementation Plan

## Overview

Deliver S-01 from the roadmap: a logged-in member configures and starts a single-flock boids simulation (no predators, no genetics yet), watches it flock in real time on a canvas, stops it, and receives a survival-based score that weights elapsed time by how well the flock held cohesion — proving the configure → run → observe → score pipeline end to end before predator-prey (S-02) and genetics (S-03) are layered on top.

## Current State Analysis

Per `context/changes/basic-flocking-loop/research.md`:

- **F-01 (auth/roles)** is fully wired — NextAuth v5 middleware gates every route except `/login`/`/api/auth` (`src/middleware.ts:1-13`), `users.role` is `member`/`admin` (`src/server/db/schema.ts:45-48`), and `protectedProcedure`/`adminProcedure` exist at the tRPC layer (`src/server/api/trpc.ts:118-140`) — but **no router calls either guard yet**. `src/server/api/routers/post.ts` uses only `publicProcedure`.
- **F-02 (seeded RNG)** is a standalone mulberry32 module, `createRng(seed: number): () => number` (`src/server/simulation/rng.ts:9-20`), with no consumers outside its own test file.
- **No flocking/boids logic, canvas, or animation-loop code exists anywhere in `src/`** (confirmed by repo-wide grep in research).
- tRPC has exactly one router (`post`) registered in `src/server/api/root.ts:9-11`; Drizzle has four tables, none with `relations()` — FK-only joins via `ctx.db.query.<table>.findFirst(...)` (`src/server/db/schema.ts`, full file).

## Desired End State

A member can open the simulation page, set boid count, the three Reynolds weights (separation/alignment/cohesion), and a max run duration; start a run; watch boids flock in real time on a `<canvas>`; stop it (or let it hit the duration cap); and see a score combining elapsed survival time and average flock cohesion over the run. The run (params, seed, start/stop times, final score) is persisted in a new `simulation_run` table.

**Verification**: `npm run typecheck`, `npm run check`, and `npm test` all pass; a manual run in the browser shows boids flocking, a decaying population (placeholder lifespan), a working stop button, and a persisted score.

### Key Discoveries:

- `src/server/simulation/rng.ts:9` — `createRng(seed)` returns a `() => number` closure with the same call signature as `Math.random()`; the boid module must accept this as its only randomness source (no raw `Math.random()` calls), per F-02's determinism guarantee.
- `src/server/api/trpc.ts:118-140` — `protectedProcedure`/`adminProcedure` already exist; this plan is their first real consumer.
- `src/server/db/schema.ts:17-29` — the `posts` table is the template for a new table: `createTable(name, (d) => ({...columns}), (t) => [...indexes])`, no `relations()` helper anywhere in the file.
- `src/server/api/routers/post.ts:15-21` — mutation pattern: `async ({ ctx, input }) => { await ctx.db.insert(...).values(...) }`.

## What We're NOT Doing

- Predators, hunger, or food/resource mechanics (S-02).
- Genetic inheritance, per-boid gene variance, or crossbreeding (S-03).
- The full three-part FR-010 score formula (resource management, genetic diversity) — only the survival+cohesion component is built here; FR-010's relative weights are an open PRD question this plan does not resolve.
- Save/resume of a stopped simulation with exact-fidelity state restore (S-04) — this plan persists only the row needed to show a final score, not enough state to resume mid-run.
- Admin-defined parameter ranges / admin vs. member range enforcement (S-04's full FR-002) — the member sets parameters directly in this slice.
- Parallel simulations / switching between them (S-05).
- A real lifespan-from-genotype mechanic (FR-008/FR-006) — S-01 uses a simple fixed placeholder lifespan countdown identical for every boid, explicitly superseded by S-03.
- Cleanup or visibility for abandoned runs — if a browser tab closes mid-run without calling `stop`, the `simulation_run` row stays `status: "running"` indefinitely; no timeout, cleanup job, or run-listing feature exists in this slice to surface or reap it.

## Implementation Approach

Three phases, each independently committable and testable:

1. **Pure domain logic** (`src/server/simulation/boids.ts`) — Reynolds steering, seeded initial population via `createRng`, placeholder lifespan decay, and a cohesion-weighted score function. No DOM, no DB, no tRPC — fully unit-testable with Vitest, following the existing `rng.test.ts` pattern.
2. **Persistence + API** — a new `simulation_run` Drizzle table and a `simulation` tRPC router (`start`/`stop` as `protectedProcedure` mutations) that issues a seed, records the run, and computes/stores the final score by replaying the Phase 1 math server-side at stop time (the server never ticks the loop live — it only needs the final state the client reports to recompute/verify the score).
3. **UI** — a client component with a parameter form, a `<canvas>` + `requestAnimationFrame` loop that owns the live simulation state (ticking the Phase 1 boid-step function each frame, authoritative over positions), wired to the Phase 2 `start`/`stop` procedures, and a results view showing the final score on stop.

The client owns the authoritative per-frame simulation state (per the "client-side loop" decision); the server's role is issuing the seed/params at `start` and persisting the final reported state + score at `stop`. To keep the stored score trustworthy without a full server-side replay architecture, `stop` recomputes the score from the same pure Phase 1 function given the client's reported final boid states and elapsed ticks — the scoring function itself is pure and deterministic, so server and client produce the same number from the same inputs.

## Phase 1: Simulation core domain logic

### Overview

Pure, dependency-free boid simulation math: steering, population seeding, lifespan decay, and the cohesion-weighted score — all unit-tested, none of it touching canvas, DB, or network.

### Changes Required:

#### 1. Boid simulation module

**File**: `src/server/simulation/boids.ts`

**Intent**: Implement the classic Reynolds flocking rules (separation, alignment, cohesion) as a single per-tick step function operating on an array of boid states, plus a placeholder lifespan countdown and a cohesion-weighted survival score. Deterministic: all randomness flows through an injected RNG (`createRng`'s returned closure), never `Math.random()`.

**Contract**:
- `type BoidState = { x: number; y: number; vx: number; vy: number; lifespan: number }`
- `createInitialPopulation(count: number, rng: () => number, maxLifespan: number): BoidState[]` — seeds `count` boids at pseudo-random positions/velocities via `rng`, each starting at `maxLifespan`.
- `type FlockWeights = { separation: number; alignment: number; cohesion: number }`
- `stepBoids(boids: BoidState[], weights: FlockWeights, dtSeconds: number): BoidState[]` — returns a new array: each boid's velocity adjusted by the three weighted Reynolds rules relative to its neighbors, position advanced by velocity × `dtSeconds`, `lifespan` decremented by `dtSeconds`. Boids whose `lifespan` reaches `<= 0` are removed from the returned array (this is the placeholder "survival end" mechanic).
- `computeCohesion(boids: BoidState[]): number` — returns a single 0–1 value per tick: 1.0 means every boid is at the flock's centroid, decreasing as average inter-boid distance from centroid grows (normalize by a fixed reference radius so the metric doesn't depend on canvas size).
- `computeScore(cohesionSamples: number[], elapsedTicks: number): number` — `elapsedTicks * average(cohesionSamples)`. Both inputs are pure data (no boid objects), so this is callable identically client-side (live) and server-side (at stop, from the client's reported samples).

#### 2. Unit tests

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Cover the properties that matter for correctness and determinism, mirroring `rng.test.ts`'s style (pure function tests, no mocking).

**Contract**: Test cases —
- same seed → `createInitialPopulation` produces an identical population twice.
- `stepBoids` is deterministic: same input array + weights + dt → identical output array.
- a boid's `lifespan` decreases by exactly `dtSeconds` per step and the boid is removed once it reaches `<= 0`.
- `computeCohesion` returns `1.0` (or the defined maximum) when all boids share one position, and a lower value when boids are spread out.
- `computeScore` is monotonically increasing in both `elapsedTicks` and average cohesion, holding the other fixed.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Unit tests pass: `npx vitest run src/server/simulation/boids.test.ts`

#### Manual Verification:

- None — this phase has no observable surface outside its own tests.

---

## Phase 2: Persistence + tRPC router

### Overview

A new `simulation_run` table and a `simulation` router exposing `start` (issues seed+params, inserts a `running` row) and `stop` (accepts the client's final boid/cohesion samples, computes the score via Phase 1's `computeScore`, updates the row to `stopped` with the score).

### Changes Required:

#### 1. Drizzle schema

**File**: `src/server/db/schema.ts`

**Intent**: Add a `simulation_run` table recording one S-01 run per row: who started it, what parameters/seed it used, and its outcome.

**Contract**: New table via `createTable("simulation_run", (d) => ({...}))`, following the `posts` table's shape (`schema.ts:17-29`) and the `accounts`/`sessions` FK-with-cascade convention (`schema.ts:56-58`) — no `relations()` helper, consistent with the rest of the file. Columns: `id` (integer PK autoincrement), `userId` (text, FK → `users.id`, `onDelete: "cascade"`), `seed` (integer, not null), `boidCount` (integer, not null), `separationWeight`/`alignmentWeight`/`cohesionWeight` (real, not null), `maxDurationSeconds` (integer, not null), `status` (text enum `["running", "stopped"]`, not null, default `"running"`), `score` (real, nullable — set only on stop), `startedAt` (integer `mode: "timestamp"`, default `sql\`(unixepoch())\``, not null), `stoppedAt` (integer `mode: "timestamp"`, nullable).

#### 2. Simulation router

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Expose `start` and `stop` as the project's first `protectedProcedure` consumers — defense in depth per FR-001, independent of the page-level middleware gate.

**Contract**:
- `start`: `protectedProcedure.input(z.object({ boidCount: z.number().int().positive().max(500), separationWeight: z.number(), alignmentWeight: z.number(), cohesionWeight: z.number(), maxDurationSeconds: z.number().int().positive() })).mutation(...)` — `boidCount`'s `.max(500)` mirrors Phase 3's hardcoded UI clamp so the FR-018 rendering-freeze guardrail holds regardless of caller, not just through the form. Generates a fresh integer seed (e.g. `Date.now() ^ Math.floor(Math.random() * 2**31)` — this seed-generation step itself is not part of the deterministic simulation and is exempt from F-02's determinism guarantee, same as the existing dev-latency `Math.random()` call at `trpc.ts:91`), inserts a `simulation_run` row with `status: "running"` and `userId: ctx.session.user.id`, returns `{ runId, seed }`.
- `stop`: `protectedProcedure.input(z.object({ runId: z.number(), elapsedTicks: z.number().nonnegative(), cohesionSamples: z.array(z.number().min(0).max(1)).min(1) })).mutation(...)` — the `.min(0).max(1)` per-sample bound mirrors `computeCohesion`'s own 0–1 contract, and `.min(1)` on the array prevents an empty-array `average()` call from producing a `NaN` score. Loads the row, verifies `userId === ctx.session.user.id` (throw `FORBIDDEN` otherwise) and `status === "running"` (throw `BAD_REQUEST` otherwise), clamps `elapsedTicks` to the row's own `maxDurationSeconds` (plus a small fixed tolerance, e.g. 1 extra tick, to absorb the client's last rAF frame landing just past the cap) before scoring — bounding how far a caller can inflate the score by over-reporting elapsed time. Computes `score = computeScore(cohesionSamples, clampedElapsedTicks)` via Phase 1's function, updates the row to `status: "stopped"`, `score`, `stoppedAt: now`, returns `{ score }`.

#### 3. Router registration

**File**: `src/server/api/root.ts`

**Intent**: Register the new router alongside `post`, per this file's existing manual-registration convention (`root.ts:6-7, 9-11`).

**Contract**: Add `simulation: simulationRouter` to the `createTRPCRouter({...})` call; import `simulationRouter` from `~/server/api/routers/simulation`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Schema migration applies cleanly: `npm run db:push`

#### Manual Verification:

- Calling `simulation.start` via a logged-in session returns a `runId` and `seed`, and inserts a visible row (checked via `npm run db:studio`).
- Calling `simulation.stop` with that `runId` updates the row's `status` to `stopped` and sets a non-null `score`.
- Calling either procedure without a session throws `UNAUTHORIZED`.
- Calling `simulation.stop` on a run started by a different user throws `FORBIDDEN`.

---

## Phase 3: UI — setup screen + canvas render loop

### Overview

A client page where a member sets parameters, starts a run, watches boids flock on canvas in real time, stops the run, and sees the final score.

### Changes Required:

#### 1. Simulation page

**File**: `src/app/simulation/page.tsx`

**Intent**: Host the parameter form and the canvas/run UI as a client component (this page needs `requestAnimationFrame` and canvas refs, both client-only).

**Contract**: A `"use client"` component rendering a form (boid count, 3 weights, max duration) and, once started, a `<canvas>` plus a Stop button and a score display area. No route param or dynamic segment needed — single static page.

#### 2. Simulation run hook/component

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Own the live `BoidState[]` and cohesion-sample history in local state/refs, drive a `requestAnimationFrame` loop calling Phase 1's `stepBoids`/`computeCohesion` each frame, draw each boid as a simple shape on the canvas each frame, and stop automatically once `maxDurationSeconds` elapses or the population reaches zero.

**Contract**: Receives `seed`, `boidCount`, `FlockWeights`, `maxDurationSeconds`, and a `runId` as props from the page; on mount, calls `createInitialPopulation(boidCount, createRng(seed), ...)` and starts the rAF loop; on each tick, appends the current `computeCohesion(...)` value to a local samples array; uses `const stopRun = api.simulation.stop.useMutation()` at the component's top level (matching the hook-based pattern in `src/app/_components/post.tsx:12`, since the `createTRPCReact` client only exposes procedures as hooks, not as bare callables), and on Stop (manual or automatic) calls `stopRun.mutate({ runId, elapsedTicks, cohesionSamples })` and renders the returned score from `stopRun.data`. Enforces FR-018's object-count guardrail by clamping `boidCount` client-side to a fixed sane maximum (e.g. 500) in the form before `start` is ever called — this slice has no admin-configurable cap (that's S-04's FR-002/FR-018 full admin split); the maximum is a hardcoded constant for S-01.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- Boids visibly flock (move as a cohesive group, not randomly scattered) on starting a run.
- The population visibly shrinks over a run as the placeholder lifespan counts down.
- Stopping a run (manually or via the duration cap) shows a numeric score and the canvas loop stops.
- A run with a boid count at the clamped maximum does not visibly freeze or drop to an unusable frame rate.
- Starting a run while logged out is impossible (page itself is gated by `src/middleware.ts`; direct `start`/`stop` calls are rejected per Phase 2's manual checks).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/server/simulation/boids.test.ts` — determinism, lifespan decay, cohesion range, score monotonicity (Phase 1).

### Integration Tests:

- None added in this plan — Phase 2's `start`/`stop` procedures are covered by Manual Verification only, per the agreed testing-approach decision (unit-test the math, leave procedure wiring and canvas rendering to manual checks).

### Manual Testing Steps:

1. Log in, navigate to `/simulation`, set parameters, start a run.
2. Observe flocking behavior and population decline over ~10–20 seconds.
3. Stop the run manually; confirm a score appears and the row in `db:studio` shows `status: stopped` with a non-null `score`.
4. Start a second run with the same seed-independent parameters; confirm it's visually similar in flocking behavior but not pixel-identical (seed differs run to run since `start` generates a fresh seed each time).
5. Attempt to call `stop` twice on the same run (e.g. via a second click) and confirm the second call is rejected (`status` is no longer `"running"`).

## Performance Considerations

FR-018's rendering-freeze guardrail is addressed by a hardcoded client-side boid-count maximum (see Phase 3) rather than an admin-configurable one — S-04 owns making this limit admin-configurable per the full FR-002/FR-018 split.

## Migration Notes

Not applicable — `simulation_run` is a new table with no prior data to migrate.

## References

- Related research: `context/changes/basic-flocking-loop/research.md`
- F-01 pattern reference: `context/archive/2026-11-10-gate-product-routes/plan.md`
- F-02 pattern reference: `context/archive/2026-11-10-deterministic-seed-strategy/plan.md`, `src/server/simulation/rng.ts:1-21`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Simulation core domain logic

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 200fd51
- [x] 1.2 Linting passes: `npm run check` — 200fd51
- [x] 1.3 Unit tests pass: `npx vitest run src/server/simulation/boids.test.ts` — 200fd51

### Phase 2: Persistence + tRPC router

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Schema migration applies cleanly: `npm run db:push`

#### Manual

- [x] 2.4 `simulation.start` with a logged-in session returns `runId`/`seed` and inserts a visible row
- [x] 2.5 `simulation.stop` updates the row to `stopped` with a non-null `score`
- [x] 2.6 Calling either procedure without a session throws `UNAUTHORIZED`
- [x] 2.7 Calling `simulation.stop` on another user's run throws `FORBIDDEN`

### Phase 3: UI — setup screen + canvas render loop

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`

#### Manual

- [ ] 3.3 Boids visibly flock as a cohesive group on starting a run
- [ ] 3.4 Population visibly shrinks over a run as placeholder lifespan counts down
- [ ] 3.5 Stopping a run shows a numeric score and halts the canvas loop
- [ ] 3.6 A run at the clamped max boid count does not visibly freeze
- [ ] 3.7 Logged-out access to `/simulation` and direct `start`/`stop` calls are both rejected
