<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Perf-Budget Guard for Render Usability

- **Plan**: context/changes/testing-render-perf-budget/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

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

### F1 — `Math.hypot` precision isn't guaranteed bit-identical across JS engines, unlike the arithmetic the comments lean on

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/pipeline-perf.test.ts:50-65; context/foundation/test-plan.md §6.4
- **Detail**: Per ECMA-262, `Math.hypot` is "implementation-approximated," not bit-exact across engines, unlike the plain arithmetic the determinism-chain comments correctly describe. A boundary-distance comparison could theoretically flip on a different engine, nudging the call count. Low-risk in practice — this repo only runs under Node/V8, and the 10-22 band already has generous slack built in for exactly this kind of fuzz.
- **Fix**: Optional — soften "arithmetic should be identical across environments for IEEE754-compliant engines" to "deterministic in practice on this project's single target engine (V8/Node)."
- **Decision**: SKIPPED — correctly assessed as low-risk by the reviewer; no real multi-engine exposure in this project's CI, and the band already absorbs this fuzz class.

### F2 — Comment wording on the capture-skip mechanism is slightly imprecise

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/simulation/pipeline-perf.test.ts:61-62
- **Detail**: The comment says "a predator stops scanning once every reachable boid is captured" — the actual mechanism (`boids.ts:475-478`) skips the `Math.hypot` call per already-captured boid via `continue`, never an early loop break. Same net effect on call count, just loosely worded.
- **Fix**: Cosmetic wording tweak only if the file is touched again.
- **Decision**: SKIPPED — cosmetic only, no effect on test validity.

### F3 — `BASE_PARAMS` naming vs. sibling file's `PARAMS`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/simulation/pipeline-perf.test.ts:17 vs. pipeline.test.ts:15
- **Detail**: The "BASE_" prefix implies a config that gets extended/overridden, but it's used unmodified in both call sites. Minor naming mismatch with the sibling file's convention.
- **Fix**: Could rename to `PARAMS` for closer consistency, not worth a dedicated revision.
- **Decision**: SKIPPED — cosmetic naming only.

## Additional verification (outside findings)

- All 4 Automated success-criteria commands re-run independently and confirmed: `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/simulation/pipeline-perf.test.ts` PASS, `npx vitest run` PASS (70/70, no regressions).
- `git diff` confirms `boids.ts` (production code) is completely untouched — this phase is pure test-code addition, as planned.
- Deliberate-break check during implementation confirmed the test actually catches a complexity regression: injecting an artificial cubic inner loop pushed the ratio to 62.48 (almost exactly the predicted ~64× for cubic growth), correctly failing outside the [10, 22) band.
- Determinism chain independently traced and confirmed sound: `createRng`'s mulberry32-style arithmetic is exactly ECMA-262-defined (bitwise ops + `Math.imul`), so the test is fully reproducible given its fixed seeds (1, 2) — not flaky despite depending on "random" initial positions.
- `applyPredation`'s reachability with `protectionThreshold: 0` independently traced and confirmed correct in both samples.
- Vacuous-assertion check confirmed the band genuinely discriminates: constant/no-op cost → ratio ≈1 (fails), linear → ratio ≈4 (fails), cubic → ratio ≈64 (fails), only true quadratic growth lands in [10, 22).
- `test-plan.md` §6.4's cookbook entry verified accurate against the actual test code — no overclaims.
- Scope guardrails ("What We're NOT Doing") all respected: no production code change, no exact-count assertion, no wall-clock timing, a real test was added (not a documentation-only alternative).
