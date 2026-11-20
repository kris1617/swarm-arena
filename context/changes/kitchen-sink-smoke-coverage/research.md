---
date: 2026-11-20T13:26:25+01:00
researcher: Claude Sonnet 5
git_commit: b7fc37a73760ff738f672163c2278e4c61d7bf33
branch: master
repository: swarm-arena
topic: "Kitchen-sink page smoke coverage — close the E2E gap left by M-12/M-13's new kitchen-sink pages"
tags: [research, codebase, e2e, testing, kitchen-sink]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: Kitchen-sink page smoke coverage

**Date**: 2026-11-20T13:26:25+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: b7fc37a73760ff738f672163c2278e4c61d7bf33
**Branch**: master
**Repository**: swarm-arena

## Research Question

M-12 and M-13 added 5 new kitchen-sink pages (dashboard, leaderboard, runs, admin, reference) as the visual-states verification surface for their respective UI-refresh changes. The project's E2E page-smoke-sweep (`tests/e2e/page-smoke-sweep.spec.ts`, `test-plan.md` Risk #10 / Phase 11) only covers the older `/simulation/kitchen-sink` page. Should the 5 new pages be added, and if so, exactly how (session/fixture requirements per the project's own established convention)?

## Summary

**Yes — this is a direct, well-scoped coverage gap, not a judgment call.** `test-plan.md §6.11` already documents the exact pattern for adding a route to this sweep, and all 5 new kitchen-sink pages fit its simplest case: static content, reachable by any signed-in user, no admin role or dynamic-id fixture needed — the same category `/admin/elevation` and `/simulation/kitchen-sink` already fall into. All 5 belong in the existing `"page smoke sweep — shared session"` describe block; none need a new describe block, fixture, or session reset.

## Detailed Findings

### Current coverage gap

