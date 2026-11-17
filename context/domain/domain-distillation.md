---
artifact: domain-distillation
created: 2026-11-17
repo_root: /home/kris/10xdevs
code_scope: .
head: a9b5abe
dirty: none (at time of inventory; toolkit-install files for this very skill landed afterward, excluded from scope per 0-sources.md)
path_alias: none (single package; `~/*` tsconfig alias maps to `src/*`)
documents: 9 requirements/foundation, 67 narrative (3 read in full, rest titled only), 1 reference, 2 engineering-adjacent reference
previous: none
evidence: context/domain/evidence/
glossary: context/domain/glossary.md
---

# Domain distillation: swarm-arena

## Summary

swarm-arena's domain is a single-user, scored boids+predator-prey flocking simulation: an experimenter configures a run, watches a population of genetically-individual boids and predators live and die under hunger, predation and reproduction rules, and receives a deterministic, repeatable score they can compare across variants. The Core is the simulation engine itself (boid/predator/flock/genes/reproduction/predation/hunger/population-lifecycle-phase) and its scoring (the 5-factor product, genetic diversity, phase quality, density-vs-area) — this is explicitly the product's "wedge" (roadmap.md:35: "every run ends in a deterministic, repeatable score"). Of 38 Core/Supporting terms distilled, 9 have no dedicated code type (implicit concepts like hunger, predation-as-event, mating pair, watcher) — not missing-in-code in the sense of absent, but genuinely nameless in the codebase, living only as local variables and comments. The strongest finding is a real, already-shipped contradiction: the PRD's own determinism NFR ("same seed+params → same score," prd.md:60) is now literally false for any run that was ever unwatched long enough to trigger the 3x tick-speed throttle shipped 2026-11-17 (S-36) — the code already anticipated this with its own `wasEverThrottled` comparability marker, but the PRD's NFR was never amended to carve out the exception. Drift-by-fix-side: 1 code-contradicts-docs (fix: docs, the decision is already made and cited), 0 fix:code, 2 questions with no clear owner yet. 3 open questions; the main limitation is that only 3 of 65 archived change bodies were read in full — the narrative sample is thin.

## Ubiquitous language

