# Plan Brief: Live-adjust flocking weights and food/threshold on a running simulation

Full plan: `context/changes/live-parameter-adjustment/plan.md`

## What and why

Today, once a server-owned simulation starts, its parameters are frozen until it stops — tuning means stop/reconfigure/restart, losing the run in progress. This was previously an explicit PRD Non-Goal (FR-028, "revisit as its own future milestone"). This plan closes that gap for the server-owned execution path only: the user can change separation/alignment/cohesion weights, food regen rate, and protection threshold while a run ticks, see the effect on the next tick via an inline panel on the live view, and later see exactly when/what was changed on that run's completed analysis page.

## Starting Point

`LiveRun.params` (`server-run-registry.ts`) is a single mutable field set once at construction and only ever read by `tick()` every 16ms — no mutator exists, and no tRPC mutation updates a running run's params. Because the registry lives in module state and every mutation runs synchronously in Node's single-threaded event loop, a plain in-memory patch has no real data race to guard against. All 5 target fields already have admin-configured ranges (`RANGED_PARAMETER_NAMES`); the existing `checkAgainstAdminRanges` throws and expects a full input, so a new soft (warning-only) variant is needed. `getRunAnalysis`'s existing optional-field cast of the schema-less `history` JSON column is the exact precedent for adding a new changelog key with no DB migration.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Validation | Soft — can exceed admin ranges, returns a warning instead of rejecting | User-chosen: ranges may not be optimal for an exploratory mid-run tweak |
| History | Record each applied batch as a changelog entry in `history` | User-chosen over a silent runtime-only tweak |
| UI surface | Inline panel on the live-view page (`ServerRunViewer`) | User-chosen over a separate modal/drawer — keeps canvas and controls in one glance |
| DB sync | `simulationRuns`'s columns stay as the run's *initial* config | User-chosen — the changelog tracks changes, not a column overwrite |
| Edit granularity | Batch — one "Apply" button for all 5 fields | User-chosen over per-field immediate apply |
| Rate limiting | 500ms client-side Apply-button cooldown, no server throttle | User-chosen — single-user app, no abuse surface |
| Feedback | Brief inline success flash | User-chosen over a toast or silent confirmation |
| Run-state edge case | No special-casing — applies until the run leaves the registry | User-chosen over blocking edits near natural stop |
| Analysis-view display | Build it now, not deferred — `ReferenceLine` markers on the existing population chart | User-chosen over persist-only; markers over a plain list for direct visual correlation |
| Detection/storage | `parameterChanges` array, new key in schema-less `history` JSON | Mirrors `populationDensitySamples`'s exact threading precedent; no new DB column |

## Phases

1. **Backend: mutator, mutation, and changelog persistence** — `applyLiveParams` + `parameterChanges` threaded through `LiveRun`/`ServerRunSnapshot`/snapshot/resume/`history` (mirrors S-25's `populationDensitySamples` pattern, including its impl-review-caught `?? []` resume-fallback); new `updateRunParams` tRPC mutation with soft range-check.
2. **Frontend: inline live-edit panel** — batch-edit form in `ServerRunViewer`, pre-filled from the `watch` subscription's extended `liveParams`, 500ms cooldown, success flash, inline warnings.
3. **Analysis view: changelog overlay** — `getRunAnalysis` returns `parameterChanges`; the existing population `LineChart` gets `ReferenceLine` markers with hover tooltips.

**Prerequisites**: none — all baseline layers (server-owned execution, auth, admin ranges) are already done.
**Estimated effort**: 3 phases; Phase 1 touches 2 backend files, Phase 2 touches 1 frontend file, Phase 3 touches 1 backend + 1 frontend file.

## What We're NOT Doing

- Not extending live adjustment to the client-staged execution path (parked — `simulation-canvas.tsx` deliberately treats params as fixed for a run's lifetime).
- Not making population-shape parameters (boidCount/flockCount/crossbreedingEnabled) live-adjustable (parked — needs re-initialization, not a param patch).
- Not updating `simulationRuns`'s persisted config columns on a live edit.
- Not adding server-side rate limiting, a new DB migration, or a stop-condition-aware edit block.

## References

- Roadmap: S-27 (`live-parameter-adjustment`), M-5 (north star)
- Precedent: S-25 (`area-aware-population-insight`) — `populationDensitySamples`'s exact threading pattern, reused here for `parameterChanges`
- Full plan: `context/changes/live-parameter-adjustment/plan.md`
