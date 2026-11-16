---
change_id: spatial-grid-dense-clustering-fallback
title: Keep spatial-grid neighbor queries bounded when boids cluster densely
status: implementing
created: 2026-11-16
updated: 2026-11-16
archived_at: null
---

## Notes

Discovered while validating `parameter-sweep-corpus-generation` (S-33)'s real
20-row corpus generation: with `separationWeight: 0.5` (the sweep's lowest
value, shared by all 4 of batch 1's rows), boids cluster far more tightly
than at default `separationWeight: 1`. When many boids pack into the same
few grid cells, `spatial-grid.ts`'s `queryRadius` returns most of the
population as candidates instead of a handful, degrading
`reproducePopulation`'s per-tick mate-scan from near-O(1)-per-individual
toward O(n) — effectively O(n²) per tick under dense clustering. This
compounds as population grows toward the 500 cap over a long run (more
ticks AND a bigger, more-clustered population to scan each tick).

Confirmed empirically this session (not guessed): isolated reproductions of
the real sweep's first batch (same 4 rows, same harness) completed cleanly
at `maxDurationSeconds` 20s/45s/300s, but a 900s run never finished even
after 1800s (30 real minutes) of wall-clock time — a ~20x+ disproportionate
slowdown for only 3x more simulated duration. Default-parameter
(`separationWeight: 1`) runs showed no such degradation at any duration
tested. `queryRadius`'s own implementation (`spatial-grid.ts`) has no
fallback or candidate cap for the case where a cell (or the handful of
cells within `range`) ends up holding a large fraction of the whole
population — this is that gap.

This is a pre-existing engine performance characteristic, not a regression
introduced by `parameter-sweep-corpus-generation`'s Phase 1-4 work (which
only fixed per-tick *sample-array* growth in `single-run-lifecycle.ts`,
explicitly out of scope for `boids.ts`'s own array/query costs). Fixing it
unblocks the real corpus generation's batch 1 (and any other low-
`separationWeight` row), but is itself a general engine robustness fix, not
specific to that one change.
