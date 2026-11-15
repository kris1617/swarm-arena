# Client-staged live parameter parity Implementation Plan

## Overview

Bring S-27/S-31's live-parameter-adjustment capability to client-staged runs (ticked via `requestAnimationFrame` in the browser, not server-owned). A user changes `foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, or `mutationMagnitude` on an actively-running client-staged simulation and sees the correct effect (immediate for the first two, future-offspring-only for the other three) — with full changelog parity, so the completed run's analysis view shows the same `ReferenceLine` overlay server-owned runs already get.

## Current State Analysis

- `simulation-canvas.tsx`'s 5 target props are destructured once (lines 284-298) and closed over inside a mount effect whose dependency array is `[runId]` only (line 588) — a parent re-render with a new value for any of these never reaches the running tick loop. The file already solves this exact "value must update without restarting the loop" problem for `showMinimap`/`showBoundary` (lines 341-420): a `useRef` is the single source of truth the loop reads every frame, paired with a `useState` purely so the `Switch` can render `checked`.
- `boidCount`, `flockCount`, and `weights` (the flocking-weights bundle) are consumed only once, inside the mount effect's initial-population setup (lines 487-503) — never referenced inside `tick()`. This independently confirms, for the client-staged path, the same fact S-31 established for the server-owned path: flocking weights are per-boid genetic traits, not global params, and correctly stay out of scope here.
- The shared tick core (`computeSingleRunTick`, `single-run-lifecycle.ts:21-61`, calling into `boids.ts`) imposes no determinism risk — every one of the 5 target fields is read fresh at its point of use (`applyHunger`, `applyPredation`, `reproducePopulation`'s eligibility check, `inheritGenes`'s gene-blending), confirmed by direct inspection. The server-owned path already proved patching these same 5 fields mid-run through this same shared core is safe (S-27 shipped, S-31 corrected its field set). The only risk is isolated to `simulation-canvas.tsx`'s own closure-over-fixed-props design.
- `checkLiveParamRangesSoft` (`simulation.ts:180-193`) — the soft, non-throwing range check `updateRunParams` already uses — is a private function inside a server-only router module (imports `db`, `TRPCError`, etc.) and cannot be imported into a `"use client"` component. `parameter-ranges.ts` is already pure and already imported client-side (`page.tsx:10`, `server-run-viewer.tsx:25`) — moving the function there makes it genuinely shared, not duplicated, which is what "reuse it" actually requires.
- `page.tsx` already calls `api.simulation.getParameterRanges.useQuery()` (line 56) for the staging form's NumberField bounds — the same query can supply the client-staged panel's ranges without a new procedure.
- `server-run-viewer.tsx` (lines 29-72, 141-296, 428-463) is the server-owned path's live-edit panel: `LIVE_FIELDS`/`LIVE_FIELD_LABELS`, `IMMEDIATE_FIELDS`/`FUTURE_OFFSPRING_FIELDS` grouping, `renderLiveField`'s `NumberField`+warning+flash rendering, `APPLY_COOLDOWN_MS`/`FLASH_DURATION_MS` constants — all worth mirroring verbatim for the panel's shape and labels. Its dirty-tracking (`dirtyFieldsRef`/`appliedValuesRef`/`syncLiveParams`) exists specifically to guard against `simulation.watch`'s ~150ms subscription push racing the user's own edit — confirmed there is no equivalent push source on the client-staged path (its only tRPC call is the one-shot `stop` mutation, `simulation-canvas.tsx:422`), so this machinery is correctly omitted here.
- `LiveAdjustableParams` (`server-run-registry.ts:58-65`) is a type-only export already imported into a `"use client"` file today (`server-run-viewer.tsx:26`) — safe to reuse as the type for the client-staged path's 5 fields too; no new type needed.
- `buildStopInput()` (`simulation-canvas.tsx:440-468`) and the `stop` procedure's zod input schema (`simulation.ts:361-422`) currently have no `parameterChanges` field. `getRunAnalysis`'s `history` cast (`simulation.ts:730-741`) already declares `parameterChanges` as an **optional** field with the exact `{tick, field, oldValue, newValue}` shape `ParameterChangeEntry` uses — and the analysis view's `ReferenceLine` overlay (`src/app/runs/[runId]/page.tsx:148-160`) reads `history?.parameterChanges` generically, with no run-type distinction. Persisting it from `stop` is the only missing piece for full parity.

## Desired End State

