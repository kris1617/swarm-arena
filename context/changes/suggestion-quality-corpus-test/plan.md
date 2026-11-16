# Suggestion-quality corpus test Implementation Plan

## Overview

Prove that `suggestParameterChange` (`src/server/simulation/parameter-suggestion.ts`) produces a correct, correlated suggestion against the real, persisted 20-row parameter-sweep corpus — turning the roadmap's "xcheck if we can get suggestions on parameters" into a repeatable regression check (roadmap S-34, FR-015). Along the way, close a real coverage gap discovered during planning (boolean ranged parameters are now live correlation candidates, untested anywhere) and build a small shared fixture-loader S-35 will reuse.

## Current State Analysis

- `suggestParameterChange(rows: SuggestionInputRow[]): ParameterSuggestion` is pure and DB-free (`src/server/simulation/parameter-suggestion.ts:107`) — directly callable with plain in-memory records. Its only current test, `parameter-suggestion.test.ts`, builds synthetic rows via a `BASELINE` (all 16 `RangedParameterName` fields) + `makeRow(score, overrides)` helper.
- The real 20-row corpus lives at `context/fixtures/parameter-sweep-corpus/` (`context/archive/2026-11-15-parameter-sweep-corpus-generation/`) as `run-01.json.gz` … `run-20.json.gz` + `index.csv`. Each exported record's `params` field (`CorpusRunRecord.params`, `scripts/corpus/harness.ts:44-57`) carries only **5** fields (`boidCount`, `predatorCount`, `foodStockInitial`, `foodRegenRate`, `protectionThreshold`) — not the full 16-field `RangedParameterName` set the heuristic needs. The other swept dimensions (`separationWeight`, `crossbreedingEnabled`, `maxDurationSeconds`) live as separate top-level fields on the exported `CorpusExportRow` (`scripts/corpus/generate-sweep.ts:56-63`), and 13 other ranged fields (`alignmentWeight`, `cohesionWeight`, `flockCount`, `energyThreshold`, `mutationChance`, `mutationMagnitude`, `xyArea`, `zDepth`) aren't present in the export at all — they were pinned at their `DEFAULT_PARAMETER_RANGES` default for every one of the 20 runs and the harness never bothered exporting them.
- `buildSweepMatrix()` (`scripts/corpus/sweep-matrix.ts:54-93`) is the pure, deterministic, side-effect-free function that originally produced each run's full 16-field params (keyed by `sweepIndex`) — it's the authoritative source of what each run was actually started with, and can be re-called at test time without touching the DB or regenerating anything.

### Key Discoveries:

- **Measured, deterministic heuristic output against the real corpus** (computed directly during planning, not assumed): reconstructing each run's full params via `buildSweepMatrix()` and merging in that run's real persisted `score`, `suggestParameterChange` returns `{ status: "ok", parameter: "foodRegenRate", direction: "increase", correlation: 0.6250155983924791, sampleSize: 20, confidence: "medium" }`. The next-closest candidate is `crossbreedingEnabled` (r ≈ 0.122), then `separationWeight` (r ≈ 0.037) — a ~5x gap, not a close call.
- **Only 3 of the 16 ranged parameters ever vary across this corpus**: `separationWeight`, `foodRegenRate`, `crossbreedingEnabled`. The other 13 are pinned constants for all 20 rows and are filtered out by `suggestParameterChange`'s own zero-variance check (`parameter-suggestion.ts:122-125`) before correlation is computed — they can never become the winning candidate for this specific corpus, by construction.
- **Drift in `RANGED_PARAMETER_NAMES`**: an archived plan-review (`context/archive/2026-11-14-parameter-suggestion-heuristic/reviews/plan-review.md:25`) asserts "exactly 13 names, all numeric; `crossbreedingEnabled` is deliberately not among them" — no longer true. `src/server/simulation/parameter-ranges.ts:5-24` now lists 16 names including `crossbreedingEnabled`, `xyArea`, `zDepth` (added by later changes). `suggestParameterChange`'s loop iterates `RANGED_PARAMETER_NAMES` with no boolean special-casing, coercing booleans via `Number(row[name])` (`parameter-suggestion.ts:120`) — so a boolean param can win today, and nothing currently tests that.

## Desired End State

A new unit test asserts `suggestParameterChange`, given the real persisted corpus's 20 runs, returns exactly `parameter: "foodRegenRate"`, `direction: "increase"`, `confidence: "medium"`, with a rationale mentioning "Food regen rate" — proving the heuristic's correlation ranking is correct against real simulation data, not just synthetic fixtures. A second new test case closes the untested boolean-correlation gap. A small shared loader lets S-35 (`analytics-correctness-corpus-tests`) read the same 20 runs without duplicating the gzip-decompression/full-params-reconstruction logic.

**Verification**: `npx vitest run src/server/simulation/parameter-suggestion.test.ts src/server/simulation/parameter-suggestion.corpus.test.ts src/server/simulation/corpus-fixture.test.ts` passes; full suite (`npm test`) stays green; `npm run typecheck` and `npm run check` stay clean.

