---
change_id: corpus-generation-harness
title: Single-run generate-and-export harness for simulation test fixtures
status: implementing
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

A single simulation run can be driven end-to-end through the real app's execution path with explicit parameters, allowed to tick to completion under a simulated-duration cap, have its persisted history/score captured and exported to a fixture-file record, with its DB/registry footprint cleaned up afterward
