# Plan Brief: Area-aware population insight (5th score factor)

Full plan: `context/changes/area-aware-population-insight/plan.md`

## What and why

S-24 made the simulation's area (`xyArea` × `xyArea` × `zDepth`) a per-run
configurable parameter, but nothing in scoring reflects whether the
population actually held up at the area it was given — a bigger area could
silently thin the population out with no scoring/analysis signal. This plan
adds a 5th score factor, **area population density**: a time-averaged ratio
of each tick's combined boid+predator population to the run's own starting
density over its full 3D volume, multiplied into the existing formula like
every other factor. It's a scoring-formula change (same care class as S-09's
phase-quality correction), so it also threads through both execution paths,
persists the new signal, updates the run-comparison breakdown with explicit
backward compatibility for pre-change runs, and adds a visible marker
distinguishing differently-scored runs.

## Starting Point

`computeScore` is a plain 4-argument product
(`src/server/simulation/boids.ts:1425`); `computeResourceManagement` is the
exact aggregation shape to mirror (flat average of a per-tick sample array).
Per-tick arrays are collected in one shared core, `computeSingleRunTick`
(`single-run-lifecycle.ts`), called identically by the client-staged path
(`simulation-canvas.tsx`) and the server-owned path
(`server-run-registry.ts`) — a new array threads through both automatically
once added to that shared core and both call sites. `getRunsComparison`
already presence-checks one newer field (`elapsedSeconds`) to detect
pre-change rows; this plan reuses that exact convention for the new factor,
with no DB migration (`simulationRuns.history` is a schema-less JSON column).

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Formula shape | Time-averaged density ratio (mirrors `computeResourceManagement`) | User-chosen over a cheaper final-vs-starting snapshot — captures the whole run's trajectory |
| Population scope | Combined boids + predators | User-chosen over boids-only |
| Area dimension | Full 3D volume (`xyArea × xyArea × zDepth`) | User-chosen over 2D xy-plane-only |
| Normalization | Raw per-tick samples; ratio computed inside `computeAreaPopulationDensity` against `samples[0]` | Keeps collection sites simple (push raw density), matches how `survivingBoidGenes` is sent raw and processed centrally |
| PRD handling | Amend FR-010 now + new FR (mirrors FR-019) | User-chosen over deferring the drift |
| UI scope | Show in run-comparison breakdown now, this plan | User-chosen over scoring-only this phase |
| Backward compat | Partial breakdown, 5th factor `N/A`/`null` | User-chosen over hiding the whole breakdown — the other 4 factors' inputs exist on every historical row |
| Comparability marker | Visible badge/note, diverges from S-09's silent precedent | User-chosen, per the roadmap's own explicit risk note about comparability |
| Weighting | Strict multiplicative term, no floor | User-chosen — consistent with every other factor's philosophy |
| Detection mechanism | Presence/absence of `populationDensitySamples` in stored `history` JSON | Reuses existing codebase convention (`elapsedSeconds` presence-check); no new DB column |

## Phases

1. **Formula, per-tick plumbing, and PRD amendment** — `computeAreaPopulationDensity` + `computeScore` signature (`boids.ts`); new sample array threaded through `single-run-lifecycle.ts`, `server-run-registry.ts`, `simulation-canvas.tsx`, and `simulation.ts`'s `stop` mutation; FR-010/new-FR/Business-Logic PRD amendment.
2. **Run-comparison backward-compatible breakdown** — `getRunsComparison` gets a conditional 5th factor (`null` for pre-change rows); `runs/compare/page.tsx` renders it with `N/A` and omits a zero-height bar for missing data.
3. **Comparability marker** — `listLeaderboard` derives and exposes `scoredWithAreaFactor`; leaderboard page shows a "4-factor score" badge on old runs; comparison page adds a per-row note reusing Phase 2's `null` signal.

**Prerequisites**: S-24 (`configurable-area-and-camera-view`) — done, archived.
**Estimated effort**: 3 phases; Phase 1 touches 5 files (1 backend core change + 3 call-site plumbing + 1 doc), Phases 2-3 touch 1 backend + 1 frontend file each.

## What We're NOT Doing

- Not retroactively recomputing any already-scored run's `score` (forward-only, same as S-09/F-05 precedent).
- Not changing `parameter-suggestion.ts` or `run-optimization-suggestion.ts` — both consume `score` generically.
- Not adding a formula-version DB column — presence/absence of `populationDensitySamples` in `history` is the detection mechanism.
- Not changing any admin-configurable range or `camera.ts`/rendering logic.
- Not building a dedicated formula-version-history page.

## References

- Roadmap: S-25 (`area-aware-population-insight`), MS-03
- PRD: FR-010, FR-019 (template for the new FR)
- Precedent: S-09 (`phase-quality-per-cycle-scoring`) — same scoring-formula-change care class
- Full plan: `context/changes/area-aware-population-insight/plan.md`
