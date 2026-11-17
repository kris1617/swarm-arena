---
change_id: testing-concurrent-load-capacity
topic: "Rollout Phase 9 grounding — concurrent-load capacity test (Risk #9)"
researcher: Claude Sonnet 5
date: 2026-11-17
status: complete
---

# Research: Concurrent-load capacity test (rollout Phase 9, Risk #9)

## Question

Risk #9 (`context/foundation/test-plan.md` §2): "Aggregate concurrent-run
load — multiple server-owned simulations competing for one CPU core,
bounded only by the documented `maxConcurrentObjectCount` ceiling — is
never exercised by any automated test; a regression surfaces only in
production under real multi-user load." Ground the real failure path,
verify or correct the response guidance, and identify the cheapest test
layer that could prove protection.

## Summary

The admission-time-only enforcement this risk worries about is real and
confirmed in code, not speculative: `maxConcurrentObjectCount` (default
150) is checked once per admission and never re-checked against
already-running simulations' natural population growth. The feared
"flaky wall-clock test" and "fake-timer hang" obstacles both turn out to
be non-issues: this exact codebase already has a working, two-run
precedent for driving the real `setInterval`-based scheduler under
`vi.useFakeTimers()`, with zero hangs, in
`src/server/simulation/server-run-registry.test.ts`. The cheapest layer
that can prove protection is a direct extension of that existing test
file's pattern to 4 concurrent runs (matching the real per-user ceiling),
not a new harness and not Phase 8's single-process-interleaving approach
(which structurally cannot observe this risk).

## Detailed findings

### 1. The real scheduler

A separate `setInterval` is created per run (not one shared interval):
`startServerRun` registers `intervalId: setInterval(() => tick(params.runId), TICK_INTERVAL_MS)`
(`src/server/simulation/server-run-registry.ts:592`); `resumeServerRun`
does the same on resume (`:760`). `TICK_INTERVAL_MS = 16` (`:27`) — chosen
to approximate the client's ~60fps render loop so `elapsedSeconds` tracks
wall-clock seconds. A second, independent constant,
`WATCH_INTERVAL_MS = 150` (`:32`), paces the SSE push loop
(`watchServerRun`, `setTimeout` at `:800`) and is unrelated to tick
cadence.

Per-run in-memory state (`LiveRun` type, `:82-117`) lives in a
module-level `Map<number, LiveRun>` named `registry` (`:127`, cached on
`globalThis` to survive dev HMR). Relevant fields: `elapsedSeconds: number`
(`:109`), `lastTimestamp: number | null` (`:110`), `intervalId` (`:116`),
plus `boids`/`predators`/`foodStock` and five sample arrays.

### 2. Two separate concurrency ceilings — both admission-time-only

Two different constants gate concurrency, at two different call sites,
and **neither is re-checked once a run is ticking**:

- **`MAX_PARALLEL_RUNS = 4`** (`src/server/simulation/run-slots.ts:4`) —
  a **per-user** (not process-wide) cap on simultaneously-running rows.
  Enforced in `insertRunningSimulation`: a pre-insert count check
  (`src/server/api/routers/simulation.ts:278`) and a race-safety
  recheck-after-insert (`:329`, rolls the just-inserted row back to
  `status: "stopped"` if the recheck fails). Both queries filter
  `where(eq(simulationRuns.userId, userId), eq(simulationRuns.status, "running"))`
  (`:268-273`). No global/process-wide cap on total concurrent intervals
  across all users exists anywhere in `server-run-registry.ts` or the
  router.
- **`maxConcurrentObjectCount`** (admin-configurable, default **150** —
  `src/server/db/schema.ts:178`, `DEFAULT_MAX_CONCURRENT_OBJECT_COUNT`
  constant at `src/server/simulation/parameter-ranges.ts:107`) — the
  aggregate `boidCount + predatorCount` ceiling across a user's
  currently-ticking runs. Enforced by `assertWithinConcurrentObjectCeiling`
  (`simulation.ts:125-155`), called only from the `startServer` mutation
  (`:370`, right after `insertRunningSimulation`; on throw it rolls the
  just-inserted row back to `status: "stopped"`, `:376-385`) and the
  `resume` mutation (`:1227`). The "currently-ticking" total is computed
  as DB rows with `status: "running"` for that `userId`, filtered through
  the in-memory registry via `isServerRunActive(row.id)` to exclude
  client-staged (never server-ticking) runs (`:132-144`).

