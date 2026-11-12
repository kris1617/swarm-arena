---
date: 2026-11-12T18:17:03Z
researcher: Claude (10x-research)
git_commit: 3c6ee75f2c441784fc4e9eeb9ef710b0ee51ff88
branch: master
repository: swarm-arena (10xdevs)
topic: "Rollout Phase 2 of context/foundation/test-plan.md — Risk #4 (canvas tick-loop lifecycle regression)"
tags: [research, codebase, render-loop, raf, canvas, vitest, jsdom]
status: complete
last_updated: 2026-11-12
last_updated_by: Claude (10x-research)
---

# Research: Render-loop lifecycle safety net (test-plan Phase 2)

**Date**: 2026-11-12T18:17:03Z
**Researcher**: Claude (10x-research)
**Git Commit**: 3c6ee75f2c441784fc4e9eeb9ef710b0ee51ff88
**Branch**: master
**Repository**: swarm-arena (10xdevs)

## Research Question

Ground Risk #4 from `context/foundation/test-plan.md` §2 (canvas tick-loop lifecycle regression, duplicated across two components, zero tests under `src/app/`): what is the cheapest way to make the two tick loops' lifecycle behavior (stop conditions, active-slot redraw selection, no double-step) testable, and does the response guidance's "mocked RAF/canvas" assumption hold up against what test infrastructure actually exists in this project.

## Summary

- **Both tick loops have a clearly separable, pure "lifecycle decision" core.** In `simulation-canvas.tsx`'s `tick` (`:198-242`) and `multi-simulation-stage.tsx`'s `tick` (`:159-232`), the dt computation, the stop-condition boolean, the active-slot-to-draw selection, and the state transitions (next boids/predators/foodStock, next elapsed time, next cohesion samples) are all plain-value computations that only call already-pure functions (`runTick`, `stepBoids`, `computeCohesion`, `createInitialPopulation`). None of that core logic touches the DOM, canvas, RAF, or tRPC — confirmed by tracing every line of both `tick` functions and classifying each as "pure, extractable" vs. "must stay behind" (see Detailed Findings).
- **What must stay behind in each component, regardless of approach**: `canvasRef.current.getContext("2d")`, `drawScene`/`drawBoids` canvas draw calls, `requestAnimationFrame`/`cancelAnimationFrame`, `stopRun.mutate(...)` (tRPC), and `setStatus`/`setManualStopPendingRunId` (React state setters). These are the genuine DOM/RAF/network/React-rendering boundary; no test of them is in scope for "lifecycle logic," and test-plan.md §2's own Risk Response Guidance already scopes Risk #4 to lifecycle state-transitions, not visuals.
- **No DOM/canvas-mock/testing-library infrastructure exists anywhere in this project, confirmed via a `node_modules` disk check, not just `package.json`.** `vitest.config.ts`'s `test.environment` is `"node"` with no DOM override anywhere. `jsdom`, `happy-dom`, `@testing-library/react`, and any canvas-mock package (`jest-canvas-mock`, `vitest-canvas-mock`) are absent as direct dependencies, and a `node_modules` scan confirms they are not present even transitively via Next.js or create-t3-app's own tooling — they appear only as *optional* peerDependencies of vitest itself in `package-lock.json`, which npm does not install unless something actually requires them.
- **This materially changes the cost side of test-plan.md §2's "likely cheapest layer" guidance for Risk #4** ("integration test with a mocked RAF/canvas, not e2e/Playwright"). Mocking RAF/canvas/tRPC as currently worded implies adding new dev dependencies (a DOM environment package at minimum, likely `@testing-library/react` for React-render-based testing, possibly a canvas-mock package since jsdom's own `getContext` does not implement real canvas APIs) plus Vitest config work (`environmentMatchGlobs`, a multi-project config, or per-file `// @vitest-environment jsdom` directives) to scope that DOM environment away from the rest of the `"node"`-environment suite. By contrast, extracting the already-identified pure lifecycle core into DOM-free functions — mirroring Phase 1's `runTick` extraction pattern exactly — requires **zero new dependencies** and stays entirely within the existing `environment: "node"` Vitest setup. Per test-plan.md §1's cost × signal principle, extraction is the cheaper layer for the same signal (lifecycle correctness), and should be `/10x-plan`'s default unless a concrete reason favors mocking instead.
- **One cross-file asymmetry re-confirmed fresh (not stale from Phase 1's research):** `simulation-canvas.tsx` now imports and calls `runTick` (Phase 1's extraction landed — confirmed via its current import list, `:6-14`, and the `tick` body, `:212-223`). `multi-simulation-stage.tsx`'s imports and `tick` body (`:159-232`) are **unchanged** by that refactor — it still imports and calls `stepBoids` directly (`:10`, used at `:202`) and has no predator/food/hunger logic at all. This is intentional and documented (file-header comment, `:17-23`, citing the parallel-sim-switching plan's deliberate duplication), not something this phase should reconcile — but it means any extracted lifecycle function for `multi-simulation-stage.tsx` composes only `stepBoids`+`computeCohesion`, while `simulation-canvas.tsx`'s composes the full `runTick`.
- **No existing test anywhere in the repo mocks RAF, canvas, or a tRPC `useMutation` hook** (confirmed via repo-wide grep for `requestAnimationFrame`, `cancelAnimationFrame`, `getContext`, `useMutation` inside `*.test.*` files — zero matches). All 6 existing test files are server-only, `environment: "node"` tests with no DOM dependency.

