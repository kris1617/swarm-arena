---
date: 2026-11-16T23:54:59+01:00
researcher: Claude Sonnet 5
git_commit: b509a3c6e37f7c8262bc5d8de2a1978b58e4fe2e
branch: master
repository: swarm-arena
topic: "Root-causing two pre-existing flaky tests: admin-ranges cross-process race, Stop-hook self-test timeout"
tags: [research, codebase, testing, flakiness, vitest, hooks]
status: complete
last_updated: 2026-11-16
last_updated_by: Claude Sonnet 5
---

# Research: Two pre-existing flaky tests — root causes

**Date**: 2026-11-16T23:54:59+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: b509a3c6e37f7c8262bc5d8de2a1978b58e4fe2e
**Branch**: master
**Repository**: swarm-arena

## Research Question

Root-cause two pre-existing flaky tests discovered while running `test-plan-refresh-2026-11-16`'s gate stack, neither caused by that change's diff:

1. `src/server/api/routers/simulation.test.ts`'s `lets an admin update ranges, and start enforces the new bound`
2. `scripts/__tests__/agent-hooks.test.ts`'s `end-of-turn.sh (Stop) > passes (exit 0) on an untracked new clean file`

## Summary

**Flake #1 (admin-ranges)** is a **cross-process** race on the single `admin_settings` row in `db.sqlite`, already identified as unresolved in `context/foundation/lessons.md`'s second entry. The project's existing `serialized-shared-state` Vitest project (`fileParallelism: false`) only serializes files *within one OS process*; a second, independent `npm test`/`vitest run` process — most plausibly this repo's own Stop hook, which auto-runs tests at every turn boundary — can interleave a write to the same row between this test's own `updateParameterRanges` write and its `start` read. No caching/memoization exists anywhere in the code path (confirmed) — the race is purely at the process level, and no in-process code fix can close it.

**Flake #2 (Stop-hook self-test)** is a pure **CPU/IO resource-contention / under-provisioned-timeout** issue, not a correctness bug. The test's `run()` helper (`execFileSync`, no internal timeout) shells out to `.claude/hooks/end-of-turn.sh`, which runs Biome, a nested Vitest invocation (~14s normally), and `tsc --noEmit` sequentially even for a trivial clean-file case. The test has no explicit per-test timeout, so it inherits Vitest's 5000ms default; under the full 37-file suite's `maxWorkers: 8` contention, this chain occasionally exceeds that budget. A sibling test in the same file (`blocks (exit 2) on a lint error written directly to disk`) already carries an explicit `15_000` timeout — the author anticipated this exact failure mode for one case but not this one.

## Detailed Findings

### Flake #1: admin-ranges cross-process race

- `context/archive/2026-11-16-vitest-parallel-flakiness/` already investigated a related symptom and fixed the **cross-file** version of this race (grouping `simulation.test.ts`, `scripts/corpus/harness.test.ts`, `generate-sweep.smoke.test.ts` into the `serialized-shared-state` project, `vitest.config.ts:31-53`).
- `context/foundation/lessons.md`'s second entry ("Reproduced under load can mean the load itself is the bug") explicitly documents that this fix is **not sufficient**: a second OS process running its own copy of the same project races the first for `db.sqlite`'s `admin_settings` row (`id: ADMIN_SETTINGS_ID = 1`). A 40-attempt single-process batch came back 40/40 clean; under concurrent processes it reproduced ~70-80%.
- `updateParameterRanges` (`src/server/api/routers/simulation.ts:1278-1320`) does an awaited `insert(...).onConflictDoUpdate(...)`. `start`'s `insertRunningSimulation` path calls `getOrSeedAdminSettings(ctx.db)` (`simulation.ts:86-114`), which does a fresh `db.query.adminSettings.findFirst(...)` on **every** call — no module-level cache, no closure, no memoization anywhere in this path. Confirmed: within a single process, a committed write is always visible to the next read on the same connection.
- **Conclusion**: the only mechanism that can make `start`'s read see a wider/default range than what this test just wrote is a concurrent OS process's own write landing in between — exactly the already-documented, still-open cross-process gap. No in-process code change (caching fix, added `await`, etc.) can close this; `fileParallelism: false` already does everything it can.

### Flake #2: Stop-hook self-test timeout

