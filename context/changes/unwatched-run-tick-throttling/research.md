---
research_for: unwatched-run-tick-throttling
date: 2026-11-17
researcher: Claude Sonnet 5
branch: master
commit_inspected: 4980e0f7f55bb154a06b53519602a8342326bba4
last_updated: 2026-11-17
last_updated_by: Claude Sonnet 5
last_updated_note: initial research
---

# Research: unwatched-run-tick-throttling (S-36)

## Question

Ground S-36 / Open Roadmap Question #8: how to detect "zero active viewers" for a
server-owned simulation run, where to apply a fixed dtSeconds speed multiplier to
unwatched runs, how to copy S-25's precedent for a comparability marker, and which
cross-run surfaces that marker must reach.

## 1. Watch/subscription mechanism — no viewer-count tracking exists today

**This is the single biggest gap and must be built, not reused.**

- The registry keeps one `LiveRun` per `runId` in a module-level `Map` (`src/server/simulation/server-run-registry.ts:127-131`). Nothing in `LiveRun` (lines 82-117) tracks a subscriber/viewer count.
- `watchServerRun` (`server-run-registry.ts:773-802`) just reads `getLiveRunState(runId)` on a 150ms poll loop (`WATCH_INTERVAL_MS`, line 32) and yields snapshots. Any number of concurrent callers get independent generator loops pulling the same shared state — the run itself has no concept of how many watchers exist, or whether the count just dropped to zero.
- Teardown: the loop condition is `while (!opts.signal?.aborted)` (line 794). When tRPC's per-subscription `AbortSignal` fires (client unsubscribes/disconnects — wired at `src/server/api/routers/simulation.ts:599-609`), the loop just stops on its next check. No `finally`, no generator `.return()`/`.throw()` override, no counter decrement (since no counter exists). This abort has zero effect on the `LiveRun` itself — ticking is already fully independent of watching.
- `context/foundation/lessons.md:33-38` documents the existing, binding pattern for this file: tRPC subscriptions can't be tested via `createCaller`, so the generator logic must stay a plain, exported async function (`watchServerRun`) with the `.subscription(...)` wrapper as a thin `tracked()` delegate. Any new viewer-tracking logic must live inside `watchServerRun` (or a sibling plain function), not inside the router delegate, to stay testable under this rule.
- **Implication for /10x-plan**: a viewer-count (or "has at least one active watcher") signal does not exist and needs to be added, most naturally as a counter on `LiveRun` incremented when `watchServerRun`'s loop starts and decremented when the `AbortSignal` fires / the loop exits (covering both the `while` condition check and an explicit decrement right before return). `tick()`'s own `setInterval` scheduling is completely separate from this and untouched by it.

## 2. Watched → unwatched → watched is a normal, structurally supported flow

- The live view lives at the stable `/simulation` route, not a per-run URL (`src/app/simulation/page.tsx`). `viewingRunId` is local `useState` (line 61); `<ServerRunViewer key={viewingRunId} runId={viewingRunId} .../>` mounts/unmounts per selection (lines 261-278).
- `/simulation` polls `listRunning` every 2s (lines 66-68) and renders a switcher listing every currently-running run; clicking a run calls `setViewingRunId(run.id)` (line 295), remounting `ServerRunViewer` via its `key`.
- The dashboard's "running" link is generic (`href="/simulation"`, no runId — `src/app/dashboard/page.tsx:127,150`); re-watching a specific still-running run happens via the in-page switcher.
- `src/app/runs/[runId]/page.tsx` is an unrelated, post-hoc static analysis view for *stopped* runs — not part of the live-watch flow.
- **Conclusion**: nothing restricts a run to one continuous watch session. A run can legitimately cycle watched → unwatched → watched → unwatched multiple times during its own life. The plan must treat the viewer-count signal as toggling in both directions throughout a run's lifetime, and the comparability marker must latch "ever throttled" (sticky true) rather than reflecting only the run's current watched state at stop time.

## 3. Where dtSeconds is computed and where a multiplier belongs

