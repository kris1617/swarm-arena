# Leaderboard Implementation Plan

## Overview

Add a new standalone page where the user sees their own completed simulation runs ranked by score, highest first (FR-026, roadmap S-19). Reuses the existing `listCompleted`-shaped ownership query and the dashboard's row-list UI pattern rather than introducing a new data model or shared component.

## Current State Analysis

- `simulation.listCompleted` (`src/server/api/routers/simulation.ts:478-501`) already queries the current user's own `status = "stopped"` runs, selecting `id`, `startedAt`, `boidCount`, `predatorCount`, `score`, `stoppedAt`, ordered by `desc(startedAt)`, capped at `.limit(50)`. No procedure orders by score.
- `simulationRuns.score` (`src/server/db/schema.ts:127`) is a single nullable `d.real()` column — null when a run errors before scoring completes. The dashboard already treats this as a display special case (`run.score === null ? "—" : ...`, `src/app/dashboard/page.tsx:183-185`), not a rankable value.
- `src/app/dashboard/page.tsx` is a client component (`"use client"`) using `api.simulation.*.useQuery`, with inline `isLoading`/`isError`/`isEmpty` derived booleans (lines 54-63) rendered via a ternary (lines 90-221) — Skeleton / plain error message / empty-state CTA / data. Its root element is already a `<div>` (line 70), not `<main>` — `AppShell`'s `SidebarInset` (`src/components/ui/sidebar.tsx:303-311`) renders the one `<main>` landmark for every authenticated page (`src/app/layout.tsx:31`), so any new page's root must follow the same `<div>` pattern.
- No shared `Table` or `Card` component exists in `src/components/ui/`; an earlier archived plan (`post-login-run-dashboard`) explicitly rejected adding one to avoid pattern proliferation. Rows are plain Tailwind `<div>`s inside a `<section>`, styled with token classes (`bg-input`, `text-foreground`, `bg-foreground/35`, etc.), never literal colors.
- `src/components/app-shell.tsx:23-28` already anticipates this: `NAV_ITEMS` has a code comment reading "S-19/S-20 add their own entries here when those pages ship."
- `context/foundation/lessons.md` records a directly relevant rule: a 7-state-matrix plan must not dismiss the "error" state as N/A when the underlying query hook exposes `isError` and the render ignores it (caught in S-16's review of this same dashboard pattern) — this plan's page must render a real error state, not skip it.

## Desired End State

A signed-in user can open a "Leaderboard" page from the sidebar nav and see their own completed (scored) runs listed in descending score order, each row showing its rank, score, a few run facts, and a link to that run's analysis page. The top 3 ranks get a subtle token-based visual highlight. Runs with no score (errored before scoring) are not shown here (they remain visible on the dashboard's Completed section). Verification: load `/leaderboard` as a user with ≥3 scored completed runs and confirm the order, rank numbers, and top-3 highlight; load it as a user with zero completed runs and confirm the empty state; confirm the sidebar nav entry links there and highlights as active.

### Key Discoveries:

- `listCompleted`'s existing ownership + status-filter shape (`src/server/api/routers/simulation.ts:478-501`) is the direct template for the new query — only the `WHERE`/`ORDER BY` differ.
- The dashboard's Completed section (`src/app/dashboard/page.tsx:157-219`) is the direct template for row rendering, including the nullable-score pattern (not needed here since null scores are excluded) and the `/runs/${run.id}` link target.
- `globals.css` exposes `--primary`/`--accent`/`--border` tokens (already surfaced as Tailwind classes `bg-accent`, `border-primary`, etc. via `@theme inline`) usable for the top-3 highlight without inventing a new token.

## What We're NOT Doing

- No new shared `Table`/`Card`/`Badge` component — reuse the existing div-row/section pattern.
- No cross-user ranking — this is strictly the current user's own runs (FR-026's own Socratic note: not a competitive multi-user leaderboard).
- No pagination — top 50 by score, same cap as `listCompleted`.
- No change to `listCompleted` or the dashboard's existing Completed section — this is a net-new, separate query and page.
- No new DB column or migration — `score`, `status`, `userId` already exist and are sufficient to rank.

## Implementation Approach

Add one new read-only tRPC procedure scoped and shaped like `listCompleted` but filtered to non-null scores and ordered by score descending (tie-broken by `startedAt` descending), then build a new page that mirrors the dashboard's existing client-component/query-state/row-list pattern, with a sidebar nav entry wired into the slot `app-shell.tsx` already reserved for it.

## Phase 1: Backend query

### Overview

Add the ranked, score-filtered query the leaderboard page will consume.

### Changes Required:

#### 1. Add `listLeaderboard` procedure

**File**: `src/server/api/routers/simulation.ts`

**Intent**: A new `protectedProcedure.query` returning the current user's own completed (`status = "stopped"`), scored (`score IS NOT NULL`) runs, ordered by score descending with `startedAt` descending as the tie-break, capped at 50 — same shape and ownership discipline as `listCompleted`, placed immediately after it.

**Contract**: Selects `{ id, startedAt, boidCount, predatorCount, score, stoppedAt }` (same field set as `listCompleted`, so the page can reuse the same row-rendering shape). `WHERE` adds `isNotNull(simulationRuns.score)` to `listCompleted`'s existing `and(eq(userId), eq(status, "stopped"))`. `ORDER BY` is `desc(simulationRuns.score), desc(simulationRuns.startedAt)`. Import `isNotNull` from `drizzle-orm` alongside the existing `and, count, desc, eq` import (`src/server/api/routers/simulation.ts:2`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- New unit tests cover: ownership scoping (only the caller's own runs), score-descending order, `startedAt`-descending tie-break on equal scores, exclusion of null-score runs, exclusion of non-`stopped` runs, and the 50-row cap