- `scripts/__tests__/agent-hooks.test.ts:48-65`: `run()` calls `execFileSync(script, [], { input: payload, cwd, encoding: "utf8", stdio: [...] })` — no `timeout` option passed. The only timeout governing the call is Vitest's own per-test `testTimeout`.
- The failing test (`agent-hooks.test.ts:220-227`) has no explicit third-arg timeout → inherits Vitest's 5000ms default.
- `.claude/hooks/end-of-turn.sh`: for every git root with changed/untracked files, runs 3 sequential subprocesses unconditionally — `npx --no-install biome check`, `npx --no-install vitest run --passWithNoTests` (a **nested** Vitest boot, the script's own comment estimates "~14s here (12 files, 76 tests)" normally), then `npx --no-install tsc --noEmit --pretty false`. There is no fast path that skips these for a trivially clean file.
- `vitest.config.ts`: this test file matches the `default` project (not one of the 3 files explicitly listed under `serialized-shared-state`), which sets `maxWorkers: 8`. The config's own comment names this exact failure class ("CPU/IO contention under this suite's file parallelism, producing spurious testTimeout/hookTimeout failures on slow-but-correct tests") as a known, partially-mitigated problem.
- Confirming signal: the sibling test `blocks (exit 2) on a lint error written directly to disk` (`agent-hooks.test.ts:195-206`) already has an explicit `15_000` timeout. The author clearly anticipated `end-of-turn.sh` being slow under load for at least one case but did not extend the same budget to this test (or to the adjacent `nothing changed since HEAD` test, which has the same gap).
- **Conclusion**: resource contention under the full suite's parallelism, not a logic bug in the hook script or the test fixture. Confirmed by 3/3 clean passes in isolation.

## Code References

- `src/server/api/routers/simulation.ts:86-114` — `getOrSeedAdminSettings`, confirmed no caching
- `src/server/api/routers/simulation.ts:1278-1320` — `updateParameterRanges`
- `src/server/api/routers/simulation.test.ts:2593-2630` — the flaky test
- `vitest.config.ts:31-53` — `serialized-shared-state` project (`fileParallelism: false`)
- `scripts/__tests__/agent-hooks.test.ts:48-65` — `run()` helper, no internal timeout
- `scripts/__tests__/agent-hooks.test.ts:195-206` — sibling test with explicit `15_000` timeout (precedent)
- `scripts/__tests__/agent-hooks.test.ts:220-227` — the failing test, no explicit timeout
- `.claude/hooks/end-of-turn.sh` — 3 unconditional sequential subprocess calls

## Architecture Insights

Both flakes trace back to the same underlying tension already named in this project's own `vitest.config.ts` comments and `lessons.md`: this test suite's performance/isolation tradeoffs (file-level serialization for shared-state safety, `maxWorkers: 8` for throughput) create two different failure classes — cross-process data races (flake #1) and resource-contention timeouts (flake #2) — and the project has already partially mitigated each class elsewhere (the `serialized-shared-state` project; the one bumped-timeout sibling test) without fully closing either gap.

## Historical Context (from prior changes)

- `context/archive/2026-11-16-vitest-parallel-flakiness/` — fixed the cross-file version of flake #1's race; did not address the cross-process version.
- `context/archive/2026-11-16-pre-existing-admin-settings-flakes/` — discovered and documented the cross-process gap that flake #1 is a direct instance of; recorded as a lesson rather than fixed at the time (its own scope was a different pair of bugs — SESSION fixture hygiene and a live admin-ranges lock in `scripts/corpus/harness.ts` — not this router-level test).

## Open Questions

- **Flake #1 has no clean in-process fix.** The only real options are: (a) accept and document as a known risk (status quo, just more explicitly flagged on this specific test), (b) reduce exposure by making the Stop hook's own automatic test run less likely to overlap with a manually-invoked `npm test` (e.g., a lock file the hook checks before running), or (c) a genuine architectural change — stop treating `admin_settings` as a single global singleton row and scope it per-test (significant surface change, affects every consumer of `getOrSeedAdminSettings`). This needs a product/engineering decision in `/10x-plan`, not a research answer — not blocking, routed to planning.
- **Flake #2 has a clean, low-risk fix**: raise the explicit timeout on the 2 affected tests to `15_000` (matching the existing sibling precedent). No further investigation needed.
