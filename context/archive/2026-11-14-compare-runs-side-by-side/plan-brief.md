# Compare completed runs side by side — Plan Brief

> Full plan: `context/changes/compare-runs-side-by-side/plan.md`

## What & Why

Roadmap S-12 (M-2's north star): let the user select 2–4 completed runs and compare their final scores and full four-factor breakdowns side by side, closing the loop the PRD's Vision describes — "whether a parameter change actually helped" becomes a literal side-by-side comparison, not eyeballing the dashboard one run at a time.

## Starting Point

`listCompleted` already lists the caller's own completed runs with scores; `getRunAnalysis` (S-11) already derives per-run factors from `history` via exported `boids.ts` functions. Nothing lets the user compare *across* runs yet — the dashboard shows one score per row, and `/runs/[runId]` analyzes exactly one run at a time.

## Desired End State

From the dashboard, the user checks 2–4 completed runs, clicks "Compare selected", and lands on `/runs/compare?ids=1,2,3` showing each run's parameters, score, and four-factor breakdown (survival, resource management, genetic diversity, phase quality) in a table and a grouped bar chart. Runs without a usable breakdown show `—` instead of crashing.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Selection mechanism | Checkboxes on dashboard's Completed section | No new "pick runs" UI needed — the dashboard already lists exactly the right data | Plan |
| Comparison detail | Full four-factor breakdown, not just score | Explains *why* scores differ, matching how the score is framed everywhere else (S-04, S-11) | Plan |
| Run count | 2–4 | Keeps the table/chart readable; mirrors the app's existing flockCount (2–4) precedent | Plan |
| Visualization | Table + Recharts grouped bar chart | Reuses the Recharts dependency S-11 introduced; a bar chart is the correct shape for comparing categories across groups | Plan |
| Navigation | `/runs/compare?ids=1,2,3` (query string, not dynamic segment) | Bookmarkable/shareable, mirrors `/runs/[runId]`'s run-scoped-page precedent | Plan |
| Mismatched parameters across selected runs | Show parameters as context, no warning | Comparing different variants *is* the point — a warning would fight the use case | Plan |
| Runs lacking a breakdown (no history, or pre-this-change) | Row shows score only, breakdown cells show `—` | Matches the degrade-gracefully pattern already established by the dashboard and `/runs/[runId]` | Plan |
| **Survival factor was never persisted** (`elapsedSeconds`, found during planning) | Persist it going forward, same fix shape as S-11's `populationCountSamples` | Without it, "full four-factor breakdown" can't include survival at all — the data was being discarded, not just unexposed | Plan (scope correction) |

## Scope

**In scope:**
- Persisting `elapsedSeconds` into `history` at all three write sites (client `stop`, server `tick()`, `stopServerRun`) — the one backend gap this change closes.
- `getRunsComparison` query: 2–4 run IDs, ownership/status-gated, per-row graceful degradation (not an all-or-nothing failure).
- Dashboard checkbox selection + "Compare selected" button, enabled only at 2–4 selections.
- `/runs/compare` page: parameter context, score/breakdown table, grouped bar chart.

**Out of scope:**
- Backfilling `elapsedSeconds` for already-completed runs.
- Warning on mismatched run parameters.
- More than 4 or fewer than 2 runs compared at once.
- Any change to `/runs/[runId]`, or to the dashboard's Running/Saved sections.
- Any new charting library or chart type beyond Recharts' `BarChart`.

## Architecture / Approach

Same shape as S-11: close a data gap in `history` (survival factor), expose it through a new ownership-checked tRPC query that reuses `boids.ts`'s existing `compute*` functions, then build the UI on top. Three phases: backend (gap fix + query), dashboard selection, comparison view.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | `elapsedSeconds` persisted + `getRunsComparison` query | Guard condition must correctly distinguish pre- vs. post-fix rows |
| 2. Dashboard selection | Checkboxes + "Compare selected" button | Enforcing the 2–4 bound in the UI, not just the backend |
| 3. Comparison view | `/runs/compare` page: table + bar chart | Graceful degradation for mixed full/partial-data selections |

**Prerequisites:** F-05, S-11 (both done and archived) — this plan only adds to their existing `history` shape and query pattern.
**Estimated effort:** 3 phases, similar scope to S-11's.

## Open Risks & Assumptions

- Assumes `phaseHistory.length` is never substituted as a survival-factor proxy anywhere else in the codebase going forward — confirmed not currently true (checked `boids.ts`, `server-run-registry.ts`), but a future change reusing `phaseHistory.length` for "elapsed time" would reintroduce the same unit confusion this plan fixes.
- `getRunsComparison`'s per-row error marker (vs. a hard failure like `getRunAnalysis`) is a new pattern in this router — reviewed as correct for an N-row query, but it's the one place this plan diverges from strict precedent-copying.

## Success Criteria (Summary)

- User can select any 2–4 of their own completed runs and see a correct, consistent side-by-side comparison of score and all four factors.
- A run lacking persisted survival data (or any history) degrades gracefully — visible with its real score, `—` for what's missing — never crashes the comparison view.
- No regression to the dashboard's existing Running/Saved sections or to `/runs/[runId]`'s analysis view.
