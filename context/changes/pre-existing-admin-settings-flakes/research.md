---
date: 2026-11-16T19:53:50+01:00
researcher: Claude Sonnet 5
git_commit: a7fa521dbdf3308e0fa2fb70f6c6fecbd44d0936
branch: master
repository: swarm-arena
topic: "Root cause of two pre-existing flaky tests surfaced by vitest-parallel-flakiness's stress testing"
tags: [research, codebase, admin-settings, flaky-tests, race-condition, contention]
status: complete
last_updated: 2026-11-16
last_updated_by: Claude Sonnet 5
---

# Research: Root cause of two pre-existing flaky tests surfaced by vitest-parallel-flakiness's stress testing

**Date**: 2026-11-16T19:53:50+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: a7fa521dbdf3308e0fa2fb70f6c6fecbd44d0936
**Branch**: master
**Repository**: swarm-arena

## Research Question

What actually causes (1) `simulation.test.ts`'s "lets an admin update ranges,
and start enforces the new bound" to intermittently fail, and (2) the
cluster of `harness.test.ts` failures observed during `vitest-parallel-flakiness`'s
stress testing — and is either one a genuine, fixable bug, or an artifact of
system load during measurement?

## Summary

**Both bugs are real, but their true failure rate is far lower than this
change's own `change.md` notes (written immediately after observing them)
assumed — the original observations were confounded by heavy concurrent
system load from other background processes running at the same time, not
purely from Vitest's own file-parallelism setting.**

1. **`simulation.test.ts`'s flake is real but rare in isolation (~1/10 to
   ~1/20 runs), and its rate scales sharply with unrelated system-wide CPU
   contention** (confirmed: 8/10 runs failed when measured while several
   other background stress-test batches were also running on this machine;
   1/10 and two independent clean batches of 8 and 3 runs failed when
   measured with nothing else running). The symptom is unchanged from the
   original observation: `memberCaller.simulation.start(...)` should reject
   `BAD_REQUEST` for an out-of-range `boidCount`, but intermittently throws
   `INTERNAL_SERVER_ERROR` wrapping `SQLITE_CONSTRAINT_PRIMARYKEY` from
   `getOrSeedAdminSettings` (`src/server/api/routers/simulation.ts:103`).
   Confirmed this function's own check-then-insert (`:91-108`) cannot race
   itself within one await chain, and confirmed `start`'s own handler calls
   it exactly once (via `insertRunningSimulation`, `simulation.ts:265`), no
   `Promise.all`/unawaited branch anywhere in that call path. **The exact
   trigger mechanism for how a single sequential await chain still
   occasionally hits the insert branch when the row should already exist
   is not yet pinned down** — left as an open question below.
