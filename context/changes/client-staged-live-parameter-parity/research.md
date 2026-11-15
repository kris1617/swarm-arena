---
date: 2026-11-15T18:16:08+01:00
researcher: Claude Sonnet 5
git_commit: 3d76da0bf45f5d26619103fcbd9ff0efbe53def0
branch: master
repository: swarm-arena
topic: "Can the client-staged execution path reuse S-27/S-31's live-adjust mechanism for foodRegenRate/protectionThreshold/energyThreshold/mutationChance/mutationMagnitude, or does it need its own mechanism, and what's the determinism risk?"
tags: [research, codebase, simulation-canvas, server-run-registry, boids, single-run-lifecycle, live-parameter-adjustment]
status: complete
last_updated: 2026-11-15
last_updated_by: Claude Sonnet 5
---

# Research: Client-staged live parameter parity (S-28)

**Date**: 2026-11-15T18:16:08+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 3d76da0bf45f5d26619103fcbd9ff0efbe53def0
**Branch**: master
**Repository**: swarm-arena

## Research Question

S-28's roadmap entry flags "the milestone's one genuinely new architectural pattern": `simulation-canvas.tsx`'s tick effect currently closes over its parameter props as fixed for a run's lifetime, and letting `foodRegenRate`/`protectionThreshold`/`energyThreshold`/`mutationChance`/`mutationMagnitude` become live-adjustable requires restructuring that. Three questions needed answering before planning:

1. How exactly does `simulation-canvas.tsx` currently receive and consume these 5 props, and is there an existing precedent in the same file for a value changing while the tick loop runs without restarting it?
2. Of S-27/S-31's three "ceremony" pieces for the server-owned path (dirty-tracking, server-side throttle, persisted changelog), which transfer to the client-staged path as-is, which are unnecessary, and which need new client-specific implementations?
3. Does the shared tick core (`computeSingleRunTick`/`boids.ts`, used by both execution paths) impose any determinism assumption that patching these 5 values mid-run would violate?

## Summary

The restructuring risk is real but narrowly scoped and the file already contains the exact pattern to copy. All 5 target fields are destructured component props, closed over once inside a `useEffect` whose dependency array is `[runId]` only (`simulation-canvas.tsx:470,588`) — a parent re-render with a new prop value never reaches the running `requestAnimationFrame` loop today, by explicit design (the effect's biome-ignore comment documents these props as intentionally excluded). The same file already solves this exact problem for `showMinimap`/`showBoundary`: a `useRef` is the single source of truth the loop reads every frame, paired with a `useState` purely so the UI switch can render a checked value; the setter writes both. Making the 5 target fields live-adjustable means giving each the same ref-as-source-of-truth treatment and reading `.current` inside `tick()`'s params-literal construction (`simulation-canvas.tsx:536-547`) instead of the closed-over destructured consts.

Critically, this restructuring is isolated to `simulation-canvas.tsx` itself — the shared tick core it calls into imposes no risk. `computeSingleRunTick` (`single-run-lifecycle.ts:21-61`) takes `params` as a plain argument on every call with no internal caching, and every one of the 5 fields is read fresh at its point of use inside `boids.ts` with no memoization, no object-identity check, and no "first-tick-only" snapshot (confirmed by direct inspection of `applyHunger`, `applyPredation`, `reproducePopulation`, and `inheritGenes`). The server-owned path already proved patching these same 5 fields mid-run through this same shared core is safe (S-27 shipped and was later corrected by S-31). The only thing in the shared core requiring a stable reference across ticks is `rng`, which is unrelated to these 5 fields.

Of S-27's three ceremony pieces, only one transfers conceptually and none transfer as reusable code: dirty-tracking is unnecessary (the client-staged path has no server subscription/poll competing with the user's own edits, so there's nothing to diff against); the server-side throttle cannot be replicated at all (there is no server-side registry entry for a client-staged run to attach a `lastParamUpdateAt` to — only a client-side cooldown mirroring the UI-only `APPLY_COOLDOWN_MS` is possible, and that gap is lower-stakes here than it was for S-27's shared server registry, since a client-staged run's state is already entirely confined to the user's own browser tab); and the changelog needs a wholly new implementation (client-staged runs persist no `parameterChanges` today — `buildStopInput()` and the `stop` procedure's input schema would both need extending for parity with the analysis view's `ReferenceLine` overlay).

