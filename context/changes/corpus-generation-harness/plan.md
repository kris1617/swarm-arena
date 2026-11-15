# Corpus-generation harness Implementation Plan

## Overview

Build a small, reusable library that drives one server-owned simulation run end-to-end through the real app's `createCaller`-based execution path (not a bypass of the engine), under a simulated-duration cap up to 60 minutes, and returns its persisted analysis payload — with a separate, explicit cleanup step. This is the single-run primitive a later slice (S-33) calls repeatedly, batched, to build the full parameter-sweep corpus.

## Current State Analysis

- `createCaller` (`src/server/api/root.ts:29`) lets tests call tRPC procedures directly with a fabricated session, no HTTP — the exact pattern needed to drive a run "through the real app" without a browser. `simulation.test.ts:854-873` shows the full idiom: insert a fixture owner (`users` table, unique email), construct a session referencing that owner's id, call `caller.simulation.startServer(input)`.
- Ticks are accelerated via Vitest's fake-timer API, not real wall-clock waiting — `server-run-registry.test.ts:102-115` advances `vi.advanceTimersByTimeAsync(ms)` past a run's `maxDurationSeconds * 1000`, then a trailing `advanceTimersByTimeAsync(0)` flush to let the fire-and-forget `finishRun()` DB write settle. `TICK_INTERVAL_MS` is 16ms (`server-run-registry.ts:27`), so a 60-simulated-minute run needs `advanceTimersByTimeAsync(3_600_000 + headroom)` — the same two-call pattern already established, just a larger first argument. This requires `vi.useFakeTimers()` to already be active in the calling context — a precondition this harness assumes, like every other test helper in this codebase that touches `server-run-registry.ts`'s ticking.
- **`maxDurationSeconds` is NOT capped by the zod schema** (`simulation.ts:65`, `z.number().int().positive()` — no static max) — the real ceiling is a *runtime* admin-configurable check (`checkAgainstAdminRanges`, `simulation.ts:224,266`) against `adminSettings.parameterRanges`, seeded by default to `{min:1, max:600, default:30}` (`parameter-ranges.ts:44`). A `startServer` call with `maxDurationSeconds: 3600` against the unmodified default seed throws `BAD_REQUEST` (confirmed by the existing "rejects an unbounded maxDurationSeconds" test, `simulation.test.ts:208-224`, which exercises exactly this runtime check, not the schema). This harness must raise the admin range before starting a 60-minute run, and must do so generically (any swept field, not just `maxDurationSeconds`) and restore the prior settings immediately afterward.
- The per-run `maxObjectCount` cap and cross-run `maxConcurrentObjectCount` cap (`simulation.ts:224`, `:120-150`) are both evaluated per-user — the cross-run cap sums "every one of `userId`'s OTHER currently server-ticking runs." Since this harness already creates one fresh fixture-user per call (unique email), parallel calls naturally never share a `userId`, so the cross-run cap can never trigger between corpus-generation calls regardless of how many run concurrently — no special handling needed beyond the existing one-user-per-call pattern.
- A run's completion path (`tick()`'s `shouldStop` branch, `server-run-registry.ts:488-509` → `finishRun`, `:402-417`) persists `status: "stopped"`, `score`, and the full `history` JSON blob (`phaseHistory`, `foodRatioSamples`, `survivorGenes`, `populationCountSamples`, `populationDensitySamples`, `geneticDiversitySamples`, `parameterChanges`, `elapsedSeconds`). The harness should read this back via `caller.simulation.getRunAnalysis({runId})` rather than a raw `db.query` — this exercises the same ownership/status gates a production client hits (`simulation.ts:794-818`), consistent with "driven through the real app's execution path," and returns the fully-shaped analysis payload (`history`, `completedCycles`, `finalGeneticDiversity`, `runOptimizationSuggestion`) this harness needs to hand back anyway.
- DB fixture cleanup is cascade-based: deleting the fixture `users` row cascade-deletes its `simulationRuns` row (`simulationRuns.userId`'s `onDelete: "cascade"` reference) — confirmed by the existing pattern at `simulation.test.ts:160-161` and `server-run-registry.test.ts:86-99`. No direct `simulationRuns` delete is needed, only the owner-user delete, and only after the run has actually finished (a still-ticking run must be stopped first, though this harness's own flow always waits for natural completion before cleanup).
- No existing `scripts/` convention for data-generation/export tooling exists in this repo (`package.json`'s scripts section has no such entry; the existing `scripts/` directory holds an unrelated Next.js dev-server patch). This is greenfield within `scripts/`.

## Desired End State

A new module exports two functions: one that starts a single server-owned run with given parameters (raising and restoring the admin range as needed) and returns its identifiers; one that, given those identifiers, reads back the run's full analysis payload via the real `getRunAnalysis` procedure and deletes the fixture owner (cascade-cleaning the run). Advancing the fake-timer clock between these two calls is deliberately left to the caller (S-33), since sharing one timer-advance across several runs registered in sequence is exactly what makes "parallel" generation possible without inventing a separate concurrency mechanism.

### Key Discoveries:

- Splitting "start" from "collect+cleanup" (rather than one monolithic "run and return" function) is what makes batched/parallel generation possible: a caller can call `startCorpusRun` N times in a row (each registering a new live, independently-ticking server-owned run), advance the shared fake-timer clock once for the whole batch, then call `collectAndCleanupCorpusRun` N times to gather results — no new concurrency primitive needed, since Vitest's fake timers already advance every registered `setInterval` together.
- The admin-range-raising logic should be generic over whatever fields the caller's `params` actually need widened (reusing the `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES` shape from `parameter-ranges.ts`), not hardcoded to `maxDurationSeconds` specifically — consistent with this project's established "generic coercion, not field-specific branching" convention (see `lessons.md` precedent from the crossbreeding-toggle and boid-count slices).

## What We're NOT Doing

- Not building the actual ~20-run sweep, the fixture-file export format, or the parallel-batching loop itself — that's S-33, which consumes this foundation's two functions.
- Not changing `checkAgainstAdminRanges`, `assertWithinConcurrentObjectCeiling`, or any other existing validation function — only calling them indirectly through the normal `startServer` procedure, same as any other client.
- Not persisting the admin-range raise permanently — every raise is paired with an immediate restore to the pre-call snapshot, so this harness never leaves the shared `adminSettings` singleton row altered after it returns.
- Not adding a client-staged-path equivalent — this foundation is server-owned only, matching S-33/S-34/S-35's own scope (the corpus is generated via the server-owned path exclusively).

## Implementation Approach

One phase: the admin-range-ensuring helper, the two exported harness functions, and their tests (pure-logic coverage for the range-widening helper plus one integration test proving a full start→advance→collect→cleanup round trip) — small enough to verify as a single unit rather than splitting construction from testing.

## Phase 1: Harness functions

### Overview

Implement `ensureAdminRangesAdmit`, `startCorpusRun`, and `collectAndCleanupCorpusRun`.

### Changes Required:

#### 1. New module

**File**: `scripts/corpus/harness.ts` (new)

**Intent**: House the three exported functions this foundation delivers, as a plain library module (not a test file) importable by both a future generation test (S-33) and its own tests.

**Contract**:

```ts
export async function ensureAdminRangesAdmit(
	db: DB,
	params: Partial<Record<RangedParameterName, number | boolean>>,
): Promise<ParameterRanges> // returns the pre-call snapshot to restore later
```
Reads the current `adminSettings` row — **deliberately duplicating** `getOrSeedAdminSettings`'s seed-if-absent shape (`simulation.ts:86`, a private, non-exported module-local helper this new module cannot import — a known, acknowledged duplication, not a shared import; a future change to the real seeding logic needs updating in both places). For every key present in `params`, coerce it the same way `updateRunParams` already does (`typeof value === "boolean" ? Number(value) : value` — generic, not field-name-specific) before comparing against the current range's `[min, max]`; widen that bound to admit the coerced value (floor `min` down, raise `max` up — never narrows). Writes the widened ranges back, returns the *original* (pre-widen) `ParameterRanges` object so the caller can restore it later via a plain `db.update(adminSettings).set({parameterRanges: original})`.

```ts
export async function startCorpusRun(
	db: DB,
	params: Omit<z.infer<typeof startInputSchema>, never>, // the same shape `startServer` accepts
): Promise<{ runId: number; ownerId: string; restoreRanges: ParameterRanges }>
```
Inserts a fixture owner (`users` table, unique `corpus-<uuid>@example.com` email, mirroring the existing fixture-email convention), calls `ensureAdminRangesAdmit` with `params`, constructs a `createCaller` session for that owner, calls `caller.simulation.startServer(params)`, then immediately restores the admin ranges via the snapshot `ensureAdminRangesAdmit` returned (the restore happens right after `startServer` returns — `checkAgainstAdminRanges` only runs at start time, never mid-tick, so restoring immediately cannot affect the run already in progress). Returns `{runId, ownerId}` for the caller to hold until timer-advancing is done; `restoreRanges` is included defensively in case the caller wants to re-verify, but is already applied by this function before it returns.

```ts
export async function collectAndCleanupCorpusRun(
	db: DB,
	ownerId: string,
	runId: number,
): Promise<CorpusRunRecord> // = { params snapshot, score, history, completedCycles, finalGeneticDiversity, runOptimizationSuggestion }
```
Constructs the same owner's `createCaller` session, calls `caller.simulation.getRunAnalysis({runId})` (the run must already be `stopped` — the caller is responsible for having advanced fake time past `maxDurationSeconds` first), captures the full returned payload into a `CorpusRunRecord`, then deletes the fixture owner (`db.delete(users).where(eq(users.id, ownerId))`) to cascade-clean the run row. Throws if `getRunAnalysis` indicates the run hasn't actually stopped yet (a caller-side precondition violation, not something this function should silently wait out).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run scripts/corpus/harness.test.ts` — add tests confirming: (a) `ensureAdminRangesAdmit` widens only the fields actually out of range and leaves in-range fields untouched, returning the correct pre-call snapshot; (b) a full `startCorpusRun` → (advance fake timers past `maxDurationSeconds`) → `collectAndCleanupCorpusRun` round trip for a single run with `maxDurationSeconds: 3600` returns a `stopped` run's full analysis payload, and the fixture owner/run no longer exist in the DB afterward; (c) after the round trip, `adminSettings.parameterRanges.maxDurationSeconds` is back to its pre-call value (the restore actually happened, not just attempted).
- Full suite passes: `npm test`

#### Manual Verification:

- None — this is backend test-infrastructure with no UI surface; automated verification is the complete signal for this foundation.

## Risk Notes

`adminSettings` is already a shared-mutable-singleton table across Vitest's parallel test-file workers (all pointing at the same `db.sqlite` file) — the existing `simulation.test.ts` `afterEach`'s `db.delete(adminSettings)` exists specifically because prior code already lives with this risk, not because it was previously race-free. This harness's immediate widen-then-restore doesn't eliminate that pre-existing risk class (a concurrently-running test file could observe a temporarily-widened range mid-call); it's the same exposure every `adminSettings`-touching test already accepts, not a new one this plan introduces.

## Performance Considerations

A single round trip advances fake time by up to 3,600,000ms in one `vi.advanceTimersByTimeAsync` call — this executes ~225,000 ticks synchronously inside that one await, which takes real CPU time proportional to tick cost (not wall-clock proportional to the simulated duration), but is still the dominant cost of this phase's own test. Keep this phase's own test's `maxDurationSeconds` short (e.g. a few seconds) for the round-trip test — only S-33's actual corpus generation needs the full 3600s runs, and that slice's own success criteria should budget for a correspondingly longer test run.

## Migration Notes

None — no schema change; `adminSettings` is read/written through its existing shape.

## References

- `createCaller` pattern: `src/server/api/routers/simulation.test.ts:854-873`
- Fake-timer tick acceleration: `src/server/simulation/server-run-registry.test.ts:102-115`
- Admin-range runtime check: `src/server/api/routers/simulation.ts:224,266`; default seed: `src/server/simulation/parameter-ranges.ts:44`
- Completion/persistence: `src/server/simulation/server-run-registry.ts:402-417,488-509`
- Cascade cleanup pattern: `src/server/api/routers/simulation.test.ts:160-161`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness functions

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 61f15a7
- [x] 1.2 Linting passes: `npm run check` — 61f15a7
- [x] 1.3 `npx vitest run scripts/corpus/harness.test.ts` — 61f15a7
- [x] 1.4 Full suite passes: `npm test` — 61f15a7
