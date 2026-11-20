# Plan Brief: Simulation run delete

Full plan: `context/changes/simulation-run-delete/plan.md`

## What & Why

Closes the one gap found in the 10xBuilder badge audit: no resource in the app has a full CRUD set. Simulation runs already have create/read/update; this adds delete for a user's own completed or saved runs.

## Starting Point

`simulationRuns` has no deleted state. Every run read is already scoped per-user, so this never touches another user's data. The one real wrinkle: `start`'s hourly rate-limit recheck counts all rows in the window regardless of status, so a naive hard delete would let a user dodge it by deleting a recent run.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Delete model | Soft-delete for regular users, hard-delete for admins — same button, role-gated | User's own answer. Soft delete closes the rate-limit-dodge risk (row still counts, just hidden from lists); admin gets a real cleanup path via the existing self-elevation flow. |
| Scope | `stopped` and `saved` runs only, never `running` | Deleting an active run is a different feature (cancellation), not history cleanup. |
| Admin reach | Caller's own row only — no cross-user moderation | User's explicit answer: no new admin page, no cross-user query. |
| Confirm UX | shadcn `AlertDialog` | Already in `src/components/ui/`, matches the app's destructive-action conventions. |

## Phases

1. **Schema + query filters** — nullable `deletedAt` column; filtered out of `listCompleted`/`listSaved`/`listLeaderboard`/run-analysis reads; deliberately left out of the rate-limit recheck
2. **`deleteRun` mutation** — ownership + status check, branches via the existing `isEffectivelyAdmin` helper
3. **Dashboard UI** — delete button + `AlertDialog` on `RunRow`'s `trailing` slot, both Completed and Saved sections
4. **Tests** — ownership, status restriction, role branch, and the rate-limit-still-counts-deleted-rows regression (unit + one E2E spec)

**Prerequisites**: none. **Estimated effort**: 4 small phases, no new dependencies.

## What We're NOT Doing

- Admin deleting other users' runs (no moderation feature, no new admin page)
- Deleting `running` runs (that's cancellation, a different feature)
- Restoring a soft-deleted run (no trash/recovery UI)

## References

- Builder badge audit (this session) — the CRUD-gap finding this change closes
- `src/server/auth/elevation.ts:9` — `isEffectivelyAdmin`, reused for the hard/soft branch
