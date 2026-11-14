<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Per-run population-dynamics analysis view

- **Plan**: context/changes/run-analysis-view/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: REVISE (both findings fixed below — SOUND after fixes)
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓, 4/4 symbols ✓ (`countCrashToRecoveryCycles` at `boids.ts:1265`, `computeGeneticDiversity` at `:1165`, `populationCountSamplesRef` at `simulation-canvas.tsx:199`, `PopulationPhase`/`BoidGenes` both exported), brief↔plan ✓.

Deep verification (1 subagent) confirmed the `boids.ts` refactor is behavior-preserving (no other callers of `countCrashToRecoveryCycles`), the `history`-shape additions in `server-run-registry.ts`/`simulation.ts` are clean and additive, `computeGeneticDiversity`'s signature matches `history.survivorGenes`'s type exactly, and the dashboard's existing `Link` pattern is accurate. Two real gaps found — both below.

## Findings

### F1 — `buildStopInput()` doesn't actually send `populationCountSamples`; Phase 1's "no client change" claim is wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1, Current State Analysis + Changes Required #1
- **Detail**: The plan's premise — "the client already sends `populationCountSamples`; the server's zod schema silently drops it" — is false. `simulation-canvas.tsx`'s `buildStopInput()` (full read) returns exactly 5 keys (`runId, elapsedTicks, cohesionSamples, foodRatioSamples, phaseHistory, survivingBoidGenes`); `populationCountSamplesRef` is tracked and updated every tick but never read into this object. As scoped, Phase 1 would add a zod field and resolver write that the client-staged path never populates — `history.populationCountSamples` would stay `undefined`/absent for every client-staged run, defeating the whole point of Phase 1 for that path.
- **Fix**: Add `populationCountSamples: populationCountSamplesRef.current` to `buildStopInput()`'s returned object (`simulation-canvas.tsx`), alongside the existing fallback pattern its siblings already use (`foodRatioSamples`/`phaseHistory` fall back to `[0]`/`["establishment"]` when empty — match that for consistency). Correct the plan's Current State Analysis to say the client change *is* needed, not already done.
- **Decision**: FIXED — plan's Current State Analysis and Phase 1 Contract both corrected; `simulation-canvas.tsx` added to Phase 1's file list.

### F2 — Phase 3 doesn't specify the Next.js 16 dynamic-route param pattern or the string→number conversion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, Changes Required #3 (the `/runs/[runId]/page.tsx` contract)
- **Detail**: This is the project's first dynamic route — no in-repo precedent exists. Next.js 16's docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`) make `params` a `Promise`, not a plain object, as of Next 15+; a client page implemented the naive synchronous way (`{ params: { runId } }`) will not type-check. The plan's contract just says "reading `runId` from the route param" without specifying which of the two valid patterns (`use()` on a `params` prop, or the `useParams()` hook) to use, and doesn't mention that `useParams()` returns the segment as a `string`, needing `Number(runId)` before calling `getRunAnalysis.useQuery({ runId })` (whose zod input is `z.number()`).
- **Fix**: Specify `useParams<{ runId: string }>()` from `next/navigation` (lower-friction fit for a page that's fully client-rendered, vs. accepting a `Promise` prop and unwrapping it with `use()`), with an explicit `Number(runId)` conversion before the query call.
- **Decision**: FIXED — added to Phase 3's Contract text.
