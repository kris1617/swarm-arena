<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Google-style auth UX

- **Plan**: context/changes/google-style-auth-ux/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE (triaged — all 4 findings FIXED; verdict after fixes: SOUND)
- **Findings**: 2 critical, 2 warnings, 0 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

7/7 paths ✓, symbols ✓ (`authorized`, `signOut({ redirectTo })`, `useFormStatus`, `getByRole` E2E convention), brief↔plan ✓.

## Findings

### F1 — resolveSafeRedirect rejects the real callbackUrl next-auth sends

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2, §1 (`resolveSafeRedirect`)
- **Detail**: next-auth's middleware sets `callbackUrl` to `request.nextUrl.href` (`node_modules/next-auth/lib/index.js:177`) — an ABSOLUTE URL (`https://app.example.com/dashboard`), not a relative path. The plan's contract only accepts values starting with `"/"`. Every real deep-link redirect this plan exists to fix would be rejected by its own validator and silently fall back to `/dashboard` — the exact bug this plan is meant to close stays closed. Success criteria 2.8 and E2E test case 3/4 would not actually pass against real middleware behavior, only against a hand-crafted relative-path test input.
- **Fix A ⭐ Recommended**: Derive the expected origin via `headers()` at the call site, pass it into the function
  - Strength: Keeps `resolveSafeRedirect` a pure, explicitly-testable function (origin is a parameter, not read internally) — matches this app's existing proxy-aware-header reasoning (`AUTH_TRUST_HOST`'s own comment in `config.ts`). Accepts same-origin absolute URLs (normalizing to a relative path) in addition to relative ones; still rejects cross-origin.
  - Tradeoff: `/login/page.tsx` must call `headers()` and pass the derived origin in — one extra line at the call site.
  - Confidence: HIGH — `next/headers`' `headers()` is the standard way to read the incoming request's host/`x-forwarded-proto` in a Server Component, and this app already reasons about proxy headers for `AUTH_TRUST_HOST`.
  - Blind spot: Exact precedence of `x-forwarded-host`/`x-forwarded-proto` vs. `host` for this app's actual deploy topology hasn't been re-verified here — same open question `AUTH_TRUST_HOST`'s own comment already lives with.
- **Fix B**: Have `resolveSafeRedirect` call `headers()` internally
  - Strength: Simpler call site — no origin parameter to thread through.
  - Tradeoff: Couples a "pure, unit-testable" function to `next/headers`, which only works inside a request context — the planned direct unit tests would need to mock `next/headers` instead of just passing arguments.
  - Confidence: MEDIUM — works, but fights the plan's own stated goal of a pure, trivially-testable helper.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — origin threaded as a parameter from `headers()` at the call site)

### F2 — Error-code contract doesn't match this app's actual @auth/core behavior

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Current State Analysis; Phase 2 §2 (`resolveAuthErrorMessage`); Phase 2 manual step 2.7; Phase 4 E2E test case 2
- **Detail**: Two problems, confirmed against `node_modules/@auth/core`: (1) the recognized codes (`OAuthSignin`, `OAuthCallback`, `OAuthCreateAccount`, `Callback`) are next-auth v4 legacy names — the installed v5-beta `@auth/core` uses different class-derived types (`OAuthSignInError`, `OAuthCallbackError`, `OAuthAccountNotLinked`, `CallbackRouteError`); `OAuthCreateAccount` doesn't exist as a type at all in this version. (2) `AccessDenied` — the plan's own flagship worked example — doesn't even land on `/login`: since no `pages.error` is configured, `AccessDenied` (`kind: "error"`, not `"signIn"`) redirects to next-auth's own default `/api/auth/error?error=AccessDenied` page instead.
- **Fix A ⭐ Recommended**: Add `pages: { error: "/login" }` to config.ts and fix the recognized-code list
  - Strength: Unifies all error kinds (sign-in AND access-denied) onto the one polished page — closer to the actual "Google-style, consistent error handling" goal than leaving `AccessDenied` on next-auth's bare default page. One line in `config.ts` plus correcting the code list to the real reachable set (`Configuration`, `OAuthAccountNotLinked`, `OAuthCallbackError`, `MissingCSRF`, `AccountNotLinked`, now also `AccessDenied` once routed here).
  - Tradeoff: `@auth/core/index.js:93-105` has an `ErrorPageLoop` guard against configuring an error page that itself requires auth — needs a quick confirmation at implementation time that `/login` not requiring auth avoids tripping it (very likely fine, since `/login` already doesn't require auth today, but worth a 30-second check before relying on it).
  - Confidence: MEDIUM — the redirect-unification behavior is confirmed from source; the `ErrorPageLoop` guard's exact trigger condition wasn't fully traced in this review.
  - Blind spot: Whether any other code path assumes `pages.error` is unset.
- **Fix B**: Leave `AccessDenied` on next-auth's default error page; fix the code list and retarget the example to a code that's actually reachable on `/login` (e.g. `Configuration`)
  - Strength: Zero config.ts changes — smaller diff.
  - Tradeoff: Leaves a real, plausible user-facing error (access denied) landing on an unstyled default page, directly undercutting the plan's own stated goal of visible, polished error handling for failed sign-ins.
  - Confidence: HIGH — straightforward, just narrower in what it actually fixes.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — added `pages.error: "/login"` to config.ts, corrected the recognized-code list to real v5-beta `@auth/core` names)

### F3 — session.user fields are optional (string | null | undefined), not string | null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (`UserMenu`), §4 (`AppShell`)
- **Detail**: `DefaultSession["user"]` declares `name?`/`email?`/`image?` as optional — their type is `string | null | undefined`, not the `string | null` the plan's contracts specify. Passing `session.user` straight into a prop typed exactly `{name: string | null; ...}` is a type error without normalization.
- **Fix**: In `src/app/layout.tsx`, normalize at the boundary — `<AppShell user={{ name: session.user.name ?? null, email: session.user.email ?? null, image: session.user.image ?? null }}>` — before threading into `AppShell`/`UserMenu`, whose contracts already correctly specify `string | null`.
- **Decision**: FIXED

### F4 — "exactly 3 new files, no other side effects" from the shadcn add command is unverified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1
- **Detail**: `npx shadcn@latest add` is network-dependent and templated by this project's `"radix-nova"` style, which isn't cached locally — the exact file list/diff can't be statically confirmed. No new npm dependency is expected (radix-ui's unified package already bundles all three primitives), but the generated `alert-dialog.tsx` may import `buttonVariants` from the existing `button.tsx` (expected, not a problem) — just not literally "3 new files, nothing else touched" as stated.
- **Fix**: Treat the CLI's actual diff as the source of truth when Phase 1 runs, rather than assuming zero side effects beyond the 3 named files.
- **Decision**: FIXED
