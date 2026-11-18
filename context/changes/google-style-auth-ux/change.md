---
change_id: google-style-auth-ux
title: Google-style polish for the GitHub sign-in/sign-out experience
status: implementing
created: 2026-11-18
updated: 2026-11-18
archived_at: null
---

## Notes

User wants the GitHub-OAuth auth *experience* to feel more like Google's
sign-in flow (polished, branded, clear feedback) while keeping GitHub as
the auth server — no provider change, pure UX.

Research already done (see earlier conversation / summarized below) via
an Explore subagent against the current next-auth v5 implementation
(`src/server/auth/config.ts`, `src/app/login/page.tsx`,
`src/components/app-shell.tsx`, `src/middleware.ts`).

Current gaps identified:
- `/login` is a bare gradient page with a hand-rolled button (not the
  shared `Button` component/tokens), no GitHub icon, no loading/pending
  state, no error handling (failed `signIn`/`?error=` falls through to
  Next's generic error boundary).
- No deep-link redirect preservation — always lands on `/dashboard`
  after sign-in regardless of the originally requested page.
- No identity shown anywhere post-login (no avatar/name/email) — sign-out
  is a plain sidebar-footer button with no confirmation, no destructive
  styling, no loading state, and no acknowledgment after it succeeds.

Proposed improvements (cosmetic/UX only, GitHub stays the IdP):
1. Branded, minimal sign-in card using the shared `Button` component +
   design tokens, with a GitHub icon on the CTA.
2. Pending/loading state on sign-in and sign-out buttons.
3. Visible error state using `status-message.tsx` for failed sign-in.
4. Deep-link preservation via `callbackUrl`.
5. Identity surfaced post-login (avatar/name in sidebar), with sign-out
   moved into a user-menu-style control with destructive styling.
6. Sign-out confirmation/acknowledgment.
