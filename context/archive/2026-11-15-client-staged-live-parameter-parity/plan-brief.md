# Client-staged live parameter parity — Plan Brief

> Full plan: `context/changes/client-staged-live-parameter-parity/plan.md`
> Research: `context/changes/client-staged-live-parameter-parity/research.md`

## What & Why

S-27/S-31 shipped live mid-run parameter adjustment for server-owned simulations only. This change brings the same capability — adjusting `foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude` on an actively-running simulation — to the client-staged execution path (the browser-side `requestAnimationFrame` loop), the milestone's north-star slice.

## Starting Point

`simulation-canvas.tsx` closes over these 5 fields as fixed props for a run's lifetime — a live edit currently has no path into the running tick loop. The same file already solves this exact problem for its `showMinimap`/`showBoundary` toggles via a ref-as-source-of-truth pattern; this plan applies that pattern to the 5 target fields. The shared tick core (`computeSingleRunTick`/`boids.ts`) needs zero changes — it already reads every target field fresh, with no caching.

## Desired End State

A user watching a client-staged run open its live-edit panel, change a value, click Apply, and see the actual simulation behavior change (not just the displayed number) — then, once the run finishes, see the same changelog overlay on the analysis chart that server-owned runs already get.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| UI | New lightweight panel, same NumberField idiom as `server-run-viewer.tsx`, not the component itself | No dirty-tracking machinery to drag along — client-staged has none of the subscription races that justified it | Plan (user-confirmed) |
| Changelog | Build full parity now (accumulator + schema extension + persisted history) | The analysis view's overlay is already generic over `field` — persisting the data is the only missing piece | Plan (user-confirmed) |
| Cooldown | Add the same 500ms client-side cooldown as the server-owned panel | UI consistency across both live-edit panels | Plan (user-confirmed) |
| Validation | Reuse `checkLiveParamRangesSoft` | Same warning behavior as the server-owned path — but it must move to `parameter-ranges.ts` first, since it currently lives in a server-only module | Plan (user-confirmed + research finding) |
| Pending-edit-at-stop | Silently discard | Matches ordinary form semantics — nothing was committed via Apply, so there's nothing to reconcile | Plan (user-confirmed) |
| Manual verification | Deterministic before/after test per field, mirroring S-31 | Exactly the rigor that caught S-27's non-functional-fields defect; UI-accepts-input ≠ feature-verified | Plan (user-confirmed), per `context/foundation/lessons.md` |
| Panel location | Entirely inside `simulation-canvas.tsx` — no `page.tsx` changes | All state the panel needs already lives in this component; no prop-threading mechanism needed | Plan (research finding) |

## Scope

**In scope:**
- Ref-based live update mechanism for the 5 target fields in `simulation-canvas.tsx`.
- A new live-edit panel (grouped headings, soft-range warnings, apply cooldown).
- Full changelog persistence for analysis-view parity.
- Extracting `checkLiveParamRangesSoft` to a shared, client-importable module.

**Out of scope:**
- Flocking weights, `boidCount`, `flockCount` — per-boid-genetic/setup-only, same as S-31.
- Dirty-tracking — no competing writer exists on this path.
- A server-side throttle backstop — no server registry entry exists for a client-staged run.
- Any change to the server-owned path (`server-run-registry.ts`, `server-run-viewer.tsx`).

## Architecture / Approach

Copy `simulation-canvas.tsx`'s own existing `showMinimap`/`showBoundary` ref+state idiom to the 5 target fields; add a sibling panel in the same component's render that writes to those refs on Apply. Extract the one piece of logic genuinely worth sharing with the server-owned path (`checkLiveParamRangesSoft`) into the already-pure `parameter-ranges.ts`. Thread a new changelog array through the existing `stop` mutation, the same way S-27 threaded it through the server-owned path's finish/stop.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shared validation extraction | `checkLiveParamRangesSoft` reusable from both paths | None — pure refactor, existing test covers it |
| 2. Client-staged live-adjust mechanism | Ref-based live update + new panel | Mirrors a pattern already proven safe twice (showMinimap/showBoundary here, applyLiveParams server-side) |
| 3. Changelog parity | Persisted `parameterChanges`, analysis-view overlay parity | Low — overlay code is already generic; only the write path is new |

**Prerequisites:** S-31 (done) — targets the corrected field set, not S-27's original.
**Estimated effort:** 3 phases; Phase 1 touches 2 files minimally, Phase 2 touches 1 file (the bulk of the work), Phase 3 touches 2 files.

## Open Risks & Assumptions

- Assumes no other code path reads the 5 target fields as plain props from `SimulationCanvas` elsewhere (confirmed by research: only `tick()` reads them).
- Assumes the existing `simulation-canvas.test.tsx` test file structure can accommodate the new ref/panel tests without conflicting with existing tick-loop test setup — verified during Phase 2 implementation, not before.

## Success Criteria (Summary)

- A live edit to any of the 5 fields produces an observed behavior change (not just a UI update) on a running client-staged simulation.
- A completed client-staged run's analysis view renders the same changelog overlay a server-owned run's analysis view shows.
- No regression to the client-staged path's existing determinism/correctness for the remaining fixed parameters.
