---
change_id: persist-run-history
title: Persist per-run population history instead of discarding it
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap F-05 (M-1 extension, 2026-11-14, MS-08). Confirmed by direct code
inspection: `computeScore`'s call sites (`stop` resolver in
`src/server/api/routers/simulation.ts`, and `tick()`/`stopServerRun` in
`src/server/simulation/server-run-registry.ts`) consume `phaseHistory`,
`foodRatioSamples`, and survivor genes only to compute the final score
number — none of those arrays are persisted anywhere. `simulationRuns.score`
is the only thing written back to the DB when a run finishes. Roadmap item
S-11 (run-analysis-view) has nothing to read without this landing first.

No prerequisites — purely additive persistence of data that already exists
in memory at score-time. Not affected by S-09's (already shipped)
aggregation-formula fix, since the raw per-tick phase labels are unchanged
by that fix.

Scope: persist the three sample arrays (phaseHistory, foodRatioSamples,
survivor genes/gene snapshots) alongside the score when a run finishes
(stops, not merely saved/paused — "saved" is already its own persisted
snapshot via `savedState` from full-score-save-resume Phase 4). Storage
shape (one JSON blob similar to `savedState`, vs. normalized rows) is
`/10x-plan`-level implementer's call, bounded by this project's declared
small scale.