| id | term | kind | definition (quoted) | source | in code (path:line) or **missing in code** | other names in code |
|---|---|---|---|---|---|---|
| T-01 | boid | entity | "boids + predator-prey dynamics" | prd.md:23 | `BoidGenes`/`BoidState` boids.ts:24,36 | "individual" (code comments) |
| T-02 | predator | entity | genotyped lifespan like boids | roadmap.md:256 | `PredatorGenes`/`PredatorState` boids.ts:54,59 | — |
| T-03 | flock | entity/value | "a flock defines only the average starting values individuals start from" | prd.md:120 | `FlockWeights` boids.ts:10, `genes.flockId` boids.ts:26 | "tribe" (prd.md:202, parenthetical — see Q-01) |
| T-04 | genes | value | full trait set (speed, lifespan, weights, color, mate preference) | prd.md:120 | `BoidGenes` boids.ts:24 | — |
| T-05 | genetic diversity | measure | score factor; "final genetic-diversity value" | prd.md:43,227 | `computeGeneticDiversity` boids.ts:1295 | — |
| T-06 | crossbreeding | operation/policy | "possible when enabled by a simulation parameter; the offspring's color is a blend of both parents' genes" | prd.md:122 | `crossbreedingEnabled` input; gate at boids.ts:902-907 | — |
| T-07 | reproduction | operation | "boids and predators reproduce when sufficient food is available, up to the max object limit" | prd.md:118 | `reproducePopulation` boids.ts:820, `isEligible` boids.ts:834 | "mating" (comments) |
| T-08 | death / lifespan | event/value | "dies when it exceeds its (genotyped) lifespan; lack of food access accelerates death" | prd.md:124 | `BoidState.lifespan` boids.ts:43; filter boids.ts:683-689 | — |
| T-09 | hunger / starvation | operation/policy | "hunger shortens effective lifespan... one aging/depletion mechanism, modified by food access, not two parallel death conditions" | prd.md:124-125 | **implicit** — `HUNGER_EXTRA_DECAY_RATE` boids.ts:130, `applyHunger` boids.ts:956 | — |
| T-10 | protection threshold | policy | "a predator cannot attack a flock whose size is at or below the configurable protection threshold" | prd.md:126 | `simulationRuns.protectionThreshold` schema.ts:111; guard boids.ts:992-994 | — |
| T-11 | object-count cap (per-run) | policy/measure | "admin configures the global max object count (boids+predators), protecting render smoothness (guardrail)" | prd.md:161 | `maxObjectCount` adminSettings; hard guard simulation.ts:242-247 | — |
| T-12 | maxConcurrentObjectCount | measure/policy | "caps the sum of boidCount+predatorCount across every one of a user's currently-ticking server-owned runs at once," default 150 | capacity-limits.md:35 | hard guard simulation.ts:125-155 | "concurrent-object ceiling" |
| T-13 | score | measure | "the system computes a run's score as the product of five factors" | prd.md:131 | `simulationRuns.score` schema.ts:134; `computeScore` boids.ts:1476 | — |
| T-14 | score factor | measure | survival × resource management × genetic diversity × phase quality × density-vs-area | prd.md:131,136 | named in `getRunsComparison`'s `breakdown` simulation.ts:911-917 | — |
| T-15 | phase quality | measure | 4th factor; "rewards both reaching/holding healthy phases and recovering after a crash (resilience)" | prd.md:134-135 | `computePhaseQuality` boids.ts:1425 | — |
| T-16 | density-vs-area factor | measure | 5th factor (FR-035); time-averaged population-to-area ratio vs. starting density | prd.md:136 | `computeAreaPopulationDensity` boids.ts:1456 | "area-aware population insight" |
| T-17 | population lifecycle phase | state (5-valued) | Establishment/Growth/Overshoot/Crash/Recovery, boom-bust model | prd.md:229-236 | `PopulationPhase` union boids.ts:1315-1320; `classifyPopulationPhase` boids.ts:1329 | — |
| T-18 | resilience | measure/policy | bonus "specifically for completing a Crash → Recovery transition"; scales with cycle count | prd.md:239; roadmap.md:343 | `segmentCompletedCycles` boids.ts:1401 (exact bonus formula not independently verified — see Limitations) | — |
| T-19 | run / simulation run | entity (lifecycle) | "start a boids+predator simulation... stop/save it, resume it later, receive a score" | prd.md:40 | table `simulationRuns` schema.ts:98; `LiveRun` server-run-registry.ts:93 | — |
| T-20 | server-owned run | entity/role | "executes on the server, independent of any client connection... keeps running if the browser tab closes" | prd.md:41 | implicit: registry membership, `isServerRunActive` server-run-registry.ts:402 | — |
| T-21 | client-staged run | entity/role | "started and rendered entirely on the client, unchanged from the original MVP behavior" | prd.md:44 | `start` procedure simulation.ts:344 (vs. `startServer` 357) | "staging" |
| T-22 | watch / live view | operation | "view exactly one server-run simulation at a time, rendered live from server-pushed state" | prd.md:41 | `watchServerRun` server-run-registry.ts:853; `watcherIds` server-run-registry.ts:132 | — |
| T-23 | save / pause | operation | "stop the simulation at any moment and save its state" | prd.md:141 | `savePause` simulation.ts:1175 | — |
| T-24 | resume | operation | "resume a saved simulation" | prd.md:143 | `resume` simulation.ts:1237; `resumeServerRun` server-run-registry.ts:759 | — |
| T-25 | dashboard | entity (view) | "running/saved/completed runs, status, start time, filters, detail link" | prd.md:42 | `listRunning`/`listSaved`/`listCompleted` simulation.ts:616,645,671 | — |
| T-26 | analysis view | entity (view) | "population-over-time chart, phase/cycle breakdown, final genetic-diversity value" | prd.md:43 | `getRunAnalysis` simulation.ts:808 | — |
| T-27 | leaderboard | entity (view) | "the user's own highest-scoring runs" | prd.md:51 | `listLeaderboard` simulation.ts:723 | — |
| T-28 | parameter-suggestion heuristic | operation/policy | correlation between each of 13 parameters and final score; suggests the strongest | prd.md:153 | `getParameterSuggestion`/`pearsonCorrelation` parameter-suggestion.ts:123 | — |
| T-29 | run-specific optimization suggestion | operation | "derived from that single run's own phase/resource history" | prd.md:191 | `run-optimization-suggestion.ts` | — |
| T-30 | export | operation | "export a run/parameters/score outside the app, JSON and CSV" | prd.md:156 | `run-export.ts` | — |
| T-31 | role (admin / member) | role (2-valued) | admin sets ranges/caps; member runs within them | prd.md:247,249 | `users.role` enum schema.ts:47 | — |
| T-32 | temporary admin elevation | operation/policy | "reversible (not a permanent role change)" | prd.md:202 | `users.elevatedUntil` schema.ts:55; `elevateSelf` user.ts:38 | — |
| T-33 | spatial partitioning | policy (performance) | "grid-based neighbor search instead of a full pairwise scan, O(N²)→O(N) per tick" | prd.md:197 | `buildSpatialGrid` (referenced, not opened this pass) | — |
| T-34 | area / xyArea / zDepth | value | "full configured 3D volume (xyArea × xyArea × zDepth)" | prd.md:136 | `simulationRuns.xyArea`/`zDepth` schema.ts:128-129 | — |
| T-35 | live parameter adjustment | operation | "nudge flocking weights, food regen, protection threshold while ticking; live view responds next tick" | roadmap.md:35 | `applyLiveParams` server-run-registry.ts:216 | "live-tuning" |
| T-36 | unwatched-run tick throttling | policy | "unwatched runs tick faster than real time so they don't compete for CPU" | capacity-limits.md:40; archived S-36 | `tick()`'s `isThrottled`/`speedMultiplier` server-run-registry.ts:512-514 | — |
| T-37 | determinism | policy | "same parameters + seed produce the same score" | prd.md:60 | seeded `createRng(seed)` — **see D-01, now contradicted by T-36** | — |
| T-38 | guardrail | policy (thesis label) | recurring label for product-wide invariants | prd.md:114,161 | — (a documentation label, not a code concept) | — |

