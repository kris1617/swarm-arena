# Evidence: language in the code

Scope: whole repo per 0-sources.md. Layers sampled: persistence (schema.ts
full read), domain types + operations (boids.ts full read of types/constants/
function signatures, ~2453 lines, plus targeted sections), tRPC entry points
(`rg` on procedure definitions in simulation.ts, user.ts; parameter-ranges.ts
full read). Not opened in full: simulation.ts's 1921-line procedure bodies
(read signatures + grep only), single-run-lifecycle.ts, server-run-registry.ts
(grepped, not read). Commands at bottom.

## Concepts and their names across layers

| concept | persistence | domain type | operations | entry points |
|---|---|---|---|---|
| simulation run | `simulation_run` table (schema.ts:84) | — (no `SimulationRun` type found; row shape implicit) | `insertRunningSimulation`, `checkAgainstAdminRanges` (simulation.ts refs) | `start`, `startServer`, `stop`, `watch`, `savePause`, `resume` (simulation.ts:601-1807) |
| boid (individual) | — | `BoidState` (boids.ts:123), `BoidGenes` (boids.ts:111) | `createInitialPopulation` (459), `stepBoids` (637), `reproducePopulation` (1160), `inheritGenes` (1102), `applyHunger` (1344) | `boidCount` (schema.ts:91 / parameter-ranges.ts:6) |
| predator | — | `PredatorState` (146), `PredatorGenes` (141, alias of BoidGenes) | `createInitialPredators` (514), `stepPredators` (944), `applyPredation` (1499) | `predatorCount` (schema.ts:96) |
| tribe (boid flock) | `flockCount` (schema.ts:104), `tribeConfigs` JSON (schema.ts:175) | `TribeConfig` (boids.ts:33), `FlockWeights` (11) | `splitCountAcrossFlocks` (440), `updateTribeConfigs` (simulation.ts:1520) | `flockId` field on `BoidGenes` |
| predator tribe | `predatorFlockCount` (schema.ts:183), `predatorTribeConfigs` JSON (184) | `PredatorTribeConfig` (boids.ts:81) | `updatePredatorTribeConfigs` (simulation.ts:1587), `predatorTribeField` (618) | `preyTarget: "boids"\|"boids-and-predators"` (boids.ts:100) |
| food | `foodStockInitial`, `foodRegenRate` (schema.ts:98-99) | `FoodState` (173), per-tribe `foodStockShare`/`foodRegenShare`/`foodConsumptionRate` (TribeConfig:53-55) | `applyHunger` (1344), `computeTribeFoodImbalanceSample` (2305) | `wasEverFoodImbalanced` (schema.ts:156) |
| reproduction/genetics | — | `BoidGenes.matePreference` (120), `crossbreedingEnabled` (TribeConfig:61, PredatorTribeConfig:93) | `inheritGenes` (1102), `reproducePopulation` (1160), `computeGeneticDiversity` (2084) | `mutationChance`/`mutationMagnitude` (schema.ts:106-107) |
| population lifecycle | `history` JSON (schema.ts:135, shape `{phaseHistory, foodRatioSamples, survivorGenes}`) | `PopulationPhase` enum (2125): `establishment\|growth\|overshoot\|crash\|recovery` | `classifyPopulationPhase` (2139), `segmentCompletedCycles` (2211), `computePhaseQuality` (2235), `computeResourceManagement` (2261) | — |
| score | `score` column (schema.ts:119) | — | `computeScore` (2437) | returned by run completion |
| parameter suggestion | — | `ParameterSuggestion`, `SuggestionInputRow` (parameter-suggestion.ts:29,33) | `pearsonCorrelation`, `suggestParameterChange` (parameter-suggestion.ts) | `getParameterSuggestion` (simulation.ts:1110) |
| run optimization suggestion | — | `RunOptimizationSuggestion` (run-optimization-suggestion.ts:17) | `suggestRunOptimization` | referenced from `getRunAnalysis` (simulation.ts:1204) area |
| admin parameter ranges | `admin_settings` singleton (schema.ts:206), `parameterRanges` JSON | `ParameterRange`/`ParameterRanges` (parameter-ranges.ts:130,132), `RangedParameterName` (61) | `checkAgainstAdminRanges`, `checkLiveParamRangesSoft` (parameter-ranges.ts:228) | `getParameterRanges`, `updateParameterRanges` (simulation.ts:1874,1878) |
| user role/elevation | `users.role` enum `member\|admin` (schema.ts:33), `elevatedUntil` (41) | — | `isEffectivelyAdmin` (comment, schema.ts:39) | `elevateSelf`, `revertSelf`, `elevateAccount`, `revertAccount`, `listElevatedAccounts` (user.ts:38-116) |
| feedback report | `feedback_report` table (schema.ts:233), `category: bug\|idea`, `status: pending\|sent\|abandoned` | — | retry queue by `attemptCount`/`lastError` | feedback router (src/server/feedback/*, not opened) |

## One concept, many names

- **run status**: DB enum `status: "running"|"stopped"|"saved"` (schema.ts:116) vs. mutation/entry-point verbs `start`/`startServer`/`stop`/`savePause`/`resume` (simulation.ts) — "saved" (noun/state) only reachable via `savePause` (verb); no `"paused"` state name exists despite the UI-facing verb.
- **tribe vs. flock**: column/field uses `flock` (`flockCount`, `flockId`, `splitCountAcrossFlocks`) while the type/comments consistently say "tribe" (`TribeConfig`, `tribeConfigs`, `updateTribeConfigs`, comments calling it "per-tribe"). Same concept, DB-era name `flock*` frozen in schema, newer code/comments renamed it "tribe".
- **suggestion**: two distinct, differently-scoped concepts share the English word — `ParameterSuggestion` (cross-run correlation heuristic, parameter-suggestion.ts) vs. `RunOptimizationSuggestion` (single-run diagnosis, run-optimization-suggestion.ts) — see "One name, many concepts" below.

## One name, many concepts

- **"suggestion"** — (1) `getParameterSuggestion`/`ParameterSuggestion`: a cross-run, Pearson-correlation-based recommendation to raise/lower one parameter (parameter-suggestion.ts); (2) `suggestRunOptimization`/`RunOptimizationSuggestion`: a single-run diagnosis (e.g. "crash-dominant run" per run-optimization-suggestion.test.ts:29) tied to `PopulationPhase` patterns, not correlation. Comment at run-optimization-suggestion.ts:9 explicitly flags these as distinct.
- **"genes"** — `BoidGenes` carries both per-individual steering traits (separationWeight etc.) and reproduction traits (matePreference, maxLifespan) in one flat type; `PredatorGenes` is a type alias of the same shape even though several fields are documented as behaviorally inert for predators (boids.ts:68-75) — same name, two different behavioral meanings depending on species.

## Implicit concepts

- **"tribe" has no run-level identity beyond array index** — `TribeConfig[]`/`PredatorTribeConfig[]` are indexed by `flockId`/`predatorFlockId` with no name, label, or id field of its own (boids.ts:19-21, 67). A tribe is purely positional.
- **throttling/comparability** — no dedicated type; lives only as sticky boolean columns (`wasEverThrottled`, `wasAutoStopped`, `wasEverFoodImbalanced`, `wasEverPredatorTribeImbalanced`, schema.ts:143-169) that gate whether downstream analytics may compare a run.
- **run origin/mode** — `runMode: "client"|"server"` (schema.ts:196) is the only trace of a "who owns the tick loop" concept; no type names it beyond the column.

## States and transitions

- `simulation_run.status`: `"running" -> "stopped"` / `"running" -> "saved"` (via `savePause`) / `"saved" -> "running"` (via `resume`, inferred from name, not confirmed by reading its body).
- `PopulationPhase` state machine (boids.ts:2125-2177): `establishment -> growth -> overshoot -> crash -> recovery`, transitions computed in `classifyPopulationPhase` from trend/food-ratio thresholds (`CRASH_POPULATION_DROP_THRESHOLD`, `OVERSHOOT_FOOD_RATIO_THRESHOLD`), not stored as an explicit enum column — persisted only inside `history` JSON's `phaseHistory` array.
- `feedback_report.status`: `"pending" -> "sent"` or `"pending" -> "abandoned"`, driven by `attemptCount`/`lastError` (schema.ts:244-251), retry-queue shaped.
- `users.role`: `"member" <-> "admin"`, time-boxed via `elevatedUntil` rather than a third enum state — a lapsed timestamp silently reverts effective role without changing the stored `role` string (schema.ts:36-41).

## Where business logic lives

- Simulation tick math (steering, hunger, predation, reproduction, scoring) lives entirely in domain functions in `boids.ts` — no service/handler layer duplicates it; `simulation.ts` only calls into it (evidence: full function list, boids.ts).
- Parameter validation/bounds-checking is split: `parameter-ranges.ts` (pure functions `checkLiveParamRangesSoft`) vs. `checkAgainstAdminRanges` referenced from `simulation.ts` — router-level enforcement, not DB constraints (schema.ts has no CHECK constraints beyond the singleton-id comment at schema.ts:201-205, which is explicitly enforced at the application layer, not DB).
- Role/elevation logic (`isEffectivelyAdmin`) is described only in a schema.ts comment (39) — not confirmed read in a dedicated auth module.
- No ORM-level triggers/policies found in schema.ts; SQLite has none here per its own comment (203-205).

## Unknowns

- Whether `resume` actually transitions `saved -> running` and what "watchers"/`listRunning` mean operationally — not opened (simulation.ts bodies beyond signatures).
- `src/server/feedback/*.ts` not opened — feedback-router vocabulary beyond the schema is unconfirmed.
- `single-run-lifecycle.ts`, `server-run-registry.ts` (1270 lines) only grepped for the word "suggestion" — may hold additional vocabulary (e.g. "watchers", "throttled speed multiplier") not captured here.

## Commands run

- `rg -n "^(export )?(type|interface|enum) "` / `"^export const [A-Z_]+ *="` / `"^export function |^function "` over boids.ts
- `rg -n "^\s*(\w+): (publicProcedure|protectedProcedure|adminProcedure)"` over simulation.ts, user.ts
- `rg -n "correlation|suggestion|Suggestion"` over src/server/simulation/*.ts and simulation.ts
- `wc -l` on boids.ts, simulation.ts, user.ts, single-run-lifecycle.ts, server-run-registry.ts
- Full `Read` of schema.ts, parameter-ranges.ts, boids.ts lines 1-260 and 2120-2199
