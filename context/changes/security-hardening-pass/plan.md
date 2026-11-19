# Security hardening pass Implementation Plan

## Overview

Close three independent, defense-in-depth gaps confirmed by this
session's security research: missing security HTTP headers (including
a full CSP), no rate limiting on `simulation.start`/`startServer`, and
a cookie-hygiene gap in the local-only test-auth bypass route. No
CRITICAL/HIGH finding exists in this codebase — this is hardening, not
an incident response.

## Current State Analysis

- `next.config.js`, `Caddyfile`, and `src/middleware.ts` have zero
  security headers configured — confirmed via repo-wide grep.
  `/login` (the GitHub OAuth entry point) therefore has no
  clickjacking protection either, since that's the same root cause.
- `feedback.ts` already has a working DB-counted rate-limit pattern
  (`MAX_REPORTS_PER_HOUR = 5`, counts rows in `feedbackReports` by
  `userId` + `createdAt` within a rolling window,
  `feedback.ts:17-50`) — the template to reuse for simulation runs.
- `simulation.start` and `simulation.startServer`
  (`simulation.ts:525,538`) both funnel through the same
  `insertRunningSimulation(db, userId, input)` helper
  (`simulation.ts:439`), which already queries `simulationRuns` once
  (for the `MAX_PARALLEL_RUNS` concurrency check). Neither the table
  nor the helper currently distinguishes which mutation created a row
  — there is no existing column recording that. Separate per-mutation
  rate-limit budgets (the agreed design) need a way to tell them
  apart, which means adding a column — this is a necessary
  consequence of the "separate budgets" choice, not scope creep.
- `src/app/api/test-auth/login/route.ts:96` hardcodes `secure: false`
  on the session cookie it sets, regardless of environment. The
  route's real control is the 404-when-`E2E_TEST_AUTH_SECRET`-unset
  gate (confirmed unset in production) — this is a secondary
  defense-in-depth gap only relevant if that primary gate were ever
  misconfigured.
- CSP requirements confirmed via research (`research.md` +
  codebase grounding during planning): fonts are self-hosted via
  `next/font` (`layout.tsx:4`, no external font host needed); the only
  external resource is GitHub's avatar image
  (`avatars.githubusercontent.com`, rendered via a plain `<img>` in
  `user-menu.tsx:58`/`avatar.tsx:27-32`, not `next/image`); zero
  third-party `<script>`/`next/script` usage anywhere; the SSE-based
  `simulation.watch` subscription and all tRPC calls are same-origin
  (`src/trpc/react.tsx:62-88`, `getBaseUrl()` always returns
  `window.location.origin`). No nonce infrastructure exists in
  `src/middleware.ts` or `next.config.js` today.

### Key Discoveries:

- `insertRunningSimulation` is the single shared entry point for both
  `start` and `startServer` — the rate-limit check and the new
  `runMode` column both belong there, not duplicated in each mutation
  handler.
