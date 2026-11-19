---
topic: Give boids, predators, and food distinct shapes and colors in the simulation view
change_id: simulation-entity-shape-color-differentiation
researcher: Claude (10x-research)
date: 2026-11-19
last_updated: 2026-11-19
last_updated_by: Claude (10x-research)
last_updated_note: Initial research
---

# Research: Simulation entity shape/color differentiation (S-44)

## Question

Give boids, predators, and food distinct shapes and colors in the simulation view. Research confirmed (via `/10x-roadmap`'s M-11 decomposition) that boids (triangle) and predators (diamond) already differ subtly in shape and color; food has **zero** visual representation today — it's tracked only as a scalar pool number, never drawn. The user confirmed food should get real, positioned, discrete spatial entities (matching the prior LÖVE2D/Lua reference's `Food` objects), not a non-spatial pool visualization. This research maps exactly what giving food spatial identity touches across the simulation model, tick loop, persistence, and rendering, so `/10x-plan` can scope it without rediscovery.

## Summary

Food today is a **pure scalar** (per-tribe-shared) pool with **zero spatial concept anywhere in the codebase** — confirmed by a broad grep across `src/` for food-position-shaped identifiers, zero matches. Consumption is a rate formula with no position check at all. Giving food spatial identity is a real simulation-model change, but several structural facts make it tractable:

- **Boid/predator tick logic already funnels through exactly one shared entry point** (`computeSingleRunTick`, `single-run-lifecycle.ts:27`) used by *both* the client-staged and server-owned execution paths — a food-tick step added there (or inside `runTick`, `boids.ts:1515`) automatically covers both paths with no duplication.
- **The spatial-hash grid is already fully generic** (`buildSpatialGrid<T>`, `spatial-grid.ts:63-68`, keyed by a `getPosition` extractor) — it would accept a food-entity array with zero changes.
- **The rendering pipeline is already a single shared function** (`drawScene`, called by both the client-staged canvas and the server-run live view, plus automatically by the minimap) — but it currently has no concept of a non-moving, non-oriented entity; food would need either stand-in zero-velocity fields or a small type change to make heading optional.
- **One genuinely open product/design decision** this research surfaces but does not resolve (per research's own scope — this is for `/10x-plan`'s interview): does food's existing *consumption/regen mechanic* need to become spatially-gated (boids only eat nearby food items) as part of this slice, or can food be added as a positioned, rendered, decaying visual layer that coexists with — but doesn't yet gate — the existing scalar-pool consumption math? The user confirmed food needs real spatial *entities*; they have not been asked whether consumption mechanics must change too, and that's a materially different scope (visual-legibility slice vs. simulation-mechanics slice).

## Detailed Findings

### 1. Current food state and consumption (no spatial concept anywhere)

- **State shape**: `foodStock: number` appears identically in the client-staged tick-state (`single-run-lifecycle.ts:31`), the server-owned live run and its `ServerRunSnapshot` (`server-run-registry.ts:126`, `:985`), and the core engine's `runTick` state param (`boids.ts:1556`). A parallel `foodRatioSamples: number[]` per-tick history array exists at all three same sites (`single-run-lifecycle.ts:37`, `server-run-registry.ts:128`/`:987`).
- **Per-tribe, not global** (shipped in M-10's `per-tribe-food-config`): `TribeConfig` (`boids.ts:45-55`) carries `foodStockShare`, `foodRegenShare`, `foodConsumptionRate` per flock. Initial `foodStock` is seeded as the sum of all tribes' `foodStockShare` (`server-run-registry.ts:920-921`), not the flat `foodStockInitial` scalar (which still exists in `schema.ts:98-99` as a legacy/validation default).
- **Consumption formula** (`applyHunger`, `boids.ts:1289-1323`) — pure rate math, no position involved: `totalConsumption = Σ tribeConfigs[boid.genes.flockId].foodConsumptionRate` across all live boids; `nextFoodStock = foodStock - totalConsumption·dt + foodRegenRate·dt`. If the result goes negative, every boid's `lifespan` additionally decays (`HUNGER_EXTRA_DECAY_RATE·dt`, `:1318-1323`) and boids at `lifespan ≤ 0` are filtered out. Comment at `boids.ts:1283-1288` explicitly frames this as "one death mechanism with an accelerant" — a deliberate single global scalar, not per-boid/per-location.
- **No spatial concept exists anywhere**: a broad case-insensitive grep across `src/` for `foodX|food.*position|position.*food|foodPos|foodLocation|foodCell|foodGrid|foodSource|food_x|food_y` returned zero matches — no TODO, no removed/inert code, no comment referencing a spatial food model. The world-size fields `xyArea`/`zDepth` (`schema.ts:108-114`) govern boid movement bounds generally but are never referenced by any food computation.

### 2. Boid/predator state shape and the shared tick pipeline

- **`BoidState`** (`boids.ts:123-135`) and **`PredatorState`** (`boids.ts:146-158`, explicitly "same shape as BoidState", `PredatorGenes = BoidGenes` at `:141`) both carry: `x, y, z` (position), `vx, vy, vz` (velocity), `lifespan`, `genes`, `energy`, `age`, `gender`. **Neither has an `id` field** — entities are tracked purely by array index (confirmed via the spatial grid's `queryRadius` returning indices).
- **`stepBoids`** (`boids.ts:602`) and **`stepPredators`** (`boids.ts:909`) are separate, type-specific physics functions, composed by **`runTick`** (`boids.ts:1515-1758`) alongside `applyHunger` (`:1289`), `applyPredation` (`:1333`), and a generic `reproducePopulation<T extends BoidState | PredatorState>` (`:1125`).
- **Exactly one production call site feeds `runTick`**: `computeSingleRunTick` (`single-run-lifecycle.ts:27`, call at `:176`), itself explicitly documented (`:30-35`) as the single function both the client-staged and server-owned paths call. The server-owned path's own `tick()` (`server-run-registry.ts:705`) calls it at `:719`. **No `computeMultiRunTick` exists** in the codebase (a function name assumed in this research's own initial dispatch turned out not to exist — correcting that assumption here). Practical implication: a food-tick step (decay, regen-spawn, etc.) added inside `runTick` or `computeSingleRunTick` covers both execution paths automatically — no duplication risk.
- **The spatial-hash grid is fully generic**: `buildSpatialGrid<T>(items: readonly T[], getPosition: (item: T) => Position3, cellSize, worldSize)` (`spatial-grid.ts:63-68`) already works for both boids and predators via this extractor abstraction and would accept a food-entity array with no changes, as long as food items expose `x/y/z`.

### 3. Persistence (save/resume)

- `simulationRuns.savedState` (`schema.ts:129`, `d.text({ mode: "json" })`) serializes a `ServerRunSnapshot` (`server-run-registry.ts:980-1008`) whose shape already includes `boids: BoidState[]`, `predators: PredatorState[]`, `foodStock: number`, plus every per-tick sample array (`foodRatioSamples`, `tribeFoodImbalanceSamples`, `populationCountSamples`, etc.), built by `snapshotServerRun` (`:1014-1043`) and restored by `resumeServerRun` (`:1049+`, with `?? []` fallbacks for rows saved before a field existed — e.g. `tribeFoodImbalanceSamples`, `:988-990`).
- **Implication for a future food-entities array**: the snapshot/resume pattern already handles arbitrary new array fields gracefully (the `?? []` fallback precedent), so adding `foodItems: FoodState[]` to this same snapshot type is additive and has a direct precedent to follow — not a novel persistence problem.
- `foodRatioSamples` itself is read/averaged by a `computeResourceManagement`-style helper (`boids.ts:2046-2063`) and consumed in the run-finish/export computation (`server-run-registry.ts:600-677`); unaffected by adding spatial food entities unless the consumption mechanic itself changes (see the open question above).

### 4. Rendering pipeline (`simulation-canvas.tsx`, shared by the server-run live view and the minimap)

- **`drawScene(ctx, boids: BoidState[], predators: PredatorState[], camera, canvasWidth, canvasHeight)`** (signature at line 210) builds one unified `DrawEntity` type internally (`:165-173`): `{ x, y, z, vx, vy, genes: BoidGenes, kind: "boid" | "predator" }`, spread from each array plus a `kind` tag (`:222-230`). The draw loop (`:232-260`) reads `x/y` (via `worldToScreenX/Y`), `z` (depth scale), `vx/vy` (only to derive `heading = atan2(vy, vx)`), `genes.color` (via `colorToCss`), and `kind` (branches which shape to draw).
- **A food item has no velocity/heading** — it would need either zero-velocity stand-ins (`vx: 0, vy: 0` → `heading = 0`, drawing it "facing" an arbitrary fixed direction, which is wrong for a non-oriented shape) or, more correctly, a small type/rendering change to skip the `rotate(heading)` step entirely for non-moving kinds. `computeDepthScale` (`:178-183`) is keyed only on `z` and needs no change — food would still want the same near/far size scaling for visual consistency with boids/predators at different depths.
- **Existing shapes are both oriented polygons**: boid = triangle (`BOID_LENGTH=6`, `BOID_WIDTH=4`, lines 115-116), predator = diamond (`PREDATOR_LENGTH=7`, `PREDATOR_WIDTH=7`, lines 119-120), both filled via `ctx.fillStyle = colorToCss(entity.genes.color)` after a `rotate(heading)`. The geometrically natural third option is an **orientation-free shape** (a circle via `ctx.arc`, or a simple non-directional polygon) — stylistically distinct from both existing oriented silhouettes and correctly signals "this doesn't move/rotate" without needing a heading at all.
- **No static/dynamic entity distinction exists anywhere in this component** — every frame does a full clear + redraw of every entity uniformly (`:218-261`), no dirty-rect or static-layer caching. Food would just be a third array merged into the same sorted/drawn `entities` list — no new architectural concept needed for render cost.
- **`seed-colors.ts`** currently defines only `BOID_SEED_COLOR = "#38bdf8"` and `PREDATOR_SEED_COLOR = "#f97316"` (lines 10-11), re-exported from `theme-colors.ts` per that file's own header comment. A `FOOD_SEED_COLOR` constant would need to be added following the identical pattern.
- **`drawMinimap`** (`:296-340`) calls `drawScene` directly with the same boid/predator arrays at a different camera/scale (`:312-319`), explicitly to avoid a second divergent render implementation (its own comment, `:291-295`) — so once `drawScene`'s signature and `DrawEntity` union gain a food array/kind, the minimap picks it up with zero additional minimap-specific drawing code. `drawMinimap`'s own signature and both call sites still need the new array threaded through, though: `simulation-canvas.tsx`'s own `redraw()` (`:603-650`) and `server-run-viewer.tsx`'s `redraw()` (`:951-999`, which also imports `BOID_LENGTH` at line 11 for a zoom-ceiling calculation at `:964` — unrelated to food, noted for completeness).

### 5. Object-count cap

`adminSettings.maxObjectCount` (`schema.ts:215`, default 500) currently caps `boidCount + predatorCount` only, enforced in `simulation.ts:299-303` and `:361-379`. Nothing in the current structure forces whether a food count extends this same sum or gets its own separate cap — this is a free design decision for `/10x-plan`, not a structural constraint this research found either way.

## Code References

- `src/server/simulation/boids.ts:45-55` — `TribeConfig` (per-tribe food fields)
- `src/server/simulation/boids.ts:123-158` — `BoidState`/`PredatorState` shapes
- `src/server/simulation/boids.ts:602` / `:909` — `stepBoids`/`stepPredators`
- `src/server/simulation/boids.ts:1125` — generic `reproducePopulation<T>`
- `src/server/simulation/boids.ts:1283-1323` — `applyHunger` (consumption/regen formula)
- `src/server/simulation/boids.ts:1515-1758` — `runTick`
- `src/server/simulation/boids.ts:2046-2063` — resource-management helper over `foodRatioSamples`
- `src/server/simulation/single-run-lifecycle.ts:27` — `computeSingleRunTick`, the one shared tick entry point for both execution paths
- `src/server/simulation/server-run-registry.ts:705`/`:719` — server-owned `tick()` calling into the shared entry point
- `src/server/simulation/server-run-registry.ts:980-1043` — `ServerRunSnapshot` type, `snapshotServerRun`/`resumeServerRun`
- `src/server/simulation/spatial-grid.ts:63-68` — generic `buildSpatialGrid<T>`
- `src/server/db/schema.ts:98-99`, `:108-114`, `:129`, `:215` — flat food defaults, world-size fields, `savedState` column, `maxObjectCount`
- `src/server/api/routers/simulation.ts:299-303`, `:361-379` — object-count cap enforcement
- `src/app/simulation/_components/simulation-canvas.tsx:115-120`, `:165-183`, `:210-262`, `:296-340`, `:603-650` — shape constants, `DrawEntity`, `drawScene`, `drawMinimap`, client-staged `redraw()`
- `src/app/simulation/_components/server-run-viewer.tsx:951-999` — server-run live-view `redraw()` call site
- `src/server/simulation/seed-colors.ts:10-11` — `BOID_SEED_COLOR`/`PREDATOR_SEED_COLOR`

## Architecture Insights

- This codebase's own convention — one shared tick entry point, one shared render function, a generic spatial-grid extractor — means adding a third positioned entity type is additive to existing abstractions, not a parallel reimplementation. The risk is smaller than a naive "add a new entity type" estimate would suggest, *provided* the new entity reuses `runTick`/`computeSingleRunTick`/`drawScene`/`buildSpatialGrid` rather than growing a separate pipeline alongside them.
- The rendering type (`DrawEntity`) assumes every entity has a meaningful heading. This is the one place a food entity doesn't fit the existing abstraction cleanly and will need either a small, deliberate type change (heading optional, keyed off `kind`) or a documented stand-in convention.

## Open Questions (for `/10x-plan`, not resolved here)

1. **Does the existing scalar-pool consumption/regen mechanic need to become spatially-gated** (boids only consume nearby food items) as part of this slice, or does food get positioned/rendered/decaying visual identity that coexists with the unchanged scalar-pool math underneath? This is the single biggest scope fork — the former is a real simulation-mechanics change (bigger, affects balance/scoring); the latter keeps this a visual-legibility slice (smaller, lower risk). The user confirmed food needs real spatial *entities*; this specific mechanics question hasn't been asked.
2. How many food items should exist at once, and how are their positions chosen (random scatter at run start? spawned continuously as the pool regenerates? one item per some fixed stock-per-item ratio)? The Lua reference's `Food.lua` (not re-inspected in this research pass — already mapped in the M-11 roadmap decomposition: `lifeTimer`/`lifeTimerInv` decay-countdown model, decay-driven color fade + size shrink) is the available precedent, but porting its exact spawn/decay mechanics vs. inventing a simpler scheme tied to the existing scalar pool is a design decision, not a research fact.
3. Does the object-count cap (`maxObjectCount`) extend to include food, or get its own ceiling?
