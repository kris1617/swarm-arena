<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-tribe boid behavior data model (F-09)

- **Plan**: context/changes/per-tribe-behavior-weights/plan.md
- **Scope**: Full plan (9 of 9 phases)
- **Reviewed phases**: 1, 2, 3, 4, 5, 6, 7, 8, 9
- **Date**: 2026-11-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated success criteria (re-verified)

- `npm run typecheck` — PASS
- `npm run check` — PASS (1 pre-existing, unrelated warning in `src/components/ui/sidebar.tsx`)
- `npm test` (full suite) — PASS (455/456, 1 pre-existing skip), per Phase 9's own commit

## Findings

### F1 — `matePreference` never reads `TribeConfig.matePreference` at spawn — the plan's own contract, unmet

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/server/simulation/boids.ts:392` (`createInitialPopulation`), `:441` (`createInitialPredators`)
- **Detail**: Phase 1's own Contract text (plan.md) states matePreference's per-tribe `TribeConfig` field is "the *starting* value new boids in that tribe spawn with, matching how `separationWeight` etc. already work." Phase 9 names `matePreference` among the fields its manual spawn-check should verify. The actual code still seeds `matePreference: rng()` at both spawn sites — identical to pre-change behavior — never reading `tribeConfig.matePreference`. This was independently found three times in this session: by the Phase 5 implementer (flagged, deferred as out-of-scope), by the Phase 6 implementer (flagged again), and now by this review's plan-drift pass, reading the code directly rather than trusting prior notes. My own Phase 9 manual gene-inspection script narrowed its checked fields to separationWeight/maxSpeed/minSpeed, silently dropping matePreference from the exact set the plan named — an omission on my part, not a deliberate scope decision.
- **Fix**: Replace `matePreference: rng()` with `matePreference: tribeConfig.matePreference` at both `boids.ts:392` and `:441`, matching the exact pattern already used for `separationWeight`/`maxSpeed`/`minSpeed` two lines above each site (identical starting value within a tribe at gen 0, diverging only through inheritance/mutation thereafter — consistent with how `computeGeneticDiversity`'s existing `matePreference` entry already expects gen-0-uniform-per-tribe behavior, same as the other heritable fields).
- **Decision**: FIXED. Also required fixing three downstream tests whose fixed-seed fixtures depended on matePreference's old random values: two golden-fixture tests in `server-run-registry.test.ts` (regenerated from the new correct output), and two behavioral tests in `simulation.test.ts` whose exact seeds no longer produced close-enough/correctly-gendered spawns in time (one needed a larger population buffer + raised protection threshold; one needed seeds picked by direct measurement to start within mate-distance range, since the original seeds' same-flock pairs now converge too slowly for the test's time budget). All changes verified stable across 5 repeated runs each.

### F2 — `reproducePopulation` never reseeds offspring from any `TribeConfig` (accepted scope, not a defect)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/server/simulation/boids.ts:934` (`reproducePopulation`)
- **Detail**: Mating offspring's weight/speed/matePreference genes come entirely from `inheritGenes`'s parent blend — never from any tribe's current config, static or live-edited. This was surfaced as a structural mismatch during Phase 6, and the user explicitly confirmed it's correct behavior to keep: resetting heritable genes to a tribe's current config on every birth would defeat the genetic-inheritance/mutation system this project already relies on. Recorded here only so a future reader of this review doesn't mistake it for an unreviewed gap — it's a documented, user-confirmed scope boundary (commit `b5623fc`'s message explains the full reasoning).
- **Decision**: PENDING (expected: DISMISSED/ACCEPTED — no action needed, see commit b5623fc)

### F3 — `applyLiveTribeConfigs` trusts the caller for array-length validity, undocumented in this file

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/server/simulation/server-run-registry.ts:297-331`
- **Detail**: `applyLiveTribeConfigs` accepts `patch: TribeConfig[]` with no length check — relies entirely on `updateTribeConfigs` (simulation.ts) having already validated `tribeConfigs.length === flockCount`. This matches `applyLiveParams`'s own trust posture (also unvalidated), so it's not a deviation from precedent, and every downstream read (`stepBoids`, the energy-drain site) already defensively falls back to a global constant via `?? `/optional chaining if an index is missing — so the failure mode is "silently behaves like no per-tribe config," never a crash. `adjustLivePopulation` in the same file documents its own invariants inline; this function doesn't mention its reliance on the caller's length check.
- **Fix**: Add a one-line comment at `applyLiveTribeConfigs`'s definition cross-referencing the router's length check, matching this file's own commenting convention elsewhere.
- **Decision**: FIXED

## Notes from the parallel reviews (no further findings)

- Safety/quality/pattern pass: no CRITICAL findings. Confirmed clean: hot-loop allocation discipline (no new per-boid allocations), nested admin-range length-mismatch handling (hard reject before the per-field loop, not silent truncation/index risk), the additive-only migration, `ctx.db`-parameter convention on all router helpers, and — most importantly — directly re-verified (not trusted from commit messages) that `createInitialPopulation`/`createInitialPredators` genuinely read `tribeConfig.separation/alignment/cohesion/maxSpeed/minSpeed` at gene-seeding time, closing the exact S-27-class trap this change's own research/lessons.md flagged.
- Test quality spot-check: burst/energy-drain, mate-preference-gate, and live-adjustment tests were all confirmed behavioral (asserting real outcomes against a documented oracle), not mirror-implementation or rubber-stamped.
- Scope creep check: no unplanned/undocumented additions found — every file beyond the plan's own named list is an explicitly-disclosed ADAPT item in its phase's commit message.
