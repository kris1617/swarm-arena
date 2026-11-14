---
change_id: server-side-simulation-engine
title: Server-owned simulation execution engine
status: implementing
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap F-03 (2026-11-14 extension to M-1). A simulation run must be tickable to
completion by a server-owned process, independent of any client connection or
browser tab — the server, not the browser, owns a "real" run's lifecycle. Unlocks
S-06 (start-server-run-simulation) and F-04 (live-simulation-view-channel).

Existing pure tick cores (`computeSingleRunTick`, `computeMultiRunTick` under
`src/server/simulation/`) are already DOM-free — this change is about *where*
they're called from (a server-owned loop instead of a browser RAF loop), not a
rewrite of simulation logic. Deploy target (self-hosted VPS, persistent Docker
container) was chosen anticipating exactly this: tech-stack.md names "an
always-on simulation loop" as a reason serverless was ruled out.

See `context/foundation/roadmap.md` F-03 for full Outcome/Risk/Unknowns.
