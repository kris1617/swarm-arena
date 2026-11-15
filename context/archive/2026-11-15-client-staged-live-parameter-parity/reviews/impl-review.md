<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Client-staged live parameter parity

- **Plan**: context/changes/client-staged-live-parameter-parity/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

Agent 1 (Plan Drift Detection) found zero drift across all 8 planned items spanning the 3 phases — the shared-validation extraction, the 5 refs + live-edit panel + mock extension, and the changelog accumulator + stop-schema extension all match the plan exactly. Scope guardrails held: `server-run-registry.ts`, `server-run-viewer.tsx`, and the analysis page's `ReferenceLine` rendering were untouched by this change's commits; no dirty-tracking or server-side throttle was added; flocking weights/`boidCount`/`flockCount` correctly received no ref/live-adjust treatment.

Agent 2 (Safety, Quality & Pattern Compliance) confirmed no logical race in `handleApplyLiveField`'s push→write→range-check sequence (single-threaded JS, synchronous block), confirmed `parameterChanges` is properly bounded (`.max(50_000)`, matching sibling sample arrays) and needs no DB migration (schema-less JSON `history` column), and confirmed the new code matches both explicit precedents it was meant to mirror (`showMinimapRef`/`showBoundaryRef`'s ref+state pattern; `server-run-viewer.tsx`'s panel JSX shape) — the two deliberate divergences (per-field Apply instead of batched; query-sourced ranges instead of hardcoded defaults) are improvements, not regressions.

All automated gates re-confirmed green on current HEAD: `npm run typecheck`, `npm run check` (1 pre-existing unrelated warning), full suite (298/298).

## Findings

### F1 — parameterChanges.field accepts any string, not the known closed set

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:~406-414
- **Detail**: The `stop` procedure's new `parameterChanges[].field` is `z.string()` (unconstrained), while this same schema's sibling `phaseHistory` field uses `z.enum([...])` for a closed set, and this file elsewhere (L1097) already uses `z.enum(RANGED_PARAMETER_NAMES)` for exactly this field-name concept. Low impact — this data only feeds a read-only chart overlay, never a lookup key — but it's a real inconsistency with established repo precedent.
- **Fix**: Change `field` to `z.enum(RANGED_PARAMETER_NAMES)` (imported from `parameter-ranges.ts`), matching the file's own existing convention at L1097.
- **Decision**: FIXED — `field` is now `z.enum(RANGED_PARAMETER_NAMES)`; the test fixture/local test values were retyped from `string` to `RangedParameterName` accordingly.

### F2 — tick/oldValue/newValue lack numeric constraints siblings use

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:~406-413
- **Detail**: `tick`/`oldValue`/`newValue` are bare `z.number()` with no `.nonnegative()`/`.int()`/`.finite()`, unlike sibling arrays in the same schema (e.g. `populationCountSamples: z.array(z.number().int().nonnegative())`). Display-only, owner-authenticated data — low stakes, but inconsistent with the file's own convention.
- **Fix**: Add `z.number().int().nonnegative()` for `tick`; leave `oldValue`/`newValue` as plain numbers (they're genuinely arbitrary parameter values, unlike `tick`).
- **Decision**: FIXED — `tick` is now `z.number().int().nonnegative()`.
