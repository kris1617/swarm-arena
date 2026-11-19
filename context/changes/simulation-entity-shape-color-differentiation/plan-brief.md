# Give boids, predators, and food distinct shapes and colors — Plan Brief

> Full plan: `context/changes/simulation-entity-shape-color-differentiation/plan.md`
> Research: `context/changes/simulation-entity-shape-color-differentiation/research.md`

## What & Why

Boids and predators already differ subtly in shape/color; food has zero visual representation today — it's a scalar pool number, never drawn. This plan gives all three entity kinds clearly distinct shapes/colors, and makes food a real, positioned, spatially-eaten entity — boids actively forage for and consume it (replacing the old background rate-based consumption), rather than food being a purely decorative overlay on an unchanged mechanic.

## Starting Point

Food is a pure scalar (per-tribe) pool with zero spatial concept anywhere; consumption is a per-tick rate formula with no position check. Boid/predator tick logic, the spatial-hash grid, and canvas rendering are all already shared, generic abstractions across both execution paths — this plan adds food as a third positioned entity type into those existing abstractions, not a parallel system.

## Desired End State

A run shows boids (triangle), predators (diamond), and food (circle, universal green) as three visually distinct entities. Food appears gradually after run start, scattered randomly. A boid reaching a food item consumes it — the item disappears, the shared pool decrements by that boid's own tribe's rate, and the boid gets a direct energy boost. The existing starvation safety net still fires when food is truly unavailable. Save/resume preserves food positions; old saved runs resume cleanly with none.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Consumption mechanics | Spatially-gated foraging (not visual-only) | User's explicit choice — a real engine change, not just a rendering layer, accepted knowing the balance-risk tradeoff |
| Item count/placement | Count derived from stock, random placement | Visually communicates abundance/scarcity directly |
| Update cadence | Threshold-based (not periodic) | Naturally throttled, ties directly to the item-count formula |
| Object-count cap | Food extends the existing sum cap; backlog accumulates invisibly when capped | One consistent capacity concept; no value ever lost, just visually delayed |
| Regen vs. consumption | Regen spawns new items; eating removes them (old rate-drain formula fully replaced) | Cleanly splits background accumulation from the new spatial mechanic |
| Eating radius | Fixed constant, ~NEIGHBOR_RADIUS scale | Consistent with how other engine-tuning constants are already defined (not admin-configurable) |
| Energy effect | Direct energy boost per item eaten (≈4s of passive gain, tunable) | User's explicit choice, knowingly accepting the double-buffing/reproduction-pacing risk |
| Per-tribe meaning | foodConsumptionRate = per-item value, read at the **eating boid's own tribe** | Exact carry-over of today's existing semantic, just proximity-triggered instead of continuous |
| Initial spawn | Build up gradually from empty (not immediate) | User's explicit choice — creates a deliberate scalar/visible discrepancy for a run's opening stretch |
| Shape / color | Circle, universal green (no per-tribe tint) | Orientation-free (food doesn't move), simplest, avoids muddying the tribe-color signal already used for boids/predators |
| Zero-food display | Naturally 0 items (no special-case warning indicator) | Falls directly out of the count-from-stock formula |
| Starvation safety net | Kept, retriggered on `stock==0 AND no items` | Preserves the starvation-pressure assumption this project's scoring has been tuned against across 10 prior milestones |
| Testing | Unit tests for the mechanic; manual check for rendering | Matches this project's own established split — no visual-regression tooling exists here |

## Scope

**In scope:** Food data model + regen/eat mechanics (engine), save/resume persistence, rendering (shape/color) for all three entity kinds across both execution paths and the minimap.

**Out of scope:** Lifecycle-stage color fading (separate roadmapped slice, S-45), the Lua reference's decay-timer/shrink mechanic, predator-food interaction, a new admin-configurable eating-radius range, a dedicated automated balance-regression test.

## Architecture / Approach

Three layers in dependency order: engine mechanics (new spawn/eat/energy logic inside the one shared tick entry point, `computeSingleRunTick` — covers both execution paths automatically) → persistence (thread `foodItems` through the existing save/resume snapshot, following the established new-array-field fallback precedent) → rendering (a new shape/color in the one shared `drawScene` function, picked up automatically by the minimap and both canvases).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine mechanics | Food spawn/eat/energy logic, unit-tested | Balance risk from spatially-gated foraging + energy boost — both explicit user choices, not oversights |
| 2. Persistence | Save/resume gets `foodItems`, backward-compatible | The live-push payload site wasn't pinned by research — confirm during implementation |
| 3. Rendering | Shape/color across both canvases + minimap | Low — reuses the existing shared `drawScene` abstraction |
| 4. Manual verification & close-out | End-to-end confirmation incl. backward compat | None beyond what's already flagged |

**Prerequisites:** None — no foundation dependency per the roadmap (S-44 has no Prerequisites).
**Estimated effort:** Single change, 4 phases — Phase 1 is the heaviest (new engine mechanics + unit tests).

## Open Risks & Assumptions

- The energy-boost magnitude (`ENERGY_GAIN_RATE * 4`) and the eating radius are starting values to verify empirically during Phase 4's manual pass, not guaranteed-correct balance numbers.
- Removing the old rate-based consumption formula changes population dynamics in ways no amount of planning fully predicts — Phase 4's manual verification is the real check, not a substitute for it.
- Phase 2's exact live-push payload site wasn't pinned by research (acknowledged gap) — implementation will need to locate and verify it directly.

## Success Criteria (Summary)

- Boids, predators, and food are clearly visually distinct by shape and color, on both execution paths and the minimap.
- Food behaves as a real spatial entity: boids forage for and consume it, affecting both the shared pool and their own energy.
- Save/resume (including pre-existing saved runs) works correctly; no regression to predator behavior or existing tests.