Totals: 38 terms in the table (all from the documents-read evidence); the 2-code-language evidence file independently surfaced the same concepts with no additional Core/Supporting term the documents hadn't already named — agreement is real (the two language agents worked without seeing each other's findings). Missing-in-code by kind: 4 implicit/no-dedicated-type (hunger T-09, predation-as-event, mating pair, watcher — the last three are code-only concepts below, not document terms), 0 genuinely absent Core/Supporting terms (every documented term that should have code does).

**Code-only concepts** (named in code, not as their own term in the documents sampled — *searched in docs*, not merely unread):
- "cohesion" (`computeCohesion`, boids.ts:1226) — explicitly self-flagged in its own comment as a "mislabeled stand-in for genetic diversity," superseded for scoring but still collected. *Searched in docs*: not found as a named score factor anywhere in prd.md.
- "run slot" (`MAX_PARALLEL_RUNS`, run-slots.ts) — per-user concurrent-`running`-row cap, distinct from the object-count ceilings. *Not in the docs sample* (prd.md/roadmap.md excerpts read did not name this specific cap).
- "dense-cluster warning" (`DenseClusterWarnSink`, boids.ts:468) — an engine-internal performance/correctness signal. *Searched in docs*: not found; purely an engineering concept.

## Multiple meanings and context boundaries

| id | word | meaning A (context, source) | meaning B (context, source) | suggested names |
|---|---|---|---|---|
| B-01 | "parallel" | pre-2026-11-14: client-rendered parallel simulations (shape-notes.md:59) — **superseded**, see Stale Documents | post-extension: independent server-owned runs ticking concurrently, one viewed at a time (prd.md:41,146) | keep "parallel" only for meaning B; call meaning A "multi-render" if ever discussed historically |
| B-02 | "status" | `simulationRuns.status` — run lifecycle (`running`/`stopped`/`saved`, schema.ts:130) | `feedbackReports.status` — send/retry queue (`pending`/`sent`/`abandoned`, schema.ts:205); also `ApplyLiveParamsResult.status` (`applied`/`not-found`/`throttled`, server-run-registry.ts:202) | qualify in code/comments: "run status" vs. "feedback-send status" vs. "live-edit result" |
| B-03 | "population" | generic: `reproducePopulation<T>`'s input (either species, boids.ts:820) | specific: "population phase"/"population wipe" (single-run-lifecycle.ts:211), meaning the boid population only | no change needed — scope is clear from surrounding code, flagged for awareness only |

## Subdomains

