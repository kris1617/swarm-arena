# Plan Brief: Score phase quality per completed lifecycle cycle

Full plan: `context/changes/phase-quality-per-cycle-scoring/plan.md`

## What and why

`computePhaseQuality` rewards a population for completing a crash→recovery
resilience cycle — but only as a flat yes/no bonus. A run that survives
three full crashes and recovers each time currently scores identically to
one that barely survives a single cycle, because the bonus is a boolean
"did this happen at least once anywhere," not a count. This plan replaces
that boolean with an actual cycle count and scales the bonus accordingly,
with diminishing returns so endless crash-cycling doesn't get unbounded
reward.

## Starting Point

`classifyPopulationPhase` already correctly re-classifies the population's
phase every tick from a rolling window, so a run genuinely can — and does —
cycle through `growth → overshoot → crash → recovery` more than once. The
bug is purely in how `computePhaseQuality` aggregates that history into one
number: it averages phase-quality weights flatly across every tick (correct,
unchanged by this plan) but detects the resilience bonus with a single
boolean scan that stops at the first crash→recovery pair found anywhere.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| What changes | Only the resilience-bonus half of `computePhaseQuality` | The flat time-weighted average term has no stated gap — it already reflects overall time-in-good-phases regardless of cycle count |
| Cycle counting | Non-overlapping crash→recovery pair scan, single forward pass | O(n), strictly cheaper than the O(n²)-worst-case nested loop it replaces |
| Bonus formula | `1 + 0.2 × min(cycleCount, 3)` | 1 cycle reproduces today's exact `1.2×` — all 4 existing tests stay green unchanged; caps at 3 cycles (`1.6×`) so degenerate endless-crash runs don't get unbounded reward |
| Signature | Unchanged — still `(phaseHistory: PopulationPhase[]): number` | No caller in `server-run-registry.ts` or `simulation.ts` needs any change |
| Interview | Skipped | Gap already confirmed by direct code inspection (not a hypothesis); only open question (exact formula) was explicitly deferred to planning as implementer's call |

## Phases

1. **Count-based resilience bonus** — replace `hasCrashToRecovery` with `countCrashToRecoveryCycles`, scale the bonus by count with a cap, add two new tests (multi-cycle beats single-cycle; cap behavior), keep all 4 existing tests green.

**Prerequisites**: None — standalone fix to already-shipped `computePhaseQuality`.
**Estimated effort**: Single-phase, single-file change (plus its test file) — no new files, no schema, no UI.

## What We're NOT Doing

- Not touching `classifyPopulationPhase`, the flat average term, or any other exported function
- Not retroactively recomputing already-archived runs' scores
- Not building the analysis-view UI that will eventually display per-cycle breakdowns (that's roadmap S-11, downstream of this)

## References

- Roadmap: S-09 (`phase-quality-per-cycle-scoring`), MS-06
- PRD: FR-019, FR-010 (full)
- Full plan: `context/changes/phase-quality-per-cycle-scoring/plan.md`
