# Run-analysis and run-comparison views modernization pass — Plan Brief

> Full plan: `context/changes/runs-analysis-compare-ui-refresh/plan.md`
> Research: `context/changes/runs-analysis-compare-ui-refresh/research.md`

## What & Why

`/10x-ui`'s audit of the highest-drift view group in M-12 found zero token drift but the clearest missing-shared-component case so far: the same title+card shell repeats 10 times across `runs/[runId]` and `runs/compare` alone.

## Starting Point

Both files already use `StatusMessage` correctly and already reference `var(--chart-N)` tokens for every chart color. The gap is pure duplication: 7 instances of an identical `<section>` shell in `runs/[runId]/page.tsx`, 3 more in `runs/compare/page.tsx`.

## Desired End State

Both pages look visually identical but render their cards through a shared `AnalysisCard` component. A kitchen-sink page proves the card's states, adapted since this view has no filter/row interactivity.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Extraction | New `AnalysisCard` component, `title?` + `children` | 10 call sites within 2 files clears this repo's extraction threshold with room to spare — the clearest case in M-12. | Research |
| Placement | `src/components/analysis-card.tsx` | Same convention as `RunRow` — reusable by a future pass on `simulation/page.tsx` or the admin pages, which share the identical shell. | Research |
| Notice-paragraph blocks (compare page) | Stay as-is, no extraction | 4 blocks differ enough in text/className to make extraction a forced, low-value abstraction. | Research |
| States-gate adaptation | Card default/no-title, export-button hover/focus-visible, one representative empty-section example | This view has no filter/rows like dashboard/leaderboard — its real interactive surface is just the export buttons; showing all 6 near-identical empty variants would add no signal. | Plan |

## Scope

**In scope:** `AnalysisCard` extraction, adoption in both files, a runs kitchen-sink page.

**Out of scope:** `runs/compare`'s 4 notice paragraphs, `simulation/page.tsx` and the admin pages (same shell pattern, future change's job), any data-fetching/chart-logic change.

## Architecture / Approach

Presentation-only refactor in 2 phases, mirroring the milestone's established shape. Phase 1 extracts and adopts `AnalysisCard`; Phase 2 proves its states with an adaptation for this view's non-list shape.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Component refactor | `AnalysisCard` extracted + adopted in 10 call sites | Low — pure markup move, no logic change |
| 2. States gate | Kitchen-sink page adapted to this view's surface | Low — mirrors an established pattern with a sensible adaptation |

**Prerequisites:** None.
**Estimated effort:** 2 phases, single session each.

## Open Risks & Assumptions

- None — research resolved the one material decision with direct evidence before this plan was written.

## Success Criteria (Summary)

- Both views render and behave identically to today.
- The next agent touching `simulation/page.tsx` or the admin pages finds `AnalysisCard` available before hand-rolling the same shell a third time.
