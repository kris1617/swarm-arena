# Plan Brief: Fade boid, predator, and food colors by lifecycle stage

Full plan: `context/changes/lifecycle-stage-color-fade/plan.md`

## What this does

Ports the Lua reference's exact lifecycle-fade formula into this codebase: boid/predator fade toward gray as energy drops below 30% of `ENERGY_MAX`, and food — newly given a positioned, spatial existence by S-44 — fades toward gray **and** shrinks as it ages. All three entity kinds share one new centralized `Color.fadeTowardGray` helper, applied in the one shared `drawScene` function so the minimap and both execution paths (client-staged, server-owned) pick it up automatically.

## Starting Point

Boid/predator already have everything the fade needs — `energy` and a per-flock base `genes.color` — just not exposed to the draw loop's type yet. Food has zero lifecycle state: no age, no decay timer, nothing. S-44 (the immediately prior change) explicitly deferred this exact gap: *"decay-driven visual fade is S-45's job."* The `Color` class is this codebase's established sole owner of `{r,g,b}` math — the natural, already-precedented home for the new shared fade helper.

## Key Decisions

| Decision | Resolution | Why |
|---|---|---|
| Centralize or replicate the fade formula 3×? | Centralize, in `Color.fadeTowardGray` | Roadmap's own S-45 Unknown already resolved this with a stated default; matches `Color`'s documented role as the ACL for color math. |
| Should food get a decay-timer-to-despawn mechanic (matching the Lua oracle)? | No — fade-only, no despawn | S-44 explicitly scoped despawn out; S-45 only closes the fade gap, not the despawn one. |
| Should food also shrink as it ages, or fade color only (matching boid/predator)? | **Shrink too** — full Lua-reference parity | User's explicit call: faithful oracle port over the roadmap Outcome text's narrower "colors fade/shift" wording. Accepted as an intentional asymmetry (food shrinks, boid/predator don't). |
| Does food's new `age` field need its own persistence phase (new snapshot field + tick-loop ref, like S-44's `foodSpawnRemainder`)? | No | `age` rides inside the already-end-to-end-wired `foodItems` array — one new field on an existing type, not a new top-level field. Backward compat (`age ?? 0`) is a read-site guard, not a wiring phase. |

## Phases

1. **Engine mechanics** — `FoodState.age` (increments every tick, no despawn, `?? 0` legacy fallback) + `Color.fadeTowardGray(base, ratio)`.
2. **Rendering** — widen `DrawEntity` to expose `energy`/`age`; apply fade (boid/predator) and fade+shrink (food) inside `drawScene`'s existing per-kind branches; new `FOOD_FADE_DURATION` tuning constant.
3. **Manual verification & close-out** — full-run plausibility check, legacy-saved-run backward compatibility, confirm predator behavior around food is unaffected.

**Prerequisites**: S-44 (done — gave food a positioned, spatial representation to fade against). **Estimated effort**: LOW — a well-trodden 2-layer pattern (engine field → rendering), narrower than S-44's 4-phase shape since no new persistence wiring is needed.

## References

- `context/changes/lifecycle-stage-color-fade/research.md`
- `/mnt/Kids/boids_final/game/src/Boid.lua`, `Predator.lua`, `Food.lua` — oracle formulas
- `context/archive/2026-11-19-simulation-entity-shape-color-differentiation/` — S-44, the immediate prerequisite
