---
change_id: root-page-scaffold-redirect
title: Root route / still renders the unmodified T3 starter scaffold in production
status: impl_reviewed
created: 2026-11-18
updated: 2026-11-18
archived_at: null
---

## Notes

Confirmed via a live screenshot (2026-11-18, post-login): visiting
`https://swarmarena.hopto.org/` while signed in renders inside the real
`AppShell` sidebar (Dashboard/Simulation/Leaderboard/Reference,
`kris1617` logged in), but the **main content area is the literal
unmodified `create-t3-app` scaffold page** — "Create T3 App" heading,
"First Steps"/"Documentation" links to create.t3.gg, "Hello from tRPC",
and a "You have no posts yet" / Title+Submit demo form.

## Confirmed root cause

`src/app/page.tsx` — never replaced after bootstrap. It calls
`api.post.hello(...)`, prefetches `api.post.getLatest`, and renders
`<LatestPost />` — the stock T3 demo content. `src/middleware.ts`'s
matcher gates `/` like any other route (not excluded), so a signed-in
user reaching `/` (direct navigation, bookmark, browser history, or any
link that happens to point at the root) sees this instead of the real
dashboard.

**Not purely cosmetic**: `src/server/api/routers/post.ts`'s `create`
procedure is `publicProcedure` (confirmed in an earlier research pass
this session) — any authenticated-or-not caller can insert arbitrary
"post" rows via this form or the raw tRPC endpoint, with no product
purpose, persisted to a `post` table forever. This is live attack
surface (unbounded, unauthenticated-adjacent write access to the DB)
that exists only because the scaffold was never removed.

## Open design decision (for /10x-plan)

Two shapes this fix could take:
1. **Minimal**: redirect `/` to `/dashboard` (or render nothing/a
   redirect) for signed-in users, matching how every other authed route
   in this app behaves — leaves the `post` router/table as unused dead
   code.
2. **Full removal**: delete the scaffold page, the `post` router, and
   the `post` table/schema entirely, since nothing in this product uses
   them.

Also worth separately noting but likely out of scope here: the Chrome
"Dangerous" Safe Browsing warning is confirmed still active as of this
screenshot (red label in the address bar), even after today's auth-UX
redesign and the middleware fix — this scaffold page's public,
unauthenticated-adjacent write surface is a plausible contributing
factor (exactly the shape automated scanners flag), but this is not
confirmed as the actual cause; the user is checking Search Console
separately for the authoritative reason.
