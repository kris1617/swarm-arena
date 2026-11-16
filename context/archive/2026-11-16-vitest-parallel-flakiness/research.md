---
date: 2026-11-16T17:29:32+01:00
researcher: Claude Sonnet 5
git_commit: 6ecf377172fa3fe35b81bb99ba6d0b72882605b1
branch: master
repository: swarm-arena
topic: "Make plain `npm test` reliable under Vitest's default file parallelism"
tags: [research, codebase, vitest, test-isolation, flaky-tests, adminSettings, feedback]
status: complete
last_updated: 2026-11-16
last_updated_by: Claude Sonnet 5
---

# Research: Make plain `npm test` reliable under Vitest's default file parallelism

**Date**: 2026-11-16T17:29:32+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 6ecf377172fa3fe35b81bb99ba6d0b72882605b1
**Branch**: master
**Repository**: swarm-arena

## Research Question

Why is plain `npm test` (`vitest run`, no flags) flaky on this machine, while
`npx vitest run --no-file-parallelism` is reliably green — and what's the
smallest fix that makes plain `npm test` a trustworthy gate, without
necessarily paying the full ~5x wall-clock cost of going serial?

## Summary

Two independent causes, not one:

1. **A genuine, confirmed, reproducible cross-file DB race on the
   `adminSettings` singleton table.** Three files in the default suite
   (`src/server/api/routers/simulation.test.ts:153`,
   `scripts/corpus/harness.test.ts:75`,
   `scripts/corpus/generate-sweep.smoke.test.ts:28`) each run
   `await db.delete(adminSettings)` in their own `afterEach`, unconditionally,
   with no `where` clause, to reset the one-row settings singleton between
   tests. Any one of these files' `afterEach` can fire while a *different*
   file's test is mid-read/write of that same row (the three files' tests
   run as separate concurrent Vitest worker processes under default
   parallelism, sharing one `db.sqlite`). The Stop hook caught this live
   during this research session: a `harness.test.ts` test crashed with
   `SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed:
   .bootstrap-scaffold_admin_settings.id` from
   `getOrSeedAdminSettingsRanges` (`scripts/corpus/harness.ts:71`) — a
   classic TOCTOU: it checked the row was absent, then another file's
   `afterEach` deleted it out from under a third file's read, and the
   check-then-insert collided. This is the same *class* of bug as the
   `corpus-*@example.com` prefix collision already fixed in
   `analytics-correctness-corpus-tests` (commit `25a3161`), but on a
   different table, and **not yet fixed** — all three call sites are still
   live in the default suite today.

2. **Pure CPU/IO contention under up to 37 concurrent worker processes**
   (one per test file, confirmed from observed Vitest output: "Isolate 37
   workers spawned"), causing hard `testTimeout` (default 5000ms) and
   `hookTimeout` failures on slow-but-correct tests — e.g. `beforeAll` hooks
   doing ~20 sequential DB inserts (`simulation.listLeaderboard.corpus.test.ts`),
   gzip-reading a fixture file (`corpus-fixture.test.ts`), and fake-timer
   tests (`retry-worker.test.ts`) whose `vi.advanceTimersByTimeAsync` races
   real wall-clock scheduling when the process is starved. These are
   **not correctness bugs** — every affected test passes reliably run alone
   or under `--no-file-parallelism` — but they are a real, repeatedly
   observed flakiness source under the default parallel mode.

A third, narrower hazard was investigated and **not confirmed**:
`src/server/feedback/retry-worker.ts`'s `retryPendingReports()` queries
`feedbackReports` by `status: "pending"` across the whole table with no
owner scoping (`src/server/feedback/retry-worker.ts:38-42`), and
`src/server/api/routers/feedback.test.ts` briefly leaves a `status:
"pending"` row in that same table before its own cleanup. The hazard is
real in principle, but 18 attempted reproductions (13 runs of both files
together, 5 of `retry-worker.test.ts` alone, all under default parallel
mode) produced zero failures of this specific kind — the timing window is
apparently too narrow to hit with only 2 concurrent workers. The repeated
Stop-hook failures seen in `retry-worker.test.ts` during this session (3/3
and then 1/3 of its fake-timer tests failing, with inflated call counts
like "expected 1, got 6") are better explained by cause #2 above (fake-timer
vs. real-wall-clock racing under full 37-worker contention) than by this
hazard, since the full-suite run is where contention is worst and this
narrow 2-file repro never reproduced it.

