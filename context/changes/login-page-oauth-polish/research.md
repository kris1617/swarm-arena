---
date: 2026-11-20T12:14:54+01:00
researcher: Claude Sonnet 5
git_commit: b9691deb30ca800366bde8b5adcb41a47665a3cf
branch: master
repository: swarm-arena
topic: "Login page OAuth polish (S-53, M-13) — redirect-visibility investigation and provider-login styling"
tags: [research, codebase, login, oauth, nextauth, ui]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: Login page OAuth polish

**Date**: 2026-11-20T12:14:54+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: b9691deb30ca800366bde8b5adcb41a47665a3cf
**Branch**: master
**Repository**: swarm-arena

## Research Question

The user wants the login page restyled to look like a modern provider-login screen (matching the "Continue with Google/Microsoft" visual pattern) and wants the reported gap — "I do not see redirection in browser address line" during the OAuth flow — investigated and fixed if real.

## Summary

**The redirect-visibility gap could not be reproduced — direct browser testing confirms the redirect works correctly and does update the address bar.** Clicking the sign-in button triggers a genuine, full external browser navigation to `github.com`, confirmed by Playwright's own page-URL readout changing from `http://localhost:3000/login` to a `https://github.com/login?client_id=...` URL. No rewrite, proxy, or client-side interception masks this (confirmed via `next.config.js`). The most plausible explanation for the user's report: when GitHub already has an active session and has already authorized this OAuth app for a prior sign-in, GitHub skips its consent screen entirely and redirects straight back to the callback URL — the whole round trip can complete fast enough that it doesn't register as "redirection" to the user, even though the address bar genuinely does change twice (out to GitHub, back to the app). This is a UX-perception question, not a missing-redirect bug — `/10x-plan` should decide whether any visual reinforcement is worth adding (e.g., a brief transition state) given this finding.

Separately, the current sign-in button is already partway toward a provider-login pattern (GitHub icon + "Continue with GitHub" text, pending state showing "Redirecting…"), but uses the app's branded `variant="default"` (solid `bg-primary`) styling rather than the neutral/bordered button style Google's and Microsoft's own "Continue with X" buttons use — a concrete, actionable styling gap.

## Detailed Findings

### Charge 1 — Redirect-visibility: not reproduced, root cause is almost certainly perceived speed, not a missing redirect

- Direct test (production build, Playwright): navigated to `/login`, clicked the "Continue with GitHub" button. Playwright's own `Page URL` readout changed to `https://github.com/login?client_id=Ov23likkV6Axvfq2Cqpy&return_to=%2Flogin%2Foauth%2Fauthorize%3F...&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback%2Fgithub&response_type=code&scope=read%3Auser+user%3Aemail` — confirming a genuine full-page external navigation occurred, which in a real browser updates the address bar.
- `src/app/login/page.tsx:41-53` — the button lives in a server action form (`action={async () => { "use server"; ... await signIn("github", { redirectTo }); }}`). NextAuth v5's `signIn()` (via `src/server/auth/index.ts`'s `NextAuth(authConfig)` factory) issues a Next.js `redirect()` to the provider's authorize URL from inside the server action — for an external origin, Next.js performs a full browser navigation (not a client-side router transition), which is exactly what the Playwright test observed.
- `next.config.js` has no `rewrites`/`redirects` that touch `/login`, `/api/auth/*`, or any proxying that could mask the external hop; the one auth-adjacent config note (forwarded-host handling for the reverse-proxy deployment) only affects how URLs are *constructed*, not whether navigation is visible.
- `src/middleware.ts`'s matcher explicitly excludes `login` and `api/auth` from its gate (`"/((?!login|api/auth|api/test-auth|_next/static|_next/image|.*\\..*).*)"`), so no middleware intercepts the sign-in or callback requests either.
- **Most plausible explanation for the user's report**: GitHub's own OAuth flow skips the consent/approval screen when the user already has an active GitHub session and has previously authorized this app — in that case the browser is redirected to github.com and immediately back, both legs completing fast enough (sub-second on a fast connection) that a user watching the page, not the address bar specifically, may perceive "nothing happened" rather than "two redirects happened quickly." This is a perception/timing question, not a code defect — this research did not find any code path that suppresses or fakes the navigation.
- Not independently verified in this sandbox: the inbound leg (GitHub → `/api/auth/callback/github` → `/dashboard`) could not be completed end-to-end without real GitHub credentials. The outbound leg (the one directly reachable from `/login`) is the one the user's complaint is phrased around ("during the OAuth flow"), and that leg is confirmed working.

