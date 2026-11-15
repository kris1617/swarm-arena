---
change_id: spatial-hash-performance-optimization
title: Grid-based spatial partitioning for boid/predator neighbor lookups
status: implemented
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-23 (M-3, "UI modernization" milestone, though this item itself is
a pure backend/performance change, not UI). No prerequisites — can run any
time. PRD ref FR-029. Last remaining M-3 item after S-16–S-20.

**Outcome**: Boid/predator flocking-force calculations use spatial
partitioning (a grid-based neighbor search) instead of a full pairwise
scan, reducing complexity from O(N²) to O(N) per tick.

**Hard constraint (FR-029 extension, PRD line 219)**: must produce
IDENTICAL scores/behavior to the pre-optimization pairwise scan for the
same parameters and seed — this is a performance change, not a behavior
change; any deviation is a bug, not an accepted tradeoff.

**Roadmap's own risk note**: confirmed O(N²) today (`boids.ts`'s nested
scan). The technique being ported is already proven in this project's own
prior LÖVE2D/Lua implementation (`/mnt/Kids/boids_final/game/`, documented
in that project's own `docs/ARCHITEKTURA.md`), not an invented approach.
Verification needs a deliberate before/after comparison on a fixed seed,
not just "it still runs."
