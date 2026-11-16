# Parameter-sweep corpus generation Implementation Plan

## Overview

Generate and export the full ~20-run structured parameter-sweep corpus (roadmap S-33), using F-08's single-run harness (`scripts/corpus/harness.ts`) batched up to 4 runs at a time, each capped at 60 simulated minutes. This requires fixing a confirmed engine performance bug first, since a full 3600s run does not currently complete in reasonable time, and a concurrency-safety fix to the harness's shared admin-range widening, since F-08's own impl-review explicitly deferred that race to this slice.

## Current State Analysis

- **Performance blocker (confirmed, not theoretical)**: `single-run-lifecycle.ts:124-165` rebuilds six per-tick arrays (`cohesionSamples`, `foodRatioSamples`, `populationCountSamples`, `populationDensitySamples`, `geneticDiversitySamples`, `phaseHistory`) via `[...array, next]` every tick — a full copy each time, making total cost O(N²) in tick count. At `TICK_INTERVAL_MS = 16` (`server-run-registry.ts:27`), a 3600s run is 225,000 ticks; F-08's own test (`scripts/corpus/harness.test.ts:174-183`) records this did not finish inside a 2-minute timeout. A second, smaller O(n) cost is layered on top: `phaseHistoryWindow` (`single-run-lifecycle.ts:154-160`) `.map()`s over the *entire* already-grown `nextPopulationCountSamples`/`nextFoodRatioSamples` every tick, even though `classifyPopulationPhase` (`boids.ts:1297-1304`) only ever reads the last `PHASE_WINDOW_SIZE = 20` entries of what it's given (`history.slice(-PHASE_WINDOW_SIZE)`) — the full-length map is pure waste on top of the array-copy cost.
- **Mutation-in-place is safe here — confirmed by checking both consumers of `computeSingleRunTick`**: the client path (`simulation-canvas.tsx:796-835`) stores every sample array in a plain `useRef`, never in `useState` — no React referential-equality comparison depends on these arrays being a new object each tick. The server path (`server-run-registry.ts:442-486`) reassigns `run.<field> = result.<field>` on one long-lived in-memory `run` object per registry entry — nothing elsewhere holds a second live reference to compare against. Neither consumer requires the returned arrays to be new objects.
- **One real aliasing risk identified, needs its own test**: `snapshotServerRun` (`server-run-registry.ts:643-658`) copies `cohesionSamples: run.cohesionSamples` (and siblings) directly into the snapshot object it returns — not a deep copy. Today this is harmless because the value is immediately JSON-serialized into a DB column and the run's interval is cleared before/with the snapshot. If the six arrays switch to mutate-in-place (`array.push(next)` instead of spread), this is *still* safe as long as nothing mutates the live run's arrays after `snapshotServerRun` has read them but before the DB write completes — true today (the interval is cleared first) but worth an explicit regression test, since this project's own `lessons.md` already documents one `resumeServerRun`-adjacent bug in this exact area (S-25).
- **Concurrency race (confirmed, already analyzed in F-08's own Risk Notes and impl-review F3)**: `ensureAdminRangesAdmit`/`startCorpusRun` (`harness.ts:87-189`) widen the shared `adminSettings` singleton row per call and restore it to *that call's own* pre-widen snapshot in a `finally`. Two concurrent calls race: A widens, B widens further, A restores to A's pre-widen snapshot (clobbering B's still-in-flight wider range), and B's `startServer` then spuriously rejects or runs too narrow.
- **The race has a clean, low-risk fix**: fold the per-field min/max logic `ensureAdminRangesAdmit` already uses (`harness.ts:94-111`) across the whole batch's param sets instead of one, widen once before starting any run in the batch, restore once after all are started. This reuses the existing "generic coercion, not field-specific" convention already established in this file.
- **"4 parallel" needs no new mechanism**: Vitest's fake clock is global — `server-run-registry.test.ts:904-947` proves one `vi.advanceTimersByTimeAsync(ms)` call ticks every currently-registered run together. Up to 4 runs registered before an advance call already tick in lockstep.
- **Per-user object-count caps never interact across the batch**: `assertWithinConcurrentObjectCeiling`/`checkConcurrentObjectCapSoft` (`simulation.ts:125-222`) are both scoped by `eq(simulationRuns.userId, userId)`; `startCorpusRun` already mints one fresh fixture user per call, so concurrent calls in a batch never share a `userId`.
- **Extinction already ends a run early**: `single-run-lifecycle.ts:168-169` — `shouldStop = elapsedSeconds >= maxDurationSeconds || nextBoids.length === 0`. A sweep combination that goes extinct (the "crash" phase's real terminal state) finishes in however many ticks that took, not the full 225,000 — lowering the real cost of exactly the combinations most likely to be slow if they *didn't* finish early.
- **All swept values are already within the default admin range**: `DEFAULT_PARAMETER_RANGES` (`parameter-ranges.ts:35-67`) admits `separationWeight` 0–10 and `foodRegenRate` 0–1000 by default — the sweep's chosen values (0.5–4 and 2–30 respectively) need no widening at all. Only `maxDurationSeconds` (default max 600) needs widening, and by the *same* value (3600) for every run in the batch — the simplest possible case for the union-widen-once fix, though the fix itself stays generic over any field for future sweeps.
- **No fixture-export code exists anywhere in the repo** — no `context/fixtures/` directory, no JSON/CSV writer, no related `package.json` script. `CorpusRunRecord` (`harness.ts:44-57`) is the closest existing per-run record shape.
- **No `tsx`/`ts-node` in this repo** (`package.json` scripts: build/check/db:*/dev/preview/start/test/typecheck only) — generation must run through Vitest (for `vi.useFakeTimers()`), the same way F-08's own harness tests do; a bare Node script would tick in real wall-clock time (3600s per run minimum), making the batch impractically slow regardless of the engine fix.

### Key Discoveries:

- `boids.ts:1286-1403` — `PopulationPhase = "establishment"|"growth"|"overshoot"|"crash"|"recovery"`, `classifyPopulationPhase` (20-tick window, 0.3 food-ratio threshold, -10% crash trend), `PHASE_QUALITY_WEIGHTS`/`computePhaseQuality` — the exact vocabulary and thresholds the sweep matrix below is grounded in.
- `parameter-suggestion.ts:107-160` — FR-015's `suggestParameterChange` (a later slice, S-34's concern) needs ≥3 runs with real variance in a field, ≥5 for "high" confidence — bounds how many distinct values per varied field matter downstream, informing (not dictating) this sweep's shape.

