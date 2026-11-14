# Run-specific optimization suggestion — Brief

Full plan: `context/changes/post-run-optimization-suggestion/plan.md`

## What this is

Roadmap S-21 (M-3), FR-027. A second, run-specific suggestion on a completed run's analysis view — distinct from S-13's cross-run suggestion (which needs ≥3 past runs and correlates a parameter against score). This one reasons about a single run's own `phaseHistory`: "this run spent most of its time in Crash; consider raising food stock or lowering predator count."

## Starting Point

- `getRunAnalysis` already returns `history.phaseHistory` (a per-tick array of phase labels) but doesn't select `foodStockInitial`/`foodRegenRate`/`protectionThreshold` — needed to phrase a concrete suggestion. The sibling `getRunsComparison` query already selects exactly those fields, so widening is a safe, precedented change.
- No per-run diagnostic logic exists yet.
- S-13's `suggestParameterChange` sets the pattern to follow: pure function + thin query + card.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Diagnosis logic | 4-branch mapping by dominant phase (crash/overshoot/establishment unhealthy, growth/recovery healthy) | Matches FR-027's own worked example; a 2-branch generic version would lose the specific, actionable diagnosis the PRD explicitly demonstrates |
| Minimum data / tie-break | Require ≥10 `phaseHistory` entries; ties break toward the more severe phase (crash > overshoot > establishment > growth > recovery) | Mirrors S-13's existing insufficient-data pattern; deterministic tie-break avoids arbitrary-feeling output |
| Card placement | Right after the title, before the population chart | Mirrors `simulation/page.tsx`'s own Suggestion card placement near the top |

## Phases

1. **Diagnosis function + widened query** — new pure `suggestRunOptimization` function, `getRunAnalysis` gains 3 fields and calls it.
2. **Render the card** — new "Run suggestion" section on the analysis page.

**Prerequisites**: none (roadmap-ready). **Estimated effort**: small-medium — one new pure function with unit tests, a query widen, one new UI section.

## References

- `src/server/simulation/parameter-suggestion.ts` (structural precedent)
- `context/foundation/prd.md` FR-027
- `context/foundation/roadmap.md` S-21
