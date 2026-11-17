<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Refactor opportunities implementation plan

- **Plan**: context/changes/refactor-opportunities/plan.md
- **Mode**: Deep
- **Date**: 2026-11-17
- **Verdict**: REVISE → SOUND after fix
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — A third, structurally identical duplication site is unmentioned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 — Extract buildFinishHistory/score helper
- **Detail**: Verified against current code: `src/server/api/routers/simulation.ts:539-577` (the `stop` tRPC mutation) builds the same 8-field `history` shape and calls `computeScore` with the same 5-factor pattern as the two sites Phase 1 targets — sourced from tRPC input fields instead of a `LiveRun` object, and written via `ctx.db.update(...)` directly instead of through `finishRun`. Neither `research.md`'s Candidate C section nor `plan.md` mentions this third site. After Phase 1 lands, the plan's stated end state ("both completion paths... call one shared helper... no behavior change" / "the duplicated history literal is removed") will be true of `server-run-registry.ts` but a third near-identical duplication will remain live elsewhere in the codebase — a reader of the plan's Desired End State could reasonably believe the duplication is fully closed when it isn't.
- **Fix**: Add one line to "What We're NOT Doing" naming this third site explicitly and why it's excluded (different input shape — raw tRPC input vs. a `LiveRun` object — means it can't trivially reuse `buildFinishPayload(run: LiveRun)` without a larger refactor), mirroring exactly how Candidate B was already handled in the same section. This keeps the plan honest about what it closes vs. what it knowingly leaves open, without expanding scope.
- **Decision**: FIXED (added to "What We're NOT Doing")
