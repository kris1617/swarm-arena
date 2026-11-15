<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Genetic-diversity trend over time

- **Plan**: context/changes/genetic-diversity-trend/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: SOUND (after fixes; REVISE before)
- **Findings**: 2 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS (was FAIL) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (was FAIL) |
| Plan Completeness | PASS |

## Grounding
6/6 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 1 omits the pause/resume snapshot path entirely

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — `server-run-registry.ts:610-705` (`ServerRunSnapshot`/`snapshotServerRun`/`resumeServerRun`)
- **Detail**: This is the exact bug `lessons.md` documents for S-25: `resumeServerRun:697` has `populationDensitySamples: snapshot.populationDensitySamples ?? []` with a comment explaining a pre-existing `savedState` row can lack a newer field despite the type claiming otherwise, and without the fallback "the next tick's `[...state.populationDensitySamples, rawDensity]` throws, silently killing the resumed run." The same applies to `parameterChanges:698-704`. The original plan draft never added `geneticDiversitySamples` to `ServerRunSnapshot`'s type, `snapshotServerRun`'s return, or `resumeServerRun`'s reconstruction.
- **Fix**: Add `geneticDiversitySamples: number[]` to `ServerRunSnapshot`, include it in `snapshotServerRun`'s return, and reconstruct it in `resumeServerRun` with the same `snapshot.geneticDiversitySamples ?? []` fallback and explanatory comment pattern.
- **Decision**: FIXED — added as item 4 in Phase 1's Changes Required, with matching test criteria.

### F2 — Client-staged execution path is never actually touched

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1 — `simulation-canvas.tsx`, `simulation.ts`'s `stop` input schema
- **Detail**: The plan's Overview says "both execution paths," but Changes Required only touched `single-run-lifecycle.ts`/`server-run-registry.ts` — the server-owned path's own finishing logic. `computeSingleRunTick` has exactly 2 real callers; the client-staged path maintains its own independent `*Ref` per sample array and sends them in `stop`'s mutation input, bounded `.max(50_000)` per the S-27 unbounded-array lesson. None of this was mentioned — a client-staged run completed after this ships would have no `geneticDiversitySamples` at all.
- **Fix**: Add a `geneticDiversitySamplesRef` to `simulation-canvas.tsx` mirroring the other 4 sample refs, append per tick, send in the `stop` payload; add a matching bounded optional field to `simulation.ts`'s `stop` input schema, included in that router's history-building object.
- **Decision**: FIXED — added as item 5 in Phase 1's Changes Required, with matching test criteria.
