---
change_id: simulation-run-crud-cycle-e2e
title: One E2E test for the full simulation-run CRUD cycle (start, pause, delete)
status: planned
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Add one Playwright E2E test exercising the full simulation-run CRUD
cycle in a single flow: start a run, save & pause it, then delete it
from the dashboard — extending the test suite now that deleteRun exists
(simulation-run-delete already added separate start/stop/delete and
start/pause coverage, but not one test walking the whole cycle
together).
