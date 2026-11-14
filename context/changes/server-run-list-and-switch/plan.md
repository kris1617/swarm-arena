# List and Switch Between Running Server Simulations Implementation Plan

## Overview

Add a `listRunning` query and a running-runs list to the simulation page,
letting the user switch which server-run simulation `ServerRunViewer`
watches — then retire the old client-driven multi-run subsystem (`/simulation/multi`,
`multi-run-lifecycle.ts`, most of `run-slots.ts`) it replaces. This is
roadmap Slice S-08, closing out the 2026-11-14 server-execution extension.

## Current State Analysis

- `src/app/simulation/page.tsx` (S-06/S-07, done) — `serverRunConfirmation`
  shows exactly one run's id after starting it; `viewingRunId` + `ServerRunViewer`
  (S-07) render a live view of exactly one run, reached only via that one
  confirmation's "View live" button. Nothing lists *all* currently-running
  server runs, and nothing lets the user switch to a different one once
  viewing.
- `src/app/simulation/multi/page.tsx` + `_components/multi-simulation-stage.tsx`
  — the old S-05 client-driven feature: one shared RAF loop ticking up to
  `MAX_PARALLEL_RUNS` runs in the browser tab, with its own start form and
  switcher UI. Confirmed via `grep -rln "simulation/multi"` that nothing
  outside this subsystem references it — no nav link points at `/simulation/multi`
  either, so it's reachable only by typing the URL directly.
