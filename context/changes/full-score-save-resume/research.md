---
topic: "S-04 full-score-save-resume: admin parameter ranges, exact-fidelity save/resume, and the four-factor scoring formula"
researcher: Claude Sonnet 5
date: 2026-11-14
---

# Research: Full Scoring with Save and Resume (S-04)

## Research Goal

Ground `/10x-plan` for roadmap slice S-04 against the actual codebase before
planning. S-04 bundles four distinct, previously-deferred pieces of work:
FR-002 (full) admin-defined parameter ranges, FR-011/FR-012 exact-fidelity
save/resume, FR-010 (full) the four-factor scoring formula (survival ×
resource management × genetic diversity × population-lifecycle-phase
quality, resolved in `prd.md` v2 / roadmap 2026-11-14), and a correctness
fix to the existing "genetic diversity" scoring input discovered during this
research (see Finding 4).

## Summary

All four pieces are genuinely unbuilt or incorrect today, confirmed by
direct inspection, not inference from absence alone:

1. **FR-002 (admin ranges): does not exist.** `adminProcedure` (the
   role-gating primitive) is defined but has zero usages anywhere in the
   codebase. No DB table, no admin UI, no range-aware validation.
2. **Save/resume (FR-011/012): no live-state persistence exists at all.**
   `simulationRuns` only has config + terminal columns. The PRNG's internal
   state cannot be captured as-is — `createRng` only returns a closure.
3. **"Resource management" scoring: entirely unimplemented.**
   `foodAvailabilityRatio` is computed inside `runTick` but discarded —
   never returned, never fed into `computeScore`.
4. **"Genetic diversity" scoring: mislabeled, not just unimplemented.**
   `computeCohesion` — the function currently feeding this score slot —
   measures spatial clustering of boid positions, not gene-value spread. It
   reads zero gene fields. **Decision (user, 2026-11-14): implement a real
   gene-variance metric for "genetic diversity"; keep `computeCohesion` as a
   separate, non-scoring spatial-clustering concern.** This is a
   correctness fix to behavior already shipped in S-01/S-03, not new scope
   invented by S-04.
