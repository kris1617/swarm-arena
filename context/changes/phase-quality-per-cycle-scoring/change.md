---
change_id: phase-quality-per-cycle-scoring
title: Score phase quality per completed lifecycle cycle, not as one flat average
status: impl_reviewed
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-09 (M-1 extension, 2026-11-14, MS-06). Confirmed by direct code
inspection (not a hypothesis): `computePhaseQuality` in
`src/server/simulation/boids.ts` averages `PHASE_QUALITY_WEIGHTS[phase]`
flatly across the *entire* tick history, and applies a single yes/no
"does at least one crash→recovery pair exist anywhere in the run"
resilience bonus (`RESILIENCE_BONUS_MULTIPLIER`, applied once). A
population that completes three full crash→recovery cycles currently
scores identically to one that barely survives a single cycle.

`classifyPopulationPhase` itself already re-classifies correctly every
tick from a rolling window, so multi-cycle detection at the classification
level is NOT broken — only the aggregation into a single quality number
fails to distinguish "one cycle" from "several."

Fix should summarize phase quality per completed cycle (one full
establishment→growth→overshoot→crash→recovery pass, or however a "cycle"
is bounded) and combine per-cycle results, rather than one flat
whole-run average + one flat bonus flag. Exact aggregation formula
(average of per-cycle quality scores vs. count-weighted resilience bonus,
etc.) is `/10x-plan`-level tuning — not a blocking product unknown.

This changes the score's actual numeric meaning for every future run.
Already-archived/historical scores are not retroactively recomputed —
this only changes future runs' scoring.
