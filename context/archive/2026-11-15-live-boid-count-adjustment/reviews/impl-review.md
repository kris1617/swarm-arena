<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Live-adjust boid and predator count

- **Plan**: context/changes/live-boid-count-adjustment/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated success criteria (re-run)

- `npm run typecheck` — PASS
- `npm run check` — PASS (1 pre-existing warning in `src/components/ui/sidebar.tsx`, unrelated)
- `npm test` — 323/323 passing

## Findings

### F1 — Shared cooldown/flash state between boid and predator controls

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/app/simulation/_components/server-run-viewer.tsx:364-367, 417, 427, 435`
- **Detail**: `populationCooldown` and `flashPopulationFields` are single pieces of state shared by both the boid-count and predator-count rows. Clicking boid's +10/-10 visibly disables and flashes predator's buttons too (and vice versa), even though only one field changed. Deliberate per the implementing subagent's own comment, but user-visible and not explicitly specified in the plan either way.
- **Fix**: Key `populationCooldown`/`flashPopulationFields` by field (e.g. `Record<"boidCount"|"predatorCount", boolean>`) so a click on one row doesn't visibly affect the other.
- **Decision**: PENDING

### F2 — `adjustLivePopulation` accepts `delta: 0` as a no-op that still consumes the throttle window

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/simulation/server-run-registry.ts:298-339`
- **Detail**: `delta === 0` runs neither the growth nor shrink branch, yet still pushes an identical-value changelog entry and updates `lastParamUpdateAt`, consuming the shared 500ms throttle window. Unreachable from the UI (only ±10 is ever sent) — only matters for a direct/malformed tRPC call.
- **Fix**: Short-circuit `delta === 0` as a true no-op (skip changelog push and throttle update) before the growth/shrink branching.
- **Decision**: PENDING

### F3 — Router's soft-cap warning counts can be computed against a stale snapshot

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts:1069-1107`
- **Detail**: Live counts are read once via `getLiveRunState` before two subsequent `await`s (admin-settings fetch, cross-run cap check). If the run's `tick()` interval fires in that window, the warning text reflects a slightly stale count — the actual mutation in `adjustLivePopulationRegistry` re-reads fresh state synchronously, so no data corruption, only a warning-text accuracy edge case.
- **Fix**: Skip — acceptable as-is; re-deriving the count immediately before the registry call would add complexity for a cosmetic warning-text edge case that doesn't affect correctness.
- **Decision**: PENDING

## Verified clean (no finding)

- `adjustLivePopulation` (server-run-registry.ts) is fully synchronous — no `await` between its registry read and the final `run.boids`/`run.predators`/`run.params`/`lastParamUpdateAt` reassignment — matches `applyLiveParams`'s documented race-safety invariant exactly.
- The router procedure's `await`s all complete before the single call into the registry function; no interleaving.
- `checkConcurrentObjectCapSoft`'s DB fallback correctly reads `row.boidCount + row.predatorCount` when `getLiveRunState` returns `undefined` — no throw, no `NaN`.
- `clusterNewIndividuals`'s empty-array guard correctly routes to the world-center fallback, no divide-by-zero.
- `Math.min(current.length, -delta)` correctly clamps an over-sized shrink request — no negative-length array, confirmed by the `-1000` delta test.
- Both new soft-check helpers match existing conventions: `checkConcurrentObjectCapSoft` takes `db` explicitly (per the router-helper lesson), `checkPerRunObjectCapSoft` is correctly pure.
- All 15 planned Phase 1-3 items verified MATCH against actual file content; 0 DRIFT, 0 MISSING, 0 EXTRA — including the subtler contract details (independent-oracle lowest-energy test, explicit `db` parameter, no new section/query in Phase 3, name-collision alias in Phase 2).
