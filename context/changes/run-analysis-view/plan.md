# Implementation Plan: Per-run population-dynamics analysis view

## Overview

From a completed run's dashboard entry, the user opens `/runs/[runId]`,
showing: a population-over-time chart (with phase periods color-coded),
a phase-time breakdown, a list of completed resilience cycles (matching
S-09's per-cycle fix), and a final genetic-diversity value. Charts use
Recharts (explicitly chosen by the user over plain tables or hand-rolled
SVG, given this is the project's first charting dependency).

**Two real scope corrections found during planning** (not implementer
preference — actual data-availability constraints, documented here so the
plan matches what's buildable, not the roadmap's optimistic phrasing):

1. **F-05's persisted `history` shape has no population-count time series.**
   `simulationRuns.history` (added by F-05, archived) only persists
   `phaseHistory`, `foodRatioSamples`, `survivorGenes` — confirmed by
   reading `server-run-registry.ts:200-210/290-300` and
   `simulation.ts:358-368`. A "population-over-time chart" needs
   `populationCountSamples`, which exists as live tick state
   (`single-run-lifecycle.ts:31/58`, `server-run-registry.ts:59`) but was
   never added to `history`'s persisted shape. Phase 1 below extends it —
   this is necessary prerequisite work this plan owns, not a separate
   change, since nothing downstream needs the fix except this view.
2. **"Diversity-index trend over time" is not buildable from persisted
   data — only a single final value is.** `history.survivorGenes` is one
   end-of-run snapshot (the survivors' genes at the moment the run
   stopped), not a per-tick series — there is no historical diversity
   data to plot a trend from, and adding one now would mean tracking a
   new per-tick array through the whole live-tick pipeline for a "nice to
   have" trend line. V1 shows final genetic diversity as a single
   computed stat (via the already-exported `computeGeneticDiversity`),
   not a chart. The roadmap's "diversity-index trend" phrasing is
   corrected to match what's actually available.

Rows that completed *before* Phase 1 ships will have `history` without
`populationCountSamples` (forward-only, no backfill — matches this
project's established posture, e.g. `full-score-save-resume`'s own save/
resume Open Question #4 default). The analysis view renders "no
population data for this run" for those rows' chart instead of crashing.

## Current State Analysis

- `simulationRuns.history` (JSON, nullable) is a schema-less blob at the
  SQL level — extending its TypeScript shape needs no new migration, only
  updating the 3 write sites and the `stop` mutation's zod input (client
  path sends this over the wire; the server path already holds it live).
- **Plan-review F1 correction**: client path
  (`src/app/simulation/_components/simulation-canvas.tsx:199,305,329`)
  already tracks `populationCountSamplesRef`, updating it every tick —
  but `buildStopInput()`'s returned object (confirmed by a full read)
  does **not** include it; only `cohesionSamples`/`foodRatioSamples`/
  `phaseHistory`/`survivingBoidGenes` are sent. Phase 1 must add
  `populationCountSamples: populationCountSamplesRef.current` to that
  object too, or the client-staged path's `history.populationCountSamples`
  stays empty forever even after the server-side schema/resolver changes
  land.
- `countCrashToRecoveryCycles` (`boids.ts`, added by S-09, private/
  unexported) counts non-overlapping crash→recovery pairs but returns
  only a count, not tick ranges — this view needs the actual ranges to
  show "cycle 1: ticks 340–512" etc. Phase 2 refactors it into a shared
  `segmentCompletedCycles` (returns `{startTick, endTick}[]`) that
  `countCrashToRecoveryCycles` then calls `.length` on — same algorithm,
  no behavior change, verified by S-09's existing tests still passing
  unchanged.
- `computeGeneticDiversity(genes: BoidGenes[]): number` (`boids.ts`) is
  already exported and takes exactly the `survivorGenes` shape `history`
  persists — no new diversity computation needed, just calling the
  existing function on `history.survivorGenes`.
- No charting library exists (`grep` of `package.json` confirmed). User
  explicitly chose Recharts (latest stable `3.10.1`, confirmed via
  `npm view recharts version`; peer deps confirmed compatible with this
  project's `react@^19.0.0`).
- No `/runs/[runId]`-shaped route exists. Existing route naming is flat
  (`/simulation`, `/dashboard`, `/admin/settings`, `/login`) — this plan
  adds `/runs/[runId]` as a new top-level dynamic route, matching that
  flat convention.
- `src/app/dashboard/page.tsx`'s Completed section currently renders
  score-only, no link (S-10's plan explicitly deferred this: "S-11 adds
  one"). Phase 3 adds the link.

## What We're NOT Doing

- Not backfilling `populationCountSamples` into already-completed runs'
  `history` — forward-only, matching established project posture.
- Not building a true curve-fit (least-squares logistic regression)
  overlay — "comparison" in v1 means showing the actual trajectory with
  phase periods color-coded directly on it (so the viewer visually
  compares the shape against what a smooth logistic curve would look
  like), not computing and drawing a fitted reference curve. A fitted
  overlay is real future work, not reflexively added here.
- Not a genetic-diversity trend chart — see scope correction #2 above;
  final value only.
- Not adding any other new frontend dependency beyond Recharts.
- Not changing `/dashboard`'s Running/Saved sections — only the Completed
  section's rows gain a link.
- Not retroactively fixing S-09/F-05/S-10's own archived plans — this
  plan's Phase 1 extension to `history`'s shape is new, additive work
  recorded here, not a reopening of those closed changes.

## Implementation Approach

Three phases: (1) extend persisted history with `populationCountSamples`
end-to-end (schema type, 3 write sites, `stop`'s zod input — all additive,
no migration); (2) add Recharts, refactor the cycle-counter into a
range-returning shared helper, add the `getRunAnalysis` query; (3) build
the `/runs/[runId]` page and link it from the dashboard.

### Changes Required:

#### 1. Extend `history`'s shape with `populationCountSamples`

**Files**: `src/server/simulation/server-run-registry.ts`,
`src/server/api/routers/simulation.ts`,
`src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Without this, the population-over-time chart has no data
source at all for any future run.

**Contract**: `finishRun`'s `outcome.history` type
(`server-run-registry.ts`) gains `populationCountSamples: number[]`. Both
server-owned write sites (`tick()`'s natural-completion branch,
`stopServerRun`) add `populationCountSamples: run.populationCountSamples`
to the object they already build. `stop`'s zod input
(`simulation.ts:255-300`) gains
`populationCountSamples: z.array(z.number().int().nonnegative()).min(1).max(50_000)`
(same bound pattern as its three siblings). The `stop` resolver's
`history` write adds `populationCountSamples: input.populationCountSamples`.
**Plan-review F1**: `simulation-canvas.tsx`'s `buildStopInput()` must also
add `populationCountSamples: populationCountSamplesRef.current` to its
returned object — it currently tracks the ref but never sends it.

#### 2. Shared cycle-range helper, Recharts dependency, `getRunAnalysis` query

**File**: `src/server/simulation/boids.ts`

**Intent**: `countCrashToRecoveryCycles` already finds cycle boundaries
but discards them. Expose them.

**Contract**: Add `export function segmentCompletedCycles(phaseHistory: PopulationPhase[]): { startTick: number; endTick: number }[]`
— same scan algorithm `countCrashToRecoveryCycles` already uses (crash
tick → next recovery tick, continue past it), returning the index pairs
instead of just incrementing a counter. Rewrite
`countCrashToRecoveryCycles` to `return segmentCompletedCycles(phaseHistory).length;`
— pure refactor, no behavior change; the existing S-09 tests for
`computePhaseQuality` (which depends on the count) must still pass
unchanged, proving it.

**File**: `package.json`

**Intent**: Add the charting library.

**Contract**: `npm install recharts@3.10.1` (pinned exact version per
this project's dependency convention — check `package.json`'s existing
pinning style for other deps before finalizing the exact specifier).

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The analysis page needs one run's full stored data, ownership-
checked like every other per-run query in this router.

**Contract**: `getRunAnalysis: protectedProcedure.input(z.object({ runId: z.number() })).query(...)`
— fetches the row by id, throws `BAD_REQUEST` if missing,
`FORBIDDEN` if `run.userId !== ctx.session.user.id` (same pattern as
`stop`/`savePause`/`resume`), throws `BAD_REQUEST` if
`run.status !== "stopped"` (analysis is for completed runs only — matches
S-10's existing pattern of a status-scoped query). Returns
`{ id, score, startedAt, stoppedAt, boidCount, predatorCount, history, completedCycles, finalGeneticDiversity }`.
`history` is typed as `(ServerRunHistory & { populationCountSamples?: number[] }) | null`
so the resolver (and the page) can distinguish "no history at all" (run
predates F-05) from "history without population data" (run predates this
plan's Phase 1) from "full data." `completedCycles` is
`segmentCompletedCycles(history.phaseHistory)` (`[]` if `history` is
`null`); `finalGeneticDiversity` is
`computeGeneticDiversity(history.survivorGenes)` (`0` if `history` is
`null`) — both computed server-side so the client page never imports
`boids.ts` (a server-only module).

#### 3. The `/runs/[runId]` analysis page, dashboard link

**File**: `src/app/runs/[runId]/page.tsx` (new)

**Intent**: Render the three analysis pieces from `getRunAnalysis`'s data.

**Contract**: `"use client"` component. **Plan-review F2**: this is the
project's first dynamic route — Next 16 makes `params` a `Promise`, not a
plain object (confirmed against `node_modules/next/dist/docs/01-app/
03-api-reference/03-file-conventions/dynamic-routes.md`); for a fully
client-rendered page, use `useParams<{ runId: string }>()` from
`next/navigation` instead of accepting a `params` prop and unwrapping it
with `use()`. `useParams()` returns the segment as a `string` — convert
with `Number(runId)` before calling
`api.simulation.getRunAnalysis.useQuery({ runId: Number(runId) })` (the
query's zod input is `z.number()`). Renders, in order:
1. **Population-over-time chart** (Recharts `LineChart`): x-axis = tick
   index (`0..populationCountSamples.length-1` — no separate timestamp
   array exists, so tick index is the only available x-axis), y-axis =
   population count. Background bands or point color keyed to
   `phaseHistory[tick]` (same index space — both arrays are pushed once
   per tick, confirmed same length by construction in
   `single-run-lifecycle.ts`), using a small fixed color map (one color
   per `PopulationPhase` value). If `populationCountSamples` is missing
   (pre-Phase-1 row), render "No population data recorded for this run"
   instead of an empty chart.
2. **Phase-time breakdown**: a simple tally — percentage of ticks in each
   of the 5 `PopulationPhase` values, computed client-side from
   `history.phaseHistory` (a plain `reduce`, no new backend logic needed).
3. **Completed cycles**: rendered from `completedCycles` (part of
   `getRunAnalysis`'s response, computed server-side — see item 2's
   contract above, which already includes it precisely so this
   client page never needs to import `boids.ts`, a server-only module).
4. **Final genetic diversity**: rendered from `finalGeneticDiversity`
   (also part of `getRunAnalysis`'s response) as a single stat.

**File**: `src/app/dashboard/page.tsx`

**Intent**: Close the loop S-10 explicitly left open ("completed rows are
plain list items for now — S-11 adds one").

**Contract**: Completed rows gain a "View analysis" link to
`/runs/${run.id}`, following the same `Link` pattern already used for
Running/Saved rows' "View" link to `/simulation`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- Running a server-owned simulation to completion (with scarce food, to
  trigger phase cycling, same manual-check pattern used for
  `full-score-save-resume` Phase 3) and visiting its `/runs/[runId]` page
  shows a population chart, phase breakdown, completed-cycle list, and a
  genetic-diversity value that all look internally consistent with each
  other.
- A run completed before this plan's Phase 1 shipped (no
  `populationCountSamples` in its `history`) shows the "no population
  data" message instead of crashing, while still showing phase breakdown/
  cycles/diversity (which only need `phaseHistory`/`survivorGenes`,
  unaffected by the gap).
- The dashboard's "View analysis" link on a Completed row navigates to
  the correct run's analysis page.
- Visiting `/runs/[runId]` for a run owned by a different user is
  rejected (FORBIDDEN), not silently shown.

## Testing Strategy

### Unit Tests:

- `boids.test.ts`: new tests for `segmentCompletedCycles` (returns the
  correct tick ranges for a known multi-cycle `phaseHistory`, matching
  what `countCrashToRecoveryCycles`'s existing tests already assert about
  the *count*); confirm `countCrashToRecoveryCycles`'s existing 2 tests
  (added by S-09) still pass unchanged after the refactor.
- `server-run-registry.test.ts`: extend the existing history-assertion
  tests (added by F-05) to also assert `populationCountSamples` is a
  non-empty array on a naturally-completed and a manually-stopped run.
- `simulation.test.ts`: new `describe("simulationRouter.getRunAnalysis")`
  — ownership check (FORBIDDEN for non-owner, matching the existing
  pattern), BAD_REQUEST for a non-"stopped" run, BAD_REQUEST for a
  missing run, and a shape/value check that `completedCycles` and
  `finalGeneticDiversity` in the response match hand-computed values for
  a known fixture `history`. Extend the existing `stop` test to assert
  `populationCountSamples` round-trips into the row's `history`.

### Manual Testing Steps:

1. See Manual Verification above — dev server + E2E test-auth bypass +
   Playwright, same pattern used throughout this session.

## Performance Considerations

Recharts renders client-side from data already bounded by the existing
`.max(50_000)` sample-array caps — no new unbounded surface. The
population chart's point count is bounded the same way.

## Migration Notes

None — `history` stays the same JSON column; only its TypeScript shape
and the values written into it change.

## References

- Roadmap: `context/foundation/roadmap.md` S-11 (run-analysis-view), MS-08
- PRD: `context/foundation/prd.md` v2 — FR-010 (full), FR-019
- F-05 (persisted history, needs Phase 1's extension):
  `context/archive/2026-11-14-persist-run-history/plan.md`
- S-09 (cycle counting, refactored in Phase 2):
  `context/archive/2026-11-14-phase-quality-per-cycle-scoring/plan.md`
- S-10 (dashboard, linked in Phase 3):
  `context/archive/2026-11-14-post-login-run-dashboard/plan.md`
- Client already sends `populationCountSamples` (dropped by zod until
  Phase 1): `src/app/simulation/_components/simulation-canvas.tsx:199,305,329`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persist populationCountSamples end-to-end

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- [x] 1.4 Full suite still passes: `npm test`

### Phase 2: segmentCompletedCycles, Recharts dependency, getRunAnalysis query

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 New/updated tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/api/routers/simulation.test.ts`
- [ ] 2.4 Full suite still passes: `npm test`

### Phase 3: /runs/[runId] analysis page, dashboard link

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`

#### Manual

- [ ] 3.4 Completed run with full data shows internally-consistent population chart, phase breakdown, cycle list, and diversity value
- [ ] 3.5 Pre-Phase-1 run (no populationCountSamples) shows "no population data" instead of crashing, while other sections still render
- [ ] 3.6 Dashboard's "View analysis" link navigates to the correct run
- [ ] 3.7 Visiting another user's run analysis page is rejected (FORBIDDEN)
