# Capacity Limits

The durable record of what this app's simulation-engine capacity ceilings are actually grounded in — this VPS's measured, real throughput, not an arbitrary guess. Written during F-07 (roadmap M-4, "Area, camera, and ops limits"); read by S-24 (configurable simulation area) when setting the new area parameter's admin range.

## The VPS

Confirmed via direct inspection, 2026-11-15:

- **CPU**: 4 vCPU, AMD EPYC-Milan
- **RAM**: 7.7GiB total, ~6.1GiB available at inspection time
- **Disk**: 232GB total, 187GB free
- **Swap**: none configured
- **Container limits**: none set prior to F-07 (`docker inspect` reported unlimited memory/CPU)

## The real binding constraint is CPU, not RAM

Direct benchmarking of `runTick` (the same function `pipeline-perf.test.ts` measures), at this app's actual parameters:

| Combined population (boids+predators) | Avg tick time |
|---|---|
| 100 | ~4.0ms |
| 200 | ~16.0ms |
| 300 | ~27.2ms |
| 400 | ~42.9ms |
| 500 (pre-F-07 `DEFAULT_MAX_OBJECT_COUNT`) | ~50.6ms |

The server-owned tick loop (`server-run-registry.ts`'s `TICK_INTERVAL_MS = 16`) targets a 16ms real-time cadence. Tick time crosses that budget around **200** combined individuals — well before the pre-F-07 default of 500, which already ran at ~3x budget for a single run alone.

**The VPS's 4 vCPUs don't help.** `runTick`/`stepBoids` is synchronous JS executed on Node's single main thread — no `worker_threads` or child-process parallelism exists anywhere in `src/server/simulation/`. Every concurrently-ticking server-owned run (`MAX_PARALLEL_RUNS = 4`) competes for the *same single core's* cycles, not 4 cores' worth.

Per-run **memory** cost, by contrast, is small and not the binding constraint: a 500-individual run's steady-state heap delta over 1,000 ticks measured ~0.3MB; `phaseHistory`/`foodRatioSamples` grow by one small entry per tick, bounded by `maxDurationSeconds`'s existing 600s cap — single-digit MB even unthrottled.

## What F-07 did about it

1. **`admin_settings.maxConcurrentObjectCount`** (default **150**) — caps the *sum* of `boidCount + predatorCount` across every one of a user's currently-ticking server-owned runs at once, not just a single run (`maxObjectCount` already did that). 150 leaves margin below the measured ~200 breakeven point, for GC pauses, the web server's own request handling, and OS scheduling jitter sharing the same single core. Enforced at `startServer` and `resume` — the two call sites that actually start server-side ticking — via `assertWithinConcurrentObjectCeiling` in `src/server/api/routers/simulation.ts`. Client-staged (`start`) runs never count toward or are blocked by this ceiling, since they never tick server-side at all.
2. **`docker-compose.yml`'s `app` service: `mem_limit: 4g`** — defense-in-depth against a *future* unbounded-growth bug (not today's known, small memory cost), leaving ~3.7GiB headroom for the OS, Caddy, and normal request handling on this no-swap machine. Uses the plain-Compose `mem_limit` shorthand, not `deploy.resources.limits.memory` (a documented Swarm-only no-op under plain `docker compose`, which this project uses).

## What F-07 explicitly did not do

**Viewer-aware tick scheduling** — making unwatched (background) server-owned runs tick faster than real time, so they don't compete for CPU against the one run a user is actively watching — was raised during F-07's planning and explicitly deferred. `computeSingleRunTick`'s `dtSeconds` is derived from real wall-clock gaps (`timestamp - previousTimestamp`), not a fixed value, today — making an unwatched run "catch up faster" means deliberately inflating its `dt` beyond real elapsed time, a change to the core tick-timing/determinism model every existing scored/analyzed/compared run depends on. That's a bigger, separate decision than a capacity-measurement foundation should take on — tracked as `context/foundation/roadmap.md`'s Open Roadmap Question #8, not folded into this change.

**Lowering the per-run `DEFAULT_MAX_OBJECT_COUNT` default** — left at 500. The new aggregate-across-runs ceiling (above) is the actual enforcement mechanism; shrinking the per-run default on top of that would needlessly punish the common single-run case without adding real safety (a single run under the aggregate ceiling is already safe).

**Any form of tick-execution parallelism** (`worker_threads`, multi-process) — out of scope; a materially larger engine change than a capacity-ceiling foundation. The aggregate cap works within the single-core reality rather than trying to remove it.

## Reading this for S-24 (configurable area)

If a future change makes the simulation's spatial area itself configurable, re-derive — don't just reuse — this table's numbers if the area's size materially changes query density (e.g. `NEIGHBOR_RADIUS` as a fraction of world volume), since the tick-cost curve above was measured at today's fixed 200-unit world. The single-core-contention finding (vCPU count doesn't parallelize this engine) holds regardless of area size and does not need re-measuring.


