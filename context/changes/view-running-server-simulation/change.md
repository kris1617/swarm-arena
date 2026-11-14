---
change_id: view-running-server-simulation
title: View one running server simulation live
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-07 (2026-11-14 extension to M-1). User picks one of their
currently-running server simulations and watches it render live in the
browser, receiving pushed state updates rather than owning execution.

Prerequisites: S-06 (done — "Start on server" exists and shows a
confirmation with a runId), F-04 (done — `simulation.watch` SSE
subscription + `watchServerRun` exist).

Grounded in two API details confirmed against actual type declarations
before planning (not assumed):
- `simulation.watch`'s client-side `onData` receives `{ id: string; data: LiveRunSnapshot }`
  (tRPC's `tracked()` envelope unwraps to `TrackedData<T>` client-side, NOT
  the raw snapshot) — confirmed via `node_modules/@trpc/server/dist/unstable-core-do-not-import-B8epiErP.d.cts`.
- `drawScene` (the existing rendering function in `simulation-canvas.tsx`)
  is pure given a canvas context + boids/predators arrays — reusable as-is
  once exported, no duplication needed.

Minimal scope for this slice: the viewer is reached by clicking "View live"
on the confirmation panel for the run just started via S-06 — not a list of
all running simulations (that's S-08).

See `context/foundation/roadmap.md` S-07 for full Outcome/Risk.