## Detailed Findings

### How `simulation-canvas.tsx` currently closes over the 5 target props

- `SimulationCanvasProps` (lines 71-91) lists `foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude` as plain top-level props, destructured at lines 284-298.
- The mount effect (lines 471-588) runs once per `runId` — its dependency array is `[runId]` only (line 588), and the biome-ignore comment at line 470 explicitly lists these 5 props (plus `maxDurationSeconds`, `crossbreedingEnabled`, and several setup-only props) as intentionally excluded because "props are fixed for the lifetime of a run."
- Inside that effect, `tick()` (lines 517-579) builds a fresh `params` object literal on every `requestAnimationFrame` callback (lines 536-547), but the 5 values going into that literal are the closure-captured primitives from first render, not re-read from props. A later parent re-render with new values for any of the 5 fields currently has no path into the running loop at all.
- `boidCount`, `flockCount`, and the `weights` bundle (`separationWeight`/`alignmentWeight`/`cohesionWeight`) are consumed only once, inside the same mount effect's initial-population setup (`createInitialPopulation`/`createInitialPredators`, lines 487-503) — never referenced inside `tick()`. This independently confirms, on the client-staged path, the same reasoning S-31 already established for the server-owned path: these are genuinely setup-only/per-boid-genetic values, not per-tick global params, and are correctly out of scope for live-adjustment.

### The existing live-update-without-restart precedent: `showMinimap`/`showBoundary`

