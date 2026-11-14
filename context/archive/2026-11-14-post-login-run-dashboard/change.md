---
change_id: post-login-run-dashboard
title: Post-login dashboard listing the user's own simulation runs
status: archived
created: 2026-11-14
updated: 2026-11-14
archived_at: 2026-11-14T14:58:47Z
---

## Notes

Roadmap S-10 (M-1 extension, 2026-11-14, MS-07). No dashboard or post-login
landing page exists today — `/simulation` is both the staging form and the
only run-related page; there is no route a logged-in user is redirected to.

`listRunning`/`listSaved` (`src/server/api/routers/simulation.ts`) already
return the caller's own rows filtered by status — this is additive UI over
existing data, not new backend capability.

Grounded in web research on standard task/run dashboard conventions
(Databricks, dbt, Control-M, Sauce Labs): runs list with color-coded
status, filters (status/date/name), a run detail view (start/end time,
duration, status, trigger), summary metric tiles, and drill-down from a
summary widget into a filtered list.

Reasonable default already recorded in roadmap.md's S-10 Unknown: a new
`/dashboard` route becomes the post-login redirect target; `/simulation`
stays reachable from it for staging/starting new runs. Not blocking,
refined further here if needed.

Prerequisite F-01 (auth) already done.
