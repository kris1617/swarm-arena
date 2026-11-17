---
change_id: testing-perf-baseline
title: Reproducible performance baseline
status: implemented
created: 2026-11-17
updated: 2026-11-17
archived_at: null
---

## Notes

Open a change folder for rollout Phase 8 of context/foundation/test-plan.md:
"Reproducible performance baseline". Risks covered: #8 (no repeatable
wall-clock benchmark tracked for comparison), related to #7 and #9. Test
types planned: benchmark (non-CI-gating).

Risk response intent: a reproducible benchmark suite measuring real tick
cost (ms/tick) across a representative grid of object counts, area sizes,
and concurrent-run counts, with results saved to compare over time; must
run single-process (per lessons.md's cross-process-contamination lesson)
with N≥5-10 repeated samples per config, not a single run.
