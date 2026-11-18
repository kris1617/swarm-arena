<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-tribe food config (S-41)

- **Plan**: context/changes/per-tribe-food-config/plan.md
- **Scope**: Full plan (Phase 1 of 7 .. Phase 7 of 7)
- **Reviewed phases**: 1, 2, 3, 4, 5, 6, 7
- **Date**: 2026-11-18
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Client-staged runs never receive the new per-tribe food-imbalance scoring dimension

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: `src/app/simulation/_components/simulation-canvas.tsx` (`buildStopInput()`, ~lines 710-746), `src/server/api/routers/simulation.ts` (`stop`'s input schema, ~lines 487-582, and its handler, ~lines 621-659)
- **Detail**: Phase 5 wired `tribeFoodImbalanceSamples` end-to-end for the **server-owned** path (`runTick` → `single-run-lifecycle.ts` → `server-run-registry.ts`'s `tick()`/DB write), but the **client-staged** path never forwards it. `simulation-canvas.tsx` tracks `tribeFoodImbalanceSamplesRef.current` locally (populated from the same `computeSingleRunTick` core the server path uses) but `buildStopInput()` never includes it in the payload it sends to `stop`. The `stop` procedure's own input schema has no `tribeFoodImbalanceSamples` field at all — unlike `foodRatioSamples`/`populationDensitySamples`/`geneticDiversitySamples`, which each have one. Consequence: `stop`'s handler calls `computeResourceManagement(input.foodRatioSamples)` with only one argument, so every client-staged run's score is computed with the pre-change formula unconditionally — the new scoring dimension is structurally unreachable on this path. The persisted `history` JSON also omits the field, making this permanent for that row. `wasEverFoodImbalanced` is likewise only ever written inside `server-run-registry.ts`'s `tick()` — the `stop` mutation never sets it — so a client-staged run with a severely imbalanced per-tribe food setup will always read `wasEverFoodImbalanced: false` and `ScoredRun.disclose()` will never flag it, even though its score silently used the wrong (old) formula. This is the same class of gap `lessons.md` already records twice: a field threaded through one execution path but not its sibling.
- **Fix**: Add `tribeFoodImbalanceSamples: z.array(z.number().min(0)).min(1).max(50_000).optional()` to `stop`'s input schema (optional, mirroring `geneticDiversitySamples`'s backward-compat treatment); thread it into `computeResourceManagement(input.foodRatioSamples, input.tribeFoodImbalanceSamples ?? [])`; persist it in the `history` object; add `tribeFoodImbalanceSamples: tribeFoodImbalanceSamplesRef.current` to `buildStopInput()` in `simulation-canvas.tsx`; and derive a `wasEverFoodImbalanced` value for the client-staged path's DB update (e.g. `input.tribeFoodImbalanceSamples?.some(s => s > FOOD_IMBALANCE_EPSILON) ?? false`), mirroring the server-owned path's write-once marker.
  - Strength: Closes the exact asymmetry the plan's own Overview implied shouldn't exist ("a run... gets a new disclosure marker" — not qualified to one execution path); matches the existing pattern every other per-tick sample array in this router already follows for both paths.
  - Tradeoff: Touches 3 files (schema, handler, client) for a feature whose primary verification target (per the plan's own Phase 7 manual checks) was the server-owned path — the client-staged path's food-balance behavior was never exercised by this change's own manual verification either, so this was a genuine blind spot, not a deliberately deferred scope cut.
  - Confidence: HIGH — the fix is a direct extension of an established, repeated pattern (4 other sample arrays already follow this exact shape across both paths).
  - Blind spot: `wasEverThrottled` also appears to be server-owned-only by design (no client-staged write path for it either), so the `wasEverFoodImbalanced`-for-client-staged half of this fix may be introducing new coverage the project hasn't needed before now — worth confirming that asymmetry is accidental and not an intentional simplification before extending it.
- **Decision**: FIXED — added `tribeFoodImbalanceSamples` (optional, mirroring `geneticDiversitySamples`) to `stop`'s input schema; threaded it into `computeResourceManagement`; persisted it in `history`; derived and wrote `wasEverFoodImbalanced` once from the full sample array (this path has no live interval to latch it tick-by-tick); sent it from `buildStopInput()` in simulation-canvas.tsx. Added a regression test proving a severe imbalance zeroes the score and sets the marker, contrasted against an unimbalanced run with the same other inputs. Deliberate-break-checked (reverting the threaded call turns the new test red). Full suite: 475/476 (1 pre-existing skip). Left `wasEverThrottled`'s existing server-owned-only asymmetry untouched per the Fix's own noted blind spot — out of this finding's scope.

### O1 — plan.md's Phase 5 contract names the wrong procedure for one `ScoredRun.from()` call site

- **Dimension**: Plan Adherence
- **Location**: context/changes/per-tribe-food-config/plan.md (Phase 5 Contract text), src/server/api/routers/simulation.ts:826-831
- **Detail**: The plan's Phase 5 Contract says `simulation.ts:815` inside `listCompleted` needs the explicit-SELECT update. The actual procedure that needed and received it is `listLeaderboard` (a sibling procedure) — `listCompleted` never used `ScoredRun`/`comparable`/`disclaimer` at all. The implementation is correct; only the plan's prose names the wrong function.
- **Decision**: FIXED — corrected plan.md's Phase 5 Contract to name `listLeaderboard`.