- Each has a `useRef` (`showMinimapRef`, `showBoundaryRef`, lines 346-347) as the value the running loop actually reads, and a `useState` (lines 348-349) that exists purely so the `Switch` component can render a `checked` prop.
- `handleToggleMinimap`/`handleToggleBoundary` (lines 351-361) write both the ref and the state, then call `redraw()` directly.
- `redraw()` (lines 373-420, called from inside `tick()` at line 562, and separately from `useCamera`'s `onChange`) reads `showBoundaryRef.current`/`showMinimapRef.current` (lines 395, 404) — never the React state — because `redraw` itself is captured once by the mount effect, and a plain state read inside it would close over the value at first-run time and never observe a later toggle (comment at lines 341-344, 366-372 states this explicitly).
- This is the exact shape S-28 needs: give each of the 5 target fields a ref (read inside `tick()`'s params-literal construction) plus a setter the live-edit UI calls; no effect-dependency change, no run-loop restart, no `key`-remount.

### Who feeds props into `SimulationCanvas`, and what's missing for a live-adjust UI to reach it

- Parent is `src/app/simulation/page.tsx`; `<SimulationCanvas>` is rendered gated on `activeRun` (a `useState<ActiveRun | null>`), with all props sourced from that one object and `key={activeRun.runId}` forcing a full remount on a new run.
- `activeRun` is set once at run-start and is not updated again while a run is active today — there is no lifted mutable state, no context, and no live-adjust panel wired to it. A new mechanism (at minimum, a narrower setter `page.tsx` can call, feeding into `SimulationCanvas`'s new ref-setters) is required; this doesn't exist yet in any form.

### Shared tick core: no caching, no determinism hazard from patching these 5 fields mid-run

- `computeSingleRunTick` (`single-run-lifecycle.ts:21-61`) takes `params` as a plain 3rd argument on every call; nothing in this file caches or snapshots it across calls.
- Each of the 5 fields is read fresh at its point of use inside `boids.ts`, confirmed by direct inspection: `foodRegenRate` → `applyHunger` (consumed at line 953, read off `params` via `single-run-lifecycle.ts:105` → `boids.ts:1085`); `protectionThreshold` → `applyPredation` (line 980, via `single-run-lifecycle.ts:106` → `boids.ts:1090`); `energyThreshold` → `reproducePopulation`'s `isEligible` closure, rebuilt fresh every call since `reproducePopulation` itself runs fresh each tick (`boids.ts:824-829`, via `single-run-lifecycle.ts:109` → `boids.ts:1134,1148`); `mutationChance`/`mutationMagnitude` → `inheritGenes`'s `blendNumber`, read at the moment each gene is blended (`boids.ts:757-758,765-766,915-916`, via `single-run-lifecycle.ts:110-111` → `boids.ts:1135-1136,1149-1150`).
- No object-identity assumption on `params` and no `useMemo`/module-level cache keyed on any of the 5 fields was found in either file. The only value requiring a stable reference across ticks in this shared core is `rng` (explicit comment, `single-run-lifecycle.ts:48-52`) — unrelated to the 5 target fields.
- The asymmetry is entirely on the caller side: the server-owned path's `tick()` (`server-run-registry.ts:271-308`) reads `run.params.<field>` by property access off a long-lived, in-place-mutated object inside a function that runs fresh every interval tick — so `applyLiveParams`'s mutation is picked up on the very next tick automatically. The client-staged path's `tick()` closure instead captures primitive prop values once at effect-setup time and never re-reads them, which is the actual (and only) mechanism that needs to change.

### S-27/S-31's three ceremony pieces, mapped onto the client-staged path

| Piece | Server-owned (S-27/S-31) | Client-staged | Verdict |
|---|---|---|---|
| Dirty-tracking (`dirtyFieldsRef`/`appliedValuesRef`, `server-run-viewer.tsx:149-155,166-192`) | Guards against `simulation.watch`'s subscription (`WATCH_INTERVAL_MS` ≈ 150ms, confirmed at `server-run-registry.ts:31`) overwriting a field the user is mid-edit on | `simulation-canvas.tsx`'s only tRPC call is the one-shot `stop` mutation at line 422 — no subscription or poll exists that could race a live-edit panel | Not needed — no competing writer exists on this path, confirmed by grep showing no `useSubscription`/`watch(` usage in the file |
| Server-side throttle (`PARAM_UPDATE_THROTTLE_MS`, `server-run-registry.ts:156,180-189`, backstopping a direct-call bypass of the UI's own cooldown) | Attaches to `LiveRun.lastParamUpdateAt` inside the server's in-memory registry | No server-side registry entry exists for a client-staged run at all — `updateRunParams`'s only caller repo-wide is `server-run-viewer.tsx`; the client-staged path never calls it or any per-edit mutation | Cannot be replicated — only a client-side-only cooldown (mirroring `APPLY_COOLDOWN_MS`, `server-run-viewer.tsx:69`) is achievable; same bypassability caveat S-27 flagged, but lower-stakes since a client-staged run's state is confined to the user's own browser tab (no shared server state at risk) |
| Persisted changelog (`ParameterChangeEntry`/`parameterChanges`, `server-run-registry.ts:69-74,91,195-201`, threaded into `finishRun`/`stopServerRun`) | Appended by `applyLiveParams`, persisted into `simulationRuns.history` on finish/stop | `buildStopInput()` (`simulation-canvas.tsx:440-468`) and the `stop` procedure's input schema (`simulation.ts:361-422`) both currently have no `parameterChanges` field | Needs a new, from-scratch mechanism — a client-side accumulator ref analogous to `run.parameterChanges.push(...)`, plus schema/procedure extension, to reach parity with the analysis view's `ReferenceLine` overlay |

## Code References

- `src/app/simulation/_components/simulation-canvas.tsx:71-91` — `SimulationCanvasProps`, including the 5 target fields and the setup-only fields (`boidCount`, `flockCount`, `weights`).
- `src/app/simulation/_components/simulation-canvas.tsx:284-298` — destructuring of the 5 target props.
- `src/app/simulation/_components/simulation-canvas.tsx:470,588` — the mount effect's biome-ignore comment and `[runId]`-only dependency array.
- `src/app/simulation/_components/simulation-canvas.tsx:536-547` — where the closed-over prop values are baked into each tick's `params` literal.
- `src/app/simulation/_components/simulation-canvas.tsx:341-420` — `showMinimap`/`showBoundary`'s ref+state live-update precedent, including the comment explaining why `redraw()` must read the ref, not the state.
- `src/app/simulation/_components/simulation-canvas.tsx:422` — the only tRPC call in this file (`stop`, one-shot).
- `src/app/simulation/_components/simulation-canvas.tsx:440-468` — `buildStopInput()`, no `parameterChanges` field.
- `src/app/simulation/page.tsx` (lines ~59, 361-380) — `activeRun` state, `<SimulationCanvas key={activeRun.runId} ...>`, set once at run-start.
- `src/server/simulation/single-run-lifecycle.ts:21-61` — `computeSingleRunTick`, no internal param caching.
- `src/server/simulation/single-run-lifecycle.ts:48-52,105-111` — the `rng`-must-be-stable comment; the 5 fields passed straight through.
- `src/server/simulation/boids.ts:757-758,765-766,824-829,915-916,953,980,1085,1090,1134-1136,1148-1150` — each of the 5 fields' fresh-read consumption sites.
- `src/server/simulation/server-run-registry.ts:69-74,91,156,180-205,230-252,271-308,352,444` — the server-owned `LiveRun`/`applyLiveParams`/throttle/changelog/`tick()` mechanism this change cannot directly reuse.
- `src/app/simulation/_components/server-run-viewer.tsx:69,144-192,348-366` — the dirty-tracking/cooldown mechanism and the `watch` subscription it guards against.
- `src/server/api/routers/simulation.ts:361-422` — the `stop` procedure's input schema (no `parameterChanges`).

## Architecture Insights

- The codebase already has a clean, file-local pattern for "a value the running loop must see change without restarting the effect" (`showMinimap`/`showBoundary`'s ref-as-source-of-truth + state-as-UI-mirror split). S-28 doesn't need a new idiom — it needs to apply this existing one to 5 more fields.
- The shared `computeSingleRunTick`/`boids.ts` core is already fully parameter-agnostic across ticks — none of the restructuring risk the roadmap worried about lives there. It lives entirely in `simulation-canvas.tsx`'s own effect-boundary design, which is the one place that needs to change.
- S-27/S-31's three-piece ceremony (dirty-tracking, server throttle, changelog) is a direct consequence of the server-owned path's architecture (an in-memory, server-side `LiveRun` registry subject to subscription pushes and multi-caller races). None of those architectural conditions exist for a client-staged run, so S-28 should not default to copying that ceremony — it should design from this path's own, much simpler constraints (single writer, no server registry, no competing push).

## Historical Context (from prior changes)

- `context/archive/2026-11-15-live-parameter-adjustment/` (S-27) — established the `applyLiveParams`/dirty-tracking/throttle/changelog mechanism this research found largely non-transferable to the client-staged path.
- `context/archive/2026-11-15-correct-live-parameter-field-set/` (S-31) — corrected S-27's field set to the 5 fields this research targets, and independently confirmed (via `boids.ts` inspection) that flocking weights are per-boid genetic traits, not global params — this research's finding that `weights`/`boidCount`/`flockCount` are consumed only at initial-population setup in `simulation-canvas.tsx` is the client-staged-path confirmation of the exact same fact S-31 established for the server-owned path.
- `context/foundation/lessons.md` — "'UI accepts input' is not 'feature verified'" (recorded after S-31): the eventual plan/implementation for S-28 must design its manual verification to observe an actual behavior change from a live edit, not just that the UI accepted the new value — directly relevant since this change touches the same class of feature.

## Related Research

- None found under `context/changes/**/research.md` or `context/archive/**/research.md` specifically covering the client-staged execution path's architecture; S-27/S-31's `plan.md`/`change.md` cover the server-owned path only.

## Open Questions

- Whether the live-edit UI should reuse `ServerRunViewer`'s panel component/layout or get its own, given `simulation-canvas.tsx`'s different rendering shell (flagged as a user-decision unknown in the roadmap's S-28 entry, not resolved by this research — a product/UI call, not a technical one).
- Whether the client-side-only cooldown (mirroring `APPLY_COOLDOWN_MS`) is worth adding at all given the lower stakes of a client-staged run's self-contained state, or whether this change should skip it entirely and rely on native input debouncing — a cost/benefit call for `/10x-plan`, not a technical blocker.
- Exact shape of the new `parameterChanges` accumulation/schema-extension work for changelog parity — this research confirms it's needed and names the 3 touch points (`simulation-canvas.tsx`'s ref, `buildStopInput()`, the `stop` procedure's schema + history write), but the exact field shape/validation should be finalized during planning, mirroring `ParameterChangeEntry`'s existing shape (`server-run-registry.ts:69-74`) for consistency with the analysis view's overlay.
