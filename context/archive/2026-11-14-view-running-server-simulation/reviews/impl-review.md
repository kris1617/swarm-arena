<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: View One Running Server Simulation Implementation Plan

- **Plan**: context/changes/view-running-server-simulation/plan.md
- **Scope**: Phase 1 of 1 / Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-14
- **Verdict**: APPROVED (after one fix)
- **Findings**: 0 critical, 1 warning (fixed), 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Stale error message not cleared when the subscription recovers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/_components/server-run-viewer.tsx (onData/onError handlers)
- **Detail**: `viewError` was set in `onError` but never cleared. tRPC subscriptions auto-reconnect, so a transient error can clear on its own once new data arrives — without clearing `viewError`, a stale error message would linger under a canvas that's visibly updating again, misleading the user into thinking the view is still broken.
- **Fix**: Clear `viewError` (`setViewError(null)`) at the top of `onData`.
- **Decision**: FIXED — applied directly (commit 22cd62e), with a new test ("clears a stale error once new data arrives") proving the clear path.

### F2 — No unmount/memory-leak risk

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/app/simulation/_components/server-run-viewer.tsx
- **Detail**: tRPC v11's `useSubscription` subscribes inside its own internal `useEffect` and unsubscribes automatically on unmount or input/option change — standard hook behavior, nothing for this component to replicate. No leak.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F3 — Canvas-ref race is a non-issue

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/app/simulation/_components/server-run-viewer.tsx
- **Detail**: `onData` can only fire asynchronously (SSE push) strictly after the component has committed and `canvasRef` is attached; the code also defensively guards with `canvasRef.current?.getContext("2d")`, no-opping silently if null.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F4 — Pattern consistency and UI tokens confirmed clean

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/_components/server-run-viewer.tsx, src/app/simulation/_components/server-run-viewer.test.tsx
- **Detail**: Component styling matches `SimulationCanvas`/`page.tsx`'s existing button classes exactly. No literal colors or arbitrary Tailwind values. Test file's mock pattern mirrors `simulation-canvas.test.tsx` almost line-for-line — no outlier. Security: ownership enforcement correctly left to the server-side `watch` subscription (F-04); the client has no path to view another user's run.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

## Additional verification

- Re-ran all Phase 1 Automated Verification commands at current HEAD (post-fix): `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` PASS (4/4, up from 3/3), `npm test` PASS (150/150, up from 149/149).
- Manual verification (performed during implementation, re-confirmed unaffected by this fix): captured two pixel-sum samples 2s apart against a real running server simulation and found them different while the DB-confirmed status was `"running"`, proving the canvas genuinely live-updates from server pushes; separately confirmed "Stop viewing" does not affect the underlying run (clicked well within a 120s-duration run; DB still showed `"running"` immediately after).
