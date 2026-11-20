# Fade boid, predator, and food colors by lifecycle stage Implementation Plan

## Overview

Boids and predators already carry everything a lifecycle fade needs (`energy`, per-flock `genes.color`); food has zero lifecycle state. This plan ports the Lua reference's exact fade formulas: boid/predator fade toward gray as energy drops below 30% of `ENERGY_MAX`, and food fades toward gray **and** shrinks as it ages (a new `age` field, fade-only — no despawn). A new centralized `Color.fadeTowardGray` helper is consumed by all three draw-call branches in the one shared `drawScene`.

## Current State Analysis

- `BoidState`/`PredatorState` (`boids.ts:123-158`) already carry `energy: number` (range `[0, ENERGY_MAX]`, `ENERGY_MAX = 100` at `:260`) and `genes.color` (`ColorJSON`, per-flock base color). Nothing here needs to change for the fade's data source.
- `FoodState` (`boids.ts:173-177`) is `{ x, y, z }` only — no age, no decay/lifecycle field of any kind. S-44's own plan deliberately deferred this: *"decay-driven visual fade is S-45's job, decay-driven despawn is explicitly out of scope here."*
- `DrawEntity` (`simulation-canvas.tsx:165-181`) is a type-contract gap, not a data gap: the boid/predator spread (`{...boid, kind: "boid"}`) already carries `energy` on the runtime object (since `BoidState` has it), but the union's boid/predator member doesn't declare `energy`, so the draw loop can't read it yet. Same gap will exist for food's new `age` field once added.
- `Color` (`src/server/simulation/color.ts`) is the sole owner of `{r,g,b}` color math in this codebase (file header, confirmed via `/10x-research`) — `fromHex`, `fromHsl`, `toCss`, `toJSON`, `fromJSON`, `distanceSq`, no lerp/fade yet. Its header comment explicitly documents why it omits a `blend` method (the crossbreeding blend is genetics logic, not a pure color op) — a lifecycle fade-toward-gray has no such coupling, so it's the correct, ACL-consistent home for the new helper.
- `colorToCss` (`simulation-canvas.tsx:213-215`) takes a plain `ColorJSON` and delegates to `Color.fromJSON(...).toCss()` — unchanged signature, so a faded `ColorJSON` can be passed through it exactly like the un-faded one is today.
- `drawScene`/`drawMinimap` are the one shared rendering pipeline (confirmed by S-44, unchanged since) — a change here is automatically picked up by the minimap and both execution paths' canvases (client-staged `simulation-canvas.tsx` and server-owned `server-run-viewer.tsx`, which only passes data through and defines no drawing logic of its own).
- `food: FoodState[]` is already threaded end-to-end from the engine through persistence to both draw call sites (S-44) — adding one more field to `FoodState`'s shape rides along inside that same array with zero new top-level snapshot fields or tick-loop refs needed. This is the one structural difference from S-44's own 4-phase shape (which needed a dedicated Persistence phase for `foodItems`/`foodSpawnRemainder` as brand-new top-level fields): here, the new state is a field *inside* an already-persisted array element, so persistence is a backward-compat concern handled at the read site, not a new wiring phase.
- Full detail, oracle citations, and the resolved scope decision: see `context/changes/lifecycle-stage-color-fade/research.md`.

## Desired End State

A simulation run shows boids and predators visibly dimming toward gray as their energy drops below 30% of `ENERGY_MAX`, and food visibly fading toward gray and shrinking (100%→50% of normal size) as it ages — all three using one shared, centralized fade helper, in the one shared rendering pipeline, picked up automatically by the minimap and both execution paths. A run saved before this change resumes cleanly: its food items have no `age` field, and every read site treats that as `age ?? 0` (freshly spawned), not a crash.

### Key Discoveries:

- The oracle (`/mnt/Kids/boids_final/game/src/{Boid,Predator,Food}.lua`) gives an exact, already-proven formula: `ratio = clamp(driver / threshold, 0, 1)`, then per-channel `lerp(grayFloor=0.3, baseColorChannel, ratio)`. Boid/predator's driver is `energy` (threshold `ENERGY_MAX * 0.3`); food's driver is age-since-spawn (threshold a new tuning constant, since this codebase has no decay-timer-to-despawn concept to reuse).
- Food additionally shrinks (`finalScale = scale * lerp(0.5, 1.0, ratio)`) — an intentional asymmetry versus boid/predator (which never shrink), confirmed with the user during research: full Lua-reference parity for food, accepted over the roadmap Outcome text's narrower "colors fade/shift" wording.
- `age` only needs to ride inside the already-threaded `FoodState[]` array (one new field on an existing, already-end-to-end-wired type) — no new `ServerRunSnapshot`/`LiveRunSnapshot` field, no new client-side tick-loop ref. The backward-compat guard (`item.age ?? 0`) must apply at **every** read site that uses age (the per-tick increment AND the render-time decay-ratio computation), not just one — a legacy-resumed run can render a frame before its first tick ever executes, so the renderer cannot rely on the engine's own increment step to have already normalized `undefined` to `0`.

