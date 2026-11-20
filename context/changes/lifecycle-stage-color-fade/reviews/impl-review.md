<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fade boid, predator, and food colors by lifecycle stage

- **Plan**: context/changes/lifecycle-stage-color-fade/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `fadeTowardGray`'s ratio clamp doesn't guard NaN

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/color.ts:121-133
- **Detail**: `Math.min(1, Math.max(0, ratio))` does not guard `NaN` (`Math.max(0, NaN) → NaN`), so a `NaN` `age`/`energy` would silently propagate into `rgb(NaN, NaN, NaN)` via `toCss`. This matches the pre-existing unguarded-NaN pattern in `toCss`'s own clamp (color.ts:86-88) — not a new deviation this change introduced — and no realistic path to a NaN `age` exists elsewhere in the codebase (dtSeconds is never NaN in practice).
- **Fix**: No action needed; consistent with existing codebase convention. Noted for awareness only.
- **Decision**: ACCEPTED (pre-existing pattern, no realistic trigger)

### F2 — New draw-loop fade/shrink math has no unit test

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/app/simulation/_components/simulation-canvas.tsx:282-314
- **Detail**: The new per-entity `decayMult`/`energyMult`/shrink-multiplier logic is effectively pure (reads `entity.age`/`entity.energy`, calls `Color.fadeTowardGray`) and could have been unit-tested the same way `colorToCss`/`computeDepthScale`/`compareByDepth` already are in this file, rather than relying solely on Phase 2/3's manual canvas-capture verification. Not blocking — manual verification was performed and recorded with concrete evidence per the plan's own success criteria, which named only manual checks for this phase.
- **Fix**: Optionally add unit tests for the `decayMult`/`energyMult` formulas as pure functions in `simulation-canvas.test.tsx` in a future follow-up.
- **Decision**: SKIPPED (manual verification already satisfies the plan's stated success criteria; follow-up test coverage is a nice-to-have, not a gap against this plan)

## Automated verification (re-run at review time)

- `npm run typecheck` — PASS
- `npm run check` — PASS (1 pre-existing unrelated warning in src/components/ui/sidebar.tsx)
- `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/color.test.ts` — PASS (134 tests)
- `npm test` (full suite) — PASS (559 passed, 1 skipped)

## Plan drift detection

No drift found. All planned changes (`FoodState.age`, `Color.fadeTowardGray`, `DrawEntity` widening, boid/predator energy fade, food age fade+shrink, new unit tests) match the plan's stated intent exactly, verified against the actual diffs in commits `36dd405` and `e6e723a`. One prose discrepancy was checked and found to be a non-issue: the plan's Phase 2 contract described the `DrawEntity` food member's `age` as non-optional (`age: number`), but the actual type is `age?: number`, correctly mirroring `FoodState.age?: number` and handled safely at the read site via `?? 0` — the plan's prose was imprecise, not the implementation.

No scope creep: every line changed in both commits traces directly to a plan item.
