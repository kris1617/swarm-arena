# Vitest parallel flakiness Implementation Plan

## Overview

Make plain `npm test` (Vitest's default file-parallel mode, up to 37
concurrent worker processes on this machine) a trustworthy gate instead of
one that requires `--no-file-parallelism` to be believed. Two causes, fixed
independently: a confirmed cross-file DB race on the `admin_settings`
singleton (and its corpus-prefix stray-assertion cousin), and CPU/IO
contention causing spurious timeouts on slow-but-correct tests.

## Current State Analysis

- `startCorpusRun`'s own admin-range widen/restore (`ensureAdminRangesAdmit`,
  `scripts/corpus/harness.ts:87-119`) never deletes the `admin_settings` row
  — it only reads then `UPDATE`s. The only thing that ever makes the row
  briefly absent is 3 test files' own `afterEach: await
  db.delete(adminSettings)` (`src/server/api/routers/simulation.test.ts:153`,
  `scripts/corpus/harness.test.ts:75`,
  `scripts/corpus/generate-sweep.smoke.test.ts:28`), each resetting the
  singleton to defaults for their own next test. When one file's `afterEach`
  fires while a different file's test is mid-read of that row (separate
  concurrent Vitest worker processes under default parallelism, one shared
  `db.sqlite`), `getOrSeedAdminSettingsRanges`'s check-then-insert
  (`harness.ts:64-78`) races and throws
  `SQLITE_CONSTRAINT_PRIMARYKEY` — reproduced live during this change's
  research (`context/changes/vitest-parallel-flakiness/research.md`).
- `generate-sweep.smoke.test.ts:88-91` asserts zero rows anywhere match
  `corpus-%@example.com` after its own run — a false positive whenever
  `harness.test.ts`'s own legitimately-still-running, self-cleaning rows
  exist at that moment, since both files use the same email-prefix
  convention by design (it's `harness.ts:207`'s own production-shaped
  fixture-owner convention, not something this plan can rename away).
- `retry-worker.ts:38-42`'s `retryPendingReports()` queries the entire
  `feedbackReports` table by `status: "pending"`, with no owner scoping —
  intentional, since it is production code meant to retry every pending
  report system-wide. `feedback.test.ts` briefly creates a `status:
  "pending"` row before its own cleanup; `retry-worker.test.ts` asserts
  exact total call counts against the shared mock
  (`retry-worker.test.ts:93,113,131`), which breaks if that other file's row
  is picked up mid-window. Unconfirmed empirically (18 attempts, 0
  reproductions) but real by inspection.
- `loadCorpusFixture()` (`src/server/simulation/corpus-fixture.ts:73`) does a
  fresh synchronous disk-read + `gunzipSync` of 20 fixture files on every
  call, with no caching. Called from ≥9 places across the test suite
  (4 of them inside `corpus-fixture.test.ts`'s own 4 tests) — real,
  avoidable redundant I/O that feeds contention under 37 concurrent workers.
- Vitest 5.1.0 removed the old `poolOptions` per-pool worker cap in Vitest 4
  (confirmed against this installed version's own runtime source,
  `node_modules/vitest/dist/chunks/index.Di8au7q4.js:8823` — a config that
  still sets it is silently deprecated and no-ops). The only surviving
  concurrency knobs are `fileParallelism: false` (≡ `maxWorkers: 1`, fully
  serial — what `--no-file-parallelism` already does) and `maxWorkers:
  <n>` (a numeric/percentage cap, `plugin.d.LRFSN46m.d.ts:3805`). No
  `hookTimeout`/`testTimeout` override exists anywhere in this repo today.

### Key Discoveries:

- The `admin_settings` delete-then-reseed pattern is *necessary* for
  within-file test isolation (a test that widens a range can't leak into
  that file's own next test) but *fundamentally incompatible* with 3
  independent files all managing the same global singleton row's lifecycle
  concurrently — the fix is to stop deleting the row (upsert back to known
  defaults instead), not to stop resetting it.
- This exact bug *class* (an unnecessary cross-file blanket-delete racing
  against a sibling file's read/write) was already found and fixed once in
  this project, for a different table:
  `context/archive/2026-11-16-analytics-correctness-corpus-tests/reviews/impl-review.md`
  F1, commit `25a3161`. This plan applies the same "remove the destructive
  blanket reset" discipline, adapted for `admin_settings` where the row
  must still exist (can't just drop the reset outright — unlike that
  earlier fix, this singleton is read elsewhere, so "stop resetting" isn't
  an option; "stop deleting, upsert-restore instead" is).
- `updateParameterRanges` (`src/server/api/routers/simulation.ts:1303-1317`)
  already uses the exact `insert(...).onConflictDoUpdate(...)` shape this
  plan's reset helper needs — direct precedent to follow, not a new pattern.

## Desired End State

Plain `npm test` passes reliably under Vitest's default file parallelism,
with no code-level change to any file's actual test assertions about
production behavior (only test-isolation/scoping mechanics change) and no
change to any production business logic.

**Verification**: 10 consecutive runs of `npx vitest run
src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts
scripts/corpus/generate-sweep.smoke.test.ts src/server/feedback/retry-worker.test.ts
src/server/api/routers/feedback.test.ts` (default parallel pool) all pass; 5
consecutive full default `npm test` runs all pass; `npx vitest run
--no-file-parallelism` (the existing serial gate) stays green throughout.

## What We're NOT Doing

- Not changing `retryPendingReports`'s production behavior (still scans the
  whole table — that is its correct, intended job) — only the test
  assertions around it.
- Not adding Vitest config this version doesn't support (`poolOptions` is
  gone in Vitest 4+ — confirmed, not guessed).
- Not attempting to serialize specific file *pairs* relative to each other —
  Vitest 5.1 has no such mechanism; the admin-settings fix instead makes the
  underlying data race structurally impossible regardless of scheduling.
- Not touching `scripts/corpus/generate-sweep.full.test.ts` — excluded from
  the default suite already (`vitest.config.ts` `exclude`), out of scope for
  "plain `npm test`" reliability.
- Not chasing the documented 30000ms-vs-10000ms `hookTimeout` discrepancy
  from `research.md`'s Open Questions beyond raising the two affected
  `beforeAll` hooks' own explicit per-hook timeout values — not worth a
  separate investigation for this change.

## Implementation Approach

Fix the two confirmed data races at their root (upsert instead of delete;
diff-scoped instead of global-absolute assertions), defensively scope the
one unconfirmed hazard the same way, cut avoidable I/O that feeds
contention, add a worker cap as a second line of defense for whatever
contention remains, then prove all of it with repeated stress runs under
the exact default-parallel conditions that broke it.

## Phase 1: Shared admin-settings reset helper

### Overview

Replace the 3 files' `afterEach: await db.delete(adminSettings)` with a
shared upsert-to-defaults helper, removing the window where the row is
briefly absent for a concurrently-running file's read to crash on.

### Changes Required:

#### 1. Admin-settings reset helper

**File**: `src/server/db/admin-settings-test-reset.ts` (new)

**Intent**: One small, shared test-support function that restores the
`admin_settings` singleton row to its known defaults, callable from any test
file regardless of directory (`scripts/corpus/` or
`src/server/api/routers/`) via the `~/*` alias.

**Contract**:
```ts
export async function resetAdminSettingsToDefaults(db: DB): Promise<void>
```
Follows the exact `insert(...).onConflictDoUpdate({ target: adminSettings.id, set: {...} })` shape already used by `updateParameterRanges`
(`src/server/api/routers/simulation.ts:1303-1317`) — `values`/`set` both
carry `id: ADMIN_SETTINGS_ID` (the same hardcoded `1` duplicated across
`harness.ts`/`simulation.ts`), `parameterRanges: DEFAULT_PARAMETER_RANGES`,
`maxObjectCount: DEFAULT_MAX_OBJECT_COUNT`,
`maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT`
(`src/server/simulation/parameter-ranges.ts:39,71,107`). The row can never
become absent after this call — insert-if-missing, update-if-present, same
statement either way.

#### 2. Wire the helper into the 3 default-suite files

**Files**: `src/server/api/routers/simulation.test.ts:153`,
`scripts/corpus/harness.test.ts:75`,
`scripts/corpus/generate-sweep.smoke.test.ts:28`

**Intent**: Replace each file's `await db.delete(adminSettings);` with
`await resetAdminSettingsToDefaults(db);`, removing the now-unused
`adminSettings` import where it's no longer otherwise referenced.

**Contract**: No change to any test's own assertions or behavior — only the
cleanup mechanism changes from destructive-delete to upsert-restore.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts scripts/corpus/generate-sweep.smoke.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — the fix is a mechanical swap verified by the same existing tests continuing to pass.

---

## Phase 2: Scope the corpus-prefix stray-owner assertion

### Overview

`generate-sweep.smoke.test.ts`'s "leaves no fixture owners behind" check
becomes a before/after diff instead of an absolute global-zero assertion,
so a sibling file's concurrently-running, legitimately-not-yet-cleaned-up
row no longer counts as a failure.

### Changes Required:

#### 1. Diff-scoped stray-owner check

**File**: `scripts/corpus/generate-sweep.smoke.test.ts`

**Intent**: Snapshot the set of existing `corpus-*@example.com` owner IDs
before calling `generateCorpus`, then after it returns, assert that no
*new* IDs beyond that baseline remain — proving this test's own run didn't
leak anything, without asserting anything about rows a different
concurrently-running file created or is still cleaning up.

**Contract**:
```ts
const baselineIds = new Set(
	(await db.query.users.findMany({ where: (t, { like }) => like(t.email, "corpus-%@example.com") }))
		.map((u) => u.id),
);
// ...generateCorpus(...) call unchanged...
const afterOwners = await db.query.users.findMany({ where: (t, { like }) => like(t.email, "corpus-%@example.com") });
const newStrayOwners = afterOwners.filter((u) => !baselineIds.has(u.id));
expect(newStrayOwners).toHaveLength(0);
```

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run scripts/corpus/generate-sweep.smoke.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 3: Scope retry-worker.test.ts's assertions to its own report IDs

### Overview

Replace blanket total-call-count assertions with ones scoped to the
specific report IDs each test itself created, so a concurrently-running
`feedback.test.ts` pending row can no longer cause a false failure, while
still correctly proving the production filtering/idempotency behavior each
test targets.

### Changes Required:

#### 1. Scope the three affected assertions

**File**: `src/server/feedback/retry-worker.test.ts`

**Intent**: In each of the 3 tests whose assertions reference total call
count (`:93` "calls ... after the interval fires once", `:113` "does not
call ... for rows already sent or abandoned", `:131` "calling ... twice
does not register a second interval"), replace the blanket
`toHaveBeenCalledTimes(n)` / `not.toHaveBeenCalled()` check with one that
filters `mockedAttemptSendReport.mock.calls` by the specific report ID(s)
that test itself created, asserting the filtered count instead of the
total. `toHaveBeenCalledWith(...)` assertions that already name a specific
report ID stay as-is — only the count-style assertions change. The 4th
test (`:143`, "continues to the next row when attemptSendReport throws for
an earlier one") already only uses `toHaveBeenCalledWith` and needs no
change.

**Contract**: Each affected test still proves exactly the behavior its name
describes (fires once per interval tick, doesn't fire for non-pending rows,
doesn't double-register), now expressed as "N calls referencing my own
report ID" rather than "N calls total" — tolerant of any unrelated pending
row another concurrently-running file's test may have created.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run src/server/feedback/retry-worker.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 4: Cut contention — memoize the corpus fixture, cap workers, bump known-slow timeouts

### Overview

Reduce the I/O contention that causes cause #2's spurious timeouts, and add
a worker cap as a second line of defense for whatever contention remains
after Phases 1-3 remove the actual data races.

### Changes Required:

#### 1. Memoize `loadCorpusFixture()`

**File**: `src/server/simulation/corpus-fixture.ts`

**Intent**: Cache the computed result in a module-level variable on first
call within a process, since the committed fixture files never change
during a test run and this function is called from ≥9 places (4 inside its
own test file alone) — eliminating redundant synchronous disk-read +
`gunzipSync` work that's genuinely slower under contention.

**Contract**: `loadCorpusFixture()`'s exported signature and return value
are unchanged — purely an internal caching addition, transparent to every
caller.

#### 2. Cap concurrent workers

**File**: `vitest.config.ts`

**Intent**: Add `maxWorkers: 8` to the `test` config block — a cap well
below the up-to-37 concurrent workers observed today, while preserving
most of the wall-clock speedup over fully-serial `--no-file-parallelism`
(measured ~249-260s).

**Contract**: `test.maxWorkers: 8` (confirmed-supported option, this
installed Vitest 5.1.0 — `node_modules/vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:3805`).

#### 3. Raise timeouts for the specific tests observed timing out

**Files**: `src/server/simulation/corpus-fixture.test.ts`,
`src/server/simulation/parameter-suggestion.corpus.test.ts`,
`scripts/__tests__/agent-hooks.test.ts` (the "blocks (exit 2) on a lint
error written directly to disk" test, `:195`),
`src/server/api/routers/simulation.listLeaderboard.corpus.test.ts:30`,
`src/server/api/routers/simulation.getRunsComparison.corpus.test.ts` (its
equivalent `beforeAll`)

**Intent**: Raise each affected test/hook's own per-test timeout argument
(Vitest's `it(name, fn, timeoutMs)` / `beforeAll(fn, timeoutMs)` third-arg
form) rather than the global default, so a genuinely-hung test elsewhere
still fails fast. `corpus-fixture.test.ts` and
`parameter-suggestion.corpus.test.ts` currently have no explicit timeout
(inheriting the 5000ms global default) — give each test needing it an
explicit `15_000`. `agent-hooks.test.ts:195`'s subprocess-spawning test
similarly needs an explicit `15_000`. The two `*.corpus.test.ts` router
files' `beforeAll` hooks already pass `30_000` explicitly — raise both to
`45_000`.

**Contract**: No change to any test's assertions — only its own timeout
budget, scoped per-test/per-hook, never global.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/server/simulation/corpus-fixture.test.ts src/server/simulation/parameter-suggestion.corpus.test.ts scripts/__tests__/agent-hooks.test.ts src/server/api/routers/simulation.listLeaderboard.corpus.test.ts src/server/api/routers/simulation.getRunsComparison.corpus.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 5: Stress-test verification

### Overview

Prove the fix holds under the exact conditions that broke it — repeated
runs under default parallelism, not a single lucky green run.

### Changes Required:

#### 1. No code changes — verification only

This phase has no "Changes Required" — its Success Criteria below are the
deliverable: repeated empirical proof that the confirmed races and the
contention-driven timeouts no longer recur.

### Success Criteria:

#### Automated Verification:

- 10 consecutive green runs: `for i in $(seq 1 10); do npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts scripts/corpus/generate-sweep.smoke.test.ts src/server/feedback/retry-worker.test.ts src/server/api/routers/feedback.test.ts || break; done` (the exact file group this change's research confirmed racing)
- 5 consecutive green runs of the full default suite: `for i in $(seq 1 5); do npm test || break; done`
- The existing serial gate stays green: `npx vitest run --no-file-parallelism`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None — the automated repeated-run criteria above ARE the manual-testing-equivalent proof for a race-condition fix; there is no user-facing behavior to click through.

---

## Testing Strategy

### Unit Tests:

- Phases 1-3: each affected file's own existing test suite continues to
  pass, now exercising the scoped/upserted reset logic instead of the
  racy one.
- Phase 4: the 5 affected timeout-bumped files' own tests pass with their
  new budgets; `corpus-fixture.test.ts`'s behavior is unchanged by
  memoization (same return value, verified by its own existing assertions).

### Integration Tests:

- Phase 5 IS the integration layer here — repeated real-world runs under
  the exact default-parallel conditions research reproduced the failures
  under, not a single pass/fail sample.

### Manual Testing Steps:

- None required — this is a test-infrastructure reliability fix with no
  user-facing surface; every success criterion is automated.

## Performance Considerations

`maxWorkers: 8` trades some wall-clock speed for reliability relative to
unbounded default parallelism, but should still run meaningfully faster
than `--no-file-parallelism`'s measured ~249-260s. `loadCorpusFixture()`'s
memoization is a pure win — same correctness, strictly less I/O.

## Migration Notes

Not applicable — test-infrastructure-only change, no schema/data/API
changes, no production behavior changes.

## References

- Research: `context/changes/vitest-parallel-flakiness/research.md`
- Prior fix of the same bug class, different table: `context/archive/2026-11-16-analytics-correctness-corpus-tests/reviews/impl-review.md` F1, commit `25a3161`
- Precedent for the upsert shape: `src/server/api/routers/simulation.ts:1303-1317` (`updateParameterRanges`)
- Already-accepted, narrower-scope risk note this plan's Phase 1 supersedes for the cross-file case: `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared admin-settings reset helper

#### Automated

- [x] 1.1 Unit tests pass: npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts scripts/corpus/generate-sweep.smoke.test.ts — e347029
- [x] 1.2 Type checking passes: npm run typecheck — e347029
- [x] 1.3 Linting passes: npm run check — e347029

### Phase 2: Scope the corpus-prefix stray-owner assertion

#### Automated

- [x] 2.1 Unit test passes: npx vitest run scripts/corpus/generate-sweep.smoke.test.ts — 0b19024
- [x] 2.2 Type checking passes: npm run typecheck — 0b19024
- [x] 2.3 Linting passes: npm run check — 0b19024

### Phase 3: Scope retry-worker.test.ts's assertions to its own report IDs

#### Automated

- [x] 3.1 Unit test passes: npx vitest run src/server/feedback/retry-worker.test.ts — 36ccad4
- [x] 3.2 Type checking passes: npm run typecheck — 36ccad4
- [x] 3.3 Linting passes: npm run check — 36ccad4

### Phase 4: Cut contention — memoize the corpus fixture, cap workers, bump known-slow timeouts

#### Automated

- [x] 4.1 Unit tests pass: npx vitest run src/server/simulation/corpus-fixture.test.ts src/server/simulation/parameter-suggestion.corpus.test.ts scripts/__tests__/agent-hooks.test.ts src/server/api/routers/simulation.listLeaderboard.corpus.test.ts src/server/api/routers/simulation.getRunsComparison.corpus.test.ts — 51370a5
- [x] 4.2 Type checking passes: npm run typecheck — 51370a5
- [x] 4.3 Linting passes: npm run check — 51370a5

### Phase 5: Stress-test verification

#### Automated

- [ ] 5.1 10 consecutive green runs of the previously-racing file group
- [ ] 5.2 5 consecutive green runs of the full default suite (npm test)
- [ ] 5.3 Serial gate stays green: npx vitest run --no-file-parallelism
- [ ] 5.4 Type checking passes: npm run typecheck
- [ ] 5.5 Linting passes: npm run check
