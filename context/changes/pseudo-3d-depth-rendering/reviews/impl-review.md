<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pseudo-3D depth rendering

- **Plan**: context/changes/pseudo-3d-depth-rendering/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated success criteria (re-verified)

- `npm run typecheck` — PASS
- `npm run check` — PASS
- `npx vitest run src/server/simulation/boids.test.ts` — PASS (18/18)

## Scope note

Unplanned-but-necessary work beyond plan.md: toroidal x/y/z wraparound (`wrap`), minimum-image-convention distance (`wrappedDelta`), and a circular-mean centroid (`circularMean`) in `src/server/simulation/boids.ts`, added to fix a real regression (boids escaping the canvas) found during Phase 2's manual verification. Confirmed consistently applied to every distance/centroid calculation in the file and test-covered (`boids.test.ts` includes a dedicated wraparound regression test). Not scope creep — a necessary fix for the feature to work at all; Scope Discipline verdict is PASS.

## Findings

### F1 — circularMean's atan2 can return floating-point noise on a symmetric split

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/boids.ts:279-289
- **Detail**: If a flock's coordinates split into two roughly equal clusters ~half the range apart (a real, reachable dispersed state), `sumSin`/`sumCos` both land near but not exactly 0 due to floating-point residue, so `atan2` returns an angle dominated by that noise rather than a clean tie-break. Only feeds the displayed cohesion score, never physics/positions.
- **Fix**: Add a magnitude guard before the `atan2` call — `if (Math.hypot(sumSin, sumCos) < 1e-9) return 0;` — for a deterministic tie-break in the degenerate case.
- **Decision**: FIXED

### F2 — resolveOverlaps doesn't re-wrap after its positional push

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/boids.ts:95-127
- **Detail**: A boid near a wrap seam pushed by ≤2 units could end one tick slightly outside `[0, range)` — self-corrected by the next tick's `wrap()` call. Max overshoot ~2 of 200 units, one frame, invisible in practice.
- **Fix**: None needed — self-correcting, flagged for completeness only.
- **Decision**: FIXED — wrapped a.x/a.y/a.z and b.x/b.y/b.z after the positional push, for defensive correctness.

### F3 — Dead eslint-disable comment in a Biome-only repo

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/_components/simulation-canvas.tsx:175
- **Detail**: `// eslint-disable-next-line react-hooks/exhaustive-deps` sits next to the real `biome-ignore` comment. This repo has no ESLint config — linting is Biome-only per AGENTS.md. The eslint comment does nothing here.
- **Fix**: Delete the eslint-disable-next-line comment; keep the biome-ignore.
- **Decision**: FIXED

### F4 — Multi-seed convergence test lacks a dedicated z-only variant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: src/server/simulation/boids.test.ts
- **Detail**: The plan asked for z-axis variants of 4 existing tests; 3 got dedicated z-only cases, but the multi-seed convergence regression only got implicit 3D coverage (BoidState is 3D by default now) rather than a separate z-isolated case. Satisfies the spirit, not the literal letter, of the contract.
- **Fix**: None required — flagged for the record only.
- **Decision**: FIXED — added a dedicated z-isolated convergence test (all boids share x/y, differ only in z); found the configuration settles into a static symmetric equilibrium at exactly cohesion 0.5, so asserted `> 0.4` for headroom rather than a brittle exact-boundary check.
