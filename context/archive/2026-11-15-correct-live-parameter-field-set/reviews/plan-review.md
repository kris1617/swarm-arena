<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Correct S-27's live-adjustable field set

- **Plan**: context/changes/correct-live-parameter-field-set/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

Paths: 5/5 ✓ (`server-run-registry.ts`, `simulation.ts`, `server-run-viewer.tsx`, `parameter-ranges.ts`, `simulation/page.tsx`). Symbols: `LiveAdjustableParams`, `getLiveRunState`, `updateRunParams`, `checkLiveParamRangesSoft`, `DEFAULT_PARAMETER_RANGES`, `LIVE_FIELDS` — all confirmed at claimed locations. Brief↔plan: consistent.
Codebase verification (sub-agent, 7 riskiest claims): **5 CONFIRMED, 2 under-specified (not wrong, just incomplete)**. `DEFAULT_PARAMETER_RANGES` confirmed with exact bounds (`energyThreshold: 0.1-500`, `mutationChance`/`mutationMagnitude: 0-1`). Exact line ranges for `getLiveRunState`'s `liveParams` literal (141-147) and `updateRunParams`'s zod schema (900-909) confirmed exactly. No other file references `LiveAdjustableParams`/`LIVE_FIELDS`/`LIVE_FIELD_LABELS` beyond the 3 the plan names. The two gaps: the plan's "update any test that references the old field set" doesn't enumerate which tests (11 total: 5 in `server-run-registry.test.ts`, 6 in `simulation.test.ts`, 4 in `server-run-viewer.test.tsx`), and the plan's assumed "existing multi-field grouped-heading pattern" doesn't actually exist — `admin-settings-form.tsx` only has a one-field-per-`<fieldset>` idiom, not a multi-field group.

## Findings

### F1 — Success Criteria doesn't enumerate which tests need field-name updates

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 & Phase 2, Automated Success Criteria
- **Detail**: The plan says "update any test that references the old field set" without listing them. Sub-agent enumeration: `server-run-registry.test.ts` — 5 tests (L298, L304, L356, L396, L440); `simulation.test.ts` — 6 tests inside the `updateRunParams` describe block (L2634, L2647, L2665, L2679, L2708, L2725); `server-run-viewer.test.tsx` — 4 tests inside the "live-edit panel" describe block (L276, L289, L311, L341), all sharing the `LIVE_PARAMS_FIXTURE` at L98-100. 15 tests total.
- **Fix**: Add the enumerated list (test names + line numbers above) to each phase's Automated Success Criteria, so the implementer has a checklist instead of an open-ended "any test."
- **Decision**: FIXED — plan.md's Phase 1/2 Automated Success Criteria now enumerate all 15 tests by name and line number.

### F2 — No existing precedent for the planned multi-field grouped-heading UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, item 2 (Grouped rendering)
- **Detail**: `admin-settings-form.tsx`'s `<fieldset>`+`<legend>` idiom (L64-69) groups exactly one field per fieldset (legend = that field's own name) — it does not establish a pattern for multiple `NumberField`s under one shared heading, which is what Phase 2 needs (2 fields under one heading, 3 under another). The implementer has no ready-made template to copy for this specific shape.
- **Fix**: Add explicit guidance to Phase 2 item 2's Contract: use a plain heading element (e.g. a small `<h3>`/`<p className="font-semibold">`-style label matching this panel's existing heading conventions, not a `<fieldset>`/`<legend>` per field) followed by a `<div className="flex flex-col gap-2">` wrapping that group's `NumberField`s — i.e., don't reach for `admin-settings-form.tsx`'s one-field-per-fieldset idiom, since it doesn't fit a multi-field group.
- **Decision**: FIXED — plan.md's Phase 2 item 2 Contract now explicitly names the correct pattern and rules out the fieldset/legend idiom.
