---
change_id: testing-wallclock-optimization-guardrail
title: Wall-clock-aware optimization guardrail
status: impl_reviewed
created: 2026-11-17
updated: 2026-11-17
archived_at: null
---

## Notes

Open a change folder for rollout Phase 10 of context/foundation/test-plan.md:
"Wall-clock-aware optimization guardrail". Risks covered: #7 (a future
performance "optimization" passes the existing structural big-O/call-count
guard while making real wall-clock latency worse for this project's actual
radius/world-size ratios — this already happened once and was kept anyway,
per archive/2026-11-15-spatial-hash-performance-optimization/plan.md). Test
types planned: benchmark + unit.

Risk response intent: require any future "this is faster" claim about the
simulation engine to prove it in BOTH dimensions — the existing structural
big-O/call-count guard (Risk #3's test) AND a measured wall-clock
comparison against Phase 8's tracked baseline (scripts/perf-baseline.ts /
context/foundation/perf-baseline.json) — so a change that passes the
structural guard but regresses real per-tick cost can no longer be
silently kept, the way spatial-hash-performance-optimization was.
