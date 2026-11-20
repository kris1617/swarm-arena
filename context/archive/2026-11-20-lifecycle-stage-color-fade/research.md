---
topic: "Lifecycle-stage color fade for boids, predators, and food (S-45)"
change_id: lifecycle-stage-color-fade
researcher: claude
date: 2026-11-20
last_updated: 2026-11-20
last_updated_by: claude
---

# Research: Lifecycle-stage color fade (S-45)

## Question

Port the Lua reference implementation's lifecycle-driven color fade (boids/predators fade toward gray as energy drops; food fades toward gray — and shrinks — as it decays) into this codebase's rendering pipeline, now that S-44 gave food a real positioned-entity representation. What is the exact oracle formula, what does the current codebase already have in place, and what must be newly added?

## Oracle: the Lua reference's exact fade formulas

Read directly from `/mnt/Kids/boids_final/game/src/{Boid,Predator,Food}.lua` (local filesystem, not part of this repo).

**Boid** (`Boid.lua:605-610`, inside `Boid:draw`):
```lua
local energy_mult = clamp(self.energy / (gConfig.boidBaseEnergy * 0.3), 0, 1)
local r = lerp(0.3, self.genes.color[1], energy_mult)
local g = lerp(0.3, self.genes.color[2], energy_mult)
local b = lerp(0.3, self.genes.color[3], energy_mult)
```

**Predator** (`Predator.lua:281-286`) — byte-identical formula shape, only the normalizing constant differs:
```lua
local energy_mult = clamp(self.energy / (gConfig.predBaseEnergy * 0.3), 0, 1)
-- same lerp(0.3, genes.color[channel], energy_mult) per channel
```

**Food** (`Food.lua:40-45`) — decay-timer-driven, not energy-driven, and fades size too, not just color:
```lua
local decay_mult = self.lifeTimer * self.lifeTimerInv  -- lifeTimer / originalLifeTimer, 1→0
local r = lerp(0.3, self.color[1], decay_mult)
local g = lerp(0.3, self.color[2], decay_mult)
local b = lerp(0.3, self.color[3], decay_mult)
local final_scale = scale * lerp(0.5, 1.0, decay_mult)  -- ALSO shrinks, 100%→50% of normal size
```

`lerp(a, b, t) = a + (b - a) * t` (standard linear interpolation; confirmed by the reciprocal-based `decay_mult` usage and `clamp` import — `utils.lua` wasn't re-read since both call sites already show the exact formula shape being used, which is all this oracle needs).

**Key structural facts from the oracle:**
- All three entity types fade the same way: lerp from a fixed dark-gray `(0.3, 0.3, 0.3)` toward the entity's own base color, driven by a `[0,1]` ratio.
- Boid/predator's ratio is **energy-driven**, normalized against `0.3 × baseEnergy` (so an entity fades in starting at 30% of its "base" energy level, not from 0 — it's already visibly fading well before death).
- Food's ratio is **decay-timer-driven** (age/remaining-lifetime), an entirely different axis from boid/predator's energy, because food in the Lua reference has no energy concept — it has a countdown to despawn instead.
- Food additionally **shrinks** as it decays (`final_scale`) — boid/predator do not shrink, only fade color. This is Food-specific behavior, not shared.
- Alpha (`clamp(scale * 1.5, 0.2, 1)`, depth-based) is a separate, unrelated fade axis in all three `:draw()` functions — not lifecycle-related, already fully implemented in this codebase's own depth-scale system (`computeDepthScale`), and out of this change's scope.

## Current codebase state

### Boid/predator energy — ready to drive a fade today

- `BoidState`/`PredatorState` (`src/server/simulation/boids.ts:123-158`) both carry `energy: number`, range `[0, ENERGY_MAX]` (`ENERGY_MAX = 100`, `boids.ts:260`). `INITIAL_ENERGY = 20` (`:252`) is a newborn's starting value, not an energy ceiling — there is no single codebase constant that plays the Lua reference's `boidBaseEnergy`/`predBaseEnergy` role (a fixed "base/full" energy level the fade normalizes against). `ENERGY_MAX` is the natural analog: it's the ceiling both engines already clamp to (`boids.ts:1443`, `:1865`, `:1879`), so `energy_mult = clamp(energy / (ENERGY_MAX * 0.3), 0, 1)` is a direct, oracle-faithful translation — full color at `energy >= 30`, fading below that, exactly mirroring the Lua reference's own 30%-of-base threshold semantics.
- `BoidGenes.color`/`PredatorGenes.color` already exist as the per-flock `{r,g,b}` base color (`ColorJSON` shape, `src/server/simulation/color.ts:23`) — this is the exact "genes.color" the Lua reference lerps toward.
- **Gap**: `simulation-canvas.tsx`'s `DrawEntity` union's boid/predator member (`:165-181`) does NOT currently carry `energy` — only `x, y, z, vx, vy, genes, kind`. The spread `{...boid, kind: "boid"}` (`:235`) puts `energy` on the actual runtime object (since `BoidState` has it), but the `DrawEntity` type itself doesn't declare it, so the draw loop (`:232-270`) cannot read `entity.energy` without first widening this type. This is a type-contract gap, not a data gap — the value is already flowing through, just not typed for use at the draw site.

