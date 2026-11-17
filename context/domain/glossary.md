---
artifact: domain-glossary
created: 2026-11-17
source: context/domain/domain-distillation.md
---

# Glossary: swarm-arena

Use these words in code, tests, commits and conversations. When a name in
the code differs from the term, the term wins in new code; renaming old
code is a separate decision.

## Simulation engine

| term | means | name in code | don't call it |
|---|---|---|---|
| boid | one simulated flocking individual | `BoidGenes`/`BoidState` | "individual" (fine informally, but prefer "boid" in new code) |
| predator | one simulated hunter individual | `PredatorGenes`/`PredatorState` | — |
| flock | a starting-average identity group boids are seeded from; not a fixed label | `genes.flockId`, `FlockWeights` | "tribe" (loose/old synonym — see Q-01 in the report) |
| genes | an individual's full inherited trait set (speed, lifespan, weights, color, mate preference) | `BoidGenes` | — |
| hunger / starvation | the single aging/depletion mechanism, accelerated by low food — not a separate death condition | `HUNGER_EXTRA_DECAY_RATE`, inside `applyHunger` | "starvation damage" (implies a second mechanism; there is only one) |
| protection threshold | the flock-size floor below which predators cannot attack at all | `protectionThreshold` | — |
| crossbreeding | inter-flock reproduction producing a color-blended offspring, only when enabled | `crossbreedingEnabled` | — |
| reproduction | boids/predators reproducing when food and the object cap allow it | `reproducePopulation` | "mating" (fine informally) |
| population lifecycle phase | the 5-valued boom-bust state (Establishment/Growth/Overshoot/Crash/Recovery) | `PopulationPhase` | — |
| resilience | the score bonus for completing a Crash→Recovery transition | `segmentCompletedCycles` (cycle counting only) | a precisely-specified bonus formula — the exact weighting isn't independently confirmed, see the report's Limitations |
| cohesion | a legacy, self-flagged-as-mislabeled metric no longer used for scoring | `computeCohesion` | a genetic-diversity measure (it isn't one anymore) |

## Scoring & evaluation

| term | means | name in code | don't call it |
|---|---|---|---|
| score | the final, deterministic per-run result | `simulationRuns.score` | — |
| score factor | one of the 5 multiplied components (survival, resource management, genetic diversity, phase quality, density-vs-area) | `breakdown` object fields | — |
| genetic diversity | coefficient-of-variation-style measure across survivors' genes | `computeGeneticDiversity` | "diversity index" alone (ambiguous with the separate diversity-trend feature) |
| density-vs-area factor | time-averaged population-to-area ratio vs. starting density | `computeAreaPopulationDensity` | — |
| determinism | same seed+params must produce the same score | — | **currently contradicted for throttled runs** — see the report's D-01; don't claim this is unconditionally true in new docs/code without the throttling caveat |

## Run lifecycle & orchestration

| term | means | name in code | don't call it |
|---|---|---|---|
| run / simulation run | one configured simulation execution, with a lifecycle | `simulationRuns` table, `LiveRun` | — |
| server-owned run | a run ticking on the server independent of any client connection | registry membership (`isServerRunActive`) | "real run" (ambiguous with client-staged runs, which are just as real) |
| client-staged run | a run ticked and rendered entirely client-side, for parameter tuning | `start` procedure | "staging run" (fine informally) |
| watch | viewing exactly one server-owned run live, server-pushed | `watchServerRun`, `watcherIds` | — |
| save / pause | stopping a run while preserving its exact state for later resume | `savePause` | — |
| unwatched-run tick throttling | a 3x simulated-speed multiplier for runs nobody is currently watching | `speedMultiplier`, `isThrottled` | — |

## Parameter governance

| term | means | name in code | don't call it |
|---|---|---|---|
| role | admin or member — governs who sets global ranges/caps, not data ownership | `users.role` | "permission level" (this project has exactly 2 roles, both scoped to config only) |
| temporary admin elevation | a reversible, time-boxed self-service grant to the admin role | `users.elevatedUntil`, `elevateSelf` | "permanent promotion" |
| object-count cap (per-run) | the max boidCount+predatorCount a single run may configure | `maxObjectCount` | — |
| maxConcurrentObjectCount | the cross-run ceiling on total objects ticking at once per user | `maxConcurrentObjectCount` | "concurrent run limit" (it caps objects, not run count — `MAX_PARALLEL_RUNS` is the separate run-count cap) |
| parameter-suggestion heuristic | cross-run score-correlation nudge toward one parameter | `getParameterSuggestion`, `pearsonCorrelation` | "optimizer" (it's a heuristic nudge, not an optimizer) |