**Confirmed gap** (this is Risk #9's crux, not a hypothesis): population
grows mid-run via `reproducePopulation` (`src/server/simulation/boids.ts`,
called from `runTick`, lines 1151-1180), capped only by **`params.populationCap`**
— a per-run ceiling (FR-018 / `maxObjectCount`, comment at
`boids.ts:1142-1150`) — with no re-check against the aggregate
`maxConcurrentObjectCount`. Nothing in `server-run-registry.ts`'s tick
loop (`tick()`, `:445`) calls `assertWithinConcurrentObjectCeiling` or
reads `maxConcurrentObjectCount` at all. A user can start several runs
that together sit just under 150 at admission, then have each one's
population grow independently (up to each run's own per-run cap) with
zero further aggregate check — the aggregate ceiling is a best-effort
guarantee at admission time, not an invariant maintained for the
lifetime of running simulations.

A separate, unrelated **soft** (warn-only) check,
`checkConcurrentObjectCapSoft` (`simulation.ts:182-222`), exists only on
the explicit user-initiated `adjustLivePopulation` mutation (`:1055`,
check at `:1109`) — it warns rather than blocks, and is not invoked from
the autonomous-reproduction tick path either.

### 3. What "backlog / leak / drop" concretely mean in this codebase

- **Backlog**: `elapsedSeconds`/`lastTimestamp` falling behind
  `Date.now()`. `tick()` computes both from
  `computeSingleRunTick(..., Date.now(), ...)` (`:467`) — under real
  process overload, queued/delayed interval callbacks would show large
  real-time gaps vs. tick count.
- **Leak**: a `registry` entry whose `intervalId` is still firing with no
  legitimate removal having run (or the reverse: a cleared interval with
  the map entry still present).
- **Drop**: a run's `registry` entry or ticking silently stopping without
  any of the three legitimate removal paths having executed.

**No leak/drop bug found** in the three removal paths — in every one,
`clearInterval` and `registry.delete` are adjacent/paired: `finishRun`
(`:382-443`, used by natural completion and tick-exceptions, `:415-416`);
`stopServerRun` (`:603-630`, delegates to `finishRun` at `:617`);
`snapshotServerRun` (`:660-687`, direct `clearInterval`+`registry.delete`
at `:667-668`, bypassing `finishRun` since no DB score write happens on
pause). A different, already-documented gap exists in the code's own
comment (`:433-437`): if `finishRun`'s DB write throws, the registry is
still cleaned up correctly but the DB row is left stuck at
`status: "running"` — a DB/registry **state-divergence** bug, not a
registry-internal leak. This is out of Risk #9's scope (it's a
correctness bug on the error path, not a concurrency/capacity risk) but
worth naming if Phase 9's test incidentally exercises that path.

### 4. The feared fake-timer hang does NOT reproduce here

`context/foundation/test-plan.md` §6.7 documents that any DB-touching
`caller.simulation.*` call **through the tRPC router**
(`createCaller(...)`) hangs indefinitely under `vi.useFakeTimers()` in
this environment. That hang is specific to the router layer. Calling
`server-run-registry.ts`'s own exported functions directly — bypassing
`createCaller`/tRPC entirely — does **not** hang: `startServerRun` itself
is DB-free (pure in-memory: builds boids/predators from plain arguments,
calls `setInterval`, `:531-595`); the only DB I/O in this file is
`finishRun`'s write (`:419-427`, awaited inside the real async machinery
regardless of fake timers — fake timers intercept `setTimeout`/
`setInterval`/`Date`, not DB-driver promises) and `watchServerRun`'s read
(`:778-780`).

This is not a hypothesis — `server-run-registry.test.ts` (1,514 lines,
read in full) already proves it 37 times over: every test calls
`startServerRun`/`stopServerRun`/`watchServerRun`/etc. directly under
`vi.useFakeTimers()` and none hang. A working **two-run concurrent**
precedent exists at `:317-363`: two `startServerRun` calls
(`:331-340`, `:341-350`) followed by a single
`await vi.advanceTimersByTimeAsync(320)` (`:352`) that advances **both**
runs' independent `setInterval`s together, then assertions against both.
A second two-run precedent at `:1021-1131` interleaves snapshot/resume
across two runs. None of the existing tests assert anything about
`MAX_PARALLEL_RUNS`, admission-time capacity, or real concurrent-tick
backlog/leak/drop at scale — they only prove per-run state isolation
under fake-timer-driven concurrent ticking, not capacity. No existing
test drives more than 2 simultaneous runs.

