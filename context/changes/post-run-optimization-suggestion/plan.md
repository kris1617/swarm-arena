# Run-specific optimization suggestion on the analysis view Implementation Plan

## Overview

Add a second, run-specific suggestion (FR-027) to a completed run's analysis view — distinct from S-13's already-shipped cross-run suggestion — that diagnoses which population phase dominated this one run's own `phaseHistory` and recommends a concrete parameter change, matching FR-027's own worked example ("this run spent most of its time in Crash; consider raising food stock or lowering predator count").

## Current State Analysis

- `getRunAnalysis` (`src/server/api/routers/simulation.ts:557-614`) already returns `history.phaseHistory` (a per-tick array of `"establishment" | "growth" | "overshoot" | "crash" | "recovery"`) and `completedCycles`, but only selects `boidCount`/`predatorCount` from the run row — not `foodStockInitial`, `foodRegenRate`, or `protectionThreshold`, which a phase-specific suggestion needs to phrase its recommendation. The sibling `getRunsComparison` query (`simulation.ts:622-709`) already selects exactly those three fields from the same `simulationRuns` table, confirming this widen is a safe, precedented change.
- No per-run diagnostic logic exists anywhere in `src/server/simulation/` today (confirmed by research) — this is new code, not an extension of an existing function.
- S-13's `suggestParameterChange` (`src/server/simulation/parameter-suggestion.ts`) sets the pattern this plan follows: a plain, framework-free, fully unit-testable function with no DB/session access, a thin tRPC query that only fetches and delegates, and a card rendered on a page via `useQuery()`.
- `history` is a schema-less JSON column that can be `null` or missing fields on legacy rows — `getRunAnalysis` already guards this (lines 586-596), returning `history: null` when the required fields aren't present. This plan's new logic must handle that same `null` case.
- User-confirmed decisions (via `/10x-plan`'s interview, 3 questions):
  1. **Diagnosis logic**: 4-branch mapping by dominant phase — crash → raise food stock/regen rate or lower predator count; overshoot → raise food stock/regen rate or lower boid count; establishment → run barely got going, try a longer duration or lower predator count; growth/recovery → healthy, no change needed.
  2. **Edge cases**: require `history` present and ≥10 `phaseHistory` entries, else `insufficient-data`; tie between two phase counts breaks toward the more severe phase, ordered `crash > overshoot > establishment > growth > recovery`.
  3. **Placement**: the new card sits right after the page's `<h1>`, before the population chart — mirroring `simulation/page.tsx`'s own "Suggestion" card placement near the top.

## Desired End State

A completed run's analysis page shows a "Run suggestion" card immediately after the title, before the population chart, stating which phase dominated this run and a concrete, phase-specific parameter recommendation (or "this run went well" for a healthy dominant phase, or an insufficient-data message for a too-short/legacy run). No change to the existing cross-run "Suggestion" card on `/simulation`, the population chart, phase-tally list, completed-cycles list, or genetic-diversity section.

### Key Discoveries

- `completedCycles` (already computed and returned by `getRunAnalysis`) is NOT needed by this plan's diagnosis logic — the dominant-phase count alone is sufficient per the user's confirmed 4-branch design; resilience-cycle count is already shown separately in the existing "Completed resilience cycles" section, so repeating it in the suggestion text would be redundant.
- This is a second, independent pure function + query + card, not a modification of S-13's `suggestParameterChange` — the two features answer different questions (cross-run correlation vs. single-run diagnosis) and must coexist, per FR-027's own Socratic resolution in the PRD.

## What We're NOT Doing

- Not touching `src/server/simulation/parameter-suggestion.ts` (S-13's cross-run suggestion) or its card on `/simulation` — this is a second, separate suggestion, not a replacement.
- Not building FR-028 (live, in-run parameter adjustment) — explicitly parked in the PRD; this plan is read-only diagnosis of a completed run.
- Not adding a "dismiss" or "apply this suggestion" interactive affordance to the card — it's informational text only, matching S-13's card's own read-only presentation.
- Not changing `getRunsComparison`, `getParameterSuggestion`, or any other existing tRPC procedure.

## Implementation Approach

Two phases: build the pure diagnosis function and widen `getRunAnalysis`'s query together (they're tightly coupled — the query needs the new fields the function consumes), then wire the card into the analysis page.

## Phase 1: Diagnosis function and widened query

### Overview

Add `suggestRunOptimization` as a new, independent pure function, and widen `getRunAnalysis` to select the additional parameter columns and call it.

### Changes Required:

#### 1. Add the diagnosis function

**File**: `src/server/simulation/run-optimization-suggestion.ts` (new file)

**Intent**: A plain, framework-free function taking a run's `phaseHistory` and its three relevant parameters (`predatorCount`, `foodStockInitial`, `foodRegenRate`), returning a suggestion. Counts occurrences of each phase in `phaseHistory` to find the dominant one (ties broken toward the more severe phase, ordered crash > overshoot > establishment > growth > recovery, per the user's confirmed decision). Returns `insufficient-data` when `phaseHistory` has fewer than 10 entries. Follows `parameter-suggestion.ts`'s exact style: named types exported, a module-level comment explaining the framework-free discipline and pointing at the thin query that calls it, no DB/session access.

