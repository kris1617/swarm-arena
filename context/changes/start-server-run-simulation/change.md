---
change_id: start-server-run-simulation
title: Start a real simulation that keeps running on the server
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-06 (2026-11-14 extension to M-1). User starts a real (non-staging)
simulation whose execution is owned by the server, so it keeps running even
if the browser tab is closed. The existing client-side staging simulation
(S-01's single-run path on `/simulation`) is unchanged and remains the way
to tune parameters interactively.

Prerequisites: F-03 (server-side-simulation-engine, done — `startServerRun`
already exists in `src/server/simulation/server-run-registry.ts`).

Resolved Unknown from the roadmap (reasonable default, no user input needed
to proceed): starting a real server-run simulation uses a distinct action
("Start on server" button) alongside the existing staging start, sharing
the same parameter form — not a separate page, not replacing the staging
flow.

See `context/foundation/roadmap.md` S-06 for full Outcome/Risk.
