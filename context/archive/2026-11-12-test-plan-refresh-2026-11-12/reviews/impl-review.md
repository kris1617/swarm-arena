<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Depth-Rendering Formula Test Coverage

- **Plan**: context/changes/test-plan-refresh-2026-11-12/plan.md
- **Scope**: Phase 1 of 1 / Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- **Extraction (plan item 1)**: `computeDepthScale`/`compareByDepth` moved verbatim out of `drawScene` in `src/app/simulation/_components/simulation-canvas.tsx`, exported, formula/comparator byte-identical to the prior inline code. No behavior change.
- **Tests (plan item 2)**: `depth-render.test.ts` covers scale==1 at z=0 (algebraic identity, not a guessed/mirrored value), near(z=20) > far(z=180), upper clamp forced at z=-99, lower clamp forced at two different large z values both flooring to 0.3 (proves the clamp engages rather than coincidentally landing in range), and `compareByDepth` sort order + antisymmetry. No oracle-problem mirror test — no assertion recomputes the formula to derive its own expected value.
- **test-plan.md (plan item 3)**: §2 risk #6 + risk-response row added, §3 Phase 6 row added and marked `complete`, §6.6 cookbook entry added, "Last updated" banner bumped. No unplanned sections touched.
- **No EXTRA/unplanned changes** beyond the expected 10x-chain scaffolding files and the three named target files.
- **Verification (re-run fresh against current HEAD, not reused from Progress claims)**:
  - `npm run typecheck` → PASS
  - `npm run check` (Biome) → PASS — "Checked 70 files in 770ms. No fixes applied."
  - `npx vitest run src/app/simulation/_components/depth-render.test.ts` → PASS — 6/6 tests
  - `npm test` → PASS — 130/130 tests across 17 files

## Findings

### F1 — Implicit inline object-shape param types

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/_components/simulation-canvas.tsx (computeDepthScale/compareByDepth signatures)
- **Detail**: `compareByDepth(a, b)` and related signatures use inline `{ z: number }` shape typing rather than a named type. Matches this file's existing lightweight typing style (e.g. `DrawEntity`) — not a deviation worth fixing.
- **Fix**: None needed — consistent with existing convention.
- **Decision**: SKIPPED (not worth fixing; matches existing pattern)