**Contract**:
```ts
export type RunOptimizationSuggestion =
  | { status: "insufficient-data" }
  | { status: "ok"; dominantPhase: PopulationPhase; rationale: string };

export function suggestRunOptimization(input: {
  phaseHistory: PopulationPhase[];
  predatorCount: number;
  foodStockInitial: number;
  foodRegenRate: number;
}): RunOptimizationSuggestion;
```
`rationale` is one of 4 fixed message templates (crash/overshoot/establishment-dominant, or a healthy growth/recovery-dominant message), each naming the dominant phase and, for the 3 non-healthy branches, a concrete parameter suggestion (raise food stock, raise food regen rate, or lower predator count — picking which of the 2-3 candidate parameters to name per branch is an implementation-level wording choice, not a product decision; keep each rationale to one sentence, matching FR-027's own example length).

#### 2. Widen `getRunAnalysis` and call the new function

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Add `foodStockInitial`, `foodRegenRate`, and `protectionThreshold` to `getRunAnalysis`'s existing field list (alongside the current `boidCount`/`predatorCount`, same `run.<field>` access — no new query, just reading more columns off the already-fetched row), and add a `runOptimizationSuggestion` field to the response computed by calling `suggestRunOptimization` with `history?.phaseHistory` (or the `insufficient-data` status directly when `history` is `null`, without calling the function).

**Contract**: `getRunAnalysis`'s return type gains `foodStockInitial: number`, `foodRegenRate: number`, `protectionThreshold: number`, and `runOptimizationSuggestion: RunOptimizationSuggestion`. No change to the procedure's input, auth, or existing fields.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New unit tests for `suggestRunOptimization` cover: each of the 5 dominant-phase branches (crash, overshoot, establishment, growth, recovery), the insufficient-data case (< 10 entries), and a tie-break case (two phases with equal counts, confirming the more-severe one wins)

#### Manual Verification:

- (none for this phase — the new field isn't rendered anywhere yet; Phase 2 wires it into the UI)

---

## Phase 2: Render the suggestion card

### Overview

Add the "Run suggestion" card to `runs/[runId]/page.tsx`, right after the title and before the population chart.

### Changes Required:

#### 1. Render the suggestion card

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Destructure `runOptimizationSuggestion` from `analysisQuery.data` alongside the existing fields, and render a new `<section>` (matching the existing sections' `bg-input text-foreground ... rounded-2xl px-4 py-3` styling) titled "Run suggestion" immediately after the `<h1>` and before the "Population over time" section. Shows the `rationale` text when `status === "ok"`, or "Not enough data in this run to suggest a change." when `insufficient-data` — matching S-13's card's own two-state pattern (`suggestionQuery.data.status === "ok" ? ... : <p>Not enough data yet...</p>`).

**Contract**: No change to any other section's content, order (beyond this new section being inserted before "Population over time"), or the existing `history`-derived fields' rendering.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on `runs/[runId]/page.tsx` still returns zero hits (no literal colors introduced)

#### Manual Verification:

- A completed run whose `phaseHistory` is crash-dominant shows the crash-specific rationale naming a food/predator parameter
- A completed run whose `phaseHistory` is growth/recovery-dominant shows the healthy-run message
- A run with fewer than 10 `phaseHistory` entries (or `history: null`) shows "Not enough data in this run to suggest a change."
- The new card sits between the title and the population chart, with no visual regression to any other section
- Keyboard/focus-visible and landmark behavior established by S-18 (single `main`, no literal colors) is unaffected — this plan adds a `<section>` inside the existing `<div>` root, not a new page root

## Testing Strategy

### Unit Tests:

- `src/server/simulation/run-optimization-suggestion.test.ts` — one test per dominant-phase branch (5), one for insufficient-data, one for the tie-break rule, following `parameter-suggestion.test.ts`'s `describe`/`it` + fixture-builder style.

### Manual Testing Steps:

1. Start and let a short server run finish, open its analysis page, confirm the suggestion card renders with a plausible message matching that run's actual dominant phase (cross-check against the existing "Time in each phase" percentages already shown below it).
2. Spot-check a run with `history: null` (or construct one with fewer than 10 samples) shows the insufficient-data message instead of erroring.

## Performance Considerations

None — `suggestRunOptimization` is an O(n) scan over an already-fetched, already-bounded-size array (a run's `phaseHistory`), computed once per `getRunAnalysis` call, no new query or network round-trip.

## Migration Notes

None — no schema change; `getRunAnalysis` reads existing columns it simply wasn't selecting before.

## References

- `src/server/simulation/parameter-suggestion.ts` and its test file — the structural precedent this plan's Phase 1 follows.
- `src/server/api/routers/simulation.ts:557-614` (`getRunAnalysis`) and `:622-709` (`getRunsComparison`, the precedent for selecting the additional parameter fields).
- `src/server/simulation/boids.ts` — `PopulationPhase` type, `classifyPopulationPhase`, and the phase-weight table that informed which phases this plan treats as "unhealthy" vs "healthy."
- Roadmap `context/foundation/roadmap.md` S-21 — the Slice entry this plan implements.
- PRD `context/foundation/prd.md` FR-027 — the requirement, including its own worked example and Socratic resolution against S-13's FR-015.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Diagnosis function and widened query

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 Full suite still passes: `npm test`
- [x] 1.4 New unit tests cover all 5 dominant-phase branches, insufficient-data, and the tie-break rule

### Phase 2: Render the suggestion card

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`
- [ ] 2.4 Hardcoded-value scan on runs/[runId]/page.tsx still returns zero hits

#### Manual

- [ ] 2.5 Crash-dominant run shows the crash-specific rationale
- [ ] 2.6 Growth/recovery-dominant run shows the healthy-run message
- [ ] 2.7 Insufficient-data run shows the fallback message
- [ ] 2.8 Card placement and no visual regression to other sections
