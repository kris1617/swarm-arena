---
change_id: testing-composed-pipeline-correctness
title: Test composed simulation pipeline order and determinism (test-plan Phase 1)
status: implementing
created: 2026-11-12
updated: 2026-11-12
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Composed-pipeline correctness & determinism".
Risks covered: #1 (step-order/composition regression), #2 (end-to-end determinism regression).
Test types planned: unit + integration.
Risk response intent:
- #1: prove the fixed per-tick order (boids → predators → hunger → predation) is itself asserted, not just each step function in isolation.
- #2: prove the full composed pipeline reproduces identical derived state (not just identical RNG draws) for identical seed+params.
After creating the folder, follow the downstream continuation rule (continue to /10x-research).
