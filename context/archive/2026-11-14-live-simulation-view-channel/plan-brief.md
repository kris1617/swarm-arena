# Live Simulation-View Channel — Plan Brief

> Full plan: `context/changes/live-simulation-view-channel/plan.md`

## What & Why

Add a tRPC subscription that pushes a running server-owned simulation's
current tick state to exactly one connected viewer via Server-Sent Events.
Roadmap Foundation F-04 — unlocks S-07, the actual viewer UI.

## Starting Point

F-03 just shipped `getLiveRunState(runId)` / `isServerRunActive(runId)` —
exactly the read surface this channel needs. No subscription procedure or
SSE transport exists yet; the client uses one `httpBatchStreamLink` for
everything.

## Desired End State

An authenticated owner of an active server run can open a `watch`
subscription and receive repeated snapshots of that run's current tick
state until it stops or they disconnect — read-only, no effect on execution.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Transport | tRPC v11 native SSE subscription (async-generator resolver) | Already in package.json; the Node-runtime route handler already supports streaming — no new WebSocket server needed | Plan |
| Push cadence | 150ms polling against the in-memory snapshot | A human watching a canvas doesn't need 60fps pushes; far cheaper per-viewer | Plan |
| Scope | Active server runs only | Watching a finished run is a plain DB read, unrelated to this push channel | Plan |

## Scope

**In scope:** `simulation.watch` subscription procedure, client `splitLink`
wiring for SSE, tests proving the stream yields advancing snapshots and ends
cleanly on stop.

**Out of scope:** the viewer UI (S-07), any new transport beyond tRPC's SSE
support, pushing on every tick, shared-subscription optimization for
multiple viewers of one run.

## Architecture / Approach

`watch` is an async-generator procedure: ownership + active-run checks up
front, then a loop yielding `tracked()`-wrapped snapshots from
`getLiveRunState` every 150ms until the run stops or the client disconnects.
Client-side, `splitLink` routes subscription-type operations through
`httpSubscriptionLink` and everything else through the existing
`httpBatchStreamLink`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. `watch` procedure + client wiring + tests | Working SSE push channel, testable via `createCaller` without a browser | Confirming the stream actually ends (not lingers) once a run stops |

**Prerequisites:** F-03 (server-side-simulation-engine), done.
**Estimated effort:** single phase; no new transport, no schema change.

## Open Risks & Assumptions

- Assumes `createCaller`'s direct-invocation path for a subscription
  procedure behaves as a plain async generator (no HTTP/SSE machinery in the
  way) — confirmed via tRPC's architecture, verified in Phase 1's tests.
- Assumes 150ms is an adequate push cadence for S-07's eventual viewer; that
  slice can tune it without touching this Foundation's contract.

## Success Criteria (Summary)

- A `watch` subscription yields advancing tick-state snapshots for an active
  server run and ends cleanly when the run stops, proven without a browser.
- The ownership/active-run guards reject appropriately, matching `stop`'s
  existing pattern.
