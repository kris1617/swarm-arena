# Configurable Area and Camera View — Plan Brief

> Full plan: `context/changes/configurable-area-and-camera-view/plan.md`

## What & Why

Roadmap S-24 / M-4's north star: make the simulation's spatial area a user-controlled parameter, and let the user see only part of a (potentially larger) area via a camera, rather than always rendering the whole world at once.

## Starting Point

World size is two hardcoded module constants in `boids.ts` (`INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE`, both 200), read by name at ~30 call sites. No camera/viewport concept exists anywhere — rendering uses a fixed world-to-pixel mapping, shared by the staging canvas and the server-run live viewer via one `drawScene` function. Live-view data already pushes full, unfiltered state every 150ms, so the camera needs no server-side changes.

**Key finding from this session's own measurement** (not assumed): making the world *larger* lowers tick cost, not raises it — at 2x area, the same population ticks ~3x faster. This directly satisfies `capacity-limits.md`'s own instruction to re-derive the tick-cost curve before setting this parameter's range.

## Desired End State

A user sets independent `xyArea`/`zDepth` values when staging a run (admin-ranged, like every other parameter), and watches it through a pan/zoom/auto-follow camera — shared by both rendering paths, over a resizable canvas, with a toggleable minimap and a toggleable wrap-boundary indicator.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Area parameter shape | Separate `xyArea` and `zDepth` (not one uniform value) | User chose flexibility over the simpler single-parameter default | User (AskUserQuestion) |
| Auto-follow handoff | Manual pan suspends auto-follow until explicit re-center | Predictable — camera never yanks away from where you just looked | User (recommended, accepted) |
| Zoom limits | Hard min/max, derived from the run's actual configured world size | Prevents disorienting extremes (all-black screen, single pixel) | User (recommended, accepted) |
| Camera scope | Both rendering paths (they already share one `drawScene`) | One implementation, consistent everywhere | User (recommended, accepted) |
| Minimap | Included, toggleable | User chose to include it rather than defer | User (AskUserQuestion) |
| Camera reset | Always resets to default on run-switch/resume, never persisted | Simplest mental model, zero new persistence surface | User (recommended, accepted) |
| Wrap-boundary indicator | Included, toggleable | User chose to include it rather than leave it out of scope | User (AskUserQuestion) |
| Canvas size | Resizable (fills its container), not fixed 600×400 | User chose this over keeping the fixed size | User (AskUserQuestion) |
| Minimap/boundary toggles | User-toggleable, not always-on | User chose configurability over simplicity | User (AskUserQuestion) |
| Area parameter range | min/default 200 (unchanged), max 1000 | Grounded in direct measurement that larger area is safe, not a guess | Plan, measured this session |

## Scope

**In scope:** per-run `xyArea`/`zDepth` parameters; camera (pan/zoom/auto-follow/re-center) shared by both render paths; resizable canvas; toggleable minimap; toggleable wrap-boundary indicator; camera reset on switch/resume.

**Out of scope:** any server-side payload/subscription change (camera is client-only); scaling `NEIGHBOR_RADIUS`/other engine radii with area; persisting camera state anywhere; a way to disable auto-follow other than via manual pan.

## Architecture / Approach

Four phases, ordered by risk: the determinism-sensitive engine refactor (area as a threaded parameter, not a constant) lands and is proven first, entirely independent of UI; the camera transform lands second; the two decorative-but-camera-aware additions third; staging-form wiring and full integration verification close it out.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Core area parameterization | `worldSize` threaded through `boids.ts`; new ranged parameters; determinism tests | High — touches every position-handling function in the determinism-sensitive engine; large diff surface (every test call site too) |
| 2. Camera core | Pan/zoom/auto-follow transform; resizable canvas | Medium-high — genuinely new interactive UI from zero precedent |
| 3. Minimap + boundary indicator | Two toggleable visual additions | Medium — layered on Phase 2's camera math, not independently risky |
| 4. Staging form wiring + integration | New form fields; camera-reset wiring; full manual pass | Low-medium — mostly following existing patterns, plus integration verification |

**Prerequisites:** F-07 (VPS resource capacity limits) — already done and archived.
**Estimated effort:** ~2-3 sessions across 4 phases — the largest change in this project's M-4 milestone.

## Open Risks & Assumptions

- Phase 1's refactor touches a large number of test call sites (every `boids.test.ts`/`pipeline.test.ts`/`pipeline-perf.test.ts`/`single-run-lifecycle.test.ts` call into the changed functions) — expect a wide but mechanical diff, not a narrow one.
- The max area of 1000 is grounded in a confirmed *direction* (larger is safer), not a benchmark at exactly 1000 — if this ever becomes a real concern, re-measure rather than assume the trend holds indefinitely.
- Whether `server-run-viewer.tsx` already remounts fresh on `runId` change (making camera-reset-on-switch automatic) or needs explicit reset logic is confirmed during Phase 4, not assumed here.

## Success Criteria (Summary)

- A run at the default area behaves identically to today; a run at a non-default area is deterministic for its own seed.
- The camera, minimap, and boundary indicator all work correctly, together, on both rendering paths.
- Camera state never survives a run switch, resume, or persists anywhere.
