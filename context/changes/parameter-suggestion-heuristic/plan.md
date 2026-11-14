# Heuristic next-parameter suggestion Implementation Plan

## Overview

Suggest one parameter change — the admin-ranged parameter most correlated with the user's own final score across their past completed runs — on the simulation staging page, where the user is about to configure their next run.

## Current State Analysis

- `DEFAULT_PARAMETER_RANGES`/`RANGED_PARAMETER_NAMES` (`src/server/simulation/parameter-ranges.ts:6-20`) name the 13 configurable parameters: `boidCount`, `separationWeight`, `alignmentWeight`, `cohesionWeight`, `maxDurationSeconds`, `predatorCount`, `protectionThreshold`, `foodStockInitial`, `foodRegenRate`, `flockCount`, `energyThreshold`, `mutationChance`, `mutationMagnitude`. All 13 are plain numeric columns on `simulationRuns` (`schema.ts:92-137`) already persisted for every run — this heuristic needs nothing F-05 (`history`) added; it only needs `score` + these 13 columns, both present since S-04.
- No existing precedent for a correlation/statistics computation anywhere in this codebase — this plan introduces the first one, scoped as narrowly as possible (a single Pearson correlation per parameter, no new dependency).
- `src/app/simulation/page.tsx` (521 lines) is the staging form — 13 `useState` fields mirroring the ranged parameters, each with an inline `<label>` whose display text (`"Boid count"`, `"Separation weight"`, etc. — read directly from the file) this plan's suggestion rationale reuses, so the same parameter is named identically in the form and in the suggestion.
- `getRunAnalysis`/`getRunsComparison`/`listCompleted` (`simulation.ts`) are the precedent for a protected query scoped to `ctx.session.user.id`'s own rows — this plan's new query follows the same ownership scoping, but needs no per-row ownership *check* (unlike those three) since it only ever reads the caller's own rows via a `WHERE userId = ctx.session.user.id` filter, never a client-supplied `runId`.

## Desired End State

On `/simulation`'s staging page, above the parameter form, the user sees either: "Try increasing/decreasing `<parameter>`" with a one-line rationale and a confidence qualifier, or "Not enough data yet" if fewer than 3 of their own completed runs vary any one parameter enough to say anything. The suggestion is advisory text only — it does not auto-fill the form.

### Key Discoveries

- The resolved product decision already fixes the two load-bearing choices this plan would otherwise have to ask about: optimizes toward the final score (not an isolated factor), and the suggestion names one parameter with a rationale + confidence qualifier (not a ranked list, not a full ranked plan).

## What We're NOT Doing

