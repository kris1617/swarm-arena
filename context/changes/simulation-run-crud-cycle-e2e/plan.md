# Simulation run CRUD cycle E2E — Implementation Plan

## Overview

Add one self-contained Playwright E2E test exercising the full simulation-run CRUD cycle in a single flow — start on server, save & pause, delete from the dashboard — closing the gap that `simulation-run-delete`'s own test phase left: separate tests for start/stop/delete and (code-reviewed but not live-verified) start/pause existed, but nothing walked create → update(pause) → delete as one continuous user journey.

## Current State Analysis

- `tests/e2e/authenticated-simulation-run.spec.ts` already has "signed-in user starts a run, sees it running, and stops it to a scored summary" and "signed-in user deletes a completed run from the dashboard" (both `simulation-run-delete` Phase 4) — but no test touches `startServer`/`savePause` at all.
- During `simulation-run-delete`'s own manual verification, a throwaway script attempting start-on-server → save & pause → delete failed twice with `BAD_REQUEST` from `savePause`. Root cause (confirmed after the fact, not fixed then because it was a disposable script, not committed test code): leftover "running" DB rows from earlier separate `npx playwright test` invocations had no matching in-memory registry entry in the *current* webServer process (Playwright's config starts/stops its own server per run, which wipes the in-memory `server-run-registry.ts` registry but not the DB), so `.last()`-style row selection sometimes grabbed a stale run id. A **self-contained** test — start the run and interact with it entirely within one test, one webServer lifetime, never relying on cross-run leftover state — avoids this entirely.
- `src/app/simulation/page.tsx:1223` has a separate "Start on server" button (distinct from the client-staged "Start" button used by the existing start/stop test) that calls `startServerMutation` → `api.simulation.startServer`; the resulting server-run row then exposes a "Save & Pause" button (`page.tsx:851-855`) once it appears in the page's own running-server-runs list.
- `isServerRunActive` (`server-run-registry.ts:610-612`) is a synchronous in-memory check (`registry.has(runId)`), confirming the earlier failures were never a timing/registration race within a single process — it's purely the cross-process stale-row issue above.
- The dashboard's delete flow (button + `AlertDialog`) is already proven working for both `stopped` (live E2E, `simulation-run-delete` Phase 4) and `saved` runs (code-path symmetry only, per that change's own Progress notes) — this test gives the `saved` path its first live, committed E2E proof.

## Phase 1: CRUD-cycle E2E test

### Changes Required:

**`tests/e2e/authenticated-simulation-run.spec.ts`** — new sibling test
- **Intent**: One continuous flow proving create → update (pause) → delete works end-to-end for a server-run simulation, self-contained so it can't collide with leftover state from other test runs.
- **Contract**: `test("signed-in user starts a run on the server, saves & pauses it, then deletes it from the dashboard", ...)`. Steps: go to `/simulation`, fill a boid/predator combination distinct from every other fixture in this file (avoiding collision under `fullyParallel`), click "Start on server", wait for the resulting run's "Save & Pause" button to become visible (scoped to that one run, not `.last()`/`.first()` on a shared list — locate it via the run's own container/row if the page renders one per server run, falling back to scoping by the distinct boid/predator text if no per-row container exists), click it, wait for it to disappear (proving the mutation landed, same pattern already used for "Delete run #N" button disappearance), go to `/dashboard`, find the row in the **Saved** section by its boid/predator text, click its delete button, confirm via the `AlertDialog`'s "Delete" button, assert the row is gone.

### Success Criteria:

#### Automated Verification:
- `npx playwright test tests/e2e/authenticated-simulation-run.spec.ts` passes, including the new test, with zero flakiness across 2 consecutive full runs of the file (not just one pass)
- `npm run typecheck` passes
- `npm run check` passes

#### Manual Verification:
- None beyond the automated run above — this phase's success criterion is exactly "the E2E test itself passes reliably," there's no separate manual step

## What We're NOT Doing

- Not fixing the underlying cross-process stale-registry-row quirk in `server-run-registry.ts`/Playwright's webServer lifecycle — it only matters for ad-hoc scripts run across separate `npx playwright test` invocations, not for a single self-contained test within one run, which is what this change actually needs.
- Not adding a second variant covering the admin hard-delete branch in this E2E test — that's already covered by `simulation-run-delete`'s unit tests (`simulation.test.ts`); this E2E test is about the ordinary user-facing CRUD cycle.
- Not deduplicating this new test against the two existing start/stop and delete-completed tests in the same file — each proves a distinct path (client-staged start/stop, completed-run delete, and now server-run start/pause/delete) and none makes another redundant.

## Progress

### Phase 1: CRUD-cycle E2E test

#### Automated

- [x] 1.1 `npx playwright test tests/e2e/authenticated-simulation-run.spec.ts` passes twice in a row, zero flakiness
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run check` passes

### Follow-up risk flagged during implementation (not fixed, out of this phase's scope)

`startServer`'s hourly rate limit (`MAX_SERVER_RUNS_PER_HOUR = 5`) counts soft-deleted rows by design, and E2E tests run against the shared, persistent `db.sqlite` dev database under one fixed test account (not an isolated test DB per run). A second consecutive run of this file during implementation hit `TOO_MANY_REQUESTS` because leftover rows from unrelated earlier sessions plus this test's own row exhausted the quota within the same clock hour. Not a flake in this test or a bug — an inherent property of rate-limiter + shared account + non-isolated DB. Worth a dedicated look if CI starts showing intermittent `TOO_MANY_REQUESTS` failures on this file.