A user can open a client-staged run's canvas while it's actively ticking, see a live-edit panel showing the same 5 fields as the server-owned path (grouped "Takes effect immediately" / "Affects future offspring only"), change a value, click Apply, and observe the actual simulation behavior change on the next relevant tick/reproduction event — not just a UI update. When the run finishes, its analysis view shows the same `ReferenceLine` changelog overlay server-owned runs already get.

### Key Discoveries:

- `simulation-canvas.tsx:341-420`'s `showMinimap`/`showBoundary` ref+state pattern is the exact mechanism to copy for the 5 target fields.
- `checkLiveParamRangesSoft` needs to move to `parameter-ranges.ts` to be reusable at all (it currently lives in a server-only module).
- No changes are needed in `page.tsx` — the panel and its live-adjust mechanism can live entirely inside `simulation-canvas.tsx`, since all refs/state already live there.

## What We're NOT Doing

- Not making flocking weights (`separationWeight`/`alignmentWeight`/`cohesionWeight`), `boidCount`, or `flockCount` live-adjustable — confirmed per-boid-genetic/setup-only, same reasoning as S-31.
- Not adding dirty-tracking — confirmed there is no competing writer on the client-staged path (no subscription/poll), so the race it guards against cannot occur here.
- Not adding a server-side throttle backstop — confirmed no server-side registry entry exists for a client-staged run to attach one to; the client-side cooldown (decision below) is the only guard this path can have, and the stakes are lower since a client-staged run's state is confined to the user's own browser tab.
- Not changing `applyLiveParams`, `updateRunParams`, or any server-owned-path file — this slice touches only the client-staged path plus the one shared extraction (`checkLiveParamRangesSoft`).
- Not adding special handling for a pending (un-applied) panel edit when the run finishes or is stopped — it's discarded along with the rest of the component's local state when the canvas unmounts, same as closing a form without submitting.

## Implementation Approach

Three phases: (1) a pure refactor making the soft-range check reusable, (2) the ref-based live-adjust mechanism plus the new panel UI, (3) changelog persistence for analysis-view parity. Each phase is independently testable and committable; Phase 2 depends on Phase 1's export, Phase 3 depends on Phase 2's accumulation point existing.

## Phase 1: Shared validation extraction

### Overview

Move `checkLiveParamRangesSoft` out of `simulation.ts` (server-only) into `parameter-ranges.ts` (pure, already client-imported) so both the server-owned path's `updateRunParams` and the new client-staged panel call the identical function — true reuse, not a duplicate re-implementation of the same two-line range comparison.

### Changes Required:

#### 1. `checkLiveParamRangesSoft`

**File**: `src/server/simulation/parameter-ranges.ts`

**Intent**: Relocate the function as-is so it's importable from a client component without pulling in server-only dependencies.

**Contract**: Export `checkLiveParamRangesSoft(patch: Partial<Record<RangedParameterName, number>>, ranges: ParameterRanges): string[]` with identical behavior to the current `simulation.ts:180-193` implementation (same warning string format: `` `${field} (${value}) is outside the configured range ${range.min}-${range.max}` ``).

#### 2. `updateRunParams`'s import

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Remove the now-duplicate local definition; import the relocated function instead.

**Contract**: Delete the local `checkLiveParamRangesSoft` function (lines 180-193); add it to the existing `~/server/simulation/parameter-ranges` import. No change to any call site's behavior.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/api/routers/simulation.test.ts` — no behavior change expected; the existing `updateRunParams` out-of-range test (around the `energyThreshold: 99999` case established in S-31) must still pass unmodified, proving the extraction preserved identical behavior.
- Full suite passes: `npm test`

#### Manual Verification:

- None — pure refactor with no observable behavior change; covered entirely by the existing automated test.

## Phase 2: Client-staged live-adjust mechanism

### Overview

Give the 5 target fields the `showMinimap`/`showBoundary` ref treatment inside `simulation-canvas.tsx`, and add a live-edit panel that writes to those refs.

### Changes Required:

#### 1. Live-param refs

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Replace the closed-over destructured props for the 5 target fields with refs that both the tick loop and the new panel read/write, exactly mirroring `showMinimapRef`/`showBoundaryRef`'s posture.

**Contract**: Add `foodRegenRateRef`, `protectionThresholdRef`, `energyThresholdRef`, `mutationChanceRef`, `mutationMagnitudeRef` (each `useRef<number>`), initialized from the corresponding props inside the component body (not inside the mount effect, so they exist before the effect runs). Inside `tick()`'s `computeSingleRunTick` call (lines 536-547), replace the 5 plain identifiers with `<field>Ref.current`. The props themselves stay in `SimulationCanvasProps` (still used for creation-time setup elsewhere, e.g. nothing else currently reads them — only `tick()` did) and as the refs' initial values.

