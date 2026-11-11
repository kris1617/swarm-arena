# Predator-Prey Dynamics — Plan Brief

> Full plan: `context/changes/predator-prey-dynamics/plan.md`

## What & Why

Add predators to the existing single-flock boids simulation: predators hunt boids, boids flee
nearby predators, a flock at or below a configurable protection threshold is immune to attack,
and a global food-stock resource whose depletion accelerates boid death (hunger). This is
roadmap slice S-02, covering PRD FR-005 (partial), FR-008, and FR-009 — the predator-prey
layer on top of S-01's basic flocking loop.

## Starting Point

`boids.ts` simulates one flock in 3D with Reynolds steering, toroidal wrapping, a hard-floor
overlap resolver, and a survival×cohesion score. No predator type, no food/hunger, no
multi-flock concept exist. The schema/router/canvas/form all mirror exactly S-01's parameter
set (boid count, 3 weights, duration).

## Desired End State

Starting a run spawns boids and predators together. Predators (faster, visually distinct)
hunt the nearest boid; boids flee a predator once it's close. While the alive-boid count is at
or below the protection threshold, no predator can capture a boid — above it, captures happen
instantly on contact. A global food stock depletes with population and regenerates over time;
when it runs short, boids age faster. The score formula is untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Food/hunger scope | Global food-stock scalar (no spatial food entities) | Matches S-02's "partial FR-005" scope without pulling in S-04's food UI early | Plan |
| Predator kill mechanic | Instant kill on capture, no energy transfer/cooldown | Reuses the existing lifespan-removal pattern; predator survival isn't tied to hunting success this slice | Plan |
| Protection-threshold definition | Total alive-boid count (one flock only until S-03) | Matches the PRD's literal "stado" wording and current one-flock reality | Plan |
| Predator speed | Faster than boids' cruise range (new PREDATOR_MIN/MAX_SPEED) | A same-speed predator could never catch a fleeing boid, making hunting invisible | Plan |
| Predator rendering | Distinct color token + distinct shape | Most robust distinction, including for colorblind users; follows the existing token pattern | Plan |
| New-param storage | Discrete typed columns on `simulationRuns` | Matches every existing column's pattern (boidCount, weights, etc.) | Plan |
| Scoring | No change to `computeScore` | S-04 owns "full score"; the formula/weights are an explicit PRD open question deferred to the user | Plan |
| Threshold testing | Deterministic unit test in `boids.test.ts` | Encodes the PRD's own named US-01 acceptance criterion as an automated check | Plan |

## Scope

**In scope:**
- Predator state, hunt steering, prey flee steering, protection-threshold capture logic
- Global food-stock depletion/regen and hunger-accelerated boid death
- New `simulationRuns` columns + `start` input/validation for the 4 new parameters
- FR-018 combined boid+predator object-count guardrail
- Predator rendering (color + shape) and 4 new form fields

**Out of scope:**
- Predator/boid reproduction, genetic inheritance (S-03)
- Admin parameter ranges, save/resume, full 3-part score (S-04)
- Spatial food particles, per-boid food-seeking steering
- Predator hunger/energy mechanic or kill cooldown
- Per-boid local-neighborhood protection check (only total-count threshold)

## Architecture / Approach

Four composable pure functions added to `boids.ts` (`stepPredators`, hunger folded into
`applyHunger`, capture into `applyPredation`, flee folded into the existing `stepBoids`), run
in a fixed per-tick order: `stepBoids` → `stepPredators` → `applyHunger` → `applyPredation`.
This mirrors the file's existing `stepBoids` → `resolveOverlaps` composition style rather than
one monolithic step function. Persistence and UI extend S-01's exact patterns column-for-column
and field-for-field.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Simulation engine | Predator state/steering, flee behavior, hunger, protection threshold, deterministic tests | Getting the per-tick ordering (predation after movement, hunger before predation) wrong would let a tick's hunger-death and predation double-count or race |
| 2. Persistence & API | 4 new `simulationRuns` columns, `start` input validation, combined FR-018 cap | Missing the combined boid+predator cap would silently reopen the object-count guardrail S-01 closed |
| 3. Rendering & UI | Predator rendering, tick-loop wiring, 4 new form fields | Visual distinction (color+shape) must stay token-based, not a literal color dropped into the view |

**Prerequisites:** S-01 (`basic-flocking-loop`) done — confirmed by the roadmap.
**Estimated effort:** ~3 sessions across 3 phases, similar scope to S-01.

## Open Risks & Assumptions

- Predators are assumed to need no separation/alignment/cohesion among themselves for this
  slice — if predator clumping looks bad during manual testing, that's a follow-up, not a
  blocker for S-02's scope.
- Tuning constants (`PREDATOR_MIN/MAX_SPEED`, `CAPTURE_RADIUS`, `PREDATOR_DETECTION_RADIUS`,
  `FLEE_WEIGHT`, hunger rates) are given as starting values in the plan; the implementer may
  need to adjust them during manual testing to get a visually convincing hunt/flee feel,
  the same way S-01's steering constants were tuned after initial implementation.

## Success Criteria (Summary)

- A flock at or below the protection threshold is never attacked by a predator during a run
  (PRD's named acceptance criterion, automated test).
- Predators visibly hunt and boids visibly flee during manual observation.
- No regression to the S-01 happy path when predator count is 0.
