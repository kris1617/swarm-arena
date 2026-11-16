---
change_id: vitest-parallel-flakiness
title: Make plain npm test reliable under Vitest's default file parallelism
status: archived
created: 2026-11-16
updated: 2026-11-16
archived_at: 2026-11-16T18:35:31Z
---

## Notes

Fix test suite flakiness under default `npm test` (`vitest run`, full file
parallelism — 37 workers spawned, one per test file) — spurious timeouts and
cross-file email-prefix races across unrelated test files, documented as a
recurring pre-existing issue across several archived reviews; cap Vitest's
worker/file parallelism (or otherwise harden) so plain `npm test` is a
reliable gate instead of requiring `--no-file-parallelism`.

Evidence gathered during `analytics-correctness-corpus-tests` (2026-11-16):
- `scripts/corpus/harness.test.ts` vs. `scripts/corpus/generate-sweep.smoke.test.ts`:
  both use a `corpus-*@example.com` email convention; the latter's blanket
  `DELETE ... LIKE 'corpus-%@example.com'` can wipe the former's still-in-use
  owner row mid-test when both run concurrently, surfacing as a
  `TRPCError: BAD_REQUEST` ("run not found") from `getRunAnalysis`.
- `src/server/simulation/parameter-suggestion.corpus.test.ts` and
  `scripts/__tests__/agent-hooks.test.ts` hit hard 5000ms timeouts under
  37-way worker contention — not assertion failures, pure CPU starvation.
- `src/server/feedback/retry-worker.test.ts` and
  `src/server/simulation/corpus-fixture.test.ts` failed the same way in a
  second observed run (different files each time — consistent with
  nondeterministic contention, not a fixed broken test).
- All of the above pass cleanly in isolation and under
  `npx vitest run --no-file-parallelism`, which is already this project's
  de-facto "real" full-suite gate per several prior archived reviews
  (`2026-11-15-spatial-grid-dense-clustering-fallback`,
  `2026-11-15-parameter-sweep-corpus-generation`) — but `package.json`'s
  `"test": "vitest run"` script and this project's Stop hook both still
  invoke the flaky default mode, so every session re-discovers this and
  re-verifies around it instead of the root cause being fixed once.

Likely levers to evaluate during planning: `vitest.config.ts`
`poolOptions`/`fileParallelism: false` (trades wall-clock time for
determinism, already the accepted tradeoff per the archived reviews above),
raising `testTimeout` for slow I/O-bound tests, and/or fixing the one
confirmed real bug in this list — the `corpus-*@example.com` prefix
collision between `harness.test.ts` and `generate-sweep.smoke.test.ts` —
independently of any parallelism-config change.

**Second observed run (same day, stop-hook-triggered `npm test`), contention got worse, not better:**
- `src/server/feedback/retry-worker.test.ts`: now all 3 fake-timer tests fail
  (previously only 1 did), with wildly inflated call counts (e.g. "expected
  1, got 6") — a clean signature of `vi.advanceTimersByTimeAsync` racing
  real wall-clock scheduling under CPU starvation, not a logic regression
  (file untouched this session).
- `src/server/api/routers/simulation.listLeaderboard.corpus.test.ts` and
  `simulation.getRunsComparison.corpus.test.ts` — two tests already
  verified green under `--no-file-parallelism` — blew past the 30s
  `beforeAll` hook timeout (20 sequential DB inserts) under 37-worker
  contention.
- `src/server/simulation/corpus-fixture.test.ts` timed out the same way
  again.

This reinforces that the root cause is shared CPU/IO contention from
Vitest's default one-worker-per-file model (37 workers for 37 files on this
machine), not any single flaky test — the specific files affected vary
run to run. Strengthens the case for `fileParallelism: false` (or a capped
worker count via `poolOptions.forks.maxForks`/`minForks`) as the primary
fix, evaluated against the wall-clock cost during planning.