## Desired End State

Running `npm run corpus:generate` once produces `context/fixtures/parameter-sweep-corpus/run-01.json.gz` through `run-20.json.gz` (each a gzip-compressed `CorpusRunRecord`-shaped export of one completed run — impl-review: raw JSON compresses ~300x given its repetitive structure, avoiding a 289MB addition to repo size for ~916KB) plus `context/fixtures/parameter-sweep-corpus/index.csv` (one row per run: swept params, score, `finalGeneticDiversity`, `elapsedSeconds`, whether it ended via extinction, and its JSON filename). No DB rows or live registry entries from generation survive the run. Re-running `npm test` is unaffected (the generation test is excluded from the default suite). The corpus, once generated, is committed to the repo so S-34/S-35 never need to regenerate it.

### Verification

- All 20 exported JSON files parse and match the extended `CorpusRunRecord` shape (params + score + full history + `finalGeneticDiversity` + the run's own `maxDurationSeconds`/`crossbreedingEnabled`/`separationWeight`/`foodRegenRate` + whether it ended via extinction).
- `index.csv` has exactly 20 data rows plus a header, one per JSON file, with matching values.
- Across the 20 runs, every one of the five `PopulationPhase` values appears at least once in some run's `phaseHistory`.
- No `corpus-*@example.com` fixture users or `adminSettings` range distortion remain in the DB after the script finishes.

## What We're NOT Doing

- Not building S-34's suggestion-quality test or S-35's analytics-correctness tests — this slice only generates and exports the corpus; both are separate, already-scoped slices that depend on this one's output.
- Not varying `boidCount`, `predatorCount`, `foodStockInitial`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude`, `flockCount`, `xyArea`, or `zDepth` — the roadmap names exactly three dimensions (flocking weights via `separationWeight`, food regen rate, crossbreeding), and only `separationWeight` is varied among the flocking weights (see Phase 3 for why `alignmentWeight`/`cohesionWeight` are held at default rather than also swept).
- Not fixing every instance of unbounded array growth project-wide — only the six arrays in `single-run-lifecycle.ts`'s `computeSingleRunTick`, the ones actually on this slice's critical path.
- Not adding a general-purpose batching/concurrency utility beyond what this harness needs — the union-widen-once fix is scoped to `scripts/corpus/harness.ts`'s existing admin-range logic, not a new reusable primitive.
- Not committing to a CSV schema that mirrors FR-017's single-run download CSV — that convention deliberately excludes nested history, which this corpus needs to keep; `index.csv` is a lookup table, not a full-fidelity export, with the JSON files as the primary artifact.

## Implementation Approach

Fix the performance blocker first (Phase 1), since every later phase depends on full-duration runs actually finishing. Then make the harness batch-safe (Phase 2), since generation depends on it. Then build the sweep matrix and generation script (Phase 3) against the now-fixed, now-batch-safe foundation. Finally wire the npm script, run it for real, and verify the output (Phase 4) — the only phase that touches `package.json`/`vitest.config.ts` and actually produces the committed fixture files.

## Phase 1: Fix per-tick array growth in the simulation engine

### Overview

Convert the six per-tick sample arrays in `single-run-lifecycle.ts`'s `computeSingleRunTick` from full-copy `[...array, next]` rebuilds to mutate-in-place growth, and stop `phaseHistoryWindow` from mapping over the full history when only the last `PHASE_WINDOW_SIZE` entries are ever read.

### Changes Required:

#### 1. Mutate-in-place sample array growth

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Replace each of the six `[...array, next]` rebuilds (lines 124-153, 165) with an in-place push that returns the same array reference, turning per-tick cost from O(current length) to O(1) amortized. Safe because neither consumer (`simulation-canvas.tsx`'s refs, `server-run-registry.ts`'s reassigned `run` object) depends on referential identity or immutability of these arrays — see Current State Analysis.

**Contract**: `computeSingleRunTick`'s external signature (parameter shape, return shape) is unchanged — callers still receive `{ cohesionSamples, foodRatioSamples, ... }` as before; only the growth mechanism inside changes. The six fields affected: `cohesionSamples`, `foodRatioSamples`, `populationCountSamples`, `populationDensitySamples`, `geneticDiversitySamples`, `phaseHistory`.

#### 2. Window the phase-classification input

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Build `phaseHistoryWindow` (lines 154-160) from only the last `PHASE_WINDOW_SIZE` entries of `populationCountSamples`/`foodRatioSamples`, not the full history — `classifyPopulationPhase` already slices to the same window internally (`boids.ts:1301-1304`), so mapping the full array is pure waste once the arrays are long. `PHASE_WINDOW_SIZE` is not exported from `boids.ts` today; export it (or duplicate the literal `20` with a comment pointing at its source of truth) so this file doesn't hardcode a second copy of the same constant.

**Contract**: `phaseHistoryWindow`'s own shape (`{populationCount, foodAvailabilityRatio}[]`) and its role as `classifyPopulationPhase`'s input are unchanged — only how many entries it's built from changes (last ~20, not all).

#### 3. Regression test for snapshot/resume array independence

**File**: `src/server/simulation/server-run-registry.test.ts`

**Intent**: Add a test proving that after `snapshotServerRun` is called on a running run, further ticks on a *different* run (or, if the same run were hypothetically still registered, further pushes) never retroactively change the values already captured in the snapshot object — guarding against the aliasing risk named in Current State Analysis now that the arrays are mutated in place rather than replaced.

**Contract**: No production code changes from this item — pure test addition, following the existing start-two-runs-and-tick-together pattern already in this file (`server-run-registry.test.ts:904-947`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite passes: `npm test`
- New regression test (item 3 above) passes and demonstrates snapshot/resume array independence
- A new or extended test proves a run of several thousand ticks completes well within the existing test timeout, where it previously would have been measurably slower per tick as history grew (e.g. assert on tick count reached within a fixed wall-clock budget, not on an exact duration)

#### Manual Verification:

- None — this phase changes an internal growth mechanism with no user-visible behavior change; automated verification (identical scores/analysis before/after, via the existing full suite) is the complete signal.

---

## Phase 2: Batch-safe admin-range widening

### Overview

Add a union-widen-once path to `scripts/corpus/harness.ts` so a caller starting several runs as one batch widens the shared `adminSettings` row exactly once (to the union of every run's needed ranges) instead of racing per-call widen/restore across concurrent calls.

### Changes Required:

#### 1. Batch-scoped range widening

**File**: `scripts/corpus/harness.ts`

**Intent**: Add a function that folds `ensureAdminRangesAdmit`'s existing per-field min/max-widen logic (lines 94-111) across a list of param sets instead of one, writes the union once, and returns the pre-widen snapshot for a single restore after the whole batch has started.

**Contract**:
```ts
export async function ensureAdminRangesAdmitForBatch(
	db: DB,
	paramsList: Array<Partial<Record<RangedParameterName, number | boolean>>>,
): Promise<ParameterRanges> // pre-widen snapshot, same restore contract as ensureAdminRangesAdmit
```
Reuses the exact same boolean-coercion and min/max-widen rule as `ensureAdminRangesAdmit`, just iterated once per `RangedParameterName` per entry in `paramsList` instead of once per field in a single `params` object.

#### 2. A batch-call variant of `startCorpusRun` that skips its own widen/restore

**File**: `scripts/corpus/harness.ts`

**Intent**: `startCorpusRun`'s existing per-call `ensureAdminRangesAdmit`/restore (lines 166, 174-188) must not run when the caller has already widened for the whole batch — otherwise each call in the batch would still race on its own restore. Add an optional parameter so the batch caller can opt out of the per-call widen/restore while keeping the rest of `startCorpusRun`'s behavior (fixture owner insert, `startServer` call, owner cleanup on throw) identical.

**Contract**:
```ts
export async function startCorpusRun(
	db: DB,
	params: StartCorpusRunParams,
	opts?: { skipRangeWiden?: boolean },
): Promise<{ runId: number; ownerId: string }>
```
When `opts?.skipRangeWiden` is true, skip the `ensureAdminRangesAdmit` call and the `finally`'s restore entirely — the caller owns both. The owner-cleanup-on-throw behavior (`catch` block) is unaffected either way. Existing callers (F-08's own `harness.test.ts`) pass no third argument and keep today's exact per-call behavior — this is purely additive.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run scripts/corpus/harness.test.ts` — existing tests still pass unmodified (additive change)
- New tests in `scripts/corpus/harness.test.ts` confirming: (a) `ensureAdminRangesAdmitForBatch` widens to the union across several param sets and returns the correct pre-widen snapshot; (b) two concurrent `startCorpusRun(..., { skipRangeWiden: true })` calls, with the batch pre-widened via `ensureAdminRangesAdmitForBatch` first, both succeed without the race described in Current State Analysis (reproduce the race's precondition — both calls needing a wider range than default — and confirm neither spuriously rejects)
- Full suite passes: `npm test`

#### Manual Verification:

- None — this is backend test-infrastructure; automated verification is the complete signal.

---

## Phase 3: Sweep matrix and batched generation script

### Overview

Define the concrete ~20-run parameter matrix and build the orchestrator that batches 4 runs at a time through F-08's (now batch-safe) harness, exporting each completed run to a JSON file and a CSV index row.

### Changes Required:

#### 1. The sweep matrix

**File**: `scripts/corpus/sweep-matrix.ts` (new)

**Intent**: A pure function producing the approved 20-row matrix: `separationWeight` ∈ {0.5, 1, 2, 4} × `foodRegenRate` ∈ {2, 10, 30} × `crossbreedingEnabled` ∈ {true, false} (24 combinations), with 4 redundant corners dropped — the pairs where one swept field's extreme value already dominates the outcome regardless of the third field, making one of its two `crossbreedingEnabled` variants non-distinguishing: drop `{separationWeight: 4, foodRegenRate: 30, crossbreedingEnabled: false}`, `{separationWeight: 0.5, foodRegenRate: 2, crossbreedingEnabled: false}`, `{separationWeight: 4, foodRegenRate: 2, crossbreedingEnabled: false}`, `{separationWeight: 0.5, foodRegenRate: 30, crossbreedingEnabled: false}` — leaving all 4 `separationWeight × foodRegenRate` extremes represented at `crossbreedingEnabled: true` plus the remaining 16 combinations at both boolean values, for 20 rows total. Every other field (`boidCount`, `predatorCount`, `foodStockInitial`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude`, `flockCount`, `xyArea`, `zDepth`) stays at its `DEFAULT_PARAMETER_RANGES` default; `maxDurationSeconds` is 3600 for every row.

**Contract**:
```ts
export type SweepRunParams = StartCorpusRunParams & { sweepIndex: number };
export function buildSweepMatrix(): SweepRunParams[] // exactly 20 entries, 1-indexed sweepIndex
```

#### 2. Batched generation orchestrator

**File**: `scripts/corpus/generate-sweep.ts` (new)

**Intent**: Drive the full matrix through the harness in batches of 4 — 20 rows divides evenly into 5 batches of exactly 4, no remainder batch to special-case. For each batch: widen once via `ensureAdminRangesAdmitForBatch`, start all 4 runs via `startCorpusRun(db, params, { skipRangeWiden: true })`, advance the shared fake-timer clock in a bounded polling loop until every run in the batch has reached `status: "stopped"` (checking via a DB read each iteration; throw a clear error if a safety iteration ceiling is exceeded without all runs stopping), call `collectAndCleanupCorpusRun` for each, write each result to its JSON file, append its CSV row, then restore the admin ranges once for the batch. Before the first batch, defensively delete any stray `corpus-*@example.com` fixture users left over from a prior partial run (the user's own "start clean" requirement) — same DB delete pattern already used for manual fixture cleanup elsewhere in this codebase.

**Contract**:
```ts
export async function generateCorpus(db: DB, outDir: string): Promise<void>
```
Writes `outDir/run-<sweepIndex padded to 2 digits>.json` per run (the exported JSON extends `CorpusRunRecord` with `sweepIndex`, `separationWeight`, `foodRegenRate`, `crossbreedingEnabled`, `maxDurationSeconds`, and whether the run ended via extinction — derived by comparing its final `populationCountSamples` entry to 0) and `outDir/index.csv` with one header row plus 20 data rows (columns: `sweepIndex`, `separationWeight`, `foodRegenRate`, `crossbreedingEnabled`, `score`, `finalGeneticDiversity`, `elapsedSeconds`, `endedViaExtinction`, `file`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run scripts/corpus/sweep-matrix.test.ts` — new test confirming `buildSweepMatrix()` returns exactly 20 entries, no duplicate `sweepIndex`, and every entry's `maxDurationSeconds` is 3600
- `npx vitest run scripts/corpus/generate-sweep.smoke.test.ts` (scoped, short-duration smoke case, stays in the default `npm test` suite — see Phase 4 item 1 for why this must not share a filename with Phase 4's full-generation test) — new test running `generateCorpus` against a reduced 2-row matrix (not the full 20) with short `maxDurationSeconds`, confirming: both JSON files are written with the expected shape, `index.csv` has 2 data rows matching them, and no fixture owner rows remain afterward

#### Manual Verification:

- None — covered by the smoke test above; the full 20-run real generation and its manual-style spot-check happens in Phase 4.

---

## Phase 4: npm script wiring, real run, and verification

### Overview

Wire a discoverable `corpus:generate` npm script (excluded from the default `npm test` run, since it's a slow one-time step), run it for real against the full 20-row matrix, and verify the exported corpus actually represents all five population phases.

### Changes Required:

#### 1. Exclude the full-generation test from the default suite

**File**: `vitest.config.ts`

**Intent**: Add `scripts/corpus/generate-sweep.full.test.ts` to the existing `exclude` array (line 15) so `npm test`/CI never runs the slow, one-time full-corpus generation — same category as the existing `tests/e2e/**` exclusion (a script meant to be invoked deliberately, not swept into the default suite). Phase 3's smoke test lives in a distinctly-named sibling file, `scripts/corpus/generate-sweep.smoke.test.ts`, which is NOT added here, so it keeps running in `npm test`. (Plan-review F2: the two tests must not share a filename, or excluding one silently excludes the other.)

**Contract**: One new entry in the `exclude` array (`scripts/corpus/generate-sweep.full.test.ts` only); no other config changes.

#### 2. A dedicated Vitest config for the one-time generation run

**File**: `vitest.corpus.config.ts` (new)

**Intent**: Vitest's CLI `--exclude` flag merges into (never replaces) a config's `exclude` array (confirmed against the installed Vitest 5.1.0 source during plan review — `--exclude ''` does nothing to un-exclude a file). The only way to run a file `vitest.config.ts` excludes is a separate config that doesn't exclude it. This file duplicates `vitest.config.ts`'s `test.environment`/`test.env`/`test.server.deps.inline`/`resolve.tsconfigPaths` settings (so the generation test gets the same env vars and module resolution as the main suite) but sets `test.include` to just `["scripts/corpus/generate-sweep.full.test.ts"]` and has no `exclude` entry for it.

**Contract**: `defineConfig({ ...same resolve/test.environment/test.env/test.server settings as vitest.config.ts..., test: { include: ["scripts/corpus/generate-sweep.full.test.ts"] } })`.

#### 3. The `corpus:generate` script

**File**: `package.json`

**Intent**: A discoverable, manually-invoked command that runs the full-generation test through the dedicated config from item 2, raising the timeout well past Vitest's 5-second default, since even with Phase 1's fix this is a genuinely long one-time run (up to 5 sequential batches, each needing to tick up to 225,000 times per run in the worst case before any extinction shortcut applies).

**Contract**: `"corpus:generate": "vitest run --config vitest.corpus.config.ts --testTimeout=14400000"` (4 hours per test — widened twice, from an initial 20-minute budget to 60 minutes then to 4 hours, after real runs showed ordinary machine contention, such as another test suite running concurrently, can slow real wall-clock throughput enough to starve a shorter budget even though per-tick computation itself is fast; not a CI budget).

#### 4. The full-matrix generation test

**File**: `scripts/corpus/generate-sweep.full.test.ts` (new, excluded from default suite, run only via the dedicated config)

**Intent**: The actual entry point a maintainer runs via `npm run corpus:generate` — calls `generateCorpus(db, "context/fixtures/parameter-sweep-corpus")` against the real `buildSweepMatrix()` (all 20 rows), under `vi.useFakeTimers()`.

**Contract**: One `it(...)` (or equivalent) that performs the real generation and asserts the Desired End State's verification bullets (20 files present and well-shaped, `index.csv` row count, all five phases represented across the corpus, no leftover fixture rows).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npm test` still excludes `generate-sweep.full.test.ts` but still runs `generate-sweep.smoke.test.ts` (confirm `npm test` completes in roughly its prior duration, not 20+ minutes longer)
- `npm run corpus:generate` completes successfully and produces `context/fixtures/parameter-sweep-corpus/run-01.json.gz` through `run-20.json.gz` plus `index.csv`

#### Manual Verification:

- Spot-check 2-3 of the generated JSON files by hand: confirm `history.phaseHistory` contains a plausible phase sequence for that run's parameters (e.g. a low-`foodRegenRate` row's phases skew toward `crash`, a high-`foodRegenRate` row's skew toward `growth`/`establishment`) — this is the one place a human judgment call ("does this corpus actually look like a deliberate sweep, not noise") belongs, since the matrix's phase-targeting in Phase 3 is a hypothesis about the dynamics, not a guarantee.
- Confirm all five `PopulationPhase` values appear somewhere across the 20 runs' `phaseHistory` arrays combined — if one is missing entirely, note it as a follow-up for a future sweep revision rather than blocking this phase (the matrix was designed to target all five, but the dynamical system's actual behavior is the final authority).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `single-run-lifecycle.ts`'s mutate-in-place growth: existing tests in `server-run-registry.test.ts`/`simulation.test.ts` already assert on scores/analysis derived from these arrays — their continued passing is the primary regression signal.
- `sweep-matrix.ts`: exact row count, no duplicate indices, every row's `maxDurationSeconds` correct.
- `harness.ts`'s new batch-widen path: union-widen correctness, concurrent-call race reproduction (and non-occurrence after the fix).

### Integration Tests:

- Phase 3's smoke test: a reduced 2-row `generateCorpus` round trip through the real `createCaller`/fake-timer path, proving the export format and cleanup discipline without paying the full 20-run cost in every `npm test` run.

### Manual Testing Steps:

1. Run `npm run corpus:generate` and confirm it completes without manual intervention.
2. Open 2-3 of the generated JSON files and eyeball their `phaseHistory` against the sweep matrix's predicted phase targeting.
3. Confirm no stray `corpus-*@example.com` rows remain in the dev DB afterward.

## Performance Considerations

Phase 1's fix changes total engine cost from O(N²) to O(N) in tick count — the entire reason this slice is tractable at all. Phase 4's `corpus:generate` script is still expected to take real minutes (not seconds) to run once, given up to 5 sequential batches of up to 225,000 ticks each (minus whatever extinction shortcuts some crash-targeting rows hit) — this is accepted as a one-time cost, not optimized further, since the output is committed and never regenerated casually.

## Migration Notes

None — no schema changes. The exported corpus files are new, additive artifacts under `context/fixtures/`, not a migration of existing data.

## References

- Related research: `context/changes/parameter-sweep-corpus-generation/research.md`
- F-08's harness (this phase's foundation): `scripts/corpus/harness.ts`, archived plan at `context/archive/2026-11-15-corpus-generation-harness/plan.md`
- Concurrency race precedent: `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md` (finding F3)
- Phase classification: `src/server/simulation/boids.ts:1286-1403`
- Per-tick array growth: `src/server/simulation/single-run-lifecycle.ts:124-186`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix per-tick array growth in the simulation engine

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 247632c
- [x] 1.2 Linting passes: `npm run check` — 247632c
- [x] 1.3 Full suite passes: `npm test` — 247632c
- [x] 1.4 New regression test demonstrates snapshot/resume array independence — 247632c
- [x] 1.5 New/extended test proves a several-thousand-tick run completes well within the existing test timeout — 247632c

### Phase 2: Batch-safe admin-range widening

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 9243217
- [x] 2.2 Linting passes: `npm run check` — 9243217
- [x] 2.3 `npx vitest run scripts/corpus/harness.test.ts` — 9243217
- [x] 2.4 New tests confirm union-widen correctness and the concurrent-call race no longer occurs — 9243217
- [x] 2.5 Full suite passes: `npm test` — 9243217

### Phase 3: Sweep matrix and batched generation script

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 55481e8
- [x] 3.2 Linting passes: `npm run check` — 55481e8
- [x] 3.3 `npx vitest run scripts/corpus/sweep-matrix.test.ts` — 55481e8
- [x] 3.4 `npx vitest run scripts/corpus/generate-sweep.smoke.test.ts` (reduced smoke case) — 55481e8

### Phase 4: npm script wiring, real run, and verification

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck` — 52c4fc0
- [x] 4.2 Linting passes: `npm run check` — 52c4fc0
- [x] 4.3 `npm test` still excludes the full generation — 52c4fc0
- [x] 4.4 `npm run corpus:generate` completes and produces all 20 JSON files + `index.csv` — 52c4fc0

#### Manual

- [x] 4.5 Spot-check 2-3 generated JSON files' `phaseHistory` against predicted phase targeting — 52c4fc0
- [x] 4.6 Confirm all five `PopulationPhase` values appear somewhere across the corpus — 52c4fc0
