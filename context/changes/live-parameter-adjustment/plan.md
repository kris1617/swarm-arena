# Implementation Plan: Live-adjust flocking weights and food/threshold on a running simulation

## Overview

Today, once a server-owned simulation starts, its parameters (`LiveRun.params` in `src/server/simulation/server-run-registry.ts`) are frozen until it stops — tuning means stop, reconfigure, and restart, losing the run in progress. This plan lets the user change a running run's separation/alignment/cohesion weights, food regen rate, and protection threshold while it ticks, see the effect on the very next tick, and later see exactly when/what was changed on that run's completed analysis page.

All product decisions below were resolved via a three-round user interview (2026-11-15) and are fixed, not open for re-litigation during implementation:

1. **Validation**: soft — a live edit can exceed the admin-configured ranges (`admin_settings.parameterRanges`); the mutation still applies it, but returns a warning per out-of-range field instead of rejecting the edit.
2. **History**: each applied batch of edits is appended as a changelog entry to the run's persisted `history` — not a silent runtime-only tweak.
3. **UI surface**: an inline panel on the live-view page (`ServerRunViewer`), not a separate modal/drawer.
4. **DB sync**: `simulationRuns`'s existing columns stay as the run's *initial* configuration, untouched by live edits — the changelog (decision 2) is what tracks changes, not a column overwrite.
5. **Edit granularity**: batch — the user edits any subset of the 5 fields, then clicks one "Apply" button that sends them as a single patch (one mutation call, one changelog entry per apply).
6. **Rate limiting**: a 500ms client-side cooldown on the Apply button after each successful apply — no server-side throttle (single-user app, no real abuse surface).
7. **Feedback**: a brief inline success flash on the panel after a successful apply (not a toast, not silent).
8. **Run-state edge case**: no special-casing — the mutation applies as long as the run is still in the registry (same check `savePause`/`stop` already perform), exactly like every other run-targeting mutation in this router.
9. **Analysis-view display**: the changelog is displayed now, not deferred — as `ReferenceLine` markers overlaid on the existing population-over-time chart, at each change's tick, with a hover tooltip.

## Current State Analysis

