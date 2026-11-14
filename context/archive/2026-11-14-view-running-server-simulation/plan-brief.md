# View One Running Server Simulation — Plan Brief

> Full plan: `context/changes/view-running-server-simulation/plan.md`

## What & Why

Add a canvas viewer driven entirely by F-04's `simulation.watch` SSE
subscription — no local tick loop. Roadmap Slice S-07, fulfilling S-06's
confirmation panel's "Viewing it live is a future update" promise.

## Starting Point

`drawScene` (the existing rendering function) is already pure and reusable;
it just isn't exported yet. The `watch` subscription and its backing
registry already exist (F-04). Nothing renders from it yet.

## Desired End State

Clicking "View live" on the confirmation panel shows a canvas that updates
as the server pushes new tick state.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `onData` shape | `{ id, data }`, not the raw snapshot | Confirmed against tRPC's own `TrackedData<T>` type before planning — getting this wrong would make every field read `undefined` | Plan |
| Entry point | "View live" button on S-06's existing confirmation panel | Minimal scope; a full list/switcher is S-08's job | Plan |
| Reuse vs. duplicate rendering | Export `drawScene` from the existing canvas file | Already pure; duplicating it would drift | Plan |

## Scope

**In scope:** `ServerRunViewer` component, exporting `drawScene`/canvas
dimensions, "View live" wiring on the confirmation panel.

**Out of scope:** listing/switching between running simulations (S-08),
stopping a run from the viewer (S-08), any change to the staging canvas or
rendering logic itself.

## Architecture / Approach

One new component owns a canvas ref and a `watch` subscription; `onData`
calls the exported `drawScene` directly with each pushed frame. No local
state mirrors the simulation — the canvas is a pure projection of whatever
the server last pushed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Viewer component + wiring | Working live view, proven against a real running server simulation | Getting `onData`'s actual payload shape right (resolved during planning, before code) |

**Prerequisites:** S-06, F-04 — both done.
**Estimated effort:** single phase; no schema or backend change.

## Open Risks & Assumptions

- Assumes `httpSubscriptionLink`'s built-in reconnection is adequate for
  this slice's scope; deeper resilience work is a follow-up if it proves
  insufficient in practice.

## Success Criteria (Summary)

- The canvas renders live, server-pushed state for a run the viewer does
  not execute.
- Closing the viewer never affects the underlying run.