### Food — no decay/age concept exists yet; this is the one real gap

- `FoodState` (`boids.ts:173-177`) is `{ x: number; y: number; z: number }` — no age, no spawn timestamp, no decay timer, confirmed by direct read of the type (3 fields only, no fourth). S-44's own plan (`context/archive/2026-11-19-simulation-entity-shape-color-differentiation/plan.md`, "What We're NOT Doing") explicitly deferred this: *"Not porting the Lua reference's food decay-timer/shrink mechanic — food items in this plan persist until eaten; no natural decay/despawn exists yet (decay-driven visual fade is S-45's job, decay-driven despawn is explicitly out of scope here)."*
- This means S-45 must add **some** per-item progression signal to `FoodState` to have anything to fade against — food currently has zero lifecycle state of any kind. The signal only needs to drive the **fade ratio**, not trigger despawn (S-44 explicitly scoped despawn out, and nothing in S-45's roadmap entry reopens that).
- The most direct, lowest-new-surface option, consistent with "no despawn": add an age-since-spawn counter (incremented by `dtSeconds` each tick, same convention as `BoidState.age`/`PredatorState.age` already use elsewhere in this file) and a fixed `FOOD_FADE_DURATION` constant (this change's own tuning constant, the same pattern S-44 used for `FOOD_ENERGY_BOOST`/`FOOD_EAT_RADIUS` — a starting value to verify empirically during manual verification, not a derived/guaranteed-correct number). The fade ratio then saturates at the gray floor once `age >= FOOD_FADE_DURATION` and **stays there** (no despawn), rather than tracking the Lua reference's countdown-to-zero-then-die semantics.
- This new `age` field needs the same persistence/threading treatment S-44's `foodItems`/`foodSpawnRemainder` just went through: `ServerRunSnapshot`/`LiveRunSnapshot` (`server-run-registry.ts`), the client-staged tick loop's per-tick refs (`simulation-canvas.tsx`), and a `?? `-style backward-compat fallback for runs saved before this field existed (a food item with no `age` should fade as if newly spawned — `age ?? 0` — not crash or appear pre-faded).

### Rendering pipeline — one shared `drawScene`, one natural home for a centralized helper

- `drawScene` (`simulation-canvas.tsx:218-271`) is the single function both the client-staged canvas and `server-run-viewer.tsx`'s server-run live view call — confirmed already by S-44's own research/plan, unchanged by S-44's implementation. A fade change here is automatically picked up by both execution paths and the minimap, same as S-44's food-rendering addition was.
- `colorToCss` (`:213-215`) already delegates all actual color math to `Color` (`src/server/simulation/color.ts`), which is explicitly documented as "the sole owner of" `{r,g,b}` conversions (file header, `:1-21`) — the ACL pattern this codebase has already standardized on for color operations. `Color` currently has `fromHex`, `fromHsl`, `toCss`, `toJSON`, `fromJSON`, `distanceSq` — **no lerp/fade method yet**. Its own header comment explicitly documents *why* it deliberately omits a `blend` method (the crossbreeding blend is genetics logic, not a pure color op, so it stays in `boids.ts`) — a lifecycle fade-toward-gray is a pure color operation with no genetics coupling, so adding it here does not conflict with that documented exclusion; it's the natural, ACL-consistent home for the roadmap's own already-resolved "centralize, don't replicate 3×" decision.
- `FOOD_SEED_COLOR = "#22c55e"` / `BOID_SEED_COLOR = "#38bdf8"` / `PREDATOR_SEED_COLOR = "#f97316"` (`seed-colors.ts:10-16`) are the per-type base colors already in place from S-44; food's `FOOD_FILL_COLOR` is currently read as a flat hex string directly in the draw loop (`simulation-canvas.tsx:255`, `ctx.fillStyle = FOOD_FILL_COLOR`), not through `Color`/`colorToCss` — a fade would need food's color converted through `Color.fromHex(FOOD_SEED_COLOR)` (or an equivalent constant-to-ColorJSON step) before a lerp can apply, since the flat-hex-string path has no channel-level math available.

## Relevant prior lessons (`context/foundation/lessons.md`)

- **"Procedurally-spread colors must anchor on the actual seed color's hue, not a fixed 0°"** — different mechanism (per-flock hue spread vs. lifecycle fade), but the same underlying discipline applies: verify the fade is visually distinguishable at the chosen parameters, not just "not byte-identical," during manual verification.
- **"A new per-tick ref added to the client-staged canvas's tick loop needs a multi-tick test, not just a single-tick one"** — directly applicable. Food's new `age` field is exactly this pattern again (a new per-tick persisted value alongside `foodItems`/`foodSpawnRemainder`'s existing refs) — the plan for this change must explicitly call out adding the sibling ref with the same 3-site treatment (declare, thread into tick state, read back) and a multi-tick persistence test, given this exact bug already recurred once in S-44.
- **"Spawn-time per-tick field must actually read its own config... manual verification must check every field the plan names"** — if the plan names "boid, predator, AND food" all three should fade, implementation and manual verification must cover all three, not a convenient subset (the Lua reference shows food's mechanism is structurally different from boid/predator's — easy to implement the easier two and silently defer food again, repeating S-44's own `foodSpawnRemainderRef` near-miss pattern).

## Resolved product/scope decision (user, 2026-11-20)

**Should food also shrink in size as it fades (matching the Lua reference's `final_scale = scale * lerp(0.5, 1.0, decay_mult)`), or fade color only (matching boid/predator, which never shrink)?**

- The roadmap's own S-45 Outcome text says *"sees boid, predator, and food **colors** fade/shift according to lifecycle stage"* — colors only, no mention of size. The Lua reference's `Food:draw` does both color fade AND shrink; `Boid:draw`/`Predator:draw` only fade color, never shrink.
- **Resolved: full Lua port.** Food fades color toward gray AND shrinks from 100% to 50% of its normal depth-scaled size as it ages, exactly matching `Food.lua:40-45`'s `final_scale = scale * lerp(0.5, 1.0, decay_mult)`. This is an intentional asymmetry — food shrinks, boid/predator do not — accepted as faithful to the oracle reference over the roadmap text's narrower literal wording. `/10x-plan` should treat the roadmap Outcome's "colors fade/shift" as covering food's full lifecycle treatment (color + size), not as a boundary excluding the shrink.

## Already-resolved decisions (do not re-ask)

- **Centralize vs. replicate the fade formula**: roadmap's own Unknown for S-45 is already resolved with "Block: no" and a stated default — centralize into one shared helper (natural home: `Color`, per the ACL section above), consumed by all three draw-call sites, rather than replicating the Lua reference's 3× duplication.
- **Food gets a lifecycle-progression field, but no despawn**: S-44's plan already pre-committed to this exact split ("decay-driven visual fade is S-45's job, decay-driven despawn is explicitly out of scope here") — S-45 should NOT reopen whether food should start despawning; only how the fade-only progression signal (age/timer) is modeled.

## References

- `/mnt/Kids/boids_final/game/src/Boid.lua:605-610`, `Predator.lua:281-286`, `Food.lua:25-53` — oracle fade formulas (local filesystem, outside this repo).
- `src/server/simulation/boids.ts:123-177` (`BoidState`/`PredatorState`/`FoodState`), `:252-280` (energy constants).
- `src/server/simulation/color.ts` — the `Color` ACL class, natural home for a centralized fade helper.
- `src/app/simulation/_components/simulation-canvas.tsx:165-271` (`DrawEntity`, `colorToCss`, `drawScene`).
- `src/server/simulation/seed-colors.ts`, `src/styles/theme-colors.ts` — per-type base colors.
- `context/archive/2026-11-19-simulation-entity-shape-color-differentiation/plan.md` — S-44's "What We're NOT Doing" (food decay-timer deferral), `research.md` (persistence/threading precedent for new per-tick FoodState fields).
- `context/foundation/roadmap.md` — S-45's Outcome, Unknowns, Risk.
- `context/foundation/lessons.md` — the three entries cited above.
