# Render-Loop Lifecycle Safety Net Implementation Plan

## Overview

Extract the pure lifecycle-decision core out of both canvas tick loops — `simulation-canvas.tsx` (single-run) and `multi-simulation-stage.tsx` (multi-run) — into DOM-free functions, test their stop-condition/active-slot-selection logic directly, and add a thin shell-wiring smoke test (this project's first DOM-environment dependency) proving the RAF scheduling itself doesn't double-step. This is rollout Phase 2 of `context/foundation/test-plan.md` (Risk #4: canvas tick-loop lifecycle regression).

## Current State Analysis

- Both tick loops (`simulation-canvas.tsx:198-242`, `multi-simulation-stage.tsx:159-232`) have a separable pure lifecycle core — dt computation, stop-condition boolean, active-slot selection, next-state derivation — fused inline inside a `useEffect`/RAF callback that also touches canvas/DOM refs, `requestAnimationFrame`, and a tRPC `stopRun.mutate` call.
- `simulation-canvas.tsx`'s pure core composes Phase 1's `runTick` (boids+predators+food); `multi-simulation-stage.tsx`'s composes only `stepBoids`+`computeCohesion` (boids-only, by design — it has no predator/food logic at all).
- `multi-simulation-stage.tsx`'s per-slot run states live in a `Map<number, RunState>` (`runStatesRef`) mutated in place via `.set()`/`.delete()` (`:175,199`).
- No test under `src/app/` exists today, and no DOM-environment package (`jsdom`/`happy-dom`), React-testing package (`@testing-library/react`), or canvas-mock package exists anywhere in this project, even transitively — confirmed via a `node_modules` disk scan.
- Vitest 5.1.0 supports scoping a DOM environment to specific files via a `// @vitest-environment happy-dom` docblock comment, with no change to the global `environment: "node"` default in `vitest.config.ts`.

### Key Discoveries:

- `run-slots.ts` already establishes this codebase's convention for modeling collection state immutably — `addSlot`/`markStopped`/`removeSlot` each take a plain state object and return a new one, never mutating their input. The multi-run extraction in this plan follows that same convention for `runStatesRef`'s contents (a plain `Record<number, RunState>` returned fresh each tick) rather than keeping the in-place `Map` mutation.
- Rendering either component in a test requires `api.simulation.stop.useMutation()` (called unconditionally at the top of both components) to resolve without a real tRPC provider — there is no existing mocking helper for this anywhere in the repo; this plan mocks `~/trpc/react`'s `api` export directly via `vi.mock`.
- happy-dom does not implement 2D canvas drawing (no package here does, without adding a canvas-rendering package) — `HTMLCanvasElement.prototype.getContext` must be stubbed by hand to return a fake context object implementing only the methods `drawScene`/`drawBoids` actually call (`clearRect`, `fillRect`, `save`, `translate`, `rotate`, `beginPath`, `moveTo`, `lineTo`, `closePath`, `fill`, `restore`, plus a `fillStyle` property), as no-ops.

## Desired End State

`single-run-lifecycle.ts` and `multi-run-lifecycle.ts` each export a DOM-free function that decides, from plain state, what the next tick's state is and whether/what should stop or redraw. Both components call their respective extracted function instead of inlining the decision inline. A pure test suite proves the stop conditions, active-slot selection, and multi-run state bookkeeping directly. A shell-wiring smoke test (new, using happy-dom for the first time in this repo) proves each component schedules exactly one `requestAnimationFrame` call per tick — no double-step.

**Verification:** `npm run typecheck`, `npm run check`, `npx vitest run` (full suite) all pass; manually starting single-run and multi-run simulations behaves identically to before the refactor.

## What We're NOT Doing

- Not unifying the two extracted functions into one shared abstraction — the codebase's established pattern (and `multi-simulation-stage.tsx`'s own header comment) deliberately keeps these two files independent; `single-run-lifecycle.ts` composes `runTick`, `multi-run-lifecycle.ts` composes `stepBoids`+`computeCohesion` only.
- Not adding `@testing-library/react` — the shell-wiring smoke tests mount components with `react-dom/client`'s `createRoot` directly and assert on stubbed-call counts, not DOM queries.
- Not adding a canvas-rendering package (e.g. `node-canvas`, `jest-canvas-mock`) — the hand-rolled `getContext` stub described above is sufficient for the lifecycle-focused assertions this phase needs.
- Not testing visual/pixel output of either canvas — that remains explicitly out of scope per test-plan.md §2's anti-pattern guidance for Risk #4.
- Not changing any simulation constant, formula, or behavior — this is a pure extraction plus new tests, same as Phase 1.
- Not reconciling the single-run/multi-run simulation-scope asymmetry (predators+food vs. boids-only) — that is a separate, already-confirmed-intentional product decision, not this phase's concern.

## Implementation Approach

Phases 1 and 3 each extract one component's pure lifecycle core into its own file (mirroring Phase 1's `runTick` extraction pattern) and wire the component to call it — purely additive plus a behavior-preserving refactor, same shape as Phase 1's two phases. Phases 2 and 4 each add a thin shell-wiring smoke test for the component just refactored, introducing this project's first DOM-environment dependency in Phase 2 and reusing it in Phase 4.

