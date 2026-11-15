# Reference Documentation Pages — Plan Brief

> Full plan: `context/changes/reference-documentation-pages/plan.md`

## What & Why

Roadmap S-20 / PRD FR-034: four reference/documentation pages — storyline, parameters, population-lifecycle model, scoring metrics — separated from the functional app, not interleaved with it.

## Starting Point

`app-shell.tsx` already reserves a `NAV_ITEMS` slot for this (a code comment names S-20 explicitly). No static/prose page pattern exists yet, but the content itself is already fully specified: the PRD's own Vision/User/Business-Logic sections and `parameter-ranges.ts`'s `DEFAULT_PARAMETER_RANGES` constant.

## Desired End State

A signed-in user opens "Reference" from the sidebar, lands on a small index page, and follows one of four links to read about the simulation's premise, its 13+1 configurable parameters, its five population-lifecycle phases, or its four score factors.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Page structure | One index page + four sub-pages under `/reference/*` | Matches FR-034's "four reference pages," literally, with one clean nav entry point | Plan (made directly — static-content structure, low stakes) |
| Content authorship | Drafted directly from PRD text, not a new design pass | Roadmap S-20 itself already resolved this exact "unknown" | Roadmap |
| Parameters source | Import `DEFAULT_PARAMETER_RANGES` rather than hand-copy the list | Prevents the reference page's numbers from silently drifting from the real admin-configurable defaults | Plan |
| New dependencies | None — no typography plugin, no MDX/CMS | Four short static pages don't justify new tooling; matches every other page's plain-token styling | Plan |
| Nav entry | Single "Reference" link to the index, not four separate sidebar entries | Keeps the sidebar flat, matching Dashboard/Simulation/Leaderboard's one-entry-per-feature pattern | Plan |

## Scope

**In scope:** 5 new static pages (`/reference` + 4 sub-pages), 1 new nav entry, removal of the now-obsolete placeholder comment.

**Out of scope:** any new shared typography/content component, MDX/CMS, search or table-of-contents, public (unauthenticated) access, any change to `parameter-ranges.ts` itself.

## Architecture / Approach

Plain static JSX pages, same `<div>`-root/token-class discipline as every other page in this app. One phase — there's no backend/data layer here, so there's nothing to split a "query" phase from a "UI" phase the way `leaderboard` (S-19) needed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Reference pages + nav wiring | 5 pages + 1 nav entry | Low — static content, no new patterns, content already fully specified by the PRD |

**Prerequisites:** F-06 (shared app shell + tokens) — already done and archived.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Content is a first draft derived from the PRD's planning-document prose, rewritten for a reader rather than for an implementer — the user may want to revise wording after it ships (explicitly anticipated and accepted by the roadmap item itself, not a gap this plan is missing).
- The "Reference" nav entry only highlights as active on `/reference` exactly, not on its four sub-pages — this matches every other nav entry's existing exact-match behavior and is not a new inconsistency introduced here.

## Success Criteria (Summary)

- All five routes load and show distinct, on-topic content.
- The parameters page's 13 defaults are sourced from `DEFAULT_PARAMETER_RANGES`, not hand-copied.
- The sidebar's "Reference" entry is present and reachable.
