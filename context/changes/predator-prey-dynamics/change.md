---
change_id: predator-prey-dynamics
title: Predator-prey dynamics
status: planned
created: 2026-11-11
updated: 2026-11-11
archived_at: null
---

## Notes

Roadmap slice S-02 (prereq: S-01 "basic-flocking-loop", done). Adds predator boids with
distinct behavior (hunting prey) and prey predator-avoidance steering, plus a protection
threshold. PRD refs: FR-005 (partial, predator behavior), FR-008, FR-009.

Roadmap marks S-02 "Parallel with: S-05". Confirmed with the user: S-05 will be scoped as
its own new route (not touching `src/app/simulation/page.tsx`) specifically to avoid a file
conflict with this change, since this change extends the existing single-run simulation UI
(predator count / protection-threshold form fields) on that same page.
