# Middleware static-asset exclusion Implementation Plan

## Overview

Fix `src/middleware.ts`'s auth-gate matcher so it excludes static files in
`public/` generically (by file extension), not just `favicon.ico` by exact
name — closing a confirmed production bug where any new static file (e.g.
a Google Search Console verification file) gets redirected to `/login`
instead of served.

## Current State Analysis

- `src/middleware.ts:13` — `matcher: ["/((?!login|api/auth|api/test-auth|_next/static|_next/image|favicon.ico).*)"]` excludes exactly 5 named paths plus `favicon.ico` by exact string. Any other file dropped into `public/` (verification files, `robots.txt`, `sitemap.xml`, etc.) is NOT excluded and gets caught by the gate.
- Confirmed live in production (2026-11-18): `curl https://swarmarena.hopto.org/google09b7bdc2b7ba546d.html` returned a 307 redirect to `/login?callbackUrl=...` instead of the file content — this would make Google's Search Console verification crawler see a redirect, not the file, and fail the ownership check.
- No existing test coverage for `middleware.ts`'s matcher at all (confirmed via grep — zero references in any `*.test.ts`).

### Key Discoveries:

- The matcher is a plain array of string patterns on `config.matcher`, importable in isolation without triggering any auth/DB runtime (the module-level `export { auth as middleware }` line re-exports a function but does not invoke it at import time).
- `src/middleware.ts`'s only runtime behavior comes from `auth` itself (`~/server/auth`) — the `config` object is pure, static data, independently testable.

## Desired End State

Any static file served from `public/` (current or future) reaches the
browser directly, without being redirected through the auth gate, while
every actual app route (`/dashboard`, `/simulation`, `/admin/*`, `/runs/*`,
etc.) remains gated exactly as before.

**Verification**: `npm run typecheck`, `npm run check`, `npm test` all pass;
the new unit test proves the matcher excludes static-file-shaped paths and
still gates app routes; a live `curl` against the verification file after
deploy returns its literal content (`200`), not a redirect.

## What We're NOT Doing

- Not touching `next-auth` config, session strategy, or any other part of the auth flow — this is a routing-matcher fix only.
- Not auditing or adding other files to `public/` beyond the verification file already committed in a prior step.
- Not changing how `/api/*` routes other than `api/auth`/`api/test-auth` are gated (unaffected either way, since they never matched a dot-containing path).

## Implementation Approach

One phase: fix the matcher pattern, add a unit test proving both halves
(static files pass through, app routes stay gated), and manually confirm
against the live deployment.

## Critical Implementation Details

**Accepted edge case**: the fix excludes any path whose last segment
contains a literal dot, which also means a dynamic route segment value
containing a dot (e.g. a hypothetical `/runs/1.5`) would bypass the gate.
This app's dynamic segments are numeric run IDs (`/runs/[runId]`) and
never contain dots in practice — accepted as a known, narrow tradeoff of
the standard Next.js "let static assets through" idiom, not something this
plan works around.

## Phase 1: Exclude static files from the auth gate

### Overview

Change the matcher's negative-lookahead group to exclude any path with a
file extension (the standard Next.js middleware idiom), add a unit test,
and verify.

### Changes Required:

#### 1. Middleware matcher pattern

**File**: `src/middleware.ts`

**Intent**: Replace the single-name `favicon.ico` exclusion with a general
"any path with a dot in its last segment" exclusion, so every current and
future static file in `public/` is served directly.

**Contract**: `config.matcher` becomes `["/((?!login|api/auth|api/test-auth|_next/static|_next/image|.*\\..*).*)"]` — `favicon.ico`'s exclusion is now subsumed by the general pattern (dropped as redundant, not kept as dead weight).

#### 2. Regression test

**File**: `src/middleware.test.ts` (new)

**Intent**: Prove the matcher excludes static-file-shaped paths (the
bug's regression case) while still gating real app routes — import
`config` from `~/middleware` directly and test the compiled pattern
against both path classes, no server/auth runtime needed.

**Contract**: `describe("middleware matcher")` with cases covering: static
files pass through (`/favicon.ico`, `/google09b7bdc2b7ba546d.html`,
`/robots.txt`, `/some.file.with.dots.json`); already-excluded named paths
still pass through (`/login`, `/api/auth/callback/github`,
`/api/test-auth/login`, `/_next/static/x.js`, `/_next/image`); app routes
still gated (`/dashboard`, `/simulation`, `/admin/settings`, `/runs/42`,
`/`).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New test passes: `npx vitest run src/middleware.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- After deploy, `curl -s https://swarmarena.hopto.org/google09b7bdc2b7ba546d.html` returns the literal verification string (200), not a redirect to `/login`
- `curl -s -o /dev/null -w "%{http_code}"` against `/dashboard` while signed out still returns a redirect to `/login` (confirms the gate still works for real routes)

## Testing Strategy

### Unit Tests:

- Matcher pattern: static-file paths pass through; named-exclusion paths pass through; app routes still gated. See Phase 1 §2.

### Manual Testing Steps:

1. Deploy, then `curl` the verification file URL directly and confirm it returns the file content, not a redirect.
2. `curl` a protected route (e.g. `/dashboard`) while signed out and confirm it still redirects to `/login` (no regression on the actual auth gate).

## Performance Considerations

None — this is a routing-pattern change with no runtime cost difference.

## Migration Notes

None.

## References

- Confirmed root cause and live reproduction: `context/changes/middleware-static-asset-exclusion/change.md`
- Related prior incident shape (schema/config drift silently breaking prod): `context/deployment/deploy-plan.md`'s "Known gaps" section

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Exclude static files from the auth gate

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run check`
- [x] 1.3 New test passes: `npx vitest run src/middleware.test.ts`
- [x] 1.4 Full suite still passes: `npm test`

#### Manual

- [ ] 1.5 Verification file returns 200 with literal content, not a redirect
- [ ] 1.6 Protected route still redirects to `/login` when signed out