## Detailed Findings

### `simulation-canvas.tsx`'s `tick` (full current state, post Phase 1 refactor)

- `tick` spans `:198-242`; `stop` (called from inside `tick`) spans `:181-196`. Both live inside the component's single `useEffect` (`:160-251`, keyed only on `runId`, `:251`).
- **Separable (pure) core**: dt computation (`:199-206`: `dtSeconds = Math.min((timestamp - lastTimestamp) / 1000, MAX_DT_SECONDS)`); the `runTick(...)` call itself (`:212-223`, already pure — it's Phase 1's composed function); the derived next-state values (next boids/predators/foodStock, next cohesion sample, next elapsed seconds, `:225-229`); and the stop-condition boolean (`:233-236`: `elapsedSeconds >= maxDurationSeconds || nextBoids.length === 0`). All of this is computable from plain values with no DOM/RAF/tRPC call.
- **Must stay behind**: `canvasRef.current.getContext("2d")` (`:162`, effect setup); `drawScene(ctx, ...)` canvas draws (`:179`, `:231`); `requestAnimationFrame`/`cancelAnimationFrame` (`:186`, `:241`, `:244`, `:247`); `stopRun.mutate({...})` tRPC call (`:188-195`, inside `stop()`); `setStatus("stopped")` React state setter (`:187`). The ref reads/writes (`boidsRef.current = nextBoids`, etc., `:225-227`) are the glue between an extracted pure function and this imperative shell — they'd move to the call site that invokes the extracted function and writes its result back into the refs.
- Current imports (`:1-21`) confirm Phase 1's refactor landed exactly as planned: `runTick` is imported from `~/server/simulation/boids` alongside `computeCohesion`, `createInitialPopulation`, `createInitialPredators`, and type imports; `stepBoids`/`stepPredators`/`applyHunger`/`applyPredation` are no longer imported here at all.

### `multi-simulation-stage.tsx`'s `tick` (full current state — unaffected by Phase 1)