5. **One shared tick core exists and should be extended once.**
   `computeSingleRunTick` (`single-run-lifecycle.ts`) is called unmodified
   by both the client-staged path (`simulation-canvas.tsx`) and the
   server-owned path (`server-run-registry.ts`'s `tick()`). Any new
   phase-tracking state added to its input/output shape propagates to both
   callers automatically — no duplication needed.
6. **No rolling-window/trend primitive exists.** The population-lifecycle
   phase classifier (establishment/growth/overshoot/crash/recovery) needs a
   new history buffer built from scratch, most naturally alongside the
   existing `cohesionSamples`-array pattern.

## Detailed Findings

### 1. FR-002 — Admin-defined parameter ranges: unbuilt

- `src/server/db/schema.ts` has no range/config/settings table — only
  `posts`, NextAuth adapter tables, and `simulationRuns` (config + terminal
  fields only, lines 92-127).
- No admin page/route exists anywhere under `src/app` (`find -iname "*admin*"`
  returns nothing).
- `src/server/api/routers/simulation.ts:19-34`'s `startInputSchema` hardcodes
  bounds identically for every caller (e.g. `boidCount: z.number().int().positive().max(500)`)
  — role is never read during `start`/`startServer` input validation.
- `users.role` enum (`schema.ts:46-49`) exists, default `"member"`.
  `adminProcedure` (`src/server/api/trpc.ts:164`) is defined (`protectedProcedure`
  + role check) but `grep -rn "adminProcedure" src/` shows **zero usages**
  outside its own definition — a dormant, never-wired primitive.
- `context/archive/2026-11-10-gate-product-routes/plan.md` (F-01, which
  introduced `role`/`adminProcedure`) explicitly scoped this out: *"No admin
  UI for managing parameter ranges or other users — that's S-04 territory."*
  Confirms this is S-04's intended, resolved scope, not a surprise addition.
- PRD Access Control section (`prd.md` lines ~157-165): *"This is the full
  capability difference defined so far"* — range-setting is the one
  resolved admin capability; Open Question #3 only asks whether admin has
  anything *beyond* this, not whether this itself is settled.

**What building this needs**: a DB table for admin-configured per-parameter
ranges + defaults (and the FR-018 global object-count cap), an admin-only
UI page to edit it, and `start`/`startServer`'s validation switched from
hardcoded zod bounds to reading the admin-set ranges (while still keeping
some schema-level sanity ceiling).

### 2. FR-011/012 — Save/resume: no persistence mechanism, RNG problem is real

- `simulationRuns` columns (`schema.ts:92-121`): `id`, `userId`, `seed`,
  `boidCount`, `separationWeight`, `alignmentWeight`, `cohesionWeight`,
  `maxDurationSeconds`, `predatorCount`, `protectionThreshold`,
  `foodStockInitial`, `foodRegenRate`, `flockCount`, `crossbreedingEnabled`,
  `energyThreshold`, `mutationChance`, `mutationMagnitude`, `status`,
  `score`, `startedAt`, `stoppedAt`. All config + terminal. No JSON/blob
  column, no sibling table.
- `finishRun` (`server-run-registry.ts:97-130`) writes only `status`,
  `score`, `stoppedAt` on stop — its own comment (lines 116-124) says a
  resumable-state mechanism is explicitly "S-04's job, not this one."
- **Fields needed for exact-fidelity reconstruction** (`boids.ts:17-64`):
  - `BoidGenes`/`PredatorGenes` (identical shape): `color {r,g,b}`,
    `flockId`, `separationWeight`, `alignmentWeight`, `cohesionWeight`,
    `maxSpeed`, `minSpeed`, `maxLifespan`, `matePreference`.
  - `BoidState`/`PredatorState` (identical shape): `x,y,z`, `vx,vy,vz`,
    `lifespan`, `genes` (nested), `energy`, `age`, `gender`.
  - Both are variable-length arrays (one entry per living individual).
  - Run-level, from `LiveRun` (`server-run-registry.ts:46-57`): `foodStock`,
    `cohesionSamples: number[]`, `elapsedSeconds`,
    `lastTimestamp: number | null`, `populationCapped: boolean`. `params`
    (the run's config) is already fully covered by existing columns.
  - Explicitly NOT persistable as-is: `intervalId` (recreated on resume,
    never serialized) and the RNG's internal state (see below).
- **RNG problem — confirmed real, two equivalent-fidelity fixes identified,
  user chose one**: `createRng` (`rng.ts:9-21`) returns only the `next()`
  closure; its mulberry32 `state` variable is never exposed. Already flagged
  in `context/archive/2026-11-11-basic-flocking-loop/research.md:108`: "any
  simulation state that needs to persist... will need its own wrapper."
  **Decision (user, 2026-11-14): expose RNG state directly** — change
  `createRng` to return `{ next, getState, setState }` (or accept an
  optional starting state), giving O(1) exact resume at the cost of
  changing the function's public contract and every call site (`boids.ts`,
  `server-run-registry.ts`, and existing tests that call `createRng`
  directly).
- **Drizzle JSON support confirmed available, unused**:
  `node_modules/drizzle-orm/sqlite-core/columns/text.d.ts` defines
  `text(name, { mode: "json" })` — standard Drizzle SQLite JSON-mode TEXT
  column, auto-serializing via `JSON.stringify`/`JSON.parse`. No existing
  JSON-mode column in `schema.ts` yet, but no new dependency needed. This is
  the natural column type for a boids/predators-array + run-state snapshot.
- Multiple archived plans defer save/resume to S-04 by name — confirming
  genuinely unstarted work, not a partial implementation to reconcile with:
  `2026-11-11-basic-flocking-loop/plan.md:34`,
  `2026-11-11-predator-prey-dynamics/plan.md:69`,
  `2026-11-13-genetic-inheritance-crossbreeding/plan.md:28,85` ("no DB
  snapshot of gene data (S-04's problem)"),
  `2026-11-14-server-side-simulation-engine/plan.md:91,163-168` (explicitly:
  F-03 built "the scoring half," full save ties to FR-011 and is S-04's).

### 3. FR-010 — "Resource management" scoring: entirely unimplemented

- `runTick` (`boids.ts:965-1066`) computes `foodAvailabilityRatio` at
  lines 1011-1014 (`min(1, max(0, nextFoodStock / foodStockInitial))`) but
  only uses it locally to scale boid energy gain (line 1019) — it is **not
  returned** in `runTick`'s result (lines 979-984: `boids`, `predators`,
  `foodStock`, `populationCapped` only).
- `computeScore` (`boids.ts:1124-1135`) takes only `cohesionSamples: number[]`
  and `elapsedTicks: number` — `score = elapsedTicks * average(cohesionSamples)`.
  There is no resource-management input anywhere in the current formula,
  despite FR-010 describing it as an existing factor.
- `computeScore`'s existing tests (`boids.test.ts:938-955`) only assert two
  monotonicity properties (score rises with `elapsedTicks`; score rises with
  average cohesion) against the current 2-argument signature. A 4-factor
  formula requires a new signature and new tests — the existing ones will
  need rewriting, not just extending.

### 4. FR-010 — "Genetic diversity" scoring: mislabeled (correctness fix, decided)

- `computeCohesion` (`boids.ts:1095-1122`) computes a circular-mean centroid
  of boid `(x,y,z)` positions and the average wrapped distance from that
  centroid, normalized by `COHESION_REFERENCE_RADIUS` — pure spatial
  clustering. It reads **zero gene fields**.
- `computeCohesion`'s existing tests (`boids.test.ts:759-793`, plus usage at
  438/467/483) assert spatial-clustering behavior (tight vs. spread boids),
  consistent with it being a spatial metric — reinforcing that this is a
  genuine mislabeling in the product's scoring, not a misreading of the
  function by this research.
- **Decision (user, 2026-11-14)**: implement a real gene-value-variance
  metric as the actual "genetic diversity" factor (e.g. variance across
  surviving individuals' `separationWeight`/`alignmentWeight`/`cohesionWeight`/
  `maxSpeed`/`minSpeed`/`maxLifespan`/`matePreference`/`color`). Keep
  `computeCohesion` unchanged as a spatial-clustering concern, no longer a
  score input unless a future change explicitly re-adds it for a different
  purpose. This is scoped as part of S-04 since it directly touches the
  same `computeScore` call site S-04 must already rewrite for the 4-factor
  formula.

### 5. One shared tick core — extend once, not twice

- `computeSingleRunTick` (`single-run-lifecycle.ts:18-111`) threads:
  `boids`, `predators`, `foodStock`, `cohesionSamples` (append-only, never
  windowed), `elapsedSeconds`, `lastTimestamp`.
- `server-run-registry.ts`'s `LiveRun` type (lines 46-57) holds the same
  fields; its `tick()` (lines 132-181) calls `computeSingleRunTick` (line
  139) exactly as `simulation-canvas.tsx` does, and calls the same
  `computeScore(run.cohesionSamples, run.elapsedSeconds)` on stop (lines
  171, 247).
- **Confirmed: exactly one shared decision core feeds both the client-staged
  and server-owned paths.** New phase-tracking state (population-count
  history, food-ratio history) added to `computeSingleRunTick`'s
  state/result shape propagates automatically to both callers — the plan
  should modify this one function, never duplicate logic into
  `server-run-registry.ts` directly.

### 6. No rolling-window/trend primitive exists

- Grep for `"rolling|window|history|trend"` across `src/server/simulation`
  and `src/app` returns zero matches except an unrelated test comment
  ("cohesion history" in `server-run-registry.test.ts:117`).
- The phase classifier (establishment/growth/overshoot/crash/recovery) needs
  a new history buffer — most naturally a windowed array of recent
  `{ populationCount, foodAvailabilityRatio }` samples, following the same
  array-threading pattern `cohesionSamples` already establishes in
  `computeSingleRunTick`'s state shape.

## Code References

- `src/server/api/routers/simulation.ts:19-34` — hardcoded `startInputSchema` bounds (no admin-range awareness)
- `src/server/api/trpc.ts:164` — `adminProcedure`, defined but unused anywhere
- `src/server/db/schema.ts:92-127` — `simulationRuns`, config + terminal fields only
- `src/server/simulation/rng.ts:9-21` — `createRng`, closure-only, no exposed state
- `src/server/simulation/boids.ts:17-64` — `BoidGenes`/`PredatorGenes`/`BoidState`/`PredatorState`, the full field list a snapshot must serialize
- `src/server/simulation/boids.ts:965-1066` — `runTick`, computes but discards `foodAvailabilityRatio`
- `src/server/simulation/boids.ts:1095-1122` — `computeCohesion`, spatial clustering (mislabeled as genetic diversity today)
- `src/server/simulation/boids.ts:1124-1135` — `computeScore`, current 2-factor placeholder formula
- `src/server/simulation/single-run-lifecycle.ts:18-111` — `computeSingleRunTick`, the one shared tick core to extend
- `src/server/simulation/server-run-registry.ts:46-57,97-130,132-181,240-249` — `LiveRun`, `finishRun`, `tick()`, `stopServerRun` — the server-owned caller of the shared core

## Architecture Insights

- The project already has a precedent for "extract pure core, thread
  array-shaped history through it, keep the DOM/tRPC shell thin" — exactly
  the pattern `cohesionSamples` establishes and that the new phase-history
  buffer should follow, inside `computeSingleRunTick`.
- Drizzle's `text(..., { mode: "json" })` is available and unused — the
  natural persistence mechanism for the save/resume snapshot, no new
  dependency.
- Changing `createRng`'s public contract touches every call site; this is a
  deliberate, accepted cost of the exact-resume approach the user chose,
  not an oversight to work around.

## Open Questions

None blocking — both decisions this research surfaced (genetic-diversity
fix approach; RNG persistence approach) were resolved by the user on
2026-11-14 and are recorded as decisions above, not open items. Exact
per-phase quality weights and the Crash→Recovery resilience bonus magnitude
remain `/10x-plan`-level tuning decisions (per PRD Business Logic), not
open research questions — they're implementation choices this research
doesn't need to pre-resolve.

## Recommendation for Planning

This change's four pieces (admin ranges, save/resume + RNG, resource
management + genetic diversity fix, phase classifier) are substantial
enough to warrant multiple ordered phases within one `/10x-plan` — not
necessarily multiple separate roadmap changes, since they share one
`change.md` identity and ship together as S-04's single roadmap outcome.
Suggested phase ordering by dependency: (1) `createRng` state
exposure — foundational, everything else that touches RNG-advancing code
depends on it; (2) admin parameter ranges — independent of the rest,
could run in parallel; (3) resource-management + genetic-diversity fix +
phase classifier inside `computeSingleRunTick` — the core scoring rewrite;
(4) save/resume persistence (schema + mutations) — depends on (1) and (3)
being settled, since the snapshot shape must include the final tick-state
fields decided in those phases.