- Radix UI primitives (used throughout this app's `src/components/ui/`)
  are known to apply inline `style` attributes for positioning
  (dropdowns, popovers, tooltips) — research flagged `style-src
  'unsafe-inline'` as a likely-necessary-but-not-grep-confirmed
  requirement. This is exactly why Phase 4's manual verification pass
  exists: confirm empirically, in a real browser, before treating the
  CSP as final.

## Desired End State

Every response carries X-Frame-Options, X-Content-Type-Options,
Referrer-Policy, Strict-Transport-Security, and a Content-Security-Policy
that doesn't break hydration, images, or Radix-styled UI. A signed-in
user is rate-limited separately on `start` (client-ticked) and
`startServer` (server-owned) attempts. The test-auth bypass route's
cookie matches production cookie hygiene.

**Verification**: `npm run typecheck`, `npm run check`, `npm test` all
pass; after deploy, every major flow (login, dashboard, simulation
start/stop, admin settings) works with zero CSP violations in the
browser console; `simulation.start`/`startServer` throw
`TOO_MANY_REQUESTS` with a clear message once their respective
per-hour budget is exhausted.

## What We're NOT Doing

- Not switching to a nonce-based CSP `script-src` — that requires new
  middleware infrastructure in an already-load-bearing file
  (`src/middleware.ts` owns the auth gate) and was explicitly declined
  in favor of `'unsafe-inline'` for this phase.
- Not changing `MAX_PARALLEL_RUNS`'s existing concurrency cap — the
  new rate limit is additive (request *frequency*), not a replacement
  for the existing concurrent-run cap.
- Not adding a generic rate-limiting library — reusing this project's
  own established DB-counted-window pattern (`feedback.ts`) for
  consistency, per this project's own convention of extending existing
  patterns rather than introducing a new dependency for one feature.
- Not auditing or hardening anything beyond the 3 items research
  identified (headers, rate limiting, the test-auth cookie) — the
  4-8 moderate npm audit advisories are dev-tooling-only and confirmed
  not to reach production; no action item exists for them.

## Implementation Approach

Four phases: headers + CSP first (purely additive, no schema change,
independently testable), then the rate-limit schema change + logic
(the one phase touching the DB), then the one-line cookie fix, then a
dedicated manual verification pass against the CSP specifically,
since its correctness can't be fully confirmed by static analysis
alone.

## Phase 1: Security headers including CSP

### Overview

Add all five headers via `next.config.js`'s `headers()` function.

### Changes Required:

#### 1. Add the headers() function

**File**: `next.config.js`

**Intent**: Apply security headers to every response.

**Contract**: Export a `headers()` async function returning one entry
matching `source: "/(.*)"` with these header values: `X-Frame-Options:
DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy:
strict-origin-when-cross-origin`; `Strict-Transport-Security:
max-age=31536000; includeSubDomains`; `Content-Security-Policy:
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src
'self' 'unsafe-inline'; img-src 'self' avatars.githubusercontent.com
data:; font-src 'self'; connect-src 'self';` (semicolon-joined, as one
string — Next.js's `headers()` takes the full policy as a single
header value, not an object). Keep the existing `output: "standalone"`
and `skipProxyUrlNormalize` config untouched.

#### 2. Also apply the same headers to middleware-issued responses

**File**: `src/middleware.ts`

**Intent**: `next.config.js`'s `headers()` only applies through the
page/route-rendering pipeline — a redirect response middleware itself
issues (e.g. an unauthenticated request to a protected page,
redirected to `/login` by NextAuth's `auth()` wrapper) never reaches
it. Without this, "every response carries these headers" would not
actually be true for that common case.

**Contract**: Replace the current bare re-export (`export { auth as
middleware } from "~/server/auth"`) with a thin wrapper that calls the
same `auth` gate, then attaches the identical header set from Phase 1
§1 to whatever response `auth` produces, before returning it — the
authorization *decision* itself (unchanged, still owned by
`authConfig`'s `authorized` callback) must not be touched, only the
outgoing response's headers. Since the header values must stay
identical between `next.config.js` and `middleware.ts`, extract them
into one shared constant (e.g. `src/lib/security-headers.ts`,
exporting a `SECURITY_HEADERS: Record<string, string>`) that both
files import from, rather than duplicating the literal strings in two
places:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { SECURITY_HEADERS } from "~/lib/security-headers";

export default auth((req) => {
	const isAuthorized = !!req.auth?.user;
	let response: NextResponse;
	if (!isAuthorized && req.nextUrl.pathname !== "/login") {
		const signInUrl = req.nextUrl.clone();
		signInUrl.pathname = "/login";
		signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
		response = NextResponse.redirect(signInUrl);
	} else {
		response = NextResponse.next();
	}
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
});
```

**Implementation note (post-dispatch correction, landed in 37d5a83)**:
the snippet above is the actual shipped shape, not the originally
drafted one. NextAuth's `auth()` dispatch (`handleAuth` in
`node_modules/next-auth/lib/index.js`) runs a custom middleware
callback **instead of** its automatic unauthorized→signIn redirect,
not after it — passing `request` directly (the originally drafted
snippet) doesn't type-check and wouldn't preserve the redirect
behavior either way. The callback above replicates that default
redirect logic inline (mirroring `authConfig`'s `authorized` callback
and NextAuth's own default redirect exactly), verified live:
signed-out `/dashboard` still 307s to `/login`, signed-in `/dashboard`
still 200s, `/login` itself unaffected.

Keep `runtime = "nodejs"` and the existing `config.matcher` untouched
— this only wraps what the existing gate already returns, it does not
change which requests middleware runs on.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Confirm the auth gate itself still works after wrapping it: visit a
  protected page while signed out, confirm the redirect to `/login`
  still happens (not broken by the wrapper) — the header content
  itself is deferred to Phase 4, but this specific check (auth
  decision unchanged) belongs here since it's `middleware.ts`-specific
  risk, not a CSP-rendering concern.

## Phase 2: Rate limit simulation.start/startServer

### Overview

Add a `runMode` column to distinguish the two mutations, then apply
`feedback.ts`'s exact DB-counted-window rate-limit pattern with
separate thresholds.

### Changes Required:

#### 1. Add the `runMode` column

**File**: `src/server/db/schema.ts`, plus a generated Drizzle migration

**Intent**: Give `simulationRuns` rows a way to record which mutation
created them, so a rate-limit count can be scoped per-mutation.

**Contract**: Add `runMode: d.text("runMode", { enum: ["client",
"server"] }).notNull().default("client")` to the `simulationRuns`
table definition, following this file's own existing
convention — every prior `NOT NULL` column added to a table with
existing rows in this project's migration history
(`drizzle/0002`,`0006`,`0007`,`0009`,`0010`,`0012`,`0013`,`0015`)
pairs with an explicit schema-level `.default(...)`, which
`drizzle-kit generate` then emits inline with no interactive prompt —
`"client"` is correct since every row created before this phase was
created via the pre-existing `start` mutation only. Run `npm run
db:generate` to produce the migration — follow the generated file,
don't hand-write SQL.

#### 2. Thread `runMode` through `insertRunningSimulation` and add the rate-limit check

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Record which mutation created each row, and reject the
call before insertion if that mutation's own per-hour budget is
already spent — mirroring `feedback.ts`'s check-then-insert order
exactly.

**Contract**: Add a `runMode: "client" | "server"` parameter to
`insertRunningSimulation`; pass `"client"` from `start`'s call site and
`"server"` from `startServer`'s. Inside the function, before the
existing `MAX_PARALLEL_RUNS` concurrency check, add a rate-limit count
query scoped to `userId` + `runMode` + `startedAt` within the last
hour (same shape as `feedback.ts:34-43`), and throw
`TRPCError({ code: "TOO_MANY_REQUESTS", message: "You've started too
many <client-ticked|server-owned> simulations in the last hour — try
again later." })` (wording varies by `runMode` so the message is
accurate) if the count meets or exceeds that mode's threshold: `20`
for `"client"`, `5` for `"server"` — matching the
cost-asymmetry rationale from planning (server-owned runs cost real
compute per call, client-ticked runs don't). Set `runMode` on the
`.insert()` call that creates the row.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Migration generated and applies cleanly: `npm run db:migrate`
- Full suite still passes: `npm test`
- New rate-limit test passes: `npx vitest run src/server/api/routers/simulation.test.ts -t "21st client-mode start"` (the test's actual title, landed in p2 — "rate limit" doesn't literally appear in it)

#### Manual Verification:

- None — the new behavior is fully exercised by the automated test
  above (DB-level counting, same pattern `feedback.test.ts` already
  uses to test its own rate limit).

## Phase 3: Test-auth cookie hygiene

### Overview

Fix the hardcoded `secure: false` to match production cookie standards.

### Changes Required:

#### 1. Make the cookie's `secure` flag environment-aware

**File**: `src/app/api/test-auth/login/route.ts`

**Intent**: If this route were ever accidentally live outside its
documented local-only contract, its own cookie shouldn't be weaker
than the one NextAuth itself would issue.

**Contract**: Change the hardcoded `secure: false` (line 96) to
`secure: env.NODE_ENV === "production"`, matching the same
environment-detection convention Auth.js's own default cookie config
uses (confirmed via research: `secure` auto-true when the resolved URL
is https). Import `env` from `~/env` if not already imported in this
file.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- After deploy, confirm the local E2E suite (which runs against a
  `next start` production build, `NODE_ENV=production`) still signs
  in successfully via the bypass route — `npx playwright test
  authenticated-simulation-run` passing is sufficient confirmation,
  since that suite depends on this exact cookie working.

## Phase 4: Manual CSP verification pass

### Overview

Confirm empirically, against a real running browser, that the CSP
from Phase 1 doesn't break hydration, images, or Radix-styled UI —
closing the two items research flagged as needing verification rather
than grep-confirmed (`style-src 'unsafe-inline'`'s actual necessity,
`img-src`'s `data:` necessity).

### Changes Required:

None — this phase is verification-only. If the manual check below
reveals a genuine break, the fix is a targeted edit to Phase 1's CSP
string in `next.config.js`, not new scope.

### Success Criteria:

#### Automated Verification:

- None — this is specifically the verification static analysis
  cannot perform.

#### Manual Verification:

- After deploy, sign in and visit `/dashboard`, `/simulation` (start
  and stop a run), `/admin/settings` (as an admin), and `/login`
  (signed out) — open the browser console on each and confirm zero
  CSP violation reports.
- Specifically confirm the GitHub avatar in the sidebar renders (not a
  broken image) — proves `img-src avatars.githubusercontent.com` is
  correct.
- Specifically confirm any dropdown/popover (the user menu, a
  Radix-based select in the simulation form) opens and is positioned
  correctly — proves `style-src 'unsafe-inline'` is either necessary
  and present, or was unnecessary and can be removed in a follow-up.

## Testing Strategy

### Unit Tests:

- New test for Phase 2's rate limit, mirroring
  `feedback.test.ts`'s own rate-limit test structure: insert
  N `simulationRuns` rows at the threshold for one `runMode`, confirm
  the next `start`/`startServer` call throws `TOO_MANY_REQUESTS`, and
  confirm the *other* `runMode`'s budget is unaffected (proving the
  two budgets are genuinely separate, not sharing a counter).

### Manual Testing Steps:

1. Phase 4's full manual checklist above.

## Performance Considerations

The new rate-limit check adds one `COUNT` query per `start`/`startServer`
call — negligible, same cost class as the existing
`MAX_PARALLEL_RUNS` check already there.

## Migration Notes

Phase 2's migration adds a `.notNull()` column to a table with existing
production rows — `drizzle-kit generate` will require a backfill
default (`"client"`) for those rows, applied automatically by the
generated migration, not a separate manual step.

## References

- Research: `context/changes/security-hardening-pass/research.md`
- Existing rate-limit pattern to reuse: `src/server/api/routers/feedback.ts:17-50`
- Shared insert helper: `src/server/api/routers/simulation.ts:439` (`insertRunningSimulation`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Security headers including CSP

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 37d5a83
- [x] 1.2 Lint passes: `npm run check` — 37d5a83
- [x] 1.3 Full suite still passes: `npm test` — 37d5a83

#### Manual

- [x] 1.4 Auth gate still works after wrapping middleware.ts (protected-page redirect still happens) — 37d5a83

### Phase 2: Rate limit simulation.start/startServer

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — dd42c9a
- [x] 2.2 Lint passes: `npm run check` — dd42c9a
- [x] 2.3 Migration generated and applies cleanly: `npm run db:migrate` — dd42c9a
- [x] 2.4 Full suite still passes: `npm test` — dd42c9a
- [x] 2.5 New rate-limit test passes: `npx vitest run src/server/api/routers/simulation.test.ts -t "21st client-mode start"` — dd42c9a

### Phase 3: Test-auth cookie hygiene

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck`
- [x] 3.2 Lint passes: `npm run check`
- [x] 3.3 Full suite still passes: `npm test`

#### Manual

- [x] 3.4 Local E2E auth still works: `npx playwright test authenticated-simulation-run`

### Phase 4: Manual CSP verification pass

#### Manual

- [ ] 4.1 Zero CSP violations across dashboard/simulation/admin-settings/login
- [ ] 4.2 GitHub avatar renders correctly
- [ ] 4.3 Dropdown/popover positioning works correctly