No config knob in the installed Vitest 5.1.0 can reduce the probability of
cause #1 to zero while keeping any concurrency — `poolOptions` (the
Vitest-3-era per-pool worker cap) was removed in Vitest 4 and silently
no-ops if written (confirmed in `node_modules/vitest/dist/chunks/
index.Di8au7q4.js:8823`). The only surviving knobs are `fileParallelism:
false` (≡ `maxWorkers: 1`, fully serial, confirmed via
`node_modules/vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:3812`) and
`maxWorkers: <n>` (a numeric/percentage cap, confirmed at the same file
line 3805) — the latter *reduces* the odds of two `adminSettings`-touching
files landing in the same window, but does not eliminate the race, since
all 3 offending files could still end up scheduled concurrently under any
`maxWorkers > 1`.

## Detailed Findings

### Cause 1: `adminSettings` singleton reset races across 3 files

- `src/server/api/routers/simulation.test.ts:148-152` — `afterEach(async () =>
  { await db.delete(adminSettings); ... })`, comment: "Reset the
  admin-settings singleton so a test that edits ranges can't leak state into
  a later test — `getOrSeedAdminSettings` reseeds the default row on next
  read."
- `scripts/corpus/harness.test.ts:70-75` — same pattern, explicitly says
  "Same reset discipline as simulation.test.ts's afterEach."
- `scripts/corpus/generate-sweep.smoke.test.ts:24-28` — same pattern again,
  "Same reset discipline harness.test.ts's own afterEach uses."
- `scripts/corpus/generate-sweep.full.test.ts:42-50` — same pattern plus the
  `corpus-*@example.com` prefix delete, but this file is excluded from the
  default suite (`vitest.config.ts` `exclude` array lists
  `"scripts/corpus/generate-sweep.full.test.ts"` explicitly) — confirmed not
  part of default-`npm test` flakiness, but relevant if this file is ever
  run alongside the other three via `vitest.corpus.config.ts`.
- The write path these afterEach hooks are guarding against:
  `getOrSeedAdminSettingsRanges` (`scripts/corpus/harness.ts:60-76` area) —
  check-then-insert: read `adminSettings` by `ADMIN_SETTINGS_ID`, if absent
  insert the default row. Classic TOCTOU when the "absent" state is being
  produced by a *different file's* concurrent `afterEach` delete, not a
  stable precondition.
- **Confirmed live during this research session**: a Stop-hook-triggered
  `npm test` run failed `harness.test.ts`'s own "lets two concurrent
  batch-mode calls both succeed when both need a wider range than default"
  test with exactly this error — `SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE
  constraint failed: .bootstrap-scaffold_admin_settings.id` from
  `getOrSeedAdminSettingsRanges` at `scripts/corpus/harness.ts:71`, called
  from `ensureAdminRangesAdmitForBatch` (`harness.ts:132`). Note this
  specific test is *also* about a known, already-accepted within-process
  concurrency risk ("concurrent calls can clobber each other's widened
  range, no serialization" — accepted as a documented risk when
  `corpus-generation-harness` was archived, 2026-11-15) — but the actual
  failure observed was the *cross-file* table-wipe variant, not the
  within-process one that risk note was about.
- Grep confirms only these 4 files (3 in default suite + 1 excluded)
  reference `adminSettings` with a delete; no other test file touches this
  table, so the blast radius is fully contained to this group.

### Cause 2: contention-driven timeouts on slow-but-correct tests

