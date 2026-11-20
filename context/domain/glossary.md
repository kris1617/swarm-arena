---
artifact: domain-glossary
created: 2026-11-20
source: context/domain/domain-distillation.md
---

# Glossary: swarm-arena

Use these words in code, tests, commits and conversations. When a name in the code differs from the term, the term wins in new code; renaming old code is a separate decision.

| term | means | name in code | don't call it |
|---|---|---|---|
| boid | an individual simulated flocking creature | `BoidGenes`/`BoidState` | "individual" |
| predator | an individual simulated predator creature | `PredatorGenes`/`PredatorState` | — |
| tribe | a named group of boids sharing per-group behavior/genetics config (full behavioral identity, not just a starting average) | `TribeConfig` (type/domain layer) | **"flock"** — this is the DB/persistence-layer name for the same concept (`flockId`, `flockCount`); the two are not yet reconciled, see D-03 |
| predator tribe | the same per-group config concept as tribe, applied to predators | `PredatorTribeConfig` | — |
| genes | the full inheritable trait set a boid/predator carries (steering weights + reproduction traits in one type) | `BoidGenes` | "DNA" |
| crossbreeding | cross-tribe mating, gated per-pair by both tribes' own setting | `crossbreedingEnabled` | — |
| prey target | which species a predator tribe is configured to hunt | `preyTarget` | — |
| protection threshold | the population floor below which a tribe can't be attacked | `protectionThreshold` | — |
| genetic diversity | the score factor measuring trait variance across the population | `computeGeneticDiversity` | — |
| score | the product of 5 factors computed when a run ends | `computeScore`, `score` column | — |
| population lifecycle phase | one of 5 states a population is classified into each tick (Establishment/Growth/Overshoot/Crash/Recovery) | `PopulationPhase` | — |
| resilience bonus | the score bonus for completing a Crash→Recovery transition | (part of `computeScore`'s phase-quality factor) | — |
| run / simulation run | one configured-and-executed simulation, with a lifecycle (running/saved/completed) | `simulation_run` table — **no dedicated type exists**, row shape is implicit | — |
| server-owned run | a run ticking on the server independent of any browser connection | `runMode: "server"` | "real" simulation (older/informal) |
| client-staged run | a run ticking entirely in the browser | `runMode: "client"` | "staging" |
| watch | viewing exactly one server-owned run's live state | `watchServerRun`/`watcherIds` | — |
| save / pause | stopping a run while preserving its exact resumable state | `savePause` | "paused" — the DB status value is literally `"saved"`, there is no `"paused"` enum value |
| resume | restarting a previously saved run from its exact preserved state | `resume`/`resumeServerRun` | — |
| admin / member | the two user roles | `users.role` | — |
| temporary admin elevation | a time-boxed, reversible self-service or admin-granted promotion to admin | `elevatedUntil`, `elevateSelf` | a permanent role change |
| object-count cap | the admin-configured ceiling on boids+predators in one run | `maxObjectCount` | — |
| parameter-suggestion heuristic | a cross-run, correlation-based recommendation to raise/lower one parameter | `ParameterSuggestion` | "run optimization suggestion" — a different, single-run concept, see below |
| run optimization suggestion | a single-run diagnosis derived from that run's own phase/resource history | `RunOptimizationSuggestion` | "parameter suggestion" — the cross-run correlation concept above |
| unwatched-run tick throttling | unwatched server-owned runs tick faster than real time so they don't compete for CPU | `isThrottled`/`speedMultiplier` | — |
| comparability | whether two runs' scores can be meaningfully compared (broken by throttling, score-formula version, etc.) | no dedicated type — lives only as sticky boolean columns (`wasEverThrottled` etc.) | — |
| run origin / mode | whether a run is client-ticked or server-ticked | `runMode` column | — |

## Status, qualified by context

"Status" means different things depending on which entity it's attached to — always qualify it:

| context | means | name in code | don't call it |
|---|---|---|---|
| run status | the simulation run's own lifecycle state | `simulation_run.status` (`running`/`stopped`/`saved`) | bare "status" with no entity named |
| feedback-send status | whether a feedback report has been delivered to GitHub Issues | `feedback_report.status` (`pending`/`sent`/`abandoned`) | bare "status" with no entity named |