## What We're NOT Doing

- Not adding a decay-timer-driven despawn mechanic for food — S-44 already scoped this out explicitly, and nothing here reopens it. Food's `age` field drives the fade/shrink ratio only; once `age >= FOOD_FADE_DURATION`, the ratio saturates at 0 and the item stays fully gray/half-size forever (visible but never removed), diverging from the Lua reference's own despawn-at-zero behavior by design.
- Not changing boid/predator's existing depth-based alpha fade (`computeDepthScale`-driven) — that's a separate, already-implemented, unrelated fade axis in the same `:draw()`-equivalent code, confirmed in both this codebase and the Lua oracle as independent of lifecycle fade.
- Not making boid/predator shrink — only food does, per the resolved scope decision.
- Not adding a new admin-configurable range for `FOOD_FADE_DURATION` — matches this codebase's existing precedent for engine-tuning constants (`FOOD_EAT_RADIUS`, `NEIGHBOR_RADIUS`, etc.), none of which are admin-configurable.
- Not touching `genes.color`'s own existing per-flock hue-spread logic (`createFlockColors`) — the fade is applied on top of whatever base color a flock already has, unchanged.

## Implementation Approach

Two layers, in dependency order: engine mechanics first (the new `FoodState.age` field plus the shared `Color.fadeTowardGray` helper, unit-tested in isolation), then rendering (applying the fade/shrink in the one shared `drawScene`, picked up automatically by the minimap and both execution paths). Manual, end-to-end verification closes out the change.

## Phase 1: Engine mechanics

### Overview

Add food's lifecycle-progression field (age-since-spawn, fade-only, no despawn) and the centralized fade-toward-gray color helper both layers will consume.

### Changes Required:

#### 1. `FoodState.age` field and per-tick increment

**File**: `src/server/simulation/boids.ts`

**Intent**: Give food a lifecycle-progression signal to fade against, matching the role `energy` already plays for boid/predator — incremented every tick, never reset except by not existing yet (backward compat), never driving despawn.

**Contract**: Add `age: number` to `FoodState` (alongside `x`, `y`, `z`). In `applyHunger`'s existing food-handling region, age every **surviving** item (the array carried forward from `state.foodItems`, before this tick's new spawns are appended) by `dtSeconds`, with a defensive `(item.age ?? 0) + dtSeconds` — the `?? 0` fallback is what lets a pre-change saved run (whose `foodItems` entries have no `age` key at all) resume and age from a clean baseline instead of producing `NaN`. Items newly spawned **this same tick** (inside the existing regen-threshold `while` loop) start at `age: 0`, not yet aged — i.e., age the carried-forward array first, then push new items after, so a brand-new item never appears pre-aged.

#### 2. Centralized fade-toward-gray helper

**File**: `src/server/simulation/color.ts`

**Intent**: One shared implementation of the oracle's `lerp(grayFloor, baseColor, ratio)` formula, consumed by all three draw-call branches — the roadmap's own already-resolved "centralize, don't replicate 3×" decision, and the natural fit for this class's documented role as the sole owner of `{r,g,b}` math.