The one established idiom worth carrying forward: a double
`await vi.advanceTimersByTimeAsync(...)` call
(e.g. `:118-119` — `advanceTimersByTimeAsync(3000)` then
`advanceTimersByTimeAsync(0)`) lets `finishRun`'s fire-and-forget DB
write settle before asserting against the DB row — not a workaround for
a hang, just the pattern for awaiting an async side effect scheduled
inside a fake-timer callback.

### 5. Realistic test parameters

**N = 4** concurrent runs is the natural, grounded choice — it matches
the real per-user ceiling (`MAX_PARALLEL_RUNS = 4`,
`run-slots.ts:4`), so the test exercises the actual maximum the product
allows rather than an arbitrary number. At ~35 combined boids+predators
per run (4 × 35 = 140), the aggregate sits just under the 150 default
`maxConcurrentObjectCount` — meaningfully near the ceiling without
inventing numbers. For tick volume: existing precedent advances fake time
in the thousands-of-ms range (e.g. `advanceTimersByTimeAsync(3000)`,
~188 ticks at `TICK_INTERVAL_MS=16`) which is still instant wall-clock;
the same order of magnitude (several thousand fake ms) gives hundreds of
real ticks per run across all 4 runs with no new technique required.

### 6. Cost × signal — no cheaper layer works

The registry-level `vi.useFakeTimers()` approach is already the cheapest
layer that gives real signal for this specific risk: it is hermetic (no
real wall-clock wait), and it drives the *actual* `setInterval`-based
scheduler, so it directly observes backlog (`elapsedSeconds`/
`lastTimestamp` drift), leak (orphaned registry/interval state), and
drop (silently-stopped ticking) exactly as they'd occur in production.

Phase 8's `scripts/perf-baseline.ts` (archived
`context/archive/2026-11-17-testing-perf-baseline/`) cannot substitute
for this risk and was never meant to: its "concurrent-run" dimension is
explicitly single-process-interleaved calls to `computeSingleRunTick`
directly, deliberately bypassing `setInterval` entirely (documented in
that change's own "What We're NOT Doing" section and in `test-plan.md`
§6.8). It measures raw per-tick compute cost; it cannot observe timer
drift, interval leaks, or dropped scheduler callbacks because it never
exercises the scheduler.

## Response guidance — verified / corrected

- **"Prove no backlog/leak/drop up to the aggregate ceiling"** — confirmed
  achievable via direct extension of `server-run-registry.test.ts`'s
  existing 2-run pattern to 4 runs, under `vi.useFakeTimers()`, driving
  the real scheduler. No new harness needed.
- **"Challenge whether admission-time enforcement is sufficient"** —
  confirmed insufficient: the aggregate ceiling is never re-checked
  against already-running runs' natural population growth (§2 above).
  This is the behavior the test should assert against — e.g., start 4
  runs near the aggregate ceiling, advance ticks long enough for
  reproduction to grow each run's population toward its own per-run cap,
  and confirm (a) nothing crashes/blocks server-side (there is no
  blocking mechanism to test — this is a documented gap, not a bug to
  reproduce a crash for) and (b) the *scheduler itself* — tick cadence,
  state isolation, cleanup — stays correct under that aggregate load
  regardless of whether the soft ceiling was exceeded.
- **"Avoid wall-clock sleeps"** — confirmed avoidable entirely; no real
  waits needed anywhere in this test.
- **"Avoid the fake-timer-hang problem resurfacing"** — confirmed it does
  not resurface here; that hang is router-specific (§4 above).

## Open items for `/10x-plan`

- Decide whether the DB-state/registry-state divergence bug noted in §3
  (`finishRun`'s comment at `:433-437`) is in scope for this phase's test
  (it's adjacent but not the stated risk) or belongs to a separate,
  explicitly-scoped follow-up change.
- Decide the exact assertion set for "backlog" under this test's fake-time
  advance — likely comparing each run's `elapsedSeconds`/tick-count
  progression against the others to confirm no run falls behind relative
  to its siblings, since fake time advances deterministically and there
  is no real OS-level contention to observe directly in this layer.
