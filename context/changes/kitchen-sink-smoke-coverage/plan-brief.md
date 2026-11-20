# Kitchen-sink page smoke coverage — Plan Brief

> Full plan: `context/changes/kitchen-sink-smoke-coverage/plan.md`
> Research: `context/changes/kitchen-sink-smoke-coverage/research.md`

## What & Why

M-12/M-13 added 5 new kitchen-sink pages (dashboard, leaderboard, runs, admin, reference) as the manual visual-review gate for their UI-refresh changes, but none of them have automated E2E coverage. The project's own `test-plan.md` §6.11 already documents the exact pattern to close this gap — this change applies it.

## Starting Point

`tests/e2e/page-smoke-sweep.spec.ts` covers 13 routes including `/simulation/kitchen-sink`, but not the 5 newer ones. All 5 are static content gated only by the standard any-signed-in-user middleware check — same category as the already-covered `/admin/elevation`.

## Desired End State

All 5 kitchen-sink pages get a smoke test in the existing shared-session describe block, each checking a structural heading plus zero console errors — the established pattern, no new fixtures.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Assertion depth | Structural heading + zero console errors only | `test-plan.md` §6.11 explicitly warns against full-page content snapshots; visual detail is already covered by manual screenshot review. | Research |
| Session handling | Shared-session block, no new fixture | All 5 routes are static and gated identically to already-covered routes like `/admin/elevation`. | Research |
| `auth-ux.spec.ts` | Not touched | Its assertions are role/text-based, confirmed unaffected by S-53's button restyle. | Research |

## Scope

**In scope:** `tests/e2e/page-smoke-sweep.spec.ts` — 5 new test blocks.

**Out of scope:** `auth-ux.spec.ts`, any production code, any visual/styling assertion.

## Architecture / Approach

Single phase: 5 near-identical test additions to one existing file, following its own established pattern exactly.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Add the 5 kitchen-sink route tests | Full smoke coverage for all 6 kitchen-sink pages | Low — mechanical application of an already-proven pattern |

**Prerequisites:** None.
**Estimated effort:** 1 phase, single session.

## Open Risks & Assumptions

- None — research resolved every material decision (exact headings, session requirements, assertion scope) before this plan was written.

## Success Criteria (Summary)

- All 18 tests in `page-smoke-sweep.spec.ts` (13 existing + 5 new) pass.
- No regression to the existing suite.
