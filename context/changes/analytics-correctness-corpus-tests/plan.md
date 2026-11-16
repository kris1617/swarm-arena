# Analytics-correctness corpus tests Implementation Plan

## Overview

Confirm `getRunAnalysis`, `getRunsComparison`, and `listLeaderboard` — the three procedures roadmap S-35 names — handle the real 20-run parameter-sweep corpus's full range of parameter combinations (including 4 extinction-ended runs) without throwing or returning a malformed shape, by inserting the real corpus as actual completed DB rows and calling the real tRPC procedures end-to-end via `createCaller`. Also closes two pre-existing coverage gaps the corpus itself can't exercise (a short-tick-count phase-classification branch, an empty diversity-chart-samples case).

## Current State Analysis

- Every per-run analytics primitive (`computeGeneticDiversity`, `classifyPopulationPhase`, `segmentCompletedCycles`, `computePhaseQuality`, `computeResourceManagement`, `computeAreaPopulationDensity` — all `src/server/simulation/boids.ts`; `suggestRunOptimization` — `src/server/simulation/run-optimization-suggestion.ts:78`) is already unit-tested, but only against small hand-built synthetic arrays, never the real corpus.
- `getRunAnalysis` (`src/server/api/routers/simulation.ts:794-869`) is a thin tRPC aggregator: ownership/status gates, a guarded cast on the schema-less `history` JSON column, then three derived fields computed by calling straight into the primitives above (`completedCycles`, `finalGeneticDiversity`, `runOptimizationSuggestion`).
- `getRunsComparison` (`simulation.ts:877-979`) follows the identical pattern for 2-4 runs at once, inlining its own `breakdown` object instead of delegating to a shared helper, with per-row `error` markers (`"not-found"|"forbidden"|"not-completed"`) instead of hard-failing the whole call.
- `listLeaderboard` (`simulation.ts:696-725`) orders the caller's own completed, scored runs by `desc(score), desc(startedAt)` and derives one small boolean, `scoredWithAreaFactor: Array.isArray(history?.populationDensitySamples)` — this is itself real per-run logic worth exercising against the corpus (not a pure passthrough like `listCompleted`, which has zero computed fields and is out of scope here).
- The real corpus's actual edge case is narrower than "short runs": extinction-ended runs (4 of 20) still have 112K-225K-tick `phaseHistory`/sample arrays — what's genuinely empty is `survivorGenes: []` and `completedCycles: []`. Every `compute*` primitive already guards `length === 0 → 0`; no live bug was found, but this is unverified-until-tested-empirically, which is exactly this change's value.
- `src/server/api/routers/simulation.test.ts`'s existing `getRunAnalysis`/`getRunsComparison` tests already establish the exact DB-insertion pattern this change reuses: insert a `users` row, insert a `simulationRuns` row with `...VALID_START_INPUT` (the same 16-field shape as `CorpusFixtureRow.params`), `status: "stopped"`, `score`, `history`, then call via `createCaller` with a session for that owner.
- `src/server/simulation/corpus-fixture.ts`'s `loadCorpusFixture()` (built for S-34, already archived) is the one source of the real 20-run corpus's full params + persisted score/history/etc. — reused here as the DB-insertion helper's own input, not re-read from the gzip files directly.

### Key Discoveries:

- Two real, currently-untested gaps exist that the real corpus itself can never exercise (every run is either 112K+ or 225K ticks, never short): `classifyPopulationPhase`'s `history.length < 20 → "establishment"` branch (`boids.ts:1330`), and `buildDiversityChartData`'s empty-array case (`src/app/runs/[runId]/page.tsx:41`, zero existing coverage of `[]`). Both are closed here with small synthetic cases, independent of the corpus-driven phases.
- `getRunsComparison`'s `breakdown` composes primitives already covered by Phase 2's corpus-driven `getRunAnalysis` test — so Phase 3 only needs a small representative set of pairs (not exhaustive), proving the procedure's own wiring (ownership/status gates, per-row error markers, `breakdown` assembly) works against real data, not re-proving each primitive's correctness a second time.

## Desired End State

Three new corpus-driven test files insert the real 20-run corpus as completed DB rows and prove `getRunAnalysis` (all 20 runs), `getRunsComparison` (a representative set of pairs), and `listLeaderboard` (all 20 runs, ordering + the `scoredWithAreaFactor` derivation) never throw and always return a well-formed, plausible-range shape — including on the corpus's 4 extinction-ended runs. Two small synthetic test cases close the `classifyPopulationPhase` sub-20-tick and `buildDiversityChartData` empty-array gaps that the corpus itself cannot reach.

