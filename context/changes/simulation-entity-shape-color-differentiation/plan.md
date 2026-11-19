# Give boids, predators, and food distinct shapes and colors Implementation Plan

## Overview

Boids (triangle) and predators (diamond) already differ subtly in shape and color; food has zero visual representation today — it's a scalar pool number, never drawn. This plan adds food as a real, positioned, spatially-eaten entity: boids actively forage for and consume discrete food items (replacing the old background rate-based consumption), each eaten item gives the eating boid a direct energy boost, and food renders as a universal-colored circle — visually distinct from both existing oriented polygons. This is a genuine simulation-mechanics change, not just a rendering addition.

## Current State Analysis

- Food is currently a pure scalar (per-tribe-shared) pool with zero spatial concept anywhere in the codebase (confirmed via broad grep, zero hits for any food-position-shaped identifier) — see `research.md`.
- Consumption today is a pure per-tick rate formula (`applyHunger`, `boids.ts:1289-1323`): `totalConsumption = Σ tribeConfigs[boid.genes.flockId].foodConsumptionRate` across all live boids; `nextFoodStock = foodStock - totalConsumption·dt + foodRegenRate·dt`. If the result goes negative, `HUNGER_EXTRA_DECAY_RATE` (`:223`, value `1`) applies extra lifespan decay to every boid.
- Boid energy already has an **ambient food-availability coupling** that this plan does not touch and must preserve: `boid.energy + ENERGY_GAIN_RATE * dt * foodAvailabilityRatio - drain` (`boids.ts:1680`), where `foodAvailabilityRatio = Math.max(0, nextFoodStock / foodStockInitial)` (`:1645`). Because this plan keeps the scalar `foodStock` pool (see below), this line needs **no changes at all** — it keeps scaling ambient energy gain exactly as today, automatically, off whatever `foodStock` the new discrete-eating model produces.
- Predators do **not** interact with the food pool at all — their energy gain is a flat `ENERGY_GAIN_RATE * dt` (`boids.ts:1691`, no `foodAvailabilityRatio` term); predators hunt boids via the separate `applyPredation` mechanic. This plan scopes food-eating to boids only, matching the existing consumption formula's own scope ("per live boid").
- `BoidState`/`PredatorState` (`boids.ts:123-158`) have no `id` field — tracked by array index. The spatial-hash grid (`spatial-grid.ts:63-68`) is fully generic via a `getPosition` extractor and already works for both entity types.
- Exactly one shared tick entry point (`computeSingleRunTick`, `single-run-lifecycle.ts:27`) feeds both the client-staged and server-owned execution paths — a change inside `runTick` (`boids.ts:1515`) covers both automatically.
- Rendering (`drawScene`, `simulation-canvas.tsx:210-262`) is one shared function, called directly by the minimap and by the server-run live view — a food-rendering addition here is automatically picked up everywhere.
- Full detail, file:line citations, and the architecture-insight framing: see `context/changes/simulation-entity-shape-color-differentiation/research.md`.

## Desired End State

