# Simulation run delete — Implementation Plan

## Overview

Give a user a real delete path for their own completed (`stopped`) or paused (`saved`) simulation runs — soft-delete for regular users, hard-delete for an admin (role-gated behavior on the same button, over the caller's own row only) — closing the Builder badge's last outstanding CRUD gap: simulation runs already have create/read/update but no delete.

## Current State Analysis

- `simulationRuns.status` is `running | stopped | saved` (`src/server/db/schema.ts:115-118`); no deleted state exists.
- Every run query is already scoped to `eq(simulationRuns.userId, userId)` — no cross-user leaderboard or run listing, so deleting a run never touches another user's data.
- `start`'s rate-limit recheck (`simulation.ts:549-559`) counts **all** rows in the hourly window regardless of `status` — a hard delete of a recent run would let a user dodge that counter. This is the reason regular users get soft-delete: the row stays in the table (and in the rate-limit count) but disappears from every user-facing list.
- `isEffectivelyAdmin(ctx.session.user)` (`src/server/auth/elevation.ts:9`) is the existing helper used by `adminProcedure` — reused inline here (not via `adminProcedure` itself, since this mutation must also work for non-admins) to branch hard vs. soft delete.
- Three reads need a `deletedAt IS NULL` filter added: `listCompleted` (`simulation.ts:999-1026`), `listSaved` (`simulation.ts:973-993`), `listLeaderboard` (`simulation.ts:1033-...`). `getRunAnalysis`/`getRunsComparison` (used by `/runs/[runId]` and `/runs/compare`) also need it, so a deleted run's direct-link page 404s instead of still rendering.
- The rate-limit recheck and `MAX_PARALLEL_RUNS` check must **not** gain this filter — `MAX_PARALLEL_RUNS` only ever counts `status: "running"` rows, which this feature never touches (delete is restricted to `stopped`/`saved`), and the rate-limit recheck must keep counting soft-deleted rows by design.
- Dashboard UI: `RunRow` (`src/components/run-row.tsx`) already has a `trailing` slot (used today for the score badge in the Completed section); the Completed and Saved sections in `src/app/dashboard/page.tsx:109-186` are the two places a delete button needs to appear.
- `AlertDialog` already exists at `src/components/ui/alert-dialog.tsx` (shadcn) — no new dependency.

## Phase 1: Schema + query filters

### Changes Required:

**`src/server/db/schema.ts`**
- **Intent**: Add the soft-delete marker.
- **Contract**: new nullable column `deletedAt: d.integer({ mode: "timestamp" })` on `simulationRuns`, alongside `stoppedAt`. No default, no backfill needed (existing rows stay `null` = not deleted).

**`src/server/api/routers/simulation.ts`** — `listCompleted`, `listSaved`, `listLeaderboard`, `getRunAnalysis`, `getRunsComparison`
- **Intent**: A soft-deleted run disappears from every user-facing read, without touching the rate-limit recheck or `MAX_PARALLEL_RUNS`.
- **Contract**: add `isNull(simulationRuns.deletedAt)` to each of these queries' `and(...)` filter list (import `isNull` alongside the existing `isNotNull`). Do not add it to the rate-limit recheck (`simulation.ts:549-559`) or `MAX_PARALLEL_RUNS` checks — leave both exactly as they are.

**Drizzle migration**
- **Intent**: Apply the new column against the existing (possibly populated) table the same way every other nullable addition in this schema has been applied.
- **Contract**: run `npm run db:generate` then `npm run db:push` (or `db:migrate`, matching whichever this repo's existing nullable-column additions used) and commit the generated migration file.

### Success Criteria:

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes
- Existing `simulation.test.ts` suite still passes unmodified (no existing query's result set changes for rows with `deletedAt: null`)

#### Manual Verification:
- `npm run db:push` applies cleanly against the local `db.sqlite` with existing rows present

## Phase 2: `deleteRun` mutation

### Changes Required:

**`src/server/api/routers/simulation.ts`** — new `deleteRun` procedure
- **Intent**: Let the owning user delete their own completed or saved run; branch hard vs. soft delete by the caller's effective admin status.
- **Contract**: `protectedProcedure`, input `{ runId: z.number() }`. Load the row, verify `run.userId === ctx.session.user.id` (else `FORBIDDEN`) and `run.status` is `"stopped"` or `"saved"` (else `BAD_REQUEST` — a running run can't be deleted). If `isEffectivelyAdmin(ctx.session.user)`, `db.delete(simulationRuns).where(eq(simulationRuns.id, runId))`; otherwise `db.update(simulationRuns).set({ deletedAt: new Date() }).where(eq(simulationRuns.id, runId))`. Return `{ success: true }`.

### Success Criteria:

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes

#### Manual Verification:
- None beyond Phase 4's tests — this phase has no UI yet to click through

## Phase 3: Dashboard UI

### Changes Required:

**`src/app/dashboard/page.tsx`** — Completed and Saved sections
- **Intent**: A delete action per row, confirmed before it fires, that removes the row from view once the mutation succeeds.
- **Contract**: add a delete icon button to each `RunRow`'s `trailing` slot (Completed section: alongside the existing score badge; Saved section: its first `trailing` content) wrapped in an `AlertDialog` ("Delete run #N? This can't be undone."). On confirm, call `api.simulation.deleteRun.useMutation()` and invalidate the relevant list query (`listCompleted` or `listSaved`) on success so the row disappears without a manual refetch.

### Success Criteria:

#### Automated Verification:
- `npm run typecheck` passes
- `npm run check` passes
- `npm run build` succeeds

#### Manual Verification:
- In the running app: delete a completed run from the dashboard, confirm the dialog fires, confirm the row disappears after confirming, confirm it no longer appears on `/leaderboard` or via a direct `/runs/<id>` link (404 or graceful "not found")
- Delete a saved run, confirm it disappears from the Saved section

## Phase 4: Tests

### Changes Required:

**`src/server/api/routers/simulation.test.ts`** — new `deleteRun` test cases
- **Intent**: Cover ownership, status restriction, the hard/soft role branch, and the rate-limit regression this feature could introduce.
- **Contract**: cases for (a) deleting another user's run throws `FORBIDDEN`, (b) deleting a `running` run throws `BAD_REQUEST`, (c) a non-admin's delete sets `deletedAt` and the row still exists in the DB, (d) an admin's delete actually removes the row, (e) a soft-deleted run is absent from `listCompleted`/`listSaved`/`listLeaderboard` but **still counts** in the rate-limit recheck (start a run, soft-delete it, confirm the next `start` call's rate-limit count still includes it).

**`tests/e2e/authenticated-simulation-run.spec.ts`** or a new sibling spec
- **Intent**: One browser-level check that a real user can delete a completed run from the dashboard end-to-end.
- **Contract**: follow this file's existing auth/seed pattern; complete a run, delete it from the dashboard, assert it's gone from the Completed list.

### Success Criteria:

#### Automated Verification:
- `npx vitest run src/server/api/routers/simulation.test.ts` passes, including the 5 new cases
- `npm test` (full suite) passes
- The new/extended E2E spec passes: `npx playwright test <spec>`

#### Manual Verification:
- None — this phase is itself the verification layer

## What We're NOT Doing

- Not letting an admin hard-delete another user's run — confirmed scope is role-gated behavior on the caller's own row only, not a moderation feature.
- Not adding a dedicated admin runs-browser page — no new route, no cross-user query.
- Not allowing deletion of `running` runs — that's cancellation, a different feature with a different domain meaning (stopping an active simulation, not removing history).
- Not un-deleting / restoring a soft-deleted run — no "trash" or recovery UI. If this is needed later, it's a new change.
- Not touching `MAX_PARALLEL_RUNS` or the rate-limit recheck's own filter logic — only reusing them as-is.

## Progress

### Phase 1: Schema + query filters

#### Automated

- [x] 1.1 `npm run typecheck` passes
- [x] 1.2 `npm run check` passes
- [x] 1.3 Existing `simulation.test.ts` suite still passes unmodified

#### Manual

- [x] 1.4 `npm run db:push` applies cleanly against local `db.sqlite` with existing rows present

### Phase 2: `deleteRun` mutation

#### Automated

- [x] 2.1 `npm run typecheck` passes
- [x] 2.2 `npm run check` passes

### Phase 3: Dashboard UI

#### Automated

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 `npm run check` passes
- [ ] 3.3 `npm run build` succeeds

#### Manual

- [ ] 3.4 Delete a completed run from the dashboard end-to-end (dialog, disappearance, leaderboard/direct-link gone)
- [ ] 3.5 Delete a saved run, confirm it disappears from the Saved section

### Phase 4: Tests

#### Automated

- [ ] 4.1 `simulation.test.ts` passes including the 5 new `deleteRun` cases
- [ ] 4.2 Full `npm test` suite passes
- [ ] 4.3 New/extended E2E spec passes
