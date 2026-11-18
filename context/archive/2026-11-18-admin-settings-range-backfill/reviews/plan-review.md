<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Admin-settings range backfill

- **Plan**: context/changes/admin-settings-range-backfill/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE (triaged — both findings FIXED; verdict after fixes: SOUND)
- **Findings**: 0 critical, 2 warnings, 0 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

4/4 paths ✓, symbols ✓ (`getOrSeedAdminSettings`, `RANGED_PARAMETER_NAMES`, `onConflictDoUpdate`), brief↔plan ✓.

## Findings

### F1 — scripts/corpus/harness.ts has a deliberately-duplicated copy of this exact bug, untouched by this plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: scripts/corpus/harness.ts:72-91 (`getOrSeedAdminSettingsRanges`)
- **Detail**: This function's own comment states it's a deliberate duplicate of `getOrSeedAdminSettings`, because that function is private/non-exported and this module can't import it. It has the identical verbatim-return bug (line 82) and feeds two other functions that index missing keys the same way `checkLiveParamRangesSoft` does. This plan's fix doesn't touch this file, so the corpus/sweep validation tooling (M-8's own quality infrastructure) stays broken for any of the 14 newer keys after this ships.
- **Fix A ⭐ Recommended**: Export `getOrSeedAdminSettings` and have harness.ts import the real (now-fixed) function instead of its duplicate
  - Strength: Deletes the duplicate entirely — one fix point for both production and tooling.
  - Tradeoff: Slightly widens this phase's diff (one more file, one export-visibility change).
  - Confidence: HIGH — the duplicate's own comment names the private-export limitation as the only reason it exists.
  - Blind spot: Haven't checked whether harness.ts's own test asserts anything about the duplicate's specific behavior that would need updating.
- **Fix B**: Leave the duplicate as-is; explicitly note it in "What We're NOT Doing" as a known, accepted gap
  - Strength: Zero additional change surface in an already-production-incident-driven fix.
  - Tradeoff: The corpus/sweep tooling silently stays broken for any new range key added in the future.
  - Confidence: MEDIUM — acceptable only if this tooling isn't currently relied upon.
  - Blind spot: Current usage frequency of scripts/corpus/harness.ts not checked.
- **Decision**: FIXED (Fix A — confirmed no test in harness.test.ts asserts on the duplicate's specific behavior)

### F2 — Plan's "Current State Analysis" undercounts affected UI call sites

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis
- **Detail**: Codebase verification found the same unguarded-key-access pattern also in `server-run-viewer.tsx`, `simulation-canvas.tsx`, and `admin-settings-form.tsx` — not just the 3 call sites named. The single-fix-point design already covers all of these transparently, but the plan's own documentation doesn't name them.
- **Fix**: Add these 3 files to Current State Analysis's list of affected call sites, noting the fix covers them with no additional change needed.
- **Decision**: FIXED
