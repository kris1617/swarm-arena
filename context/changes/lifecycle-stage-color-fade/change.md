---
change_id: lifecycle-stage-color-fade
title: Fade boid, predator, and food colors by lifecycle stage
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

User sees boid, predator, and food colors fade/shift according to lifecycle stage (energy for boids/predators, decay for food), matching the Lua reference's proven pattern (S-45, M-11/MS-03). Prerequisite S-44 done. One resolved design default from roadmap: centralize the fade formula into one shared helper consumed by all three draw calls, rather than replicating the Lua reference's 3x duplication.
