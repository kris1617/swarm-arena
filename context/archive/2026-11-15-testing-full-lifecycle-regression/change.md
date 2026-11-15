---
change_id: testing-full-lifecycle-regression
title: Full user-journey regression test (start/pause/resume/stop/compare/cleanup)
status: archived
created: 2026-11-15
updated: 2026-11-15
archived_at: 2026-11-15T07:24:47Z
---

## Notes

User-requested drift-detection gap, not a pre-named row in
`context/foundation/test-plan.md` §3. Owner asked: "do I have functional
tests to see if my functionality does not drift?" and described the
desired regression scenario in their own words: set up a simulation, check
stop/resume, compare scores, and finish with an empty dashboard (all test
data deleted).

Existing coverage (`src/server/api/routers/simulation.test.ts`, 12
`describe` blocks) already exercises every `simulationRouter` procedure in
isolation — `start`, `startServer`, `stop` (incl. ownership/race cases),
`listRunning`/`listSaved`/`listCompleted`/`listLeaderboard`,
`getParameterSuggestion`, `getRunAnalysis`, `getRunsComparison` (FR-016's
2-4-run comparison), `savePause`/`resume`, `getParameterRanges`. What does
NOT exist: a single test that drives the real cross-procedure sequence a
user actually performs end-to-end (start → pause → resume → finish → list
→ compare → delete → verify empty), so a regression where one step's
output silently breaks the next step's input (e.g. `savePause`'s snapshot
shape drifting from what `resume` expects, or `stop`'s persisted `history`
shape drifting from what `getRunsComparison` reads) would not necessarily
be caught by the isolated per-procedure tests, which each construct their
own fixture rows directly rather than chaining real mutations.

This is pragmatic, subagent-authored scope (no interactive `/10x-plan`
research pass) per explicit instruction from the orchestrating session —
not a `/10x-test-plan --refresh`-approved risk. Recorded here so a future
`--refresh` can decide whether to promote it into a named §3 rollout phase.

Scope: one new integration-level test in the existing router test file,
no production code changes, no new dependencies. Does not touch
`src/app/leaderboard/`, `src/components/app-shell.tsx`, or any deploy
file — out of scope per the task brief.
