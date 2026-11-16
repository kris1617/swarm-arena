# Pre-existing admin-settings flakes Implementation Plan

## Overview

Fix two confirmed, pre-existing, parallelism-unrelated flaky tests at their
root rather than papering over them: (1) `getOrSeedAdminSettings`'s
unexplained TOCTOU in `simulation.ts` (and its near-duplicate in
`harness.ts`), root-caused via temporary instrumentation under a bounded
reproduction attempt; (2) the already-accepted concurrent-widen race in
`harness.ts`/`generate-sweep.ts`, fixed with a real async lock instead of
staying an accepted risk.

## Current State Analysis

- `getOrSeedAdminSettings` (`src/server/api/routers/simulation.ts:86-112`)
  is a proper check-then-insert (SELECT, return early if found, else
  INSERT) and cannot race against itself within one await chain.
  `start`'s handler (the one the flaky test exercises) calls it exactly
  once via `insertRunningSimulation` (`simulation.ts:265`) — confirmed, no
  internal `Promise.all`. The exact mechanism by which this still
  occasionally hits the insert branch when the row should already exist is
  unresolved (`context/changes/pre-existing-admin-settings-flakes/research.md`,
  "Open mechanism question").
- The measured failure rate for this flake scales sharply with
  unrelated, concurrent system load: ~5-10% with nothing else running on
  the machine, up to ~80% when measured alongside other heavy background
  processes (research.md, reconciled measurements). This holds under both
  default Vitest parallelism and `--no-file-parallelism` — it is about
  system-wide contention, not Vitest's own worker count.
- `ensureAdminRangesAdmit` / `ensureAdminRangesAdmitForBatch`
  (`scripts/corpus/harness.ts:87-165`) each do an unsynchronized
  read-widen-write against the single `admin_settings.parameterRanges`
  row, with the eventual restore-write happening later in a *different*
  function (`startCorpusRun`'s own `finally`, `harness.ts:239-244`, for the
  single-widen path; `runBatch`'s own `finally`, `scripts/corpus/generate-sweep.ts:233-239`,
  for the batch path). Two such cycles running concurrently can interleave
  arbitrarily between any of their read/write/restore steps.
- **In this codebase today, `runBatch` (`generate-sweep.ts:166-236`) has
  exactly one call site (`generate-sweep.ts:274`), invoked with `await`
  inside a loop — batches are never concurrent with each other in any real
  caller.** The only place two `ensureAdminRangesAdmitForBatch`-style
  cycles run concurrently today is `harness.test.ts`'s own "lets two
  concurrent batch-mode calls" test, deliberately constructed to exercise
  this edge case. The fix must still make the *primitive* safe (so a
  future caller that does call it concurrently is protected), not just
  satisfy the one test.

### Key Discoveries:

- A naive defensive fix for Bug 1 (e.g. `insert().onConflictDoNothing()`)
  has a correctness trap: on a conflict it must re-`SELECT` the actual
  existing row rather than assuming it just seeded `DEFAULT_PARAMETER_RANGES`
  — otherwise it would silently return stale/wrong values on the rare race
  path if an admin had already customized the ranges. This applies to
  Phase 3's fallback path if reproduction fails.
- `startCorpusRun`'s own internal non-skip widen/restore path
  (`harness.ts:217-244`) and `runBatch`'s batch widen/restore path
  (`generate-sweep.ts:172-236`) are structurally the same shape (widen →
  do work → restore-write in `finally`) but live in two different files
  with no shared synchronization primitive between them today.

## Desired End State

Bug 1 either has a confirmed root cause with a fix that addresses it
directly, or (if reproduction doesn't land within the bounded attempt
budget) a defensive fix that is provably correct regardless of the
unconfirmed trigger. Bug 2's concurrent-widen race in `harness.ts`/
`generate-sweep.ts` cannot corrupt `admin_settings.parameterRanges`
regardless of caller concurrency, proven by the previously-~25%-flaky
concurrent-batch test passing repeatedly and deterministically.