- `src/server/simulation/run-slots.ts` exports `MAX_PARALLEL_RUNS` (reused
  by `simulation.ts`'s cap check — must stay) alongside `RunSlot`/`RunSlotsState`/
  `addSlot`/`setActive`/`markStopped`/`removeSlot`, whose only consumers are
  `multi-simulation-stage.tsx` and `multi-run-lifecycle.ts` — both retired
  by this plan.
- `src/server/api/routers/simulation.ts` has `start`/`startServer`/`stop`/`watch`;
  no query lists a user's running rows today.

### Key Discoveries:

- Retiring the old subsystem is a clean, fully-contained deletion: no file
  outside `src/app/simulation/multi/`, `multi-run-lifecycle.(ts|test.ts)`,
  and the removed half of `run-slots.(ts|test.ts)` imports from any of them.
- `MAX_PARALLEL_RUNS` is the one symbol in `run-slots.ts` that must survive
  — it's `simulation.ts`'s cap check, unrelated to the client multi-run UI
  it happened to also be used by.
- `run-slots.test.ts`'s 13 tests all exercise `addSlot`/`setActive`/`markStopped`/
  `removeSlot`; `MAX_PARALLEL_RUNS` itself is only ever used as a loop bound
  inside those tests, never independently asserted — so the whole test file
  is removed along with the functions, not partially trimmed.

## Desired End State

The simulation page shows a list of the user's currently-running server
simulations (if any), each switchable to view via `ServerRunViewer`, with
switching never affecting any run's execution. `/simulation/multi` and its
backing code no longer exist. Verify: with two server runs started, switch
`ServerRunViewer` between them and confirm (via DB reads, same approach as
S-06/S-07's manual checks) that both keep advancing regardless of which is
being viewed.

## What We're NOT Doing

- Not adding a way to stop a run from the list (still out of scope — no
  slice has planned a server-run stop *button* yet; `stopServerRun` the
  primitive exists but nothing in this UI calls it).
- Not changing `ServerRunViewer`, the `watch` subscription, or `startServer`
  at all — this plan only adds a list query and wires switching between
  existing pieces.
- Not migrating any `/simulation/multi` user data or state — it never
  persisted anything beyond ordinary `simulationRuns` rows, which this
  slice's list query already reads the same way.
- Not pushing the run list via SSE — a plain polled `useQuery` is adequate
  for "which rows currently have status running", cheaper than a second
  subscription type for a list that changes rarely.

## Implementation Approach

Add `simulation.listRunning`, a `protectedProcedure.query` returning the
caller's own `status: "running"` rows (`id`, `startedAt`, `boidCount`,
`predatorCount`), newest first. On the client, replace `page.tsx`'s single-run
`serverRunConfirmation` state with a polled list (`useQuery` with a short
`refetchInterval`) rendered as a set of "View run #N" buttons; clicking one
sets `viewingRunId` (already wired to `ServerRunViewer` by S-07). Starting a
new server run still immediately sets `viewingRunId` to the fresh run (no
need to wait for the next poll to view what you just started). Then delete
the retired subsystem files and trim `run-slots.ts` to just `MAX_PARALLEL_RUNS`.

## Phase 1: `listRunning` query + list/switch UI

### Overview

Add the query, wire the list and switching into `page.tsx`, and prove
multiple server runs keep ticking independently of which one is viewed.

### Changes Required:

#### 1. `listRunning` query

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Let the client discover all of the caller's currently-running
server simulations, for the switcher list.

**Contract**: `listRunning: protectedProcedure.query(async ({ ctx }) => { const userId = ctx.session.user.id; if (!userId) throw UNAUTHORIZED; return ctx.db.select({ id: simulationRuns.id, startedAt: simulationRuns.startedAt, boidCount: simulationRuns.boidCount, predatorCount: simulationRuns.predatorCount }).from(simulationRuns).where(and(eq(simulationRuns.userId, userId), eq(simulationRuns.status, "running"))).orderBy(desc(simulationRuns.startedAt)); })`
— mirrors `start`'s existing `userId` guard; reuses the already-imported `and`/`eq` plus a new `desc` import from `drizzle-orm`.

#### 2. List/switch UI, replacing the single-run confirmation

**File**: `src/app/simulation/page.tsx`

**Intent**: Show every currently-running server simulation the user has,
let them pick which one `ServerRunViewer` watches, and keep that list
reasonably fresh without a second subscription type.

**Contract**:
- Remove the `serverRunConfirmation` state and its panel entirely.
- Add `const runningRunsQuery = api.simulation.listRunning.useQuery(undefined, { refetchInterval: 2000 })`.
- In `startServerMutation`'s `onSuccess`, call `setViewingRunId(data.runId)`
  directly (so the user sees their own just-started run immediately,
  without waiting for the next poll).
- Render a panel (shown whenever `runningRunsQuery.data` is non-empty)
  listing each run as a button labeled `Run #{id}` — visually distinguish
  (e.g. a different background token, not a new literal color) the one
  matching `viewingRunId`; clicking any other sets `viewingRunId` to it.
  This panel renders independently of `activeRun`/the staging form, same
  as the confirmation panel it replaces.
- `<ServerRunViewer>` rendering logic is unchanged (still gated on
  `viewingRunId`).

#### 3. Retire the old client-driven multi-run subsystem

**Files**:
- `src/app/simulation/multi/page.tsx` — delete
- `src/app/simulation/multi/_components/multi-simulation-stage.tsx` — delete
- `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx` — delete
- `src/server/simulation/multi-run-lifecycle.ts` — delete
- `src/server/simulation/multi-run-lifecycle.test.ts` — delete
- `src/server/simulation/run-slots.test.ts` — delete
- `src/server/simulation/run-slots.ts` — **edit**, not delete: keep only
  the `MAX_PARALLEL_RUNS` export and its doc comment; remove `RunSlot`,
  `RunSlotsState`, `addSlot`, `setActive`, `markStopped`, `removeSlot`, and
  the `FlockWeights` import they alone needed.

**Intent**: Remove the feature S-08 replaces, without touching the one
symbol (`MAX_PARALLEL_RUNS`) that `simulation.ts`'s cap check still needs.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`
- Retired files are actually gone: `! test -d src/app/simulation/multi && ! test -f src/server/simulation/multi-run-lifecycle.ts && ! test -f src/server/simulation/run-slots.test.ts`

#### Manual Verification:

- Start two server runs; confirm both appear in the list, and switching
  `ServerRunViewer` between them renders each correctly with no console
  errors.
- Confirm via DB reads (same approach as S-06/S-07's manual checks) that
  both runs keep advancing (status still `"running"`, i.e. neither was
  accidentally stopped) regardless of which one is currently being viewed.
- Confirm `/simulation/multi` now 404s (route removed).

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Testing Strategy

### Unit Tests:

- Extend `src/server/api/routers/simulation.test.ts` with a
  `describe("simulationRouter.listRunning")` block:
  - Returns only the caller's own `"running"` rows, not another user's
    (fixture: two owners, one row each, assert the returned list contains
    only the caller's row).
  - Does not return `"stopped"` rows for the same caller.
  - Rejects with `UNAUTHORIZED` when there is no session.

### Integration Tests:

- N/A beyond the `createCaller`-based tests above.

### Manual Testing Steps:

1. See Phase 1's Manual Verification.

## Performance Considerations

A 2s-interval polled query for a small per-user row count is negligible;
no new concern beyond what `start`/`startServer` already established.

## Migration Notes

None — no schema change. This phase removes code, not data; existing
`simulationRuns` rows (including ones a retired `/simulation/multi` run may
have created) are untouched and still readable by `listRunning`/`stop`/etc.

## References

- Roadmap: `context/foundation/roadmap.md` S-08 (server-run-list-and-switch)
- Viewer to reuse unchanged (S-07): `src/app/simulation/_components/server-run-viewer.tsx`
- Confirmation panel being replaced (S-06): `src/app/simulation/page.tsx`
- Retirement inventory confirmed via grep: see `change.md`'s Notes

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `listRunning` query + list/switch UI + retirement

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — eacd25a
- [x] 1.2 Linting passes: `npm run check` — eacd25a
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts` — eacd25a
- [x] 1.4 Full suite still passes: `npm test` — eacd25a
- [x] 1.5 Retired files are actually gone — eacd25a

#### Manual

- [x] 1.6 Two server runs both appear in the list; switching the viewer between them works with no console errors — eacd25a
- [x] 1.7 Both runs keep advancing regardless of which is being viewed — eacd25a
- [x] 1.8 `/simulation/multi` now 404s — eacd25a
