<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Give boids, predators, and food distinct shapes and colors

- **Plan**: context/changes/simulation-entity-shape-color-differentiation/plan.md
- **Scope**: Full plan (all 4 phases)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-20
- **Verdict**: APPROVED (after triage fixes)
- **Findings**: 0 critical, 2 warnings (both fixed), 0 observations

## Verdicts

| Dimension | Verdict (pre-triage) | Verdict (post-triage) |
|-----------|---|---|
| Plan Adherence | WARNING | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | PASS | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | WARNING | PASS |

## Automated gates (re-run during this review)

- `npm run typecheck` — PASS, clean.
- `npm run check` (Biome) — PASS, 1 pre-existing warning unrelated to this change (`src/components/ui/sidebar.tsx:84`, `noDocumentCookie`, shadcn-generated file, not touched by any phase).
- `npm test` — PASS, 548 passed, 1 skipped (42 test files).

## Findings

### F1 — Progress checkbox 1.3 claims spawn-threshold/backlog/cap test coverage that doesn't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real gap in protection for balance-affecting logic; not hard to fix, but shouldn't be deferred silently
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: `src/server/simulation/boids.ts:1377-1393` (the regen-accumulate-and-spawn loop inside `applyHunger`); `plan.md` Progress item `1.3`

- **Detail**: Phase 1's Success Criteria explicitly require automated coverage for "regen accumulates and spawns an item at the threshold; spawning respects the combined object-count cap and preserves backlog when capped." `plan.md`'s Progress marks `1.3` as `[x]` ("New unit tests pass (regen-spawn threshold/backlog/cap, proximity-eating, starvation retrigger, boid-only scoping)").

  Grepping `boids.test.ts` and `pipeline.test.ts` for `FOOD_ITEM_DISPLAY_VALUE`, `maxObjectCount`, and spawn/cap/backlog-named tests shows every existing test constructs `foodItems` directly as static fixture input and asserts only on eating/starvation — none drives the spawn loop itself (crossing `FOOD_ITEM_DISPLAY_VALUE` from accumulated regen, hitting the `boids.length + otherEntityCount + spawnedItems.length >= maxObjectCount` cap, or confirming the remainder is preserved rather than reset when capped). This is real production logic (`boids.ts:1377-1393`) with zero automated protection against a regression — e.g. an off-by-one in the cap comparison, or a future edit that resets `remainder` instead of leaving it accumulated, would pass every existing test.

  "Boid-only scoping" (predators never eat food) is lower-severity: it's covered by construction (`applyHunger`'s signature only accepts `boids: BoidState[]`, never receives predators), not by an explicit assertion — acceptable as a structural guarantee, but technically also not what "test passes" implies.

- **Fix**: Add 2-3 targeted tests to `boids.test.ts` exercising `applyHunger`/`runTick` directly (not via fixture-constructed `foodItems`): (a) regen accumulated via `foodRegenRate` crosses `FOOD_ITEM_DISPLAY_VALUE` and spawns exactly one new item, leaving the correct sub-threshold remainder; (b) at the combined cap (`boids.length + otherEntityCount + foodItems.length >= maxObjectCount`), no new item spawns and the remainder is preserved (not reset to 0) for the next tick; (c) once capacity frees up, the preserved backlog spawns on the next eligible tick. Then flip Progress `1.3`'s claim to accurately reflect what's covered, or leave it `[x]` once these land.
- **Decision**: FIXED. Added 3 tests to `boids.test.ts` (threshold-crossing spawn + remainder, cap-withholds-and-preserves-backlog, backlog-spawns-once-freed), each verified via a deliberate-break check (broke the cap's backlog-preservation path, confirmed both new tests went red, restored). Full suite green.

### F2 — No test pins `FOOD_ENERGY_BOOST`'s clamp to `ENERGY_MAX`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/server/simulation/boids.ts:1443` (`energy: Math.min(ENERGY_MAX, boid.energy + FOOD_ENERGY_BOOST)`)

- **Detail**: The clamp is implemented correctly and matches the existing energy-update pattern, but no existing test constructs a near-full-energy boid (e.g. `energy: 95`) eating a food item and asserts the result is `<= ENERGY_MAX` rather than the raw `95 + 40 = 135`. A future refactor that dropped the `Math.min` wrapper wouldn't be caught by the current suite.

- **Fix**: Add one test in `boids.test.ts`'s proximity-eating describe block: a boid near `ENERGY_MAX` eats a food item, assert `result.energy === ENERGY_MAX` (or whatever value is just under it), not `energy + FOOD_ENERGY_BOOST`.
- **Decision**: FIXED. Added a test with a boid at `energy: 95` eating one item (`95 + FOOD_ENERGY_BOOST = 135` would overshoot); asserts clamp to `ENERGY_MAX`. Verified via deliberate-break check (removed the `Math.min` wrapper, confirmed the test went red with `expected 135 to be 100`, restored).

## Notes (non-findings, verified and dismissed)

- **Phase 1→Phase 2 boundary pull-forward**: commit `26b0afd` (Phase 1) also added `foodItems`/`foodSpawnRemainder` to `ServerRunSnapshot` and wired `snapshotServerRun`/`resumeServerRun` — work `plan.md` assigns to Phase 2. The commit message discloses this explicitly and justifies it as necessary to avoid an RNG-sequence desync across pause/resume (each spawn event consumes `rng()` draws). Disclosed, justified, not scope creep — no finding.
- **`colorToCss(FOOD_SEED_COLOR)` plan wording vs. actual `ctx.fillStyle = FOOD_FILL_COLOR`**: the plan's Phase 3 contract text named `colorToCss`, which only accepts `{r,g,b}` objects (used for `genes.color`); food has no genes, so the actual code assigns the hex string directly. Correct and necessary deviation from the plan's literal wording — no finding.
- **The `foodSpawnRemainderRef` fix** (this session's own earlier manual-verification catch) was independently re-verified present in the current `simulation-canvas.tsx`: declared, threaded into the `computeSingleRunTick` call, and read back from the result, with a genuine (non-tautological) multi-tick regression test backing it in `simulation-canvas.test.tsx`.
- **Safety/data-integrity**: `?? []`/`?? 0` backward-compat fallbacks for pre-change saved runs are applied correctly at every read site (`resumeServerRun`, `getLiveRunState`, `computeSingleRunTick`'s call into `runTick`, and `runTick` itself), each covered by an explicit test. No splice-during-iteration hazard (removal uses a `Set` of indices built during a `.map()`, then a single `.filter()` afterward). No unbounded loop — spawning is capped by `maxObjectCount` and food-grid queries are O(boids), not O(boids × items).
- **Pattern consistency**: `FoodState`'s id-less, index-tracked shape matches `BoidState`/`PredatorState`'s own convention; color sourcing follows the existing `seed-colors.ts` → `theme-colors.ts` re-export pattern exactly.
