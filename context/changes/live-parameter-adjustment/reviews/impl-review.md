<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Live-adjust flocking weights and food/threshold on a running simulation

- **Plan**: context/changes/live-parameter-adjustment/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Grounding

12 files changed, matching the plan's file list exactly (`git diff --name-only 61412d5^..ce5be1a`). Two parallel sub-agent passes: drift detection (7 planned items across 3 phases, all MATCH, every "What We're NOT Doing" boundary confirmed respected — client-staged path untouched, no population-shape live-adjustment, no DB column sync, no server-side rate limit, no migration, no stop-condition blocking) and safety/pattern compliance (4 pattern checks confirmed matching precedent exactly — `populationDensitySamples` threading, `savePause`'s ownership-check sequence, `NumberField` usage, `ReferenceLine` token compliance — plus 2 findings below). All automated gates (typecheck/lint/full suite) ran green at every phase boundary; all 6 manual verification items were performed live by the assistant (real tRPC caller for 1.6; real headless browser for 2.5-2.8 and 3.5-3.6) with evidence recorded in `## Progress`.

## Findings

### F1 — `parameterChanges` changelog has no growth bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/server/simulation/server-run-registry.ts` (`applyLiveParams`), `src/server/api/routers/simulation.ts:900-944` (`updateRunParams`)
- **Detail**: Every other sample array accepted from a client (`cohesionSamples`, `foodRatioSamples`, `phaseHistory` in the `stop` input schema) is capped at `.max(50_000)`. `parameterChanges` has no such cap. The 500ms Apply cooldown in `server-run-viewer.tsx` is client-side UI only (`setTimeout`-based state) — a direct tRPC call or a modified client can call `updateRunParams` as fast as the network allows, for up to `maxDurationSeconds`'s max (600s), each call pushing up to 5 changelog entries. Worst case is thousands of entries serialized into the persisted `history` JSON blob.
- **Fix A ⭐ Recommended**: Cap `parameterChanges.length` in `applyLiveParams` — once at the bound, drop the oldest entry (or reject the push, your call) — mirroring the `.max(50_000)` posture used elsewhere for client-supplied arrays.
  - Strength: Consistent with this codebase's existing bound-everything-client-supplied convention; a few-line change in one function.
  - Tradeoff: An extremely active tuning session loses its earliest changelog entries once capped (if drop-oldest is chosen).
  - Confidence: HIGH — directly mirrors an existing, working pattern in the same file family.
  - Blind spot: Exact bound value is a judgment call; this app's real usage (single hobbyist user) makes the actual risk low regardless of which bound is chosen.
- **Fix B**: Add a minimal server-side throttle on `updateRunParams` (reject a second call within N ms for the same `runId`).
  - Strength: Also closes the gap for a user bypassing the client UI entirely, not just the changelog's size.
  - Tradeoff: New stateful throttle logic (per-run last-call timestamp) that doesn't exist anywhere else in this router; more code than Fix A for a single-hobbyist-user app.
  - Confidence: MEDIUM — no existing precedent for server-side throttling in this codebase to mirror.
  - Blind spot: Where the throttle state would live (in-memory on `LiveRun`? a new Map?) isn't designed here.
- **Decision**: PENDING

### F2 — `parameterChanges` isn't runtime-validated as an array before `.map`, matching existing `populationCountSamples` convention

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: `src/app/runs/[runId]/page.tsx:148`, `src/server/api/routers/simulation.ts:749-754`
- **Detail**: `getRunAnalysis`'s guarded cast only validates `phaseHistory`/`survivorGenes` as arrays; `parameterChanges` (like `populationCountSamples`) is optional and never runtime-checked. A hand-edited or corrupted row with a non-array `parameterChanges` would crash the page's `.map` call. This is pattern-compliant with the pre-existing, identical gap on `populationCountSamples` (page.tsx line 76) — not a regression introduced by this change.
- **Fix**: No action required to stay consistent with existing conventions. If hardened, do both fields together as a separate pass, not singled out here.
- **Decision**: DISMISSED — pre-existing codebase convention, not something this change should fix in isolation; not actually part of this change's scope.
