<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Fix default-parameter simulation start

- **Plan**: context/changes/fix-default-start-failure/plan.md
- **Mode**: Deep
- **Date**: 2026-11-17
- **Verdict**: REVISE → SOUND (after triage fixes)
- **Findings**: 1 critical, 2 warnings, 0 observations — all 3 FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

7/7 paths ✓, 4/4 symbols ✓, brief↔plan ✓

## Findings

### F1 — Sweep can kill a genuinely-active run on the same process

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Reconciliation sweep, Contract snippet
- **Detail**: The sweep's query (`sweepOrphanedRuns`) selects every `status: "running"` row past `startedAt + maxDurationSeconds + 2min` with no cross-check against the current process's own live registry. This is correct for rows truly orphaned by a past restart (registry is empty), but on a long-lived process the sweep would also catch a server-owned run that is still legitimately ticking on this process if its own finalization (computing final score/history, per the plan's own Grace-decision rationale: "slow history/score computation on a large population") runs past the grace window. `isServerRunActive(runId)` (`server-run-registry.ts:402`, already imported and used for exactly this purpose at `simulation.ts:163,220,544,1076,1133,1218`) would return `true` for such a row, but the plan's sweep never calls it — so the sweep would stop a run that is not orphaned at all, overwriting it with `wasAutoStopped: true` and no score.
- **Fix**: Add `&& !isServerRunActive(row.id)` to the sweep's stale-row filter, so any row still tracked by this process's own registry is never swept regardless of how far past its deadline it appears — only rows the registry has no record of (true orphans, whether from a dead process or an abandoned client tab) are eligible.
  - Strength: Reuses an existing, already-proven exclusion check used for exactly this "is this registry entry still live" question elsewhere in the same file.
  - Tradeoff: None significant — `isServerRunActive` is already a cheap in-memory lookup.
  - Confidence: HIGH — confirmed via direct code read and a dispatched verification pass; the function's existing 6 call sites all guard the identical race.
- **Decision**: FIXED (added `!isServerRunActive(row.id)` to the sweep filter, plus a new unit test and Progress row 2.5)

### F2 — Ambiguous "same pattern" guidance risks disabling the sweep in production

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — "Reconciliation sweep", Intent/Contract text
- **Detail**: The plan says to schedule the interval "matching how `registry` itself avoids duplicate instances across HMR reloads" — but that Map's `globalThis` write-back is explicitly gated `if (process.env.NODE_ENV !== "production")` (`server-run-registry.ts:150-154`). A verification pass confirms Next.js loads this module once per process in production (no per-request HMR reload there), so the interval would register exactly once regardless — unless an implementer copies that exact conditional onto the `setInterval(...)` call itself (plausible, reading "same pattern" literally), which would silently disable the whole fix in the one environment it exists to fix. Separately, a closer, cleaner precedent already exists and isn't mentioned: `src/server/feedback/retry-worker.ts` sets up its own standalone module-scope `setInterval` via an exported `startFeedbackRetryWorker()` function — a standalone periodic job, not a per-run Map cache.
- **Fix**: Rewrite the Contract note to say explicitly: "the interval registration itself must run unconditionally at module load in every environment; only the `globalThis` de-duplication guard (preventing a second interval on dev HMR reload) is environment-gated, never the interval's creation." Point to `retry-worker.ts`'s `startFeedbackRetryWorker()` as the closer precedent to follow for a standalone periodic job.
- **Decision**: FIXED (Intent and post-snippet note both rewritten with explicit unconditional-registration wording and the retry-worker.ts pointer)

### F3 — New ~900-line-file addition vs. a focused module

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — "Reconciliation sweep", File
- **Detail**: `server-run-registry.ts` is already ~900 lines covering per-run tick lifecycle. The sweep is a conceptually separate, standalone periodic job (confirmed: `retry-worker.ts` already sets the precedent of giving this kind of job its own file) — bolting it onto the registry file mixes two different lifecycles (per-run tick state vs. a global janitor pass).
- **Fix**: Put `sweepOrphanedRuns` and its interval registration in a new `src/server/simulation/orphan-sweep.ts`, importing `registry`'s `isServerRunActive` export rather than living inside the same file.
- **Decision**: FIXED — moved to new `orphan-sweep.ts`, wired via `src/instrumentation.ts`'s `register()` boot hook (found during triage: this also fully resolves F2, since `register()` is Next's documented run-once-at-boot hook with no `NODE_ENV` conditional to misapply, and its de-dup pattern directly mirrors `retry-worker.ts`'s own proven `globalForRetryWorker`-style boolean flag)
