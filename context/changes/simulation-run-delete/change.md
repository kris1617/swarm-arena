---
change_id: simulation-run-delete
title: Add a real delete path for simulation runs (closes Builder CRUD gap)
status: planned
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Close the Builder badge's CRUD gap by giving simulation runs a real delete
path — right now runs have create/read/update but no delete anywhere
(deliberate "mark stopped, never delete" convention in
server-run-registry.ts), so no resource in the app has the full CRUD set
the badge requires.
