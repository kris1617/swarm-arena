---
change_id: run-analysis-view
title: Per-run population-dynamics analysis view
status: implementing
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-11 (M-1 extension, 2026-11-14, MS-08). Last item in this
extension — depends on F-05 (persist-run-history), S-09
(phase-quality-per-cycle-scoring), and S-10 (post-login-run-dashboard),
all now done and archived.

From a completed run, the user opens an analysis view presenting the
run's population dynamics: a logistic-growth-curve comparison against
the run's actual population trajectory, a phase/cycle breakdown of time
spent in each lifecycle phase (summarized per completed cycle, matching
S-09's fix), and a diversity-index-style summary of genetic diversity
over time — so they can draw a concrete conclusion about what to change
in the next staged run.

Data source: `simulationRuns.history` (F-05) — `{ phaseHistory,
foodRatioSamples, survivorGenes }`, persisted only for runs that
completed (status: "stopped" with history populated) after F-05 shipped.
No backfill for older runs.

Charting decision (explicitly asked, not an implementer default): add
Recharts as a new frontend dependency for real growth-curve/trend charts
in v1, rather than plain tables or hand-rolled SVG. This is the first
charting library in the project.