#### Manual Verification:

- None for this phase — covered end-to-end once the page exists in Phase 2.

---

## Phase 2: Leaderboard page + nav wiring

### Overview

Build the page itself and make it reachable from the sidebar.

### Changes Required:

#### 1. Add the leaderboard page

**File**: `src/app/leaderboard/page.tsx` (new)

**Intent**: A client component following `src/app/dashboard/page.tsx`'s established shape: call `api.simulation.listLeaderboard.useQuery()`, derive `isLoading`/`isError`/`isEmpty` from the query's own `isPending`/`isError`/`data.length`, and render a loading skeleton, a real error message, an empty-state message, or the ranked list — covering all states (`isError` must render, not be dismissed as N/A, per `lessons.md`).

**Contract**: Root element is a `<div>` (never `<main>` — `SidebarInset` already owns that landmark). Each row shows its 1-indexed rank, the run's score (`.toFixed(2)`, no null-guard needed since the query already excludes null scores), `boidCount`/`predatorCount`/`startedAt` facts (same format as the dashboard's rows), and a `Button asChild` linking to `/runs/${run.id}`. The 3 rows with rank 1–3 get an added token class (e.g. `border-primary` or `bg-accent`) distinguishing them from the rest — no literal color values.

#### 2. Wire the sidebar nav entry

**File**: `src/components/app-shell.tsx`

**Intent**: Add `{ label: "Leaderboard", href: "/leaderboard" }` to `NAV_ITEMS` (line 25-28), replacing the existing "S-19/S-20 add their own entries here" comment's placeholder with this change's own entry (leave S-20's portion of the comment intact if it's still pending, or remove the comment if S-20 is also about to land — check at implementation time).

**Contract**: No change to `NavItem`'s shape or the rendering loop (lines 41-47) — this is purely a new array entry, which the existing `isActive={pathname === item.href}` logic already handles correctly for `/leaderboard`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on the new page returns zero hits (tokens only, matching `AGENTS.md`'s UI rules)

#### Manual Verification:

- As a user with ≥3 scored completed runs, `/leaderboard` shows them ranked highest-score-first, with ranks 1-3 visually distinguished
- As a user with zero completed runs, `/leaderboard` shows a real empty state (not a crash or blank page)
- The sidebar shows a "Leaderboard" entry linking to `/leaderboard`, highlighted as active when on that page
- A completed-but-unscored run does not appear on the leaderboard but still appears on the dashboard's Completed section

## Testing Strategy

### Unit Tests:

- `src/server/api/routers/simulation.test.ts` — add a `listLeaderboard` describe block covering: ownership scoping, score-descending order, tie-break by `startedAt` descending, null-score exclusion, non-`stopped`-status exclusion, and the 50-row cap. Follow this file's existing `createCaller`-based pattern.

### Manual Testing Steps:

1. As a user with several scored completed runs of different scores, open `/leaderboard` and confirm descending order and rank numbers.
2. Create two completed runs with identical scores (or stub the DB directly) and confirm the more recently started one ranks first.
3. Confirm a completed run with a null score (e.g. stop a run before it computes a score, if reproducible) appears on the dashboard's Completed section but not on `/leaderboard`.
4. Click a leaderboard row's link and confirm it opens that run's `/runs/[runId]` analysis page.
5. Confirm the sidebar's new "Leaderboard" entry is present and marks itself active while on `/leaderboard`.

## Performance Considerations

None beyond `listCompleted`'s own existing posture — same single indexed-by-userId query shape, same `.limit(50)` cap, no new indexes needed (`userId` and `status` are already filtered elsewhere in this router).

## Migration Notes

None — no schema change; `score`, `status`, and `userId` already exist.

## References

- `src/server/api/routers/simulation.ts:478-501` (`listCompleted`) — the direct template for `listLeaderboard`'s ownership/status-filter shape.
- `src/server/db/schema.ts:98-144` (`simulationRuns`), specifically line 127 (`score`) and lines 123-126 (`status` enum).
- `src/app/dashboard/page.tsx` — the direct template for the page's query-state handling (lines 54-63) and row rendering (lines 157-219).
- `src/components/ui/sidebar.tsx:303-311` and `src/app/layout.tsx:31` — `SidebarInset`'s `<main>` landmark; the new page's root must be a `<div>`.
- `src/components/app-shell.tsx:23-28` — the `NAV_ITEMS` slot already reserved for this change.
- `context/foundation/lessons.md` — the 7-state-matrix / `isError` rule this plan's page must honor.
- Roadmap `context/foundation/roadmap.md` S-19 — the Slice entry this plan implements.
- PRD `context/foundation/prd.md` FR-026 — the requirement, including its Socratic note confirming single-user (not cross-user) scope.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend query

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 2c55f8b
- [x] 1.2 Linting passes: `npm run check` — 2c55f8b
- [x] 1.3 Full suite still passes: `npm test` — 2c55f8b
- [x] 1.4 New unit tests cover ownership scoping, score-descending order, startedAt tie-break, null-score exclusion, non-stopped exclusion, and the 50-row cap — 2c55f8b

### Phase 2: Leaderboard page + nav wiring

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`
- [x] 2.4 Hardcoded-value scan on the new page returns zero hits

#### Manual

- [x] 2.5 Ranked order + rank numbers + top-3 highlight correct for a multi-run user
- [x] 2.6 Empty state renders correctly for a zero-completed-runs user
- [x] 2.7 Sidebar "Leaderboard" entry present, links correctly, and highlights as active
- [x] 2.8 A completed-but-unscored run is excluded from the leaderboard but still visible on the dashboard
