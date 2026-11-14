# Implementation Plan: Persist per-run population history instead of discarding it

## Overview

When a run finishes (stops, terminally), `computeScore`'s three call sites
consume `phaseHistory`, `foodRatioSamples`, and survivor genes only to
produce the final score number — none of those arrays are persisted
anywhere; `simulationRuns.score` is the only thing written back. This plan
adds a nullable `history` JSON column, written alongside `score` at every
stop path, so a later analysis view (roadmap S-11) has data to read.

**Scope note on "no interview":** this change closely mirrors an existing,
already-shipped pattern — `simulationRuns.savedState` (added in
`full-score-save-resume` Phase 4) is the same column type (`text({mode:
"json"})`), written at the same kind of status-transition boundary, for the
same project. The one new design question (storage shape) was already
settled by that precedent; there's no genuine open decision left to ask
about.

## Current State Analysis

- `simulationRuns` (`src/server/db/schema.ts:92-132`) has `status`, `score`,
  `startedAt`, `stoppedAt`, and `savedState` (JSON, nullable, only populated
  while `status: "saved"`). No column holds tick-level history.
- Three call sites compute `computeScore` and then discard its three input
  arrays:
  1. `src/server/api/routers/simulation.ts`'s `stop` resolver
     (`:344-368`) — client-staged path. Writes `status: "stopped"`, `score`,
     `stoppedAt` in one `.update().set({...})` guarded by a race-safety-net
     `.where(and(eq(id,...), eq(status,"running")))`.
  2. `src/server/simulation/server-run-registry.ts`'s `tick()`
     (`:184-191`) — server-owned path, natural completion. Calls
     `void finishRun(runId, { score })`.
  3. `src/server/simulation/server-run-registry.ts`'s `stopServerRun()`
     (`:261-274`) — server-owned path, manual stop. Also calls
     `finishRun(runId, { score })`.
- `finishRun` (`server-run-registry.ts:104-134`) is the single chokepoint
  both server-owned paths (2) and (3) funnel through — it's the one place
  that writes `status: "stopped"` for server-owned runs. It also handles
  the tick-error path (`tick()`'s `catch` block, `:192-198`), which calls
  `finishRun(runId, { score: null })` with no valid history to persist.
- `BoidGenes` is already exported from `boids.ts:17` — the exact type
  needed for the gene-snapshot array in both the client-staged input
  (`input.survivingBoidGenes`) and the server-owned path
  (`run.boids.map(b => b.genes)`).

## What We're NOT Doing

- Not changing anything about `savedState`/"saved" status — that's already
  its own persisted snapshot for resumable runs, unrelated to this
  terminal-history concern.
- Not retroactively backfilling history for already-stopped rows — only
  runs that finish after this change lands get a populated `history`
  column (matches the Open Roadmap Question #4 default already recorded in
  `roadmap.md`).
- Not building any UI to read or display this data — that's roadmap S-11
  (run-analysis-view), downstream of this slice.
- Not persisting history on the tick-error path (`score: null`) — the
  tick's own state may be unreliable at that point (mirrors the existing
  comment on that code path), so `history` stays `null` there too, same
  posture as `score`.
- Not normalizing into per-tick rows — one JSON blob per run, matching
  `savedState`'s own precedent and this project's declared small scale.

## Implementation Approach

Add a nullable `history` JSON column holding
`{ phaseHistory, foodRatioSamples, survivorGenes }`. Thread it through
`finishRun`'s `outcome` parameter (server-owned paths) and the `stop`
resolver's own `.update().set({...})` call (client-staged path) — both
already have every value in scope at the point they currently discard them.

### Changes Required:

#### 1. Add the `history` column

**File**: `src/server/db/schema.ts`

**Intent**: Give a finished run's tick-level history somewhere to land
instead of being discarded.

**Contract**: `simulationRuns` gains `history: d.text({ mode: "json" })` —
nullable, additive, no default needed (matches `savedState`'s own
declaration style and migration safety). Populated only when a run reaches
`status: "stopped"` with a non-null `score`; stays `null` for rows that
finished before this change, for runs stopped via the tick-error path, and
for rows currently `"saved"` (history, if any, lands only at the next
terminal stop).