- No auto-fill of the staging form from the suggestion — the user reads it and decides; this is a heuristic nudge, not an optimizer (per FR-015's own "heuristic, not full optimization" framing).
- No multi-parameter ranked list — exactly one suggested parameter, per the resolved decision.
- No suggestion on the dashboard or analysis pages — it lives only on the staging page, the moment it's actually actionable (about to configure the next run).
- No persistence of past suggestions, no suggestion history.
- No change to `getRunAnalysis`, `getRunsComparison`, `listCompleted`, or any existing procedure.

## Implementation Approach

A plain, framework-free correlation function (unit-testable without a DB or session) computes the suggestion from an array of `{parameter values, score}` rows; a thin tRPC query fetches the caller's own completed runs and delegates to it. Two phases: backend (query + correlation logic), then the staging-page UI.

## Phase 1: Suggestion query and correlation logic

### Overview

Add the correlation/selection logic as a plain function, and a new tRPC query that fetches the caller's own completed runs and delegates to it.

### Changes Required:

#### 1. Correlation and selection logic

**File**: `src/server/simulation/parameter-suggestion.ts` (new file)

**Intent**: A plain function taking an array of the caller's own completed runs (just `score` + the 13 ranged parameter values per run) and returning either an "insufficient data" result or the single best suggestion. For each of the 13 parameters: collect `(value, score)` pairs, skip the parameter if the sample has fewer than 3 runs or the parameter's value never varies (all one value — correlation is undefined). Compute the Pearson correlation coefficient for each eligible parameter; pick the one with the largest `|r|`. Map `(|r|, sampleSize)` to a confidence qualifier via fixed thresholds. No framework types in this file's signature — plain arrays/numbers in, a plain result object out, so it's unit-testable without a DB or session (same discipline this project's lessons.md already established for `run-export.ts` and the tRPC-subscription extraction).

**Contract**:
```ts
export type SuggestionInputRow = {
  score: number;
} & Record<RangedParameterName, number | boolean>;
// (RANGED_PARAMETER_NAMES/RangedParameterName imported from parameter-ranges.ts;
// flockCount/boidCount/etc. are numbers, crossbreedingEnabled is boolean and is
// explicitly excluded from correlation — see below)

export type ParameterSuggestion =
  | { status: "insufficient-data" }
  | {
      status: "ok";
      parameter: RangedParameterName;
      direction: "increase" | "decrease";
      correlation: number; // -1..1
      sampleSize: number;
      confidence: "low" | "medium" | "high";
      rationale: string;
    };

export function suggestParameterChange(
  rows: SuggestionInputRow[],
): ParameterSuggestion;
```
Only numeric ranged parameters are correlated — `crossbreedingEnabled` is a boolean toggle, not a ranged numeric parameter (`RANGED_PARAMETER_NAMES` already excludes it; it's not in the 13), so no special-casing is needed. Confidence thresholds: `|r| >= 0.7 && sampleSize >= 5` → `"high"`; `|r| >= 0.4` → `"medium"`; otherwise `"low"` (still shown — a low-confidence suggestion is still the best signal available, not withheld). `rationale` is a plain sentence built from a parameter-label map mirroring `/simulation/page.tsx`'s exact field labels (e.g. `"Across your last {sampleSize} runs, higher Boid count correlated with a better score (r = 0.62)."`).

#### 2. Suggestion query

**File**: `src/server/api/routers/simulation.ts`

**Intent**: A new `protectedProcedure.query` with no input, fetching the caller's own `status: "stopped"` runs (bounded, e.g. `.limit(500)` — same resource-safety posture as `listCompleted`'s `.limit(50)`, sized larger here since this reads parameter columns, not full history) with `score` and all 13 ranged-parameter columns, filtering out any row with a `null` score (defensive — `stopped` rows should always have a score, but a `startServer` failure path can leave one null), then delegating to `suggestParameterChange`.

**Contract**: `getParameterSuggestion: protectedProcedure.query(...)` returning `ParameterSuggestion` directly (no wrapping). Added near `listCompleted` in the router, reusing the exact `ctx.session.user.id` + `status: "stopped"` filter that query already uses.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/parameter-suggestion.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — pure backend, covered by automated tests)

---

## Phase 2: Suggestion card on the staging page

### Overview

Show the suggestion (or "not enough data yet") above the parameter form on `/simulation`.

### Changes Required:

#### 1. Suggestion card

**File**: `src/app/simulation/page.tsx`

**Intent**: Call the new query; render a small card above the existing parameter form. `status: "ok"` renders the rationale sentence plus a confidence badge; `status: "insufficient-data"` renders a one-line "Not enough data yet — run a few more simulations with varied parameters to get a suggestion." Advisory only — no button to apply it, no auto-fill of the form's `useState` fields (per "What We're NOT Doing").

**Contract**: New `api.simulation.getParameterSuggestion.useQuery()` call; a new section rendered conditionally on `suggestionQuery.data`, placed before the existing parameter-form `<section>`/fields, matching this page's existing Tailwind card conventions (`bg-input text-foreground ... rounded-2xl px-4 py-3`, the same shell every other section on this page and the dashboard already uses).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- With fewer than 3 completed runs (or no varying parameter), the staging page shows "Not enough data yet"
- With 3+ completed runs where one parameter clearly varies with score, the staging page shows a suggestion naming that parameter, a direction, and a confidence qualifier
- The suggestion never auto-fills or changes the form's current values
- The rest of the staging page (parameter form, running/saved lists) renders unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `parameter-suggestion.test.ts`: `suggestParameterChange` — returns `insufficient-data` for <3 rows or zero-variance parameters; picks the parameter with the strongest correlation among several candidates (a synthetic dataset where one parameter is clearly linearly related to score and others are noise); correct confidence thresholds at the boundary values; correct `direction` sign for a positive vs. negative correlation; rationale sentence contains the correct parameter label and sample size.
- `simulation.test.ts`: `getParameterSuggestion` — returns the caller's own-runs-only computation (not another user's runs); excludes non-`stopped` runs; excludes null-score rows; returns `insufficient-data` for a caller with no completed runs.

### Manual Testing Steps:

1. As a fresh user with 0-2 completed runs, open `/simulation` — confirm "not enough data yet".
2. Complete 3+ runs with one parameter (e.g. `boidCount`) deliberately varied and the others held constant, confirm the suggestion names that parameter.

## Performance Considerations

Bounded by `.limit(500)` on the fetch; the correlation computation itself is O(parameters × rows), trivial at this scale.

## Migration Notes

None — no schema change, pure read of existing columns.

## References

- `src/server/simulation/parameter-ranges.ts:6-20` — `RANGED_PARAMETER_NAMES`, the 13 parameters this plan correlates.
- `src/server/api/routers/simulation.ts` (`listCompleted`) — the ownership/status-filter pattern this plan's query reuses.
- `src/app/simulation/page.tsx:315-491` — the staging form's existing field labels, reused verbatim in the suggestion's rationale text. Exact label strings: "Boid count", "Separation weight", "Alignment weight", "Cohesion weight", "Max duration (seconds)", "Predator count", "Protection threshold", "Initial food stock", "Food regen rate", "Flock count", "Energy threshold", "Mutation chance", "Mutation magnitude" (verified against the file during plan-review).
- `context/foundation/lessons.md` ("SQLite's libsql client needs..." entry's sibling rule about `run-export.ts`) — the precedent for extracting plain, framework-free logic this plan follows for `parameter-suggestion.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Suggestion query and correlation logic

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 1c99612
- [x] 1.2 Linting passes: `npm run check` — 1c99612
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/parameter-suggestion.test.ts src/server/api/routers/simulation.test.ts` — 1c99612
- [x] 1.4 Full suite still passes: `npm test` — 1c99612

### Phase 2: Suggestion card on the staging page

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`

#### Manual

- [x] 2.4 With fewer than 3 completed runs (or no varying parameter), the staging page shows "Not enough data yet"
- [x] 2.5 With 3+ completed runs where one parameter clearly varies with score, the staging page shows a suggestion naming that parameter, a direction, and a confidence qualifier
- [x] 2.6 The suggestion never auto-fills or changes the form's current values
- [x] 2.7 The rest of the staging page (parameter form, running/saved lists) renders unchanged
