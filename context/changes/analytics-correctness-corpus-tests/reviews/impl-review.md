<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Analytics-correctness corpus tests Implementation Plan

- **Plan**: context/changes/analytics-correctness-corpus-tests/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-11-16
- **Verdict**: NEEDS ATTENTION (resolved — see Decisions below)
- **Findings**: 1 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Shared email-prefix defensive delete causes a reproducible cross-file FK-constraint race under default `npm test`

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/corpus-db-fixture.ts:41
- **Detail**: `insertCorpusRunsAsCompleted` opens with `await db.delete(users).where(like(users.email, "db-fixture-%@example.com"))` before inserting its own fresh (random-UUID) owner. Four new test files (`corpus-db-fixture.test.ts`, `simulation.getRunAnalysis.corpus.test.ts`, `simulation.getRunsComparison.corpus.test.ts`, `simulation.listLeaderboard.corpus.test.ts`) each call this function from their own `beforeAll`/test body, and `package.json`'s `test` script is plain `vitest run` with no `fileParallelism`/`poolOptions` override in `vitest.config.ts` — so Vitest runs these files in separate concurrent workers by default. When File B's defensive delete fires after File A has already inserted its owner+20 rows but before File A's assertions/cleanup run, it deletes File A's owner mid-test, cascade-deleting its `simulationRuns` rows out from under it.

  Reproduced directly: running `npx vitest run` (default pool, no `--no-file-parallelism`) against just these 4 files failed 3/3 times with `SQLITE_CONSTRAINT_FOREIGNKEY` from a `simulationRuns` insert racing a stray-owner delete from a sibling file. This is distinct from the project's already-known `adminSettings`-contention flakiness and the already-fixed `SQLITE_BUSY` issue (`context/foundation/lessons.md`) — it is a new, self-inflicted correctness defect in this change's own fixture helper, not pre-existing flakiness. The project's full-suite gate is conventionally run with `--no-file-parallelism` (per prior archived reviews), which masks this in the checked-in gate history but not in a plain `npm test`/CI run that doesn't add that flag.

  The defensive delete is also unnecessary for correctness: `ownerEmail()` already generates a fresh `crypto.randomUUID()` per call, so a stray row from a previous crashed run can never collide with a new run's owner. `corpus-db-fixture.test.ts`'s own assertions only check its own inserted rows (never a global count), so nothing actually depends on the table being clean of old `db-fixture-*` rows before a new insert.

- **Fix**: Remove the blanket defensive `db.delete(users).where(like(...))` from `insertCorpusRunsAsCompleted` entirely. Each call already gets a collision-proof fresh owner via `ownerEmail()`'s UUID, and every caller already cleans up its own owner via `cleanupCorpusDbFixture` in `afterAll`/`finally`. Dropping the pre-delete removes the only cross-file write that can touch another file's still-in-use rows, eliminating the race without needing `--no-file-parallelism` or any config change.

- **Decision**: FIXED (commit 25a3161) — re-verified 3/3 green under default parallelism (previously 3/3 reproducibly red), full suite 396/396 under `--no-file-parallelism`, typecheck and check clean.

### F2 — Phase 5 added two boids.test.ts cases instead of the planned one

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/server/simulation/boids.test.ts
- **Detail**: The plan described one synthetic case (a short, declining history still classifies as `"establishment"`). The implementation added two: a plain 19-entry short history, and the 5-entry sharply-declining one. Both stay within the phase's stated intent (proving the length-guard, not the decline pattern, controls the result) and touch no production code — benign scope tightening, not creep.
- **Fix**: None needed — no action required.
- **Decision**: ACCEPTED (no action needed)
