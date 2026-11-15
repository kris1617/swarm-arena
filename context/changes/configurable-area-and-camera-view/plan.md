# Configurable Area and Camera View Implementation Plan

## Overview

Make the simulation's spatial extent two independent, admin-ranged, per-run parameters (`xyArea`, `zDepth` — replacing the hardcoded `boids.ts` constants `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE`), and replace the fixed whole-world render with a pan/zoom/auto-follow camera, shared by both rendering paths, plus a resizable canvas, a toggleable minimap, and a toggleable wrap-boundary indicator.

## Current State Analysis

**World size is baked into the engine as module-private constants**, not threaded as data. `boids.ts:68` (`INITIAL_AREA_SIZE = 200`) and `:72` (`Z_DEPTH_RANGE = 200`) are read directly by name at ~30 call sites across `createInitialPopulation`, `createInitialPredators`, `resolveOverlaps`, `stepBoids` (both its grid builds and its move/wrap step), `stepPredators`, `applyPredation`, `reproducePopulation`, and `computeCohesion`'s `circularMean` calls (lines 336-338, 384-386, 425-444, 464-472, 508-510, 597-599, 660-662, 692-694, 724-726, 830, 885-910, 980, 995-997, 1173-1187 — read in full). Neither constant is exported or referenced by name anywhere outside `boids.ts` — every external caller just calls these functions and trusts the internal wrap behavior, which bounds the blast radius to (a) `boids.ts`'s own function signatures and (b) each function's direct callers, not a wider constant-reference hunt.

**Direct callers that will need a new parameter threaded through**: `src/server/simulation/single-run-lifecycle.ts`'s `computeSingleRunTick` (the shared core both the client-staged and server-owned paths call), `src/server/simulation/server-run-registry.ts` (`startServerRun`, `tick`, `resumeServerRun`), and `src/app/simulation/_components/simulation-canvas.tsx`'s own tick-loop call site for the staging path. Plus every test file currently calling these functions directly with the implicit 200-unit assumption: `boids.test.ts`, `pipeline.test.ts`, `pipeline-perf.test.ts`, `single-run-lifecycle.test.ts`.

**No existing per-run world-size storage.** `simulationRuns` (`schema.ts`) persists `boidCount`/`predatorCount`/etc. as static per-run config columns (set at `start`/`startServer` time, read back on resume) — `xyArea`/`zDepth` need the identical two-new-column treatment, following exactly the pattern every other ranged parameter already uses (admin range in `parameter-ranges.ts` + `RANGED_PARAMETER_NAMES`, a `simulationRuns` column, a zod field in `startInputSchema`, a `checkAgainstAdminRanges` bound check, a staging-form `NumberField`).

