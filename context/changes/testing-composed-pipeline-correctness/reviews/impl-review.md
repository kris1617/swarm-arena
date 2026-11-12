<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Composed Simulation Pipeline Correctness & Determinism

- **Plan**: context/changes/testing-composed-pipeline-correctness/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Order-matters test doesn't guard runTick's own internal composition

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/server/simulation/pipeline.test.ts:150-243
- **Detail**: The "order-matters regression guard" test (`hunger-before-predation order is load-bearing`) calls `applyHunger`/`applyPredation` directly in both the documented and swapped order — it never calls `runTick` itself. `runTick` (boids.ts:509-546) composes these in a fixed internal order (`stepBoids` → `stepPredators` → `applyHunger` → `applyPredation`), but no test exercises `runTick` with this specific tie-break/starvation-vs-capture scenario. If a future edit swaps the `applyHunger`/`applyPredation` lines *inside* `runTick`'s own body, none of the 4 existing tests would catch it: test (a) (composed-order determinism) only checks that two calls to the *same* `runTick` agree with each other — it would still pass even with a swapped internal order, since both calls would still be internally self-consistent. This means the one risk Phase 1 exists to close (test-plan.md Risk #1: "the order itself is asserted, not just each function in isolation") is fully guarded for the raw step functions, but not for `runTick`, the actual function the UI calls in production.
- **Fix**: Add one assertion that calls `runTick` directly with the same target/bystander/predator fixture already in test (d) (zero `FlockWeights`, matching `dtSeconds`/`foodRegenRate`/`protectionThreshold`), and assert the same oracle values already derived in that test — `foodStock === -11` and the target absent via starvation, not capture. If `runTick`'s internal order is ever swapped, this assertion would flip to `-10.5`/capture, exactly mirroring what the existing manual-order comparison already proves for the raw functions — but now pinned to the function the UI actually calls.
  - Strength: Closes the one gap between what Phase 1 was supposed to protect (the production composition) and what it actually tests (the raw functions in isolation); reuses the fixture and oracle already written, so the addition is small.
  - Tradeoff: One more assertion to maintain; requires picking `FlockWeights` values that don't perturb the target's position/velocity in a way that changes the distance-based capture check (an all-zero weights object avoids this, confirmed against `stepBoids`'s steering-force math).
  - Confidence: HIGH — the gap was verified directly against `runTick`'s source (boids.ts:509-546) and the test file's actual assertions (pipeline.test.ts:150-243), not inferred from the plan text alone.
  - Blind spot: None significant — this is a test-only addition with no production code change.
- **Decision**: FIXED — added `runTick itself honors the hunger-before-predation order` to pipeline.test.ts, calling `runTick` directly with a dtSeconds=0.01/zero-weights fixture whose oracle (foodStock ≈ -1.01, survivor lifespan ≈ 999.98) was hand-derived from the documented order and the engine's own constants. Break-check confirmed it fails (-1.005, captured instead of starved) when runTick's internal applyHunger/applyPredation calls are swapped, then restored cleanly.

## Additional verification (outside findings)

- All 4 Automated success-criteria commands re-run independently and confirmed: `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/simulation/pipeline.test.ts` PASS (4/4), `npx vitest run` PASS (47/47, no regressions).
- Manual verification item 2.4 (starting a run at /simulation behaves identically to before the refactor) was confirmed directly by the user against the running dev server, with observable evidence in the diff (the refactor is a pure call-site swap with unchanged downstream ref assignments) — not rubber-stamped.
- Critical correctness point verified independently: `runTick`'s returned `predators` field is the direct post-`stepPredators` array, never re-derived through `applyPredation` — matches the pre-refactor inline composition exactly (boids.ts:523-527, 540-544; simulation-canvas.tsx:225-227).
- Scope guardrails ("What We're NOT Doing") all respected: `multi-simulation-stage.tsx` untouched, no RAF/render-loop integration test added, no simulation constant/formula changed, no perf/timing-budget test added, no authorization test added.
- One low-impact observation surfaced by the safety/pattern reviewer (minor test-scope adjacency between `pipeline.test.ts`'s tie-break/contested-capture tests and `boids.test.ts`'s existing protection-threshold tests) was assessed as reasonable separation, not duplication — not included as a finding.

## Triage Summary

- Fixed: F1 (1)
- Skipped: none
- Accepted: none

All findings triaged. Verdict remains APPROVED (0 critical, 0 outstanding warnings after fix).
