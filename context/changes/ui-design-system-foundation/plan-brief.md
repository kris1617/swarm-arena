# Shared app shell and extended design tokens — Plan Brief

> Full plan: `context/changes/ui-design-system-foundation/plan.md`

## What & Why

Roadmap F-06, the foundation M-3's entire UI-modernization track depends on. Establishes a shared sidebar-nav shell and finishes the design-token setup this project's `components.json`/`globals.css` already anticipated but never used — the enabler for every page restyle that follows (S-15 through S-20).

## Starting Point

`globals.css` already has a complete, unused shadcn sidebar token set. No `sidebar` component exists yet. `layout.tsx`'s global "Sign out" bar and `login/page.tsx` both use literal hex colors instead of this app's existing token pattern — the two places that never got migrated when the rest of the app adopted tokens.

## Desired End State

Every authenticated page is wrapped in a sidebar-nav shell (Dashboard, Simulation). The login page uses the existing token pattern with proper "Swarm Arena" branding. The browser tab title says "Swarm Arena".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Shell implementation | shadcn/ui's official `sidebar` primitive | The token system already has every `--sidebar-*` variable defined, unused — this finishes a setup that was already started, not a new choice | Plan |
| Mounting point | `RootLayout` (`layout.tsx`), for authenticated sessions only | The one place already shared across every page; login (unauthenticated) stays unwrapped | Plan |
| Scope | Shell + branding only — no page-content restyling | Matches the roadmap's explicit Foundation scope cap; S-16–S-20 restyle each page's own content on top of this | Prior (roadmap F-06) |
| Nav items | Dashboard, Simulation only (the two pages that exist today) | Leaderboard/reference pages don't exist yet — S-19/S-20 add their own nav entries when they ship | Plan |

## Scope

**In scope:**
- Installing shadcn's `sidebar` primitive.
- A new `AppShell` component (sidebar nav + sign-out action).
- Mounting `AppShell` in `RootLayout` for authenticated sessions.
- Fixing `layout.tsx`'s branding metadata (title/description).
- Restyling the login page onto the existing token pattern, with "Swarm Arena" branding.

**Out of scope:**
- Any individual page's internal content restyle (dashboard cards, staging form, charts, tables).
- Dark/light theme toggle.
- Changes to `/` (unmodified scaffold root page).
- Any backend/data/auth logic change.

## Architecture / Approach

Phase 1 builds the primitive and component in isolation (zero visible change). Phase 2 mounts it globally and proves it end-to-end on the login page.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Primitive + component | Sidebar installed, `AppShell` built, metadata fixed | None significant — fully additive, nothing mounted yet |
| 2. Mount + login restyle | Every authenticated page gets the shell; login is rebranded | Must not break any existing page's content while wrapping it in the new shell |

**Prerequisites:** None.
**Estimated effort:** 2 phases, similar scope to other M-1/M-2 foundations.

## Open Risks & Assumptions

- Mounting the sidebar in `RootLayout` visually changes every authenticated page at once (adds persistent nav chrome) — this is the intended, visible payoff of a UI-modernization foundation, not a regression, but it means Phase 2's manual verification must spot-check every existing page, not just the two with nav links.

## Success Criteria (Summary)

- Login is rebranded and token-compliant; every authenticated page gets the sidebar shell with working nav and sign-out.
- No existing page's own functionality regresses.
- The app no longer shows "Create T3 App" anywhere.
