# Security hardening pass — Plan Brief

> Full plan: `context/changes/security-hardening-pass/plan.md`
> Research: `context/changes/security-hardening-pass/research.md`

## What & Why

Close three defense-in-depth gaps found by a full security audit: no
security HTTP headers anywhere (including no CSP), no rate limiting on
starting simulations, and a cookie-hygiene gap in the local-only
test-auth bypass route. No CRITICAL/HIGH finding exists in this
codebase — the audit confirmed the two incidents fixed earlier this
session were the real holes, and they're closed. This is additive
hardening, not an incident response.

## Starting Point

`next.config.js`, `Caddyfile`, and `src/middleware.ts` set zero
security headers. `simulation.start`/`startServer` have only a
concurrency cap (`MAX_PARALLEL_RUNS`), no request-rate limit —
`feedback.ts` already has a working rate-limit pattern this plan
reuses. The test-auth route's cookie hardcodes `secure: false`.

## Desired End State

Every response carries 5 security headers (including a CSP that
doesn't break hydration, images, or Radix UI styling, verified
empirically). `simulation.start` and `startServer` are each separately
rate-limited per user per hour. The test-auth cookie matches
production hygiene.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| CSP scope | Full CSP, not just the 4 low-risk headers | User chose to close the larger gap now rather than defer | Plan interview |
| script-src | `'unsafe-inline'`, not nonce-based | No nonce infrastructure exists in `src/middleware.ts` today; adding it risks the auth-gate logic that already lives in that file | Plan interview |
| Rate-limit threshold | 20/hour `start`, 5/hour `startServer`, separate budgets | Reflects the real cost asymmetry — `startServer` runs real compute per call | Plan interview |
| On limit exceeded | Clear `TOO_MANY_REQUESTS` with a specific message | Matches this project's existing TRPCError-banner UX convention; the threshold isn't a secret worth hiding | Plan interview |
| HSTS | `max-age=31536000; includeSubDomains` | Standard baseline; no subdomains exist today to break | Plan interview |
| Rate-limit implementation | New `runMode` column on `simulationRuns`, reusing `feedback.ts`'s DB-counted pattern | `start`/`startServer` share one insert helper with no existing way to distinguish them; a dedicated rate-limit library would be inconsistent with this project's established pattern | Plan |
| `runMode` column default | `.default("client")` in the schema, not an interactive drizzle-kit prompt | Plan-review F1: every prior NOT NULL column in this project's migration history pairs with a schema-level default; drizzle-kit has no non-interactive flag for supplying one otherwise | Plan review |
| Middleware-issued responses | Also wrap `src/middleware.ts` to attach the same headers, not just `next.config.js` | Plan-review F2: `headers()` doesn't cover redirects middleware itself issues; user chose to close the gap fully over scoping it out | Plan review |

## Scope

**In scope:** 5 security headers (CSP + 4 others), per-mutation rate limiting on simulation start, the test-auth cookie fix, a dedicated manual CSP-verification pass.

**Out of scope:** nonce-based CSP, changing `MAX_PARALLEL_RUNS`, a generic rate-limiting library, the 4-8 moderate npm audit advisories (confirmed dev-tooling-only, don't reach production).

## Architecture / Approach

`next.config.js`'s `headers()` function for Phase 1 (zero schema
impact, independently testable). A new `simulationRuns.runMode` column
+ migration for Phase 2, threaded through the single shared
`insertRunningSimulation` helper both mutations already call. A
one-line environment check for Phase 3. Phase 4 is pure manual
verification against a real browser — CSP correctness can't be fully
confirmed by static analysis.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Security headers + CSP | 5 headers, incl. CSP, applied via both `next.config.js` and a wrapped `src/middleware.ts` | `style-src`/`img-src` correctness not grep-confirmed (deferred to Phase 4); wrapping middleware.ts touches the app's load-bearing auth gate, mitigated by only touching the response, not the auth decision |
| 2. Rate limit start/startServer | New column + migration + dual-threshold check | `.notNull()` column on a table with existing production rows — migration needs a backfill default |
| 3. Test-auth cookie fix | Environment-aware `secure` flag | None — one-line change, verified by existing E2E auth tests |
| 4. Manual CSP verification | Confirms Phase 1 doesn't break the app | None — pure verification, no new code |

**Prerequisites:** None.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- `style-src 'unsafe-inline'` is included as a precaution based on
  Radix UI's known inline-style usage, not a grep-confirmed
  requirement — Phase 4 either confirms it's needed or reveals it can
  be tightened in a future pass.
- The production DB migration for Phase 2 touches a table with live
  rows (confirmed earlier this session: the production `simulationRuns`
  table now has at least one real row, from the
  `simulation-start-button-not-submitting` fix's own manual
  verification) — the backfill default (`"client"`) is correct for
  every row created before this phase, since `startServer` support
  predates this phase but the rate-limit distinction itself didn't
  exist until now.

## Success Criteria (Summary)

- Every response carries all 5 security headers; zero CSP violations
  across the app's main flows.
- `simulation.start`/`startServer` each enforce their own separate
  hourly budget.
- The test-auth route's cookie matches production hygiene.
