# Plan Brief: Keep spatial-grid neighbor queries bounded when boids cluster densely

Full plan: `context/changes/spatial-grid-dense-clustering-fallback/plan.md`

## What and why

`queryRadius` (`spatial-grid.ts`) narrows neighbor searches by grid cell, but has no bound on how many candidates a single cell neighborhood can return. At default `separationWeight: 1`, boids spread out enough that this never matters. At `separationWeight: 0.5` — the lowest value in `parameter-sweep-corpus-generation`'s own sweep matrix — boids cluster tightly enough that `queryRadius` returns most of the population per call, degrading `stepBoids`/`stepPredators`'s force computation and `reproducePopulation`'s mate-scan from near-O(1) to near-O(n) per individual, per tick. Confirmed empirically: a 300s run completed in 91 real seconds; a 900s run (only 3x longer) didn't finish even after 30 real minutes.

## Starting Point

- `buildSpatialGrid`'s cell size is tied directly to the query radius for correctness — there's no "make cells finer" lever available.
- Three call sites in `boids.ts` (`stepBoids`, `stepPredators`, `reproducePopulation`) each build their own grid every tick and call `queryRadius` once per individual.
- `single-run-lifecycle.ts`'s shared tick-state already threads sibling per-tick flags (`populationCapped`, `lastTimestamp`) across both the server-owned (`server-run-registry.ts`) and client-staged (`simulation-canvas.tsx`) execution paths — the new warned-flag follows that exact existing pattern.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Candidate-bounding strategy | Truncate existing ascending-index-sorted result, no distance-sort | Zero new computation; preserves `reproducePopulation`'s documented ordering contract for deterministic mate selection |
| Mate-scan treatment | Same cap applies uniformly, no exemption | One simple fix at the grid level; `reproducePopulation`'s mate-scan is the costliest of the three call sites and the one directly implicated in the confirmed slowdown |
| Cap value | 64 | Far above any default-density scenario (≈4-10/cell), far below what a dense cluster returns — won't perturb existing tests |
| Observability | `console.warn` once per **run** (not once per process, not silent) | Gives a real signal when clustering degrades fidelity, without re-logging every tick |
| Warn-flag storage | Threaded through `computeSingleRunTick`'s shared state, following `lastTimestampRef`'s plain-ref pattern (not `populationCapped`'s React-state pattern, since there's no UI need) | Faithful to "once per run" since a fresh grid is built every tick — a module-level flag would only be "once per process" |
| Verification | Dedicated perf regression test (synthetic dense cluster + wall-clock budget assertion), not a live corpus-generation re-run | Encodes the regression permanently in the suite; a live rerun is slow and was already the source of this session's diagnosis pain |
| Scope boundary | `parameter-sweep-corpus-generation`'s real 20-row generation re-run is a separate follow-up, not part of this plan | Keeps this change to the engine fix itself |

## Phases

1. **Cap `queryRadius` + warn-sink** (`spatial-grid.ts`) — the core fix and its perf regression tests.
2. **Thread the warn-sink through `boids.ts`** — `stepBoids`/`stepPredators`/`reproducePopulation`/`runTick` all forward one shared per-tick sink.
3. **Persist the flag across ticks** (`single-run-lifecycle.ts`, `server-run-registry.ts`, `simulation-canvas.tsx`) — turns "warned this tick" into "warned once per run."

**Prerequisites**: None — this is a self-contained engine fix with no dependency on other in-flight changes.
**Estimated effort**: Low-medium — one isolated function (Phase 1), then two layers of mechanical threading following an existing pattern (Phases 2-3).

## References

- Motivating investigation: `context/changes/parameter-sweep-corpus-generation/plan.md` (Phase 4)
- `src/server/simulation/spatial-grid.ts`
- `src/server/simulation/boids.ts`
- `src/server/simulation/single-run-lifecycle.ts`