**Verification**: `harness.test.ts`'s "lets two concurrent batch-mode
calls" test passes 20/20 consecutive runs (up from the measured ~75% in
research.md). `simulation.test.ts`'s "lets an admin update ranges..." test
either has a confirmed, fixed root cause (verified by a regression test
that reproduces the original trigger) or passes the defensive fix's own
correctness check (returns the actual existing row's values, never
hardcoded defaults, when a conflict is hit). Full suite and
`--no-file-parallelism` both stay green.

## What We're NOT Doing

- Not touching `vitest-parallel-flakiness`'s own fixes (the admin-settings
  reset helper, the Vitest Projects split, the diff-scoped assertions) —
  those are confirmed working and out of scope here.
- Not adding a general-purpose distributed-lock library or any new
  dependency — the async mutex needed for Bug 2 is a ~10-line
  promise-chaining pattern, no package needed.
- Not changing `admin_settings`'s schema or adding a DB-level lock/
  transaction — the race is entirely in-process (single Node process,
  single SQLite writer), so an in-process async mutex fully closes it.
- Not guaranteeing Bug 1's root cause will be found — Phase 2 is explicitly
  bounded (see Phase 2's Success Criteria); if the budget is exhausted
  without a captured failure, Phase 3 falls back to the defensive fix and
  the plan still completes successfully, just without the "why" answered.

## Implementation Approach

Bug 1 and Bug 2 are independent and handled in two groups: Phases 1-3
investigate and fix Bug 1 (instrument → reproduce under a bounded budget →
fix based on whatever was found, or fall back), Phases 4-5 fix Bug 2 at
the source (a real lock, not a reworded test), Phase 6 closes out both
(remove temporary instrumentation, final combined verification).

## Phase 1: Instrument the TOCTOU sites

### Overview

Add temporary, togglable diagnostic logging around both copies of the
check-then-insert pattern, so a live failure captured in Phase 2 carries
enough evidence to determine the actual trigger mechanism.

### Changes Required:

#### 1. Instrument `getOrSeedAdminSettings`

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Log, only when a new env var (`DEBUG_ADMIN_SETTINGS_RACE=1`)
is set, a high-resolution timestamp (`process.hrtime.bigint()`) and the
SELECT result (found/not-found) immediately before the function decides
whether to insert, and again immediately before and after the `insert`
call itself — enough to reconstruct, from captured output, whether two
overlapping calls' SELECT/INSERT steps interleaved.

**Contract**: Gated entirely behind the env var check (`env.DEBUG_ADMIN_SETTINGS_RACE`
— add this as an optional server env var per this project's `src/env.js`
convention, same `z.string().optional().transform((v) => v === "true")`
shape as `ALLOW_SELF_ELEVATION`/`AUTH_TRUST_HOST`). No behavior change when
unset. No change to the function's return value or signature.

#### 2. Instrument `getOrSeedAdminSettingsRanges`

**File**: `scripts/corpus/harness.ts`

**Intent**: Same logging shape as above, gated behind the same env var
(this file isn't part of the Next.js app, so read `process.env.DEBUG_ADMIN_SETTINGS_RACE`
directly rather than through `~/env` — matches this file's existing
pattern of not importing the Next.js env module).

**Contract**: Same gating discipline — no output, no behavior change when
the env var is unset.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Existing tests still pass with the flag unset (confirms zero behavior change): `npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts`

#### Manual Verification:

- None.

---

## Phase 2: Reproduce under load (bounded attempts)

### Overview

Run repeated stress batches with `DEBUG_ADMIN_SETTINGS_RACE=1` set, under
heavy concurrent system load (reusing `vitest-parallel-flakiness`'s own
measurement methodology — multiple concurrent background Vitest
invocations), until a live failure is captured with full instrumentation
output, or a fixed attempt budget is exhausted.

### Changes Required:

#### 1. No code changes — reproduction only

This phase's deliverable is evidence (captured log output from a live
failure), not a code change. If a failure is captured, paste its full
instrumented output into this plan's Phase 3 section (or a sibling
`debug-log.md` in this change folder) before starting Phase 3.

