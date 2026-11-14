# Plan Brief: Per-run population-dynamics analysis view

Full plan: `context/changes/run-analysis-view/plan.md`

## What and why

The last item in this roadmap extension: from a completed run's dashboard
entry, open `/runs/[runId]` and see a population-over-time chart (phase
periods color-coded), a phase-time breakdown, a list of completed
resilience cycles, and a final genetic-diversity value — enough to decide
what to change in the next staged run.

## Two real scope corrections found during planning (not preference — data constraints)

1. **F-05's persisted `history` has no population-count time series.**
   Only `phaseHistory`/`foodRatioSamples`/`survivorGenes` were persisted.
   A population chart needs `populationCountSamples` too — Phase 1 adds
   it. The client (`simulation-canvas.tsx`) was already sending it; the
   server's zod schema silently dropped it until now.
2. **"Diversity trend over time" isn't buildable — only a final value
   is.** `survivorGenes` is one end-of-run snapshot, not a series. V1
   shows a single genetic-diversity stat, not a chart.

Rows that completed before Phase 1 ships render "no population data"
for the chart (forward-only, no backfill — matches this project's
established posture), while phase breakdown/cycles/diversity still work
(they only need data F-05 already persisted).

## Starting Point

`computeGeneticDiversity` and the cycle-detection logic (S-09's
`countCrashToRecoveryCycles`) already exist — this plan exposes the cycle
*ranges* (`segmentCompletedCycles`) instead of just a count, and calls
the existing diversity function on already-persisted data. No charting
library exists; the user explicitly chose Recharts over plain tables or
hand-rolled SVG (this project's first charting dependency — a bigger,
harder-to-reverse commitment than anything else in this extension, so it
was asked rather than decided unilaterally).

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Charting library | Recharts `3.10.1` | User's explicit choice; confirmed compatible with this project's `react@^19.0.0` |
| Growth-curve "comparison" | Actual trajectory + phase-colored periods, no fitted logistic overlay | A real least-squares fit is real future work, not reflexively added for a v1 |
| Diversity | Single final value, not a trend chart | `survivorGenes` is a one-time snapshot — no historical series exists to plot |
| x-axis for the chart | Tick index | No separate timestamp array exists per-tick; index is the only always-available axis |
| Route | `/runs/[runId]` | Matches this project's flat route convention (`/simulation`, `/dashboard`) |
| Pre-Phase-1 rows | Graceful "no population data" message, not a crash | Forward-only persistence is this project's established posture |

## Phases

1. **Persist `populationCountSamples` end-to-end** — extend `finishRun`'s outcome type, both server-owned write sites, `stop`'s zod input + resolver. No client change (already sent, just silently dropped).
2. **`segmentCompletedCycles`, Recharts dependency, `getRunAnalysis` query** — refactor the cycle counter into a range-returning shared helper (pure refactor, S-09's tests prove no behavior change), add the charting dependency, add the ownership-checked per-run query.
3. **`/runs/[runId]` page, dashboard link** — the actual view; closes the loop S-10 explicitly left open.

**Prerequisites**: F-05, S-09, S-10 — all done and archived.
**Estimated effort**: 3 phases; new dependency + 1 new route + 1 new query + 1 refactor + 1 dashboard edit.

## What We're NOT Doing

- Not backfilling older runs' `history`
- Not a true curve-fit overlay
- Not a diversity trend chart
- Not touching the dashboard's Running/Saved sections

## References

- Roadmap: S-11 (`run-analysis-view`), MS-08
- PRD: FR-010 (full), FR-019
- Full plan: `context/changes/run-analysis-view/plan.md`