**Verification**: `npx vitest run src/server/api/routers/corpus-db-fixture.test.ts src/server/api/routers/simulation.getRunAnalysis.corpus.test.ts src/server/api/routers/simulation.getRunsComparison.corpus.test.ts src/server/api/routers/simulation.listLeaderboard.corpus.test.ts src/server/simulation/boids.test.ts src/app/runs/\[runId\]/page.test.ts` passes; full suite (`npm test`) stays green; `npm run typecheck` and `npm run check` stay clean.

## What We're NOT Doing

- Not changing any analytics function's own logic, `getRunAnalysis`/`getRunsComparison`/`listLeaderboard`'s procedures themselves, or the DB schema — this change only adds tests against already-shipped behavior.
- Not regenerating or modifying the committed corpus fixture (`context/fixtures/parameter-sweep-corpus/`) — read-only consumer via `loadCorpusFixture()`, same as S-34.
- Not testing `listCompleted` — it has zero computed/derived fields (a pure column passthrough), so the corpus adds no signal there beyond what `listLeaderboard`'s near-identical query already proves.
- Not testing every possible pair of the 20 runs via `getRunsComparison` (C(20,2) = 190 combinations) — a small representative set (including an extinction-vs-success pair) is sufficient once Phase 2 has already proven each individual run's analytics are sound.
- Not asserting exact pre-computed expected values (unlike S-34's single deterministic winner) — structural/plausible-range assertions only, per the explicit decision below.

## Implementation Approach

Five phases: a shared DB-insertion fixture helper (reusing the existing test file's established insertion pattern, fed by `loadCorpusFixture()`), three corpus-driven procedure tests built on it, and two independent synthetic gap-closing cases in existing test files.

## Critical Implementation Details

**Structural/plausible-range assertions, not exact values.** Unlike S-34's single deterministic winner (justified by a 5x correlation gap), this change's targets are three procedures each touching 20 real runs — hand-computing and maintaining exact expected outputs for all of them was explicitly rejected as disproportionate planning/maintenance cost. Every assertion here checks: no throw, correct shape (arrays where expected, no `undefined` where a value is required), and sane numeric bounds (e.g. `0 <= finalGeneticDiversity <= 1`, `completedCycles.length >= 0`). This matches the roadmap's own framing ("without throwing or returning a malformed shape") and is deliberately weaker than exact-match — a silent logic regression that stays in-range would not be caught by this change, and that tradeoff was made consciously.

**Single shared owner across all 20 inserted rows.** `listLeaderboard`'s ordering and `getRunAnalysis`/`getRunsComparison`'s ownership gates are all scoped to one `ctx.session.user.id` — the DB-insertion helper creates exactly one synthetic owner and inserts all 20 runs under it, matching how a real user's own completed runs would be scoped.

**Email prefix must NOT start with `corpus-`.** `scripts/corpus/generate-sweep.ts` and `generate-sweep.smoke.test.ts` both run `db.delete(users).where(like(users.email, "corpus-%@example.com"))` in the default `npm test` suite, against the same SQLite file this change's tests also use. SQL `LIKE 'corpus-%@example.com'` is a substring match, not an anchored prefix match — a would-be "distinguishable" prefix like `corpus-db-<uuid>` still matches it (plan-review F2, caught before implementation). Use `db-fixture-<uuid>@example.com` instead — a prefix that cannot match `corpus-%@example.com` under any substitution of `%`.

**`simulationRuns.seed` is required.** It's NOT NULL with no DB default, and is excluded from `StartCorpusRunParams`/`CorpusFixtureRow.params` (plan-review F1). Each inserted row needs its own explicit `seed` value — e.g. the loop index — matching the existing precedent in `simulation.test.ts`'s own `getRunAnalysis`/`getRunsComparison` fixture inserts (`seed: 1`).

## Phase 1: DB-insertion fixture helper

### Overview

A shared test-support module that loads the real corpus (`loadCorpusFixture()`) and inserts each of the 20 runs as a real, completed `users`+`simulationRuns` row — reusing the exact insertion shape `simulation.test.ts`'s own `getRunAnalysis` tests already establish, so this change introduces no new DB-row-shape convention.

### Changes Required:

#### 1. Corpus DB-fixture helper

**File**: `src/server/api/routers/corpus-db-fixture.ts`

**Intent**: Insert all 20 real corpus runs as completed (`status: "stopped"`) rows under one synthetic owner, returning each row's real `runId` keyed by `sweepIndex` so later phases can call the real procedures against real primary keys. Provide a matching cleanup function.

**Contract**:
```ts
export type InsertedCorpusRun = { sweepIndex: number; runId: number };

export async function insertCorpusRunsAsCompleted(
	db: DB,
): Promise<{ ownerId: string; runs: InsertedCorpusRun[] }>;

export async function cleanupCorpusDbFixture(
	db: DB,
	ownerId: string,
): Promise<void>;
```
`insertCorpusRunsAsCompleted` calls `loadCorpusFixture()` once, inserts one synthetic owner (email `db-fixture-<uuid>@example.com` — see "Critical Implementation Details" on why this prefix, not `corpus-*`), then for each row inserts one `simulationRuns` record with `userId: <that owner>`, `seed: <loop index>` (see "Critical Implementation Details" — required, not part of `StartCorpusRunParams`), `...row.params` (the full 16-field set, same shape `VALID_START_INPUT` already uses in `simulation.test.ts`), `status: "stopped"`, `score: row.score`, `history: row.history`. Defensive cleanup of any stray `db-fixture-%@example.com` owner rows first, mirroring this project's established per-run-fixture test isolation convention. `cleanupCorpusDbFixture` deletes the owner row (cascades to its `simulationRuns` rows via the existing FK).

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/api/routers/corpus-db-fixture.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — pure DB-insertion/cleanup round trip, fully covered by the automated test (insert, assert 20 rows exist with correct scores, cleanup, assert zero rows remain).

---

## Phase 2: getRunAnalysis corpus-correctness test

### Overview

Proves `getRunAnalysis` never throws and always returns a well-formed, plausible-range result across all 20 real runs, including the 4 extinction-ended ones.

### Changes Required:

#### 1. Corpus-driven test for getRunAnalysis

**File**: `src/server/api/routers/simulation.getRunAnalysis.corpus.test.ts`

**Intent**: Insert the corpus via Phase 1's helper, then `it.each` over all 20 `{sweepIndex, runId}` pairs, calling `caller.simulation.getRunAnalysis({ runId })` for the synthetic owner's own session.

**Contract**: For each run, assert the call does not throw, and on the resolved result: `completedCycles` is an array, `0 <= finalGeneticDiversity <= 1`, `runOptimizationSuggestion.status` is `"ok"` or `"insufficient-data"` (never anything else), and when `"ok"`, `dominantPhase` is one of the 5 `PopulationPhase` values and `rationale` is a non-empty string.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/api/routers/simulation.getRunAnalysis.corpus.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 3: getRunsComparison corpus-correctness test

### Overview

Proves `getRunsComparison`'s own wiring (ownership/status gates, per-row error markers, `breakdown` assembly) works against real data for a representative set of run pairs, without re-proving each primitive's correctness (already covered by Phase 2).

### Changes Required:

#### 1. Corpus-driven test for getRunsComparison

**File**: `src/server/api/routers/simulation.getRunsComparison.corpus.test.ts`

**Intent**: Insert the corpus via Phase 1's helper, then call `caller.simulation.getRunsComparison({ runIds: [a, b] })` for a small representative set of pairs: one extinction-vs-extinction pair, one extinction-vs-success pair, one success-vs-success pair (chosen from the known corpus data: e.g. sweepIndex 1 & 5 both extinction, 1 & 2 extinction-vs-success, 2 & 4 both success).

**Contract**: For each pair, assert the call does not throw, both result entries have no `error` field, and each `breakdown` is well-formed: `survival` is a number, `resourceManagement`/`geneticDiversity`/`phaseQuality` are numbers in `[0, 1]`, `areaPopulationDensity` is a number or `null`. Note: `breakdown` is only non-null when `history.elapsedSeconds` is a number (`simulation.ts:942`) — confirmed during planning that the real corpus's `history` objects always include `elapsedSeconds`, so `breakdown` is never null for any of the 20 runs; this is not an unstated assumption.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/api/routers/simulation.getRunsComparison.corpus.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 4: listLeaderboard corpus-correctness test

### Overview

Proves `listLeaderboard` correctly orders all 20 real runs by score and correctly derives `scoredWithAreaFactor` for every one of them.

### Changes Required:

#### 1. Corpus-driven test for listLeaderboard

**File**: `src/server/api/routers/simulation.listLeaderboard.corpus.test.ts`

**Intent**: Insert all 20 corpus runs under the one synthetic owner via Phase 1's helper, call `caller.simulation.listLeaderboard()` for that owner's session.

**Contract**: Assert the call does not throw, the result has 20 entries, scores are non-increasing in order (`result[i].score >= result[i+1].score` for every adjacent pair — avoids depending on a specific tie-break order among the corpus's several `score: 0` extinction runs), and every entry's `scoredWithAreaFactor` is `true` (the real corpus always has `populationDensitySamples`).

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/api/routers/simulation.listLeaderboard.corpus.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 5: Synthetic gap-closing cases

### Overview

Closes two pre-existing coverage gaps the real corpus itself cannot exercise: `classifyPopulationPhase`'s sub-20-tick branch, and `buildDiversityChartData`'s empty-array case. Independent of the corpus-driven phases above — pure synthetic additions to existing test files.

### Changes Required:

#### 1. classifyPopulationPhase sub-20-tick regression case

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Add one case to the existing `classifyPopulationPhase` `describe` block asserting that any `history` array shorter than the 20-sample classification window returns `"establishment"` regardless of what the (incomplete) data would otherwise suggest — e.g. a 5-entry history showing a sharp population decline still returns `"establishment"`, proving the length guard, not the decline pattern, controls the result.

**Contract**: No change to `boids.ts` itself — pure test addition.

#### 2. buildDiversityChartData empty-array case

**File**: `src/app/runs/[runId]/page.test.ts`

**Intent**: Add one case asserting `buildDiversityChartData([])` returns `[]` (not `undefined`, does not throw) — closing the one untested input shape for this function.

**Contract**: No change to `page.tsx` itself — pure test addition.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/simulation/boids.test.ts src/app/runs/[runId]/page.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Testing Strategy

### Unit Tests:

- Phase 1: insertion/cleanup round trip (20 rows in, scores correct, cleanup leaves zero rows).
- Phases 2-4: each procedure's own no-throw/well-formed/plausible-range assertions against real data, including the corpus's 4 extinction-ended runs.
- Phase 5: two isolated synthetic cases, independent of the corpus.

### Integration Tests:

- Phases 2-4 ARE the integration layer here — real DB rows, real `createCaller`-invoked procedures, not mocked.

### Manual Testing Steps:

- None required — every success criterion in this plan is automated and deterministic (the corpus is a fixed, committed fixture).

## Performance Considerations

Inserting 20 rows and running ~25 procedure calls (20 `getRunAnalysis` + 3 `getRunsComparison` pairs + 1 `listLeaderboard`) against SQLite is well under a second — no performance concern for the default test suite.

## Migration Notes

Not applicable — no schema, data, or API changes.

## References

- Procedures under test: `src/server/api/routers/simulation.ts:696` (`listLeaderboard`), `:794` (`getRunAnalysis`), `:877` (`getRunsComparison`)
- Analytics primitives: `src/server/simulation/boids.ts` (various), `src/server/simulation/run-optimization-suggestion.ts:78`
- Existing insertion pattern reused: `src/server/api/routers/simulation.test.ts` (`VALID_START_INPUT`, `getRunAnalysis`/`getRunsComparison` describe blocks)
- Corpus loader (S-34, already archived): `src/server/simulation/corpus-fixture.ts`
- Roadmap item: `context/foundation/roadmap.md` S-35

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB-insertion fixture helper

#### Automated

- [x] 1.1 Unit test passes: npx vitest run src/server/api/routers/corpus-db-fixture.test.ts — 10e0ed5
- [x] 1.2 Type checking passes: npm run typecheck — 10e0ed5
- [x] 1.3 Linting passes: npm run check — 10e0ed5

### Phase 2: getRunAnalysis corpus-correctness test

#### Automated

- [x] 2.1 Unit test passes: npx vitest run src/server/api/routers/simulation.getRunAnalysis.corpus.test.ts — 071bdb8
- [x] 2.2 Full suite stays green: npm test — 071bdb8
- [x] 2.3 Type checking passes: npm run typecheck — 071bdb8
- [x] 2.4 Linting passes: npm run check — 071bdb8

### Phase 3: getRunsComparison corpus-correctness test

#### Automated

- [x] 3.1 Unit test passes: npx vitest run src/server/api/routers/simulation.getRunsComparison.corpus.test.ts — 3f24ece
- [x] 3.2 Full suite stays green: npm test — 3f24ece
- [x] 3.3 Type checking passes: npm run typecheck — 3f24ece
- [x] 3.4 Linting passes: npm run check — 3f24ece

### Phase 4: listLeaderboard corpus-correctness test

#### Automated

- [ ] 4.1 Unit test passes: npx vitest run src/server/api/routers/simulation.listLeaderboard.corpus.test.ts
- [ ] 4.2 Full suite stays green: npm test
- [ ] 4.3 Type checking passes: npm run typecheck
- [ ] 4.4 Linting passes: npm run check

### Phase 5: Synthetic gap-closing cases

#### Automated

- [ ] 5.1 Unit test passes: npx vitest run src/server/simulation/boids.test.ts src/app/runs/[runId]/page.test.ts
- [ ] 5.2 Full suite stays green: npm test
- [ ] 5.3 Type checking passes: npm run typecheck
- [ ] 5.4 Linting passes: npm run check
