# Page-level smoke & regression sweep Implementation Plan

## Overview

Add a Playwright e2e sweep that visits every page route with an
authenticated session and asserts it renders with no client-side
console/render error and no stale placeholder content — closing a gap
this plan's own accepted refresh brief identified: 2 of the 3 bugs
fixed earlier this session (`admin-settings-range-backfill`,
`root-page-scaffold-redirect`) were client-side-only failures that
returned HTTP 200 and were invisible to both the existing
unit/integration suite and server logs.

## Current State Analysis

- 14 real routes need sweeping (confirmed via `find src/app -name
  page.tsx`): `/`, `/dashboard`, `/simulation`,
  `/simulation/kitchen-sink`, `/runs/compare`, `/runs/[runId]`,
  `/leaderboard`, `/reference`, `/reference/parameters`,
  `/reference/population-lifecycle`, `/reference/scoring`,
  `/reference/storyline`, `/admin/settings`, `/admin/elevation`.
  `/login` is public (excluded by `src/middleware.ts`'s matcher) and is
  already covered by `tests/e2e/auth-ux.spec.ts`.
  **Correction to the accepted brief**: `/simulation/multi` does not
  exist in this codebase (`find src/app/simulation -type f` shows only
  `page.tsx` and `kitchen-sink/page.tsx`) — dropped from scope.
- `src/middleware.ts` gates every route above except `/login`; no
  further role check at the middleware layer.
- `/admin/settings` additionally requires `isEffectivelyAdmin(session.user)`
  in-page (`src/app/admin/settings/page.tsx:12-16`) — redirects
  non-admins to `/simulation`.
- `/admin/elevation` requires only a session — no role gate to view it
  (`src/app/admin/elevation/page.tsx:5-7`'s own comment: "reachable by
  any logged-in user, by design") — renders differently for admins but
  never redirects non-admins away. Sweeping it as a regular auth-only
  route is correct; no admin fixture needed for this one.
- `/runs/[runId]` is dynamic — no existing seed/fixture creates a run
  row directly. The only established way to produce one is driving the
  UI: `tests/e2e/authenticated-simulation-run.spec.ts` starts a cheap
  run via `/simulation`'s "Start"/"Stop" buttons, which scores and
  persists it; `src/app/dashboard/page.tsx:200` then links to
  `/runs/${run.id}`.
- `/admin/settings` needs a real admin-role user. The test-auth bypass
  route (`src/app/api/test-auth/login/route.ts`) inserts a plain
  `{email, name, emailVerified}` row with `role` left at schema default
  (`"member"`) — it bypasses NextAuth's adapter entirely, so
  `ADMIN_EMAILS`'s allowlist mechanism (`src/server/auth/config.ts:90-102`,
  which only fires on the adapter's `createUser` event during a real
  OAuth sign-in) **does not apply** to bypass-created users. The
  self-elevation mutation (`user.elevateSelf`) is gated behind
  `env.ALLOW_SELF_ELEVATION`, which defaults to `"false"` and is not
  safe to assume enabled in CI. The only deterministic path is a new
  fixture that writes `role: "admin"` directly via Drizzle after the
  bypass creates the user row.
- No existing Playwright spec imports `~/server/db` or any app source
  module — but Playwright's own bundled tsconfig-loader already
  resolves `tsconfig.json`'s `"~/*"` path mapping natively for its test
  process (verified empirically), so a new fixture can use the normal
  `~/server/db` alias like the rest of the codebase; no new import
  convention is needed.
- Zero existing Playwright spec installs a `page.on("console", ...)` or
  `page.on("pageerror", ...)` listener anywhere in `tests/` — this is a
  new pattern for the repo, not an extension of one.
- `playwright.config.ts` already has a `setup` project
  (`tests/e2e/auth.setup.ts`) producing a shared `storageState`
  (`playwright/.auth/user.json`) that the default `chromium` project
  depends on; `tests/e2e/auth-ux.spec.ts` additionally shows a
  per-test fresh-user pattern (`signInAsFreshTestUser`, re-calling the
  bypass route with a unique email) for tests that need an isolated
  session rather than the shared one.

### Key Discoveries:

- `isEffectivelyAdmin` (`src/server/auth/elevation.ts`) only checks
  `user.role === "admin"` (+ an optional expiry) — a direct
  `role: "admin"` DB write is sufficient, no `elevatedUntil` value
  needed for a permanent grant (`null` means never-expires).
- `authenticated-simulation-run.spec.ts`'s exact locator sequence
  (`getByRole("button", { name: "Start" })` → fill boid/predator
  counts → click → wait for "Stop" → click → wait for `/^Score: /`
  text) is the only proven way to produce a real scored run row; reuse
  it rather than inventing a new one.

## Desired End State

Every one of the 14 routes, visited by an authenticated session (admin
fixture for `/admin/settings`, a real scored run for `/runs/[runId]`),
renders with zero browser console errors, zero uncaught `pageerror`
events, and a route-specific landmark assertion that distinguishes real
content from a crashed/placeholder state — extending the existing
Playwright suite, not adding a new tool.

**Verification**: `npx playwright test` passes for the new spec file(s);
a deliberate break (temporarily reintroducing a client-side throw, e.g.
in a copy of the `admin-settings-range-backfill` bug shape) turns the
relevant assertion red, proving the sweep actually catches this failure
class.

## What We're NOT Doing

- Not adding a visual/pixel-diff layer — this risk is about
  console/render errors and stale content, not visual regressions (per
  the accepted brief's anti-pattern guidance).
- Not building a route-discovery mechanism that walks the filesystem at
  test-run time — the route list is hardcoded in the new spec file(s);
  a route added later needs a one-line addition there (documented in
  the cookbook update, Phase 4).
- Not adding admin-fixture support to the shared `/api/test-auth/login`
  bypass route itself — the new fixture is test-only code living beside
  the spec, since this capability is needed by exactly one test today
  and the bypass route's own file explicitly scopes itself to "local
  Playwright E2E runs only," not a general-purpose test-admin API.
- Not covering `/simulation/multi` — it does not exist in this
  codebase; the accepted brief's assumption was wrong.

## Implementation Approach

Four phases: fixtures first (admin-role user, a seeded scored run),
then the bulk of the sweep (12 routes needing only the existing shared
session), then the two routes needing the new fixtures, then update
`test-plan.md`'s §2/§3/§6 to close the rollout phase.

## Critical Implementation Details

**Shared SQLite file — the admin fixture must reuse the existing `db`
client, never open a raw one.** The Playwright test process, the app's
`webServer`, and any parallel `npm test` vitest run all point at the
same `db.sqlite` file. `src/server/db/index.ts`'s `busy_timeout`
pragma is per-connection, set once per process on first import of that
module. Importing `db` from `~/server/db` in the fixture (rather than
calling `createClient(...)` directly) gets that pragma for free on the
fixture's own connection; a raw client would start with SQLite's
default no-retry busy handler and risk `SQLITE_BUSY` against the same
file the app server is concurrently writing to.

## Phase 1: Fixtures — admin-role user and a seeded scored run

### Overview

Add the two pieces of test-only setup the gated routes need: a helper
that creates a bypass user and promotes it to admin via a direct DB
write, and confirmation that the existing UI-driven run flow produces
a navigable `/runs/[runId]` link.

### Changes Required:

#### 1. Admin-role test fixture

**File**: `tests/e2e/admin-fixture.ts` (new)

**Intent**: Give any spec a way to reach `/admin/settings` as a real
admin, without touching the shared `/api/test-auth/login` bypass route
or enabling `ALLOW_SELF_ELEVATION`.

**Contract**: Export an async `signInAsAdminTestUser(page)` function
following `auth-ux.spec.ts`'s `signInAsFreshTestUser` shape (POST to
`/api/test-auth/login` with a unique email, same as that pattern), then
import `db` and `users` from `~/server/db` and `~/server/db/schema`
respectively (the existing shared client — see "Critical Implementation
Details" for why this matters) and run
`db.update(users).set({ role: "admin" }).where(eq(users.email, email))`
immediately after the bypass call succeeds. Return the email used (for
any later cleanup/debugging reference), mirroring
`signInAsFreshTestUser`'s return shape.

#### 2. Confirm the run-to-detail-page link path

**File**: none changed — this is a verification step, not a code
change, folded into Phase 3's own test rather than a separate fixture
file.

**Intent**: Document (for Phase 3) that no new fixture is needed here:
driving `/simulation`'s start/stop flow, then clicking the dashboard's
link to the resulting run, is the established and sufficient path to a
real `/runs/[runId]`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None for this phase — the fixture is exercised and proven working by
  Phase 3's actual test, not in isolation.

## Phase 2: Core sweep — 12 auth-only routes

### Overview

The bulk of the sweep: every route that needs only the existing shared
authenticated session (no admin, no dynamic id).

### Changes Required:

#### 1. Page-sweep spec

**File**: `tests/e2e/page-smoke-sweep.spec.ts` (new)

**Intent**: For each of the 12 routes (`/`, `/dashboard`, `/simulation`,
`/simulation/kitchen-sink`, `/runs/compare`, `/leaderboard`,
`/reference`, `/reference/parameters`, `/reference/population-lifecycle`,
`/reference/scoring`, `/reference/storyline`, `/admin/elevation`),
assert zero console errors, zero uncaught exceptions, and the presence
of a route-specific landmark that could not render from a crashed or
placeholder state.

**Contract**: A single `test.describe` with one `test(...)` per route
(not a shared loop with dynamic test names — Playwright's own
convention favors named, independently-reportable tests over a loop
that hides which specific route failed). Each test: attach
`page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); })`
and `page.on("pageerror", err => errors.push(err.message))` before
`page.goto(route)`, then after navigation assert `errors` is empty AND
a route-specific `getByRole`/`getByText` landmark is visible (e.g. the
page's own `<h1>`/heading text — reuse exact heading strings already
asserted in `authenticated-simulation-run.spec.ts`/`auth-ux.spec.ts`
where a route overlaps, otherwise read each page's actual heading from
its component). `/` is a special case: assert the landing lands on
`/dashboard` (it's a pure redirect, per
`root-page-scaffold-redirect`'s own fix), not a heading on `/` itself.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New spec passes: `npx playwright test page-smoke-sweep`

#### Manual Verification:

- None — e2e assertions against a real browser are themselves the
  verification layer for this phase; no separate manual step adds
  signal beyond what Playwright already observed.

## Phase 3: Gated-route sweep — `/admin/settings` and `/runs/[runId]`

### Overview

The two routes needing extra setup beyond the shared session: a real
admin and a real scored run.

### Changes Required:

#### 1. Admin-settings sweep test

**File**: `tests/e2e/page-smoke-sweep.spec.ts` (same file, new test)

**Intent**: Prove `/admin/settings` itself renders cleanly for a real
admin — Phase 2 already covers `/admin/elevation`'s non-admin path,
this covers the one route that actually needs the role.

**Contract**: `test.use({ storageState: { cookies: [], origins: [] } })`
(opt out of the shared session, matching `auth-ux.spec.ts`'s pattern
for tests needing a distinct identity), call
`signInAsAdminTestUser(page)` from Phase 1's fixture, navigate to
`/admin/settings`, assert no console/pageerror events and a landmark
specific to the real settings form (not the `redirect("/simulation")`
fallback a non-admin would hit — assert the absence of that redirect
by checking the URL stayed on `/admin/settings`).

#### 2. Run-detail-page sweep test

**File**: `tests/e2e/page-smoke-sweep.spec.ts` (same file, new test)

**Intent**: Prove `/runs/[runId]` renders cleanly for a real run,
reached the way a real user reaches it.

**Contract**: Also opt out of shared storageState with a fresh
sign-in (same isolation reasoning as above). Reuse
`authenticated-simulation-run.spec.ts`'s exact start/stop sequence to
produce a scored run, navigate to `/dashboard`, click the link to that
run (the most recently created one — `getByRole("link")` scoped to the
dashboard's run-history section, not a hardcoded id), land on
`/runs/[runId]`, assert no console/pageerror events and a landmark
specific to a real run-detail view.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full spec passes: `npx playwright test page-smoke-sweep`

#### Manual Verification:

- Deliberate-break check: temporarily reintroduce a client-side throw
  on one swept page (e.g. read an `undefined` property, mirroring the
  `admin-settings-range-backfill` bug shape) and confirm the relevant
  sweep test goes red, then revert — proving the sweep actually
  catches this failure class, not just that it passes today.

## Phase 4: Cookbook update

### Overview

Close the rollout phase by updating `context/foundation/test-plan.md`:
flip §3 Phase 11 to its final state and add a §6 cookbook entry so
future agents know how to add a new route to the sweep.

### Changes Required:

#### 1. Update test-plan.md

**File**: `context/foundation/test-plan.md`

**Intent**: Record what shipped so `/10x-tdd` and future agents can
find the pattern without re-deriving it.

**Contract**: §2 — add Risk #10 and its Risk Response Guidance row
verbatim from the accepted brief (`context/changes/test-plan-refresh-2026-11-18/change.md`),
with the `/simulation/multi` correction folded into the risk wording if
it was mentioned there. §3 — add Phase 11's row with Status `complete`
and this change's folder path. §6 — add a new numbered subsection
("Adding a route to the page-smoke sweep") describing: where the spec
lives, the console/pageerror listener pattern, how to add a new route
(one `test(...)` block), and when a route needs its own fixture
(admin-role, dynamic-id) vs. the shared session.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None — a documentation-only change.

## Testing Strategy

### Unit Tests:

- None new — this entire change is e2e-layer by design (per the
  accepted brief: e2e is "the only layer that observes real
  client-side exceptions and rendered DOM state").

### Manual Testing Steps:

1. Run `npx playwright test page-smoke-sweep` locally against a built
   app and confirm all tests pass.
2. Perform the Phase 3 deliberate-break check.

## Performance Considerations

None beyond the existing e2e suite's own cost — this adds ~14 page
visits to a suite that already builds and starts the app per the
existing `webServer` config.

## Migration Notes

None — test-only files; no schema or production code changes.

## References

- Accepted refresh brief: `context/changes/test-plan-refresh-2026-11-18/change.md`
- Existing auth patterns: `tests/e2e/auth.setup.ts`, `tests/e2e/auth-ux.spec.ts`
- Existing run-creation flow: `tests/e2e/authenticated-simulation-run.spec.ts`
- Admin role logic: `src/server/auth/elevation.ts`, `src/app/admin/settings/page.tsx:12-16`
- Rollout guide this phase closes: `context/foundation/test-plan.md` §3 Phase 11

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fixtures — admin-role user and a seeded scored run

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — db366f4
- [x] 1.2 Lint passes: `npm run check` — db366f4

### Phase 2: Core sweep — 12 auth-only routes

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 35c3f92
- [x] 2.2 Lint passes: `npm run check` — 35c3f92
- [x] 2.3 New spec passes: `npx playwright test page-smoke-sweep` — 35c3f92

### Phase 3: Gated-route sweep — `/admin/settings` and `/runs/[runId]`

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck`
- [x] 3.2 Lint passes: `npm run check`
- [x] 3.3 Full spec passes: `npx playwright test page-smoke-sweep`

#### Manual

- [x] 3.4 Deliberate-break check: reintroduced client-side throw turns the sweep red, then reverted

### Phase 4: Cookbook update

#### Automated

- [ ] 4.1 Typecheck passes: `npm run typecheck`
- [ ] 4.2 Lint passes: `npm run check`
