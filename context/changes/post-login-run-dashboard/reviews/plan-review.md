<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Post-login dashboard listing the user's own simulation runs

- **Plan**: context/changes/post-login-run-dashboard/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓ (`login/page.tsx`, `page.tsx`, `middleware.ts`, `simulation/page.tsx`, `simulation.ts` routers), 3/3 symbols ✓ (`redirectTo: "/"` at `login/page.tsx:15`, `listRunning`/`listSaved` at `simulation.ts:406/430`), brief↔plan ✓.

Deep verification (1 subagent) confirmed every claim in the plan: middleware matcher gates `/dashboard` automatically (no middleware change needed), `/simulation/page.tsx`'s exact `refetchInterval: 2000` + plain-Tailwind-div pattern, no other code references the `"/"` post-login redirect target (2 E2E specs checked, neither assumes it), no existing `/dashboard` route collision, and `src/components/ui/` confirmed to have only `button`/`input`/`switch` (no table/badge to reuse or avoid).

## Findings

### F1 — `listCompleted` rows can have a null `score`, unhandled in the dashboard contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, Changes Required #2 (dashboard page contract)
- **Detail**: `simulationRuns.score` (`schema.ts:121`) is nullable, and there's a real code path that produces it: `startServer`'s catch block (`simulation.ts:239-246`) sets `status: "stopped", stoppedAt: new Date()` with no `score` when a run fails to actually start. `listCompleted` will return these rows with `score: null`. The plan's dashboard contract says "for completed rows, `score`" with no null-handling called out.
- **Fix**: Render a null score as "—" (or "failed to start") instead of assuming a number is always present.
- **Decision**: FIXED — added to the plan's Phase 1 Contract text for the dashboard page.
