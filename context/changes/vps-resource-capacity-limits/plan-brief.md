# VPS Resource Capacity Limits — Plan Brief

> Full plan: `context/changes/vps-resource-capacity-limits/plan.md`

## What & Why

Roadmap F-07 / M-4: ground this app's capacity ceilings in this specific VPS's actual, measured throughput — unlocking S-24 (configurable area), whose admin-range for the new area parameter needs a real ceiling to respect, not a guess.

## Starting Point

`DEFAULT_MAX_OBJECT_COUNT = 500` was never derived from real measurement. Direct benchmarking this session found a single run's tick time already crosses the 16ms real-time budget around **200** combined individuals, and reaches **~50ms** (3x budget) at today's existing 500 default — and this isn't helped by the VPS's 4 vCPUs, since the tick engine is single-threaded JS with no parallelism. Nothing today caps the *aggregate* population across the up to 4 concurrently-ticking server-owned runs `MAX_PARALLEL_RUNS` already allows.

## Desired End State

Starting a new server-owned run is rejected if it would push the caller's combined server-owned population (this run plus their other currently-ticking ones) past a new, admin-configurable ceiling defaulting to a measured-and-margined 150. The app's container has a real memory limit. The measured model is written down for S-24 to read.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Capacity model correction | Single-core budget, not 4x | Node's tick execution is single-threaded JS; measured directly, not assumed | Plan (discovered during planning) |
| Enforcement mechanism | New aggregate-across-runs ceiling, not a lower per-run default | The per-run cap already exists; the real gap is nothing capping the *combined* load of several concurrent runs | Plan |
| Default ceiling value | 150 (combined individuals) | Tick time crosses the 16ms budget at ~200; 150 leaves margin for GC/OS/webserver sharing the one core | Plan, grounded in direct benchmarking |
| Viewer-aware tick scheduling | Deferred — own future roadmap item | `dtSeconds` is wall-clock-derived today; "unwatched runs catch up faster" means deliberately inflating dt, a determinism-adjacent engine change bigger than a capacity-ceiling foundation should take on | User (AskUserQuestion, after the dt-model finding) |
| Container memory limit | 4GB (`mem_limit`, not `deploy.resources`) | Defense-in-depth against future unbounded growth, with real headroom on this 7.7GiB no-swap box; the Swarm-only `deploy` key would silently no-op under plain Compose | Plan |

## Scope

**In scope:** a new admin-configurable `maxConcurrentObjectCount` setting, enforcement at `startServer`/`resumeServerRun`, a Docker Compose memory limit, a durable capacity-policy doc.

**Out of scope:** viewer-aware/accelerated tick scheduling (deferred, see above), lowering the existing per-run `DEFAULT_MAX_OBJECT_COUNT`, any form of tick-execution parallelism, anything already addressed by S-23's spatial-hash work.

## Architecture / Approach

Follows the existing `admin_settings`/`checkAgainstAdminRanges` pattern exactly (same shape as `maxObjectCount`) for the new ceiling; enforced only where runs actually tick server-side, via a DB query filtered through the existing `isServerRunActive` primitive so client-staged runs are correctly excluded.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Aggregate concurrent-object-count ceiling | New admin setting + enforcement at start/resume | Low-medium — new DB-backed check, follows an existing pattern closely |
| 2. Container defense-in-depth + documentation | Docker memory limit, capacity-policy doc | Low — the Compose `deploy` vs `mem_limit` distinction is the one real gotcha |

**Prerequisites:** none.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The 150 default is grounded in measurement but still a judgment call on margin; S-24's own planning should sanity-check it once the area parameter introduces a genuinely different population regime (if any).
- The deferred viewer-aware-scheduling idea is tracked in the roadmap's Open Roadmap Questions, not lost — just not part of this change.

## Success Criteria (Summary)

- A server-owned run that would push the caller's combined population past 150 is rejected with a clear message; client-staged runs are never affected.
- The app's container reports a real memory limit in production.
- The measured capacity model and its derivation are written down for S-24 to consume.
