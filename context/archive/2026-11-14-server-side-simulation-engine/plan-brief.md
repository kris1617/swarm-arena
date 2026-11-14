# Server-Owned Simulation Execution Engine — Plan Brief

> Full plan: `context/changes/server-side-simulation-engine/plan.md`

## What & Why

Add a server-owned tick loop that can run a simulation to completion
independent of any client connection or browser tab. This is roadmap
Foundation F-03, opened to support a new execution model: "real" simulations
run server-side in the background (no rendering, no client-tab dependency),
while the existing client-side single-run path stays available for
parameter-tuning staging, unchanged.

## Starting Point

Execution today is 100% client-side, driven by `requestAnimationFrame`. The
tick logic itself (`computeSingleRunTick`) is already a pure, DOM-free
function — only *who calls it on a timer* changes here, not the simulation
logic. The server's `db` singleton is importable outside any request
context, which is what makes a background loop possible at all.

## Desired End State

Calling `startServerRun(params)` begins ticking a simulation on a server
timer with no client involved. On natural completion or `stopServerRun`, the
engine scores the run and writes the result straight to the DB — no client
round-trip required.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Tick cadence | ~16ms `setInterval`, matching the client's ~60fps RAF | Keeps `elapsedSeconds` meaning wall-clock seconds, same as today — no new "simulation speed" concept introduced | Plan |
| Live-state storage | In-memory `Map`, `globalThis`-cached like `db` | No schema change needed; matches this Foundation's minimal-enabler scope | Plan |
| Restart durability | Explicitly out of scope — in-flight state lost on server restart | Same limitation client execution has today (losing state on tab close); full durability is S-04's job | Plan |
| Error path | Log, stop, do not score a run that errored mid-tick | Mirrors the existing client tick-error rule exactly | Plan |
| Manual stop primitive | `stopServerRun(runId)` included now, even with no caller yet | Keeps S-06/S-08 from re-inventing stop logic; natural fit for "the engine" | Plan |

## Scope

**In scope:** a new `server-run-registry.ts` module (`startServerRun`,
`stopServerRun`, `getLiveRunState`), DB-backed tests proving natural
completion, manual stop, and the tick-error path, all without a browser.

**Out of scope:** any tRPC mutation or UI to start a server run (S-06); any
push/view channel (F-04); DB schema changes; restart durability; running
faster than real time; worker threads/separate processes.

## Architecture / Approach

One in-process `setInterval` per active server run, held in a module-level
registry. Each tick calls the existing `computeSingleRunTick` with
`Date.now()` in place of an RAF timestamp. On completion (natural or manual),
the registry writes directly to `simulationRuns` via the same `computeScore`
the client-driven `stop` mutation already uses — just invoked internally
instead of from a client-supplied payload.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server-owned tick loop, completion scoring, manual stop | `server-run-registry.ts` with full test coverage | Proving execution genuinely survives without a client connection — the manual wall-clock check exists specifically for this |

**Prerequisites:** none — this is the first item of the 2026-11-14 roadmap extension.
**Estimated effort:** single phase; no UI, no schema change.

## Open Risks & Assumptions

- Assumes a single Node process is an adequate execution host for this
  project's declared small scale; revisit only if real usage says otherwise.
- Assumes losing in-flight state on server restart is acceptable until S-04
  adds full save/resume — flagged explicitly rather than silently accepted.

## Success Criteria (Summary)

- A simulation run can be started and reach a scored, `stopped` DB state with
  zero client/browser involvement, proven by both fake-timer unit tests and
  one real wall-clock manual run.
- The existing client-side staging path is untouched and keeps working
  exactly as before.
