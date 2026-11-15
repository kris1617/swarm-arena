<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Live-adjust crossbreeding toggle

- **Plan**: context/changes/live-crossbreeding-toggle/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 5/5 paths ✓ (`parameter-ranges.ts`, `server-run-registry.ts`, `simulation.ts`, `server-run-viewer.tsx`, `simulation-canvas.tsx`), symbols confirmed, brief↔plan consistent.
Deep verification (sub-agent, 4 riskiest claims + blast-radius + pattern check): all 4 type-design claims (a-d) CONFIRMED — `Pick`'s type preservation needs no signature changes to `LiveAdjustableParams`/`applyLiveParams`; the `checkLiveParamRangesSoft` call-site conversion is sufficient and doesn't touch the shared function; `server-run-viewer.tsx`'s mutation-send site is correctly identified as the one subtle-bug-prone spot; `simulation-canvas.tsx` genuinely needs no conversion beyond the `tick()` read site. Blast-radius sweep found one real gap (F1) and one additional, type-safe but cosmetic caller (F3) the plan's file list missed.

## Findings

### F1 — checkAgainstAdminRanges will fail typecheck, missing from Phase 1

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, item 1 (RANGED_PARAMETER_NAMES widening)
- **Detail**: `simulation.ts:152-166`'s `checkAgainstAdminRanges` (used by `start`/`startServer`, not `updateRunParams`) loops `RANGED_PARAMETER_NAMES` and does `value < range.min || value > range.max`. `startInputSchema` already has `crossbreedingEnabled: z.boolean()`, so once this field joins `RANGED_PARAMETER_NAMES`, `value`'s type becomes a union including `boolean`, and `<`/`>` against a boolean operand is a genuine TypeScript compile error. The plan's "only 2 call sites need coercion" claim missed this third one — confirmed by direct read of the function.
- **Fix**: Add a generic (not field-name-specific) skip at the top of `checkAgainstAdminRanges`'s loop: `if (typeof value === "boolean") continue;` — booleans have no meaningful admin-configurable range to validate against, consistent with the plan's own "generic coercion, not field-specific branching" philosophy. Add this as Phase 1 item 6.
- **Decision**: FIXED — plan.md's Phase 1 now has item 6 (the boolean-skip) plus a matching Automated Verification bullet confirming `start`/`startServer` still accept the field without throwing.

## Warning Findings

### F2 — parameter-ranges.test.ts's exact-field-count test not in Phase 1's criteria

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Automated Verification
- **Detail**: `parameter-ranges.test.ts:9` ("has exactly one entry per RANGED_PARAMETER_NAMES, no more, no fewer") will fail once the new field is added, but Phase 1's Automated Verification doesn't name this test file.
- **Fix**: Add `npx vitest run src/server/simulation/parameter-ranges.test.ts` to Phase 1's Automated Verification, and update the test's expected field list to include `crossbreedingEnabled`.
- **Decision**: FIXED — folded into F1's edit; plan.md's Phase 1 Automated Verification now names this test file explicitly.

## Observations

### F3 — Admin settings UI will cosmetically render a numeric editor for a boolean

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: src/app/admin/settings/_components/admin-settings-form.tsx:64
- **Detail**: This file iterates `RANGED_PARAMETER_NAMES` to render a min/max/default numeric editor per field. Once `crossbreedingEnabled` joins the list, an admin will see a "Min/Max/Default" numeric editor for a boolean toggle — no type break, just a semantically odd UI the plan never calls out as an accepted, conscious scope exclusion.
- **Fix**: No code change needed — note it in the plan as a deliberately accepted, out-of-scope UI quirk (admin-settings polish isn't part of this slice).
- **Decision**: FIXED (user chose to fix rather than accept) — plan.md's Phase 1 now has item 7, excluding `crossbreedingEnabled` from `admin-settings-form.tsx`'s `RANGED_PARAMETER_NAMES.map(...)` loop via a `.filter(...)`, plus a matching manual verification step.