#### 2. Live-edit panel component

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: A new, self-contained panel section rendered inside `SimulationCanvas`'s own return JSX (no prop threading to/from `page.tsx` needed — all state it needs already lives in this component). Mirrors `server-run-viewer.tsx`'s `LIVE_FIELDS`/`LIVE_FIELD_LABELS`/`IMMEDIATE_FIELDS`/`FUTURE_OFFSPRING_FIELDS`/`renderLiveField` shape and the "Takes effect immediately"/"Affects future offspring only" headings, but with no dirty-tracking (`dirtyFieldsRef`/`appliedValuesRef`/`syncLiveParams`) — there's no competing writer to diff against, so local panel state (`useState<LiveFormValues>`, seeded from the initial props) can write straight to the refs from (1) on Apply.

**Contract**: Reuse `LIVE_FIELDS`/`LIVE_FIELD_LABELS`/`IMMEDIATE_FIELDS`/`FUTURE_OFFSPRING_FIELDS` as local constants typed against `LiveAdjustableParams` (type-only import from `~/server/simulation/server-run-registry`, same as `server-run-viewer.tsx:26` already does). An `handleApplyLiveField(field, value)` handler: writes `value` into the matching ref, calls `checkLiveParamRangesSoft` (now from `parameter-ranges.ts`, Phase 1) against a single-field patch using ranges from `api.simulation.getParameterRanges.useQuery()` (falling back to `DEFAULT_PARAMETER_RANGES`, same pattern as `page.tsx:56-57`), stores the resulting warnings for display, and triggers the same `APPLY_COOLDOWN_MS`/`FLASH_DURATION_MS` flash/disable behavior `server-run-viewer.tsx:211-217` uses (copy the constants; 500ms/1000ms respectively, per this slice's own decision to keep UI consistency with the server-owned panel).

**Test setup note** (plan-review F1): `simulation-canvas.test.tsx`'s existing `vi.mock("~/trpc/react", ...)` (lines 13-29) defines only `api.simulation.stop.useMutation`. Rendering `SimulationCanvas` with this new panel added will call `api.simulation.getParameterRanges.useQuery()`, which doesn't exist on that mock and will throw. Extend the mock first: add a `getParameterRanges: { useQuery: () => ({ data: undefined }) }` stub to the same `api.simulation` object, before writing any of this phase's new tests.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — first extend the existing `vi.mock("~/trpc/react", ...)` with a `getParameterRanges.useQuery` stub (see Test setup note above), then add tests asserting: (a) changing a ref via the panel's Apply handler and calling `computeSingleRunTick` (or triggering a tick) reflects the new value; (b) an out-of-range value produces a warning matching `checkLiveParamRangesSoft`'s format; (c) the panel renders exactly 5 fields under the two expected headings, mirroring `server-run-viewer.test.tsx`'s equivalent assertions.
- Full suite passes: `npm test`

#### Manual Verification:

- Start a client-staged run; confirm the panel shows exactly 5 fields split under "Takes effect immediately" (food regen rate, protection threshold) and "Affects future offspring only" (energy threshold, mutation chance, mutation magnitude).
- Set `mutationMagnitude` to 0 via the panel mid-run; let at least one reproduction event occur; confirm the offspring's genes exactly match the blended-parent value with zero deviation — the same deterministic, behavior-level check S-31 used, not just that the UI accepted the input.
- Set `energyThreshold` far above any boid's current energy via the panel; confirm no further reproduction events occur for the remainder of the run.
- Set a value outside the admin-configured range; confirm the same warning text format `checkLiveParamRangesSoft` produces appears under that field.

## Phase 3: Changelog parity

### Overview

Persist live edits into the run's `history` so the analysis view's existing `ReferenceLine` overlay (already generic over `field`) renders them for a completed client-staged run, matching server-owned runs.

### Changes Required:

#### 1. Client-side changelog accumulator

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Record each applied live edit as it happens, mirroring `ParameterChangeEntry`'s shape and `applyLiveParams`'s append pattern (`server-run-registry.ts:195-201`), using the running tick count as `tick` (the same signal server-owned uses, sourced from `elapsedSecondsRef`/an internal tick counter already tracked in this component's tick loop).

**Contract**: Add `parameterChangesRef = useRef<ParameterChangeEntry[]>([])` (type imported from `~/server/simulation/server-run-registry`, type-only). The panel's Apply handler (Phase 2's `handleApplyLiveField`) pushes `{ tick: <current tick count>, field, oldValue: <ref's value before the write>, newValue: value }` onto this ref before updating the field's ref.

#### 2. `buildStopInput()` + `stop` procedure schema + history write

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/server/api/routers/simulation.ts`

**Intent**: Thread the accumulated changelog through to persistence, the same two-sided change S-27 made for the server-owned path (`server-run-registry.ts:230-252` ↔ `simulation.ts`'s `savePause`/finish writes), but for the client's one-shot `stop` call.

**Contract**: Add `parameterChanges: parameterChangesRef.current` to `buildStopInput()`'s returned object (`simulation-canvas.tsx:440-468`). Extend the `stop` procedure's zod input schema (`simulation.ts:361-422`) with `parameterChanges: z.array(z.object({ tick: z.number(), field: z.string(), oldValue: z.number(), newValue: z.number() })).max(50_000)` (no `.min()` — unlike the sibling sample arrays, an empty changelog is a legitimate case: the user may never have touched the panel). Add `parameterChanges: input.parameterChanges` to the `history` object the `stop` procedure writes (`simulation.ts:481-491`, alongside `phaseHistory`/`foodRatioSamples`/etc.).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — add a test confirming `buildStopInput()` includes `parameterChanges` with entries matching applied edits, and that it's `[]` when no edits were made.
- `npx vitest run src/server/api/routers/simulation.test.ts` — add a test confirming `stop` accepts and persists a `parameterChanges` array into `history`, and a test confirming `stop` still succeeds with `parameterChanges: []` (backward-compatible with a run that had no live edits).
- Full suite passes: `npm test`

#### Manual Verification:

- Run a client-staged simulation, apply at least one live edit via the panel, stop it, open its analysis view, and confirm the population chart shows a `ReferenceLine` at the correct tick labeled with the changed field's name — the same overlay shape S-27/S-31's server-owned runs already produce, now rendering for a client-staged run's own data for the first time.

## Performance Considerations

None — this reads/writes a handful of extra `useRef`s per tick (negligible) and persists one small array (`.max(50_000)`, same bound as every sibling sample array) once per run, at `stop` time only.

## Migration Notes

None — `parameterChanges` is a new optional key in a schema-less JSON `history` column; `getRunAnalysis`'s existing cast already treats it as optional, so older client-staged rows (predating this change) continue to read back with `parameterChanges: undefined`, which the analysis view's `history?.parameterChanges?.map(...)` already handles (renders no overlay lines, not a crash).

## References

- Research: `context/changes/client-staged-live-parameter-parity/research.md`
- Defect/precedent this mirrors: `context/archive/2026-11-15-live-parameter-adjustment/` (S-27), `context/archive/2026-11-15-correct-live-parameter-field-set/` (S-31)
- Live-adjust mechanism to pattern-match: `src/app/simulation/_components/server-run-viewer.tsx`
- Target file: `src/app/simulation/_components/simulation-canvas.tsx`
- Shared validation: `src/server/simulation/parameter-ranges.ts`
- Stop procedure: `src/server/api/routers/simulation.ts`
- Lesson applied: `context/foundation/lessons.md` — "UI accepts input is not feature verified" (every Manual Verification item above targets an observed behavior change, not just a UI/API acceptance check)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared validation extraction

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — b7d65e5
- [x] 1.2 Linting passes: `npm run check` — b7d65e5
- [x] 1.3 `npx vitest run src/server/api/routers/simulation.test.ts` — b7d65e5
- [x] 1.4 Full suite passes: `npm test` — b7d65e5

### Phase 2: Client-staged live-adjust mechanism

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx`
- [x] 2.4 Full suite passes: `npm test`

#### Manual

- [x] 2.5 Panel shows 5 fields under 2 correctly-grouped headings
- [x] 2.6 mutationMagnitude=0 produces zero-deviation offspring genes
- [x] 2.7 High energyThreshold stops further reproduction
- [x] 2.8 Out-of-range value shows the expected warning text

### Phase 3: Changelog parity

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx`
- [ ] 3.4 `npx vitest run src/server/api/routers/simulation.test.ts`
- [ ] 3.5 Full suite passes: `npm test`

#### Manual

- [ ] 3.6 Analysis view's ReferenceLine overlay renders a client-staged run's live edits