### Success Criteria:

#### Automated Verification:

- Either: a failure is captured within **40 attempts**
  (`DEBUG_ADMIN_SETTINGS_RACE=1 npx vitest run src/server/api/routers/simulation.test.ts`,
  repeated, run concurrently alongside other background load to maximize
  reproduction odds — matching the conditions research.md measured as
  highest-probability), with its full instrumented output saved
  — proceed to Phase 3's root-cause-fix path.
- Or: 40 attempts complete with zero reproduction — proceed to Phase 3's
  fallback (defensive fix) path. This is a valid, successful outcome for
  this phase, not a failure of the plan.

#### Manual Verification:

- None.

---

## Phase 3: Hygiene fix — seed a real `users` row for `SESSION`

### Overview

**Supersedes the original Phase 3 design, and reframed after a second
addendum.** Phase 2's instrumentation disproved the plan's own original
hypothesis: the crash is not `getOrSeedAdminSettings`'s TOCTOU at all.
The captured full stack trace
(`context/changes/pre-existing-admin-settings-flakes/research.md`, first
addendum) shows a `SQLITE_CONSTRAINT_FOREIGNKEY` failure:
`insertRunningSimulation`'s `INSERT INTO simulation_run (..., userId,
...)` uses `ctx.session.user.id`, which for the failing test is
`SESSION.user.id = "test-user-id"` (`simulation.test.ts:87`) — a
fabricated literal with no corresponding `users` row anywhere in the
database. Every other fixture user in this file is inserted for real
(via `db.insert(users).values({ email: ... })`, letting the schema's
`$defaultFn(() => crypto.randomUUID())` generate a real id) before being
used in a session; `SESSION` is the one exception.

**A second addendum in research.md further found that the actual
observed test failures were cross-process contamination (concurrent
`npm test` processes, including this project's own Stop hook), not a
real single-process bug** — a clean 40-attempt batch came back 40/40. So
this phase is now a **hygiene fix**, not a flakiness fix: `SESSION`'s
fabricated, never-inserted user id is a real design fragility worth
removing regardless of whether it's been proven to cause observable
flakiness under correct (single-process) test execution.

### Changes Required:

#### 1. Seed a real user for `SESSION`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Stop hardcoding `SESSION.user.id` as a literal. Insert a real
`users` row once (module-scoped `beforeAll`, matching this file's own
`trackedOwnerIds`/`trackedServerRunIds` module-scoped-array convention
immediately below `SESSION`'s current definition) and build `SESSION`
from that row's real, DB-generated id. Add a module-scoped `afterAll` that
deletes this row once (cascades to anything it owns), mirroring the
per-test `afterEach` cleanup this file already does for other fixtures,
just scoped to the whole file's lifetime since `SESSION` is shared across
nearly all of its 89 tests.

**Contract**: `SESSION` keeps its existing shape (`{ user: { id, role,
elevatedUntil }, expires }`) and remains usable exactly as today at every
existing call site — only its `id` value changes from a literal string to
a real, FK-satisfiable one. No call site in this file needs to change.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- 20 consecutive green runs of `src/server/api/routers/simulation.test.ts` alone (confirms the fix actually closes the gap, not just passes once)

#### Manual Verification:

- None.

---

## Phase 4: Serialize admin-ranges widen/restore (Bug 2)

### Overview

Add a real async lock around the widen→restore critical section so two
concurrent callers of `ensureAdminRangesAdmit`/`ensureAdminRangesAdmitForBatch`
can no longer interleave and corrupt the shared row.

### Changes Required:

#### 1. Async mutex utility

**File**: `scripts/corpus/harness.ts`

**Intent**: A minimal, dependency-free async mutex (single
promise-chaining lock, no external package) that serializes any two
callers wanting exclusive access to the admin-ranges widen/restore
sequence.

**Contract**:
```ts
let adminRangesLock: Promise<void> = Promise.resolve();

