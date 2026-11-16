---
change_id: pre-existing-admin-settings-flakes
title: Fix two pre-existing flaky tests surfaced by vitest-parallel-flakiness's stress testing
status: implementing
created: 2026-11-16
updated: 2026-11-16
archived_at: null
---

## Notes

Discovered during `vitest-parallel-flakiness`'s Phase 5 stress-testing
(context/archive/... once that change is archived — see its plan.md Phase
5 Progress notes for full evidence). Two distinct flaky tests, both
CONFIRMED unrelated to Vitest file parallelism — they fail at a similar
rate (~15-70% depending on the specific test) even under full
`--no-file-parallelism` forced serial execution, and even on the
PRE-`vitest-parallel-flakiness` version of the code. This means the
project's own long-trusted "real" gate (`--no-file-parallelism`) has
itself been silently flaky all along — nobody had previously run it
repeatedly to notice.

**Bug 1 — `src/server/api/routers/simulation.test.ts`'s "lets an admin
update ranges, and start enforces the new bound"** (describe block
`simulationRouter.getParameterRanges / updateParameterRanges`): fails
~70-80% of the time (confirmed via 2x 5-run isolated-standalone batches,
both on current code and on the commit immediately before
`vitest-parallel-flakiness`'s Phase 1). The test calls `updateParameterRanges`
(a real DB upsert) then expects `memberCaller.simulation.start(...)` to
reject with `BAD_REQUEST` for an out-of-range `boidCount` — instead it
intermittently gets `INTERNAL_SERVER_ERROR` wrapping a
`SQLITE_CONSTRAINT_PRIMARYKEY` from `getOrSeedAdminSettings`
(`src/server/api/routers/simulation.ts:103`, a check-then-insert that
conflicts). Needs root-cause investigation: likely a dangling/unawaited
async operation from an EARLIER test in the same file racing this test's
own sequential admin_settings read/write, or a genuine bug in
`getOrSeedAdminSettings`'s own TOCTOU window — `/10x-research` should
establish which before planning a fix.

**Bug 2 — `scripts/corpus/harness.test.ts`'s cluster of failures**: several
different, unrelated-looking tests in this file (`ensureAdminRangesAdmit`'s
"widens only the fields actually out of range...", `ensureAdminRangesAdmitForBatch`'s
"widens to the union across several param sets...", `startCorpusRun batch
mode`'s "lets two concurrent batch-mode calls both succeed...", and the
plain sequential "completes a full start -> advance -> collect -> cleanup
round trip") all intermittently fail with symptoms (`adminSettings row is
missing`, wrong range values, `run not found` BAD_REQUEST) that trace back
to ONE already-known, already-accepted risk: `ensureAdminRangesAdmitForBatch`'s
own "two concurrent batch-mode calls" test fires genuinely concurrent
calls (`Promise.all`) against the shared `admin_settings` row with no
serialization — a risk explicitly accepted when `corpus-generation-harness`
was archived (`context/archive/2026-11-15-corpus-generation-harness/reviews/impl-review.md`:
"concurrent calls can clobber each other's widened range, no
serialization... accepted as a documented risk"). What's newly discovered
here is that this risk's blast radius is bigger than that review realized
— it can corrupt or delete the shared row badly enough to make OTHER,
unrelated, purely-sequential tests later in the SAME file fail too, not
just the concurrent test's own assertions.

Both bugs are explicitly out of scope for `vitest-parallel-flakiness`,
which only set out to fix (and did fix, confirmed) cross-FILE races caused
by Vitest's default parallelism — these two are within-file/within-test
bugs that predate that change and are orthogonal to it.
