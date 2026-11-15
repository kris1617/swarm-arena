<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Client-staged live parameter parity

- **Plan**: context/changes/client-staged-live-parameter-parity/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

Grounding: 6/6 paths ✓ (`simulation-canvas.tsx`, `parameter-ranges.ts`, `simulation.ts`, `server-run-viewer.tsx`, `src/app/runs/[runId]/page.tsx`, `server-run-registry.ts`), symbols confirmed (`checkLiveParamRangesSoft`, `getRunAnalysis`, `stopRun`), brief↔plan consistent ✓. Progress↔Phase check: 18/18 Success Criteria bullets map 1:1 to Progress rows.
Deep verification (sub-agent, 4 riskiest claims + blast-radius + pattern check): all 4 claims CONFIRMED (checkLiveParamRangesSoft's extraction is a pure relocation with no direct test coupling; the ref-initialization-before-mount-effect ordering has no hazard; the stop-schema extension is backward compatible and getRunAnalysis's read path already anticipates an optional parameterChanges field; no second caller of either `stop` or `checkLiveParamRangesSoft` exists; no competing writer to the 5 target refs exists, confirming "no dirty-tracking needed" holds) — except one real gap (F1 below).

## Findings

### F1 — Phase 2 test plan doesn't account for an existing mock gap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Automated Verification
- **Detail**: `simulation-canvas.test.tsx`'s existing `vi.mock("~/trpc/react", ...)` (lines 13-29) defines only `api.simulation.stop.useMutation`. Phase 2's new panel calls `api.simulation.getParameterRanges.useQuery()` — against the current mock, that throws `TypeError: Cannot read properties of undefined (reading 'useQuery')` the moment the panel renders inside this test file. The plan says "add tests" but doesn't flag that the mock itself needs extending first.
- **Fix**: Add explicit guidance to Phase 2's Automated Verification item, naming the exact mock extension: add a `getParameterRanges: { useQuery: () => ({ data: undefined }) }` stub to the existing `vi.mock("~/trpc/react", ...)` block before any new rendering test can pass.
- **Decision**: FIXED — plan.md's Phase 2 Contract now includes a "Test setup note" naming the exact mock extension, and the Automated Verification bullet explicitly calls out extending the mock first.
