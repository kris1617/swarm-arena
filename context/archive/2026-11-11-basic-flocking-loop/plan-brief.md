# Basic flocking loop (S-01) — Plan Brief

> Full plan: `context/changes/basic-flocking-loop/plan.md`
> Research: `context/changes/basic-flocking-loop/research.md`

## What & Why

S-01 is the roadmap's north star: the smallest end-to-end slice that proves configure → run → observe → score actually works, before predators (S-02) or genetics (S-03) add complexity. A member sets flocking parameters, starts a run, watches a single flock of boids move in real time, stops it, and gets a score — nothing here depends on mechanics that don't exist yet.

## Starting Point

F-01 (auth/roles) and F-02 (seeded RNG, `src/server/simulation/rng.ts`) are both implemented and committed but have zero consumers — this plan is the first thing to use either. No flocking, canvas, or simulation-loop code exists anywhere in the repo today.

## Desired End State

A logged-in member opens `/simulation`, sets boid count / 3 Reynolds weights / max duration, starts a run, watches boids flock on a `<canvas>`, stops it (or lets the duration cap end it), and sees a score weighting elapsed survival time by how well the flock held cohesion. The run is persisted in a new `simulation_run` table.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Flocking algorithm | Classic Reynolds (separation/alignment/cohesion) | Matches FR-002's named weight parameters and the PRD's own definition of "boids" | Plan |
| Survival-end mechanic | Placeholder fixed lifespan countdown (every boid, uniform) | Gives a real population-decline signal now; explicitly superseded once FR-008/genetics (S-03) define real lifespan | Plan |
| Rendering | Raw `<canvas>` + `requestAnimationFrame` | Zero new dependencies, full control over a loop that must stay deterministic | Plan |
| Loop authority | Client-side; server only issues seed/params and records stop+score | No network latency in the render loop — meets the "no freezing" NFR for a single local user | Plan |
| Persistence | New `simulation_run` table now | User asked for a real row rather than deferring all persistence to S-04 | Plan |
| Procedure gating | `protectedProcedure` for `start`/`stop` | Defense in depth beyond page-level middleware; first real use of the existing guard | Plan |
| Score formula | `elapsedTicks × average(cohesionSamples)` | User flagged that raw elapsed time alone doesn't capture flock stability; cohesion is the only real stability signal available with one flock and no predators/genetics | Plan |
| Exposed parameters | Boid count, 3 Reynolds weights, max duration | Every other FR-002 parameter belongs to a mechanic (predators/food/genetics) this slice doesn't implement | Plan |
| Testing | Unit-test pure boid/cohesion/lifespan math; canvas/loop verified manually | Matches the existing `rng.test.ts` pattern — no DOM/canvas mocking precedent in this codebase | Plan |

## Scope

**In scope:**
- Reynolds-style flocking for a single flock, seeded via `createRng`
- Placeholder lifespan-driven population decline
- Cohesion-weighted survival score, computed identically client- and server-side
- `simulation_run` persistence and a `protectedProcedure`-gated `simulation` router
- Canvas rendering of the live run with start/stop controls

**Out of scope:**
- Predators, food/resources, genetic inheritance, crossbreeding (S-02/S-03)
- The full 3-part FR-010 score formula (resource management, genetic diversity) and its relative weights (open PRD question)
- Exact-fidelity save/resume (S-04)
- Admin-configurable parameter ranges and object-count cap (S-04's full FR-002/FR-018 split) — S-01 uses a hardcoded max boid count
- Parallel simulations (S-05)

## Architecture / Approach

Three phases, each independently testable: (1) pure domain math — steering, lifespan, cohesion, score — fully unit-tested and framework-free; (2) a new Drizzle table plus a `simulation` tRPC router exposing gated `start`/`stop` mutations, with `stop` recomputing the score server-side from the client's reported samples using the same pure function; (3) a client page with a parameter form and a `requestAnimationFrame`-driven canvas loop that owns live simulation state and calls `start`/`stop` at the right moments.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Simulation core domain logic | Pure, unit-tested boid/cohesion/score math | Getting the Reynolds steering math wrong is invisible until Phase 3's visual check |
| 2. Persistence + tRPC router | `simulation_run` table, gated `start`/`stop` procedures | First real use of `protectedProcedure` — auth edge cases need the manual checks |
| 3. UI — setup screen + canvas loop | Working end-to-end run: form → canvas → stop → score | Canvas/rAF performance at higher boid counts has no automated coverage, only manual |

**Prerequisites:** F-01 and F-02 (both done).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- The placeholder lifespan mechanic is explicitly throwaway — S-03 will replace it with genotype-driven lifespan (FR-006/FR-008), and this plan accepts that rework cost deliberately per the user's choice.
- No external research (Exa/Context7) was done on boids algorithm variants or canvas libraries — the Reynolds/raw-canvas choices are justified from first principles and existing codebase constraints only, not verified against external sources.
- `start`'s seed-generation step uses `Math.random()` (not `createRng`) since the seed itself isn't part of the deterministic sequence being guaranteed — consistent with the one other `Math.random()` call already accepted as out-of-scope for F-02 (`src/server/api/trpc.ts:91`).
- The hardcoded max-boid-count constant (Phase 3) is a stand-in for FR-018's admin-configurable cap, which S-04 must formalize.

## Success Criteria (Summary)

- A member can start, watch, stop, and score a single-flock boids run end to end.
- The score reflects both survival time and flock cohesion, not just a stopwatch.
- The run is persisted and visible in the database after stopping.
