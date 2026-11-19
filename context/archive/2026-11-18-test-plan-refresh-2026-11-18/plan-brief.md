# Page-level smoke & regression sweep — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-11-18/plan.md`

## What & Why

Add a Playwright e2e sweep that visits every page route with an
authenticated session and asserts no console/render error and no
stale placeholder content. Two of the three bugs fixed earlier this
session (`admin-settings-range-backfill`, `root-page-scaffold-redirect`)
were client-side-only failures that returned HTTP 200 and were
invisible to both the existing unit/integration suite and server logs
— this closes that blind spot.

## Starting Point

The project has a `test-plan.md` with 10 complete rollout phases, all
simulation-engine-focused. Three Playwright specs already exist
(`seed.spec.ts`, `auth-ux.spec.ts`, `authenticated-simulation-run.spec.ts`)
with a shared-session pattern (`auth.setup.ts`) and a per-test
isolated-session pattern, but no spec sweeps every route, and no spec
installs a console/pageerror listener anywhere.

## Desired End State

Every one of 14 real routes (excluding the public `/login`;
`/simulation/multi` doesn't exist and was dropped from the original
brief's assumption), visited by an authenticated session, is proven to
render cleanly: zero console errors, zero uncaught exceptions, a
route-specific landmark present. A deliberate break (reproducing the
exact bug shape from `admin-settings-range-backfill`) proves the sweep
actually catches this failure class.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Route count | 14 (12 shared-session + 2 gated), excluding public `/login` | `/simulation/multi` doesn't exist in this codebase, correcting an earlier miscount | Research |
| Admin access for `/admin/settings` | New fixture: direct DB `role: "admin"` write after bypass sign-in | `ADMIN_EMAILS` only fires on NextAuth's adapter `createUser` event, which the bypass route skips; `ALLOW_SELF_ELEVATION` defaults false, unsafe to assume in CI | Research → Plan |
| Reaching `/runs/[runId]` | Drive the existing UI start/stop flow, then click the dashboard's link | No seed/fixture creates a run row directly; reuses `authenticated-simulation-run.spec.ts`'s proven sequence instead of inventing a DB-insert fixture for a 15+-field schema | Research → Plan |
| DB import in the admin fixture | Reuse the existing `~/server/db` singleton | Gets the project's `busy_timeout` pragma for free on a file shared with the app server and any parallel `npm test` run; a raw client wouldn't (verified via plan-review) | Plan-review |
| New tool vs. extend existing suite | Extend existing Playwright suite | Interview Q4 explicitly asked for this; e2e is already the chosen layer, no new tool needed | Accepted brief |

## Scope

**In scope:** 14 routes, a new admin-role fixture, reuse of the existing run-creation flow for the dynamic route, console/pageerror assertions, a cookbook update to `test-plan.md`.

**Out of scope:** Visual/pixel-diff testing, a filesystem-based route-discovery mechanism, adding admin-fixture support to the shared bypass route itself, `/simulation/multi` (doesn't exist).

## Architecture / Approach

One new spec file (`tests/e2e/page-smoke-sweep.spec.ts`) with one `test()` per route, plus one small fixture file (`tests/e2e/admin-fixture.ts`) for the admin-role case. 12 routes use the existing shared `storageState`; 2 routes (admin, dynamic run) opt out and sign in fresh, matching `auth-ux.spec.ts`'s established pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fixtures | Admin-role sign-in helper | Reusing the shared `db` client (not a raw one) to avoid a SQLITE_BUSY risk against the same file the app server writes to |
| 2. Core sweep | 12 routes, console/pageerror assertions | Picking the right landmark per route so a crash is distinguishable from real content |
| 3. Gated-route sweep | `/admin/settings` + `/runs/[runId]` | Dynamic-route fixture reuses a UI flow, adding runtime to this phase's test |
| 4. Cookbook update | `test-plan.md` §2/§3/§6 closed out | None — documentation only |

**Prerequisites:** None beyond the existing Playwright setup (`auth.setup.ts`, `playwright.config.ts`) already in the repo.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- The route-specific landmark for each page needs reading each page's actual current heading/content at implementation time — not fully enumerated in the plan to avoid staleness; Phase 2's implementer reads each component.
- If a future route is added and nobody updates the hardcoded sweep list, it silently isn't covered — the Phase 4 cookbook entry documents this so it's a known, accepted gap rather than a surprise.

## Success Criteria (Summary)

- All 14 routes pass the sweep with zero console/pageerror events.
- The deliberate-break check proves the sweep is not vacuous.
- `test-plan.md` reflects the shipped pattern for future route additions.