#### 2. Extend `finishRun`'s outcome to carry history (server-owned paths)

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: `tick()`'s natural-completion branch and `stopServerRun()` both
already hold `run.phaseHistory`, `run.foodRatioSamples`, and
`run.boids.map(b => b.genes)` at the exact point they call `finishRun` —
thread those through instead of discarding them.

**Contract**: `finishRun`'s `outcome` parameter type gains an optional
`history?: { phaseHistory: PopulationPhase[]; foodRatioSamples: number[]; survivorGenes: BoidGenes[] } | null`.
Its `.update().set({...})` call adds `history: outcome.history ?? null`.
Both call sites that currently pass `{ score }` (the natural-completion
branch in `tick()` and `stopServerRun()`) now pass
`{ score, history: { phaseHistory: run.phaseHistory, foodRatioSamples: run.foodRatioSamples, survivorGenes: run.boids.map((b) => b.genes) } }`.
The tick-error path's existing `finishRun(runId, { score: null })` call is
unchanged — no `history` key passed, so it defaults to `null` via the
`?? null` fallback.

#### 3. Persist history from the `stop` resolver (client-staged path)

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The `stop` resolver already receives `input.phaseHistory`,
`input.foodRatioSamples`, and `input.survivingBoidGenes` over the wire (from
`full-score-save-resume`) — add them to the same `.update().set({...})`
call that already writes `score`.

**Contract**: The `stop` resolver's `.update(simulationRuns).set({...})`
call (`:355-360`) adds
`history: { phaseHistory: input.phaseHistory, foodRatioSamples: input.foodRatioSamples, survivorGenes: input.survivingBoidGenes }`
alongside the existing `status`/`score`/`stoppedAt` fields. No new input
field needed — every value is already validated by the existing zod schema
(`foodRatioSamples`/`phaseHistory` bounded `.max(50_000)`;
`survivingBoidGenes` bounded `.max(50_000)` per the `full-score-save-resume`
impl-review fix).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- None required — this is additive persistence over existing data with no
  new UI surface; the automated tests (verifying `history` lands correctly
  in the DB row after a stop) are the full verification surface.

## Testing Strategy

### Unit Tests:

- `server-run-registry.test.ts`: extend the existing "ticks a run to
  natural completion" test to also assert the stopped row's `history`
  column is non-null and contains the expected `phaseHistory`/
  `foodRatioSamples`/`survivorGenes` shape; extend the existing
  `stopServerRun` early-end test the same way; add a test confirming the
  tick-error path's stopped row has `history: null` (mirroring the
  existing `score: null` assertion on that same test).
- `simulation.test.ts`: extend the existing "allows the owner's own call to
  succeed" `stop` test to also assert the row's `history` column matches
  the input arrays sent over the wire.

### Manual Testing Steps:

1. None — see Manual Verification above.

## Performance Considerations

Same bounded-array posture already established by `full-score-save-resume`
(`.max(50_000)` per array, admin-configurable population cap on live
arrays) — this plan adds persistence of data already held in memory at
score-time, not new computation or new unbounded growth.

## Migration Notes

- `simulationRuns.history`: new nullable column, additive, safe against
  existing rows (defaults to `null`). Generate the migration via
  `npx drizzle-kit generate` and commit the resulting `drizzle/NNNN_*.sql`
  file in the same commit as the schema change — `full-score-save-resume`
  shipped two schema changes via local `db:push` without ever generating a
  migration file, which broke CI (`db:migrate` had nothing to apply) and
  blocked every deploy until caught and fixed later that day. Do not repeat
  that gap here.

## References

- Roadmap: `context/foundation/roadmap.md` F-05 (persist-run-history), MS-08
- PRD: `context/foundation/prd.md` v2 — FR-019, FR-010 (full)
- Precedent: `simulationRuns.savedState` (`src/server/db/schema.ts:131`),
  added in `context/archive/2026-11-14-full-score-save-resume/plan.md` Phase 4
- Chokepoint: `src/server/simulation/server-run-registry.ts:104-134` (`finishRun`)
- Call sites: `server-run-registry.ts:184-191` (`tick()`), `:261-274`
  (`stopServerRun`), `src/server/api/routers/simulation.ts:344-368` (`stop`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add history column and thread it through all three stop paths

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- [x] 1.4 Full suite still passes: `npm test`
