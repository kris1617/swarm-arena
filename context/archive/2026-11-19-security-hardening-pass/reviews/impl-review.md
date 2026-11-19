<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Security hardening pass

- **Plan**: context/changes/security-hardening-pass/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-19
- **Verdict**: NEEDS ATTENTION (triaged — F1/F2/F3/F5 FIXED, F4 accepted as-is)
- **Findings**: 0 critical, 3 warnings, 2 observations — F1/F2/F3/F5 FIXED, F4 no change needed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `authConfig`'s `authorized` callback comment is now stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/auth/config.ts:143
- **Detail**: The comment ("This is what actually enforces the redirect-to-/login behavior the middleware exists for") is no longer true — `src/middleware.ts` now fully owns the redirect decision via its own custom callback, per NextAuth's dispatch logic (confirmed against `node_modules/next-auth/lib/index.js`: passing a custom middleware callback makes the `authorized` boolean inert unless it returns a `Response`). The callback itself is harmless to leave, but the comment would mislead a future reader into thinking it's still the active gate.
- **Fix**: Update the comment to note that `src/middleware.ts` now owns the redirect decision; this callback only matters for any future `auth()` call shaped as a bare request (none exist today).
- **Decision**: FIXED

### F2 — `"/login"` hardcoded in 3 places with nothing enforcing sync

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:16, src/middleware.ts:38, src/server/auth/config.ts:77
- **Detail**: The matcher's negative lookahead, the inline `pathname !== "/login"` check, and `authConfig.pages.signIn` all independently hardcode `"/login"`. They agree today; nothing keeps them in sync if `pages.signIn` ever changes. Low risk — the matcher exclusion already makes the inline check practically unreachable (requests to `/login` never enter this middleware function).
- **Fix**: Extract to a shared constant (or import `authConfig.pages.signIn` directly in `middleware.ts`) so there's one source of truth.
- **Decision**: FIXED (imported `authConfig.pages.signIn` into a `SIGN_IN_PATH` constant used by both live-logic sites; the matcher's own literal stays static per Next.js's requirement, already low-risk per the finding itself)

### F3 — Rate-limit check lacks the post-insert recheck its sibling concurrency check got

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:463-485 (rate-limit check) vs :538-560 (MAX_PARALLEL_RUNS's own post-insert recheck/rollback)
- **Detail**: Both checks have the identical TOCTOU window (two concurrent calls from the same user can both pass the count-check before either insert lands), but only `MAX_PARALLEL_RUNS` got a post-insert recheck-and-rollback safety net. The new hourly rate-limit check didn't get the same treatment — an inconsistent application of a pattern this exact file already established for exactly this race class.
- **Fix**: Mirror the existing `MAX_PARALLEL_RUNS` post-insert recheck/rollback pattern for the hourly count too, for consistency. Not urgent — impact is bounded (a soft quota, not an authorization boundary; worst case is 1-2 runs over budget from truly-concurrent requests, never unbounded) — a full `db.transaction` (the `admin_settings` treatment) would be the wrong tool here since this is a count-race-across-inserts, not a lost-update-on-one-row bug.
- **Decision**: FIXED

### F4 — CSP `script-src 'unsafe-inline'` weakens XSS mitigation (pre-existing tradeoff, not introduced by this change)

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/lib/security-headers.js
- **Detail**: `'unsafe-inline'` on `script-src` is CSP's main XSS-mitigation value given up — independent of `X-Frame-Options` (clickjacking), which is unaffected. This was an explicit, already-triaged plan decision (no nonce infrastructure exists in this app), not new drift. Worth a follow-up ticket for nonce-based CSP if XSS defense-in-depth matters more later.
- **Fix**: None needed now — already a deliberate, documented tradeoff from planning.
- **Decision**: ACCEPTED (no change — already a deliberate plan decision)

### F5 — Test-auth cookie's `secure` flag only works in E2E because Playwright is Chromium-only

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/app/api/test-auth/login/route.ts
- **Detail**: `secure: env.NODE_ENV === "production"` works for local E2E only because Chromium treats `localhost` as a secure context (accepts a `Secure` cookie over plain HTTP) and `playwright.config.ts` only configures a `chromium` project. If a `firefox`/`webkit` project is ever added, this cookie would silently stop round-tripping there, with a confusing symptom (cookie set, never sent back).
- **Fix**: Add a comment in `route.ts` noting this Chromium-only dependency, so a future contributor adding another browser project doesn't lose time debugging it.
- **Decision**: FIXED