## Critical Implementation Details

**tRPC mocking for component mounting.** Both components call `api.simulation.stop.useMutation()` unconditionally at the top level. Mounting either component in a test — even just to exercise RAF scheduling — requires this call to resolve without throwing. Mock `~/trpc/react`'s `api` export via `vi.mock("~/trpc/react", ...)` so `api.simulation.stop.useMutation` returns a fake `{ mutate: vi.fn(), isPending: false, data: undefined, error: undefined }` (matching the shape both components read). Do not attempt a real `TRPCProvider`/`QueryClientProvider` test harness — nothing in this repo sets that up, and it is unnecessary for a tick-scheduling smoke test.

**happy-dom has no real canvas 2D context.** `canvasRef.current?.getContext("2d")` must not return `null`/throw, or both components' effects bail out early (`if (!canvas || !maybeCtx) return;`) and never schedule a single RAF call. Stub `HTMLCanvasElement.prototype.getContext` (via `vi.spyOn` or direct assignment in the test file, scoped to that file only) to return a fake context object implementing exactly the methods `drawScene`/`drawBoids` call, as no-ops — see Current State Analysis above for the exact method list.

## Phase 1: Extract single-run lifecycle and wire simulation-canvas.tsx

### Overview

Add `computeSingleRunTick` to a new `single-run-lifecycle.ts`, composing Phase 1's `runTick` plus the dt/stop-condition/next-state bookkeeping currently inlined in `simulation-canvas.tsx`'s `tick`. Add pure unit tests. Wire the component to call it.

### Changes Required:

#### 1. Single-run lifecycle function

**File**: `src/server/simulation/single-run-lifecycle.ts` (new)

**Intent**: Give `simulation-canvas.tsx`'s tick loop a DOM-free, directly-testable decision core — dt computation, the composed `runTick` call, next-state derivation, and the stop-on-duration/stop-on-population-wipe decision — separated from the canvas/RAF/tRPC shell that must stay behind.