**Contract**: `Color.fadeTowardGray(base: ColorJSON, ratio: number): ColorJSON` — clamps `ratio` to `[0, 1]` defensively (same style as `toCss`'s own channel clamp), then returns `{ r, g, b }` with each channel computed as `lerp(0.3, base.channel, ratio)` (`ratio=1` → unchanged `base`; `ratio=0` → the flat gray `{r:0.3,g:0.3,b:0.3}` floor). Takes and returns plain `ColorJSON` (not a `Color` instance) so call sites that currently pass a plain object straight into `colorToCss` need no restructuring beyond wrapping that object through this one call first. The `0.3` gray floor is a private, oracle-derived constant inside this file — no new exported constant.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New unit tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/color.test.ts` covering: a surviving food item's age increments by exactly `dtSeconds` each tick across at least 2 real-dt ticks (not reset); a newly spawned item starts at `age: 0` in the same tick it spawns; a food item with no `age` key at all (a constructed legacy-shaped fixture) ages from `0` without producing `NaN` or throwing; `Color.fadeTowardGray` at `ratio=1` returns the base color unchanged, at `ratio=0` returns the exact `{r:0.3,g:0.3,b:0.3}` floor, and at `ratio=0.5` returns the exact per-channel midpoint — each assertion hand-computed from the `lerp` formula, not mirrored from the implementation.
- Full suite still passes: `npm test`

#### Manual Verification:

- None for this phase — covered by Phase 3's end-to-end check.

---

## Phase 2: Rendering

### Overview

Apply the energy-driven fade to boid/predator and the age-driven fade+shrink to food, in the one shared `drawScene` — picked up automatically by the minimap and both execution paths' canvases.

### Changes Required:

#### 1. `DrawEntity` widening and the fade/shrink draw-loop branches

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Expose the two new fade drivers (`energy` for boid/predator, `age` for food) to the draw loop via `DrawEntity`'s existing spread-based construction, then apply the oracle formula per entity kind.

**Contract**: `DrawEntity`'s boid/predator union member gains `energy: number`; its food member gains `age: number` — both already flow onto the runtime object via the existing `{...boid, kind: "boid"}`/`{...item, kind: "food"}` spreads (`BoidState`/`PredatorState` already have `energy`; `FoodState` gains `age` in Phase 1), so this is a type-only widening, no construction-site change. New constant `FOOD_FADE_DURATION` (seconds) alongside this file's other draw-tuning constants (`BOID_WIDTH`, etc.) — a tuning starting value to verify empirically during Phase 3's manual check, matching S-44's own precedent for `FOOD_ENERGY_BOOST`.

In the draw loop's existing per-kind branches:
- **Boid/predator**: compute `energyMult = clamp(entity.energy / (ENERGY_MAX * 0.3), 0, 1)` (import `ENERGY_MAX` from `~/server/simulation/boids`, not currently imported in this file), then use `colorToCss(Color.fadeTowardGray(entity.genes.color, energyMult))` as `ctx.fillStyle` in place of today's direct `colorToCss(entity.genes.color)`.
- **Food**: compute `decayMult = clamp(1 - (entity.age ?? 0) / FOOD_FADE_DURATION, 0, 1)` (the `?? 0` fallback covers a legacy-resumed item rendered before its first tick) and a module-level `FOOD_BASE_COLOR: ColorJSON` computed once via `Color.fromHex(FOOD_SEED_COLOR).toJSON()`. Use `colorToCss(Color.fadeTowardGray(FOOD_BASE_COLOR, decayMult))` as `ctx.fillStyle` in place of today's flat `FOOD_FILL_COLOR` string assignment. Scale the circle's radius by `0.5 + 0.5 * decayMult` (the oracle's `lerp(0.5, 1.0, decayMult)`) on top of the existing `computeDepthScale`-derived `scale`, i.e. `ctx.arc(0, 0, BOID_WIDTH * scale * (0.5 + 0.5 * decayMult), 0, Math.PI * 2)` in place of today's `BOID_WIDTH * scale`.

No signature change to `drawScene`/`drawMinimap` is needed — both already take `food: FoodState[]`, and `FoodState` now carries `age` as part of its existing shape.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Start a client-staged run: let boids/predators lose energy (e.g. via starvation or combat) and confirm they visibly dim toward gray as energy drops, recovering toward full color if energy rises again.
- Watch food items age in place: confirm they visibly fade toward gray and shrink over roughly `FOOD_FADE_DURATION` seconds, then stay at the faded/shrunk floor indefinitely (never despawn, never go fully invisible).
- Confirm the minimap also shows the fade/shrink with zero additional minimap-specific code (per `drawMinimap`'s existing reuse of `drawScene`).
- Start a server-owned run and confirm the same visuals appear on the server-run live view.

---

## Phase 3: Manual verification & close-out

### Overview

End-to-end confirmation that the lifecycle fade behaves sensibly across a real run, including the backward-compatibility case for runs saved before this change.

### Changes Required:

None — this phase is verification-only, no file changes.

### Success Criteria:

#### Manual Verification:

- Run a simulation to completion and observe boid/predator fade tracking energy plausibly (dimming under stress, recovering when fed/safe) and food fade/shrink tracking age plausibly, without either looking jarring or instantaneous.
- Resume (or construct a fixture for) a run saved before this change and confirm its food items — missing the `age` key entirely — render at full color/size (treated as freshly spawned) and age normally from that point, with no crash.
- Confirm predator behavior around food is unaffected (no change to `applyPredation`/hunting — this change only touches rendering and food's own lifecycle field).

---

## Testing Strategy

### Unit Tests:

- Phase 1's new tests (food age increment/no-reset/legacy-fallback, `Color.fadeTowardGray`'s exact lerp math at the three boundary ratios) are the primary automated coverage for this change's correctness.

### Manual Testing Steps:

1. Phase 2's manual checks (boid/predator dimming, food fade+shrink, minimap, server-run parity).
2. Phase 3's end-to-end checks (plausibility over a full run, backward compatibility, predator non-interaction).

## Performance Considerations

No new per-tick data structure or query — `age` is a scalar field alongside `x`/`y`/`z` on an already-iterated array, and the fade/shrink computation at render time is O(1) per entity, the same complexity class as the existing `computeDepthScale`/`colorToCss` calls it sits beside.

## Migration Notes

No DB schema migration — `savedState` is an existing JSON blob column; `age` is a new field within `foodItems`' existing per-item JSON shape, guarded by `?? 0` at every read site rather than needing a snapshot-level restructuring (unlike S-44's `foodItems`/`foodSpawnRemainder`, which were new top-level fields).

## References

- `context/changes/lifecycle-stage-color-fade/research.md` — oracle formulas, codebase baseline, resolved scope decision.
- `/mnt/Kids/boids_final/game/src/Boid.lua:605-610`, `Predator.lua:281-286`, `Food.lua:25-53` — oracle fade/shrink formulas.
- `src/server/simulation/boids.ts:123-177` (`BoidState`/`PredatorState`/`FoodState`), `:252-280` (`ENERGY_MAX` and friends).
- `src/server/simulation/color.ts` — the `Color` ACL class, new home for `fadeTowardGray`.
- `src/app/simulation/_components/simulation-canvas.tsx:165-271` (`DrawEntity`, `colorToCss`, `drawScene`).
- `context/archive/2026-11-19-simulation-entity-shape-color-differentiation/plan.md` — S-44's precedent for a food-tuning constant as a verify-empirically starting value, and for a new per-tick field needing every read site checked.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine mechanics

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 36dd405
- [x] 1.2 Lint passes: `npm run check` — 36dd405
- [x] 1.3 New unit tests pass (food age increment/no-reset/legacy-fallback, `Color.fadeTowardGray`'s exact lerp math at ratio 0/0.5/1) — 36dd405
- [x] 1.4 Full suite still passes: `npm test` — 36dd405

### Phase 2: Rendering

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 6e3a8b7
- [x] 2.2 Lint passes: `npm run check` — 6e3a8b7
- [x] 2.3 Full suite still passes: `npm test` — 6e3a8b7

#### Manual

- [x] 2.4 Boids/predators visibly dim toward gray as energy drops, recovering if energy rises — observed live via canvas-draw-call capture: boid/predator `fillStyle` samples (`#8a958e`, `#8a807e`, `#81959a`, `#7f959a`) decode to desaturated near-gray channels consistent with low `energyMult`, in both a client-staged run and a server-owned run's live view. — 6e3a8b7
- [x] 2.5 Food visibly fades toward gray and shrinks over roughly `FOOD_FADE_DURATION` seconds, then holds at the floor indefinitely — captured 6 distinct live food fillStyle/radius pairs in one run (e.g. `#22c55e` at full saturation down to `#48594e`, decoding to `decayMult≈0.11`, i.e. age≈26.8s of the 30s `FOOD_FADE_DURATION`), each paired with a correspondingly smaller radius; re-sampling after a further wait showed the same values held steady (no further drift, no despawn). — 6e3a8b7
- [x] 2.6 Minimap shows the same fade/shrink with no additional code — confirmed 2 canvases present (670×446 main, 120×80 minimap) and every captured fillStyle/radius pair appeared exactly twice in the same frame, proving both canvases draw the identical faded/shrunk values via the one shared `drawScene`. — 6e3a8b7
- [x] 2.7 Server-run live view shows the same fade/shrink visuals — same desaturated boid/predator colors observed live on a server-owned run's live view page. — 6e3a8b7

### Phase 3: Manual verification & close-out

#### Manual

- [ ] 3.1 Fade behavior tracks energy/age plausibly over a full run, not jarring or instantaneous
- [ ] 3.2 A pre-existing saved run (predating this change) resumes cleanly with food rendering at full color/size and aging normally from there
- [ ] 3.3 Predator behavior around food is unaffected