- `computeSingleRunTick` (`src/server/simulation/single-run-lifecycle.ts:99-104`):
  ```ts
  const previousTimestamp = state.lastTimestamp === null ? timestamp : state.lastTimestamp;
  const dtSeconds = Math.min((timestamp - previousTimestamp) / 1000, MAX_DT_SECONDS);
  ```
  `MAX_DT_SECONDS = 0.1` (line 17). `timestamp` is `Date.now()`, passed in by the caller.
- Caller: `tick()` in `server-run-registry.ts:467` calls `computeSingleRunTick(..., Date.now(), ...)`. The real scheduler (`setInterval(() => tick(params.runId), TICK_INTERVAL_MS)`, registered at `startServerRun`/`resumeServerRun`, lines 592/760) fires every `TICK_INTERVAL_MS = 16` (line 27) regardless of watch state — this cadence must NOT change.
- **Multiplier injection point**: inside `computeSingleRunTick`, scale the already-computed `dtSeconds` by a per-run multiplier before the `MAX_DT_SECONDS` clamp is applied (or raise the effective clamp for throttled runs) — e.g. `const dtSeconds = Math.min(((timestamp - previousTimestamp) / 1000) * speedMultiplier, effectiveMaxDt)`. This requires threading a multiplier value into `computeSingleRunTick`'s `params`, sourced from `tick()` reading the run's current viewer-count state. The scheduler interval itself is untouched — only the simulated-time delta passed into tick math changes.

## 4. Capacity bound for a "reasonable" multiplier value

- `context/foundation/capacity-limits.md:38-40` already names this exact feature as explicitly deferred from F-07, tracked as Open Roadmap Question #8 (now S-36) — confirming the framing is correct and not newly invented.
- Single-core bound: no `worker_threads`; the VPS's 4 vCPUs "don't help" because every concurrently-ticking run competes for the same core (`capacity-limits.md:29`).
- Measured tick-time crosses the 16ms real-time budget around 200 combined individuals (lines 17-27); `admin_settings.maxConcurrentObjectCount` defaults to **150**, already below that breakeven with no spare CPU headroom reserved (line 35).
- **No specific multiplier number is pre-approved anywhere.** The document only establishes the CPU ceiling and that this was deliberately deferred — `/10x-plan` must pick and justify a concrete multiplier value itself (e.g. starting conservative, 2-4x, and validating against the existing `perf-baseline.ts` benchmark harness from the testing-perf-baseline rollout phase), not treat any number here as already decided.

## 5. S-25's comparability-marker precedent is NOT a DB column — correction to the original framing

The change's own Notes assumed S-25 added a "formula-version marker" column to copy. **That assumption is wrong and must be corrected before planning:**

- S-25's archived plan (`context/archive/2026-11-15-area-aware-population-insight/plan.md:126-129`, "What We're NOT Doing") explicitly rejects a DB column: *"Not adding a formula-version column to `simulationRuns` — presence/absence of `populationDensitySamples` in stored `history` is the detection mechanism... consistent with this codebase's existing JSON-presence-check convention."*
- The `simulationRuns.history` column is schema-less JSON (`src/server/db/schema.ts:150`, `d.text({ mode: "json" })`). S-25's actual marker is a **derived boolean/nullable value computed per-endpoint at read time** by checking whether `history.populationDensitySamples` is present:
  - Leaderboard: `scoredWithAreaFactor: boolean` (`src/server/api/routers/simulation.ts:729-732`), rendered as a "4-factor score" badge for legacy rows (`src/app/leaderboard/page.tsx:65-72`).
  - Run comparison: `areaPopulationDensity: number | null` (`simulation.ts:952-957`), with `null` as the legacy signal, rendered as a per-row disclaimer (`src/app/runs/compare/page.tsx:141-148`) and `"N/A"`/omitted bar in the chart.
  - The single-run analysis view (`src/app/runs/[runId]/page.tsx`) deliberately never reads this signal — S-25 scoped the factor display to leaderboard + comparison only.
  - No shared enum/type ties the two derived signals together; each endpoint reimplements its own presence-check independently.
- **Implication**: the actual precedent to copy is "derive a presence/absence signal from the existing schema-less JSON blob, computed independently at each read site" — not a new migrated column. If the plan still wants a durable boolean per run (since "ever throttled" is a sticky lifetime fact unlike a one-time scoring-formula choice), that is a **genuinely new decision diverging from the S-25 precedent**, not a continuation of it, and should be flagged to the user as such rather than presented as "same pattern as S-25."

