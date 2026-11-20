<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Give boids, predators, and food distinct shapes and colors

- **Plan**: context/changes/simulation-entity-shape-color-differentiation/plan.md
- **Mode**: Deep
- **Date**: 2026-11-19
- **Verdict**: REVISE (triaged — all 3 findings FIXED → SOUND)
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
8/8 paths ✓ (boids.ts, single-run-lifecycle.ts, server-run-registry.ts, spatial-grid.ts, seed-colors.ts, theme-colors.ts, simulation-canvas.tsx, server-run-viewer.tsx), 9/9 symbols ✓ (FoodState-adjacent constants, applyHunger, runTick, computeSingleRunTick, buildSpatialGrid, watchServerRun, LiveRunSnapshot, getLiveRunState, boids.test.ts existence), brief↔plan ✓

## Findings

### F1 — Existing tests hardcode the formula this plan replaces

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Changes Required #2/#3, Success Criteria
- **Detail**: Phase 1's own stated success criterion is "Full suite still passes: npm test" — but at least 5 existing tests hardcode the exact rate-formula arithmetic this plan replaces, and will fail once that formula is gone: `boids.test.ts:1637` ("applies extra decay only when foodStock goes negative"), `:1656` (asserts exact foodStock deltas from the per-tribe rate formula), `:1697` ("reproduces today's exact flat-rate behavior byte-for-byte"), `:3208` (another direct `applyHunger(...)` call), and `pipeline.test.ts:320-376` (asserts literal foodStock values like -11/-10.5 computed from the current formula). Phase 1's Success Criteria names only NEW tests to add — zero existing tests are named for rewrite, and `pipeline.test.ts` isn't mentioned at all. As written, "full suite passes" is not achievable without doing this unplanned work.
- **Fix**: Name these 5 locations explicitly in Phase 1's Contract and Success Criteria as "rewrite to assert the new proximity-based behavior" — the blast radius is fully confined to these two test files plus `runTick` itself (confirmed: no other production call site of `applyHunger` exists).
  - Strength: Mechanically obvious once named — no design decision needed, just acknowledging the actual blast radius.
  - Tradeoff: None significant.
  - Confidence: HIGH — directly confirmed via grep + full test-file read.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Population-phase classification may get a lumpier signal, untested

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Current State Analysis / Key Discoveries
- **Detail**: `classifyPopulationPhase` (`boids.ts:1932-1970`) averages `foodAvailabilityRatio` over a 20-tick window against a fixed threshold (`OVERSHOOT_FOOD_RATIO_THRESHOLD=0.3`) to classify growth/overshoot/crash/recovery — a real, scored game mechanic. Under the new model, the pool depletes in discrete per-eat-event decrements instead of a smooth per-tick rate, which could make this signal steppier and shift phase-boundary crossings more erratically than today. The plan already explicitly accepts a related risk (the energy-boost's double-buffing effect) but doesn't mention this second, independent consumer of the same now-lumpier signal.
- **Fix**: Add one line to Phase 4's manual verification: watch a run's phase classification (growth/overshoot/crash/recovery, analysis view) for any run and confirm it still reads sensibly, not just population counts in isolation.
  - Strength: Extends the existing manual-verification phase with one concrete, cheap check, consistent with the plan's own already-chosen testing philosophy (unit tests for mechanic, manual check for emergent behavior).
  - Tradeoff: Still no automated guard — a single manual pass might miss an effect that only shows up on long/rare runs.
  - Confidence: MEDIUM — the effect's magnitude is genuinely unverified either way.
  - Blind spot: Whether 20-tick-window averaging already smooths this enough in practice is unverified either way.
- **Decision**: FIXED

### F3 — Live-push payload site wasn't pinned; now it can be

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Changes Required #2
- **Detail**: Phase 2 item 2 says the exact site is "not pinned by research.md, confirm during implementation." It's now pinned: `LiveRunSnapshot` (`server-run-registry.ts:200-225`), yielded by `watchServerRun` (`:1158`) via `getLiveRunState` (`:227`) — already carries `boids`, `predators`, and `foodStock` as siblings, confirming this is exactly the right site for a new `foodItems: FoodState[]` field.
- **Fix**: Replace the "confirm during implementation" hedge with the confirmed file:line.
- **Decision**: FIXED
