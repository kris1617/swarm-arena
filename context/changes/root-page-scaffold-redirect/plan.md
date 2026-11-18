# Root route scaffold removal Implementation Plan

## Overview

Replace `/`'s unmodified `create-t3-app` scaffold with a redirect to
`/dashboard`, and remove the demo `post` feature (router, table,
component) entirely — closing both the visible-placeholder-content bug
and a live, fully unauthenticated public write endpoint
(`post.create`) that serves no product purpose.

## Current State Analysis

- `src/app/page.tsx` is the literal unmodified `create-t3-app` scaffold: "Create T3 App" heading, links to create.t3.gg, `api.post.hello`/`api.post.getLatest.prefetch()`/`<LatestPost />`. Confirmed live via a screenshot (2026-11-18): a signed-in user landing on `/` sees this inside the real `AppShell` sidebar instead of the dashboard.
- `src/server/api/routers/post.ts`'s `create` procedure is `publicProcedure` — no auth check, no rate limit, just a zod `.min(1)` string check — confirmed registered and reachable at `appRouter.post.create` (`src/server/api/root.ts:2,13`).
- Confirmed via `grep` that exactly 4 files reference any part of this feature, with nothing else depending on it: `src/app/page.tsx`, `src/server/api/root.ts`, `src/app/_components/post.tsx` (`LatestPost`), `src/server/api/routers/post.ts`. The `posts` table (`src/server/db/schema.ts:17-27`, DB table name `post`) has no other consumer either.
- `src/middleware.ts`'s auth gate already protects `/` like any other route for an unauthenticated visitor (not excluded from the matcher) — this bug is only ever visible to a signed-in user who happens to land on `/`.
- This repo's established pattern for a server-side redirect is Next's `redirect()` from `next/navigation` (`src/app/admin/settings/page.tsx:16`), reused here rather than inventing a new pattern.

## Desired End State

Visiting `/` while signed in redirects straight to `/dashboard`
(matching how every other authed route behaves); the `post` router,
`posts` table, and `LatestPost` component no longer exist; no
unauthenticated write endpoint remains reachable under `appRouter`.

**Verification**: `npm run typecheck`, `npm run check`, `npm test` all
pass; after deploy, visiting `/` while signed in lands on `/dashboard`;
`curl`-ing `/api/trpc/post.create` returns a 404/NOT_FOUND (router no
longer exists), not a successful insert.

## What We're NOT Doing

- Not touching any other router (`simulation`, `user`, `feedback`) or any other page.
- Not writing a data-migration script to delete already-inserted rows from the live `post` table before dropping it — `DROP TABLE` itself removes any existing rows; no separate cleanup step is needed.
- Not adding a new "home" page at `/` with its own content — a redirect to the existing `/dashboard` is the complete fix; building a distinct landing page is out of scope.

## Implementation Approach

One phase: delete the four scaffold files' content/registration, drop
the `posts` table via a generated migration, replace `page.tsx` with a
redirect, verify.

## Phase 1: Remove the scaffold and its public write endpoint

### Overview

Delete the demo feature end-to-end and replace the root page with a
redirect.

### Changes Required:

#### 1. Replace the root page with a redirect

**File**: `src/app/page.tsx`

**Intent**: Signed-in users landing on `/` should reach the real app, not a demo page.

**Contract**: Replace the entire file's content with a `redirect("/dashboard")` (from `next/navigation`), matching the exact pattern `src/app/admin/settings/page.tsx:16` already uses. No `api.post.*` calls, no `HydrateClient`/`LatestPost` — the whole scaffold body is removed, not adapted.

#### 2. Delete the `post` router and its registration

**File**: `src/server/api/routers/post.ts` (delete entirely), `src/server/api/root.ts`

**Intent**: Removes the live unauthenticated write endpoint along with the rest of the demo feature.

**Contract**: Delete `src/server/api/routers/post.ts`. In `root.ts`, remove the `import { postRouter } from "~/server/api/routers/post";` line and the `post: postRouter,` entry from `appRouter`. Update the stale doc-comment example (`trpc.post.all()`) to reference a real router instead (e.g. `trpc.simulation.listRunning()`) so the example still compiles conceptually — it's a comment, not executed code, but shouldn't reference a router that no longer exists.

#### 3. Delete the `LatestPost` component

**File**: `src/app/_components/post.tsx`

**Intent**: Its only caller is the scaffold page being replaced in item 1.

**Contract**: Delete the file entirely.

#### 4. Drop the `posts` table

**File**: `src/server/db/schema.ts`, plus a generated Drizzle migration

**Intent**: Remove the now-unused table entirely, closing the write-surface concern at the data layer too, not just the API layer.

**Contract**: Delete the `posts` export (`schema.ts:17-27`) and any import it needs that nothing else uses. Run `npm run db:generate` to produce the migration file that drops the `post` table (follow the generated file, don't hand-write SQL) — this project's existing deploy pipeline (`deploy.sh`) already runs `drizzle-kit migrate` on every deploy, so no manual production step is needed beyond this migration existing in the repo.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Migration file generated and applies cleanly against a fresh test DB: `npm run db:migrate` (or however the test setup already applies migrations — follow `vitest.config.ts`'s existing convention)

#### Manual Verification:

- After deploy, visiting `/` while signed in redirects to `/dashboard`
- After deploy, `curl -s -o /dev/null -w "%{http_code}" https://swarmarena.hopto.org/api/trpc/post.create` (or equivalent) no longer returns a successful response — the router doesn't exist
- After deploy, confirm the production DB no longer has a `post` table (the migration ran)

## Testing Strategy

### Unit Tests:

- None new — this is a deletion, not new logic. Existing test suite (`npm test`) is the regression guard: if anything still imported the deleted router/component/table, typecheck or an existing test would fail first.

### Manual Testing Steps:

1. Sign in, visit `/` directly — confirm redirect to `/dashboard`.
2. Attempt a direct tRPC call to `post.create` (e.g. via browser devtools or curl against `/api/trpc/post.create`) — confirm it 404s/errors instead of succeeding.

## Performance Considerations

None.

## Migration Notes

The generated migration `DROP TABLE`s the `post` table. This is
destructive for any rows currently in it — acceptable here since the
table has no legitimate product purpose and any existing rows are either
empty (never-used scaffold) or abuse data from the unauthenticated
endpoint, per "What We're NOT Doing."

## References

- Confirmed root cause and screenshot evidence: `context/changes/root-page-scaffold-redirect/change.md`
- Existing redirect pattern: `src/app/admin/settings/page.tsx:16`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Remove the scaffold and its public write endpoint

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 762095a
- [x] 1.2 Lint passes: `npm run check` — 762095a
- [x] 1.3 Full suite still passes: `npm test` — 762095a
- [x] 1.4 Migration generated and applies cleanly: `npm run db:migrate` — 762095a

#### Manual

- [x] 1.5 `/` redirects to `/dashboard` when signed in, against the live deployment — 762095a
- [x] 1.6 `post.create` no longer reachable against the live deployment — 762095a
- [x] 1.7 Production DB no longer has a `post` table — 762095a
