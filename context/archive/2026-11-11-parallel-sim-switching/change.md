---
change_id: parallel-sim-switching
title: Parallel simulation switching
status: archived
created: 2026-11-11
updated: 2026-11-11
archived_at: 2026-11-11T18:48:52Z
---

## Notes

Roadmap slice S-05 (prereq: S-01 "basic-flocking-loop", done). PRD refs: FR-013, FR-014 —
running multiple simulations in parallel and switching between them.

Scoped as its own new route (e.g. `/simulation/multi`), NOT a restructuring of
`src/app/simulation/page.tsx`. Confirmed with the user: this avoids a file conflict with
S-02 ("predator-prey-dynamics"), which extends that same existing page with predator-count
and protection-threshold form fields. The roadmap marks S-02 and S-05 as parallel-safe; the
new-route scoping is what makes that actually true at the file level, enabling real parallel
implementation via separate git worktrees.
