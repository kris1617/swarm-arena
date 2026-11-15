# Genetic-diversity trend over time — Plan Brief

> Full plan: `context/changes/genetic-diversity-trend/plan.md`

## What & Why

A completed run's analysis view shows only a single final genetic-diversity value today. This reverses the PRD's own "No diversity-index trend over time" Non-Goal — now that the user has asked for it directly — by adding a per-tick diversity series alongside the existing population-over-time chart.

## Starting Point

`computeGeneticDiversity` already exists and takes exactly the input a per-tick call needs, but is only ever called at run-end/read-time. Four other per-tick sample arrays (`cohesionSamples`, `populationCountSamples`, `foodRatioSamples`, `populationDensitySamples`) already establish the exact pattern this slice follows — including, as plan-review caught, the pause/resume snapshot path (server-owned) and the independent client-staged ref-based tracking, both of which the initial draft missed.

## Desired End State

A newly completed run's analysis view shows a second chart — "Genetic diversity over time" — directly below the population chart, with its own axis (0-1 scale). A run completed before this ships simply doesn't show the new chart; nothing crashes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Chart placement | Separate chart below the population chart | Avoids a dual-axis Recharts configuration — population (tens-hundreds) and diversity (0-1) have too large a scale mismatch to share one axis legibly | Plan (user decision) |
| Test strategy for Phase 3 | Extract and test a small pure data-building function, skip component rendering tests | This page has zero existing test coverage (not even the population chart's own inline data-building is tested) — matching that existing scope rather than inventing new component-test infrastructure | Plan |
| Chart color | `--chart-1` for the diversity line's stroke | All 5 tokens are already in use elsewhere on the page, but this is a separate chart so reuse is fine; `--chart-1` is visually distinct from the population line's `--chart-5` | Plan |

## Scope

**In scope:**
- A new `geneticDiversitySamples` per-tick sample array, threaded through both execution paths' finishing logic.
- Backward-compatible read-back (older runs simply lack the field).
- A new, separate chart in the analysis view.

**Out of scope:**
- Changing the existing single final-value display or computation.
- Retroactively backfilling the series for already-persisted runs.
- Any change to the comparison view (`getRunsComparison`).
- A dual-axis or combined chart.

## Architecture / Approach

Mirrors the three existing per-tick sample arrays at every layer: `single-run-lifecycle.ts` computes and appends per tick → `server-run-registry.ts` threads it through `LiveRun` and both finishing paths into the schema-less `history` JSON blob (no migration) → `simulation.ts`'s `getRunAnalysis` returns it with the same optional-field backward-compat guard → `page.tsx` renders it as a second, independent Recharts `LineChart`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Per-tick sample mechanism and persistence | `geneticDiversitySamples` computed and persisted on both execution paths, including the server-owned pause/resume snapshot | Low — mirrors 4 existing precedents exactly; plan-review caught 2 missing sites (resume path, client-staged path) before implementation |
| 2. Router read-back guard | `getRunAnalysis` returns the new field, backward-compatible | Low — same optional-field pattern already used 3 times |
| 3. Analysis-view chart | New chart renders, degrades gracefully for older runs | Low — but this page has zero prior test coverage, so Phase 3's automated check is narrower than the other two phases by necessity |

**Prerequisites:** None.
**Estimated effort:** ~3 phases, smaller than S-27/S-29 (single sample array, no new mutation mechanism, no new tRPC procedure).

## Open Risks & Assumptions

- `page.tsx` has no existing test file; Phase 3's automated coverage is a new, small pure-function test rather than a full component test — manual verification is the primary signal for the chart's actual rendering.

## Success Criteria (Summary)

- A user sees, in a completed run's analysis view, a genetic-diversity trend chart — not just the final value — for any run completed after this ships.
- Older runs' analysis views are unaffected (no error, no misleading empty chart).