A simulation run shows boids (triangle), predators (diamond), and food (circle) as three visually distinct entity kinds, each in its own color. Food items appear gradually as the regen-driven spawn accumulates (none at run start), scattered randomly within the world bounds. A boid that comes within a fixed radius of a food item consumes it — the item disappears, the shared food-stock pool decrements by that boid's own tribe's `foodConsumptionRate`, and that boid gets a direct energy boost. The existing starvation safety net still fires, now triggered when the stock is at zero **and** no food items exist to be reached. Save/resume preserves food-item positions; a run saved before this change resumes cleanly with zero food items (falls back gracefully, matching this project's own established precedent for new sample-array fields).

### Key Discoveries:

- Keeping the scalar `foodStock` pool (rather than replacing it with pure item-counting) is load-bearing, not a legacy leftover: it's what the existing ambient `foodAvailabilityRatio` energy-scaling (`boids.ts:1680`) and the existing resource-management score factor (`foodRatioSamples`-based) both read — this plan's new discrete items are a spatial *layer* on top of that scalar, not a replacement for it.
- `foodConsumptionRate` is reinterpreted as "value of one eaten item for that tribe," read at the **eating boid's own tribe** (not an item-origin tribe) — this is an exact, direct carry-over of today's existing semantic (the rate is already a property of the eater's tribe membership, not of a per-tribe sub-pool), just now triggered per-eat-event instead of continuously every tick. Food items themselves carry no tribe tag and need none.
- `ENERGY_GAIN_RATE = 10`, `ENERGY_MAX = 100` (`boids.ts:236,244`) — the "few seconds' worth" energy-boost decision (per-item boost ≈ a few seconds of passive gain) resolves to a concrete `FOOD_ENERGY_BOOST = ENERGY_GAIN_RATE * 4` (= 40, 40% of `ENERGY_MAX`) as a starting value — explicitly a tuning starting point to verify empirically during manual verification, not a guaranteed-correct balance number.

## What We're NOT Doing

- Not implementing lifecycle-stage color fading for any entity (boid/predator/food) — that's a separate, already-roadmapped slice (`S-45: lifecycle-stage-color-fade`), sequenced after this one.
- Not porting the Lua reference's food decay-timer/shrink mechanic — food items in this plan persist until eaten; no natural decay/despawn exists yet (decay-driven visual fade is S-45's job, decay-driven despawn is explicitly out of scope here).
- Not letting predators eat food items — predators' energy/hunting mechanic (`applyPredation`, boid-hunting) is untouched; food-eating is boid-only, matching the existing consumption formula's own scope.
- Not adding a new admin-configurable range for the eating radius — it's a fixed constant, matching how `NEIGHBOR_RADIUS` and other engine-tuning constants are already defined (not admin-configurable either).
- Not adding a deliberate population-growth-rate regression test specifically guarding against the energy-boost's double-buffing risk — the user's explicit choice; this risk is accepted and will be visible during this phase's own manual verification (watch population dynamics on a real run) rather than a dedicated automated guard.
- Not changing `applyPredation` or any predator-side mechanic.
- Not adding a new DB migration — `savedState` is already a JSON blob column; adding `foodItems` to its shape is a type-level change, not a schema-level one.

## Implementation Approach

Three layers, in dependency order: engine mechanics first (the new spawn/eat/energy logic, unit-tested in isolation), then persistence (threading the new `foodItems` array through the existing save/resume snapshot, following the established `?? []` fallback precedent), then rendering (a new shape/color in the one shared `drawScene` function, picked up automatically by the minimap and both execution paths' call sites). Manual, end-to-end verification closes out the change.

## Phase 1: Engine mechanics

### Overview

Add food as a positioned entity with regen-driven spawning and proximity-based eating, replacing the old background rate-consumption formula while preserving the ambient `foodAvailabilityRatio` energy coupling and the starvation safety net.

### Changes Required:

#### 1. `FoodState` type and constants

**File**: `src/server/simulation/boids.ts`

**Intent**: Define the new positioned entity type and the constants this phase needs, next to the existing `BoidState`/`PredatorState` types and their sibling constants (`NEIGHBOR_RADIUS`, `FOOD_CONSUMPTION_PER_BOID`, `HUNGER_EXTRA_DECAY_RATE`, `ENERGY_GAIN_RATE`).

**Contract**: `FoodState = { x: number; y: number; z: number }` — no `id` field, tracked by array index (matching `BoidState`/`PredatorState`'s own convention). New constants: `FOOD_EAT_RADIUS` (fixed, similar scale to `NEIGHBOR_RADIUS=70`), `FOOD_ITEM_DISPLAY_VALUE` (the stock-per-item reference used only to derive how many items to show — independent from the per-tribe eating value), `FOOD_ENERGY_BOOST = ENERGY_GAIN_RATE * 4`.

#### 2. Regen-driven spawning

**File**: `src/server/simulation/boids.ts` (inside `runTick` / the `applyHunger`-equivalent region, `:1289-1323`)

**Intent**: Replace the old aggregate rate-consumption with regen-only accumulation that spawns new food items at a threshold, random-positioned within the run's world bounds (`xyArea`/`zDepth`), capped by the combined entity count.

**Contract**: Accumulate regen (the existing `foodRegenRate`-derived addition, unchanged in magnitude) into `foodStock` as today. Track how much of that regen hasn't yet produced a visible item (a running remainder, not reset when capped — so backlog is never lost, just delayed). Every time the remainder crosses `FOOD_ITEM_DISPLAY_VALUE`, spawn one new `FoodState` at a random position within the run's world bounds — but only if `boids.length + predators.length + foodItems.length < maxObjectCount` (the existing combined cap, now extended to include food); if at the cap, leave the remainder accumulated for the next tick that has room.

#### 3. Proximity-based eating

**File**: `src/server/simulation/boids.ts` (same region)

**Intent**: Replace the old per-tick aggregate consumption with a per-boid proximity check: a boid within `FOOD_EAT_RADIUS` of a food item consumes it.

**Contract**: For each live boid, query nearby food items via the existing generic spatial-hash grid (`spatial-grid.ts`'s `buildSpatialGrid`/`queryRadius`, extended to also index the food array by its `x/y/z`). On a hit within `FOOD_EAT_RADIUS`: remove that one food item from the array, decrement `foodStock` by `tribeConfigs[boid.genes.flockId]?.foodConsumptionRate ?? FOOD_CONSUMPTION_PER_BOID` (the exact existing per-tribe lookup, now applied per-eat-event instead of aggregated per-tick across the whole population), and add `FOOD_ENERGY_BOOST` to that boid's `energy` (clamped to `ENERGY_MAX`, same clamp pattern as the existing energy update at `:1675-1683`). A boid eats at most one item per tick.

**Blast radius (plan-review F1)**: this replaces the exact formula 5 existing tests hardcode — these are not optional cleanup, they are required for Phase 1's own "full suite passes" success criterion to be achievable at all:
- `boids.test.ts:1637` ("applies extra decay only when foodStock goes negative")
- `boids.test.ts:1656` (asserts exact `foodStock` deltas from the per-tribe rate formula)
- `boids.test.ts:1697` ("reproduces today's exact flat-rate behavior byte-for-byte")
- `boids.test.ts:3208` (another direct `applyHunger(...)` call)
- `pipeline.test.ts:320-376` ("documented hunger-before-predation order" + swapped-order variant, asserting literal `foodStock` values computed from the current formula)

Rewrite each to assert the new proximity-based behavior (or remove/replace if the old assertion has no equivalent under the new model). Confirmed via grep: no other production call site of `applyHunger` exists — blast radius is fully confined to these two test files plus `runTick` itself.

#### 4. Starvation safety-net retrigger condition

**File**: `src/server/simulation/boids.ts` (same region)

**Intent**: Preserve `HUNGER_EXTRA_DECAY_RATE`'s existing extra-lifespan-decay effect, adapting its trigger from "the old rate formula went negative" to "the pool is empty and nothing is reachable to eat."

**Contract**: Apply `HUNGER_EXTRA_DECAY_RATE * dtSeconds` extra lifespan decay to every live boid when `foodStock <= 0 AND foodItems.length === 0` (both conditions, not either alone — a nonzero stock with momentarily zero visible items, e.g. just before the next spawn threshold, should not trigger starvation). The existing lifespan-decay application and the `lifespan <= 0` filter (`:1321-1323`) stay otherwise unchanged.

#### 5. Thread `foodItems` through tick state

**File**: `src/server/simulation/boids.ts`, `src/server/simulation/single-run-lifecycle.ts`, `src/server/simulation/server-run-registry.ts`

**Intent**: Add the new array to every tick-state/params type that currently carries `foodStock`, so both execution paths (via the shared `computeSingleRunTick` entry point) get the new field automatically.

**Contract**: Add `foodItems: FoodState[]` alongside the existing `foodStock: number` field in `runTick`'s state param, the client-staged tick-state (`single-run-lifecycle.ts:31`), and the server-owned live run object (`server-run-registry.ts:126`). Initialize to `[]` at run creation (per the "build up gradually from empty" decision — `foodStockInitial`'s scalar value starts non-zero as today, but no items are visible until regen accumulates past the first `FOOD_ITEM_DISPLAY_VALUE` threshold; this scalar/visible discrepancy for the opening stretch of a run is a deliberate, explicit tradeoff, not a bug).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New/rewritten unit tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/pipeline.test.ts` covering: regen accumulates and spawns an item at the threshold; spawning respects the combined object-count cap and preserves backlog when capped; a boid within `FOOD_EAT_RADIUS` consumes the nearest item, decrementing `foodStock` by its own tribe's rate and gaining `FOOD_ENERGY_BOOST`; the starvation accelerant fires only when both `foodStock <= 0` and `foodItems.length === 0`, not when either alone is true; predators never consume food items. Also rewrites the 5 existing tests named in "Blast radius" above, which hardcode the formula being replaced.
- Full suite still passes: `npm test`

#### Manual Verification:

- None for this phase — covered by Phase 4's end-to-end check.

---

## Phase 2: Persistence

### Overview

Thread the new `foodItems` array through save/resume, following this project's own established precedent for adding a new array field to the snapshot.

### Changes Required:

#### 1. `ServerRunSnapshot` and snapshot/resume functions

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Persist and restore food-item positions across save/pause/resume, with a graceful fallback for runs saved before this change — the exact pattern already used for `tribeFoodImbalanceSamples` (`:988-990`).

**Contract**: Add `foodItems: FoodState[]` to the `ServerRunSnapshot` type (`:980-1008`). `snapshotServerRun` (`:1014-1043`) includes the live run's current `foodItems`. `resumeServerRun` (`:1049+`) restores it with a `?? []` fallback for snapshots saved before this field existed.

#### 2. Live-push payload (watch subscription)

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The server-run live view's SSE push currently streams boids/predators per tick; it needs to stream the current `foodItems` array the same way, or the live canvas will never see food positions even though they exist in the live run object.

**Contract**: Add `foodItems: FoodState[]` to `LiveRunSnapshot` (`:200-225`) alongside its existing `boids`/`predators`/`foodStock` fields — this is the exact type `watchServerRun` (`:1158`) yields via `getLiveRunState` (`:227`), confirmed during plan-review (F3) as the right site.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Save/resume round-trip test passes (new or extended test confirming a run saved mid-flight with nonzero `foodItems` resumes with the same positions, and a run whose `savedState` predates this change — a fixture with no `foodItems` key — resumes with an empty array, not a crash)
- Full suite still passes: `npm test`

#### Manual Verification:

- None for this phase — covered by Phase 4's end-to-end check.

---

## Phase 3: Rendering

### Overview

Give food a visual identity in the one shared rendering pipeline — picked up automatically by the minimap and both execution paths' canvases.

### Changes Required:

#### 1. Food seed color

**File**: `src/server/simulation/seed-colors.ts`, `src/styles/theme-colors.ts`

**Intent**: Add a universal color constant for food, following the exact existing pattern for `BOID_SEED_COLOR`/`PREDATOR_SEED_COLOR`.

**Contract**: Add `FOOD_SEED_COLOR` (a green, distinct from the existing cyan-blue boid and orange predator seed colors) to `seed-colors.ts`, re-exported from `theme-colors.ts` the same way the other two seed colors are (per that file's own header comment). Food items use this single constant directly — no genetics/tribe drift, since food has no `genes` and is not tribe-tagged.

#### 2. `drawScene`, `drawMinimap`, and both call sites

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Extend the shared `DrawEntity` union with a non-oriented `"food"` kind (no heading/rotation needed, unlike the existing boid/predator kinds), draw it as a filled circle, and thread the new array through both the signature and the two call sites.

**Contract**: `DrawEntity`'s `kind` union gains `"food"`; the draw loop (`:232-260`) adds a branch for `"food"` that skips the `rotate(heading)` step entirely and draws a filled circle (`ctx.arc`, scaled by the existing `computeDepthScale`) in `colorToCss(FOOD_SEED_COLOR)` instead of reading `entity.genes.color` (food entities have no `genes`). `drawScene`'s and `drawMinimap`'s signatures gain a third `food: FoodState[]` parameter. Both `redraw()` call sites (`simulation-canvas.tsx:603-650`, `server-run-viewer.tsx:951-999`) pass the current tick's/snapshot's `foodItems` array through alongside `boids`/`predators`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Start a client-staged run: food items (green circles) appear gradually after run start (not immediately), scattered across the world; boids (triangle), predators (diamond), and food (circle) are clearly visually distinct at default zoom.
- Watch a boid visibly consume a nearby food item (item disappears) on the live canvas.
- Confirm the minimap also shows food items with zero additional minimap-specific code changes needed (per `drawMinimap`'s existing reuse of `drawScene`).
- Start a server-owned run and confirm the same visuals appear on the server-run live view (confirms Phase 2's live-push wiring actually reaches the client).

---

## Phase 4: Manual verification & close-out

### Overview

End-to-end confirmation that the new mechanic behaves sensibly across a real run, including the balance-affecting decisions made during planning (energy boost, starvation retrigger) and the save/resume backward-compatibility case.

### Changes Required:

None — this phase is verification-only, no file changes.

### Success Criteria:

#### Manual Verification:

- Run a simulation to completion and observe: food count visibly grows/shrinks with the stock level over time; population dynamics look reasonable (no instant population explosion from the energy boost, no unexpectedly-absent starvation pressure when food runs out).
- Watch the run's population-lifecycle-phase classification (growth/overshoot/crash/recovery, analysis view) and confirm it still reads sensibly — not just population counts in isolation. `classifyPopulationPhase` averages `foodAvailabilityRatio` over a 20-tick window (`boids.ts:1932-1970`); discrete per-eat-event depletion (vs. the old smooth per-tick rate) could make this signal steppier than today (plan-review F2) — this check is detection, not a fix, since the effect's magnitude is unverified either way.
- Save/pause a run with nonzero food items, resume it, and confirm food positions are preserved (not reset to empty).
- Resume (or construct a fixture for) a run saved before this change and confirm it resumes cleanly with zero food items, no crash.
- Confirm predators never visibly interact with food items (they should path around them exactly as before, no change to predator behavior).

---

## Testing Strategy

### Unit Tests:

- Phase 1's new tests (regen-spawn threshold/backlog/cap, proximity-eating, starvation retrigger condition, boid-only scoping) are the primary automated coverage for this change's balance-affecting logic.

### Manual Testing Steps:

1. Phase 3's manual checks (visual distinctness, live consumption, minimap, server-run parity).
2. Phase 4's end-to-end checks (population dynamics, save/resume, backward compatibility, predator non-interaction).

## Performance Considerations

Food items participate in the same spatial-hash grid already used for boid/predator neighbor queries (`spatial-grid.ts`'s generic `buildSpatialGrid`) — no new performance-sensitive data structure is introduced. The combined object-count cap (`maxObjectCount`) already bounds total rendered/simulated entities; extending it to include food keeps the existing capacity ceiling meaningful rather than letting food silently grow the live entity count unbounded.

## Migration Notes

No DB schema migration — `savedState` is an existing JSON blob column; `foodItems` is a new field within its JSON shape, following the established `?? []`-fallback pattern already used for `tribeFoodImbalanceSamples` when that field was added.

## References

- `context/changes/simulation-entity-shape-color-differentiation/research.md` — full codebase baseline, file:line citations for every claim in this plan
- `src/server/simulation/boids.ts:1289-1323` (`applyHunger`), `:1645` (`foodAvailabilityRatio`), `:1675-1686` (ambient energy coupling) — the mechanic this plan replaces/preserves
- `src/server/simulation/spatial-grid.ts:63-68` — generic spatial-hash grid, reused as-is
- `src/server/simulation/server-run-registry.ts:980-1043` — `ServerRunSnapshot`, save/resume precedent
- `src/app/simulation/_components/simulation-canvas.tsx:165-262`, `:296-340` — shared rendering pipeline

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine mechanics

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 New unit tests pass (regen-spawn threshold/backlog/cap, proximity-eating, starvation retrigger, boid-only scoping)
- [ ] 1.4 Full suite still passes: `npm test`

### Phase 2: Persistence

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run check`
- [ ] 2.3 Save/resume round-trip test passes (including a pre-existing-savedState backward-compatibility case)
- [ ] 2.4 Full suite still passes: `npm test`

### Phase 3: Rendering

#### Automated

- [ ] 3.1 Typecheck passes: `npm run typecheck`
- [ ] 3.2 Lint passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`

#### Manual

- [ ] 3.4 Food items (green circles) appear gradually, scattered, visually distinct from boid/predator shapes
- [ ] 3.5 A boid visibly consumes a nearby food item on the live canvas
- [ ] 3.6 Minimap shows food items with no additional code
- [ ] 3.7 Server-run live view shows the same food visuals (confirms live-push wiring)

### Phase 4: Manual verification & close-out

#### Manual

- [ ] 4.1 Food count visibly tracks stock level; population dynamics look reasonable (no instant explosion, starvation pressure still present when food runs out)
- [ ] 4.2 Population-lifecycle-phase classification still reads sensibly (growth/overshoot/crash/recovery)
- [ ] 4.3 Save/resume preserves food positions
- [ ] 4.4 A pre-existing saved run (predating this change) resumes cleanly with zero food items
- [ ] 4.5 Predators show no behavior change around food items
