---
change_id: simulation-entity-shape-color-differentiation
title: Give boids, predators, and food distinct shapes and colors in the simulation view
status: impl_reviewed
created: 2026-11-19
updated: 2026-11-20
archived_at: null
---

## Notes

give boids, predators, and food distinct shapes and colors in the simulation view -- confirmed via roadmap research (M-11/S-44): boids=triangle, predators=diamond already differ subtly, food has zero visual representation today (scalar pool only, never drawn). User confirmed food gets real, positioned, discrete spatial entities (matching the Lua reference's Food objects), not a non-spatial pool visualization -- a real simulation-model change, not just rendering.