**Contract**: Export `MAX_DT_SECONDS = 0.1` (moved from `simulation-canvas.tsx`, same value) and `computeSingleRunTick(state: { boids: BoidState[]; predators: PredatorState[]; foodStock: number; cohesionSamples: number[]; elapsedSeconds: number; lastTimestamp: number | null }, timestamp: number, params: { weights: FlockWeights; foodRegenRate: number; protectionThreshold: number; maxDurationSeconds: number }): { boids: BoidState[]; predators: PredatorState[]; foodStock: number; cohesionSamples: number[]; elapsedSeconds: number; lastTimestamp: number; shouldStop: boolean }`. Treats `state.lastTimestamp === null` as "first tick" (`dtSeconds = 0` for that call, matching the component's current `if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp;` — a fresh first call should not apply a huge dt derived from an absolute epoch timestamp with no prior frame to diff against). Computes `dtSeconds = Math.min((timestamp - lastTimestamp) / 1000, MAX_DT_SECONDS)` using the previous tick's timestamp (or `timestamp` itself on the first call, giving `dtSeconds = 0`), calls `runTick` with the composed state, appends a `computeCohesion` sample, increments `elapsedSeconds`, and sets `shouldStop = elapsedSeconds >= params.maxDurationSeconds || boids.length === 0` — identical semantics to the current inline code.

#### 2. Pure unit tests

**File**: `src/server/simulation/single-run-lifecycle.test.ts` (new)

**Intent**: Prove the dt-clamp edge case, the first-tick-zero-dt edge case, both stop conditions, and the non-stopping contrast case — so `shouldStop` isn't vacuously true/false.

**Contract**: 5 Vitest cases: (a) a large `timestamp - lastTimestamp` gap clamps `dtSeconds` to `MAX_DT_SECONDS` rather than applying the raw (huge) delta — assert via a derived effect of `dtSeconds` (e.g. `elapsedSeconds` advances by exactly `MAX_DT_SECONDS`, not the raw gap); (b) `lastTimestamp: null` on the first call produces `elapsedSeconds` unchanged from its input (i.e. `dtSeconds === 0` this tick); (c) `shouldStop` is `true` once `elapsedSeconds` reaches `maxDurationSeconds`; (d) `shouldStop` is `true` when the composed pipeline's output has zero boids; (e) `shouldStop` is `false` for a normal in-progress tick (contrast case, so (c)/(d) aren't trivially always-true).

#### 3. Wire the component

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Replace the inline dt/runTick/stop-condition sequence with a single call to `computeSingleRunTick`, so the UI and the new test suite share one source of truth for the lifecycle decision, same pattern as Phase 1's `runTick` wiring.

**Contract**: `tick`'s body becomes a call to `computeSingleRunTick({ boids: boidsRef.current, predators: predatorsRef.current, foodStock: foodStockRef.current, cohesionSamples: cohesionSamplesRef.current, elapsedSeconds: elapsedSecondsRef.current, lastTimestamp: lastTimestampRef.current }, timestamp, { weights, foodRegenRate, protectionThreshold, maxDurationSeconds })`, writing each field of the result back into its corresponding ref, calling `drawScene(ctx, result.boids, result.predators)`, and branching on `result.shouldStop` in place of the current inline `if`. Remove the component's own `MAX_DT_SECONDS` constant and the now-unused `runTick`/`computeCohesion` call sites' inline logic; import `computeSingleRunTick` (and `MAX_DT_SECONDS` only if still referenced elsewhere in the file — it is not, so it need not be re-exported/imported here). No other change to `tick` or `stop`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Shell-wiring smoke test for simulation-canvas.tsx

### Overview

Add `happy-dom` as this project's first DOM-environment devDependency, scoped to this one new test file via a `// @vitest-environment happy-dom` docblock, and prove `simulation-canvas.tsx`'s RAF scheduling itself doesn't double-step — the one thing Phase 1's pure-function tests can't reach, since they never touch the component.

### Changes Required:

#### 1. DOM-environment devDependency

**File**: `package.json`

**Intent**: Add the minimal DOM environment needed to mount a React component in a test, per the user's confirmed choice (happy-dom + raw `react-dom/client`, no `@testing-library/react`).

**Contract**: `npm install -D happy-dom`.

#### 2. Shell-wiring smoke test

**File**: `src/app/simulation/_components/simulation-canvas.test.tsx` (new)

