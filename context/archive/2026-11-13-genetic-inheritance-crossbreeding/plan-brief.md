# Plan Brief: Genetic inheritance and inter-flock crossbreeding (S-03)

Full plan: `context/changes/genetic-inheritance-crossbreeding/plan.md`

## What this ships

Per-individual genes (color, steering weights, speed, lifespan, mate
preference), sexual reproduction up to the object-count cap, and a
crossbreeding on/off toggle that gates cross-flock mating — for both boids
and predators, via one shared helper.

## Key design decisions (13-question interview, grounded in research.md + user's prior Lua reference)

- Flock count is user-configurable (2-4), split evenly at spawn, fixed for life.
- Crossbreeding off = mating requires matching `flockId`; this is the gate for the PRD's named guardrail ("no blended-flock-color offspring when off").
- New per-boid `energy` field drives the reproduction trigger (energy + maturity + population-cap-not-hit).
- Mate selection: first-match-in-range, same rule for boids and predators (no scored selection).
- Predators reproduce via the identical helper as boids — not a simpler/separate mechanic.
- New tick-based maturity delay (`age` field) before reproduction eligibility.
- Population cap: silent no-op guard + a visible "population capped" UI indicator.
- `matePreference` gene adopted now (inherited/mutated) but **unused** by this slice's first-match logic — future-proofing only.
- Offspring inherit a blended `maxLifespan` gene; reproducing costs parents nothing.
- Five new start-form fields: flock count, crossbreeding toggle, energy threshold, mutation chance, mutation magnitude.
- No DB persistence of per-boid gene data — client-side live state only, same architecture as today.
- Gender is a fresh coin-flip per birth, never inherited.
- Mutation chance and mutation magnitude are two separate fields, not one combined slider.

## One plan-level call not from the interview

FR-006 text itself ("the flock only defines the starting average values... from which individuals start") settles that `FlockWeights` becomes each individual's **starting genes**, not a population-wide constant `stepBoids` reads every tick. This is the one change touching the hot steering loop, not just bookkeeping.

## Mid-implementation addition (user, during Phase 1)

User asked for "one simulation principles for every simulation I run" — multi-run must get predators, food/hunger, predation, and reproduction identically to single-run, not a boid-only subset. This reverses an earlier plan-review correction that had scoped multi-run as boid-only (because `computeMultiRunTick` called `stepBoids` directly, not `runTick`). Fixed architecturally: `multi-run-lifecycle.ts` now calls `runTick` per slot — the same function `single-run-lifecycle.ts` uses — instead of maintaining a separate boid-only tick path. `RunSlot`/`multi/page.tsx` grow the same predator/food fields as the single-run form; both forms end up with the same 14-field set (still no shared form component). `multi-simulation-stage.tsx` gains predator rendering.

## Phases (6)

1. Gene model + instance state (`boids.ts`) — genes/color/energy/age/gender fields; `stepBoids` reads per-boid genes; `inheritGenes` helper.
2. Reproduction step (`boids.ts`) — `reproducePopulation` (trigger, first-match, crossbreeding gate, cap guard), wired into `runTick` for both species.
3. Persist rng across ticks — promote from seed-time-only to a per-run stream in `simulation-canvas.tsx` and `multi-run-lifecycle.ts` (currently discarded after initial population creation).
4. Population-cap indicator — surface the `capped` flag in both run UIs.
5. Per-entity color rendering — both canvases read `genes.color` instead of the two fixed constants.
6. Run-level config surface — DB columns, zod, both start forms, prop threading.

## What's explicitly out of scope

S-04 diversity scoring / gene persistence; scored mate selection; energy/lifespan cost to reproduce; gender inheritance; raising the FR-018 cap; maturity-age/mate-distance as user-configurable; using `matePreference` in selection; a shared form component between the two start pages.

## Known risk / watch item

`stepBoids`'s signature change (global `weights` param → per-boid genes) ripples into every existing call site and test in `boids.test.ts`/`pipeline.test.ts` — Phase 1's automated criteria explicitly require updating those rather than leaving them broken.
