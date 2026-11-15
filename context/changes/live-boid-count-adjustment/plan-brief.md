# Live-adjust boid and predator count — Plan Brief

> Full plan: `context/changes/live-boid-count-adjustment/plan.md`

## What & Why

Lets a user grow or shrink a running server-owned simulation's boid and predator populations live, via step buttons on the existing live-edit panel. The roadmap scoped this to boids only; scope was expanded during planning to cover predators too, since `PredatorState` carries the identical `energy`/`age` shape `BoidState` does, making the mechanism symmetric at no extra design cost.

## Starting Point

Six scalar fields (`foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude`, `crossbreedingEnabled`) are already live-adjustable via `applyLiveParams`, which patches `run.params` in-memory. `boidCount`/`predatorCount` are structurally different — they determine the *length* of the live `run.boids`/`run.predators` arrays, set once at population creation and never touched again during a run. No existing code mutates these arrays from outside the tick loop.

## Desired End State

The live panel shows the current boid and predator count, each with `-10`/`+10` buttons. `+10` spawns 10 new individuals clustered near the existing population's centroid; `-10` removes the 10 lowest-energy individuals. Both are visible in the live view on the next tick. A soft warning shows if either per-run or cross-run object-count ceilings would be exceeded — the change still applies, matching every other live-adjust field's warn-and-apply UX.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Growth spawn position | Clustered near existing population's centroid | Reads as "the flock grew" rather than "boids appeared randomly" | Plan |
| Shrink cull rule | Lowest-energy-first | Reads as a natural consequence, consistent with the existing hunger-driven cull being energy-related | Plan |
| Cap enforcement | Soft-warn on both per-run (`maxObjectCount`) and cross-run (`maxConcurrentObjectCount`) caps | Matches every other live-adjust field's warn-and-apply UX; never silently rejects | Plan |
| UI shape | Fixed step buttons (+10/-10), no free-text target input | Impossible to fat-finger a huge accidental delta; matches a "nudge, observe, nudge again" usage pattern | Plan |
| Scope | Both boids AND predators | `PredatorState` has the identical energy/age shape, symmetric at no extra cost | Plan |
| Decrease floor | Allowed down to 0 | Consistent with existing game rules — the sim already tolerates population collapse via natural death | Plan |
| Throttle | Shares the existing 500ms `PARAM_UPDATE_THROTTLE_MS` gate | One throttle mechanism for the whole live-adjust surface, no new constant | Plan |

## Scope

**In scope:**
- Live growth/shrink of `boidCount` and `predatorCount` on a running server-owned simulation only.
- Clustered spawn positioning, lowest-energy-first culling.
- Soft-warn validation against both per-run and cross-run object-count caps.
- `-10`/`+10` step-button UI on `ServerRunViewer`'s existing live panel.

**Out of scope:**
- `flockCount` (parked at roadmap level — `flockId` is set once at birth, never re-derived per tick).
- Client-staged execution path (`simulation-canvas.tsx`) — this slice is server-owned only, per the roadmap's own framing.
- Free-form target-count input.
- Persisting the live-adjusted count to the DB mid-run (matches the 6 existing scalar fields' in-memory-only behavior).

## Architecture / Approach

Phase 1 adds `adjustLivePopulation(runId, kind, delta)` to `server-run-registry.ts`, sharing `applyLiveParams`'s throttle/changelog pattern but mutating `run.boids`/`run.predators` arrays directly instead of a `run.params` scalar. Phase 2 adds a router procedure with ownership/active-run checks (mirroring `updateRunParams`) plus two new soft-check helpers — one for the per-run cap, one for the cross-run cap sourced from live registry state (via already-exported `getLiveRunState`/`isServerRunActive`) rather than the DB's stale start-time columns. Phase 3 adds the step-button UI to the existing panel, reading current counts from data the component already receives over its subscription.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared population-mutation mechanism | `adjustLivePopulation` in the registry, growth (clustered spawn) + shrink (lowest-energy cull) for both boids and predators | Getting the synchronous-mutation safety invariant right — no `await` between reading and writing `run.boids`/`run.predators` |
| 2. Router procedure & cap checks | New tRPC mutation + two soft-check helpers (per-run, cross-run) | The cross-run check must read live counts (not DB columns) to stay accurate against other live-adjusted runs |
| 3. Server-owned panel UI | Step buttons wired to the new mutation | Manual verification must observe the actual live-view population change, not just a displayed count (per `lessons.md`) |

**Prerequisites:** None — roadmap confirms no blockers.
**Estimated effort:** ~3 phases, similar scope to S-27/S-29.

## Open Risks & Assumptions

- The centroid-clustering jitter (`(individual.x + centroid.x) / 2`) is a new, unprecedented code path — no existing codebase pattern to copy exactly, unlike the cull-by-filter idiom.
- The cross-run cap soft-check assumes `getLiveRunState` never returns `undefined` for a row `isServerRunActive` just confirmed true for — a narrow race window exists between the two calls (run stops between the check and the read), guarded by a DB-column fallback.

## Success Criteria (Summary)

- A user can grow or shrink a running server-owned simulation's boid and predator counts via step buttons, and sees the population size change reflected in the live view within the next tick.
- New individuals visibly cluster near the existing flock rather than scattering randomly; removed individuals are the lowest-energy ones, not an arbitrary subset.
- Exceeding either object-count cap warns but never blocks the change.
