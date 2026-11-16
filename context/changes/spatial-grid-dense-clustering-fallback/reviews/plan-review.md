<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Keep spatial-grid neighbor queries bounded when boids cluster densely

- **Plan**: context/changes/spatial-grid-dense-clustering-fallback/plan.md
- **Mode**: Deep
- **Date**: 2026-11-16
- **Verdict**: SOUND (after fixes; was REVISE)
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

5/5 paths ✓, 4/4 symbols ✓ (1 corrected: `applyPredation`, not `stepPredators`), brief↔plan ✓

## Findings

### F1 — Phase 2 threads the warn-sink into the wrong function; the real 4th call site is omitted

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, item 1 + Current State Analysis / Key Discoveries
- **Detail**: Verified directly against `boids.ts`: `stepPredators` (686-746) contains no `buildSpatialGrid`/`queryRadius` call at all — it finds each predator's nearest boid via a plain O(predators × boids) nested loop. The plan's claim that "stepPredators (boids.ts:989-1000) ... call[s] queryRadius" is wrong; those lines actually belong to `applyPredation` (974-1021), a distinct, unmentioned function with its own `boidGrid` and one `queryRadius` call per predator (`CAPTURE_RADIUS`). As written, Phase 2 would add a dead parameter to `stepPredators` while leaving `applyPredation`'s real degradation site unguarded. Separately confirmed: `stepBoids` has two internal `queryRadius` calls (boid-boid neighbor query + boid-predator flee-detection query), both already correctly covered by the plan's generic phrasing.
- **Fix**: Replace `stepPredators` with `applyPredation` throughout Phase 2 and the Current State Analysis / Key Discoveries bullets; `stepBoids` keeps both its internal `queryRadius` calls forwarding the same sink.
- **Decision**: FIXED (plan.md's Current State Analysis, Phase 2 overview/item 1/item 3, Phase 2 Success Criteria, and References all corrected to `applyPredation`)

### F2 — Phase 3's canvas-test escape hatch is based on a wrong assumption about the harness

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Success Criteria (3.4) and item 3
- **Detail**: `simulation-canvas.test.tsx` already mocks `requestAnimationFrame` and captures the tick callback — driving many ticks is a plain loop of `act(() => capturedCallback?.(ts))`, no new infrastructure needed. The plan's escape hatch ("satisfied by code-review confirmation if impractical") was unnecessary and invited skipping a real test.
- **Fix**: Remove the escape-hatch language; commit to a real test driving several ticks via the existing RAF-mock pattern, asserting the ref flips once and `console.warn`'s call count stays at 1.
- **Decision**: FIXED (plan.md Phase 3 Success Criteria 3.4 and the corresponding Progress row updated)

### F3 — No quantitative link between the 64-candidate cap and whether it actually resolves the motivating slowdown

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State, Performance Considerations, What We're NOT Doing
- **Detail**: Capping at 64 turns the affected call sites' per-tick cost from O(population²) to O(population × 64) — quadratic to linear, not constant (~32,000 operations/tick/call-site at population=500). Every Success Criterion in this plan could pass while the real 3600s/batch-1 scenario still takes too long, just less catastrophically. The plan already defers real-world re-validation to a separate follow-up (approved scope boundary), but never stated this risk explicitly.
- **Fix**: Add an explicit risk note to Performance Considerations stating the fix is linear-not-constant and is not proven sufficient on its own.
- **Decision**: FIXED (plan.md's Performance Considerations section now carries the explicit "Open risk" paragraph)
