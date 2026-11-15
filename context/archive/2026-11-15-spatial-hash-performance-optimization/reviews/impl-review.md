# Implementation Review: Spatial-Hash Performance Optimization

- **Plan**: context/changes/spatial-hash-performance-optimization/plan.md
- **Reviewed phases**: 1 and 2 (full plan)
- **Commits**: 0f3581d (Phase 1), 4bd99f1 (SHA write-back), 3bb03d9 (Phase 2), 9822974 (SHA write-back)
- **Verdict**: APPROVED — no findings that violate the determinism constraint

This is the highest-stakes change in this project's recent history — the PRD's hard constraint
("must produce identical scores/behavior to the pre-optimization scan... any deviation is a bug,
not an accepted tradeoff") made this review correctness-focused rather than pattern-compliance-
focused, with hand-derivation of the risky cases rather than trust in comments.

## Checks performed (hand-verified, not just read)

1. **Grid correctness**: wrap-around cell iteration is mathematically correct on all three axes.
   The ascending-sort guarantee is real (`result.sort((a, b) => a - b)`, a numeric comparator).
   Dedup logic (`needsDedup = 2*range+1 > Math.min(dimX,dimY,dimZ)`) is correct and, verified
   against this codebase's actual constants (dims 3/4/7), never triggers today but is logically
   sound if future parameters change. **Completeness proof** (not assumed): for `radius <= cellSize`
   with half-open cell intervals, any two points in cells ≥2 apart are provably > `cellSize` apart,
   so `range=1` never misses a true in-radius candidate.
2. **Call sites**: `stepBoids`' two loops correctly build the grid once per call (positions aren't
   mutated mid-map, confirmed by reading the actual `.map()` body) and correctly replace the old
   reference check with an index check. `applyPredation`'s reuse of the larger `NEIGHBOR_RADIUS` as
   cell size is coarser-but-complete, not incomplete (proven via the same completeness argument).
   `reproducePopulation`'s `j <= i` filter combined with the grid's sorted output was hand-traced
   through a concrete 3-individual adversarial scenario and produces the exact same first-match-by-
   ascending-index result as the original pairwise scan — the offspring position was independently
   re-derived by hand and matches the test's assertion, confirming the test genuinely distinguishes
   first-by-index from nearest-match, not just by its own comment.
3. **Test coverage honesty**: both widened-timeout commits change only comments and the timeout
   number — the underlying assertions are untouched, so the widening isn't papering over a behavior
   change, just accounting for a documented, measured performance regression on dense/large-radius
   scenarios. `pipeline-perf.test.ts`'s `[10, 22]` band is unchanged because it was re-measured
   (~15.8) and genuinely still holds, consistent with the plan's own geometric explanation.
4. **Scope**: `git show` diffs for both phases touch exactly what Progress claims; `resolveOverlaps`
   and `stepPredators` are untouched in both diffs, matching their documented exclusion.

## Minor observation (no action needed)

The grid's completeness argument depends on `radius <= cellSize` holding at each call site — true
for all four today. If a future caller queries at `radius > cellSize` for a different cell size,
the narrowing formula (`range = ceil(radius/cellSize)`) is still correct, but the specific
"never misses a candidate" proof would need re-deriving for that case rather than assumed.

No findings to triage.
