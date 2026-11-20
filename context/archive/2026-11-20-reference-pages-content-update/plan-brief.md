# Reference pages content accuracy update — Plan Brief

> Full plan: `context/changes/reference-pages-content-update/plan.md`
> Research: `context/changes/reference-pages-content-update/research.md`

## What & Why

Research found the parameters page's own code comment defers documenting 14 real per-tribe/predator-tribe fields (plus 2 toggles) to "Phase 8" — but that UI shipped and archived 2026-11-18. It also found the scoring page's genetic-diversity description is accurate but doesn't caveat how tribes/crossbreeding change what the number means. The storyline and population-lifecycle pages were confirmed already accurate — not touched.

## Starting Point

`parameters/page.tsx` documents 16 top-level fields; its own comment says per-tribe fields "belong with Phase 8's tabbed per-tribe UI, not this generic reference page" — a claim that's now false. `scoring/page.tsx`'s "Genetic diversity" card (fixed for factor-count by the sibling S-50 change) still doesn't mention that the pooled metric conflates within-tribe variation with inter-tribe separation.

## Desired End State

The parameters page documents all 30 configurable fields that exist today (16 top-level, 9 boid per-tribe, 5 predator-tribe, 2 toggles), with the stale comment removed. The scoring page's genetic-diversity card carries one precise caveat sentence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Per-tribe doc depth | Full card-per-field, matching existing format | Admin ranges are identical across every tribe of a type, so the existing card shape applies with no per-tribe-index variation to represent. | User + Research |
| Toggle placement | Own small subsection after the ranged cards | Keeps the ranged cards visually consistent (all have Range/Default) while still documenting the 2 non-ranged toggles completely. | User |
| GD caveat | Add one sentence on tribe/crossbreeding interaction | Directly addresses research's finding that a declining score could be misread as "losing diversity" when tribes are just blending. | User |

## Scope

**In scope:** `parameters/page.tsx` (14 new field cards + 2 toggle cards + stale-comment removal), `scoring/page.tsx` (one new sentence).

**Out of scope:** `storyline/page.tsx`, `population-lifecycle/page.tsx` (confirmed already accurate), `runs/compare/page.tsx`'s factor breakdown (separate archived change's deliberate design), any numeric range/default value change.

## Architecture / Approach

Two phases: the larger structural content addition (parameters page) first, then the small, independent precision fix (scoring page) second — mirroring the sibling `reference-pages-ui-refresh` change's successful split.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Parameters page per-tribe section | 14 ranged-field cards + 2 toggle cards + stale comment removed | Low — pure content addition, no logic change |
| 2. Scoring page genetic-diversity caveat | One precise caveat sentence | Low — single-sentence content edit |

**Prerequisites:** None.
**Estimated effort:** 2 phases, single session each.

## Open Risks & Assumptions

- None — research and the planning interview resolved every material decision before this plan was written.

## Success Criteria (Summary)

- The parameters page documents every one of the 30 configurable fields that exist in the current schema, with no stale claims about what's "not built yet."
- The scoring page's genetic-diversity description correctly scopes what the number means for multi-tribe, crossbreeding-enabled runs.
