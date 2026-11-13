<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Genetic inheritance and inter-flock crossbreeding (S-03)

- **Plan**: context/changes/genetic-inheritance-crossbreeding/plan.md
- **Mode**: Deep (direct verification, no sub-agent dispatch needed — scope was narrow enough to check inline)
- **Date**: 2026-11-13
- **Verdict**: REVISE → fixed inline, now SOUND
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING → fixed |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

11/11 paths ✓, 5/5 symbols ✓ (`stepBoids`, `RunState`, `computeMultiRunTick`, `RunSlot`, `MAX_PARALLEL_RUNS`), brief↔plan ✓. No `switch`/`checkbox` component exists in `src/components/ui/` (only `button.tsx`, `input.tsx`) — the plan's Phase 6 note to add one via `npx shadcn@latest add switch` is accurate, not a gap.

## Findings

### F1 — Phase 2/3/4/6 assumed multi-run reuses `runTick`; it doesn't

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff, but the correct shape was mechanically derivable once checked
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 (`reproducePopulation` wiring), Phase 3 (rng threading), Phase 6 (config props)

**Detail**: The plan's Phase 2 says reproduction is "wired into `runTick`" and Phase 3 says multi-run forwards rng "into the per-slot `stepBoids`/`runTick`-equivalent call." Direct read of `multi-run-lifecycle.ts` (full file, 119 lines) shows this is wrong: `computeMultiRunTick` calls `stepBoids(runState.boids, slot.weights, dtSeconds)` **directly** — it never calls `runTick`, `stepPredators`, `applyHunger`, or `applyPredation`. Confirmed further: `RunSlot` (`run-slots.ts:9-17`) has no `predatorCount`/`protectionThreshold`/`foodStockInitial`/`foodRegenRate` fields at all, and `multi-simulation-stage.tsx`'s `drawBoids` (line 42) only ever draws boids — multi-run is a deliberately boids-only, no-predator, no-food lifecycle, not a thin wrapper around the single-run pipeline. Following the plan as written would have the implementer try to "forward into runTick" a function that is never called in this file, discovered only mid-Phase-3.

**Fix**: Amend Phase 2/3/6 so multi-run gets its own direct reproduction call, not a `runTick` forward:
- Phase 2: add a boid-only `reproducePopulation` call directly after `stepBoids` inside `computeMultiRunTick` (not via `runTick`). No predator reproduction in multi-run — there are no predators there to reproduce.
- Phase 2's energy-gain mechanic: multi-run has no `foodStock`, so energy there always gains at the full `ENERGY_GAIN_RATE` (ratio = 1), never food-scaled.
- Phase 3: `RunState` (`multi-run-lifecycle.ts:16-20`) gains an `rng` field, consumed directly by the new reproduction call in `computeMultiRunTick` — not forwarded to a nonexistent `runTick` call.
- Phase 4: multi-run's population cap is `populationCap` with no predator subtraction (boids-only).
- **Decision**: FIXED (applied directly to plan.md — see edits below)
- **Addendum (2026-11-13, during Phase 1 execution)**: the user then asked
  for unified simulation principles across single-run and multi-run
  (predators/food/reproduction in both, not boid-only). This **supersedes**
  this fix — plan.md Phases 2/3/4/5/6 now have `multi-run-lifecycle.ts`
  adopt `runTick` directly (the architectural fix this finding originally
  argued against needing) rather than staying boid-only. The grounding
  evidence above (multi-run's prior lack of `runTick`) is still accurate as
  a description of the *pre-change* state; the fix direction changed per a
  new, explicit user decision, not a review error.

## Notes on findings not raised

- **Promise gap / End-State Alignment**: walked all 6 phases against Desired End State (per-individual genes, reproduction to cap, crossbreeding toggle, blended color) — every promised capability has a backing phase. No last-mile gap.
- **Progress↔Phase consistency**: exactly one `## Progress` heading; every `## Phase N:` has a matching `### Phase N:` block; every Automated/Manual bullet has a matching `- [ ] N.M` row. No malformed structure.
- **Contract surfaces**: `docs/reference/contract-surfaces.md` does not exist in this repo — check skipped per the skill's opt-in rule.
- **Lean Execution**: no premature abstraction found. The one generic `reproducePopulation<T>` helper (shared between boids/predators in the single-run path) is justified by decision #5 (identical rules), not scope creep.
- **Rollback/blind spots**: Phase 6's DB migration adds 5 `NOT NULL` columns with no default — on an existing `swarm-arena` SQLite DB this would break any pre-existing rows. Checked: `db.sqlite` is a local dev/dogfood DB with no production user data migration concern (the deployed VPS runs its own container-local SQLite file, redeployed fresh via Docker + migrations on each push per project history) — not flagged as a finding, but worth a one-line implementation note: Phase 6 should run `db:generate`+`db:push` against a dev DB that can be freely reset if the push complains about existing rows without defaults.
