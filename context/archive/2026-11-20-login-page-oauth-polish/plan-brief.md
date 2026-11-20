# Login page OAuth polish — Plan Brief

> Full plan: `context/changes/login-page-oauth-polish/plan.md`
> Research: `context/changes/login-page-oauth-polish/research.md`

## What & Why

The user wanted the login page restyled to look like a modern provider-login screen and the reported "no visible redirect" gap investigated. Research found the button already has the right shape (icon + "Continue with GitHub" + pending state) but uses the app's branded solid-purple color instead of the neutral/bordered style Google/Microsoft's own buttons use — and confirmed, via direct browser testing, that the redirect itself already works correctly and updates the address bar.

## Starting Point

`SignInButton` uses `<Button size="lg">` (defaults to `variant="default"`, solid `bg-primary`). The login card is `max-w-sm`. Research found no code defect in the OAuth redirect mechanism — clicking the button genuinely navigates the browser to `github.com`.

## Desired End State

The button is a full-width, neutral/bordered (`outline` variant) button with a spinner added to its existing pending state. The card is modestly wider (`max-w-md`) to fit the full-width button. No change to the OAuth mechanism — it already works.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Redirect gap | No mechanism change; add a spinner as a UX reinforcement | Research found no defect — the perceived-speed explanation doesn't warrant rebuilding a working redirect, but a spinner cheaply strengthens the existing cue. | User + Research |
| Button style | Full-width `outline` variant | Closest existing match to the Google/Microsoft "Continue with X" convention; no new component needed. | User + Research |
| Icon treatment | Keep `GitHubIcon` as-is | Already monochrome, already adapts to the new button variant's foreground color automatically. | User |
| Card width | `max-w-sm` → `max-w-md` | Gives the full-width button breathing room; a standard, modest Tailwind step. | User |

## Scope

**In scope:** `src/app/login/_components/sign-in-button.tsx` (variant, width, spinner), `src/app/login/page.tsx` (card width).

**Out of scope:** the OAuth provider (still GitHub only), the redirect/sign-in mechanism (`signIn()`, `authConfig`, `middleware.ts`) — confirmed already working, not touched.

## Architecture / Approach

Single phase: 2 small presentational files, no logic change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Restyle the login page | Full-width outline button + spinner, wider card | Low — presentational only, reuses an existing Button variant and an already-installed icon library |

**Prerequisites:** None.
**Estimated effort:** 1 phase, single session.

## Open Risks & Assumptions

- None — research and the planning interview resolved every material decision before this plan was written.

## Success Criteria (Summary)

- The login button visually matches the "Continue with X" provider-login convention.
- The spinner/text pending-state swap works correctly.
- The underlying OAuth redirect still works after the restyle (regression check, not new territory).
