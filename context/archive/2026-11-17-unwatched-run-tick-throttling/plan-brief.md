# Unwatched-run tick throttling — Plan Brief

> Full plan: `context/changes/unwatched-run-tick-throttling/plan.md`
> Research: `context/changes/unwatched-run-tick-throttling/research.md`

## What & Why

S-36 (M-9's north star, Open Roadmap Question #8): unwatched server-owned
simulation runs tick at the same real-time cadence as the one the user is
actively watching, competing equally for the single CPU core this engine
runs on. This plan gives unwatched runs a 3x simulated-time speed multiplier
after a 5-second grace period, relieving that contention, while flagging any
run that is ever throttled so its score/history is never silently treated as
comparable to a run that never used this feature.

## Starting Point

`computeSingleRunTick` derives `dtSeconds` from real wall-clock gaps; the
real-time scheduler (`TICK_INTERVAL_MS = 16`) and the watch subscription
(`watchServerRun`) are today fully decoupled — the registry has no concept
of how many watchers a run has. S-25's existing comparability-marker
precedent is a JSON-presence check on a schema-less blob, not a DB column.

## Desired End State

A run left unwatched for 5+ seconds ticks 3x faster in simulated time,
relieving CPU pressure on a concurrently-watched run. Any run that this ever
happens to is permanently flagged and disclosed — not hidden — on the
leaderboard, in run comparison, and in the parameter-suggestion heuristic's
rationale text.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Speed multiplier | 3x | Meaningful relief without extreme per-tick dt jumps (0.1s × 3 = 0.3s, within existing `MAX_DT_SECONDS` clamp) | Plan |
| Marker schema | New DB column (`wasEverThrottled`), diverging from S-25's JSON-presence precedent | Direct SQL filterability for leaderboard/parameter-suggestion; a sticky lifetime fact unlike S-25's one-time scoring choice | Research + Plan |
| Viewer tracking | `Set<subscriberId>` on `LiveRun` | Self-correcting against double-decrement bugs vs. a raw counter | Plan |
| Throttle trigger | 5-second grace period after watcher count hits zero | Avoids flagging brief refresh/reconnect gaps as "ever throttled" | Plan |
| Exclude vs. flag | Flag-and-include on all 3 surfaces | Consistent with the existing `scoredWithAreaFactor` disclosure precedent; doesn't shrink the user's own history | Plan |
| Marker reach | Leaderboard + run-comparison + parameter-suggestion (3 surfaces) | Research found the parameter-suggestion heuristic also runs a cross-run Pearson correlation, not named in the original framing | Research |
| Validation | Perf-baseline harness run required before complete | Matches the lesson this project just recorded: a structural guard can pass while real wall-clock cost regresses | Plan |

## Scope

**In scope:** viewer-count tracking, grace-period trigger, dt multiplier, sticky DB marker, disclosure on 3 cross-run surfaces, perf validation.

**Out of scope:** excluding throttled runs from any query; per-user/session grace-period nuance; the single-run analysis page; changing `WATCH_INTERVAL_MS`/`TICK_INTERVAL_MS`; CI wiring for the perf comparison.

## Architecture / Approach

A `Set<subscriberId>` on `LiveRun` tracks active watchers; a grace timer
starts when it empties. `tick()` reads whether the grace period has elapsed
and passes a `speedMultiplier` into `computeSingleRunTick`, which scales
`dtSeconds` before its existing clamp. The first throttled tick writes the
sticky marker once per run's life. Each of the three query surfaces
independently extends its own existing legacy-row disclosure pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema migration | `wasEverThrottled` column, default `false` | Low — standard Drizzle migration |
| 2. Throttling mechanism | Viewer tracking, grace period, dt multiplier, marker write | Medium — concurrency-sensitive watcher-set teardown |
| 3. Cross-run surfaces | Leaderboard badge, comparison disclaimer, suggestion rationale | Low — mirrors 3 existing patterns exactly |
| 4. Validation | Perf-baseline comparison + cookbook entry | Low — manual, matches existing gate |

**Prerequisites:** none beyond current main — server-owned execution (F-03/F-04) and the perf-baseline harness (testing-perf-baseline) already exist.
**Estimated effort:** 4 phases, each independently verifiable.

## Open Risks & Assumptions

- The 3x multiplier value is a reasoned starting point, not empirically pre-validated — Phase 4 exists specifically to check it before calling the plan complete.
- A run cycling watched→unwatched→watched rapidly near the 5s grace boundary could, in principle, flap; the grace period is deliberately coarse (one timer, no debounce) per the user's explicit choice to keep this simple.

## Success Criteria (Summary)

- A genuinely unwatched run visibly ticks faster in simulated time; a watched run's own tick cost is unaffected.
- Every throttled run is flagged, never silently excluded, on all three cross-run surfaces.
- The perf-baseline validation shows no regression on a concurrently-watched run.
