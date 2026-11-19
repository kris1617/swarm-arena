---
change_id: test-plan-refresh-2026-11-18
title: Refresh test-plan.md with a page-level smoke/regression-sweep risk
status: implementing
created: 2026-11-18
updated: 2026-11-18
archived_at: null
---

## Notes

Triggered by `/10x-test-plan --refresh`: all 10 existing rollout phases in
`context/foundation/test-plan.md` are `complete`, but the risk map (§2) is
almost entirely simulation-engine-focused (determinism, perf, concurrency,
ownership) and has no risk for "a page renders a broken/crashed state" or
"a route still serves stale/unintended content" — exactly the bug class
behind 2 of the 3 changes fixed earlier this session.

## Accepted refresh brief

### New Risk (to be added to test-plan.md §2 as Risk #10)

| # | Risk (failure scenario) | Impact | Likelihood | Source |
|---|---|---|---|---|
| 10 | A page/route renders a broken, crashed, or stale/unintended state to a signed-in user (unhandled client-side exception, un-replaced scaffold content, non-functional UI element) — invisible to server logs and the existing unit/integration suite, since both confirmed incidents this session were client-side-only failures that returned HTTP 200 | High | High | user interview Q1–Q4 (2026-11-18); `archive/2026-11-18-root-page-scaffold-redirect/plan.md`; `archive/2026-11-18-admin-settings-range-backfill/plan.md`; `archive/2026-11-18-google-style-auth-ux/plan.md`; hot-spot dirs `src/app/simulation` (41+31 commits/30d), `src/app/login`+`src/server/auth` (12 commits/30d combined) |

### Risk Response Guidance (to be added to test-plan.md §2)

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|---|---|---|---|---|
| #10 | Every one of the product's routes, visited by an authenticated session (plus the unauthenticated-redirect case for protected routes), renders with no client-side console error/exception and no stale placeholder/demo content — verified as observable page state | Assuming "HTTP 200" or "no server error in logs" proves a page works — both confirmed incidents returned 200 with a rendered shell before failing client-side; the existing unit/integration suite structurally cannot see this | Full route list + which are protected/public; whether `tests/e2e/seed.spec.ts`'s auth/storageState setup is reusable for a sweep; whether Playwright console-error/pageerror listeners are already wired anywhere; how to keep the sweep from going silently stale as routes are added | e2e (Playwright) — the only layer that observes real client-side exceptions and rendered DOM state | Asserting only HTTP status code; full-page content snapshots (brittle on routine copy changes) instead of structural landmarks + zero-console-error assertions |

### Proposed rollout phase (to be added to test-plan.md §3 as Phase 11)

| # | Phase name | Goal | Risks covered | Test types |
|---|---|---|---|---|
| 11 | Page-level smoke & regression sweep | Walk every route with an authenticated session, asserting no console/render error and no stale/placeholder content, extending the existing Playwright e2e suite (`tests/e2e/seed.spec.ts`'s auth pattern) rather than a new tool | #10 | e2e |

### Interview record (Phase 2, 2026-11-18)

| # | Question | User answer | Implied risk(s) |
|---|---|---|---|
| 1 | Worries most | "all of the above" — page crashes, stale/unintended content, silent auth-flow breaks | Single combined Risk #10 above |
| 2 | Burned before | "Exactly the 3 incidents from this session" | Same |
| 3 | Change without confidence | "Any page, generally" — not scoped to one feature | Confirms sweep scope is all 14 routes, not simulation-only |
| 4 | Under-tested gap | "extend the scope to all pages based on the existing suites" | Reuse `tests/e2e/seed.spec.ts`/`auth-ux.spec.ts` patterns rather than a new tool |
| 5 | Do NOT spend on | "Nothing — don't skip anything" | No negative-space addition; §7 stays as-is |

### Challenger findings
None dropped — risk is evidence-grounded (happened twice this session, not speculative), carries no file:line anchors, and the response targets exactly what unit/integration tests structurally miss.
