# Start a Server-Run Simulation — Plan Brief

> Full plan: `context/changes/start-server-run-simulation/plan.md`

## What & Why

Add a distinct "Start on server" action to the simulation setup page,
starting a real simulation owned by F-03's server-run engine. Roadmap
Slice S-06 — the north star of the 2026-11-14 extension: first user-facing
proof the server-owned engine works end-to-end.

## Starting Point

The page already has a full parameter form and a "Start" button driving
the client-side staging path (`api.simulation.start` + `SimulationCanvas`).
F-03 already shipped `startServerRun` — nothing ticks it yet from any UI.

## Desired End State

Clicking "Start on server" begins a server-owned run and shows a
confirmation with its id — no canvas, no tab dependency. The run reaches a
scored `stopped` state even if the tab closes immediately.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Entry point | Second button in the same form, not a separate page | Resolves the roadmap's own Unknown with its stated reasonable default | Plan |
| Insert logic | Extracted into a shared `insertRunningSimulation` helper | `start` and `startServer` need identical validation/capacity/insert; duplicating it would drift | Plan |
| Cap sharing | Server runs count against the same `MAX_PARALLEL_RUNS` pool as staging runs | No code change needed — the cap counts by `status`, not by execution location, which is the right behavior | Plan |

## Scope

**In scope:** `startServer` procedure, shared insert helper, "Start on
server" button + confirmation panel.

**Out of scope:** viewing a server run live (S-07), manually stopping one
from the UI (S-08), changing the existing staging flow, retiring the old
multi-run page (S-08).

## Architecture / Approach

`start` and `startServer` share one capacity-check-and-insert helper;
`startServer` adds exactly one extra call (`startServerRun`) after the
insert. Client-side, both buttons share one `buildStartInput()` clamping
function, diverging only in which mutation they call and what happens on
success (canvas vs. confirmation panel).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. `startServer` + UI action | Working server-start path, proven via DB state surviving tab close | Confirming the run truly doesn't depend on the tab (same proof shape as F-03's own manual check) |

**Prerequisites:** F-03 (server-side-simulation-engine), done.
**Estimated effort:** single phase; no schema change.

## Open Risks & Assumptions

- Assumes sharing the parameter form (not a separate page) is the right UX
  call for now — the roadmap flagged this as a non-blocking Unknown with a
  stated default; revisit at `/10x-ui` time if it feels wrong in practice.

## Success Criteria (Summary)

- A server-started run reaches a scored `stopped` state with no client
  involvement after the initial request.
- The existing staging flow is completely unaffected.
