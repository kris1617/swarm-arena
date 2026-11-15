<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Corpus-generation harness Implementation Plan

- **Plan**: context/changes/corpus-generation-harness/plan.md
- **Scope**: Full plan (1 phase)
- **Reviewed phases**: 1
- **Date**: 2026-11-15
- **Verdict**: REJECTED
- **Findings**: 2 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `startCorpusRun` leaks widened admin ranges and the fixture owner if `startServer` throws

- **Severity**: CRITICAL
- **Impact**: LOW — fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/corpus/harness.ts:154-180
- **Detail**: No try/finally around the admin-range restore or the owner cleanup. If `caller.simulation.startServer(params)` throws (validation error, object-count cap, any TRPCError), the function exits before restoring `adminSettings.parameterRanges` and before deleting the fixture owner row. Since this module is built to be called repeatedly in a batch (S-33), a single mid-sweep rejection corrupts the shared `adminSettings` row — read by every real `startServer` call, not just this harness — until manually fixed, and leaks a fixture user row.
- **Fix**: Wrap the `startServer` call in try/catch/finally: restore ranges unconditionally in `finally`; on catch, delete the fixture owner before rethrowing.
- **Decision**: FIXED (commit 9380a40)

### F2 — `collectAndCleanupCorpusRun` leaks the fixture owner if `getRunAnalysis` throws

- **Severity**: CRITICAL
- **Impact**: LOW — fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/corpus/harness.ts:189-217
- **Detail**: If `getRunAnalysis` throws (e.g. the documented/tested "run not stopped yet" case), `db.delete(users)` is never reached, leaking the fixture owner row. The one test exercising this path (`harness.test.ts:212-243`) papers over it with a manual `db.delete` in the test itself, which hides that real callers get the leak.
- **Fix**: Move the cleanup into a `finally` block around the `getRunAnalysis` call and record construction, so the owner is always deleted regardless of success or throw.
- **Decision**: FIXED (commit 9380a40)

### F3 — No serialization around the shared `adminSettings` widen/restore for concurrent calls

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: scripts/corpus/harness.ts (`ensureAdminRangesAdmit` / `startCorpusRun`)
- **Detail**: Two concurrent `startCorpusRun` calls can interleave on the single shared `adminSettings` row (id=1): call A widens, call B widens further, A's `startServer` succeeds, A restores to A's pre-widen snapshot (clobbering B's wider range mid-flight), and B's `startServer` then spuriously rejects or runs with a narrower range than intended. No locking/serialization exists. This phase's own tests only call it sequentially, so it isn't exercised here — but S-33 (the batched/parallel sweep this phase exists to support) is exactly the scenario that triggers it.
- **Fix A ⭐ Recommended**: Document the limitation now (extend this plan's existing Risk Notes, which already acknowledges the shared-singleton exposure for reads) and let S-33's own plan decide the serialization strategy (e.g. a simple in-process mutex around widen→start→restore, or widening to the union of all sweep params once up front instead of per-call).
  - Strength: Keeps this phase's scope narrow (it explicitly isn't building the batch loop); S-33 has full context to pick the right mechanism once the real parameter sweep shape is known.
  - Tradeoff: The race stays theoretically possible until S-33 lands.
  - Confidence: HIGH — this phase's plan already drew the same scope line for sequencing concerns ("Not building the actual ~20-run sweep... that's S-33").
  - Blind spot: If S-33 forgets to address this, the race ships silently.
- **Fix B**: Add a mutex/queue around the widen→start→restore window in this phase now.
  - Strength: Closes the gap immediately, before any caller depends on the unsafe behavior.
  - Tradeoff: Adds concurrency-control code to a phase whose plan explicitly scoped batching out; no test here would exercise it meaningfully since this phase doesn't call it concurrently.
  - Confidence: MEDIUM — reasonable mutex shapes exist, but the right one depends on S-33's actual batching design, which doesn't exist yet.
  - Blind spot: Risk of building the wrong concurrency primitive and having to redo it in S-33 anyway.
- **Decision**: ACCEPTED (Fix A — documented in plan.md Risk Notes for S-33 to design against)

### O1 — `getOrSeedAdminSettingsRanges` duplication is a faithful subset

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: scripts/corpus/harness.ts:64-78 vs. src/server/api/routers/simulation.ts:86-114
- **Detail**: Same seed values, same findFirst/insert shape, just drops the two object-count fields this module doesn't need. Acceptable, acknowledged duplication (plan already called this out).

### O2 — Fixture email prefix diverges from `simulation.test.ts`'s convention

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: scripts/corpus/harness.ts:160 (`corpus-<uuid>@example.com` vs. existing `owner-<uuid>@example.com`)
- **Detail**: Harmless, intentional divergence — distinguishes harness-created fixtures from other test fixtures. Not a defect.

### O3 — `callProcedure`'s fake-timer guard is sound despite no prior precedent

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: scripts/corpus/harness.ts:143-148
- **Detail**: `vi.isFakeTimers()` guard before a bounded `advanceTimersByTimeAsync(500)` (matching `timingMiddleware`'s documented max delay), combined with the test file's own repeated-tick `pump()` helper as a safety net, is a reasonable adaptation for a `createCaller` + fake-timers combination that has no prior precedent anywhere else in this codebase.
