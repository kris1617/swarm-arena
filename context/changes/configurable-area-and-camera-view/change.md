---
change_id: configurable-area-and-camera-view
title: Configurable simulation area with a camera-limited render view
status: implementing
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-24 (M-4, "Area, camera, and ops limits") — the milestone's north
star. Prerequisite F-07 (VPS resource capacity limits) is done and archived
(`context/archive/2026-11-15-vps-resource-capacity-limits/`). MS-01, MS-02.
Parallel with S-26 (independent, no shared deps).

**Outcome**: User sets the simulation's spatial area size (within an
admin-set range, bounded by F-07's capacity ceiling) when staging a run,
and the render view becomes a camera over that area — auto-following the
population by default, with manual pan/zoom override — rather than always
rendering the entire area at once.

**Resolved decisions (from roadmap planning, 2026-11-15)**:
- Camera interaction model: pan/zoom under user control, combined with
  auto-follow (camera tracks the population by default; user can pan/zoom
  to override).
- Open (non-blocking) question carried from the roadmap: does increasing
  the area change only the toroidal wrap boundary (`INITIAL_AREA_SIZE`/
  `Z_DEPTH_RANGE` in `boids.ts`), leaving all existing radii
  (`NEIGHBOR_RADIUS`, `CAPTURE_RADIUS`, etc.) fixed, or should some radii
  scale with area too? Roadmap's own lean: leave radii fixed (simpler,
  lower-risk, and makes the existing S-23 spatial-hash grid more
  effective, not less) — `/10x-plan` should confirm or revisit this.

**Roadmap's own risk note**: Medium — the most technically novel work in
M-4 (no camera/viewport concept exists anywhere in the render path today).
Changing world size interacts with every `wrap()`/`wrappedDelta()` call
site in `boids.ts` and with S-23's spatial-hash grid (cell-size-to-world-
size ratio) — both already proven correct for a *fixed* 200-unit world; a
variable area needs the same determinism discipline S-23 applied, not a
weaker standard. Auto-follow + manual override also needs a clear handoff
rule (does a manual pan suspend auto-follow until the user re-centers, or
does auto-follow immediately resume next tick?).

**Durable reference**: `context/foundation/capacity-limits.md` — F-07's
measured tick-cost curve and capacity ceilings this change's area-parameter
range must respect.
