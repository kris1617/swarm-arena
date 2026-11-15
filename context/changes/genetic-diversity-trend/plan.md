# Genetic-diversity trend over time Implementation Plan

## Overview

Add a per-tick genetic-diversity sample series to both execution paths (server-owned and client-staged), persist it in the run's existing schema-less `history` JSON blob, and render it as a new, separate chart in the analysis view below the existing population-over-time chart — reversing the PRD's "No diversity-index trend over time" Non-Goal per its own revisit clause.

## Current State Analysis

- `computeGeneticDiversity(genes: BoidGenes[]): number` (`src/server/simulation/boids.ts:1266`) already takes exactly the input shape a per-tick call needs — `boids.map(b => b.genes)` — but is currently only called at run-end/read-time: twice inside `server-run-registry.ts`'s two finishing paths (`tick()`'s stop branch at line 484, and the second finishing path at line 590), and twice more in `simulation.ts`'s read-time analysis/comparison routers (`getRunAnalysis` at line 846-848, `getRunsComparison` at line 937-939) — recomputed from persisted `survivorGenes`, never itself persisted as its own value.
- The per-tick sample-array pattern this mirrors exactly already exists **four** times, not three: `cohesionSamples`/`foodRatioSamples`/`populationCountSamples`/`populationDensitySamples`, appended inside `computeSingleRunTick` (`src/server/simulation/single-run-lifecycle.ts:118-140`) and returned in the tick result object (lines 158-169). A fifth, `geneticDiversitySamples`, follows the identical shape: one computed value, one array append, one field on the return object.
- Threading an existing sample array through the server-owned path has **three** sites, not two — plan-review (F1) caught that the original draft missed the third: `LiveRun` type fields (`server-run-registry.ts:88-93`) → passed into `computeSingleRunTick` (lines 436-444) → written back from the tick result (lines 471-474) → persisted into `finishRun`'s `history` object at both finishing paths (lines 490-495 and ~598-601, with an empty-array initializer at run start, ~line 559); **and** `ServerRunSnapshot`'s type (line 610-625), `snapshotServerRun`'s return (line 640-655), and `resumeServerRun`'s reconstruction (line 662-705+) — the pause/resume path, which carries every other per-tick sample array through with a `?? []` backward-compat fallback (e.g. `populationDensitySamples` at line 697, `parameterChanges` at line 698-704) and must do the same here or repeat the exact crash-on-resume bug `lessons.md` documents for S-25.
- The **client-staged path never touches `server-run-registry.ts` at all** — plan-review (F2) caught that the original draft only covered the server-owned path despite the Overview claiming both. `computeSingleRunTick` has exactly 2 real callers (`server-run-registry.ts:436`, `simulation-canvas.tsx:788`); the client-staged path maintains its own independent `useRef`-based sample arrays (`cohesionSamplesRef`/`foodRatioSamplesRef`/`populationCountSamplesRef`/`populationDensitySamplesRef`, `simulation-canvas.tsx:376-384`) and sends them directly in the `stop` mutation's input (`simulation.ts:419-472`, each bounded `.max(50_000)` per the S-27 unbounded-changelog lesson), built into that router's own history object (~lines 552-555) — a structurally separate path requiring its own fifth ref and its own schema field.
- `history` is a single schema-less `d.text({ mode: "json" })` column (`src/server/db/schema.ts:150`) — no migration needed; this is the exact path `populationCountSamples`/`populationDensitySamples` themselves used to get added incrementally.
- Read-back: `simulation.ts:807-818`'s `rawHistory` cast already guards older rows with `populationCountSamples?: number[]` (optional, for rows persisted before that field existed) — a new `geneticDiversitySamples?: number[]` follows the same guard, returned as part of `history` at line 842.
- Client read: `src/app/runs/[runId]/page.tsx:75` reads `history?.populationCountSamples` into `populationSamples`, zipped with `tick`/`phase` into `chartData` at lines 76-80; the existing chart (lines 132-167) is a single Recharts `LineChart` with one `Line dataKey="population"` (stroke `var(--chart-5)`, phase-colored dots) plus `ReferenceLine`s for live-parameter-change events.
- The single final genetic-diversity value is computed read-time (not stored) at `simulation.ts:846-848` and displayed as plain text at `page.tsx:208-211` ("Final genetic diversity", `.toFixed(3)`) — this stays untouched; the new trend chart is additive, not a replacement.
- All 5 of this page's `--chart-1`..`--chart-5` tokens are already in use: `--chart-1`..`--chart-4` as phase-dot colors (establishment/growth/overshoot/crash), `--chart-5` for both the "recovery" phase dot and the population line's own stroke (`page.tsx:24-28,145`). The new diversity chart is a separate `LineChart`, so reusing a token already in use elsewhere on the page is fine (different chart, no adjacency) — `--chart-1` is used for the new line's stroke, visually distinct from the population chart's `--chart-5`.