**Measured, not assumed, capacity direction** (direct benchmarking this session, by temporarily patching `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` and restoring immediately after): at a 400-unit world (2x today's fixed 200), the same 500-individual population ticks at ~17.8ms — vs ~50.6ms at today's 200-unit world (per `context/foundation/capacity-limits.md`'s own table). **A larger area lowers tick cost, not raises it** — `NEIGHBOR_RADIUS=70` stays fixed while world volume grows, so the fraction of the world within that radius (and thus true-neighbor density) drops. This directly follows `capacity-limits.md`'s own instruction to re-derive, not reuse, the tick-cost curve before setting this parameter's range: the direction is now confirmed, not assumed.

**Rendering is one shared function, plain Canvas 2D, with a fixed world-to-pixel mapping.** `drawScene` (`src/app/simulation/_components/simulation-canvas.tsx:118-167`) is called verbatim by both the staging canvas and `server-run-viewer.tsx`'s live view (the only two rendering paths — the legacy multi-run client path no longer exists in this codebase). It maps world (x,y) to canvas pixels via module-level constants `RENDER_SCALE = 2` and `RENDER_OFFSET_X/Y` (`:28-30`, hardcoding the current 200-unit world centered in a fixed 600×400 canvas) — no `ctx.translate`/`scale` represents a moving or zooming camera today; the only existing `ctx.save/translate/rotate/restore` use is per-entity heading rotation (`:146-148`), unrelated to camera positioning. `z` is used only as a depth cue for shape size and paint order (`computeDepthScale`, `:80-85`), never a screen coordinate.

**Live-view data flow needs no changes.** `watchServerRun` (`server-run-registry.ts:407-436`) already pushes the full, unfiltered `boids`/`predators` arrays every `WATCH_INTERVAL_MS = 150`ms (`getLiveRunState`, `:88-99`) — the camera is a pure client-side rendering transform over data the client already receives in full; no server-side filtering or payload-shaping is needed for any phase of this plan.

## Desired End State

A user staging a run (or an admin editing ranges) sees two new parameters — `xyArea` and `zDepth` — alongside the existing ranged parameters, defaulting to 200 (unchanged from today) with a generous, measurement-backed max. Watching any run (staging canvas or server-run live viewer) shows a camera that auto-follows the population by default, with user pan/zoom that suspends auto-follow until an explicit re-center action, within hard zoom limits, over a resizable canvas, with a toggleable minimap and a toggleable wrap-boundary indicator. Switching which run is watched (S-08) or resuming a saved run always resets the camera to its default (centered, auto-follow on) state. Verification: a seeded run at the default 200/200 world produces byte-for-byte identical boid/predator trajectories to today's pre-change output (Phase 1's determinism test); a seeded run at a non-default area size still produces deterministic, reproducible output for the same seed (not identical to the 200/200 case, but identical to itself across repeated runs); the camera, minimap, and boundary indicator are each confirmed visually against a multi-step manual checklist (Phase 4).

### Key Discoveries:

- Every `boids.ts` function that currently reads `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` by name needs it threaded in as a parameter instead — there is no shortcut (e.g. a single "set once at module load" escape hatch) available without reintroducing global mutable state into a function set this project has deliberately kept pure and directly unit-testable (`boids.test.ts`'s entire test suite calls these functions with explicit inputs).
- `parameter-ranges.ts`'s `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES`/admin-settings-form.tsx/`checkAgainstAdminRanges` pattern (confirmed and exercised in F-07) is the exact, already-proven template for adding `xyArea` and `zDepth` as two more ranged parameters — no new mechanism needed, just two more entries.
- `capacity-limits.md` already documents the obligation to re-derive the tick-cost curve for a configurable area, and this plan's own research (above) discharges that obligation with a real measurement, not a guess.

## What We're NOT Doing

- **Not changing any server-side payload/subscription logic.** The camera is client-side only; `watchServerRun`/`getLiveRunState` are untouched.
- **Not scaling `NEIGHBOR_RADIUS`/`SEPARATION_RADIUS`/`CAPTURE_RADIUS`/etc. with area.** Per the roadmap's own lean (and this plan's own measurement, which shows larger area is already safe without touching these), all existing radii stay exactly as they are — only the wrap boundary changes.
- **Not adding a way to resize the canvas beyond the resizable-canvas work in Phase 2** — no separate "canvas size" admin or user setting; resizability here means the canvas fills its container responsively, not a new configurable dimension.
- **Not persisting camera state** anywhere (DB, localStorage, or otherwise) — it's always client-side, in-memory, reset-to-default on every run switch, resume, or page load, per the explicit decision made during planning.
- **Not adding a way to toggle auto-follow on/off independent of panning** — the only way to leave manual mode is the re-center action; there's no separate "disable auto-follow permanently" setting.

## Implementation Approach

Four phases, ordered by risk: the determinism-sensitive engine refactor lands and is proven correct first, entirely independent of any UI; the camera transform lands second, as the one new piece everything visual depends on; the two decorative-but-camera-aware additions (minimap, boundary indicator) layer on top third; staging-form wiring and full integration verification close out the change.

## Phase 1: Core area parameterization

### Overview

Turn `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` into per-run parameters threaded through every `boids.ts` function that uses them, add the two new admin-ranged parameters end to end, and prove determinism is preserved with the same rigor S-23 applied.

### Changes Required:

#### 1. Thread a `worldSize` parameter through `boids.ts`

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace every direct read of `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` with a `worldSize: { x: number; y: number; z: number }` parameter (x and y both carry the run's `xyArea` value; z carries `zDepth`), passed explicitly into every function that currently reads the constants by name: `createInitialPopulation`, `createInitialPredators`, `stepBoids` (internal `resolveOverlaps` too), `stepPredators`, `applyPredation`, `reproducePopulation`, `runTick`, and `computeCohesion`. Delete the two module-level constants once nothing references them.

**Contract**: Each function's new `worldSize` parameter is required (no default), so every call site must supply it explicitly — this is deliberate: a silently-defaulted world size would let a caller forget to thread the run's real configured value and get away with it until behavior visibly diverges. `wrap`/`wrappedDelta`/`wrappedMidpoint`/`circularMean` (the low-level helpers) already take a `range` parameter per axis — they're unchanged; only their callers now source that range from `worldSize.x`/`worldSize.y`/`worldSize.z` instead of the deleted constants.

#### 2. Add `xyArea`/`zDepth` as admin-ranged parameters

**File**: `src/server/simulation/parameter-ranges.ts`

**Intent**: Two new entries in `RANGED_PARAMETER_NAMES` and `DEFAULT_PARAMETER_RANGES`, following the exact existing pattern.

**Contract**: `xyArea: { min: 200, max: 1000, default: 200 }`, `zDepth: { min: 200, max: 1000, default: 200 }`. Min/default of 200 preserves today's exact behavior unless an admin explicitly raises it; max of 1000 is grounded in this plan's own measurement that larger area lowers tick cost (the trend, confirmed directly at 400, continues in the same direction at 1000 — not re-benchmarked at exactly 1000, since the direction itself, not a specific number, is what's been proven).

#### 3. Persist the two new parameters per run

**File**: `src/server/db/schema.ts`

**Intent**: Two new `simulationRuns` columns, same shape as `boidCount`/`predatorCount` — static per-run config set at start time, read back on resume.

**Contract**: `xyArea: d.integer().notNull()`, `zDepth: d.integer().notNull()`. Requires a new Drizzle migration. No default needed at the column level the way F-07's admin-settings column needed one (every row is written by `insertRunningSimulation` going forward, not read from a pre-existing row) — but existing historical rows need a migration-time backfill to 200 (the pre-change constant value) so old rows don't end up with a null/invalid world size if ever resumed or re-analyzed.

#### 4. Wire `xyArea`/`zDepth` through the start/resume/tick paths

**Files**: `src/server/api/routers/simulation.ts`, `src/server/simulation/server-run-registry.ts`, `src/server/simulation/single-run-lifecycle.ts`, `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: `startInputSchema` gains `xyArea`/`zDepth` fields (validated via the existing `checkAgainstAdminRanges` loop over `RANGED_PARAMETER_NAMES`, no special-casing needed since that loop is already generic). `insertRunningSimulation` persists them onto the new columns. `startServerRun`/`resumeServerRun`/`tick` (`server-run-registry.ts`) and `computeSingleRunTick` (`single-run-lifecycle.ts`) read the run's own `xyArea`/`zDepth` (from the DB row or the live `LiveRun`'s stored params) and build the `worldSize` object Phase 1's `boids.ts` functions now require. `simulation-canvas.tsx`'s own tick-loop call site does the same for the staging path, using the form's current `xyArea`/`zDepth` values.

**Contract**: No change to the shape of what's returned to callers — this is purely plumbing a new required input through, not changing any function's return type.

#### 5. Determinism tests

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Prove the refactor is behavior-preserving at the default values and genuinely deterministic (not just "runs without crashing") at a non-default world size — the same standard S-23's own tests held the spatial-hash grid to.

**Contract**: (a) A test asserting that calling the refactored `runTick`/`stepBoids` etc. with `worldSize = {x: 200, y: 200, z: 200}` produces byte-for-byte identical output to a fixture captured from the pre-refactor behavior for a fixed seed — the actual regression test for "this refactor changed nothing by default." (b) A test at a non-default world size (e.g. `{x: 400, y: 400, z: 400}`) asserting the same seed produces the same output across two independent runs (determinism holds at any configured size, not just the default).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test` (every existing test call site across `boids.test.ts`, `pipeline.test.ts`, `pipeline-perf.test.ts`, `single-run-lifecycle.test.ts` updated to pass an explicit `worldSize`, not silently defaulted)
- New determinism tests (both the default-preserving and non-default-deterministic cases) pass

#### Manual Verification:

- None for this phase — fully covered by automated determinism tests; no UI surface yet.

## Phase 2: Camera core

### Overview

Replace the fixed world-to-pixel mapping in the shared `drawScene` with a camera-driven transform: pan/zoom under user control, auto-follow by default, manual-pan-suspends-until-recenter, hard zoom limits, resizable canvas.

### Changes Required:

#### 1. Camera state and transform

**File**: `src/app/simulation/_components/simulation-canvas.tsx` (or a new sibling module if `drawScene` and its camera logic warrant splitting out — implementer's call, following whatever keeps `drawScene` itself readable)

**Intent**: Replace the fixed `RENDER_SCALE`/`RENDER_OFFSET_X/Y` constants with a per-frame camera state `{ centerX: number; centerY: number; zoom: number; mode: "auto" | "manual" }`. In `"auto"` mode, `centerX`/`centerY` track the live population's centroid (reusing the same centroid-computation approach `computeCohesion`'s `circularMean` already establishes for wrapped coordinates — a population straddling the wrap seam needs the same circular-mean handling a camera center does, not a plain arithmetic average). In `"manual"` mode, pan/zoom input updates `centerX`/`centerY`/`zoom` directly and auto-follow is suspended until the user triggers re-center.

**Contract**: Zoom is clamped to `[minZoom, maxZoom]`, where `minZoom` is whatever keeps the full configured `xyArea`/`zDepth` world visible in the canvas, and `maxZoom` is a fixed sensible floor (e.g. a few boid-lengths across) — both computed from the run's actual configured world size, not a hardcoded assumption of 200. The existing per-entity depth-cue math (`computeDepthScale`) is unchanged; only the x/y screen-position mapping changes from the fixed constants to `(worldX - centerX) * zoom + canvasWidth/2` (and the y equivalent).

#### 2. Pan/zoom input handling + re-center control

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Mouse-drag (and, if trivial to add via the same handlers, touch-drag) pans the camera; scroll wheel (and pinch, if trivial) zooms. Both switch `mode` to `"manual"` on first input. A visible "re-center" button switches back to `"auto"`.

**Contract**: Input handlers live wherever the canvas element itself is rendered in each of the two consuming components — both already render a `<canvas>` and call `drawScene`; each needs its own event listeners and its own camera-state instance (camera state is per-viewer/per-component, not shared or persisted, per the explicit "reset on switch" decision — Phase 4 wires the actual reset-on-switch/resume behavior).

#### 3. Resizable canvas

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: The canvas fills its container responsively instead of a fixed 600×400, using a `ResizeObserver` (or the existing codebase's established pattern for responsive sizing, if one exists — check before introducing a new one) to keep the canvas's drawing-buffer size in sync with its displayed size, and feeding the current width/height into the camera transform instead of the old fixed constants.

**Contract**: `drawScene`'s signature gains the current canvas width/height as explicit parameters (it already receives a `ctx`; width/height should come from `ctx.canvas.width/height` or be passed alongside it) rather than reading the old fixed `CANVAS_WIDTH`/`CANVAS_HEIGHT` constants.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files returns zero hits (tokens only, matching AGENTS.md's UI rules)

#### Manual Verification:

- Default camera auto-follows the population smoothly as it moves/disperses.
- Dragging the canvas pans the camera and switches to manual mode; scrolling zooms; both are clamped at the configured min/max zoom.
- The re-center control returns to auto-follow.
- The canvas visibly resizes with its container (e.g. resizing the browser window) without distorting the rendered scene.
- This all works identically on both the staging canvas and the server-run live viewer.

## Phase 3: Minimap + wrap-boundary indicator

### Overview

Two new, independently toggleable visual additions layered on Phase 2's camera.

### Changes Required:

#### 1. Minimap

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: A small overlay rendering the full configured world at a fixed small scale, with a rectangle marking the current camera viewport's position/size within it. Toggleable via a UI control; defaults to visible (no stated default-off preference was given — on is the more discoverable default for a brand-new feature).

**Contract**: Reuses the same entity-drawing logic `drawScene` already has (at a different, fixed small scale, no camera transform applied to the minimap itself — it always shows the whole world) rather than a second, divergent rendering implementation.

#### 2. Wrap-boundary indicator

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: A subtle line/border drawn at the world's edges (in the main camera-transformed view, not the minimap), visible whenever the camera's current viewport includes an edge. Toggleable via a UI control; defaults to visible for the same discoverability reason as the minimap.

**Contract**: Drawn using the same world-to-screen transform the entities themselves use (Phase 2's camera math), so the boundary line stays correctly positioned as the camera pans/zooms — not a fixed-position decoration.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files returns zero hits

#### Manual Verification:

- The minimap accurately reflects the current viewport's position as the camera pans/zooms, and can be toggled off/on.
- The boundary indicator appears when the camera view includes a world edge, stays correctly positioned through pan/zoom, and can be toggled off/on independently of the minimap.

## Phase 4: Staging form wiring + integration

### Overview

Add the new area fields to the start form, wire camera-reset-on-switch/resume, and run the full manual verification pass across everything this plan touched.

### Changes Required:

#### 1. Staging form fields

**File**: `src/app/simulation/page.tsx`

**Intent**: Two new `NumberField`s for `xyArea`/`zDepth`, following the exact existing pattern every other ranged parameter already uses (local `useState`, bound to `ranges.xyArea`/`ranges.zDepth`'s min/max, included in `ActiveRun`'s type and `buildStartInput()`'s clamp-to-range logic).

**Contract**: Identical shape to the existing `boidCount`/`predatorCount` fields at their respective call sites — no new pattern introduced.

#### 2. Camera reset on run-switch and resume

**File**: `src/app/simulation/_components/server-run-viewer.tsx` (and wherever S-08's switcher mounts/unmounts the viewer for a different `runId`)

**Intent**: Ensure the camera-state instance is freshly initialized (centered, auto-follow on) whenever the component starts watching a different `runId`, including after a `resume` — per the explicit "always reset to default" decision made during planning.

**Contract**: If the viewer component already remounts (fresh component instance) on `runId` change, this may already be true by construction (camera state Phase 2 introduced would simply start fresh) — verify this is actually the case rather than assuming it, since a memoized/persisted component instance across a `runId` prop change would carry stale camera state forward silently.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files returns zero hits

#### Manual Verification:

- The staging form shows `xyArea`/`zDepth` fields bound to the admin's configured range, and a run started with non-default values actually uses them (confirmed by observing boids wrapping at the configured boundary, not the old fixed 200).
- Switching between two running server-owned runs (S-08) resets the camera to default for the newly-viewed run.
- Resuming a saved run resets the camera to default.
- End-to-end: stage a run with a larger-than-default area, watch it live, confirm the camera (auto-follow, manual pan/zoom, re-center), minimap, and boundary indicator all behave correctly together, not just in isolation.

## Testing Strategy

### Unit Tests:

- `boids.test.ts`: the two new determinism tests from Phase 1 (default-preserving, non-default-deterministic), plus every existing test updated to pass an explicit `worldSize`.

### Manual Testing Steps:

1. Stage a run at the default area; confirm behavior is visually unchanged from before this plan.
2. Stage a run at a larger area; confirm boids wrap at the new, larger boundary (not the old 200).
3. Pan, zoom, and re-center the camera on both the staging canvas and a server-run live view; confirm auto-follow suspends on manual input and resumes only on re-center.
4. Resize the browser window; confirm the canvas and camera adapt without distortion.
5. Toggle the minimap and boundary indicator independently; confirm each reflects the current camera state correctly.
6. Switch between two running server-owned runs and resume a saved run; confirm the camera resets to default each time.

## Performance Considerations

Phase 1's own research found larger areas *reduce* tick cost at a fixed population — no new capacity concern from this change's core premise. The camera itself is a per-frame client-side transform (cheap — a handful of arithmetic operations per draw call, no new network/server cost, since `watchServerRun`'s push cadence and payload shape are completely unchanged).

## Migration Notes

New `simulationRuns.xyArea`/`zDepth` columns require a migration with a backfill (`200`) for existing rows, since — unlike F-07's admin-settings column — these are per-run config values every row needs a real value for, not a singleton settings row that can lazily seed itself on first read.

## References

- `src/server/simulation/boids.ts` — every call site reading `INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` (see Current State Analysis for the full line list), Phase 1's refactor target.
- `src/app/simulation/_components/simulation-canvas.tsx` — `drawScene`, `RENDER_SCALE`/`RENDER_OFFSET_X/Y`, `computeDepthScale` — Phase 2/3's render-path target.
- `src/app/simulation/_components/server-run-viewer.tsx` — the second consumer of `drawScene`, sharing every camera change Phase 2/3 make.
- `src/server/simulation/server-run-registry.ts` — `watchServerRun`/`getLiveRunState` (unchanged — confirmed no server-side camera work needed), `startServerRun`/`tick`/`resumeServerRun` (Phase 1's wiring target).
- `src/server/simulation/single-run-lifecycle.ts` — `computeSingleRunTick`, the shared core both the staging and server-owned paths call.
- `src/server/simulation/parameter-ranges.ts` — the exact template for `xyArea`/`zDepth`'s admin-range addition, already proven in F-07.
- `context/foundation/capacity-limits.md` — the capacity-model doc this plan's own measurement extends; records the obligation this plan discharges.
- Roadmap `context/foundation/roadmap.md` S-24 — the Slice entry this plan implements, including its pre-resolved camera-model decision and its open (now-resolved, in this plan's own interview) radii-scaling lean.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Core area parameterization

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 3969c57
- [x] 1.2 Linting passes: `npm run check` — 3969c57
- [x] 1.3 Full suite still passes: `npm test` — 3969c57
- [x] 1.4 New determinism tests (default-preserving and non-default-deterministic) pass — 3969c57

### Phase 2: Camera core

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 0129542
- [x] 2.2 Linting passes: `npm run check` — 0129542
- [x] 2.3 Full suite still passes: `npm test` — 0129542
- [x] 2.4 Hardcoded-value scan on touched files returns zero hits — 0129542

#### Manual

- [x] 2.5 Default camera auto-follows the population smoothly — 0129542
- [x] 2.6 Pan/zoom switches to manual mode and is clamped at configured min/max zoom — 0129542
- [x] 2.7 Re-center control returns to auto-follow — 0129542
- [x] 2.8 Canvas visibly resizes with its container without distorting the scene — 0129542
- [x] 2.9 All of the above work identically on both rendering paths — 0129542

### Phase 3: Minimap + wrap-boundary indicator

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 6a39229
- [x] 3.2 Linting passes: `npm run check` — 6a39229
- [x] 3.3 Full suite still passes: `npm test` — 6a39229
- [x] 3.4 Hardcoded-value scan on touched files returns zero hits — 6a39229

#### Manual

- [x] 3.5 Minimap accurately reflects viewport position through pan/zoom, toggleable — 6a39229
- [x] 3.6 Boundary indicator appears at world edges, stays correctly positioned, toggleable independently — 6a39229

### Phase 4: Staging form wiring + integration

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run check`
- [ ] 4.3 Full suite still passes: `npm test`
- [ ] 4.4 Hardcoded-value scan on touched files returns zero hits

#### Manual

- [ ] 4.5 Staging form's new fields are bound to the admin's configured range and actually take effect
- [ ] 4.6 Switching watched runs (S-08) resets the camera to default
- [ ] 4.7 Resuming a saved run resets the camera to default
- [ ] 4.8 End-to-end: larger-area run, camera, minimap, and boundary indicator all behave correctly together