- Default `testTimeout` is 5000ms, default `hookTimeout` is documented as
  10000ms in the installed Vitest 5.1.0 type definitions
  (`node_modules/vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:3873,3879`) — but
  the Stop hook's observed failures cite a 30000ms hook timeout
  (`simulation.listLeaderboard.corpus.test.ts`'s `beforeAll`). No
  `hookTimeout`/`testTimeout` override exists anywhere in this repo's
  `vitest.config.ts` or `package.json` (`grep -rn "hookTimeout"` across the
  repo, excluding `node_modules`, returns nothing) — the discrepancy
  between the documented 10000ms default and the observed 30000ms boundary
  is unresolved; flagging as an open question rather than guessing further.
- Repeated observed timeout victims across multiple Stop-hook runs this
  session: `src/server/simulation/corpus-fixture.test.ts` ("returns exactly
  20 rows", gzip read, 5000ms test timeout, observed taking 8-19s under
  contention), `src/server/simulation/parameter-suggestion.corpus.test.ts`
  (5000ms test timeout), `scripts/__tests__/agent-hooks.test.ts` (subprocess
  spawn, 5000ms test timeout), `src/server/api/routers/
  simulation.listLeaderboard.corpus.test.ts` /
  `simulation.getRunsComparison.corpus.test.ts` (30000ms `beforeAll` hook
  timeout on a ~20-row sequential DB insert that normally takes well under
  that). Different files fail on different runs — consistent with
  nondeterministic CPU/IO starvation, not a fixed broken test.
- All of the above pass cleanly in isolation (individually verified for
  several of them during `analytics-correctness-corpus-tests`'s
  implementation review) and under `npx vitest run --no-file-parallelism`
  (396/396 confirmed green, same session).

### Cause 3 (investigated, not confirmed): `retryPendingReports` unscoped query

- `src/server/feedback/retry-worker.ts:38-42` — `retryPendingReports()`
  queries `db.query.feedbackReports.findMany({ where: eq(status,
  "pending"), orderBy: asc(createdAt), limit: 10 })` — no owner/test
  scoping, genuinely table-wide.
- `src/server/api/routers/feedback.test.ts` has a test ("returns status:
  queued and leaves the row pending when GitHub is unreachable") that
  inserts a `status: "pending"` `feedbackReports` row, cleaned up by its own
  `afterEach` cascading through the owner's `users` row delete.
- In principle, if `retry-worker.test.ts`'s fake-timer-driven tick fires
  while that row briefly exists, `attemptSendReport`'s mock would be called
  for it too, inflating the expected-1 assertions seen failing in this
  session's Stop-hook output.
- **Empirically**: 13 runs of both files together + 5 runs of
  `retry-worker.test.ts` alone, all under default parallel mode — 0
  failures of this kind. The hazard is real by code inspection but the
  2-file timing window may be too narrow to hit without the full 37-worker
  contention load; not reproduced standalone. Left as an open question
  rather than a confirmed root cause of the observed failures — cause #2
  (fake-timer races under contention) better explains what was actually
  observed in full-suite runs this session.

### Vitest 5.1.0 concurrency-control options (confirmed against installed version)

- `pool` defaults to `'forks'` (process isolation) per
  `node_modules/vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:3797` — already
  the default here (`vitest.config.ts` sets no `pool`), and the right choice
  for this workload (native SQLite bindings, real file I/O) over `'threads'`
  (better suited to CPU-bound pure-JS).
- `poolOptions` (the Vitest-3-era `poolOptions.forks.singleFork`/`maxForks`/
  `minForks` knobs) **no longer exists** — Vitest 4 removed it; the runtime
  logs a deprecation warning and no-ops if a config still sets it
  (`node_modules/vitest/dist/chunks/index.Di8au7q4.js:8823`).
- `fileParallelism: false` is documented as overriding `maxWorkers` to `1`
  (`plugin.d.LRFSN46m.d.ts:3812`) — confirms this is exactly equivalent to
  the `--no-file-parallelism` CLI flag already used as this project's de
  facto full-suite gate.
- `maxWorkers?: number | string` (`plugin.d.LRFSN46m.d.ts:3805`, accepts a
  percentage string) is the **only** surviving partial-cap lever — no
  `minWorkers` exists in this version (searched, not found). Setting e.g.
  `maxWorkers: 4` reduces concurrent-worker count from up to 37 to 4,
  lowering (not eliminating) the odds that two of the 3 `adminSettings`
  -touching files collide, and should also reduce CPU/IO contention enough
  to help cause #2's timeout flakes — but does not structurally fix cause
  #1, since the 3 offending files could still land in the same 4-worker
  window.

## Code References

- `src/server/api/routers/simulation.test.ts:153` - unscoped
  `db.delete(adminSettings)` in `afterEach`
- `scripts/corpus/harness.test.ts:75` - unscoped `db.delete(adminSettings)`
  in `afterEach`
- `scripts/corpus/generate-sweep.smoke.test.ts:28` - unscoped
  `db.delete(adminSettings)` in `afterEach`
- `scripts/corpus/generate-sweep.full.test.ts:46,50` - same pattern, file
  excluded from default suite via `vitest.config.ts`
- `scripts/corpus/harness.ts:71` - `getOrSeedAdminSettingsRanges`'s
  check-then-insert, the call site that actually threw
  `SQLITE_CONSTRAINT_PRIMARYKEY` during this session
- `src/server/feedback/retry-worker.ts:38-42` - `retryPendingReports`'s
  unscoped `status: "pending"` query
- `src/server/api/routers/feedback.test.ts` - the one other place that
  briefly creates a `status: "pending"` `feedbackReports` row
- `src/server/api/routers/corpus-db-fixture.ts` - already-fixed sibling
  example (commit `25a3161`), the pattern this research used as its
  starting template for recognizing the `adminSettings` race
- `vitest.config.ts:10-15` - `exclude` array (confirms
  `generate-sweep.full.test.ts` is out of the default suite)
- `node_modules/vitest/dist/chunks/plugin.d.LRFSN46m.d.ts:3797,3805,3812,
  3873,3879` - `pool`, `maxWorkers`, `fileParallelism`, `testTimeout`,
  `hookTimeout` type-def defaults, this installed version (5.1.0)
- `node_modules/vitest/dist/chunks/index.Di8au7q4.js:8823` - runtime
  deprecation/no-op for a config that still sets `poolOptions`

## Architecture Insights

- This project's "reset the singleton by deleting it, let the next reader
  reseed" pattern (seen identically in 3+ files) is intentional and
  necessary for *within-file* test isolation — `adminSettings` is a true
  single-row table (hardcoded `id: ADMIN_SETTINGS_ID`) read by application
  code via `getOrSeedAdminSettings`, so a test that widens a range must
  reset it before the next test reads defaults. The bug is not the pattern
  itself; it's that 3 *independent* files all manage the same global row's
  lifecycle via their own `afterEach`, which is safe only under full
  serialization or true per-file isolation of the underlying data — neither
  holds under default concurrent-file execution against one shared SQLite
  file.
- The project already has one precedent for fixing exactly this shape of
  bug by removing an unnecessary cross-file write
  (`analytics-correctness-corpus-tests`, commit `25a3161`: removed a
  defensive blanket-delete that served no correctness purpose once each
  insert already used a collision-proof random UUID). The `adminSettings`
  case is harder to fix the same way — the delete *is* load-bearing within
  each file, unlike the removed one — so the fix shape here is likely
  different: either give each test a true before/after snapshot-restore of
  only the fields it changed (narrowing the mutation window instead of
  deleting the whole row), or make `getOrSeedAdminSettingsRanges`'s
  insert use an upsert (`onConflictDoNothing`/`onConflictDoUpdate`) so the
  TOCTOU can no longer produce a thrown `PRIMARYKEY` error even if the race
  still occurs (turns a crash into, at worst, a silently-overwritten read —
  still not perfectly isolated across files, but no longer a hard failure).

## Historical Context (from prior changes)

- `context/archive/2026-11-16-analytics-correctness-corpus-tests/
  reviews/impl-review.md` - F1: the `corpus-*@example.com` prefix-collision
  bug between `corpus-db-fixture.ts` and `generate-sweep.*` files, fixed by
  removing an unnecessary defensive delete rather than adding config. Same
  bug *class* as this research's cause #1, different table, not yet fixed
  for `adminSettings`.
- `context/archive/2026-11-15-corpus-generation-harness/reviews/
  impl-review.md` - documents the *within-process* concurrent-batch-mode
  `adminSettings` race as an accepted, consciously-scoped-out risk ("no
  serialization... accepted as a documented risk for S-33 to design
  against"). This research's finding is a related but distinct *cross-file*
  variant of the same underlying singleton-table fragility, triggered by
  test infrastructure (parallel file execution) rather than by the
  production code path the original risk note was scoped to.
- `context/archive/2026-11-15-spatial-grid-dense-clustering-fallback/
  reviews/impl-review.md` and `context/archive/
  2026-11-15-parameter-sweep-corpus-generation/reviews/impl-review.md` -
  both note that default parallel `npm test` is already known-flaky on this
  machine ("intermittent parallel-worker `adminSettings`-contention
  failures... pre-existing and unrelated to this change") and both verify
  with `npx vitest run --no-file-parallelism` instead of trusting plain
  `npm test` — this is the exact gap this change exists to close, named
  explicitly as "adminSettings-contention" in both reports, which lines up
  precisely with cause #1 above.

## Related Research

- None prior — this is the first `research.md` for this change.

## Open Questions

- Why does the Stop hook's observed hook-timeout boundary (30000ms, from
  `simulation.listLeaderboard.corpus.test.ts`'s `beforeAll` failure) not
  match the installed Vitest 5.1.0's documented `hookTimeout` default
  (10000ms), with no override found anywhere in this repo? Possibly a stale
  type-def doc comment, a different resolution path for `beforeAll`
  specifically, or an environment-level override not yet located. Does not
  block the main fix (the failure is contention-driven regardless of the
  exact threshold), but worth a quick confirmation before `/10x-plan`
  commits to a specific `testTimeout`/`hookTimeout` adjustment, if one is
  chosen as part of the fix.
- Whether `maxWorkers: <n>` alone (without an `adminSettings`-race fix) is
  an acceptable interim state, or whether the plan should treat the
  `adminSettings` fix as required and `maxWorkers`/`fileParallelism` as a
  separate, independent lever — these are orthogonal and either can ship
  without the other, but a plan needs to pick which (or both) to do and in
  what order.
- The `retryPendingReports` unscoped-query hazard (cause #3) remains
  unconfirmed. `/10x-plan` should decide whether to fix it defensively
  anyway (scope the query, or scope `feedback.test.ts`'s pending-row
  window) given the hazard is real by inspection even though not
  empirically reproduced, or to leave it as an accepted risk pending
  stronger evidence.