- `tick` spans `:159-232` (per-slot loop at `:179-215`); `stopSlot` (called from inside `tick`) spans `:123-157`. Both live inside the component's `useEffect` (`:114-239`, empty dependency array, `:239`).
- **Separable (pure) core**: dt computation (`:163-167`, same shape as the single-run file); computing which run IDs survived (`:169-177`) and which `RunState` to seed for a new slot (`:184-200`, using already-pure `createRng`/`createInitialPopulation`); the per-slot physics step and stop-condition boolean (`:202-211`: `stepBoids`, cohesion push, elapsed increment, then `elapsedSeconds >= maxDurationSeconds || nextBoids.length === 0 || manualStopRequest === slot.runId`); and the active-slot-to-draw selection (`:217-222`: find the slot matching `activeRunId`, look up its `RunState`).
- **Must stay behind**: `canvasRef.current.getContext("2d")` (`:116`); the `Map` mutations on `runStatesRef`'s underlying map (`.delete`/`.set`, `:175`, `:199` — these could be modeled as "return a new map" to stay pure, but are currently written as in-place mutation of a ref-held `Map`); `stopRun.mutate(...)` with `onSuccess`/`onError` callbacks (`:130-156`); `setManualStopPendingRunId(...)` (`:138-140`, `:150-152`); `onFinishedRef.current(...)` callback invocation (`:141`, `:153`); `drawBoids`/`ctx.clearRect`/`ctx.fillStyle`/`ctx.fillRect` canvas draws (`:224`, `:226-228`); `requestAnimationFrame`/`cancelAnimationFrame` (`:231`, `:234`, `:237`).
- Current imports (`:1-15`) confirm no change since before Phase 1: `stepBoids` and `createInitialPopulation` are imported directly from `~/server/simulation/boids`; no predator/food types or functions are imported at all. The file-header comment (`:17-23`, quoted in Phase 1's research and re-confirmed present at the same lines now) documents this as an intentional, confirmed-with-the-user duplication from `simulation-canvas.tsx`, not something to reconcile.

### Test infrastructure for RAF/canvas/tRPC mocking

- `vitest.config.ts` (full file read): `test.environment` is `"node"`, with no `environmentMatchGlobs`, no per-directory override, and no mention of jsdom/happy-dom anywhere in the file. The only other `test` keys are `exclude` (skips `.claude/**`), `env` (test env vars for the DB/auth schema), and `server.deps.inline` (next-auth module resolution) — none relevant to DOM support.
- `package.json` (full file read): the only test-related dependency of any kind is `"vitest": "^5.1.0"`. No `@testing-library/*` package, no `jsdom`, no `happy-dom`, no canvas-mock package (`jest-canvas-mock`/`vitest-canvas-mock`) exists in `dependencies` or `devDependencies`.
- A direct `node_modules` directory scan (not just `package.json`/`package-lock.json` text search) confirms `jsdom`, `happy-dom`, `@testing-library/*`, and any canvas-mock package are genuinely absent from disk — not installed even transitively via Next.js or create-t3-app's own tooling. `jsdom`/`happy-dom` appear only as optional peerDependencies declared by vitest's own `package.json` inside `package-lock.json` (version `"*"`), which npm does not install unless something actually requires them — nothing in this project does yet.
- A repo-wide grep for `requestAnimationFrame`, `cancelAnimationFrame`, `getContext`, and `useMutation` restricted to `*.test.*` files returned zero matches anywhere in the repo. All 6 existing test files (`pipeline.test.ts`, `run-slots.test.ts`, `boids.test.ts`, `rng.test.ts`, `post.test.ts`, `simulation.test.ts`) are plain server-side logic tests under the default `"node"` environment — none provide a precedent for DOM/RAF/canvas/tRPC-hook mocking in this codebase.
- Vitest 5.1.0 (the installed version) does support scoping a DOM environment to specific files without changing the global default: a per-file `// @vitest-environment jsdom` (or `happy-dom`) docblock comment, an `environmentMatchGlobs` config entry, or a multi-project Vitest config. Any of these would work *mechanically*, but all three still require actually installing `jsdom` or `happy-dom` first (and likely `@testing-library/react` for ergonomic component rendering, and a canvas-mock package since jsdom's `getContext` does not implement real 2D canvas drawing) — none of which exist today.
- No test anywhere in the repo or its dependencies provides a ready-made way to mock a tRPC `useMutation` hook (e.g. an MSW-style tRPC test helper) — a component-level test exercising `stopRun.mutate` would need either a hand-built mock via `vi.mock("~/trpc/react", ...)` or a real `TRPCProvider`/`QueryClientProvider` test harness, neither of which is wired up today.

## Code References

- `src/app/simulation/_components/simulation-canvas.tsx:198-242` - single-run `tick`, composed via Phase 1's `runTick`
- `src/app/simulation/_components/simulation-canvas.tsx:181-196` - `stop()`, the tRPC-calling boundary
- `src/app/simulation/_components/simulation-canvas.tsx:233-236` - stop-condition boolean (pure, extractable)
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:159-232` - multi-run `tick`, boids-only subset (unaffected by Phase 1)
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:123-157` - `stopSlot()`, the tRPC-calling boundary
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx:207-222` - per-slot stop-condition + active-slot-to-draw selection (pure, extractable)
- `vitest.config.ts` (full file) - confirms `environment: "node"`, no DOM override
- `package.json` (full file) - confirms no jsdom/happy-dom/testing-library/canvas-mock dependency

## Architecture Insights

- This codebase's established pattern — confirmed twice now, once in Phase 1's `runTick` extraction and again by this phase's analysis — is to keep simulation/lifecycle logic in plain, exported, DOM-free functions and push all framework concerns (refs, canvas, RAF, tRPC) into the thinnest possible component shell around them. Risk #4's cheapest test layer is a direct continuation of that pattern, not a departure requiring new tooling.
- The two tick loops' pure cores are structurally similar (dt computation → physics step → stop-condition boolean → next-state) but not identical in shape: the single-run loop operates on one `{boids, predators, foodStock}` triple, while the multi-run loop operates on a collection of per-slot `RunState`s plus an active-slot selection. Any extracted functions should likely be two separate, file-local functions (one per component) rather than one shared abstraction — forcing a shared shape would be exactly the kind of premature unification the multi-run file's existing "deliberately duplicated" comment already warns against.

## Historical Context (from prior changes)

- `context/changes/testing-composed-pipeline-correctness/research.md` (Phase 1's research) first identified that neither tick loop extracts its composition into a testable function; this phase's research re-confirms that finding against the current, post-Phase-1 code and finds the gap is otherwise unchanged in `multi-simulation-stage.tsx` and only partially addressed in `simulation-canvas.tsx` (which now calls the pure `runTick`, but still inlines the lifecycle decisions *around* that call).
- `context/archive/2026-11-11-parallel-sim-switching/plan.md` - "What We're NOT Doing" section is the source of the intentional duplication between the two tick loops; this phase's tests should respect that boundary (two separate extracted functions, not a forced shared one) rather than trying to unify the files.

## Related Research

- `context/changes/testing-composed-pipeline-correctness/research.md` - Phase 1's research, which this phase's findings build on and re-verify against current code.

## Open Questions

- Whether `/10x-plan` wants the extracted lifecycle functions to model the `Map`-based `runStatesRef` mutation (`multi-simulation-stage.tsx:175,199`) as a pure "return a new map" transformation, or accept that one piece of state as part of the imperative shell and extract only the per-tick decision logic around it — a design choice, not something research resolved.
- Whether this phase should test the thin imperative shell's wiring at all (e.g. a smoke-level check that the shell calls the extracted function once per RAF tick) or treat that as acceptably out of scope given the lack of any RAF/canvas mocking infrastructure — `/10x-plan`'s call, informed by the cost-side finding above.
