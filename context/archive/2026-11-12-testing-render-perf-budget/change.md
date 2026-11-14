---
change_id: testing-render-perf-budget
title: Test structural perf budget for the composed simulation pipeline (test-plan Phase 4)
status: archived
created: 2026-11-12
updated: 2026-11-14
archived_at: 2026-11-14T10:03:52Z
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Perf-budget guard for render usability".
Risk covered: #3 (no automated check that the composed step pipeline stays within a frame-time budget at the FR-018 max object count — only eyeballed; PRD NFR requires "rendering stays usable... no freezing").
Test types planned: unit (perf-budget).
Risk response intent: prove the composed step pipeline's per-tick cost stays within a defined budget at the FR-018 max object count (500), verified structurally (e.g. bounded pairwise-comparison count) rather than by wall-clock timing, per the test-plan's explicit anti-pattern guidance (avoid flaky wall-clock timing in CI).
After creating the folder, follow the downstream continuation rule (continue to /10x-research, to ground the actual per-tick cost profile of runTick/stepBoids/stepPredators at scale).