## What We're NOT Doing

- Not changing `suggestParameterChange`'s own logic, confidence thresholds, or rationale wording — this change only adds tests against the existing, shipped heuristic.
- Not regenerating or modifying the committed corpus fixture (`context/fixtures/parameter-sweep-corpus/`) — read-only consumer, per the roadmap's explicit design ("S-34/S-35 both consume S-33's output independently, never regenerate it").
- Not building the S-35 analytics-correctness tests themselves — only the shared loader they'll import. S-35 remains an independent, parallel change that can start any time after this one lands (or never depend on it landing first, if S-35's own planning decides to duplicate the loading logic instead).
- Not adding a general-purpose "top-N" or fuzzy-match assertion helper — the exact-match decision below is specific to this corpus's measured, wide-margin result.

## Implementation Approach

Three small, independent-ish phases: a shared fixture-loader (so the gzip/full-params-reconstruction logic exists exactly once), the actual corpus-quality test built on it, and a scoped regression case in the existing synthetic unit test file for the boolean-correlation gap research surfaced. No production code changes — the entire change is new test files plus one new small, pure, test-support module.

## Critical Implementation Details

**Exact-match rationale, not a "top-N" bound**: the originally-discussed looser "top-3" bound turned out to be vacuous for this specific corpus — only 3 of the 16 ranged parameters ever vary across the 20 rows (the rest are pinned constants and get filtered out by the heuristic's own zero-variance check), so "top-3 of 3 eligible candidates" would always pass regardless of which one won. The plan therefore asserts the exact winning parameter, direction, and confidence level — grounded in a measured ~5x correlation gap between 1st and 2nd place, which makes an exact-match assertion not fragile in practice.

## Phase 1: Shared corpus-fixture loader

### Overview

A small, pure, synchronous module that reads and decompresses all 20 committed `.json.gz` files and reconstructs each run's full 16-field params by re-calling `buildSweepMatrix()` and merging in that run's real persisted fields. This phase's test file is also this change's own proof the loader works before Phase 2 builds on it.

### Changes Required:

#### 1. Corpus-fixture loader

**File**: `src/server/simulation/corpus-fixture.ts`

**Intent**: Load the real, persisted 20-run parameter-sweep corpus into memory as plain objects, each carrying its full reconstructed params (all 16 `RangedParameterName` fields, not just the 5 the export's `params` sub-object carries) alongside its real persisted `score`/`history`/`completedCycles`/`finalGeneticDiversity`/`endedViaExtinction`. This is the one place both this change's Phase 2 and the future S-35 change read the corpus from — keeping the gzip-decompression and full-params-reconstruction logic in exactly one file.

**Contract**:
```ts
export type CorpusFixtureRow = {
	sweepIndex: number;
	params: StartCorpusRunParams; // full 16-field set, from buildSweepMatrix()
	score: number; // loader throws if any run's persisted score is null
	history: unknown;
	completedCycles: unknown;
	finalGeneticDiversity: number;
	endedViaExtinction: boolean;
};

export function loadCorpusFixture(): CorpusFixtureRow[];
```
Reads from `context/fixtures/parameter-sweep-corpus/run-<NN>.json.gz` (NN = `sweepIndex` zero-padded to 2 digits, matching `generate-sweep.ts`'s own `runFileName`), resolved relative to the repo root via `process.cwd()` (same assumption `generate-sweep.full.test.ts` already makes about vitest's working directory). Imports `buildSweepMatrix` from `../../../scripts/corpus/sweep-matrix` (a relative import crossing from `src/` into `scripts/`, mirroring the direction `generate-sweep.ts` itself already imports from `~/server/...`, just reversed) and `type StartCorpusRunParams` the same way. Throws if a run's `sweepIndex` from the matrix has no matching file, or if any run's persisted `score` is `null` (fail loudly — a shrunk/moved corpus or an uncollected run should break loudly, not silently return a short array or a null score). Because of this, `CorpusFixtureRow.score` is typed as plain `number`, not `number | null` — callers never see the upstream `CorpusRunRecord.score: number | null` nullability. The `harness.ts` import must remain `import type { StartCorpusRunParams }` — a value import would pull `vitest`'s `vi` and the DB/drizzle client into this otherwise DB-free module (verified: the only runtime import this file needs is `buildSweepMatrix` from `sweep-matrix.ts`, itself lightweight).

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/simulation/corpus-fixture.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — pure, deterministic, fully covered by the automated test.

---

## Phase 2: Suggestion-quality corpus test

### Overview

The change's actual S-34 outcome: a test asserting `suggestParameterChange` returns the correct, exact suggestion against the real corpus.

### Changes Required:

#### 1. Corpus-quality test for the suggestion heuristic

**File**: `src/server/simulation/parameter-suggestion.corpus.test.ts`

**Intent**: Build `SuggestionInputRow[]` from `loadCorpusFixture()`'s 20 rows (score + the full params object, spread to match `SuggestionInputRow`'s `{ score } & Record<RangedParameterName, number | boolean>` shape) and call `suggestParameterChange` on them directly — the same pure function the real app calls, fed real simulation data instead of synthetic rows.

**Contract**: Assert on the `"ok"` branch of `ParameterSuggestion`:
- `parameter === "foodRegenRate"`
- `direction === "increase"`
- `confidence === "medium"`
- `sampleSize === 20`
- `rationale` contains the substring `"Food regen rate"` (the label, not the full formatted sentence — survives a copy/wording tweak to the surrounding sentence structure)

Do not assert the exact `correlation` float or the full rationale string — both are secondary to the four fields above and asserting them verbatim would make the test brittle to harmless formatting/precision changes without adding real protection.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/simulation/parameter-suggestion.corpus.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — the test's assertions are themselves the manual-verification-equivalent proof (a deterministic fixture, not live/async behavior).

---

## Phase 3: Boolean-correlation regression case

### Overview

Close the gap surfaced during this change's own research: `RANGED_PARAMETER_NAMES` grew to include boolean fields (`crossbreedingEnabled`, confirmed also live for `xyArea`/`zDepth` as numeric, but booleans specifically coerce via `Number()`) after the heuristic was built on a "numeric-only" assumption an archived plan-review explicitly asserted. Nothing today tests that a boolean parameter can actually win.

### Changes Required:

#### 1. Boolean-candidate regression case

**File**: `src/server/simulation/parameter-suggestion.test.ts`

**Intent**: Add one `it(...)` case to the existing `describe("suggestParameterChange", ...)` block, following the file's existing `BASELINE` + `makeRow(score, overrides)` pattern: construct rows where `crossbreedingEnabled` is the only field with real signal (strongest correlation with score among the varied fields), and assert the heuristic picks it as `parameter: "crossbreedingEnabled"` with the correct `direction` for a boolean win (`true`/`1` correlating positively → `"increase"`).

**Contract**: No change to `parameter-suggestion.ts` itself — this is a pure test addition. The case must use `overrides` that vary `crossbreedingEnabled` across at least `MIN_SAMPLE_SIZE` (3) rows with a clear, unambiguous correlation direction, so the assertion is not sensitive to iteration-order tie-breaking.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/simulation/parameter-suggestion.test.ts`
- Full suite stays green: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Testing Strategy

### Unit Tests:

- Phase 1: loader returns exactly 20 rows, each with a full 16-field `params` object and the real persisted `score`/`history`/etc. for a spot-checked `sweepIndex`.
- Phase 2: exact-match assertion against the real corpus's measured output (see Critical Implementation Details).
- Phase 3: synthetic boolean-correlation-wins case, isolated from the real corpus (uses the existing file's `BASELINE` pattern, not `loadCorpusFixture()`).

### Integration Tests:

- None — this change adds no new integration surface; `suggestParameterChange` is already integration-tested indirectly via the existing `getParameterSuggestion` tRPC procedure's own tests (untouched here).

### Manual Testing Steps:

- None required — every success criterion in this plan is automated and deterministic.

## Performance Considerations

Reading and gzip-decompressing 20 small files (~916KB total, per the corpus-generation change's own measurement) is well under a second — no performance concern for a test run under the default suite.

## Migration Notes

Not applicable — no schema, data, or API changes.

## References

- Heuristic under test: `src/server/simulation/parameter-suggestion.ts:107`
- Existing sibling unit test (pattern to follow): `src/server/simulation/parameter-suggestion.test.ts`
- Corpus generation change (source of the fixture): `context/archive/2026-11-15-parameter-sweep-corpus-generation/plan.md`
- Sweep matrix (full-params source of truth): `scripts/corpus/sweep-matrix.ts`
- Harness's narrow `CorpusRunRecord.params` type: `scripts/corpus/harness.ts:44-57`
- Roadmap item: `context/foundation/roadmap.md` S-34

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared corpus-fixture loader

#### Automated

- [x] 1.1 Unit test passes: npx vitest run src/server/simulation/corpus-fixture.test.ts — 10fac04
- [x] 1.2 Type checking passes: npm run typecheck — 10fac04
- [x] 1.3 Linting passes: npm run check — 10fac04

### Phase 2: Suggestion-quality corpus test

#### Automated

- [x] 2.1 Unit test passes: npx vitest run src/server/simulation/parameter-suggestion.corpus.test.ts — 773754a
- [x] 2.2 Full suite stays green: npm test — 773754a
- [x] 2.3 Type checking passes: npm run typecheck — 773754a
- [x] 2.4 Linting passes: npm run check — 773754a

### Phase 3: Boolean-correlation regression case

#### Automated

- [x] 3.1 Unit test passes: npx vitest run src/server/simulation/parameter-suggestion.test.ts
- [x] 3.2 Full suite stays green: npm test
- [x] 3.3 Type checking passes: npm run typecheck
- [x] 3.4 Linting passes: npm run check
