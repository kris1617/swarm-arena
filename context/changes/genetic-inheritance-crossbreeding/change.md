---
change_id: genetic-inheritance-crossbreeding
title: Genetic inheritance and inter-flock crossbreeding
status: impl_reviewed
created: 2026-11-13
updated: 2026-11-13
archived_at: null
---

## Notes

Roadmap slice S-03 (context/foundation/roadmap.md). Population reproduces
with individually inherited genes (incl. blended color when parents
differ), with a toggle to enable/disable inter-flock crossbreeding. PRD
refs: FR-005 (full — reproduction to the object-count limit), FR-006,
FR-007. Prerequisite: S-02 (predator-prey-dynamics, archived). No current
blockers. S-04 (full score + save/resume) depends on this slice shipping
first, since genetic-diversity scoring needs genes to exist.

PRD's explicit failure mode to guard against: "a run with crossbreeding
disabled must never produce a blended-flock-color offspring."
