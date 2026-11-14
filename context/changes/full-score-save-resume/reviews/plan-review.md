<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Full Scoring with Save and Resume Implementation Plan

- **Plan**: context/changes/full-score-save-resume/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND (after three inline fixes)
- **Findings**: 0 critical, 1 warning (fixed), 2 observations (fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

8/8 paths ✓ (rng.ts, trpc.ts, boids.ts, single-run-lifecycle.ts, server-run-registry.ts, schema.ts, simulation.ts, page.tsx), 5/5 symbols ✓ (createRng, adminProcedure, runTick, computeCohesion, computeScore), brief↔plan ✓.

## Findings

### F1 — Phase 3's `computeScore` redesign didn't address the client-staged trust boundary

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3, Changes Required #5
- **Detail**: The original draft had `computeScore` take raw arrays (`foodRatioSamples`, `survivingBoids`, `phaseHistory`) directly. That works for the server-owned path (`finishRun`, which holds this state locally) but not the client-staged path — `simulation.ts`'s `stop` mutation receives its scoring inputs over the wire from `simulation-canvas.tsx` (today just `cohesionSamples`/`elapsedTicks`), and the plan never specified how the new factors cross that same boundary.
- **Fix**: Split `computeScore` into three small pure helpers (`computeResourceManagement`, `computeGeneticDiversity`, `computePhaseQuality`) plus a plain 4-argument product combinator, so each path can compute factors from whatever state it holds. Explicitly specified `stop`'s zod input schema must grow with `foodRatioSamples`/`phaseHistory` (same trust posture `cohesionSamples` already establishes — client sends raw signals, server computes score), and that `simulation-canvas.tsx` must call the same shared pure functions client-side.
- **Decision**: FIXED — applied directly to plan.md.

### F2 — `getParameterRanges`'s procedure type left ambiguous

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Changes Required #2
- **Detail**: Draft offered "publicProcedure (or protectedProcedure...)" without settling it — every other procedure in this router is `protectedProcedure`, and `/simulation` already requires login.
- **Fix**: Committed to `protectedProcedure`, consistent with the rest of the router.
- **Decision**: FIXED — applied directly to plan.md.

### F3 — `classifyPopulationPhase`'s `previousPhase` source left unspecified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Changes Required #4
- **Detail**: The classifier's contract takes a `previousPhase` argument but the plan didn't say where it comes from, risking the implementer inventing a redundant separate state field.
- **Fix**: Clarified `previousPhase = phaseHistory.at(-1) ?? null` — `phaseHistory` being append-only already carries this.
- **Decision**: FIXED — applied directly to plan.md.

## Notes

- Re-confirmed `insertRunningSimulation`'s admin-range check must read `db` via the already-threaded parameter, not the module-level singleton — per the `ctx.db`-vs-singleton lesson recorded during S-06 — and added that reminder directly into Phase 2's contract to avoid repeating that exact mistake.
- Four-phase structure is appropriately sized: each phase has an independent, verifiable automated + manual success criterion, and the dependency ordering (RNG → admin ranges → scoring → save/resume) matches `research.md`'s analysis.