## Reproducible Benchmark Results

Latest reproducible run (`npm run perf:baseline`, rollout Phase 8): **2026-11-17T06:13:19.516Z**, commit `8d1c3de939e30df9b9f64c067fb4fcee46cba9ed`, Node `v22.22.1`.

Each row measures 8 tinybench samples of `computeSingleRunTick` driven across a fixed tick budget, at the given object count / world area / single-process-interleaved concurrent-run count. See `scripts/perf-baseline.ts` for the exact grid and methodology.

| Object count | Area | Concurrent runs | Mean tick-set time (ms) | Std dev (ms) | Samples |
|---|---|---|---|---|---|
| 100 | 200 | 1 | 169.05 | 25.91 | 8 |
| 100 | 200 | 2 | 155.30 | 6.93 | 8 |
| 100 | 200 | 4 | 185.45 | 3.90 | 8 |
| 100 | 400 | 1 | 62.76 | 0.76 | 8 |
| 100 | 400 | 2 | 63.61 | 1.33 | 8 |
| 100 | 400 | 4 | 72.97 | 17.13 | 8 |
| 100 | 1000 | 1 | 90.06 | 3.07 | 8 |
| 100 | 1000 | 2 | 86.84 | 2.29 | 8 |
| 100 | 1000 | 4 | 85.60 | 2.27 | 8 |
| 200 | 200 | 1 | 543.15 | 11.19 | 8 |
| 200 | 200 | 2 | 484.74 | 15.92 | 8 |
| 200 | 200 | 4 | 499.01 | 8.60 | 8 |
| 200 | 400 | 1 | 182.46 | 15.51 | 8 |
| 200 | 400 | 2 | 198.02 | 7.13 | 8 |
| 200 | 400 | 4 | 173.22 | 11.01 | 8 |
| 200 | 1000 | 1 | 149.41 | 3.61 | 8 |
| 200 | 1000 | 2 | 144.46 | 2.64 | 8 |
| 200 | 1000 | 4 | 146.37 | 3.12 | 8 |
| 300 | 200 | 1 | 988.24 | 20.62 | 8 |
| 300 | 200 | 2 | 1010.70 | 16.75 | 8 |
| 300 | 200 | 4 | 1022.35 | 24.31 | 8 |
| 300 | 400 | 1 | 330.52 | 2.27 | 8 |
| 300 | 400 | 2 | 337.44 | 3.95 | 8 |
| 300 | 400 | 4 | 350.33 | 17.57 | 8 |
| 300 | 1000 | 1 | 264.93 | 2.67 | 8 |
| 300 | 1000 | 2 | 269.85 | 6.29 | 8 |
| 300 | 1000 | 4 | 282.51 | 14.34 | 8 |
| 400 | 200 | 1 | 1711.28 | 25.13 | 8 |
| 400 | 200 | 2 | 1747.33 | 36.09 | 8 |
| 400 | 200 | 4 | 1753.52 | 49.73 | 8 |
| 400 | 400 | 1 | 559.56 | 4.97 | 8 |
| 400 | 400 | 2 | 578.10 | 35.08 | 8 |
| 400 | 400 | 4 | 593.55 | 50.66 | 8 |
| 400 | 1000 | 1 | 421.44 | 1.26 | 8 |
| 400 | 1000 | 2 | 444.23 | 28.65 | 8 |
| 400 | 1000 | 4 | 475.85 | 58.03 | 8 |
| 500 | 200 | 1 | 2806.03 | 114.78 | 8 |
| 500 | 200 | 2 | 2779.25 | 59.31 | 8 |
| 500 | 200 | 4 | 2683.07 | 79.02 | 8 |
| 500 | 400 | 1 | 879.01 | 11.81 | 8 |
| 500 | 400 | 2 | 886.48 | 25.91 | 8 |
| 500 | 400 | 4 | 927.15 | 51.90 | 8 |
| 500 | 1000 | 1 | 624.63 | 10.17 | 8 |
| 500 | 1000 | 2 | 650.57 | 53.05 | 8 |
| 500 | 1000 | 4 | 691.40 | 58.33 | 8 |
| 1000 | 200 | 1 | 9989.98 | 74.62 | 8 |
| 1000 | 200 | 2 | 10200.84 | 71.26 | 8 |
| 1000 | 200 | 4 | 10799.26 | 403.93 | 8 |
| 1000 | 400 | 1 | 3419.61 | 25.12 | 8 |
| 1000 | 400 | 2 | 3484.57 | 31.03 | 8 |
| 1000 | 400 | 4 | 3535.76 | 126.60 | 8 |
| 1000 | 1000 | 1 | 2437.49 | 52.33 | 8 |
| 1000 | 1000 | 2 | 2487.18 | 71.11 | 8 |
| 1000 | 1000 | 4 | 2578.36 | 6.68 | 8 |

Full historical data (every run, not just the latest) is in `context/foundation/perf-baseline.json`.
