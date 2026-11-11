# Parallel Simulation Switching — Plan Brief

> Full plan: `context/changes/parallel-sim-switching/plan.md`

## What & Why

Let a user run up to 4 simulations in parallel on a new `/simulation/multi` route and switch
which one they're actively viewing, without interrupting or slowing the others. Roadmap
slice S-05, PRD FR-013/FR-014 — the PRD itself flags this as the MVP's most expensive element,
consciously accepted. Purely client-side; no server/schema changes.

## Starting Point

`/simulation/page.tsx` + `SimulationCanvas` support exactly one run at a time: one
`requestAnimationFrame` loop per run, mounted/unmounted via a React `key`. `api.simulation.start`/
`stop` are already per-run procedures, so nothing on the server needs to change.

## Desired End State

On `/simulation/multi`, a user starts up to 4 runs, each with its own boid count/weights/
duration. A switcher list shows every slot's status/elapsed-time/score; clicking one makes it
the viewed canvas. All running slots keep stepping physics every frame regardless of which is
viewed — only the viewed one actually draws. A finished run's score stays visible until
explicitly dismissed, freeing that slot.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Step-loop architecture | Single shared RAF loop stepping all runs, drawing only the active one | User confirmed only one canvas is ever displayed at a time — this is the cheapest option, not a compromise | Plan |
| Max parallel runs | 4 | Keeps worst-case total simulated objects bounded and the switcher UI simple | Plan |
| Background-run rendering | Skip drawing entirely for non-viewed runs | Canvas drawing (depth-sort) is real per-frame cost; skipping it for N-1 runs is what keeps switching cheap | Plan |
| Form & draw-routine reuse | Independent duplicates, not shared/extracted | Extracting a shared component would touch exactly the files S-02 is concurrently editing — the whole point of scoping S-05 as a new route | Plan |
| Form parameter scope | S-01's parameter set only (no predator fields) | S-05 depends only on S-01 on the roadmap; anticipating S-02's still-being-planned fields risks drift | Plan |
| Finished-run slot lifecycle | Stays until explicitly dismissed | Matches the existing single-run page's score-display pattern; no surprise disappearance of an unseen result | Plan |
| Testing | Unit-test the pure run-slot manager | The 4-run cap and active-slot switching are concrete invariants cheaply covered without a component-test harness this repo doesn't have | Plan |

## Scope

**In scope:**
- Pure run-slot state manager (cap, active selection, stopped-only dismissal) with unit tests
- Single shared step loop driving up to 4 concurrent simulations
- New `/simulation/multi` route: duplicated start form, switcher list, stop/dismiss wiring

**Out of scope:**
- Any edit to `page.tsx`, `simulation-canvas.tsx`, `boids.ts`, `schema.ts`, `simulation.ts`,
  `theme-colors.ts` — all concurrently owned by S-02's plan
- Shared form/draw-routine extraction
- Live thumbnail previews for background runs
- Predator/food parameters in the new form
- Persisting open-slot state across a page reload

## Architecture / Approach

A pure, framework-free `run-slots.ts` module owns slot list/cap/active-selection (unit
tested like `boids.ts`). A client component drives one `requestAnimationFrame` loop stepping
every `"running"` slot's boid state each frame via `boids.ts`'s existing pure functions,
drawing only the active slot. The route wires the two together with its own duplicated form.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Run-state manager | Pure slot model: cap, active selection, stopped-only dismissal, unit tests | None significant — pure logic, fully testable |
| 2. Shared step-loop runner | One RAF loop stepping all runs, drawing only the active one | Getting background-run stepping genuinely un-paused (not silently frozen while unviewed) is the one thing manual testing must catch |
| 3. Route & UI | `/simulation/multi` page: duplicated form, switcher list, stop/dismiss | File independence from S-02's concurrent edits must hold — any accidental touch to a shared file reopens the merge-conflict risk this scoping exists to avoid |

**Prerequisites:** S-01 (`basic-flocking-loop`) done — confirmed by the roadmap. No dependency
on S-02/S-03/S-04.
**Estimated effort:** ~3 sessions across 3 phases, similar scope to S-01/S-02.

## Open Risks & Assumptions

- Assumes 4 concurrent full-population runs (up to 500 boids each) stays within acceptable
  frame budget on the stepping side alone (no drawing) — if manual testing shows otherwise,
  lowering `MAX_PARALLEL_RUNS` is a one-constant fix, not a redesign.
- The duplicated form/draw-routine is an accepted, named tradeoff (see "What We're NOT
  Doing") — a future cleanup slice could extract shared code once S-02/S-03/S-04 have landed
  and page.tsx has stabilized.

## Success Criteria (Summary)

- A user can run 4 simulations in parallel and switch which is viewed without resetting or
  pausing the others.
- A 5th concurrent run is blocked.
- No regression to the existing single-run `/simulation` page.
