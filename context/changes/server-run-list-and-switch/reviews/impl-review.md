<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: List and Switch Between Running Server Simulations Implementation Plan

- **Plan**: context/changes/server-run-list-and-switch/plan.md
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

### F1 — Viewer doesn't close when its run disappears from the running list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/page.tsx (ServerRunViewer rendering, originally gated only on `viewingRunId`)
- **Detail**: When a watched run naturally stopped, its button disappeared from the polled list within one poll cycle, but the mounted `ServerRunViewer` kept showing its last-drawn frame forever with no indication. This behavior already existed under S-07 alone (silently stale), but S-08's live list changes the user's mental model — a list that appears/disappears as runs start/stop implicitly promises "this reflects what's running now." Once the list says a run is gone while the canvas still renders as if live, the UI actively contradicts itself.
- **Fix**: Added an effect that clears `viewingRunId` once the watched run is confirmed no longer in `runningRunsQuery.data`. Guarded with a `seenRunningIds` ref against a real race: starting a server run sets `viewingRunId` immediately, before the list's first poll includes it — a naive "not in the list" check would have cleared that id right after setting it. Only a previously-confirmed-running id that has since disappeared counts as "stopped."
- **Decision**: FIXED — applied directly (commit d7cee34), manually verified via playwright-cli: started a run with `maxDurationSeconds=3`, confirmed the viewer opened immediately (race guard works), waited past the duration, confirmed via DB read the run reached `status=stopped`, and confirmed the viewer had disappeared on its own with zero console errors.

### F2 — `listRunning` correctly scoped, no leakage

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts (listRunning)
- **Detail**: Correctly filters by caller's own `userId` AND `status: "running"` — confirmed by the test asserting both another user's running row and the owner's own stopped row are excluded. `MAX_PARALLEL_RUNS = 4` (unaffected by the retirement edits) bounds the result set; no `.limit()` needed.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F3 — Retirement is clean, no dangling references

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/server/simulation/run-slots.ts and the deleted subsystem files
- **Detail**: `run-slots.ts` trimmed to exactly `MAX_PARALLEL_RUNS`, no dead exports left. A repo-wide grep for every removed symbol found one hit (`page.tsx`'s `setActiveRun`), confirmed as a false positive (React's unrelated `useState` setter for `ActiveRun`, not the retired `setActive` function) — no build-breaking dangling reference anywhere.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

### F4 — UI tokens and the independent staging path confirmed clean

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/page.tsx
- **Detail**: New list/switcher JSX reuses existing button token classes exactly (`bg-input`/`rounded-full`/`font-semibold`, active-state `bg-foreground/35`). `activeRun`/`SimulationCanvas` (the staging path) remains a fully independent branch, untouched by and non-interacting with the new list/viewer state.
- **Fix**: None needed.
- **Decision**: ACCEPTED.

## Additional verification

- Re-ran all Phase 1 Automated Verification commands at current HEAD (post-fix): `npm run typecheck` PASS, `npm run check` PASS, `npx vitest run src/server/api/routers/simulation.test.ts` PASS (18/18), `npm test` PASS (122/122) — unaffected by the F1 fix, which touches only `page.tsx` (not unit-tested in this project; verified manually per F1's detail, consistent with this page having no prior test-file precedent).
- Manual verification (performed during implementation, re-confirmed unaffected by this fix): two server runs both appeared in the list and stayed `running` while switching the viewer between them; `/simulation/multi` confirmed 404 for an authenticated user.