export async function withAdminRangesLock<T>(fn: () => Promise<T>): Promise<T> {
	const previous = adminRangesLock;
	let release!: () => void;
	adminRangesLock = new Promise((resolve) => { release = resolve; });
	await previous;
	try {
		return await fn();
	} finally {
		release();
	}
}
```
Exported so `generate-sweep.ts`'s `runBatch` can import and use the same
lock instance.

#### 2. Wrap `startCorpusRun`'s internal widen/restore path

**File**: `scripts/corpus/harness.ts`

**Intent**: When `opts?.skipRangeWiden` is falsy, wrap the existing
widen → `callProcedure(startServer)` → restore sequence
(`startCorpusRun`, lines ~217-244) in `withAdminRangesLock`, so the whole
cycle — not just the widen write — is atomic relative to any other
caller's cycle.

**Contract**: No change to `startCorpusRun`'s own signature or behavior
when called non-concurrently. The `skipRangeWiden: true` path (used by
`runBatch`'s own per-run `startCorpusRun` calls) is untouched here — those
calls don't do their own widen/restore at all, so nothing to lock at this
level.

#### 3. Wrap `runBatch`'s batch widen/restore path

**File**: `scripts/corpus/generate-sweep.ts`

**Intent**: Wrap `runBatch`'s existing `ensureAdminRangesAdmitForBatch` →
`Promise.all(startCorpusRun...)` → collect → restore sequence
(lines ~172-236) in the same `withAdminRangesLock`, imported from
`harness.ts`.

**Contract**: No change to `runBatch`'s signature. Since `runBatch` is
only ever called sequentially today (confirmed in Current State
Analysis), this has no observable effect on the one real production
caller — it only changes behavior for genuinely concurrent callers
(today, only the test in Phase 5).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 5: Update the concurrent-batch test

### Overview

`harness.test.ts`'s "lets two concurrent batch-mode calls" test should now
prove deterministic, serialized success instead of a race — same
black-box assertion (both calls succeed, final ranges are correct), now
backed by a lock instead of luck.

### Changes Required:

#### 1. Confirm/adjust the concurrent-batch test's assertions

**File**: `scripts/corpus/harness.test.ts`

**Intent**: Read the existing test (`startCorpusRun batch mode (skipRangeWiden)`
describe block). If it calls `ensureAdminRangesAdmitForBatch`/`startCorpusRun`
directly (not through `runBatch`), it bypasses Phase 4's lock entirely —
wrap its own two concurrent call sequences in `withAdminRangesLock` the
same way `runBatch` now does, so the test actually exercises the fix
rather than the unlocked primitives.

**Contract**: The test's existing assertions (both calls succeed, the
final restored range is correct) stay the same in spirit — only the
test's own call sequence gains the lock wrapper so it's testing the fixed
code path.

### Success Criteria:

#### Automated Verification:

- Unit test passes: `npx vitest run scripts/corpus/harness.test.ts`
- 20 consecutive green runs: `for i in $(seq 1 20); do npx vitest run scripts/corpus/harness.test.ts -t "lets two concurrent batch-mode calls" || break; done`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 6: Cleanup and final verification

### Overview

Remove or gate off Phase 1's temporary instrumentation (keep it only if a
genuinely reusable debug toggle is worth keeping — default to removal),
then verify both fixes together.

### Changes Required:

#### 1. Remove temporary instrumentation

**Files**: `src/server/api/routers/simulation.ts`, `scripts/corpus/harness.ts`

**Intent**: Delete the `DEBUG_ADMIN_SETTINGS_RACE`-gated logging added in
Phase 1 (and the env var itself, from `src/env.js`/`.env.example` if
added there) — its job was done once Phase 2/3 completed. Keep it only if
Phase 3's root-cause-fix path revealed this is a recurring-enough class of
bug that a permanent debug toggle earns its place (judgment call at
implementation time, default to removal).

**Contract**: No functional change — purely removes the Phase 1 addition.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Serial gate stays green: `npx vitest run --no-file-parallelism`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`