## Desired End State

A completed run's analysis view shows two charts: the existing population-over-time chart, and a new genetic-diversity-over-time chart directly below it, both built from the same per-tick `tick` index. A run persisted before this change (lacking `geneticDiversitySamples` in its `history`) shows the population chart as before and simply omits the new diversity chart — no crash, no empty placeholder claiming data that doesn't exist.

### Key Discoveries:

- Because the new sample array is a genuine per-tick value (unlike the final-value-only `computeGeneticDiversity` calls that already exist), adding it costs one extra O(n) computation per tick — negligible at this engine's population caps, same order as the per-tick `resolveOverlaps` pass already running.
- The decision to render as a **separate chart below** (not sharing the population chart's Y-axis) means no dual-axis Recharts configuration is needed — the new chart is a second, independent `ResponsiveContainer`/`LineChart`, structurally a sibling of the existing one, not a modification to it.

## What We're NOT Doing

- Not changing how the single final genetic-diversity value is computed, stored, or displayed (`simulation.ts:846-848`, `page.tsx:208-211`) — this slice is purely additive.
- Not retroactively backfilling `geneticDiversitySamples` for already-persisted runs — exactly like `populationCountSamples`/`populationDensitySamples` before it, the new series only exists for runs that complete after this ships; older rows degrade gracefully (chart omitted, not an error).
- Not sharing a Y-axis between the population and diversity series, and not building a combined/dual-axis chart — a separate chart was the explicit decision for this slice.
- Not touching `getRunsComparison`'s diversity handling (`simulation.ts:937-939`) — comparison view scope is unchanged; this slice is the single-run analysis view only.

## Implementation Approach

Three phases, mirroring the shape of prior similar slices: (1) the shared per-tick sample mechanism and persistence across both finishing paths, (2) the router's read-back guard, (3) the analysis-view chart. Each phase is independently testable and committable.

## Phase 1: Per-tick sample mechanism and persistence

### Overview

Compute and persist a `geneticDiversitySamples` array alongside the existing per-tick sample arrays, on **both** execution paths — including the server-owned path's pause/resume snapshot, which plan-review (F1) caught as initially missing.

### Changes Required:

#### 1. Per-tick append in `computeSingleRunTick`

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Compute one genetic-diversity value per tick from the current boid population's genes, appending it the same way `populationCountSamples` etc. already do.

**Contract**: Alongside the existing `nextFoodRatioSamples`/`nextPopulationCountSamples`/`nextPopulationDensitySamples` computations (lines 118-140), add `nextGeneticDiversitySamples = [...state.geneticDiversitySamples, computeGeneticDiversity(nextBoids.map((b) => b.genes))]`, using the same `nextBoids` array the other per-tick computations already read. Add the new field to the function's input/output types and the returned result object (alongside lines 158-169), following the exact naming/shape convention the other three samples use.

#### 2. Thread through `LiveRun` and `tick()`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Carry the new sample array through the registry's live-run state and both tick read/write-back sites, exactly like the other three sample arrays.

**Contract**: Add `geneticDiversitySamples: number[]` to the `LiveRun` type (alongside lines 89-93), initialize it to `[]` at run start (alongside the other arrays' initializers, ~line 560), pass it into `computeSingleRunTick` (alongside lines 442-444), and write the result back (alongside lines 472-474).

#### 3. Persist into both finishing paths

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Include the new sample array in the `history` object both finishing paths build, so it lands in the DB's schema-less JSON blob.

**Contract**: Add `geneticDiversitySamples` to the `history` object literal at both finishing-path sites (lines 490-498 and ~598-601), alongside `populationCountSamples`/`populationDensitySamples`.

#### 4. Pause/resume snapshot path (plan-review F1)

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: A paused-then-resumed server-owned run must carry the new sample array through exactly like `populationDensitySamples` and `parameterChanges` already do — otherwise `resumeServerRun` reconstructs a `LiveRun` whose `geneticDiversitySamples` is `undefined`, and the next tick's array-spread throws, silently killing the resumed run (the exact bug `lessons.md` documents for S-25's `populationDensitySamples` miss).

**Contract**: Add `geneticDiversitySamples: number[]` to `ServerRunSnapshot` (alongside line 619), include it in `snapshotServerRun`'s return object (alongside line 649), and reconstruct it in `resumeServerRun` with the same backward-compatible fallback the two existing fields use: `geneticDiversitySamples: snapshot.geneticDiversitySamples ?? []` (alongside line 697), with the same explanatory comment pattern (a `savedState` row written before this field existed has no such key despite the type's claim).