- `LiveRun` (`src/server/simulation/server-run-registry.ts:56-73`) holds `params: ServerRunParams` set once at construction (`startServerRun`, L292-307; `resumeServerRun`, L413-437) and only ever read inside `tick()` (L169-247) via `run.params.*`. No mutator exists. Because the registry's `Map<number, LiveRun>` lives in module state and every mutation runs synchronously in Node's single-threaded event loop, a plain `run.params = {...run.params, ...patch}` assignment cannot interleave with a `tick()` callback mid-write — there is no real data race to guard against, only a discipline rule (don't `await` anything between reading and applying the patch).
- All 5 target fields (`separationWeight`, `alignmentWeight`, `cohesionWeight`, `foodRegenRate`, `protectionThreshold`) are already in `RANGED_PARAMETER_NAMES` (`src/server/simulation/parameter-ranges.ts:6-24`) with admin-configured `{min, max, default}` ranges. `checkAgainstAdminRanges` (`simulation.ts:150-171`) is the existing throwing validator, but it expects the *full* `startInputSchema` shape and always throws — not reusable as-is for a partial, non-blocking patch. A new, soft-warning helper is needed (see Phase 1, item 1).
- `simulation.ts`'s mutation pattern for a run-targeting action (`savePause`, L866-923) is: fetch the row, check `run.userId !== ctx.session.user.id` → `FORBIDDEN`, check `run.status !== "running" || !isServerRunActive(runId)` → `BAD_REQUEST`, then act. The new mutation follows this exactly, with no DB row update needed (the registry mutation is in-memory; persistence happens later via the existing `finishRun`/`stopServerRun` write path).
- The `watch` subscription's pushed payload (`LiveRunSnapshot`, `server-run-registry.ts:89-107`, consumed by `ServerRunViewer` at `src/app/simulation/_components/server-run-viewer.tsx:142-159`) currently carries only `boids`/`predators`/`elapsedSeconds`/`populationCapped` — no parameter values. The edit panel needs current values to pre-fill from, so `LiveRunSnapshot` gains a `liveParams` field carrying just the 5 live-adjustable fields (not the full `ServerRunParams` — `boidCount`/`xyArea`/etc. are immutable for the run and already known to the caller via `listRunning`).
- `ServerRunViewer` (`server-run-viewer.tsx`) is a `max-w-xs` canvas-focused client component. It has no existing form; the panel is new UI, following this component's existing inline `Button`/`Switch` styling conventions (L176-182, L198-214).
- `finishRun` (`server-run-registry.ts:113-167`) and `stopServerRun` (L317-342) both build a `history` object persisted to `simulationRuns.history` (a schema-less JSON `TEXT` column, per `schema.ts`). Neither currently has a parameter-changelog field — this plan adds one, following the exact pattern `populationDensitySamples` (S-25) established: a new `LiveRun` field, seeded `[]` in `startServerRun`, carried through `ServerRunSnapshot`/`snapshotServerRun`/`resumeServerRun` (L346-439), and included in both `history`-building sites. Unlike the per-tick sample arrays, this changelog is NOT threaded through `single-run-lifecycle.ts`/`computeSingleRunTick` — it's an edit log, not a per-tick computed sample, and only ever grows when the new mutation calls the new mutator, never during a normal tick.
- Each changelog entry's `tick` field uses `run.populationCountSamples.length` at the moment of the edit — the same index basis `src/app/runs/[runId]/page.tsx`'s `chartData` already uses (`populationSamples.map((population, tick) => ...)`, L75-79), so a changelog entry's `tick` lines up directly with the existing chart's x-axis with no unit conversion.
- `getRunAnalysis` (`simulation.ts:682-750`) does a guarded, optional-field cast of the schema-less `history` column (L705-722: required fields `phaseHistory`/`survivorGenes` gate the whole cast; `populationCountSamples` is already optional for backward compatibility) and returns `history` wholesale (L734) — the exact precedent for adding one more optional field (`parameterChanges`) without an all-or-nothing rewrite.
- `src/app/runs/[runId]/page.tsx`'s population chart (L131-152) is a recharts `LineChart` keyed by `tick` (L135-147), importing `CartesianGrid`/`Line`/`LineChart`/`ResponsiveContainer`/`Tooltip`/`XAxis`/`YAxis` from `recharts` (L5-13) — `ReferenceLine` is the same library, a straightforward import addition, not a new charting dependency.
- No test file exists for `src/app/runs/[runId]/page.tsx` (confirmed: no matching `*.test.*` under `src/app/runs/`) — this plan does not introduce one; the chart overlay's correctness is covered by `getRunAnalysis`'s backend test plus a manual browser check, consistent with how this page's existing charts have no component-level test today.

## What We're NOT Doing

- Not extending live adjustment to the client-staged execution path — `simulation-canvas.tsx`'s tick-loop effect deliberately closes over its parameter props as fixed for the run's lifetime (its own inline comment states this); undoing that is a materially larger structural change, explicitly parked in the roadmap.
- Not making population-shape parameters (`boidCount`, `flockCount`, `crossbreedingEnabled`) live-adjustable — these require re-initializing the population/world state, not a simple param patch; explicitly parked in the roadmap.
- Not updating `simulationRuns`'s persisted config columns (`separationWeight`, `foodRegenRate`, etc.) on a live edit — they remain the run's *initial* configuration; the changelog is the record of what changed (decision 4).
- Not adding server-side rate limiting on the new mutation — only a 500ms client-side Apply-button cooldown (decision 6); this is a single-hobbyist-user app with no abuse surface to defend against.
- Not blocking edits near the run's natural stop condition — no threshold logic, no population-wipe prediction (decision 8).
- Not adding a new DB migration — `simulationRuns.history` is already a schema-less JSON column; the changelog is a new key within it, following the exact precedent S-25's `populationDensitySamples` set.
- Not touching `admin_settings.parameterRanges` itself or its admin-facing editor UI — the new mutation only *reads* the existing ranges to compute warnings.

## Implementation Approach

Mirror `populationDensitySamples`'s exact threading pattern for the new changelog array (seed in `startServerRun`, carry through snapshot/resume, include in both `history`-building sites), add one new mutator function and one new tRPC mutation reusing the existing ownership/active-run check pattern, extend the `watch` subscription's pushed snapshot with current param values, add an inline batch-edit panel to `ServerRunViewer`, and extend the analysis page's existing chart with `ReferenceLine` markers — no new abstractions, no schema migration, no new library.

### Changes Required:

## Phase 1: Backend — mutator, mutation, and changelog persistence

### 1. Soft range-check helper and changelog type

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Add the changelog entry type and a soft (non-throwing) range-check helper, distinct from `simulation.ts`'s throwing `checkAgainstAdminRanges` — this one returns warnings instead of rejecting.

**Contract**:
- Add a type (near `ServerRunParams`):
  ```ts
  export type LiveAdjustableParams = Pick<
    ServerRunParams,
    "separationWeight" | "alignmentWeight" | "cohesionWeight" | "foodRegenRate" | "protectionThreshold"
  >;
  export type LiveParamPatch = Partial<LiveAdjustableParams>;
  export type ParameterChangeEntry = {
    tick: number;
    field: keyof LiveAdjustableParams;
    oldValue: number;
    newValue: number;
  };
  ```
- Add `parameterChanges: ParameterChangeEntry[]` to `LiveRun` (alongside the other sample arrays, L56-73).

### 2. `applyLiveParams` mutator

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The single place that patches a running `LiveRun.params` and appends changelog entries — exported so the new tRPC mutation can call it, and so tests can call it directly (same testable-core pattern `watchServerRun`'s docstring already explains for this file).

**Contract**:
```ts
export function applyLiveParams(runId: number, patch: LiveParamPatch): boolean {
  const run = registry.get(runId);
  if (!run) {
    return false;
  }
  const tick = run.populationCountSamples.length;
  for (const [field, newValue] of Object.entries(patch) as [keyof LiveAdjustableParams, number][]) {
    run.parameterChanges.push({ tick, field, oldValue: run.params[field], newValue });
  }
  run.params = { ...run.params, ...patch };
  return true;
}
```
Entirely synchronous (per Current State Analysis's race-safety note) — no `await` between reading `run.params[field]` and the final reassignment.

### 3. Thread `parameterChanges` through the rest of the registry

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Mirror every existing `populationDensitySamples` touch point so the changelog survives snapshot/resume and lands in persisted `history`.

**Contract**:
- `startServerRun` (L292-307): seed `parameterChanges: []` in the new `LiveRun` object.
- `finishRun`'s `outcome.history` type (L119-134) and its two call sites (`tick()`'s `shouldStop` branch, L228-238; `stopServerRun`, L331-341): add `parameterChanges: run.parameterChanges` to both `history` objects being persisted.
- `ServerRunSnapshot` type (L346-360): add `parameterChanges: ParameterChangeEntry[]`.
- `snapshotServerRun` (L366-390): add `parameterChanges: run.parameterChanges` to the returned snapshot.
- `resumeServerRun` (L396-439): add `parameterChanges: snapshot.parameterChanges ?? []` to the reconstructed `LiveRun` — the `?? []` fallback is required per the exact lesson `populationDensitySamples` already recorded at this same call site (a `savedState` row from before this field existed has no such key; omitting the fallback would crash the resumed run's next tick that reads this array, the same class of bug impl-review caught and fixed for S-25).

### 4. `LiveRunSnapshot`: expose current live-adjustable values

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The live-view panel needs to know the run's *current* values to pre-fill from — not the DB's "started with" columns, which never change.

**Contract**: Add `liveParams: LiveAdjustableParams` to the `LiveRunSnapshot` type (L89-94) and to `getLiveRunState`'s returned object (L96-107), reading the 5 fields off `run.params`.

### 5. `updateRunParams` tRPC mutation

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Validate ownership/active-run state exactly like `savePause`, soft-check the patch against admin ranges, apply it, and return any warnings.

**Contract**:
- Add a soft range-check helper near `checkAgainstAdminRanges` (L150-171):
  ```ts
  function checkLiveParamRangesSoft(
    patch: LiveParamPatch,
    ranges: ParameterRanges,
  ): string[] {
    const warnings: string[] = [];
    for (const [field, value] of Object.entries(patch) as [RangedParameterName, number][]) {
      const range = ranges[field];
      if (value < range.min || value > range.max) {
        warnings.push(
          `${field} (${value}) is outside the configured range ${range.min}-${range.max}`,
        );
      }
    }
    return warnings;
  }
  ```
- Add the mutation (placed near `savePause`, L866):
  ```ts
  updateRunParams: protectedProcedure
    .input(
      z.object({
        runId: z.number(),
        separationWeight: z.number().finite().optional(),
        alignmentWeight: z.number().finite().optional(),
        cohesionWeight: z.number().finite().optional(),
        foodRegenRate: z.number().finite().nonnegative().optional(),
        protectionThreshold: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { runId, ...patch } = input;
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }
      const run = await ctx.db.query.simulationRuns.findFirst({
        where: (t, { eq: eqFn }) => eqFn(t.id, runId),
      });
      if (!run) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      if (run.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (run.status !== "running" || !isServerRunActive(runId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run is not an active server-run simulation",
        });
      }
      const { parameterRanges } = await getOrSeedAdminSettings(ctx.db);
      const warnings = checkLiveParamRangesSoft(patch, parameterRanges);
      const applied = applyLiveParams(runId, patch);
      if (!applied) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run is no longer active",
        });
      }
      return { ok: true, warnings };
    }),
  ```
  Import `applyLiveParams` and `LiveParamPatch` from `~/server/simulation/server-run-registry` alongside this file's existing imports from that module.

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/simulation/server-run-registry.test.ts` — new tests: `applyLiveParams` patches `run.params` and appends a changelog entry with the correct `tick`/`field`/`oldValue`/`newValue`; `applyLiveParams` returns `false` for an unregistered `runId`; `parameterChanges` survives a snapshot/resume round-trip; `parameterChanges` is present in `history` on both natural completion and manual stop; a legacy-shaped snapshot missing `parameterChanges` does not crash `resumeServerRun` (mirrors the existing `populationDensitySamples` regression test).
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — new `updateRunParams` tests: applies a valid patch and returns `{ok: true, warnings: []}`; returns a non-empty `warnings` array (without rejecting) for a value outside the admin range; rejects with `FORBIDDEN` for a non-owner; rejects with `BAD_REQUEST` for a run that is saved/stopped or not server-owned; rejects with `BAD_REQUEST` for an empty patch.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Start a server-owned run, call `updateRunParams` directly (e.g. via a scratch script against the real tRPC caller) with a value outside the admin range, confirm the mutation succeeds with a warning and the live run's behavior reflects the new value on its next tick.

## Phase 2: Frontend — inline live-edit panel

### 1. Live-edit form in `ServerRunViewer`

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: A batch-edit panel for the 5 live-adjustable fields, pre-filled from the subscription's pushed `liveParams`, applying as one patch on an "Apply" button with a 500ms cooldown, an inline success flash, and inline range-exceeded warnings. This is a new form pattern for the codebase — the only existing multi-field editable form (`src/app/admin/settings/_components/admin-settings-form.tsx`) syncs from a query and submits everything as one snapshot with no dirty-tracking, cooldown, or flash; there is no existing precedent here for a form that must avoid a streaming data source (the 150ms subscription push) clobbering an in-progress edit, so don't look for an existing analog to copy.

**Contract**:
- Local form state (one number per field) initialized from the first subscription push's `data.liveParams` and re-synced only when the field is not currently being edited (dirty-tracking per field) — editing a field must not be overwritten mid-edit by the next 150ms push.
- An "Apply" button calls `api.simulation.updateRunParams.useMutation(...)` with only the fields whose local value differs from the last-applied value (the batch patch); disabled for 500ms after a successful apply (the decided cooldown).
- On success: briefly flash each changed field (e.g. a colored border for ~1s) and render any returned `warnings` inline near the relevant field.
- On error (e.g. `FORBIDDEN`/network failure): surface the error the same way this component already surfaces `watch`'s subscription errors (`viewError` state, L47/155-157) — reuse that pattern rather than inventing a second error-display mechanism.
- Follows this file's existing inline styling conventions (the `Button`/`Switch` classes already in use, L176-182/198-214) — a thin wrapper using `src/components/ui/number-field.tsx` for each input's token/focus-visible styling, per this repo's established "hand-copied label+Input block is a missing-shared-component signal" rule (AGENTS.md).

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — updated/new tests: the panel pre-fills from the subscription's first pushed `liveParams`; clicking Apply calls `updateRunParams` with only the changed fields; the Apply button is disabled for the cooldown window after a successful apply; a field being actively edited is not overwritten by a subsequent subscription push.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Start a server-owned run, open its live view, confirm the panel shows the run's current values.
- [ ] Change one or more fields and click Apply; confirm the live view's behavior visibly changes (e.g. a higher separation weight visibly spreads the flock) within roughly one tick, and the edited field(s) briefly flash success.
- [ ] Enter a value outside the admin-configured range, click Apply, confirm the edit still applies (not rejected) and a warning renders inline.
- [ ] Click Apply twice in quick succession, confirm the second click is a no-op (button disabled) until the cooldown elapses.

## Phase 3: Analysis view — changelog overlay on the population chart

### 1. `getRunAnalysis`: return the persisted changelog

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Surface `parameterChanges` to the analysis page, following the exact optional-field precedent `populationCountSamples` already set in this same guarded cast.

**Contract**: Widen the `rawHistory` cast (L705-710) to include `parameterChanges?: { tick: number; field: string; oldValue: number; newValue: number }[]`; the returned `history` object (L734) already spreads the whole cast object, so no further change is needed there — `history.parameterChanges` will simply be present when the row has it.

### 2. Analysis page: `ReferenceLine` markers

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Mark each parameter change's tick on the existing population-over-time chart with a hover tooltip naming what changed.

**Contract**:
- Import `ReferenceLine` from `recharts` alongside the existing imports (L5-13).
- Inside the `LineChart` (L135-147), after the existing `<Line>`, render one `<ReferenceLine>` per `history?.parameterChanges` entry: `x={entry.tick}`, a short `label` (e.g. the field's short name), and a `stroke` distinct from the population line's `var(--chart-5)` (reuse the `PHASE_COLORS` token family's otherwise-unused slot, or a fixed neutral token — implementer's call, must be visually distinct from the line and from phase-dot colors).
- Render nothing extra when `history?.parameterChanges` is absent or empty (old rows, or a run with no live edits) — no empty-state message needed here, the chart already renders fine without markers.

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — new `getRunAnalysis` test: a run with `parameterChanges` in its persisted history returns them verbatim; a run without the key (old row) returns `history` with `parameterChanges` absent/undefined, no crash.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Complete a server-owned run that had at least one live parameter edit applied during Phase 2's manual check; open its analysis page; confirm a `ReferenceLine` marker appears at the correct tick on the population chart, with a hover tooltip naming the changed field and its old/new values.
- [ ] Open the analysis page for a run completed before this change (no `parameterChanges` in its history); confirm the chart renders exactly as before, with no markers and no error.

## Performance Considerations

`parameterChanges` is a small, edit-triggered array (grows only on a user action, not per-tick) — negligible compared to the existing per-tick sample arrays already tracked per run. `LiveRunSnapshot`'s new `liveParams` field adds 5 numbers to a payload already pushed every 150ms (`WATCH_INTERVAL_MS`) — no meaningful size increase.

## Migration Notes

None — `simulationRuns.history` is a schema-less JSON `TEXT` column; `parameterChanges` is a new optional key within it, following the exact precedent `populationDensitySamples` (S-25) and `populationCountSamples` (S-11) already set. Runs completed before this change simply lack the key, which `getRunAnalysis`'s optional-field cast and the analysis page's empty-marker-list handling both already account for.

## References

- Roadmap: `context/foundation/roadmap.md` S-27 (`live-parameter-adjustment`), M-5
- Precedent for threading a new per-run array through the registry: S-25's `populationDensitySamples` (`context/archive/2026-11-15-area-aware-population-insight/plan.md`) — including its impl-review-caught `?? []` resume-fallback lesson, applied proactively here
- Change notes: `context/changes/live-parameter-adjustment/change.md`
- Registry: `src/server/simulation/server-run-registry.ts`
- Router: `src/server/api/routers/simulation.ts`
- Live-view UI: `src/app/simulation/_components/server-run-viewer.tsx`
- Analysis view: `src/app/runs/[runId]/page.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — mutator, mutation, and changelog persistence

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 `npx vitest run src/server/simulation/server-run-registry.test.ts`
- [x] 1.4 `npx vitest run src/server/api/routers/simulation.test.ts`
- [x] 1.5 Full suite passes: `npm test`

#### Manual

- [ ] 1.6 Out-of-range live patch applies with a warning and affects the next tick

### Phase 2: Frontend — inline live-edit panel

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx`
- [ ] 2.4 Full suite passes: `npm test`

#### Manual

- [ ] 2.5 Panel pre-fills current values from the live view
- [ ] 2.6 Applying a change visibly affects the running simulation within one tick, with a success flash
- [ ] 2.7 Out-of-range value applies with an inline warning, not a rejection
- [ ] 2.8 Apply button is disabled during the cooldown window

### Phase 3: Analysis view — changelog overlay on the population chart

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/server/api/routers/simulation.test.ts`
- [ ] 3.4 Full suite passes: `npm test`

#### Manual

- [ ] 3.5 Completed run with a live edit shows a correctly-placed, correctly-labeled marker
- [ ] 3.6 Completed run predating this change renders unchanged, no markers, no error
