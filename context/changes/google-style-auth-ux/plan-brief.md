# Google-style auth UX — Plan Brief

> Full plan: `context/changes/google-style-auth-ux/plan.md`

## What & Why

The GitHub-OAuth sign-in/sign-out *experience* feels bare — no icon, no
feedback, no identity shown, no error handling — even though the underlying
auth (next-auth v5 + GitHub) works fine. This plan polishes that experience to
feel closer to Google's sign-in flow, while keeping GitHub as the sole
identity provider.

## Starting Point

`/login` is a plain gradient page with a hand-rolled button and zero error
handling; sign-out is a single unconfirmed click; no user identity (name,
avatar) is shown anywhere in the app post-login; a deep-link redirect always
lands on `/dashboard` regardless of what page the user originally wanted.

## Desired End State

A centered card at `/login` with a GitHub-icon button that shows a pending
state while redirecting; a readable error banner on a failed sign-in; a
deep-linked sign-in returns to the originally requested page; once signed in,
the sidebar shows the user's avatar and name behind a dropdown menu whose
"Sign out" asks for confirmation before it actually signs out.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| GitHub icon source | Inline SVG | No GitHub icon exists in the installed `lucide-react`; avoids a new dependency for one glyph. |
| Error-message UI | New compact `AuthBanner` component | `status-message.tsx` is full-page and wrong for an inline error; this is small and reusable for the sign-out ack too. |
| Post-login identity | Full dropdown user menu (avatar + name) | Directly matches the Google-style pattern asked for; needs new `shadcn` `dropdown-menu`/`avatar` primitives. |
| Sign-out confirmation | Confirm dialog (`alert-dialog`) | User explicitly chose this over the no-confirmation default, trading one extra click for safety against an accidental click. |
| `callbackUrl` handling | Same-origin relative-path only | Fixes the deep-link UX while closing the open-redirect class entirely — the standard safe pattern. |
| Test coverage | Add Playwright E2E, scoped to what's drivable | Real GitHub OAuth can't be driven by Playwright; coverage stops at pre-redirect UI + redirect target, and uses the existing `test-auth` bypass for the authenticated-side UI. |
| `/login` layout | Centered card (not full-bleed gradient) | The single highest-leverage visual change toward the "Google-style" goal. |
| Scope | Everything is must-have, no cut line | User explicitly rejected deferring any of the above pieces. |

## Scope

**In scope:**
- `/login` redesign: centered card, GitHub icon, pending state, error banner, deep-link preservation
- Post-login: avatar/name dropdown menu, sign-out confirm dialog, sign-out pending state, sign-out acknowledgment banner
- New `shadcn` primitives: `dropdown-menu`, `avatar`, `alert-dialog`
- Playwright E2E coverage for all of the above (scoped to what's drivable without real GitHub OAuth)

**Out of scope:**
- Any change to GitHub as the identity provider, or adding other OAuth providers
- Session strategy, schema, RBAC/admin-elevation logic
- Light/dark theme toggle
- A confirmation dialog on sign-in (only sign-out gets one)
- Driving GitHub's real OAuth consent screen from Playwright

## Architecture / Approach

Four phases: (1) add new shared primitives (shadcn components, GitHub icon,
banner) with zero visible change; (2) rebuild `/login` — pure helper functions
for safe-redirect resolution and error-message mapping, unit-tested, feeding a
server-component page with a client pending-state button; (3) add the
post-login `UserMenu` (dropdown + avatar + confirm dialog), threading
`session.user` from the root layout into `AppShell`; (4) Playwright coverage.
Sign-in/out stays 100% Server-Action based throughout — no `next-auth/react`
client hooks are introduced.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared primitives & dependencies | New shadcn components, GitHub icon, banner — no visible change yet | New primitives' default styling might not match this app's tokens out of the box |
| 2. Redesign `/login` | Card layout, icon button, pending state, error banner, safe deep-link redirect | Getting the same-origin validation wrong would reopen an open-redirect risk |
| 3. Post-login identity & sign-out | Avatar/name dropdown menu, confirm dialog, sign-out ack | Nesting the confirm dialog inside the dropdown menu is a known Radix gotcha (see plan's Critical Implementation Details) |
| 4. E2E coverage | Playwright specs for all new UI | Can't drive real GitHub OAuth — coverage must stop at the right boundary without overclaiming |

**Prerequisites:** None — purely additive, no dependency on other in-flight changes.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes the `shadcn@latest add` CLI's generated `dropdown-menu`/`avatar`/`alert-dialog` files need no manual token adjustments — verified at implementation time, not guessed here.
- Assumes next-auth's default error-code set (`OAuthSignin`, `OAuthCallback`, `OAuthCreateAccount`, `Callback`, `AccessDenied`, `Configuration`) is complete enough for this GitHub-only, no-credentials-provider setup; any other code gets the generic fallback rather than a specific message.

## Success Criteria (Summary)

- A user signing in sees a polished, branded card with clear feedback at every step (pending, error) instead of a bare button and silent failures.
- A deep-linked sign-in returns the user to where they actually wanted to go.
- A signed-in user can see who they're logged in as, and can't sign out by accident.