**Intent**: Prove the component's RAF-scheduling shell calls `requestAnimationFrame` exactly once per tick (schedule-on-mount, then schedule-once-more-per-processed-frame) — the "no double-step" guarantee from test-plan.md Risk #4 — without asserting on canvas pixel output or tRPC network behavior.

**Contract**: First line `// @vitest-environment happy-dom`. `vi.mock("~/trpc/react", ...)` stubs `api.simulation.stop.useMutation` to return `{ mutate: vi.fn(), isPending: false, data: undefined, error: undefined }`. Stub `HTMLCanvasElement.prototype.getContext` to return the fake context object described in Critical Implementation Details. Stub `requestAnimationFrame`/`cancelAnimationFrame` with `vi.fn()`s that record calls but do not actually schedule a real callback (the test manually invokes the captured callback to advance one tick). Mount `SimulationCanvas` with minimal valid props via `createRoot` inside `act(...)`; assert `requestAnimationFrame` was called exactly once after mount (the initial schedule); manually invoke that captured callback with a timestamp; assert `requestAnimationFrame` was then called exactly twice total (the initial schedule plus the one scheduled from inside the just-processed tick) — not three or more, which would indicate a double-step.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test passes: `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Extract multi-run lifecycle and wire multi-simulation-stage.tsx

### Overview

Add `computeMultiRunTick` to a new `multi-run-lifecycle.ts`, modeling the per-slot run-state collection as a plain, immutably-updated `Record<number, RunState>` (per the confirmed decision) instead of the current in-place `Map` mutation, and extracting the per-slot stop-condition and active-slot-selection decisions. Add pure unit tests. Wire the component to call it.

### Changes Required:

#### 1. Multi-run lifecycle function

**File**: `src/server/simulation/multi-run-lifecycle.ts` (new)

**Intent**: Give `multi-simulation-stage.tsx`'s tick loop a DOM-free, directly-testable decision core — which run-states exist, which slots should stop this tick, and which slot's boids to draw — following `run-slots.ts`'s existing immutable-update convention rather than the current `Map` mutation.

**Contract**: Export `MAX_DT_SECONDS = 0.1` (this file's own copy — the two lifecycle files stay independent, per "What We're NOT Doing") and `computeMultiRunTick(state: { runStates: Record<number, RunState>; lastTimestamp: number | null }, timestamp: number, slots: RunSlot[], activeRunId: number | null, manualStopRequestId: number | null): { runStates: Record<number, RunState>; lastTimestamp: number; slotsToStop: RunSlot[]; activeDrawBoids: BoidState[] | null; nextManualStopRequestId: number | null }`, where `RunState = { boids: BoidState[]; cohesionSamples: number[]; elapsedSeconds: number }` (moved from the component). Per tick: compute `dtSeconds` the same way as `computeSingleRunTick` (first-tick-zero-dt, clamped); drop any `runStates` entry whose `runId` no longer appears in `slots` (dismissed); seed a fresh `RunState` (via `createInitialPopulation`/`createRng`) for any `"running"` slot missing one; for each `"running"` slot, step its boids via `stepBoids`, append a cohesion sample, advance `elapsedSeconds`, and — if `elapsedSeconds >= slot.maxDurationSeconds || boids.length === 0 || manualStopRequestId === slot.runId` — add it to `slotsToStop` and set `nextManualStopRequestId: null` (mirroring the current `manualStopRequestRef.current = null` consumption); select `activeDrawBoids` as the `runStates` entry matching `activeRunId`'s boids, or `null` if no slot matches or has a state yet (the caller clears the canvas on `null`, matching the current `else` branch).

#### 2. Pure unit tests

**File**: `src/server/simulation/multi-run-lifecycle.test.ts` (new)

**Intent**: Prove slot-state seeding/cleanup, each of the three stop conditions, and — the behavior literally named in this rollout phase's goal — correct active-slot redraw selection when switching which slot is active.

**Contract**: Vitest cases covering: (a) a new `"running"` slot with no existing `runStates` entry gets one seeded; (b) a `runStates` entry for a slot no longer in `slots` is dropped; (c)-(e) each of the three stop conditions (`elapsedSeconds >= maxDurationSeconds`, `boids.length === 0`, `manualStopRequestId === slot.runId`) independently produces that slot in `slotsToStop`, with `nextManualStopRequestId: null` after case (e); (f) `activeDrawBoids` returns the boids belonging to whichever `runId` is passed as `activeRunId`, confirmed by switching `activeRunId` between two slots with distinguishable boid arrays and asserting the returned array matches the newly-active one, not the previously-active one — the "redraw-on-switch" contract; (g) `activeDrawBoids` is `null` when `activeRunId` is `null` or matches no slot.

#### 3. Wire the component

**File**: `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

