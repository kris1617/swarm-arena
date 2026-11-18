# Root route scaffold removal — Plan Brief

> Full plan: `context/changes/root-page-scaffold-redirect/plan.md`

## What & Why

A signed-in user landing on `/` sees the unmodified `create-t3-app`
scaffold instead of the real app — confirmed via a live screenshot. The
scaffold's `post.create` procedure is also a live, fully unauthenticated
public write endpoint with no product purpose. This removes the whole
scaffold (page, router, table, component) and redirects `/` to
`/dashboard`.

## Starting Point

`src/app/page.tsx` still calls `api.post.hello`/`getLatest`/`<LatestPost />`
— the literal bootstrap scaffold, never replaced. `post.create` is
`publicProcedure` (no auth check at all), registered and reachable.
Confirmed via grep: exactly 4 files touch any of this, nothing else
depends on it.

## Desired End State

`/` redirects straight to `/dashboard` for a signed-in user; the `post`
router, `posts` table, and `LatestPost` component no longer exist
anywhere in the codebase or the production DB.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | Full removal (router, table, component), not just a redirect | Leaving the router/table in place would hide the UI but leave the actual unauthenticated write endpoint live and reachable — doesn't close the real concern. |
| Data cleanup | `DROP TABLE` only, no separate row-cleanup script | The table has no legitimate product purpose; dropping it removes any existing (empty or abuse) rows as a side effect. |

## Scope

**In scope:** Deleting `page.tsx`'s scaffold content (replaced with a redirect), `post.ts`, `post.tsx`, the `posts` table + migration, and the router registration in `root.ts`.

**Out of scope:** Any other router or page; a data-migration script for existing rows; building a new distinct landing page at `/`.

## Architecture / Approach

One phase: delete the four scaffold files' relevant content, drop the
`posts` table via a generated Drizzle migration, replace `page.tsx` with
`redirect("/dashboard")` (the exact pattern `admin/settings/page.tsx`
already uses).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Remove the scaffold and its public write endpoint | Redirect + full removal of the demo feature | None significant — confirmed via grep that nothing else depends on any of the 4 touched files |

**Prerequisites:** None.
**Estimated effort:** Single phase, well under a session.

## Open Risks & Assumptions

- Assumes no existing production `post` rows need preserving — accepted per "What We're NOT Doing," since the table has no legitimate product use.

## Success Criteria (Summary)

- `/` no longer shows placeholder scaffold content to any signed-in user.
- The unauthenticated public write endpoint no longer exists.
