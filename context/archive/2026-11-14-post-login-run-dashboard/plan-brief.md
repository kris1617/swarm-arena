# Plan Brief: Post-login dashboard listing the user's own simulation runs

Full plan: `context/changes/post-login-run-dashboard/plan.md`

## What and why

Logging in currently lands on `/` — the untouched Create-T3-App scaffold
page — because `login/page.tsx`'s `redirectTo: "/"` was never updated past
its placeholder value. There is no dashboard and nothing points a logged-in
user at the app. This plan adds `/dashboard`, listing the user's own runs
(running, saved, completed), and fixes the redirect to point there.

## Starting Point

`listRunning`/`listSaved` already exist and return exactly the shape
needed; only a `listCompleted` query (stopped runs + score) is missing.
`/simulation/page.tsx`'s own "Running on server" section is the existing
precedent for how this project renders a run list — plain Tailwind, no
table/badge component, polled via `refetchInterval: 2000`.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Landing route | New `/dashboard` route becomes the post-login redirect target | Already recorded as the reasonable default in roadmap.md's S-10 Unknown |
| UI primitives | Plain Tailwind `div`s, no new shadcn `table`/`badge` | Matches the only existing run-list precedent (`/simulation`'s own list section) — avoids pattern proliferation for one more list |
| Running/saved row links | Link to `/simulation` (reuses existing list+switch UX there) | `/simulation` already lets the user pick and view any running/saved run — no need to rebuild that |
| Completed row links | None in v1 — informational only | The actual detail/analysis view is roadmap S-11, downstream of this slice |
| Filtering scope | Simple client-side status filter (All/Running/Saved/Completed) only | Research shows mature dashboards support more (date range, pagination) at much larger scale than this project's declared small scale warrants |
| Root `/` page | Untouched | Pre-existing tolerated scaffold content (same convention as the kept `post` router) — out of scope for "add a dashboard" |
| Interview | Skipped | The one open product question already has a recorded default; remaining decisions are implementer-level, resolved from existing patterns + prior research |

## Phases

1. **listCompleted query, dashboard page, post-login redirect** — new tRPC query mirroring listRunning/listSaved, new `/dashboard` client page combining all three lists with a status filter, fix login's redirectTo.

**Prerequisites**: F-01 (auth) — already done.
**Estimated effort**: Single phase; 1 new query + 1 new page + 1 one-line redirect fix, no schema change.

## What We're NOT Doing

- Not touching the `/` scaffold page
- Not building the run-detail/analysis view (S-11)
- Not rebuilding live-viewing UX (already exists on `/simulation`)
- Not adding date-range filtering, pagination, or export

## References

- Roadmap: S-10 (`post-login-run-dashboard`), MS-07
- PRD: FR-013, FR-014
- Full plan: `context/changes/post-login-run-dashboard/plan.md`
