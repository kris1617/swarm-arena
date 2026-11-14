<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Server-Owned Simulation Execution Engine Implementation Plan

- **Plan**: context/changes/server-side-simulation-engine/plan.md
- **Scope**: Phase 1 of 1 / Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-14
- **Verdict**: APPROVED (after inline fix)
- **Findings**: 1 critical (fixed), 1 warning (accepted), 2 observations (accepted/noted)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `finishRun` swallows DB-write failures as unhandled rejections, leaving zombie `running` rows

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/simulation/server-run-registry.ts (finishRun, originally lines 91-108)
- **Detail**: `finishRun` was called fire-and-forget (`void finishRun(...)`) from both the natural-completion and tick-error paths. The registry entry (`clearInterval` + `registry.delete`) was removed synchronously *before* the DB write was awaited, with no try/catch around the write. A transient DB failure (connection drop, constraint error) would be an unhandled promise rejection and leave the `simulationRuns` row stuck at `status: "running"` forever, with no live run tracking it and nothing to retry the write.
- **Fix**: Wrap the `db.update` call in try/catch inside `finishRun`; log loudly on failure. Full recovery (retry, or un-removing the registry entry) is out of scope for this Foundation — durability across failures is S-04's job — but the failure is now caught and visible instead of silently swallowed or crashing the process.
- **Decision**: FIXED — applied directly (commit 07b08f5), with a new test (`server-run-registry.test.ts`: "a DB write failure in finishRun is caught and logged, not an unhandled rejection") proving the catch path.

### F2 — Inconsistent error-handling between `stopServerRun` and the internal tick/completion paths

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/server/simulation/server-run-registry.ts (stopServerRun)
- **Detail**: `stopServerRun` awaits `finishRun` directly, so after F1's fix both paths now behave the same way (catch-and-log, resolve normally) — this finding is effectively resolved as a side effect of the F1 fix, but is recorded since it was raised independently.
- **Fix**: None needed — F1's fix already unified the behavior.
- **Decision**: ACCEPTED (resolved as a side effect of F1).

### F3 — `isServerRunActive` exported but not named in the plan's Phase 1 contract

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/server/simulation/server-run-registry.ts
- **Detail**: Small, low-risk addition anticipating S-06's tRPC wiring (it will need a cheap existence check without pulling a full snapshot).
- **Fix**: None needed — trivial, forward-compatible, no behavior risk.
- **Decision**: ACCEPTED.

### F4 — Raw `process.env.NODE_ENV` instead of validated `env.NODE_ENV`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/simulation/server-run-registry.ts (globalThis-cache guard)
- **Detail**: `src/server/db/index.ts` uses the validated `env.NODE_ENV` from `~/env`; this file uses raw `process.env.NODE_ENV`. Functionally equivalent (same guard direction, not inverted), but a stylistic deviation from the established T3 pattern.
- **Fix**: Could switch to `env.NODE_ENV` for consistency; not load-bearing.
- **Decision**: ACCEPTED (style-only, no behavior difference).

## Additional verification

- Re-ran all Phase 1 Automated Verification commands at current HEAD (post-fix): `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/simulation/server-run-registry.test.ts` PASS (7/7, up from 6/6 after the new regression test), `npm test` PASS (137/137, up from 136/136).
- The globalThis/HMR caching question (whether the registry Map actually survives dev HMR reloads, given it's reused by reference rather than rebuilt like `db/index.ts`'s `db` wrapper) was independently verified: **it works correctly** — `globalForRegistry.serverRunRegistry ?? new Map()` only constructs a new Map on the first load; the cached Map is reused by reference on every subsequent module reload, which is in fact the more correct form of this pattern for genuinely stateful data (live runs, interval handles) than rebuilding a stateless wrapper each time.
