# Implementation Plan: Post-login dashboard listing the user's own simulation runs

## Overview

Right now, logging in sends the user to `/` — the unmodified Create-T3-App
scaffold homepage (`src/app/page.tsx`, still showing "Create T3 App" /
First Steps / Documentation links) — because `login/page.tsx`'s own comment
says so: `signIn("github", { redirectTo: "/" })`. There is no dashboard, no
run list on login, nothing pointing a logged-in user at `/simulation`. This
plan adds a `/dashboard` route listing the user's own runs (running, saved,
completed) and makes it the post-login landing page.

**Scope note on "no interview":** the one genuinely open product question
(exact landing route) already has a recorded reasonable default in
`roadmap.md`'s S-10 Unknown entry (new `/dashboard` route becomes the
post-login redirect target; `/simulation` stays reachable from it). The
remaining decisions below are implementer-level and are resolved directly
from existing codebase patterns and the standard-dashboard research already
gathered for this roadmap item, not asked.

## Current State Analysis

- `src/app/login/page.tsx:15` — `signIn("github", { redirectTo: "/" })`,
  with its own comment explaining *why* an explicit `redirectTo` is needed
  (without one, next-auth sends you back to `/login` itself, which
  middleware excludes from the auth gate, so you'd never reach the app).
  `"/"` was evidently a placeholder that was never revisited.
- `src/app/page.tsx` is still the untouched T3 scaffold page — confirmed by
  reading it in full; this plan does not touch it (see "What We're NOT
  Doing").
- `src/middleware.ts`'s matcher excludes only `login|api/auth|api/test-auth|
  _next/static|_next/image|favicon.ico` — a new `/dashboard` route is
  automatically gated by the existing `auth` middleware with no changes
  needed there.
- `listRunning`/`listSaved` (`src/server/api/routers/simulation.ts:406-450`)
  already return the caller's own rows (`id`, `startedAt`, `boidCount`,
  `predatorCount`) filtered by `status: "running"` / `"saved"`, ordered by
  `startedAt desc`. No query exists yet for completed (`"stopped"`) runs.
- `src/app/simulation/page.tsx` already renders a client-side run list
  (the "Running on server" section, S-08) via
  `api.simulation.listRunning.useQuery(undefined, { refetchInterval: 2000 })`
  and plain Tailwind `div`/`Button` markup — no table/badge component
  exists. `src/components/ui/` has only `button.tsx`, `input.tsx`,
  `switch.tsx` (per `AGENTS.md`'s own instruction: check this directory
  before adding a new shadcn component).
- Research grounding (standard task/run dashboard conventions — Databricks,
  dbt, Control-M, Sauce Labs): color-coded status, a runs list with
  filters, a detail view with timing/trigger info, summary tiles. This
  plan's v1 adopts the list + status + filter pieces; summary tiles and a
  true detail view are out of scope (detail view is roadmap S-11's job for
  completed runs; running/saved runs already have a live view on
  `/simulation`).

## What We're NOT Doing

- Not touching `src/app/page.tsx` (the T3 scaffold root) — it's pre-existing,
  tolerated scaffold content per this project's own convention (the `post`
  router/`LatestPost` component are kept as the T3 example throughout this
  codebase); removing it is unrelated scope creep for a "add a dashboard"
  task.
- Not building a run-detail/analysis view — that's roadmap S-11,
  downstream of this slice. Completed-run rows in this dashboard are
  informational (status, score, timestamps) only; "click to see the
  per-cycle breakdown" lands with S-11.
- Not rebuilding the running/saved live-viewing UX — `/simulation` already
  has it (S-08's list+switch UI, `ServerRunViewer`). Running/saved rows on
  the dashboard link to `/simulation`, which already lets the user pick and
  view any of their running/saved runs.
- Not adding a shadcn `table`/`badge` component — the existing codebase's
  only run-list precedent (`/simulation`'s own "Running on server" section)
  uses plain Tailwind `div`s; introducing a new UI primitive for one more
  list would be pattern proliferation, not reuse.
- Not adding date-range filtering, pagination, or CSV export — the
  research's own standard-dashboard survey lists these as present in
  mature tools at much larger scale; a status filter (All / Running /
  Saved / Completed) and a `.limit(50)` cap on completed runs matches this
  project's declared small scale (same posture as `full-score-save-resume`'s
  Performance Considerations precedent).

## Implementation Approach

Add a `listCompleted` tRPC query mirroring `listRunning`/`listSaved`
exactly (same shape, filtered `status: "stopped"`, capped at 50 rows). Add
`src/app/dashboard/page.tsx` as a client component (matching
`/simulation/page.tsx`'s own client-side-query pattern, not a server
component) that fetches all three lists and renders them as one page with
a status filter. Fix `login/page.tsx`'s `redirectTo` to point at
`/dashboard`.

### Changes Required:

#### 1. Add `listCompleted` query

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The dashboard's "Completed" section needs the user's own
stopped runs with their score — no such query exists yet.

**Contract**: `listCompleted: protectedProcedure.query(...)`, mirroring
`listRunning`/`listSaved`'s exact shape and ownership check, but selecting
`score` and `stoppedAt` in addition to `id`/`startedAt`/`boidCount`/
`predatorCount`, filtering `eq(simulationRuns.status, "stopped")`, ordered
`desc(simulationRuns.startedAt)`, capped `.limit(50)`.

#### 2. Add the `/dashboard` page

**File**: `src/app/dashboard/page.tsx` (new)

**Intent**: The post-login landing page — lists the user's own runs across
all three statuses with a simple filter, following the standard
run-dashboard conventions researched for this roadmap item (status,
timestamps, filter) without inventing new ones.

**Contract**: `"use client"` component. Three queries
(`api.simulation.listRunning.useQuery`, `listSaved.useQuery`,
`listCompleted.useQuery`, each `refetchInterval: 2000` matching
`/simulation/page.tsx`'s existing polling cadence) feed a single combined
list, each row tagged with its status. A client-side status filter (All /
Running / Saved / Completed, default All) controls which rows render — no
server-side filtering needed since all three lists are already fetched.
Each row shows `id`, `startedAt` (formatted), `boidCount`/`predatorCount`,
and for completed rows, `score` — rendered as `"—"` when `score` is `null`
(plan-review F1: `startServer`'s catch block can set `status: "stopped"`
with no `score` when a run fails to actually start; `simulationRuns.score`
is nullable). Running and saved rows render a "View" →
`/simulation` link (reusing the existing list+switch UX there); completed
rows are plain list items for now (no link — S-11 adds one). Empty state:
a short message plus a link to `/simulation` to start a run, shown when all
three lists are empty.

#### 3. Make `/dashboard` the post-login landing page

**File**: `src/app/login/page.tsx`

**Intent**: Close the actual gap this slice exists to fix — today's
`redirectTo: "/"` lands on the untouched scaffold page, not the app.

**Contract**: Change `signIn("github", { redirectTo: "/" })` to
`signIn("github", { redirectTo: "/dashboard" })`. The existing comment
explaining *why* an explicit `redirectTo` is required stays accurate and
unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- Logging in (via the E2E test-auth bypass) lands on `/dashboard`, not `/`
  or `/simulation`.
- Starting a run on the server, then visiting `/dashboard`, shows it under
  "Running"; saving/pausing it moves it to "Saved"; resuming and letting it
  finish moves it to "Completed" with a score.
- The status filter correctly narrows the visible rows to each category.
- With zero runs, the empty state renders instead of three blank sections.

## Testing Strategy

### Unit Tests:

- `simulation.test.ts`: new `describe("simulationRouter.listCompleted")`
  block mirroring the existing `listRunning`/`listSaved` ownership tests —
  "returns only the caller's own stopped rows, not another user's", and a
  basic shape/ordering check. No UI tests — this project's existing
  convention is manual browser verification for UI, not component tests
  (confirmed: no `*.test.tsx` exists for `/simulation/page.tsx` either).

### Manual Testing Steps:

1. See Manual Verification above — performed via the dev server + the
   E2E test-auth bypass (`/api/test-auth/login`), same pattern used
   throughout this project's prior slices.

## Performance Considerations

`listCompleted`'s `.limit(50)` bounds the query the same way the dashboard
avoids unbounded growth elsewhere in this project — no new unbounded
surface.

## Migration Notes

None — no schema change; `listCompleted` reads existing columns only.

## References

- Roadmap: `context/foundation/roadmap.md` S-10 (post-login-run-dashboard), MS-07
- PRD: `context/foundation/prd.md` v2 — FR-013, FR-014
- Research grounding: standard task/run dashboard conventions (Databricks,
  dbt, Control-M, Sauce Labs job-monitoring docs), gathered for this
  roadmap item's MS-07 anchor.
- Precedent for list rendering: `src/app/simulation/page.tsx`'s existing
  "Running on server" section (S-08)
- Gap confirmed at: `src/app/login/page.tsx:15`, `src/app/page.tsx` (full read)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: listCompleted query, dashboard page, post-login redirect

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- [x] 1.4 Full suite still passes: `npm test`

#### Manual

- [x] 1.5 Logging in lands on `/dashboard`, not `/` or `/simulation`
- [x] 1.6 Running/Saved/Completed sections correctly reflect a run's lifecycle
- [x] 1.7 Status filter correctly narrows visible rows
- [x] 1.8 Empty state renders with zero runs
