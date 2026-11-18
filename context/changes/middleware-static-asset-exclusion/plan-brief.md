# Middleware static-asset exclusion — Plan Brief

> Full plan: `context/changes/middleware-static-asset-exclusion/plan.md`

## What & Why

`src/middleware.ts`'s auth-gate matcher excludes `favicon.ico` by exact
name but no other static file — so the Google Search Console verification
file just added to `public/` gets redirected to `/login` instead of
served, confirmed live via `curl` against production. This fixes the
matcher generally so every current and future static file in `public/`
is served directly.

## Starting Point

The matcher is a 5-item named exclusion list plus one hardcoded filename.
Any new file dropped into `public/` (verification files, `robots.txt`,
`sitemap.xml`) silently breaks the same way, one file at a time, until
someone notices.

## Desired End State

Any static file in `public/` reaches the browser directly, with zero
per-file matcher edits ever needed again; every real app route stays
gated exactly as before.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Exclusion strategy | Match by file extension (any dot in the last path segment), not by name | Standard Next.js idiom — closes the whole bug class instead of fixing one file at a time. |
| Dynamic-route edge case | Accepted as a known tradeoff, not worked around | This app's dynamic segments (numeric run IDs) never contain literal dots in practice. |
| Test approach | Pure unit test on `config.matcher`, no server/auth runtime | Cheapest layer that gives real signal — the matcher is static data, independently testable. |

## Scope

**In scope:** The matcher pattern fix, a regression test, manual confirmation against the live deployment.

**Out of scope:** Any other part of the auth flow; auditing/adding more files to `public/`.

## Architecture / Approach

One phase: change `config.matcher`'s negative-lookahead group from naming
`favicon.ico` to a general "has a file extension" pattern, add a unit
test proving both static-file-passthrough and app-route-gating still
work, then confirm live.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Exclude static files from the auth gate | Fixed matcher + regression test | A dynamic route segment containing a literal dot would also bypass the gate — accepted, doesn't apply to this app's actual routes |

**Prerequisites:** None.
**Estimated effort:** Single phase, well under a session.

## Open Risks & Assumptions

- Assumes no current or future dynamic route segment in this app will ever contain a literal dot in its path value — true today (numeric run IDs only).

## Success Criteria (Summary)

- Any file in `public/` is reachable directly by URL, signed out or in.
- Protected app routes are still gated exactly as before.