#### 5. Client-staged path (plan-review F2)

**File**: `src/app/simulation/_components/simulation-canvas.tsx`, `src/server/api/routers/simulation.ts`

**Intent**: The client-staged path never calls into `server-run-registry.ts` — it maintains its own ref-based sample arrays and sends them directly in the `stop` mutation's payload. Without this, a client-staged run's history would never include `geneticDiversitySamples` at all, and Phase 3's chart would silently never show for any client-staged run.

**Contract**: In `simulation-canvas.tsx`, add `geneticDiversitySamplesRef` alongside the existing 4 sample refs (`cohesionSamplesRef`/`foodRatioSamplesRef`/`populationCountSamplesRef`/`populationDensitySamplesRef`, lines 376-384), append to it per tick from `computeSingleRunTick`'s result (alongside lines 793-796/819-820), and include it in the `stop` mutation's payload (alongside lines 705-726, same `.length > 0 ? ref.current : undefined` guard the others use). In `simulation.ts`'s `stop` input schema, add `geneticDiversitySamples: z.array(z.number().min(0).max(1)).min(1).max(50_000).optional()` (alongside line 472's `populationDensitySamples`, same bounded-array shape per the S-27 unbounded-changelog lesson), and include it in the history object built at that router's own history-building site (alongside lines 552-555).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/single-run-lifecycle.test.ts` — add a test confirming `computeSingleRunTick` appends exactly one new value to `geneticDiversitySamples` per call, computed from the tick's resulting boid genes (assert the value matches `computeGeneticDiversity` called directly on the same genes array — this is acceptable here since it's testing that two call sites agree on the shared pure function, not mirroring a sort/comparison implementation the way a vibe-test would).
- `npx vitest run src/server/simulation/server-run-registry.test.ts` — add tests confirming: (a) a completed run's persisted `history.geneticDiversitySamples` has one entry per tick and matches the live `LiveRun.geneticDiversitySamples` array at the point of finishing; (b) a snapshot-then-resume round trip (`snapshotServerRun` → `resumeServerRun`) carries `geneticDiversitySamples` through correctly; (c) `resumeServerRun` on a snapshot object missing the `geneticDiversitySamples` key entirely (simulating a pre-existing `savedState` row) does not throw and defaults to `[]`, and a subsequent tick succeeds rather than crashing.
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — add a test confirming the client-staged path's `stop` payload includes a `geneticDiversitySamples` array sourced from `computeSingleRunTick`'s results, mirroring the existing test for one of the other 4 sample refs.
- `npx vitest run src/server/api/routers/simulation.test.ts` — add a test confirming `stop`'s input schema accepts `geneticDiversitySamples` and persists it into the client-staged run's `history`.
- Full suite passes: `npm test`

#### Manual Verification:

- None for this phase in isolation — the new sample array has no reader yet; manual verification happens in Phase 3 once the chart is wired end-to-end.

## Phase 2: Router read-back guard

### Overview

Expose the new sample array to the client through `getRunAnalysis`'s existing backward-compatible cast.

### Changes Required:

#### 1. Optional field on the guarded cast

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Let `getRunAnalysis` return the new series for runs that have it, while runs persisted before this change simply have `undefined` here — the same backward-compatibility shape `populationCountSamples?` already established.

**Contract**: Add `geneticDiversitySamples?: number[]` to the `rawHistory` cast's type (alongside line 811's `populationCountSamples?: number[]`), and ensure it is included in the returned `history` object at line 842 alongside the other sample arrays (no transformation — passed through as-is).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/api/routers/simulation.test.ts` — add tests confirming: (a) `getRunAnalysis` returns `geneticDiversitySamples` for a run whose persisted `history` includes it; (b) `getRunAnalysis` returns `geneticDiversitySamples: undefined` (not a throw) for a run whose persisted `history` predates this field, mirroring the existing `populationCountSamples` backward-compat test if one exists.
- Full suite passes: `npm test`

#### Manual Verification:

- None for this phase in isolation — manual verification happens in Phase 3 once the UI reads this field.

## Phase 3: Analysis-view chart

### Overview

Render a new, separate Recharts `LineChart` for the genetic-diversity trend, directly below the existing population chart, degrading gracefully when the series is absent.

### Changes Required:

#### 1. Diversity chart data (extracted, testable)

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: The existing population chart builds its `chartData` inline in the component (lines 76-80), untested — this file has no test coverage at all today. Rather than add component-level test infrastructure (mocked `useParams`/tRPC query) this phase doesn't otherwise need, extract just the new chart's data-building into a small exported pure function so it's unit-testable without rendering.

**Contract**: Add an exported function `export function buildDiversityChartData(samples: number[] | undefined): { tick: number; diversity: number }[] | undefined` — returns `undefined` when `samples` is `undefined` (degrade gracefully for older runs), otherwise `samples.map((diversity, tick) => ({ tick, diversity }))`. Call it in the component as `const diversityChartData = buildDiversityChartData(history?.geneticDiversitySamples);`.

#### 2. Diversity chart JSX

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Render the new chart as a separate `LineChart`, directly below the existing population chart, only when data exists.

**Contract**: Directly below the existing population chart's closing tag (after line 162), conditionally render (`{diversityChartData ? (...) : null}`) a heading ("Genetic diversity over time", mirroring the population chart's own heading pattern) followed by a `ResponsiveContainer` (same height/width as the population chart) → `LineChart data={diversityChartData}` → `CartesianGrid` + `XAxis dataKey="tick"` + `YAxis domain={[0, 1]}` + `Tooltip` + a single `Line dataKey="diversity"` with `stroke="var(--chart-1)"` — no phase-colored dots (the phase model doesn't apply meaningfully to a diversity value the way it does to population), no `ReferenceLine` overlays (those are specific to the population chart's parameter-change annotations).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/runs/[runId]/page.test.ts` (new file — this page has no existing test coverage) — test `buildDiversityChartData` directly, no component rendering: (a) given a `number[]`, returns the tick-zipped array; (b) given `undefined`, returns `undefined`.
- Full suite passes: `npm test`