- `tests/e2e/page-smoke-sweep.spec.ts` (full file read) has exactly 13 route tests. `/simulation/kitchen-sink` (line 75) is covered. None of the 5 kitchen-sink pages M-12/M-13 added are present: `/dashboard/kitchen-sink`, `/leaderboard/kitchen-sink`, `/runs/kitchen-sink`, `/admin/kitchen-sink`, `/reference/kitchen-sink`.
- These 5 pages were all archived as part of M-12's UI-modernization changes (`dashboard-ui-refresh`, `leaderboard-ui-refresh`, `runs-analysis-compare-ui-refresh`, `admin-pages-ui-refresh`, `reference-pages-ui-refresh`) — each one's own plan.md named manual screenshot review as its states-matrix verification gate, but none of those changes added E2E coverage for the page itself (consistent with each plan's own stated scope: a token/component audit, not a testing-strategy change).

### Session/fixture requirements per page (confirmed via direct code read)

All 5 use `"use client"` and render only static, hardcoded content (no data fetching, no admin-role gate, no dynamic id):

| Route | Exact `<h1>` text | Gating | Session/fixture needed |
|---|---|---|---|
| `/dashboard/kitchen-sink` | "Dashboard Kitchen Sink" | Any signed-in session (`src/middleware.ts`'s matcher — no special-case for this path) | None — shared session |
| `/leaderboard/kitchen-sink` | "Leaderboard Kitchen Sink" | Same | None — shared session |
| `/runs/kitchen-sink` | "Runs Analysis Kitchen Sink" | Same | None — shared session |
| `/admin/kitchen-sink` | "Admin Kitchen Sink" | Same — confirmed no admin-role check exists on this specific route (no `layout.tsx` under `src/app/admin/`, no role check in `admin/kitchen-sink/page.tsx` itself, unlike `/admin/settings` which the sweep's existing gated-routes block handles via `signInAsAdminTestUser`) | None — shared session, same category as the existing `/admin/elevation` test |
| `/reference/kitchen-sink` | "Reference Kitchen Sink" | Same | None — shared session |

- `src/middleware.ts`'s matcher (`"/((?!login|api/auth|api/test-auth|_next/static|_next/image|.*\\..*).*)"`) gates every one of these 5 routes identically to every other authenticated page in the app — confirmed no route-specific exemption or additional check exists for any of them.
- `/admin/kitchen-sink/page.tsx`'s own header comment confirms its intent: a visual gate for `NumberField`/`Button`/`Input` styling, reviewed directly (no screenshot tool installed) — it renders unconditionally for any signed-in user, same as `/admin/elevation` (already in the sweep's shared-session block, not the gated block).

### Established pattern to follow (test-plan.md §6.11, already documented)

- Each new test: call `trackConsoleErrors(page)` first, `page.goto()` the route, assert the route's `<h1>` via `getByRole("heading", { name: "<exact text>", level: 1 })` is visible, then assert `tracked.errors` is `[]`.
- All 5 belong in the existing `"page smoke sweep — shared session"` describe block (`page-smoke-sweep.spec.ts:47-163`), reusing the file's default `storageState` — no new describe block, no new fixture, no session reset needed.
- The cookbook explicitly warns: "Never assert full-page content snapshots... a structural landmark plus the zero-console-error assertion is the signal this sweep is for" — this change should not attempt to assert anything about color tokens, button variants, or specific card counts; that level of detail belongs to the manual-verification screenshots each UI-refresh change already performed, not to this smoke sweep.

### Non-finding — `auth-ux.spec.ts` is not stale

- Checked `tests/e2e/auth-ux.spec.ts` (full file read) against S-53's login-page button restyle (`login-page-oauth-polish`, same day): all assertions are role/text-based (`getByRole("button", { name: "Continue with GitHub" })`, `toHaveAccessibleName(/^GitHub Continue with GitHub$/)`) — unaffected by the button's variant/width/icon-swap changes, since the accessible name and visible text are unchanged. No update needed here.

## Code References

- `tests/e2e/page-smoke-sweep.spec.ts:1-233` — the full file; lines 47-163 are the shared-session describe block this change extends.
- `tests/e2e/page-smoke-sweep.spec.ts:75-82` — `/simulation/kitchen-sink`'s existing test, the direct reference pattern for the 5 new ones.
- `context/foundation/test-plan.md` §6.11 — the documented cookbook pattern this change follows exactly.
- `src/middleware.ts:1-43` — confirms uniform session gating across all 5 new routes, no special cases.
- `src/app/dashboard/kitchen-sink/page.tsx:35`, `src/app/leaderboard/kitchen-sink/page.tsx:33`, `src/app/runs/kitchen-sink/page.tsx:31`, `src/app/admin/kitchen-sink/page.tsx:33`, `src/app/reference/kitchen-sink/page.tsx:26` — each page's exact `<h1>` text.

## Architecture Insights

- This confirms a recurring pattern across the whole M-12/M-13 UI-modernization arc: each `/10x-ui`-driven change's own manual-verification gate (screenshots) is deliberately separate from this project's automated E2E smoke layer — by design, per `test-plan.md`'s own cost×signal principle (a kitchen-sink page's job is visual review, not automated assertion of colors/layout). This change closes the *adjacent* gap (does the route render at all, with no client-side exception) without duplicating or replacing that manual-review gate.

## Historical Context (from prior changes)

- `context/archive/2026-11-18-test-plan-refresh-2026-11-18/` (Phase 11, per `git log --follow -- tests/e2e/page-smoke-sweep.spec.ts` and `test-plan.md`'s own "Phase 11 shipped" note) — established this sweep and its `/simulation/kitchen-sink` precedent.
- `context/archive/2026-11-20-dashboard-ui-refresh/`, `.../leaderboard-ui-refresh/`, `.../runs-analysis-compare-ui-refresh/`, `.../admin-pages-ui-refresh/`, `.../reference-pages-ui-refresh/` — the 5 changes that created the kitchen-sink pages this change now covers.

## Related Research

- None — first research document for this change.

## Open Questions

None blocking — the pattern, exact headings, and session requirements for all 5 routes were confirmed by direct code inspection.