2. **`harness.test.ts`'s apparent 4-test cluster is NOT a cascade** — 25
   full-file isolated runs and per-test isolated runs (8 each) showed the 3
   "victim" tests (`ensureAdminRangesAdmit`'s single-widen test,
   `ensureAdminRangesAdmitForBatch`'s union-widen test, the plain sequential
   round-trip test) never fail on their own or in file-order context,
   refuting the hypothesis that the file's one genuinely-concurrent test
   ("lets two concurrent batch-mode calls...", which runs LAST in file
   order and cannot retroactively affect earlier tests) corrupts shared
   state for them. **Only the concurrent test itself is flaky** (2/8 ≈ 25%
   in isolation), and its failures are exactly the already-accepted,
   already-documented risk from `corpus-generation-harness`'s archived
   review ("concurrent calls can clobber each other's widened range, no
   serialization"). The original observation of the 3 "victim" tests
   failing (captured in two runs of a 20-run batch, both run under heavy
   concurrent 5-file-group + default-project load) is best explained by
   the same system-contention amplification as finding #1 — not a new,
   independent bug, and not the cascade this research set out to confirm.

**Net effect**: there is really only ONE confirmed, still-unexplained logic
question (`simulation.ts`'s `getOrSeedAdminSettings` TOCTOU trigger) and ONE
already-fully-understood, already-accepted risk (`harness.ts`'s intentional
concurrent-widen test). Both are amplified — in probability, not in kind —
by heavy system-wide CPU contention, echoing `vitest-parallel-flakiness`'s
own lesson (`context/foundation/lessons.md`, "a single green run proves
nothing") but extending it: contention from processes *outside* Vitest's
own worker count (e.g. other background shells, other tools running on the
same machine) also measurably affects these specific tests' failure rate,
not just Vitest's internal `maxWorkers`.

## Detailed Findings

### Bug 1: `simulation.test.ts`'s admin-range-enforcement flake

- `getOrSeedAdminSettings` (`src/server/api/routers/simulation.ts:86-112`):
  a proper check-then-insert — `findFirst` by `ADMIN_SETTINGS_ID`, return
  early if found, otherwise `insert`. Cannot race against itself within one
  `await` chain.
- Call sites (`grep -n "getOrSeedAdminSettings("`): lines 131, 265, 1022,
  1095, 1275 — five call sites across different procedures
  (`checkAgainstMaxConcurrentObjectCount`-style helper at 131,
  `insertRunningSimulation` at 265, and three more at 1022/1095/1275 not
  yet individually traced to specific procedure names in this pass).
  `start`'s own handler (the failing test's target) was confirmed to call
  it exactly once via `insertRunningSimulation` — single await chain, no
  internal concurrency.
- The failing test's own sequence
  (`src/server/api/routers/simulation.test.ts:2557-2591`):
  `adminCaller.simulation.getParameterRanges()` (also calls
  `getOrSeedAdminSettings` internally) → `adminCaller.simulation.updateParameterRanges(...)`
  (a real upsert, `simulation.ts:1303-1319`) → `memberCaller.simulation.start(...)`.
  All three calls are sequentially awaited; nothing in this test's own code
  is concurrent.
- **Reproduction rate measured across this research session**:
  - Isolated to just this one test (`-t` filter), 5 runs with nothing else
    running: 5/5 passed.
  - Full file (89 tests) alone, 3 runs with nothing else running: 3/3
    passed (267/267 tests across the 3 runs).
  - Full file alone, 10 runs with nothing else running (a separate,
    later measurement in this same research pass): 9/10 passed, 1/10
    failed with the exact same `SQLITE_CONSTRAINT_PRIMARYKEY` symptom.
  - Full file alone, two earlier 5-run batches measured **while several
    other background Vitest stress-test batches were concurrently running
    on this machine** (from the preceding `vitest-parallel-flakiness`
    change's own Phase 5 investigation): 1/5 and 1/5 passed — i.e. 8/10
    failed under that concurrent system load.
  - This is at least a ~5-10x difference in observed failure rate between
    "nothing else running" and "heavy concurrent background load," using
    the exact same test, same file, same commit.
- **Open mechanism question** (not resolved in this pass): how does a
  purely-sequential await chain ever reach `getOrSeedAdminSettings`'s
  insert branch when the row should already exist (seeded by the test's
  own earlier `getParameterRanges()`/`updateParameterRanges()` calls, or by
  an earlier test's `afterEach` upsert)? Candidate explanations not yet
  distinguished: (a) a genuinely rare Node event-loop/libsql driver
  interleaving that only manifests under heavy system I/O pressure — SQLite
  itself is single-writer and the JS call order is strictly sequential, so
  this would require the libsql client to not preserve strict query
  ordering under contention, which hasn't been independently verified
  either way; (b) some other test file's helper call racing the same row
  in a way not yet identified. Resolving this would need live
  instrumentation (temporary logging around the `findFirst`/`insert` pair,
  captured during an actual failure) rather than further blind repeated
  runs — `/10x-plan` should decide whether that investment is worth it
  versus a purely defensive fix (see Related, below).

### Bug 2: `harness.test.ts`'s apparent multi-test flakiness

- File structure confirmed (`scripts/corpus/harness.test.ts`, 343 lines, 8
  tests): `ensureAdminRangesAdmit` (2 tests) → `ensureAdminRangesAdmitForBatch`
  (2 tests) → `startCorpusRun/collectAndCleanupCorpusRun round trip` (3
  tests) → `startCorpusRun batch mode (skipRangeWiden)` → "lets two
  concurrent batch-mode calls..." (1 test, LAST in file/document order).
  Vitest runs a file's tests in declaration order by default (no
  `.concurrent` used in this file), and this file's `fileParallelism: false`
  Vitest "serialized-shared-state" project setting (`vitest.config.ts:35-52`)
  means it never races against its sibling files either.
- `afterEach` (`:71-78`) calls `resetAdminSettingsToDefaults` (an
  unconditional upsert, never a delete) — the row is never transiently
  absent between tests, by construction.
- **Cascade hypothesis refuted**: 25 full-file isolated runs, 0 failures.
  Each of the 3 "victim" tests isolated via `-t`, 8 runs each, 0 failures.
  The concurrent test isolated via `-t "lets two concurrent batch-mode calls"`,
  8 runs: 2/8 failed, both with symptoms matching the already-documented,
  already-accepted risk from `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md`
  ("concurrent calls can clobber each other's widened range, no
  serialization... accepted as a documented risk") — it fails on its OWN
  assertions, never visibly affecting a sibling test in these 33 combined
  runs.
- The original observation that prompted this change (`pre-existing-admin-settings-flakes/change.md`,
  citing a 20-run batch from `vitest-parallel-flakiness`'s own Phase 5) saw
  `ensureAdminRangesAdmit`'s "widens only the fields actually out of
  range..." fail twice (runs r9 and r11 of that batch) — but that batch ran
  the file ALONGSIDE `simulation.test.ts`, `generate-sweep.smoke.test.ts`,
  `retry-worker.test.ts`, `feedback.test.ts`, AND the ~34-file "default"
  Vitest project all running concurrently under `maxWorkers: 8` — i.e.
  under exactly the kind of heavy system load that amplifies Bug 1's rate.
  Given 25/25 clean isolated runs found in this research pass, the most
  consistent explanation is that this specific test is *also* a rare,
  contention-amplified instance of the same unresolved TOCTOU-adjacent
  mechanism as Bug 1 (both this test and `ensureAdminRangesAdmit`'s read
  path ultimately call `getOrSeedAdminSettingsRanges`,
  `scripts/corpus/harness.ts:64-78`, the harness-side near-duplicate of
  `simulation.ts`'s `getOrSeedAdminSettings`) — not a cascade from the
  concurrent test, and not an independent bug in `ensureAdminRangesAdmit`'s
  own restore logic (its code was read and confirmed correct for sequential
  callers).

## Code References

- `src/server/api/routers/simulation.ts:86-112` - `getOrSeedAdminSettings`,
  the check-then-insert whose insert branch intermittently fails
- `src/server/api/routers/simulation.ts:131,265,1022,1095,1275` - all 5
  call sites of `getOrSeedAdminSettings`
- `src/server/api/routers/simulation.test.ts:2557-2591` - the failing test
- `scripts/corpus/harness.ts:64-78` - `getOrSeedAdminSettingsRanges`, the
  harness-side near-duplicate of the same pattern
- `scripts/corpus/harness.test.ts:296-342` - "lets two concurrent
  batch-mode calls...", the one genuinely-concurrent, already-accepted-risk
  test in this file
- `vitest.config.ts:31-84` - the Vitest Projects split
  (`vitest-parallel-flakiness`) that already serializes these 3 files
  relative to each other, but does not (and cannot) control OS-level
  contention from processes outside Vitest's own worker pool

## Architecture Insights

- `vitest-parallel-flakiness`'s fix (Vitest Projects + upsert-not-delete)
  correctly eliminated the *cross-file* races it targeted — confirmed by
  this research finding zero evidence of either original symptom
  (absence-window crash, stray-owner false-positive) recurring anywhere in
  this session's measurements. What remains is a different, narrower class
  of problem: a rare, not-yet-root-caused TOCTOU-shaped failure that
  predates that change, lives in production code (`getOrSeedAdminSettings`/
  `getOrSeedAdminSettingsRanges`'s own check-then-insert), and whose
  probability scales with *system-wide* contention, not just Vitest's own
  internal parallelism settings.
- This generalizes the lesson already recorded in
  `context/foundation/lessons.md` ("a single green run proves nothing
  about flakiness") — the corollary this research adds: *the measurement
  environment's own concurrent load matters as much as the number of
  repeated runs*. A test measured 5 times while nothing else runs can show
  a dramatically different failure rate than the same test measured 5
  times while other background processes are active, even on the same
  machine, same commit, same Vitest config.

## Historical Context (from prior changes)

- `context/archive/2026-11-16-vitest-parallel-flakiness/` - the change that
  fixed the two *confirmed* cross-file races and, via its own Phase 5
  stress-testing (itself measured under heavy concurrent background load,
  per this research's reconciliation), surfaced these two further flakes
  as out-of-scope and opened this follow-up change.
- `context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md` -
  the review that first accepted `ensureAdminRangesAdmitForBatch`'s
  concurrent-widen race as a documented, deliberately-unfixed risk. This
  research confirms that risk is still exactly as scoped (isolated to the
  concurrent test's own assertions) — its blast radius was NOT found to be
  wider than that review anticipated, contrary to this change's own
  `change.md`'s initial hypothesis.

## Related Research

- None prior to this change beyond the two archived changes cited above.

## Open Questions

- **Bug 1's exact trigger mechanism** is unresolved — see "Open mechanism
  question" under Detailed Findings. `/10x-plan` should decide between (a)
  a defensive fix (convert `getOrSeedAdminSettings`'s insert to
  `insert().onConflictDoNothing()` or similar, removing the crash without
  fully explaining why the TOCTOU window exists at all — fast, matches this
  project's existing upsert precedent, but leaves the "why" unanswered) or
  (b) deeper instrumentation-based root-causing (temporary logging around
  the read/insert pair, run under deliberately heavy system load until it
  captures a live failure) before deciding on a fix. Given the production
  code path affected (`getOrSeedAdminSettings` is called by `start`,
  `startServer`, and at least 3 other procedures per the call-site list
  above), a wrong defensive fix that merely silences the symptom without
  understanding it could mask a real data-integrity question (e.g., could
  the admin-configured ranges silently and briefly have reverted to
  defaults for other callers at the same moment this race fires in
  production, not just in tests?) — worth an explicit decision, not a
  silent "add onConflictDoNothing and move on."
- **Whether Bug 2's contention-amplified instances are truly the same root
  mechanism as Bug 1**, or merely correlated by both occurring more often
  under system load for unrelated reasons, was not independently confirmed
  — the evidence (shared `getOrSeedAdminSettings*` pattern, shared
  contention-sensitivity) is suggestive, not conclusive. If `/10x-plan`
  chooses option (b) above for Bug 1, the same instrumentation would likely
  resolve this question too, at no extra cost.
