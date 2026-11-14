---
change_id: testing-simulation-ownership
title: Test cross-user ownership regression on simulation.stop (test-plan Phase 3)
status: archived
created: 2026-11-12
updated: 2026-11-14
archived_at: 2026-11-14T10:03:52Z
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Authorization regression coverage".
Risk covered: #5 (authorization/IDOR gap on simulation.stop — ownership check exists but is only verified once, manually, per the basic-flocking-loop plan's Progress 2.6/2.7; the one automated router test only covers input-validation, not cross-user access).
Test types planned: integration.
Risk response intent: prove calling simulation.stop for a run owned by a different user throws FORBIDDEN, and an unauthenticated call throws UNAUTHORIZED — as a regression test via the createCaller pattern already used in simulation.test.ts with two fabricated sessions, not a one-time manual check.
After creating the folder, follow the downstream continuation rule (continue to /10x-research, to ground exactly where the ownership check currently lives in the router/procedure code).