| subdomain | class | concepts | why (goal quote, or description and usage) |
|---|---|---|---|
| Flocking & Predator-Prey Simulation Engine | Core | T-01..T-10, T-17 | "The gap isn't swarm simulation itself; it's turning trial-and-error tuning into a measurable, resumable experimentation loop" (prd.md:25) — this IS the product. |
| Scoring & Evaluation | Core | T-13..T-16, T-18, T-37 | "every run ends in a deterministic, repeatable score" (roadmap.md:35) — the explicitly-named product wedge. |
| Run Lifecycle & Orchestration | Supporting | T-19..T-27, T-35, T-36 | Needed and specific (server-owned vs. staged, watch/save/resume are this product's own concurrency model), but not where the product "wins" — a generic job-runner could orchestrate runs; nothing here is the reason users come. |
| Parameter Governance | Supporting | T-11, T-12, T-28..T-29, T-31..T-33 | Admin ranges/caps and the two suggestion heuristics support experimentation but aren't themselves the swarm-behavior value. |
| Performance Engineering | Supporting | T-33, T-34 | Spatial partitioning and configurable area are specific to this engine's scale needs, not generic infrastructure, but also not the "why." |
| Identity & Access (NextAuth) | Generic | users/accounts/sessions tables | Solved the same way everywhere; a library/vendor (NextAuth + GitHub OAuth) does this. Counted only. |
| In-app Feedback | Generic | feedbackReports, GitHub-Issues retry queue | A generic bug/idea-reporting mechanism, not domain-specific. Counted only. |
| Export & Reference docs | Generic/peripheral | T-30, reference pages | Utility features around the Core, not load-bearing to the hypothesis. Counted only. |

## Invariants and policies

| id | candidate | invariant (quoted) | source | status | guarded at | gap |
|---|---|---|---|---|---|---|
| R-01 | crossbreeding | "a run with crossbreeding disabled must never produce a blended-flock-color offspring" | prd.md:72 | **enforced** | boids.ts:902-907 (hard skip-candidate) | none found |
| R-02 | protection threshold | "a flock at or below the protection threshold is never attacked" | prd.md:73,126 | **enforced** | boids.ts:992-994 (hard early-return, no capture logic runs at all) | none found |
| R-03 | resume fidelity | "stopping and resuming reproduces the exact population/resource state at the moment of stop" | prd.md:74 | **enforced** | `ServerRunSnapshot` server-run-registry.ts:696-726 (full-state persistence); independently confirmed by a bit-identical-RNG-resume test (per the sim-engine-feature-analysis artifact's test-coverage audit) | none found |
| R-04 | determinism | "two runs started with identical parameters and the same random seed produce identical scores" | prd.md:60,218 | **contradicted** | seeded `createRng` — but see **D-01**: the shipped unwatched-run-tick-throttling feature (T-36) deliberately breaks this for any run that was ever unwatched long enough to throttle | the code already names the exception (`wasEverThrottled`); the PRD's NFR text was never amended to state it |
| R-05 | per-user data isolation | "the dashboard shows only the logged-in user's own runs"; "a user cannot open another user's run analysis view"; no cross-user admin capability was added | prd.md:96,98,267 | **enforced** | every list/get query scoped `eq(simulationRuns.userId, userId)` (simulation.ts:635,659,687,723,779); `getRunAnalysis`/`getRunsComparison` per-row ownership check (818-826, 931-942); confirmed no admin-role bypass exists anywhere in the same file | none found — searched every procedure in simulation.ts for a role-conditioned filter relaxation |
| R-06a | per-run object cap (start time) | "reproduction respects the global object limit (FR-018)" | prd.md:119,161 | **enforced** | simulation.ts:242-247 (hard reject at start) | none found |
| R-06b | per-run object cap (live edit) | same rule, applied to live population edits | prd.md:119 (implied — doc doesn't distinguish start-time vs. live-edit enforcement strength) | **declared** | `checkPerRunObjectCapSoft` simulation.ts:162-172 (warning only, still applies the edit) | a live population bump can push a run over its own per-run cap with only a warning, not a reject — the PRD doesn't say whether this is intended |
| R-07 | in-tick combined cap | "above the limit, reproduction is paused" | prd.md:119 | **enforced** | boids.ts:862-869 (soft/silent per an explicit documented decision — blocked pairs produce no offspring, no throw) | none — this soft/silent shape is itself the documented design, not a gap |
| R-08 | admin-settings singleton | (no document states this; code-only rule) | — | **declared** (code-only) | `ADMIN_SETTINGS_ID = 1` convention; explicitly NOT a DB constraint per schema.ts:161-165's own comment | a conscious, named trade-off — not an oversight, but genuinely unenforced against a two-process race |
| R-09 | cross-ceiling consistency | (no document states this; code-only expectation) | — | **ignored** | — | no guard found anywhere that `maxConcurrentObjectCount <= maxObjectCount` (or the reverse) — searched `updateParameterRanges` (simulation.ts:1298-1340) and `checkAgainstAdminRanges`; an admin can set these into a logically-inconsistent relative order |
| R-10 | save/restart fidelity | "a saved/paused simulation's state survives an app restart with no loss of population, genetic, or resource data" | prd.md:220 | **enforced** | `savedState` JSON persistence + explicit field-by-field fallback handling for pre-existing-field schema drift (per the sim-engine-feature-analysis artifact's blast-radius findings on `ServerRunSnapshot`) | none found |
| R-11 | FR-029 perf-neutrality | "the spatial-partitioning optimization must produce identical scores/behavior to the pre-optimization pairwise scan... any deviation is a bug" | prd.md:222 | **declared** | not independently re-verified in this pass (spatial-grid.ts was not opened by any evidence agent) | **unknown** — would need a dedicated read of spatial-grid.ts against this specific claim |

**Code-only rules** (guards found with no documented rule behind them): the 500ms live-edit throttle (`PARAM_UPDATE_THROTTLE_MS`, server-run-registry.ts:200) protecting the parameter-changelog from unbounded growth; the hard minimum-separation-distance geometric correction (boids.ts:91-95, "cannot be outweighed by cohesion regardless of weights") — both are real business knowledge nobody wrote into the PRD.

## Model vs code drift

| id | the documents say (newest) | the code does | evidence (path:line) | consequence | fix: code / docs / decision |
|---|---|---|---|---|---|
| D-01 | "Two runs started with identical parameters and the same random seed produce identical scores" (prd.md:60, restated prd.md:218, never amended) | A run that is ever unwatched for ≥5s ticks at 3x speed (`speedMultiplier`), changing its simulated-time trajectory and therefore its score, even with identical seed+params to an always-watched twin — shipped and merged 2026-11-17 | `server-run-registry.ts:512-514` (`isThrottled`/`speedMultiplier`); `context/archive/2026-11-17-unwatched-run-tick-throttling/` (the shipping decision); `roadmap.md:816` ("a fixed dtSeconds multiplier... changes... the determinism model every existing scored/analyzed/compared run depends on") | A user comparing two runs via the comparison view or leaderboard may see different scores for the "same" seed+params with no PRD-level explanation of why — only the code's own `wasEverThrottled` marker and badge disclose it | **docs** — the decision is already made and shipped (the code's own comparability marker IS the fix-in-practice); the PRD's NFR text at prd.md:60 needs one added clause carving out throttled runs, citing this same archived decision |

No other live code-vs-documents contradictions were found in the evidence read. (Two historically-looking conflicts — the "parallel" meaning shift and the 3→4→5-factor scoring evolution — turned out to be fully self-resolved in-document already; see Stale Documents below, not listed as drift since no code violates either document's current, newest statement.)

## Stale documents

- `shape-notes.md:59` ("run several simulations in parallel and switch... without losing the others' progress," meaning client-rendered parallel simulations) — superseded by `prd.md:41`'s Non-Goals: "No client-driven parallel rendering of multiple simulations at once... retired in favor of server-owned execution." The PRD itself performs this supersession explicitly; no further documentation action needed beyond awareness that `shape-notes.md` no longer describes current behavior.
- `shape-notes.md:79` (3-factor scoring formula, weights fully open) — superseded by `prd.md:131-136` (5-factor formula, FR-010/FR-019/FR-035, with the PRD's own dated Socratic resolution notes at `prd.md:132-137`). Already tracked in-document as an explicit, forward-only-policy evolution (`prd.md:133`), not a live contradiction.

## Ranking

| # | candidate | kind | subdomain | status | related IDs | reason | done when |
|---|---|---|---|---|---|---|---|
| 1 | Determinism NFR vs. tick throttling | invariant/policy | Scoring & Evaluation | contradicted | R-04, D-01 | **#1 — reason**: this is the only *contradicted* finding in the whole distillation, it sits in the Core subdomain the product's entire value proposition depends on ("every run ends in a deterministic, repeatable score"), and the fix is nearly free — the code's own mitigation already exists, only the PRD text is stale. | `prd.md`'s determinism NFR (line 60) explicitly states the throttling exception, citing the S-36 decision, with no other wording change needed. |
| 2 | Cross-ceiling consistency (maxConcurrentObjectCount vs. maxObjectCount) | code-only policy | Parameter Governance | ignored | R-09 | Core-adjacent (gates how many objects can ever run), currently silent — an admin could configure a logically-backwards pair of ceilings with no warning anywhere. | A targeted test asserting `updateParameterRanges` rejects (or the UI warns on) `maxConcurrentObjectCount > maxObjectCount` passes; today no such test exists and none would catch the inconsistency. |
| 3 | Per-run object cap, live-edit path (soft only) | invariant/policy | Flocking & Predator-Prey Simulation Engine | declared | R-06b | Supporting-but-Core-adjacent: a live population bump can silently exceed the same cap that's hard-enforced at start, with only a console warning — inconsistent strictness for the same named rule. | `adjustLivePopulation` either rejects (matching start-time strictness) or the PRD explicitly states live edits are intentionally softer than start-time caps — either resolves the inconsistency. |
| 4 | FR-029 perf-neutrality (spatial-hash determinism claim) | policy | Performance Engineering | declared (unverified) | R-11 | Lower priority: no evidence of an actual violation, just an unverified claim — `spatial-grid.ts` was out of every evidence agent's read scope. | A dedicated read of `spatial-grid.ts` against the pairwise-scan output, for a fixed seed, confirms byte-identical results — or surfaces a second contradicted finding. |

## Questions

| id | question | who can answer | unblocks |
|---|---|---|---|
| Q-01 | Is "tribe" (prd.md:202) a planned-but-unbuilt concept distinct from "flock," or just an old/casual synonym the PRD should drop? | product owner (the builder themselves) | T-03's "other names" column; whether a future `Tribe` type is ever warranted |
| Q-02 | Should the determinism NFR (R-04/D-01) be amended now, or is this intentionally left for a future documentation pass? | product owner | #1 ranking item's "done when" — the fix itself is a one-line PRD edit, but someone still has to decide to make it |
| Q-03 | Is the soft-only live-edit object-cap enforcement (R-06b) intentional (live edits are meant to be more permissive than start-time config) or an oversight? | product owner / whoever designed the live-parameter-adjustment feature (roadmap S-27) | #3 ranking item |

## Unknowns and limitations

- Only 3 of 65 archived change-id bodies were opened in full (`genetic-inheritance-crossbreeding/change.md`, and two read attempts on `phase-quality-per-cycle-scoring` that failed — the file doesn't exist under that name); the other 63 were used only as directory-name corroboration. A richer vocabulary pass on S-13 through S-38's full prose (roadmap.md lines 384-856, not read this session) and the genetics/scoring-focused archive bodies would likely surface finer domain wording than captured here.
- `spatial-grid.ts`, `rng.ts`, `seed-colors.ts`, `camera.ts`, `run-slots.ts`, `send-report.ts`, `trpc.ts`, `env.js`, `auth/config.ts` were referenced via imports/comments by the code agents but not opened — several specific unknowns depend on them (R-11's perf-neutrality claim, `MAX_PARALLEL_RUNS`'s actual value, `isEffectivelyAdmin`'s exact lapse logic, whether `simulationRuns.status`'s Drizzle enum compiles to a real SQL CHECK constraint).
- The temporary-admin-elevation mechanism's own defining text (likely `context/archive/2026-11-14-temporary-admin-elevation/plan.md`) was not opened by the docs-language agent — its outcome is confirmed resolved via the roadmap's summary only, not the mechanism's own definition.
- T-18's resilience-bonus exact formula/magnitude is explicitly deferred to `/10x-plan` by the PRD itself (prd.md:178,239) — not a distillation gap, a genuinely open product decision the PRD already flags as such.
- No requirements document was missing or hollow — this is the opposite of the typical distillation limitation; the PRD's own versioning discipline (dated Socratic notes, explicit "Resolved" markers) meant most would-be document conflicts were already self-resolved in-document before this pass began.
