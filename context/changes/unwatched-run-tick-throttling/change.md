---
change_id: unwatched-run-tick-throttling
title: Unwatched-run tick throttling
status: implementing
created: 2026-11-17
updated: 2026-11-17
archived_at: null
---

## Notes

Implement rollout Phase/roadmap slice S-36 of
context/foundation/roadmap.md (M-9, the milestone's north star).
Risk #8 (Open Roadmap Question #8): unwatched server-owned simulation
runs currently tick at the same real-time cadence as the one the user
is actively watching, competing equally for the single CPU core this
engine runs on (confirmed single-core-bound: no worker_threads, 4
vCPUs don't help — context/foundation/capacity-limits.md).

Decided mechanism: give unwatched runs (zero active viewers) a fixed
dtSeconds speed multiplier so they advance faster in simulated time
per real tick, relieving contention against the actively-watched run.
Any run that ticks unwatched under the multiplier at any point in its
life must carry a formula/model-version marker (same pattern S-25 used
for its area-aware 5th score factor's formula-version marker), so its
score/history is never silently treated as directly comparable to a
run that never used this feature.

/10x-plan must resolve: the exact multiplier value, exactly how "zero
active viewers" is detected (tied to the watch subscription
mechanism), the exact marker schema/field and everywhere it must be
checked (analysis view, leaderboard, run-comparison — not just written
at score time), and whether a run transitioning
watched->unwatched->watched needs special handling.