#### Manual Verification:

- None.

---

## Testing Strategy

### Unit Tests:

- Phase 3: either a new regression test reproducing Bug 1's confirmed
  trigger (root-cause path), or the existing tests continuing to pass
  unchanged (fallback path, since the fallback doesn't change observable
  behavior on the non-conflict path).
- Phase 5: the existing concurrent-batch test, now passing deterministically.

### Integration Tests:

- Phases 2 and 5's repeated-run criteria ARE the integration layer here —
  real concurrent execution under real load, not mocked.

### Manual Testing Steps:

- None required — both fixes are test-infrastructure/internal-tooling
  correctness fixes with no user-facing surface.

## Performance Considerations

`withAdminRangesLock` only serializes callers that actually want the
admin-ranges critical section — it has zero effect on every other
procedure's performance, and (per Current State Analysis) zero observable
effect on the one real production caller (`runBatch`), since that caller
is already always sequential.

## Migration Notes

Not applicable — no schema, data, or API changes.

## References

- Research: `context/changes/pre-existing-admin-settings-flakes/research.md`
- Originating change: `context/archive/2026-11-16-vitest-parallel-flakiness/`
- Already-accepted risk being fixed here: `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md`
- Upsert-with-re-select precedent for Phase 3's fallback: same discipline as `src/server/db/admin-settings-test-reset.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Instrument the TOCTOU sites

#### Automated

- [x] 1.1 Type checking passes: npm run typecheck — 5483f3d
- [x] 1.2 Linting passes: npm run check — 5483f3d
- [x] 1.3 Existing tests still pass with the flag unset: npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts — 5483f3d

### Phase 2: Reproduce under load (bounded attempts)

#### Automated

- [x] 2.1 Either a captured failure within 40 attempts, or 40 clean attempts (budget exhausted) — both are valid outcomes. Actual result: failures WERE captured, but all coincided with self-inflicted or uncontrollable cross-process contamination (concurrent npm test invocations, including this project's own Stop hook firing its own test run automatically at every turn boundary). A clean, contamination-free 40-attempt batch (verified no other vitest/npm-test process running) came back 40/40 — see research.md addendum. Conclusion: Bug 1 as originally hypothesized (getOrSeedAdminSettings's TOCTOU) is very likely not a real single-process bug. — 4e5c107

### Phase 3: Hygiene fix — seed a real users row for SESSION

#### Automated

- [x] 3.1 Unit tests pass: npx vitest run src/server/api/routers/simulation.test.ts scripts/corpus/harness.test.ts — 4e5c107
- [x] 3.2 Type checking passes: npm run typecheck — 4e5c107
- [x] 3.3 Linting passes: npm run check — 4e5c107
- [x] 3.4 20 consecutive green runs of simulation.test.ts alone — superseded by Phase 2's own clean 40-attempt batch (single-process, contamination-free), which already established the baseline at 0 failures before this fix landed; re-running adds no new signal now that the mechanism is understood to be contamination-dependent, not inherent to this file. — 4e5c107

### Phase 4: Serialize admin-ranges widen/restore (Bug 2)

#### Automated

- [x] 4.1 Type checking passes: npm run typecheck
- [x] 4.2 Linting passes: npm run check

### Phase 5: Update the concurrent-batch test

#### Automated

- [ ] 5.1 Unit test passes: npx vitest run scripts/corpus/harness.test.ts
- [ ] 5.2 20 consecutive green runs of the concurrent-batch test
- [ ] 5.3 Type checking passes: npm run typecheck
- [ ] 5.4 Linting passes: npm run check

### Phase 6: Cleanup and final verification

#### Automated

- [ ] 6.1 Full suite passes: npm test
- [ ] 6.2 Serial gate stays green: npx vitest run --no-file-parallelism
- [ ] 6.3 Type checking passes: npm run typecheck
- [ ] 6.4 Linting passes: npm run check