### Charge 2 — Sign-in button doesn't yet match the "Continue with Google/Microsoft" visual convention

- `src/app/login/_components/sign-in-button.tsx:7-16` — already has the right *shape* (provider icon + "Continue with GitHub" text, a disabled "Redirecting…" pending state via `useFormStatus()`), but uses `<Button size="lg">` with no `variant` prop, which resolves to `variant="default"` — `src/components/ui/button.tsx:11`: `bg-primary text-primary-foreground hover:bg-primary/80`, a solid branded-color button.
- Google's and Microsoft's own "Continue with X" buttons (and the common web convention third-party sign-in buttons imitate) use a neutral, bordered, near-white/background-colored button with the provider's own logo supplying the only brand color — not the host app's primary brand color. `button.tsx:12-13`'s existing `variant="outline"` (`border-border bg-background hover:bg-muted hover:text-foreground`) is structurally the closer match already available in this codebase's own component.
- `src/app/login/page.tsx:30-35` — the surrounding card (`bg-card border-border ... rounded-xl border p-8 shadow-sm`, `max-w-sm`) is already a reasonably standard centered-card login layout; the gap is specifically the button's color treatment, not the overall page structure.
- `src/components/icons/github-icon.tsx` exists and is already used — no new icon asset needed for a GitHub-specific "continue with" button.

## Code References

- `src/app/login/page.tsx:1-57` — full login page, server action, redirect-safety handling (`resolveSafeRedirect`).
- `src/app/login/_components/sign-in-button.tsx:1-16` — the button component to restyle.
- `src/server/auth/config.ts:1-116` — full NextAuth v5 config (database-session strategy, GitHub provider, `pages.signIn`/`pages.error` both `/login`).
- `src/server/auth/index.ts:1-5` — `NextAuth(authConfig)` factory exporting `signIn`.
- `src/middleware.ts:1-43` — confirms `/login`/`/api/auth` are excluded from the auth gate.
- `next.config.js:1-30` — confirms no rewrite/redirect masks the OAuth hop.
- `src/components/ui/button.tsx:6-41` — `buttonVariants`, including the `outline` variant closer to a provider-login convention.

## Architecture Insights

- This project's root layout (`src/app/layout.tsx:25-39`) only wraps children in `AppShell` when a session exists — `/login` (always unauthenticated) renders its own `<main>` directly, so the existing root `<main>` landmark on `login/page.tsx:30` is NOT a duplicate-landmark violation of AGENTS.md's rule (that rule is about pages rendered *inside* `AppShell`'s own `SidebarInset`, which already provides one `<main>`) — confirmed by reading the root layout's conditional rendering, not assumed from the rule's general wording.
- The redirect mechanism here (server action → `signIn()` → Next.js `redirect()` to an external origin → full browser navigation) is the officially-documented NextAuth v5 App Router pattern, not a custom/fragile one — so any plan addressing the perceived-speed finding should treat it as a UX/timing question (e.g., whether to add a visible transition cue) rather than a mechanism to rebuild.

## Historical Context (from prior changes)

- `context/archive/2026-11-14-branded-login-page/` (S-15) — the login page's branding (text, colors, favicon) was last touched here; no OAuth-flow or redirect-visibility work was done as part of that change.
- `context/archive/2026-11-19-security-hardening-pass/` — added `src/middleware.ts`'s security-header wrapping around `auth()`; confirmed (this research) that it does not affect `/login` or `/api/auth` traffic.

## Related Research

- None — first research document for this change.

## Open Questions

1. **Should anything be added to visually reinforce the redirect is happening**, given the likely root cause is "it completes too fast to notice," or is the existing "Redirecting…" pending-button text sufficient? — Owner: user, via `/10x-plan`. Block: no.
2. **Exact button styling for the provider-login look** — switch to the existing `variant="outline"`, or a new bespoke style? `/10x-plan`'s interview should confirm which, since research found `outline` as the closest existing match but didn't evaluate every visual detail (e.g., whether the GitHub icon should be colored/monochrome in the new style). — Owner: user, via `/10x-plan`. Block: no.
