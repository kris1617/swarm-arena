# Plan Brief: Persist per-run population history instead of discarding it

Full plan: `context/changes/persist-run-history/plan.md`

## What and why

Every run's `phaseHistory`, `foodRatioSamples`, and survivor genes are
computed in memory to produce the final score, then thrown away —
`simulationRuns.score` is the only thing written back to the DB. Roadmap
S-11 (run-analysis-view) needs this data to show anything; without this
slice landing first, there's nothing for it to read.

## Starting Point

`finishRun` is already the single chokepoint both server-owned stop paths
(`tick()`'s natural completion, `stopServerRun()`'s manual stop) funnel
through. The client-staged `stop` resolver is a separate code path but
already receives everything it needs over the wire
(`input.phaseHistory`/`foodRatioSamples`/`survivingBoidGenes`). No new
computation anywhere — this is purely "stop discarding what's already in
scope."

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage shape | One nullable JSON column, `history` | Mirrors `simulationRuns.savedState`'s own precedent exactly — same column type, same project, already shipped and proven |
| Which stop paths write it | All 3 terminal-stop call sites (`stop` resolver, `tick()` natural completion, `stopServerRun`) | Every path already computes the same 3 arrays to produce the score; adding one field to each existing write is the minimal change |
| Tick-error path | `history: null`, same as `score: null` | Tick's own state may be unreliable at that point (existing comment on that code path) — don't persist possibly-corrupt data |
| Retroactive backfill | No — forward-only | Matches the roadmap's own recorded default (Open Roadmap Question #4) |
| Interview | Skipped | Fully grounded in the already-shipped `savedState` precedent; no genuine open decision remained |

## Phases

1. **Add history column, thread through all 3 stop paths** — schema column, `finishRun`'s outcome param extended, `stop` resolver's existing update call extended, tests for all 3 paths including the null-on-error case.

**Prerequisites**: None — standalone, additive persistence.
**Estimated effort**: Single-phase; touches 3 files (schema + 2 call-site files) plus their tests. Remember to `drizzle-kit generate` the migration — `full-score-save-resume` got this wrong and broke CI for most of a day.

## What We're NOT Doing

- Not touching `savedState`/"saved" status
- Not backfilling already-stopped rows
- Not building the analysis UI that reads this (that's S-11, downstream)
- Not persisting history on the tick-error path

## References

- Roadmap: F-05 (`persist-run-history`), MS-08
- PRD: FR-019, FR-010 (full)
- Full plan: `context/changes/persist-run-history/plan.md`