**Intent**: Replace the inline per-tick loop over slots, the `Map` mutation, and the active-slot selection with a single call to `computeMultiRunTick`, writing its result back into the refs — same refactor shape as Phase 1's `simulation-canvas.tsx` wiring.

**Contract**: `runStatesRef` becomes `useRef<Record<number, RunState>>({})`. `tick`'s body becomes a call to `computeMultiRunTick({ runStates: runStatesRef.current, lastTimestamp: lastTimestampRef.current }, timestamp, slotsRef.current, activeRunIdRef.current, manualStopRequestRef.current)`, writing `result.runStates` back into `runStatesRef.current`, `result.lastTimestamp` into `lastTimestampRef.current`, and `result.nextManualStopRequestId` into `manualStopRequestRef.current`; calling `stopSlot(slot, result.runStates[slot.runId])` for each entry in `result.slotsToStop` (the tRPC-calling idempotency guard in `stopSlot` itself, via `finishedRunIdsRef`, stays unchanged in the shell); drawing `result.activeDrawBoids` via `drawBoids` when non-null, else the existing clear-canvas branch. Remove the component's own `MAX_DT_SECONDS` constant and the inlined per-slot loop/Map logic; import `computeMultiRunTick` and the `RunState` type from the new module.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New tests pass: `npx vitest run src/server/simulation/multi-run-lifecycle.test.ts`
- Full suite passes with no regression: `npx vitest run`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Shell-wiring smoke test for multi-simulation-stage.tsx and cookbook update

### Overview

Add a shell-wiring smoke test for `multi-simulation-stage.tsx` reusing Phase 2's happy-dom setup, and record the pattern this rollout phase shipped in `test-plan.md` §6.2.

### Changes Required:

#### 1. Shell-wiring smoke test

**File**: `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx` (new)

**Intent**: Prove the same "no double-step" RAF-scheduling guarantee for the multi-run component, reusing the mocking approach established in Phase 2 — no new dependency.

**Contract**: Same structure as Phase 2's test: `// @vitest-environment happy-dom` docblock, `vi.mock("~/trpc/react", ...)` for `api.simulation.stop.useMutation`, a stubbed `HTMLCanvasElement.prototype.getContext`, stubbed `requestAnimationFrame`/`cancelAnimationFrame`. Mount `MultiSimulationStage` with an empty `slots` array (simplest valid props — no running slot needed to exercise the scheduling guarantee itself) and assert the same exactly-once-then-exactly-twice RAF call-count sequence as Phase 2.

#### 2. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Record the pattern this rollout phase shipped — including the new happy-dom dependency and when to reach for it — so a future agent testing similar lifecycle logic doesn't start from zero.

