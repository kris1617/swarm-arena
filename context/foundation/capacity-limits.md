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
