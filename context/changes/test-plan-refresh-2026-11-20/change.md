---
change_id: test-plan-refresh-2026-11-20
title: Add visual-regression risk and rollout phase to test-plan.md
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Add Risk #11 (visual/layout regression on UI-polish changes — caught only by
manual screenshot/DOM inspection 3x this session, including a real bug in
login-page-oauth-polish) and rollout Phase 12 (deterministic screenshot diff
on 2-3 critical screens, with a selective vision-review sub-phase reserved
for the kitchen-sink showcase pages) to context/foundation/test-plan.md.

## Refresh brief (from /10x-test-plan --refresh)

**Trigger**: user asked whether Claude Skills / vision-capable review could
audit visual correctness as part of test coverage, following the
`kitchen-sink-smoke-coverage` change (structural/console-error smoke tests
for 6 kitchen-sink pages, zero visual assertions by design).

**What's stale/missing in the guide**:
- §5 Quality Gates lists "visual diff (deterministic)" as `not wired, not
  planned`, justified as "risk #3/#4 are addressed structurally, not
  visually" — that rationale doesn't cover design-polish regressions
  (colors, spacing, component width), a different failure class.
- §2's risk map has no row for visual/layout regression, despite real
  evidence existing in this project's own history (see below).

**New risk (#11) — challenger-passed**:

| Field | Content |
|---|---|
| Risk | A UI change silently regresses visual/layout correctness (design tokens, spacing, element width/alignment) and merges with nothing catching it |
| Impact | Medium — user-facing polish, not data loss or access-control breakage |
| Likelihood | High — confirmed 3-for-3 this session; one real bug caught only manually |
| Source | Session history: `context/archive/2026-11-20-login-page-oauth-polish/` (sign-in button's `w-full` had no visual effect because the wrapping `<form>` had no width class — caught only via manual DOM-width measurement, no automated check would have caught it); `color-palette-redesign`, `reference-pages-content-update` (both also relied on manual Playwright screenshot verification) |
| What would prove protection | A future token/spacing/width regression on a tracked critical screen is caught without a human eyeballing it |
| Must challenge | Assuming an LLM vision pass is the right tool reflexively — test-plan.md §1 principle #1 forbids layering a vision model on top of a deterministic diff that already catches the same regression. Pixel/token drift is usually deterministically detectable. |
| Likely cheapest layer | Deterministic screenshot diff (Playwright `toHaveScreenshot`) on a small set of critical/showcase screens; vision/LLM review reserved only for judgment calls a pixel diff can't make |
| Anti-pattern to avoid | Snapshotting every page (brittle on routine copy edits — same anti-pattern §2 Risk #10 already warns against); defaulting to vision review instead of the selective 1-3-critical-screen case |

**Proposed rollout Phase 12**: "Visual-regression guard for critical/showcase
screens" — deterministic screenshot baseline on 2-3 screens (`/simulation`
canvas view + the color-token-heavy `/*/kitchen-sink` pages are the obvious
candidates), with an optional vision-review sub-phase reserved for the
showcase pages specifically, since their whole purpose is visual
correctness.

User selected "Accept — open the refresh change" when this brief was
presented.
