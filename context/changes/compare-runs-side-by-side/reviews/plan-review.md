<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Compare completed runs side by side Implementation Plan

- **Plan**: context/changes/compare-runs-side-by-side/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (`simulation.ts`, `server-run-registry.ts`, `dashboard/page.tsx`, `single-run-lifecycle.ts`, `simulation-canvas.tsx`), 4/4 symbols ✓ (`computeResourceManagement`, `computeGeneticDiversity`, `computePhaseQuality`, `segmentCompletedCycles`), brief↔plan ✓ (every Key Decision in the brief matches a phase or a "What We're NOT Doing" item in the plan).

A verification subagent independently confirmed the plan's central claim and swept for blast radius:

1. **`elapsedSeconds` gap**: confirmed at all three sites the plan names (`server-run-registry.ts` `tick()`'s `finishRun` call, `stopServerRun`, and `simulation.ts`'s `stop` resolver) — `elapsedSeconds`/`clampedElapsedTicks` is computed and used for `computeScore` at each site but never written into `history`. `phaseHistory.length` is confirmed to be an independently-tracked counter, not a reliable substitute.
2. **Blast radius**: every caller of `computeResourceManagement`/`computeGeneticDiversity`/`computePhaseQuality`/`segmentCompletedCycles`, and every read/write of `simulationRuns.history`, matches exactly what the plan already names. No surprise caller exists.
3. **Partial-success pattern**: the `getRunsComparison` per-row `{ runId, error }` marker is confirmed to be a genuinely new pattern for this router (every existing query/mutation hard-fails the whole request on an ownership/status gate) — see Finding F1 below.

## Findings

### F1 — `getRunsComparison`'s per-row error marker is a new pattern, not reused precedent

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, Change 3 (`getRunsComparison`)
- **Detail**: Every existing gated query/mutation in `simulation.ts` (`getRunAnalysis`, `stop`, `savePause`, `resume`) hard-fails the entire request with a thrown `TRPCError` on an ownership/status gate failure. `getRunsComparison` instead degrades per-row with an `error` marker, which is new for this codebase. The plan and brief already flag this consciously ("the one place this plan diverges from strict precedent-copying" — brief's Open Risks & Assumptions) rather than presenting it as reused precedent, and the deviation is justified: a 4-row query where one bad ID shouldn't block the other 3 is a materially different shape than every existing single-row procedure.
- **Fix**: None needed — no action required. The plan's own documentation of this as a deliberate, reasoned departure (not an oversight) is exactly the right level of care; flagging it here only for visibility during implementation review.
- **Decision**: PENDING
