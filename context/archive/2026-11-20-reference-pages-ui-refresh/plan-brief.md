# Reference pages modernization pass — Plan Brief

> Full plan: `context/changes/reference-pages-ui-refresh/plan.md`
> Research: `context/changes/reference-pages-ui-refresh/research.md`

## What & Why

`/10x-ui`'s audit of the lowest-drift view group in M-12 found zero token drift but the largest single duplication count in the whole milestone (`LabeledCard`, 25 instances across 3 files) plus a smaller one (`BackLink`, 4 instances), and a genuine content-accuracy gap on the scoring page the user approved fixing in this same change.

## Starting Point

All 5 reference pages already use tokens correctly. `parameters`/`population-lifecycle`/`scoring` each hand-roll an identical title+description card shell; 4 pages hand-roll an identical "Back to Reference" link. `scoring/page.tsx` documents 4 scoring factors; the real formula now has 6 (5 user-visible).

## Desired End State

All cards and back-links render through two new shared components with no visual change. The scoring page accurately lists 5 factors plus a note on the 6th. A kitchen-sink page proves both components' states.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Card extraction | New `LabeledCard` component, not `RunRow`/`AnalysisCard` | Neither existing component's shape fits without overriding most of its base classes. | Research |
| `BackLink` scope | Parameterless component | Always the same href/label — the simplest possible extraction. | Research |
| Scoring content fix | In scope for this change | A real documentation-accuracy bug found during the audit; user explicitly approved fixing it here rather than deferring. | User |
| Content fix scope | Document 5 visible factors + one sentence on the 6th | Matches what `runs/compare`'s own breakdown actually shows users — doesn't invent a chart for the deliberately-hidden 6th factor. | Research |

## Scope

**In scope:** `LabeledCard`/`BackLink` extraction and adoption, the scoring page's factor-count fix, a reference kitchen-sink page.

**Out of scope:** `runs/compare/page.tsx`'s own factor breakdown (archived change, deliberately excludes the 6th factor), phase-color swatches on the population-lifecycle page (an enhancement idea, not a confirmed charge), `reference/page.tsx`'s topic cards (confirmed not a disguised-button violation).

## Architecture / Approach

Three phases, isolating the structural UI extraction from the content fix per explicit user preference, then a states gate.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared component extraction | `LabeledCard` + `BackLink`, 29 call sites total | Low — pure markup move |
| 2. Scoring content fix | Accurate 5-factor description | Low — small, well-sourced content edit |
| 3. States gate | Kitchen-sink page | Low — mirrors an established pattern |

**Prerequisites:** None.
**Estimated effort:** 3 phases, single session each.

## Open Risks & Assumptions

- None — research resolved every material decision with direct evidence before this plan was written.

## Success Criteria (Summary)

- All 5 reference pages render and read correctly, with no visual regression on the 4 pages this change touches.
- The scoring page accurately describes how scores are actually calculated.
- The next agent touching a reference-style card or back-link finds `LabeledCard`/`BackLink` before hand-rolling a 26th/5th copy.
