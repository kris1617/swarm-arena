# Plan Brief: Per-tribe boid behavior data model (F-09)

Full plan: `context/changes/per-tribe-behavior-weights/plan.md` · Research: `research.md`

## What this does

Lets every boid tribe have its own behavior profile — weights, speed bounds,
per-behavior perception radii, a predator-flee burst, and a real
color-distance mate-preference selector — configurable at start and live
mid-run. Full Lua-reference parity, as decided after seeing the real cost
breakdown in research.

## Starting Point

- Weights/speed bounds are already per-boid genes, seeded once from a
  per-flock vector that today holds identical values for every flock —
  the cheap part of this change.
- Perception radii are single global constants baked into one spatial grid
  per tick; burst doesn't exist; `matePreference` exists but is never read
  by mate selection — the genuinely new engine work.
- `LiveAdjustableParams` only handles scalar/boolean fields; no live-edit
  path exists for an array-shaped field like per-tribe config.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Perception-radius grid strategy | Shared max-radius grid + per-boid distance filter | One grid build per tick (same cost shape as today); flockCount ≤ 4 bounds the waste |
| Burst trigger | Predator-flee proximity (existing detection radius) | Reuses existing detection logic; burst = "flee, but faster" |
| Burst cost | Extra per-tick energy cost while bursting, no new timer | No new per-boid state; burst ends naturally when the trigger clears |
| Mate-preference semantics | Color-distance threshold, both sides must agree | Directly ports the working Lua reference logic |
| Data shape | JSON array on `simulationRuns`, index = flockId | Matches existing `savedState`/`history` JSON-column precedent |
| Admin ranges | One shared range per field, not per-tribe | Matches `flockCount`'s own precedent; no stated need for per-tribe ranges |
| UI layout | Tabs, one per tribe | Keeps form length stable regardless of flockCount |
| Legacy rows | Treat `tribeConfigs: null` as not-applicable | Same pattern as other legacy markers (`wasEverThrottled`) |
| Defaults | Vary by tribe, matching Lua reference's 3 named tribes | Showcases the feature immediately per user's explicit choice |
| Live adjustment | Yes — new `applyLiveTribeConfigs`, read fresh at reproduction | Mirrors proven `mutationChance`/`mutationMagnitude` pattern — confirmed NOT the S-27 trap |
| Diversity metric | Expand to include new per-tribe dimensions | Reflects the new variation this feature introduces |

## Phases

1. **Data model & schema** — `tribeConfigs` column, admin ranges, input schema + validation
2. **Engine: weights/speed per tribe** — wire real per-tribe values into existing seeding path (no hot-loop change)
3. **Engine: perception radii** — new spatial-grid strategy (genuinely new architecture)
4. **Engine: burst** — predator-flee trigger, per-tick energy cost (built from scratch)
5. **Engine: mate-preference** — color-distance gate in reproduction (built from scratch)
6. **Live adjustment** — new sibling function to `applyLiveParams`, fresh-read at reproduction
7. **Diversity metric** — fold in new per-tribe dimensions
8. **UI** — tabs + varied defaults; needs new shadcn `Tabs` component
9. **Backward compat & verification** — legacy-row guards + gene-level spawn/live-edit inspection (closes the S-27-class gap)

**Prerequisites**: none blocking — builds directly on the existing genetics/reproduction machinery.
**Estimated effort**: HIGH — phases 3-6 are new engine capability, not plumbing; phases 1-2, 7-9 are lower-risk extension of existing patterns.

## What We're NOT Doing

- Making `flockCount` itself live-adjustable (unchanged).
- Per-tribe admin ranges (one shared range per field).
- Backfilling synthetic per-tribe data for legacy runs.

## References

- `research.md` — full codebase evidence.
- `boids.ts`, `server-run-registry.ts`, `parameter-ranges.ts`,
  `simulation.ts`, `schema.ts` — see plan.md's References section for exact
  line anchors.
- `context/foundation/lessons.md` — the S-27 precedent Phase 9 guards
  against.
