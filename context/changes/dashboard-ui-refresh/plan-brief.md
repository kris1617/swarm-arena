# Dashboard view modernization pass — Plan Brief

> Full plan: `context/changes/dashboard-ui-refresh/plan.md`
> Research: `context/changes/dashboard-ui-refresh/research.md`

## What & Why

`/10x-ui`'s audit of the post-login dashboard found zero token drift but real missing-shared-component drift: a hand-rolled tab-like status filter and ~90%-duplicated Running/Saved/Completed row markup, both accumulated across 6 feature commits since M-3's original restyle with no re-audit since.

## Starting Point

`src/app/dashboard/page.tsx` (239 lines) already uses semantic design tokens correctly everywhere — the hardcoded-value scan found 0 hits. The gap is entirely in reuse: a `Button`-loop filter where this repo's real `Tabs` component (`src/components/ui/tabs.tsx`) applies, and three copy-pasted run-row blocks where one shared component applies.

## Desired End State

The dashboard looks visually identical but is now built from `Tabs` (keyboard-navigable, correct ARIA roles) and a shared `RunRow` component. A kitchen-sink page at `/dashboard/kitchen-sink` proves all 7 states. The agent rules file points the next agent at `RunRow`/`Tabs` before it hand-rolls either again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Status filter component | Adopt `Tabs` in controlled mode | The repo's one existing `Tabs` usage (`simulation/page.tsx`) uses uncontrolled mode, but Radix's controlled `value`/`onValueChange` is a documented, unconstrained capability — confirmed compatible with the filter's existing `useState` model. | Research |
| `RunRow` extraction shape | Props/slots (`leading`, `trailing`, `actionHref`, `actionLabel`), not a conditional-branching component | Confirmed all 3 call sites differ only by composable content, not logic — avoids the "awkward conditional pile" failure mode. | Research |
| `RunRow` placement | `src/components/run-row.tsx` (shared), not inlined in `dashboard/` | Leaderboard (`src/app/leaderboard/page.tsx:53,59-60`) has the identical row shape and is already queued as S-47, this milestone's very next slice — placing it reusably now avoids a second extraction later. | Research |
| Error/empty state fix | Collapse locally, do not extend `StatusMessage` | `StatusMessage`'s only 2 callers are full-page early returns; dashboard's error/empty render inline alongside a still-visible header — forcing a second shape onto `StatusMessage` would serve zero other callers. | Research |
| Visual regression gate | Kitchen-sink page, manual review (no `toHaveScreenshot`) | Matches this repo's own existing precedent (`src/app/simulation/kitchen-sink/page.tsx`) — no screenshot-testing tool is installed, and none is being added for this change. | Plan |

## Scope

**In scope:** `RunRow` extraction, `Tabs` adoption for the status filter, local error/empty dedup, a dashboard kitchen-sink page, an `AGENTS.md` guard note.

**Out of scope:** `leaderboard/page.tsx` (S-47's own change, even though it shares `RunRow`'s shape), extending `StatusMessage`, any data-fetching/business-logic change, adding a screenshot-testing tool.

## Architecture / Approach

Presentation-only refactor in 2 phases. Phase 1 does the extraction/adoption; Phase 2 proves the 7-state matrix and leaves the guard. No new dependencies — `Tabs` and `Checkbox` already exist in `src/components/ui/`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dashboard component refactor | `RunRow` extracted, `Tabs` adopted, error/empty dedup | Low — pure markup move, no new logic, verified line-by-line against the existing render output |
| 2. States gate & guard | Kitchen-sink page, scan re-run, `AGENTS.md` note | Low — mirrors an existing, working pattern in this repo |

**Prerequisites:** None — `Tabs`/`Checkbox` already exist; no new dependency.
**Estimated effort:** 2 phases, single session each.

## Open Risks & Assumptions

- None — research resolved every material decision with direct evidence (component API checks, cross-caller precedent checks) before this plan was written.

## Success Criteria (Summary)

- Dashboard renders and behaves identically to today (filter, rows, error/empty/loading states) from the user's perspective.
- The status filter gains real tab keyboard navigation it didn't have before.
- The next agent touching a run-list row or a filter control finds `RunRow`/`Tabs` in `AGENTS.md` before hand-rolling a third copy.