## 6. Every cross-run comparison/aggregation surface the marker must reach

| Surface | File:line | Cross-run? | Why it matters |
|---|---|---|---|
| Run-analysis page | `src/app/runs/[runId]/page.tsx`, backed by `getRunAnalysis` (`simulation.ts:794-869`) | No | Single-run only; computes `segmentCompletedCycles`, `computeGeneticDiversity`, `suggestRunOptimization` all scoped to one run's own history. A badge here is cosmetic, not corrective. |
| Run comparison | `src/app/runs/compare/page.tsx:91-241`, `getRunsComparison` (`simulation.ts:877-958`) | Yes | Resolves each of 2-4 `runIds` independently then renders them side-by-side in a table + Recharts bar chart for human eyeball comparison. A throttled run sitting unflagged next to normal runs is directly misleading — same disclaimer pattern as the existing legacy-row note (`page.tsx:140-148`) should extend to a throttled-row note. |
| Leaderboard | `src/app/leaderboard/page.tsx`, `listLeaderboard` (`simulation.ts:701-734`) | Yes | `.orderBy(desc(score), desc(startedAt)).limit(50)` — rank is a direct function of every other run's score. An unflagged throttled run with a skewed score corrupts every other run's rank position, not just its own display. |
| Parameter-suggestion heuristic | `src/server/simulation/parameter-suggestion.ts` (full file), `getParameterSuggestion` (`simulation.ts:741-789`) | Yes — most severely | Computes Pearson correlation between each ranged parameter and `score` across up to 500 of the user's `stopped` runs with no existing filter beyond `userId`/`status` (`simulation.ts:769-774`, `:781-785`). A throttled run's score pollutes the correlation sums for every parameter, not just one comparison, and this surface has zero existing disclaimer mechanism (unlike leaderboard/comparison) — it was not named in the original Unknown but genuinely needs the same treatment. |

**Conclusion**: the marker must reach leaderboard, run-comparison, AND the parameter-suggestion heuristic (not just the two named in the original framing) — either by excluding throttled runs from each query's row set, or by extending each surface's existing comparability-disclaimer pattern. The single-run analysis page does not need it structurally, though a cosmetic badge there is cheap and consistent.

## Settled facts for /10x-plan

- No viewer-count mechanism exists; it must be added inside `watchServerRun`/`LiveRun` (server-run-registry.ts), respecting the plain-generator-function testability rule in `lessons.md:33-38`.
- Watched↔unwatched can toggle multiple times per run; the comparability marker must be sticky ("ever throttled"), not reflect only final state.
- Multiplier applies inside `computeSingleRunTick` (`single-run-lifecycle.ts:99-104`), scaling `dtSeconds` before the `MAX_DT_SECONDS` clamp; `TICK_INTERVAL_MS` (16ms) scheduler cadence is untouched.
- No pre-approved multiplier number exists — capacity-limits.md only bounds the single-core ceiling (breakeven ~200 objects, cap defaults to 150). The plan must choose and justify a value, ideally validated via the existing `perf-baseline.ts` harness.
- The "copy S-25's marker" framing is corrected: S-25 used a derived JSON-presence check, not a column. A sticky per-run boolean is a legitimately new design choice for this feature, not a continuation of precedent — the plan should decide explicitly (new column vs. JSON-flag in `history`/a new field) and say why.
- The marker must be checked in run-comparison, leaderboard, AND parameter-suggestion (3 surfaces, not the 2 originally named); the single-run analysis page doesn't need it functionally.

## Open for /10x-plan to resolve

- Exact multiplier value and its justification.
- Exact schema shape for "ever throttled" (new `simulationRuns` column vs. a flag inside the existing `history` JSON, given the schema-less-JSON convention point above).
- Exact viewer-count data structure and its decrement path (loop-exit vs. explicit teardown) inside `watchServerRun`.
- Whether to exclude throttled runs from leaderboard/parameter-suggestion queries outright, or flag-and-include (matching the existing legacy-row disclaimer pattern).