#### Manual Verification:

- Complete a run (server-owned or client-staged) after this change ships; open its analysis view; confirm a new "Genetic diversity over time" chart renders below the population chart, with a visibly varying line (not flat) reflecting the run's actual diversity trajectory — the behavior-level check, not just that a chart element exists.
- Open the analysis view for a run completed *before* this change shipped; confirm the page still renders correctly with no new chart and no console error.

## Performance Considerations

One extra O(n) `computeGeneticDiversity` call per tick (n = current boid count) — same order as the per-tick `resolveOverlaps` pass already running every tick at this engine's population caps; not a new performance ceiling.

## Migration Notes

None — `history` is a schema-less JSON column; no DB migration needed, exactly like the three prior sample-array additions this mirrors.

## References

- Research/precedent: the three existing per-tick sample arrays (`populationCountSamples`, `foodRatioSamples`, `populationDensitySamples`) in `single-run-lifecycle.ts`/`server-run-registry.ts`/`simulation.ts`/`page.tsx` are the exact pattern this slice follows at every layer.
- `computeGeneticDiversity`: `src/server/simulation/boids.ts:1266`
- Tick loop: `src/server/simulation/single-run-lifecycle.ts`
- Registry: `src/server/simulation/server-run-registry.ts`
- Router: `src/server/api/routers/simulation.ts`
- Analysis view: `src/app/runs/[runId]/page.tsx`
- PRD Non-Goal reversed: `context/foundation/prd.md`'s Non-Goals section, "No diversity-index trend over time in the analysis view (v1)"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-tick sample mechanism and persistence

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 9a568da
- [x] 1.2 Linting passes: `npm run check` — 9a568da
- [x] 1.3 `npx vitest run src/server/simulation/single-run-lifecycle.test.ts` — 9a568da
- [x] 1.4 `npx vitest run src/server/simulation/server-run-registry.test.ts` — 9a568da
- [x] 1.5 `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — 9a568da
- [x] 1.6 `npx vitest run src/server/api/routers/simulation.test.ts` — 9a568da
- [x] 1.7 Full suite passes: `npm test` — 9a568da

### Phase 2: Router read-back guard

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 `npx vitest run src/server/api/routers/simulation.test.ts`
- [ ] 2.4 Full suite passes: `npm test`

### Phase 3: Analysis-view chart

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/app/runs/[runId]/page.test.ts`
- [ ] 3.4 Full suite passes: `npm test`

#### Manual

- [ ] 3.5 A newly completed run's analysis view shows a varying genetic-diversity-over-time chart below the population chart
- [ ] 3.6 A pre-existing run's analysis view still renders correctly, with no new chart and no error
