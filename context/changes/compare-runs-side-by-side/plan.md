# Compare completed runs side by side Implementation Plan

## Overview

Let the user select 2–4 completed runs from the dashboard and open a comparison view showing each run's final score, key parameters, and full four-factor score breakdown (survival, resource management, genetic diversity, phase quality), with a table and a grouped bar chart. Runs that predate this change (or predate F-05 entirely) show score-only with dashes for the breakdown.

## Current State Analysis

- `simulationRuns.history` (F-05) persists `{ phaseHistory, foodRatioSamples, survivorGenes, populationCountSamples }` for a completed run, but **not the survival factor**. `computeScore`'s first argument is `elapsedSeconds` (`src/server/simulation/boids.ts:1324-1331`), a running real-time total accumulated per tick in `single-run-lifecycle.ts:131` (`nextElapsedSeconds = state.elapsedSeconds + dtSeconds`) — never written to `history`. It is not recoverable from `phaseHistory.length` (a tick count, not a time duration — the two diverge whenever tick cadence varies). Once a run finishes scoring, its survival factor is permanently lost today.
- `getRunAnalysis` (`src/server/api/routers/simulation.ts:495-552`) already establishes the exact pattern this plan reuses: ownership check (`FORBIDDEN`), status check (`stopped` only, else `BAD_REQUEST`), an unchecked-then-guarded cast on the schema-less `history` JSON column (`Array.isArray` guard added in the run-analysis-view impl-review), and computing derived values server-side via `boids.ts`'s exported `compute*` functions so the client page never imports a server-only module.
- `listCompleted` (`simulation.ts:467-490`) returns the caller's own `status: "stopped"` rows with `score`, ordered newest-first, capped at 50 — the exact source list the dashboard's Completed section renders (`src/app/dashboard/page.tsx:123-154`).
- The dashboard's Completed section already handles `score === null` (plan-review F1 from post-login-run-dashboard) and links to `/runs/${run.id}` for analysis (S-11) — this plan's checkbox/button UI slots into that same section without touching Running or Saved.
- Recharts (`^3.10.1`) is already a dependency (added for S-11's `LineChart`); this plan's bar chart is a different Recharts component (`BarChart`), not a reuse of the same chart shape.
- `/runs/[runId]/page.tsx` (S-11) is the only precedent for a run-scoped client page reading an identifier from the URL — via `useParams<{runId: string}>()` from `next/navigation`, because Next.js 16 makes dynamic-route `params` a `Promise`. This plan's `/runs/compare` route takes IDs from the **query string**, not a dynamic segment, so it reads via `useSearchParams()` instead — same `next/navigation` module, different hook.

## Desired End State

From the dashboard's Completed section, the user checks 2–4 runs and clicks "Compare selected", landing on `/runs/compare?ids=1,2,3`. That page shows, per selected run: its parameters (boid/predator counts, food settings) as context, its final score, and its four-factor breakdown (survival, resource management, genetic diversity, phase quality) — as both a table and a grouped bar chart. A run with no persisted history, or one that predates this change's `elapsedSeconds` addition, still appears with its real score; its breakdown cells show `—` instead of crashing or being silently dropped.

### Key Discoveries

- Survival factor is not persisted anywhere today (see Current State Analysis) — this plan must add it, mirroring S-11 Phase 1's `populationCountSamples` fix exactly: extend `stop`'s zod input, both `server-run-registry.ts` write sites, and `history`'s shape.
- `getRunAnalysis`'s guarded-cast pattern (`simulation.ts:518-535`) is the template for safely reading `history` on an arbitrary set of rows; this plan's new query reuses it per-row rather than inventing a new guard shape.

## What We're NOT Doing

- No backfill of `elapsedSeconds` for runs that completed before this change ships — forward-only, matching every other `history`-shape addition this session (`populationCountSamples`, `history` itself).
- No warning or blocking when selected runs have different parameters (boidCount, predatorCount, etc.) — comparing different variants is the explicit point of FR-016 per the PRD's Vision ("whether a parameter change actually helped"), not a mistake to flag.
- No comparison of more than 4 runs, and no comparison of fewer than 2 — enforced by both the dashboard's "Compare selected" button (disabled outside 2–4 selections) and the backend query's zod input.
- No new chart type beyond Recharts' `BarChart` — no new charting library, no hand-rolled SVG.
- No changes to the dashboard's Running or Saved sections, or to `/runs/[runId]`'s existing analysis view.
- No diversity-index trend, growth-curve overlay, or anything S-11 already explicitly scoped out — this plan only adds comparison across runs, not new analysis within a single run.

## Implementation Approach

Extend the proven S-11 pattern (persist a missing signal → expose it via a guarded, ownership-checked query → render it) across three phases: (1) close the survival-factor gap and add the comparison query in one backend phase, since both touch `simulation.ts`/`simulation.test.ts` together; (2) wire selection and navigation into the existing dashboard; (3) build the new comparison view.

## Phase 1: Persist the survival factor and add the comparison query

### Overview

Close the elapsedSeconds gap (mirroring S-11 Phase 1's populationCountSamples fix) and add `getRunsComparison`, the new ownership/status-gated query that returns per-run score, parameters, and a four-factor breakdown.

### Changes Required:

#### 1. Persist `elapsedSeconds` in `history`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Both places that build a server-owned run's terminal `history` object (the `tick()` function's `shouldStop` branch, and `stopServerRun`) currently omit the survival factor entirely. Add it from the same `run.elapsedSeconds` value already passed as `computeScore`'s first argument at each site — the value already exists in scope, it's just never written to `history`.

**Contract**: `history`'s object literal at both sites gains `elapsedSeconds: run.elapsedSeconds` alongside the four existing fields.

#### 2. Persist `elapsedSeconds` from the client-staged path

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The `stop` mutation's `history` write (around line 373) needs the same field. The client sends its survival-factor value in the (confusingly-named, pre-existing) `elapsedTicks` field — add `elapsedSeconds: clampedElapsedTicks` to the `history` object, reusing the value already computed for `computeScore`'s first argument two lines above. Do not rename `elapsedTicks` — that's existing, unrelated scope.

**Contract**: `history`'s object literal in the `stop` resolver gains `elapsedSeconds: clampedElapsedTicks`, matching the field name used by `server-run-registry.ts`'s two sites.

#### 3. Add `getRunsComparison` query

**File**: `src/server/api/routers/simulation.ts`

**Intent**: A new `protectedProcedure.query` that takes 2–4 run IDs, fetches each one the caller owns, and returns per-run score, parameters, and a breakdown derived from `history` the same way `getRunAnalysis` derives `completedCycles`/`finalGeneticDiversity` — via `boids.ts`'s exported `compute*` functions. A row the caller doesn't own, that doesn't exist, or that isn't `status: "stopped"` is dropped from the result with a per-row `error` marker rather than failing the whole query — unlike `getRunAnalysis` (one run, hard-fails on any gate), this query handles N runs where one bad ID shouldn't block the other N-1.

**Contract**:
```ts
getRunsComparison: protectedProcedure
  .input(z.object({ runIds: z.array(z.number()).min(2).max(4) }))
  .query(async ({ ctx, input }) => {
    // for each runId: fetch, check ownership + status === "stopped";
    // on failure, push { runId, error: "not-found" | "forbidden" | "not-completed" }
    // on success, push {
    //   runId, score, startedAt, stoppedAt,
    //   parameters: { boidCount, predatorCount, foodStockInitial, foodRegenRate, protectionThreshold },
    //   breakdown: history && Array.isArray(history.phaseHistory) && typeof history.elapsedSeconds === "number"
    //     ? {
    //         survival: history.elapsedSeconds,
    //         resourceManagement: computeResourceManagement(history.foodRatioSamples),
    //         geneticDiversity: computeGeneticDiversity(history.survivorGenes),
    //         phaseQuality: computePhaseQuality(history.phaseHistory),
    //       }
    //     : null,
    // }
  })
```
The guarded-cast condition mirrors `getRunAnalysis`'s (`Array.isArray` on `phaseHistory`/`survivorGenes`), plus a `typeof history.elapsedSeconds === "number"` check — the one new condition, since `elapsedSeconds` is the one field this plan newly adds and so is the one field guaranteed absent on every row that predates this phase.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — pure backend, covered by automated tests)

---

## Phase 2: Dashboard selection UI

### Overview

Add checkboxes to the dashboard's Completed section and a "Compare selected" button that navigates to the comparison view.

### Changes Required:

#### 1. Selection state and controls

**File**: `src/app/dashboard/page.tsx`

**Intent**: Track a `Set<number>` of selected run IDs (client-side `useState`), scoped to the Completed section only. Each completed run's row gets a checkbox toggling its membership. A "Compare selected" link/button appears above or below the Completed section, enabled only when the selection size is 2–4, and navigates to `/runs/compare?ids=<comma-separated selected IDs>`.

**Contract**: New local state `selectedIds: Set<number>` and a toggle handler; the existing `completedQuery.data.map(...)` row gains a checkbox bound to that state. The button is a `Link` (or disabled `<button>` outside the 2–4 range, `Link` within it) to `` `/runs/compare?ids=${[...selectedIds].join(",")}` ``.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Checking 1 run leaves "Compare selected" disabled; checking 2–4 enables it; checking a 5th is prevented or the 5th checkbox is disabled
- Clicking "Compare selected" with 2 runs checked navigates to `/runs/compare?ids=<those two ids>`
- Unchecking a run removes it from the pending selection without affecting Running/Saved sections

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Comparison view

### Overview

New `/runs/compare` page reading selected run IDs from the query string, rendering a parameter-context row, a score/factor table, and a grouped bar chart, with graceful degradation for runs lacking a breakdown.

### Changes Required:

#### 1. New comparison page

**File**: `src/app/runs/compare/page.tsx`

**Intent**: A client component reading `ids` from `useSearchParams()` (Next.js 16's query-string hook — distinct from `/runs/[runId]`'s `useParams()`, which is for dynamic route segments, not query strings), parsing it into up to 4 numbers, and calling `getRunsComparison`. Renders: (a) a parameter row per run (boidCount, predatorCount, foodStockInitial, foodRegenRate, protectionThreshold) so differing variants are visible without a warning (per the plan's explicit non-goal); (b) a table with score + four factor rows, one column per run, `—` in any breakdown cell where `breakdown` is `null`; (c) a Recharts `BarChart` with one group per run and one bar per factor, omitting a run's bars entirely when its `breakdown` is `null` (the table's `—` already covers that case — the chart isn't the place to render an absent value). A row with a per-run `error` marker (dropped by the backend) renders as "Run #N: could not be loaded (not found / not yours / not completed)" instead of a silently missing column.

**Contract**: Default export `RunsComparePage`; no dynamic segment, reads `searchParams.get("ids")`. If `ids` is missing, malformed, or resolves to fewer than 2 valid numbers after parsing, render the same "Could not load this comparison" fallback style `/runs/[runId]/page.tsx` uses for its error state — do not throw.

#### 2. Link from the dashboard is already wired

**File**: `src/app/dashboard/page.tsx` (completed in Phase 2)

**Intent**: No further change here — Phase 2's "Compare selected" link already points at this route. Listed for traceability only.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Comparing 2 completed runs with full persisted history (post-Phase-1) shows matching scores/factors in both the table and the bar chart
- Comparing a run with full history against one with `history: null` (or one that predates Phase 1's `elapsedSeconds`) shows `—` for that run's breakdown cells/survival factor, without crashing, and the chart omits that run's missing bars rather than rendering a zero
- Visiting `/runs/compare?ids=<id>` with only 1 id, or with an id belonging to another user, or with a non-completed run's id, renders the appropriate fallback/dropped-row behavior instead of crashing
- Navigating from the dashboard's "Compare selected" button round-trips correctly with the exact selected run IDs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `server-run-registry.test.ts`: both `tick()`'s natural-completion path and `stopServerRun` write `elapsedSeconds` into `history`.
- `simulation.test.ts`: `stop` resolver writes `elapsedSeconds` into `history`; `getRunsComparison` returns breakdowns for full-history rows, `null` breakdown for history-less rows, per-row error markers for not-found/forbidden/not-completed rows, and rejects fewer than 2 or more than 4 `runIds` at the zod boundary.

### Manual Testing Steps:

1. Start and let two differently-configured runs complete naturally (different `boidCount`/`foodStockInitial`), confirm both have `elapsedSeconds` in their `history` row.
2. From the dashboard, select both, click "Compare selected", confirm the comparison view's table and chart show distinct, correct values for all four factors.
3. Manually insert (or use a pre-Phase-1 row from an earlier session) a completed run whose `history` lacks `elapsedSeconds`; compare it against a full-history run; confirm graceful `—` degradation.

## Performance Considerations

None beyond what `getRunAnalysis` already establishes — this is a handful of additional `SELECT`s (bounded at 4 by the zod cap) and pure in-memory `compute*` calls, no new heavy computation.

## Migration Notes

None — `history` is a schema-less JSON column (`d.text({ mode: "json" })`); adding `elapsedSeconds` to its shape needs no Drizzle migration, same as every prior addition to this column this session.

## References

- `src/server/api/routers/simulation.ts:495-552` — `getRunAnalysis`, the pattern this plan's query reuses.
- `src/server/simulation/server-run-registry.ts:150-220,270-300` — both server-owned `history` write sites needing the `elapsedSeconds` addition.
- `src/server/simulation/single-run-lifecycle.ts:118-143` — where `elapsedSeconds` actually accumulates per tick, confirming it's not recoverable from `phaseHistory.length`.
- `context/archive/2026-11-14-run-analysis-view/plan.md` — the immediately-preceding plan this one's Phase 1 discovery and Phase 3 route-reading approach both mirror.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persist the survival factor and add the comparison query

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 1e55282
- [x] 1.2 Linting passes: `npm run check` — 1e55282
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts` — 1e55282
- [x] 1.4 Full suite still passes: `npm test` — 1e55282

### Phase 2: Dashboard selection UI

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — ff24bcb
- [x] 2.2 Linting passes: `npm run check` — ff24bcb
- [x] 2.3 Full suite still passes: `npm test` — ff24bcb

#### Manual

- [x] 2.4 Checking 1 run leaves "Compare selected" disabled; checking 2–4 enables it; checking a 5th is prevented or the 5th checkbox is disabled — ff24bcb
- [x] 2.5 Clicking "Compare selected" with 2 runs checked navigates to `/runs/compare?ids=<those two ids>` — ff24bcb
- [x] 2.6 Unchecking a run removes it from the pending selection without affecting Running/Saved sections — ff24bcb

### Phase 3: Comparison view

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run check`
- [x] 3.3 Full suite still passes: `npm test`

#### Manual

- [x] 3.4 Comparing 2 completed runs with full persisted history (post-Phase-1) shows matching scores/factors in both the table and the bar chart
- [x] 3.5 Comparing a run with full history against one with `history: null` (or pre-Phase-1) shows `—` for that run's breakdown cells/survival factor, without crashing, and the chart omits that run's missing bars
- [x] 3.6 Visiting `/runs/compare?ids=<id>` with only 1 id, another user's id, or a non-completed run's id renders the appropriate fallback/dropped-row behavior instead of crashing
- [x] 3.7 Navigating from the dashboard's "Compare selected" button round-trips correctly with the exact selected run IDs
