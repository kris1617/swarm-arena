---
change_id: test-plan-refresh-2026-11-12
title: Refresh test-plan.md — surface the untested depth-rendering formula
status: implemented
created: 2026-11-12
updated: 2026-11-12
archived_at: null
---

## Notes

Refresh test-plan.md: pseudo-3d-depth-rendering and ui-simulation-tokens shipped (impl_reviewed/implemented) but were never archived, so the original /10x-test-plan discovery (which only scans context/archive/) never saw them. Add a new risk: the depth-to-scale projection formula and back-to-front draw order in src/app/simulation/_components/simulation-canvas.tsx (REFERENCE_DEPTH/MIN_SCALE/MAX_SCALE clamp, entities.sort by z) has zero automated tests, only manual visual verification per pseudo-3d-depth-rendering/plan.md Phase 2. Open a new rollout phase for it in test-plan.md §2/§3, then continue to /10x-research.
