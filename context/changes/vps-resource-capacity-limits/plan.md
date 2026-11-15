# VPS Resource Capacity Limits Implementation Plan

## Overview

Ground this app's server-owned-run capacity ceilings in this specific VPS's actual, measured throughput instead of the pre-existing, un-derived `DEFAULT_MAX_OBJECT_COUNT = 500`. Add a new aggregate-across-concurrent-server-owned-runs ceiling (a genuinely new concept — today's `maxObjectCount` only caps a single run), add container-level defense-in-depth, and document the measured capacity model durably so S-24 (configurable area) has a real ceiling to set the new area parameter's admin range against.

## Current State Analysis

**Measured, not assumed, tick cost** (via direct benchmarking of `runTick` against this repo's own code, same inputs `pipeline-perf.test.ts` already uses):

| Combined population (boids+predators) | Avg tick time |
|---|---|
| 100 | ~4.0ms |
| 200 | ~16.0ms |
| 300 | ~27.2ms |
| 400 | ~42.9ms |
| 500 (today's `DEFAULT_MAX_OBJECT_COUNT`) | ~50.6ms |

The server-owned tick loop (`server-run-registry.ts:278`, `TICK_INTERVAL_MS = 16`) targets a 16ms real-time cadence so `elapsedSeconds` tracks wall-clock seconds (per that file's own comment). **At the app's own existing default cap, a single run's tick already takes ~3x that budget** — real-time smoothness degrades well before reaching the documented maximum, independent of anything M-4 adds.

**This isn't mitigated by the VPS's 4 vCPUs.** `runTick`/`stepBoids` is synchronous JS executed on Node's single main thread; no `worker_threads` or child-process parallelism exists anywhere in `src/server/simulation/`. Every concurrently-ticking server-owned run (`MAX_PARALLEL_RUNS = 4`, `src/server/simulation/run-slots.ts:4`) competes for the *same single core's* cycles, not 4 cores' worth — a naive "4 vCPUs ÷ 4 runs" capacity model would be wrong by roughly 4x.

**No existing enforcement caps aggregate concurrent load.** `checkAgainstAdminRanges` (`src/server/api/routers/simulation.ts:98-117`) checks only `input.boidCount + input.predatorCount` against `adminSettings.maxObjectCount` for the *one run being started* — it has no visibility into the caller's other currently-ticking server-owned runs. `startServer`'s existing `MAX_PARALLEL_RUNS` check (`simulation.ts:139-149`) caps run *count*, not combined population — four runs at 150 individuals each (600 combined) pass today's checks with nothing capping the aggregate tick cost.

**No container-level resource limit exists** (confirmed 2026-11-15 via `docker inspect swarm-arena-app-1` — `Memory: 0, NanoCpus: 0`, i.e. unlimited). `docker-compose.yml`'s `app` service sets no `mem_limit`/`cpus`. The VPS has no swap configured (`free -h` showed `Swap: 0B`), so an unbounded memory spike has no cushion — though per the measurement below, raw memory use at these population sizes is small; the real risk this closes is a future regression (e.g., an unbounded per-tick history array), not today's known cost.

**Per-run memory cost is small and not the binding constraint** — measured directly: a 500-individual run's steady-state heap delta over 1,000 ticks was ~0.3MB; `phaseHistory`/`foodRatioSamples` grow by one small entry per tick (bounded by `maxDurationSeconds`'s existing 600s cap × the tick rate, a few tens of thousands of entries of primitives — single-digit MB even unthrottled). CPU (single-core tick-budget), not RAM, is this VPS's actual binding constraint for this feature.

**Explicitly deferred, not part of this change:** making ticking responsive to whether a run is actively watched (today's `TICK_INTERVAL_MS = 16` applies uniformly regardless of viewer presence — `watchServerRun`, `simulation.ts:408-423`, only controls how often *state is pushed* to a connected viewer via `WATCH_INTERVAL_MS = 150`, not how fast the run itself ticks). The project owner raised this as a promising direction, but `computeSingleRunTick`'s `dtSeconds` is derived from real wall-clock gaps (`timestamp - previousTimestamp`, `single-run-lifecycle.ts:74-77`), not a fixed value — making an unwatched run "catch up faster" would mean deliberately inflating its `dt` beyond real elapsed time, a change to the core tick-timing model every existing scored/analyzed/compared run already depends on. That's a bigger, separate decision with its own determinism implications, explicitly scoped out of this capacity-ceiling foundation — see "What We're NOT Doing."

## Desired End State

Starting a new server-owned run is rejected, with a clear message, if it would push the caller's own combined server-owned population (this run's own `boidCount + predatorCount`, plus the sum of their other currently-ticking server-owned runs') past a new, admin-configurable ceiling whose *default* is derived from this VPS's measured single-core tick budget — not an arbitrary number. The app's Docker container has an explicit memory limit as defense-in-depth. The measured capacity model (the table above, the single-core-contention correction, and the chosen default) is written down somewhere durable that S-24's later planning can read directly. Verification: starting server-owned runs whose combined population would exceed the new ceiling is rejected with the same clarity `MAX_PARALLEL_RUNS`'s existing rejection message already has; runs under the ceiling are unaffected.

### Key Discoveries:

- `checkAgainstAdminRanges`/`getOrSeedAdminSettings` (`simulation.ts:73-117`) already establish the exact pattern a new admin-configurable ceiling should follow — `adminSettings.maxObjectCount`'s own shape (one integer column, `.notNull().default(...)`, seeded on first read) is the direct template for a new `maxConcurrentObjectCount` column.
- `isServerRunActive(runId)` (`server-run-registry.ts:101`) already exists and is the exact primitive needed to filter a user's "running" DB rows down to the ones that are genuinely server-ticking (excluding client-staged rows that also show `status: "running"` but never touch `server-run-registry.ts` at all).
- `startInputSchema`'s shared validation (`simulation.ts:121-137`, used by both `start` and `startServer`) is boid/predator-count-agnostic of *other* runs today — the new aggregate check only needs to apply where runs actually tick server-side: `startServer` and `resumeServerRun`'s call site, not the client-staged `start` path (which never touches `server-run-registry.ts` and imposes zero server CPU cost regardless of population).

## What We're NOT Doing

- **Not changing the tick-scheduling/dt model to make unwatched runs catch up faster than real time.** Raised during planning as a promising direction, but it touches `computeSingleRunTick`'s wall-clock-derived `dtSeconds` — a foundational, determinism-adjacent mechanism every existing scored/analyzed/compared feature depends on. Deferred to its own future roadmap item once its determinism implications can be examined on their own, not folded into a capacity-measurement foundation. See roadmap `## Open Roadmap Questions`.
- **Not lowering `DEFAULT_MAX_OBJECT_COUNT`'s existing per-run default.** The new aggregate-across-runs ceiling is the actual enforcement mechanism this change adds; shrinking the per-run default on top of that would needlessly punish the common single-run case without adding real safety (a single run under the new aggregate ceiling is already safe).
- **Not implementing `worker_threads` or any form of tick parallelism.** Out of scope — a materially larger engine change than a capacity-ceiling foundation; the aggregate cap works within the single-core reality rather than trying to remove it.
- **Not touching `resolveOverlaps`/`stepPredators` or anything already addressed by S-23.** This change doesn't revisit the spatial-hash optimization's own scope.

## Implementation Approach

A new admin-configurable `maxConcurrentObjectCount` setting (same `admin_settings` row, same seed/read/write pattern as `maxObjectCount`), enforced only at the two call sites that actually start server-side ticking (`startServer`, `resumeServerRun`), by summing the caller's other currently-active server-owned runs' starting population against the new ceiling. Plus a Docker Compose memory limit and a durable capacity-policy doc.

## Phase 1: Aggregate concurrent-object-count ceiling

### Overview

Add the new admin-configurable ceiling and enforce it where server-owned runs actually start ticking.

### Changes Required:

#### 1. Add `maxConcurrentObjectCount` to `admin_settings`

**File**: `src/server/db/schema.ts`

**Intent**: A new column alongside `maxObjectCount`, same shape, defaulting to **150** — derived from the measured curve above (tick time crosses the 16ms real-time budget around 200 combined individuals; 150 leaves headroom for GC pauses, the web server's own request handling, and OS scheduling jitter sharing the same single core, rather than targeting the exact breakeven point).

**Contract**: `maxConcurrentObjectCount: d.integer().notNull().default(150)`. Requires a new Drizzle migration (`drizzle-kit generate`), same as every prior `admin_settings` column addition.

#### 2. Extend the admin-settings seed/read/write path

**File**: `src/server/api/routers/simulation.ts`

**Intent**: `getOrSeedAdminSettings` and the existing admin-settings mutation (`simulation.ts:887-925`, consumed by the admin UI from S-22) both need to read/write the new column alongside `maxObjectCount`, following the exact same pattern.

**Contract**: `getOrSeedAdminSettings`'s return type gains `maxConcurrentObjectCount: number`; the admin-settings update mutation's input schema gains the matching `z.number().int().positive()` field.

#### 3. Enforce the aggregate ceiling in `startServer` and `resumeServerRun`

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Before starting (or resuming) a server-owned run, sum the caller's *other* currently-active server-owned runs' starting `boidCount + predatorCount` (via a DB query for the caller's `status = "running"` rows, filtered to those where `isServerRunActive(row.id)` is true — excluding client-staged rows that share the same DB status but never tick server-side), add this run's own population, and reject with a clear message if the total exceeds `maxConcurrentObjectCount`.

**Contract**: New check runs after the existing `MAX_PARALLEL_RUNS` check and before `startServerRun`/`resumeServerRun` is actually invoked (so a rejection never leaves a half-started registry entry). Rejection uses the same `TRPCError({ code: "BAD_REQUEST", ... })` shape as the existing `MAX_PARALLEL_RUNS` rejection, with a message naming the actual combined count and the ceiling (e.g. `` `Starting this run would bring your combined server-run population to ${total}, over the ${ceiling} limit — stop another server run first.` ``).

#### 4. Tests

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Cover the new check the same way `MAX_PARALLEL_RUNS`'s existing tests do (`simulation.test.ts:608-690` is the direct template): starting a server-owned run that would push the caller's aggregate over the ceiling is rejected; one under the ceiling (even with `MAX_PARALLEL_RUNS` otherwise satisfied) succeeds; a client-staged (`start`, not `startServer`) run of any size never counts toward or is blocked by this ceiling; resuming a saved run is checked the same way a fresh start is.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New tests cover: aggregate-ceiling rejection on `startServer`, success under the ceiling, client-staged runs excluded from the aggregate, `resumeServerRun`'s identical enforcement
- The derived default for `maxConcurrentObjectCount` is computed from the measured tick-cost curve above (the combined-population value where tick time first exceeds the 16ms real-time budget, i.e. ~200, minus a safety margin for GC/OS-scheduling jitter and the web server's own request handling sharing the same core) and the chosen number plus its derivation is written into the capacity-policy doc (Phase 2) — not left as a bare magic number in the migration alone

#### Manual Verification:

- Start several server-owned runs whose combined population approaches the new ceiling; confirm the one that crosses it is rejected with a clear, actionable message (not a generic 500).
- Confirm a client-staged (non-server) run is never affected regardless of size.

## Phase 2: Container defense-in-depth + capacity policy documentation

### Overview

Add a Docker-level memory ceiling and write down the measured capacity model durably.

### Changes Required:

#### 1. Add a memory limit to the `app` service

**File**: `docker-compose.yml`

**Intent**: A generous but real ceiling — defense-in-depth against an unbounded-growth bug (e.g. a future per-tick array that forgets to cap itself), not a tight budget against today's known (small) per-run memory cost. **4GB**, leaving ~3.7GiB headroom for the OS, Caddy, and normal request handling on this 7.7GiB, no-swap machine.

**Contract**: `services.app.mem_limit: 4g` (Compose v2 shorthand, honored under plain `docker compose` — NOT `deploy.resources.limits.memory`, which is a documented Swarm-only no-op under plain Compose; confirm at implementation time via `docker compose config` that the limit actually appears, per this phase's own Automated Verification).

#### 2. Write the capacity-policy doc

**File**: `context/foundation/capacity-limits.md` (new)

**Intent**: The durable record S-24 reads when setting the area parameter's admin range — the measured tick-cost table, the single-core-contention correction, the chosen `maxConcurrentObjectCount` default and its derivation, the container memory limit and its rationale, and the explicitly-deferred viewer-aware-scheduling idea (with a pointer to wherever it's tracked for the future).

**Contract**: Plain markdown, no frontmatter contract required (this isn't one of the `/10x-*` skill-owned foundation docs with an enforced schema) — but must be referenced from `context/foundation/README.md`'s doc index if one exists, following that file's existing convention.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- `docker compose config` (or equivalent) confirms the memory limit is actually applied under plain Compose, not silently ignored as a Swarm-only `deploy.resources` key

#### Manual Verification:

- Deploy and confirm `docker inspect swarm-arena-app-1` now reports the configured memory limit instead of `0` (unlimited).
- Confirm the app still starts and serves requests normally under the new limit (no immediate OOM at idle/normal load).

## Testing Strategy

### Unit Tests:

- `simulation.test.ts`: the four new `startServer`/`resumeServerRun` aggregate-ceiling cases listed in Phase 1.

### Manual Testing Steps:

1. As the admin, confirm the new `maxConcurrentObjectCount` setting is visible/editable wherever `maxObjectCount` already is (the existing admin settings UI from S-22).
2. Start enough server-owned runs to approach, then cross, the new aggregate ceiling; confirm the rejection message is clear.
3. Confirm production's container memory limit is live post-deploy (`docker inspect`).

## Performance Considerations

This change's entire purpose is a performance/capacity ceiling. No new hot-path code — the new check is one DB query plus an integer comparison at run-start time, not a per-tick cost.

## Migration Notes

New `admin_settings.maxConcurrentObjectCount` column — standard Drizzle migration, `.notNull().default(...)` so it applies cleanly to the existing single production row without a backfill step.

## References

- `src/server/simulation/boids.ts`, `src/server/simulation/server-run-registry.ts`, `src/server/simulation/single-run-lifecycle.ts` — the tick engine this plan measures and bounds, not modifies.
- `src/server/api/routers/simulation.ts:73-149` — `getOrSeedAdminSettings`/`checkAgainstAdminRanges`/`MAX_PARALLEL_RUNS` check, the direct templates for this plan's new ceiling.
- `src/server/db/schema.ts:151-161` — `admin_settings`, the table this plan extends.
- `src/server/simulation/run-slots.ts` — `MAX_PARALLEL_RUNS`, the existing run-count cap this plan's aggregate-population cap complements (not replaces).
- `docker-compose.yml`, confirmed VPS specs (2026-11-15: 4 vCPU AMD EPYC-Milan, 7.7GiB RAM, 232GB disk, no container limits, no swap).
- Roadmap `context/foundation/roadmap.md` F-07 — the Foundation this plan implements, and its `## Open Roadmap Questions` entry for the deferred viewer-aware scheduling idea.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Aggregate concurrent-object-count ceiling

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run check`
- [ ] 1.3 Full suite still passes: `npm test`
- [ ] 1.4 New tests cover aggregate-ceiling rejection, success under ceiling, client-staged exclusion, resume enforcement
- [ ] 1.5 Derived default for `maxConcurrentObjectCount` is documented with its derivation, not a bare number

#### Manual

- [ ] 1.6 Server-owned runs crossing the aggregate ceiling are rejected with a clear message
- [ ] 1.7 Client-staged runs are confirmed unaffected regardless of size

### Phase 2: Container defense-in-depth + capacity policy documentation

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`
- [ ] 2.4 `docker compose config` confirms the memory limit is actually applied under plain Compose

#### Manual

- [ ] 2.5 Production's container memory limit is live post-deploy (`docker inspect`)
- [ ] 2.6 App starts and serves requests normally under the new limit
