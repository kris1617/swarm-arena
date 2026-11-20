---
date: 2026-11-20T08:52:27+01:00
researcher: Claude Sonnet 5
git_commit: 63430c38878565c47027fef9736e8c6de38ff56d
branch: master
repository: swarm-arena
topic: "/10x-ui audit of the reference pages (S-50, M-12 UI modernization pass)"
tags: [research, codebase, reference, ui, design-system, labeled-card, back-link, scoring-content]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the reference pages

**Date**: 2026-11-20T08:52:27+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 63430c38878565c47027fef9736e8c6de38ff56d
**Branch**: master
**Repository**: swarm-arena

## Research Question

`/10x-ui`'s pre-audit on the 5 reference pages (`reference/page.tsx`, `storyline/page.tsx`, `parameters/page.tsx`, `population-lifecycle/page.tsx`, `scoring/page.tsx`) — the lowest-drift view group in M-12 — found 0 hardcoded-value hits but a repeated card shell across 3 files, a repeated back-link across 4 files, and (outside `/10x-ui`'s own scope, but user-approved to fix in this change) a content-accuracy gap on the scoring page.

## Summary

**2 UI charges confirmed, both INCLUDE**, plus **1 user-approved content fix**:

1. **INCLUDE** — extract a shared `LabeledCard` component for the repeated `<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4">` title+description shell, which appears identically in `parameters/page.tsx` (16 instances, one per `TOP_LEVEL_RANGED_PARAMETER_NAMES` entry), `population-lifecycle/page.tsx` (5 instances), and `scoring/page.tsx` (4 instances) — 25 instances across 3 files, the largest single duplication count found in any M-12 audit.
2. **INCLUDE** — extract a shared `BackLink` component for the repeated `<Link className="text-foreground hover:text-muted-foreground underline" href="/reference">← Back to Reference</Link>`, identical across `storyline/page.tsx`, `parameters/page.tsx`, `population-lifecycle/page.tsx`, and `scoring/page.tsx` — 4 instances across 4 files.
3. **User-approved content fix** (outside `/10x-ui`'s own scope, but explicitly approved for this change) — `scoring/page.tsx` says scoring is "the product of four factors" and lists exactly 4 (`Survival duration`, `Food management`, `Genetic diversity`, `Phase quality`). The actual `computeScore` function (`src/server/simulation/boids.ts`) multiplies **6** terms: `elapsedTicks`, `resourceManagement`, `geneticDiversity`, `phaseQuality`, `areaPopulationDensity` (added by the archived `area-aware-population-insight`/S-25), and `predatorTribeBalance` (added by the archived `second-predator-tribe-prey-target`/S-43). Of these, the run-comparison UI (`runs/compare/page.tsx`'s `FACTOR_LABELS`) deliberately surfaces only 5 as a breakdown (confirmed by S-43's own plan: "No analysis-view/genetic-diversity integration — the new 6th factor appears in the final score the same way every other factor does, with no new chart/breakdown UI" — a deliberate choice, not a bug in that file). The reference page should be corrected to match the 5-factor breakdown users can actually see, with one added sentence noting the 6th (predator-tribe balance) factor also multiplies in in multi-tribe runs, for completeness without overcomplicating the primary explanation.

## Detailed Findings

### Charge 1 — `LabeledCard` shared component

- `src/app/reference/parameters/page.tsx:82-95` — 16 instances (one per `TOP_LEVEL_RANGED_PARAMETER_NAMES` entry) of `<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4">` containing a bold title span, a description span, and a muted-small range/default span.
- `src/app/reference/population-lifecycle/page.tsx:54-64` — 5 instances of the identical shell containing a bold title span and a description span (no 3rd line).
- `src/app/reference/scoring/page.tsx:35-45` — 4 instances of the identical shell, same 2-line shape as population-lifecycle.
- None of this shape matches an existing shared component: `RunRow`/`AnalysisCard` are both structurally different (different container element, different gap/padding, different slot composition) — forcing either to fit here would need overriding most of its base classes, defeating the point. A new, purpose-built component is the right call here, following the same placement convention (`src/components/`) as `RunRow`/`AnalysisCard`.
- Confirmed composable, not conditional: each instance differs only in title text, a required description line, and an optional 3rd line (parameters' range/default). A `LabeledCard({ title, children })` taking the description + optional extra line as `children` (matching the `AnalysisCard`/`RunRow` precedent of a `children`/slot-based API) covers all 25 instances without branching inside the component itself.

### Charge 2 — `BackLink` shared component

- `src/app/reference/storyline/page.tsx:40-45`, `parameters/page.tsx:100-105`, `population-lifecycle/page.tsx:68-73`, `scoring/page.tsx:70-75` — 4 byte-identical instances of `<Link className="text-foreground hover:text-muted-foreground underline" href="/reference">← Back to Reference</Link>`.
- Smaller than Charge 1 but still meets this repo's observed extraction threshold (3+ call sites, composable) — and unlike the dashboard/leaderboard status-card case (which stayed local because the ceiling was confirmed at exactly 2 instances), this one spans 4 files with a literally identical, zero-variation call site, making a shared component a clean, low-risk extraction with no props needed beyond none (it's parameterless — always links to `/reference` with the same label).

### Non-charge — `reference/page.tsx`'s topic-link cards

- `src/app/reference/page.tsx:38-47` — the index page's 4 topic cards use `rounded-2xl` (not `rounded-full`), so `AGENTS.md`'s "button-styled link needs `Button asChild`" rule does not apply here — this is a legitimate card-link pattern, not a disguised button. No charge.

### User-approved content fix — scoring page under-counts factors

- `src/app/reference/scoring/page.tsx:3-21,29-31` — `FACTORS` array has exactly 4 entries; the page text says "the product of four factors."
- `src/server/simulation/boids.ts:2423-2451` (`computeScore`) multiplies 6 arguments: `elapsedTicks`, `resourceManagement`, `geneticDiversity`, `phaseQuality`, `areaPopulationDensity`, `predatorTribeBalance`. The function's own comment confirms: "the real five-factor formula (S-25 added the 5th, areaPopulationDensity)... widened to a 6th argument, `predatorTribeBalance`."
- `src/app/runs/compare/page.tsx:17-23` (`FACTOR_LABELS`) exposes exactly 5 of the 6 as a user-visible breakdown (`survival`, `resourceManagement`, `geneticDiversity`, `phaseQuality`, `areaPopulationDensity`) — `predatorTribeBalance` is deliberately NOT broken out, per `context/archive/2026-11-18-second-predator-tribe-prey-target/plan.md:79-80`'s own stated scope ("No analysis-view/genetic-diversity integration... with no new chart/breakdown UI, mirroring F-10's own [precedent]").
- Resolution: update `scoring/page.tsx`'s `FACTORS` array to the 5 user-visible factors (adding "Area population density" — "How well-populated the simulation's configured area stayed relative to its size, averaged over the run."), update the "product of four factors" text to five, and add one sentence noting that multi-tribe runs also fold in a 6th, not-separately-broken-out predator-tribe-balance factor (`context/archive/2026-11-18-second-predator-tribe-prey-target/plan.md:61-62`: "how balanced (or lopsided) the two predator tribes' populations ended up, with existing single-tribe runs scoring that factor as a neutral 1.0 (no-op)").

## Code References

- `src/app/reference/parameters/page.tsx:82-95`, `population-lifecycle/page.tsx:54-64`, `scoring/page.tsx:35-45` — the 25 `LabeledCard` instances.
- `src/app/reference/storyline/page.tsx:40-45`, `parameters/page.tsx:100-105`, `population-lifecycle/page.tsx:68-73`, `scoring/page.tsx:70-75` — the 4 `BackLink` instances.
- `src/server/simulation/boids.ts:2423-2451` — `computeScore`, the true 6-factor formula.
- `src/app/runs/compare/page.tsx:17-23` — the 5-factor user-visible breakdown this reference page should match.
- `context/archive/2026-11-18-second-predator-tribe-prey-target/plan.md:61-62,79-80` — confirms the 6th factor's deliberate non-exposure in the comparison UI and gives the factor's plain-language description.

## Architecture Insights

- This confirms the repo-wide pattern observed across the whole M-12 milestone: the shared-component gap, not token usage, is consistently where drift accumulates. `LabeledCard`'s 25 instances is the largest single count found in any M-12 audit, larger even than `AnalysisCard`'s 10.
- This is the first M-12 audit to surface a genuine content-accuracy gap alongside the usual token/component charges — confirms the value of reading referenced business logic (not just the view's own JSX) during a `/10x-ui` audit, even though content accuracy is formally outside `/10x-ui`'s own charge categories.

## Historical Context (from prior changes)

- `context/archive/2026-11-20-dashboard-ui-refresh/`, `context/archive/2026-11-20-leaderboard-ui-refresh/`, `context/archive/2026-11-20-runs-analysis-compare-ui-refresh/`, `context/archive/2026-11-20-admin-pages-ui-refresh/` — sibling `/10x-ui` audits for the same milestone; `LabeledCard`/`BackLink` follow their established component-placement convention.
- `context/archive/2026-11-19-area-aware-population-insight/` (S-25) and `context/archive/2026-11-18-second-predator-tribe-prey-target/` (S-43) — the two changes that grew the scoring formula past the reference page's documented 4 factors without updating it.

## Related Research

- `context/archive/2026-11-20-dashboard-ui-refresh/research.md`, `context/archive/2026-11-20-leaderboard-ui-refresh/research.md`, `context/archive/2026-11-20-runs-analysis-compare-ui-refresh/research.md`, `context/archive/2026-11-20-admin-pages-ui-refresh/research.md` — sibling `/10x-ui` audits for the same milestone.

## Open Questions

- None blocking.

## Charges

| # | Category | Verdict | File:line | User impact |
|---|----------|---------|-----------|--------------|
| 1 | Missing shared component | **INCLUDE** (extract `LabeledCard` at `src/components/labeled-card.tsx`) | `parameters/page.tsx:82-95`, `population-lifecycle/page.tsx:54-64`, `scoring/page.tsx:35-45` (25 instances) | No direct user-visible bug; the largest single duplication count in M-12, prevents 25 hand-edits on any future card-style change. |
| 2 | Missing shared component | **INCLUDE** (extract `BackLink` at `src/components/back-link.tsx`) | `storyline/page.tsx:40-45`, `parameters/page.tsx:100-105`, `population-lifecycle/page.tsx:68-73`, `scoring/page.tsx:70-75` (4 instances) | No direct user-visible bug; 4 byte-identical cross-file instances, prevents drift on any future back-link style change. |
| 3 | Content accuracy (user-approved scope addition) | **INCLUDE** | `scoring/page.tsx:3-21,29-31` | Real: users reading this page are told scoring uses 4 factors when it actually uses 5 visible + 1 invisible-but-real one — misleading documentation. |