**Contract**: Add a new `### 6.2 Adding an integration test for a render-loop lifecycle` entry (replacing any `TBD — see §3 Phase 2` placeholder) with: location pattern (`src/server/simulation/<name>-lifecycle.ts` + co-located `.test.ts` for the pure core; `src/app/<component>.test.tsx` for the shell-wiring smoke test), the two-layer pattern (extract pure state-in/state-out functions first — zero new dependencies — then add a minimal happy-dom-based smoke test only for the thin RAF-scheduling shell, never for visual/pixel output), reference tests (`single-run-lifecycle.test.ts`, `simulation-canvas.test.tsx`), and run commands.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test passes: `npx vitest run src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`
- Full suite passes with no regression: `npx vitest run`

#### Manual Verification:

- Starting a single-run simulation at `/simulation` and a multi-run simulation at `/simulation/multi` both behave identically to before this phase's refactors: boids/predators move, stop conditions fire correctly, switching the active multi-run slot redraws the newly-active one, and scores compute on stop.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- Single-run lifecycle: dt clamp, first-tick-zero-dt, both stop conditions, non-stopping contrast (5 cases).
- Multi-run lifecycle: slot-state seeding, dismissed-slot cleanup, all three stop conditions, active-slot redraw selection (including the `null` case) (7 cases).

### Integration Tests:

- Two shell-wiring smoke tests (one per component), proving RAF-scheduling doesn't double-step, using happy-dom and hand-rolled RAF/canvas/tRPC stubs — this project's first DOM-environment test infrastructure.

### Manual Testing Steps:

1. Start a single-run simulation at `/simulation`; confirm no regression from Phase 1's behavior (flocking, hunting, hunger/predation, score on stop).
2. Start 2+ multi-run simulations at `/simulation/multi`; switch the active slot between them; confirm the newly-active slot's canvas redraws correctly and the non-viewed slot's elapsed time keeps advancing.
3. Let a run reach its duration or population-wipe stop condition in both single-run and multi-run modes; confirm it stops and scores correctly.

## Performance Considerations

None beyond what Phase 1 already established — these extractions are the same per-tick work, relocated, not duplicated or added to.

## Migration Notes

None — no schema or data changes; test code, two new DOM-free lifecycle modules, and one new devDependency scoped to two test files.

## References

- Research: `context/changes/testing-render-loop-lifecycle/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #4; §3 Phase 2)
- Prior phase (pattern to follow): `context/changes/testing-composed-pipeline-correctness/plan.md`
- Existing immutable-state convention (to follow for multi-run): `src/server/simulation/run-slots.ts`
- Existing tick loops (to be refactored): `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract single-run lifecycle and wire simulation-canvas.tsx

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — b773de5
- [x] 1.2 Linting passes: `npm run check` — b773de5
- [x] 1.3 New tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts` — b773de5
- [x] 1.4 Full suite passes with no regression: `npx vitest run` — b773de5

### Phase 2: Shell-wiring smoke test for simulation-canvas.tsx

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 7e40215
- [x] 2.2 Linting passes: `npm run check` — 7e40215
- [x] 2.3 New test passes: `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — 7e40215
- [x] 2.4 Full suite passes with no regression: `npx vitest run` — 7e40215

### Phase 3: Extract multi-run lifecycle and wire multi-simulation-stage.tsx

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 8f4acb8
- [x] 3.2 Linting passes: `npm run check` — 8f4acb8
- [x] 3.3 New tests pass: `npx vitest run src/server/simulation/multi-run-lifecycle.test.ts` — 8f4acb8
- [x] 3.4 Full suite passes with no regression: `npx vitest run` — 8f4acb8

### Phase 4: Shell-wiring smoke test for multi-simulation-stage.tsx and cookbook update

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck` — c642d72
- [x] 4.2 Linting passes: `npm run check` — c642d72
- [x] 4.3 New test passes: `npx vitest run src/app/simulation/multi/_components/multi-simulation-stage.test.tsx` — c642d72
- [x] 4.4 Full suite passes with no regression: `npx vitest run` — c642d72

#### Manual

- [x] 4.5 Single-run and multi-run simulations both behave identically to before this phase's refactors, including correct redraw-on-switch for multi-run — c642d72
