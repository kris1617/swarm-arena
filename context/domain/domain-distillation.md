---
artifact: domain-distillation
created: 2026-11-20
repo_root: /home/kris/10xdevs
code_scope: whole repository (tools/ai-reviewer excluded as CI tooling, not domain)
head: eaede3c
dirty: none
documents: 1 requirements (prd.md, full), 1 narrative (roadmap.md, lines 1-370/1138 read), 2 reference (test-plan.md §2, lessons.md full), 2 archived-plan samples (per-tribe-behavior-weights, predator-tribe-concept, partial)
previous: context/archive/2026-11-17-1307-domain-distillation/domain-distillation.md
evidence: context/domain/evidence/
glossary: context/domain/glossary.md
---

# Domain distillation: swarm-arena

## Summary

swarm-arena's Core domain is the boids/predator-prey flocking simulation itself — its tick mechanics, scoring, and the per-tribe genetic/behavioral configuration system that has grown substantially since the last distillation (2026-11-17). Of 20 Core/Supporting terms tracked, 3 are missing a dedicated code name (tribe has no identity beyond an array index; "comparability" and "run origin/mode" are implicit, column-only concepts). The strongest drift is unchanged and still open: the PRD's determinism NFR ("identical seed+params → identical score") is directly contradicted by the shipped unwatched-run tick-throttling feature, which the code already names (`wasEverThrottled`) but the PRD text was never amended to carve out. A genuinely new finding this pass: the DB schema still calls the per-boid grouping concept `flock` (`flockId`, `flockCount`) while every type, comment, and newer mutation name calls the identical concept `tribe` (`TribeConfig`, `updateTribeConfigs`) — a code-internal naming split, not a docs-vs-code drift. Drift by fix side: 1 docs, 2 decision, 0 code. Open questions: 2 (1 closed this pass, 1 new).

## Changes since the previous run

- **T-03 (flock/tribe)**: still open, but the shape changed — Q-01 asked whether "tribe" was a planned-but-unbuilt concept; it is now answered **yes, built**: F-09/F-10 shipped a full per-tribe/predator-tribe behavioral+genetic configuration system (`TribeConfig`, `PredatorTribeConfig`) since the last report. Q-01 closed; a new, narrower finding opened in its place — **D-03** (flock-vs-tribe naming split is now a code-internal inconsistency, not just a docs-vs-code one).
- **R-04 / D-01 (determinism vs. throttling)**: unchanged, still contradicted, still open (confirmed `speedMultiplier`/`isThrottled` logic still present at `server-run-registry.ts:737,777`). Still **#1**.
- **R-06b (soft per-run object cap on live edits)**: confirmed still open, and now shown to be one instance of a *broader* pattern — **all four** live-edit mutations (`updateRunParams`, `updateTribeConfigs`, `updatePredatorTribeConfigs`, `adjustLivePopulation`) soft-check admin ranges, not just the object cap. Widened into **R-06b** (same ID, broadened scope) plus a new related row for the general parameter-range check.
- **New**: T-39 (predator tribe, now a full concept with its own config/genetics — was only a roadmap line last time), T-40 (prey target), R-12 (live-edit parameter-range check is soft across all four mutations, a sibling of R-06b), D-03 (flock/tribe code-internal naming split), Q-04 (whether the soft-live-edit pattern across all four mutations is one deliberate decision or four independent, uncoordinated ones).
- **Closed**: Q-01 (tribe is now built, not hypothetical).

## Ubiquitous language

| id | term | kind | definition (quoted) | source | in code (path:line) or **missing in code** | other names in code |
|---|---|---|---|---|---|---|
| T-01 | boid | entity | "boidy i predatory rozmnażają się" | prd.md:118 | `BoidGenes`/`BoidState` boids.ts:111,123 | "individual" |
| T-02 | predator | entity | "Predator nie może zaatakować stada... progu ochronnego" | prd.md:126 | `PredatorGenes`/`PredatorState` boids.ts:141,146 | — |
| T-03 | flock / tribe | entity | "stado definiuje jedynie wartości średnie... od których startują osobniki" (original, narrower) vs. F-09's much richer per-tribe behavior/genetics config (newer, built) | prd.md:120; roadmap.md:94 (F-09) | `TribeConfig` boids.ts:33 (type), `flockId`/`flockCount` schema.ts:91,104 (persistence) — **see D-03**, same concept, two names across layers | `FlockWeights` boids.ts:11 |
| T-04 | genes | value | "Każdy boid ma własny, indywidualny zestaw genów" | prd.md:120 | `BoidGenes` boids.ts:111 — carries both steering and reproduction traits in one flat type; `PredatorGenes` reuses the shape even for fields documented as behaviorally inert for predators (boids.ts:68-75) — **see B-04** | — |
| T-05 | genetic diversity | measure | score factor; "final genetic-diversity value" | prd.md:43,131 | `computeGeneticDiversity` boids.ts:2084 | — |
| T-06 | crossbreeding | operation/policy | "kolor potomka z krzyżowania międzystadowego jest blendem genów obu rodziców" | prd.md:122 | `crossbreedingEnabled` TribeConfig:61/PredatorTribeConfig:93; gate boids.ts:1251-1259 | — |
| T-07 | protection threshold | policy | "predator nie może zaatakować stada... przy lub poniżej progu" | prd.md:126 | `simulationRuns.protectionThreshold` schema.ts | — |
| T-39 | predator tribe | entity | "(foundation) Predators can belong to a tribe... each predator tribe carrying its own independently-evolving genetics" | roadmap.md:279 (F-10) | `PredatorTribeConfig` boids.ts:81; `predatorFlockCount`/`predatorTribeConfigs` schema.ts:183-184 | — |
| T-40 | prey target | value/policy | "chooses its prey target — boids only, or boids and predators" | roadmap.md:99 (S-43) | `preyTarget: "boids"\|"boids-and-predators"` boids.ts:100 | — |
| T-08 | score | measure | "iloczyn pięciu czynników" (current; see Stale Documents for the superseded four-factor text) | prd.md:131,227 | `computeScore` boids.ts:2437; `score` column schema.ts:119 | — |
| T-09 | population lifecycle phase | state (5-valued) | "Establishment / Growth / Overshoot / Crash / Recovery" | prd.md:231-236 | `PopulationPhase` boids.ts:2125; `classifyPopulationPhase` boids.ts:2139 — persisted only inside `history` JSON, not a column | — |
| T-10 | resilience bonus | policy/measure | "a resilience bonus specifically for completing a Crash → Recovery transition" | prd.md:239 | `segmentCompletedCycles` boids.ts:2211 (not independently re-verified this pass) | — |
| T-11 | run / simulation run | entity (lifecycle) | "symulacja" with states running/saved/completed | prd.md:182 | `simulation_run` table schema.ts:84 — **no `SimulationRun` type**, row shape implicit | — |
| T-12 | server-owned run | entity/role | "wykonywana przez proces po stronie serwera, niezależny od połączenia klienta" | prd.md:166 | `runMode:"server"` schema.ts:196; registry membership (server-run-registry.ts) | — |
| T-13 | client-staged run | entity/role | "uruchamiana i renderowana w całości po stronie klienta" | prd.md:170 | `start` procedure, `runMode:"client"` | "staging" |
| T-14 | admin / member | role (2-valued) | "two roles: `admin` and `member`" | prd.md:247 | `users.role` enum schema.ts:33 | — |
| T-15 | temporary admin elevation | operation/policy | "reversible (not a permanent role change)" | prd.md:202 | `elevatedUntil` schema.ts:41; `elevateSelf` user.ts:38 | — |
| T-16 | object-count cap | policy/value | "globalny maksymalny limit liczby symulowanych obiektów" | prd.md:161 | `maxObjectCount` adminSettings; hard guard simulation.ts:376-381 | — |
| T-17 | parameter-suggestion heuristic | operation | "heurystyka, nie pełna optymalizacja" | prd.md:152-153 | `ParameterSuggestion` parameter-suggestion.ts:29 — **see B-05**, same word as T-18 | — |
| T-18 | run optimization suggestion | operation | "distinct from FR-015's cross-run heuristic... derived from that single run's own phase/resource history" | prd.md:191 | `RunOptimizationSuggestion` run-optimization-suggestion.ts:17 | — |
| T-19 | spatial partitioning | policy (perf) | "O(N²) → O(N) per tick" | prd.md:197 | referenced, not independently re-verified this pass (spatial-grid.ts not opened) | — |
| T-20 | unwatched-run tick throttling | policy | "unwatched runs no longer compete equally for CPU" | roadmap.md:90 (S-36) | `isThrottled`/`speedMultiplier` server-run-registry.ts:737,777 — **see R-04/D-01** | — |

Totals: 20 Core/Supporting terms tracked (of ~30 found in evidence; remaining are Generic/peripheral, counted not tabled: feedback-report fields, leaderboard/dashboard view names, export formats — 6 terms). Missing-in-code: 0 full misses; 1 term (T-11, `run`) has no dedicated type though its table/procedures are unambiguous — not counted as missing, flagged as implicit-by-convention.

Code-only concepts (no documented term): `ParameterRange`/`RangedParameterName` (parameter-ranges.ts) — *searched in docs*, not found by name, inferred from FR-018/FR-035's parameter language; `PopulationPhase`'s exact threshold constants (`CRASH_POPULATION_DROP_THRESHOLD` etc.) — *not in the docs sample*, the phases themselves are documented but not their numeric thresholds.

## Multiple meanings and context boundaries

| id | word | meaning A (context, source) | meaning B (context, source) | suggested names |
|---|---|---|---|---|
| B-02 | "status" | `simulation_run.status` — run lifecycle: `running`/`stopped`/`saved` (schema.ts:116) | `feedback_report.status` — send/retry queue: `pending`/`sent`/`abandoned` (schema.ts:233) | qualify in code/comments: "run status" vs. "feedback-send status" |
| B-04 | "genes" | per-individual steering traits (separation/cohesion/alignment weights) — behaviorally load-bearing for both species | reproduction traits (matePreference, maxLifespan) carried on the same flat `BoidGenes`/`PredatorGenes` type, though several fields are documented inert for predators (boids.ts:68-75) | split into `SteeringGenes`/`ReproductionGenes` if the inert-field confusion ever causes a real bug; currently cosmetic |
| B-05 | "suggestion" | `ParameterSuggestion` — cross-run, Pearson-correlation heuristic recommending a parameter change (parameter-suggestion.ts) | `RunOptimizationSuggestion` — single-run diagnosis tied to `PopulationPhase` patterns, not correlation (run-optimization-suggestion.ts) | "parameter suggestion" vs. "run diagnosis" in UI copy and comments — code already distinguishes the types, prose doesn't always |

## Subdomains

| subdomain | class | concepts | why (goal quote, or description and usage) |
|---|---|---|---|
| Simulation engine (tick/genetics/scoring) | **Core** | boid, predator, tribe, predator tribe, genes, crossbreeding, population lifecycle phase, score | "the entire product is this simulation" (repo-map.md TL;DR, cross-checked against the PRD's own framing of the product as "start a boids+predator simulation... receive a score") |
| Run lifecycle & ownership | **Core** | run, server-owned run, client-staged run, save/pause/resume, watch | the product's second reason-to-exist: making the simulation observable/resumable/comparable over time (prd.md:40-44, 68) |
| Parameter governance (admin ranges, elevation) | Supporting | object-count cap, admin/member role, temporary admin elevation, parameter-suggestion heuristic | needed to keep the Core domain usable/safe at scale, not itself why users come |
| Views (dashboard, leaderboard, analysis, comparison) | Supporting | — | presentation of Core-domain results, not the simulation itself |
| Auth / sessions | Generic | login, session | "Login (email/OAuth)" — solved identically to any SaaS product, not a differentiator |
| Feedback reporting | Generic | feedback_report, category, retry queue | a standard bug/idea intake mechanism, could be any helpdesk tool |

## Invariants and policies

| id | candidate | invariant (quoted) | source | status | guarded at | gap |
|---|---|---|---|---|---|---|
| R-01 | crossbreeding | "a run with crossbreeding disabled must never produce a blended-flock-color offspring" | prd.md:72 | **enforced** | boids.ts:1251-1259 (hard skip, missing config index defaults false) | none found |
| R-02 | protection threshold | "a flock at or below the protection threshold is never attacked" | prd.md:73,126 | **enforced** | boids.ts (hard early-return per prior pass; not re-opened this pass — carried forward) | none found |
| R-03 | resume fidelity | "stopping and resuming reproduces the exact population/resource state" | prd.md:74 | **enforced** | `ServerRunSnapshot` persistence (carried forward, not re-opened this pass) | none found |
| R-04 | determinism | "identical parameters and seed produce identical scores" | prd.md:60,218-219 | **contradicted** | seeded `createRng` — but see **D-01** | code already names the exception (`wasEverThrottled`); PRD text never amended |
| R-05 | per-user data isolation | "a user cannot open another user's run analysis view"; "the dashboard shows only the logged-in user's own runs" | prd.md:96,98,267 | **enforced** | hand-duplicated ownership check at every runId-scoped procedure (simulation.ts:814,1214,1472,1534,1601,1670,1755,1817) — consistent, no shared helper/RLS | DB would accept a cross-user write if the app-layer check were ever skipped at a new call site — no second layer backs it |
| R-06a | per-run object cap (start time) | "reproduction respects the global object limit" | prd.md:119,161 | **enforced** | simulation.ts:376-381 (hard reject) | none found |
| R-06b | per-run object cap (live edit) | same rule, applied to live population edits | prd.md:119 (doesn't distinguish start vs. live-edit strength) | **declared** | `checkPerRunObjectCapSoft`, used only by `adjustLivePopulation:1701` — warning only, still applies | a live population bump can push a run over its own per-run cap with only a warning |
| R-12 | admin parameter ranges (live edit, general) | same FR-018/admin-range language as R-06b, generalized to every numeric parameter, not just object count | prd.md:161 (implied, same gap as R-06b: doesn't distinguish enforcement strength) | **declared** | `checkLiveParamRangesSoft` (simulation.ts:1488,1551-1562,1618-1629,1697-1700) — all four live-edit mutations (`updateRunParams`, `updateTribeConfigs`, `updatePredatorTribeConfigs`, `adjustLivePopulation`) collect warnings, never reject | stated as deliberate in code comments (simulation.ts:1441-1446), but the PRD never distinguishes "hard at creation, soft for the life of a run" as an intended asymmetry — **see Q-04** |
| R-13 | live-edit throttle consistency | (no document states this; code-only expectation, found enforced) | — | **enforced** (code-only rule) | single shared `lastParamUpdateAt` field, checked+set by all four live-edit mutations (server-run-registry.ts:301-309,367-375,441-449,518-526) — confirmed consistent, cannot be bypassed by alternating mutations | none found — genuinely well-guarded, worth naming as a code-only rule nobody wrote down |
| R-14 | cross-tribe mating gate | (code-only; mirrors T-06/R-01 but as an independent guard shape) | — | **enforced** (code-only) | missing/undefined tribe config index reads as falsy, defaults to "no crossbreeding" rather than throwing | none — a deliberately safe default, not a gap |

Code-only rules not tied to a documented invariant: atomic-transaction use is limited to exactly one place (`getOrSeedAdminSettings`, simulation.ts:179-247); every other multi-step write (run creation, server-run registration) is non-transactional with hand-written compensating `status:"stopped"` writes on failure — acknowledged directly in comments, not flagged as a drift since no document claims atomicity.

## Model vs code drift

| id | the documents say (newest) | the code does | evidence (path:line) | consequence | fix: code / docs / decision |
|---|---|---|---|---|---|
| D-01 | "Two runs started with identical parameters and the same random seed produce identical scores" (prd.md:60,218, never amended) | A run ever unwatched ≥ some threshold ticks at `THROTTLE_SPEED_MULTIPLIER`, changing its simulated-time trajectory and score even with identical seed+params | server-run-registry.ts:737,777 (`isThrottled`/`speedMultiplier`); `context/archive/2026-11-17-unwatched-run-tick-throttling/` (the shipping decision) | A user comparing two "same-seed" runs may see different scores with no PRD-level explanation | **docs** — already shipped and named in code (`wasEverThrottled`); the PRD's NFR text needs one clause carving out throttled runs |
| D-03 | *(code-internal, not a docs-vs-code drift — included here because it's the sharpest naming inconsistency found this pass)* | DB/persistence layer calls the concept `flock` (`flockId`, `flockCount`, `splitCountAcrossFlocks`); every type, newer mutation, and comment calls the identical concept `tribe` (`TribeConfig`, `updateTribeConfigs`, "per-tribe") | schema.ts:91,104 vs. boids.ts:33, simulation.ts:1520 | A newcomer reading the schema first will not recognize `TribeConfig` as the same concept without cross-referencing; a future migration or rename decision is needed to reconcile them | **decision** — see Q-04-adjacent question below; whoever owns the schema decides whether to rename the DB columns (a migration) or formally adopt "flock" as the DB-layer name and "tribe" as the domain-layer name (a documented, deliberate split) |

## Stale documents

- prd.md:132's original four-factor score-product text is superseded by the five-factor text at prd.md:227 (FR-035, 2026-11-15 addition) — both are quoted in the PRD itself with an explicit forward-only non-comparability clause; not a drift, already self-documented.
- prd.md:134's original "one-time resilience flag" text is superseded by its own "(uszczegółowienie, 2026-11-14)" annotation scaling the bonus by completed-cycle count — same document, both quoted, newer wins.

## Ranking

| # | candidate | kind | subdomain | status | related IDs | reason | done when |
|---|---|---|---|---|---|---|---|
| 1 | Determinism vs. unwatched-run throttling | policy | Simulation engine | contradicted | R-04, D-01, T-20 | **#1 because it breaks a product-wide NFR the PRD states twice (prd.md:60,218) and the comparison/leaderboard views directly expose the inconsistency to users — not a narrow internal gap but a user-visible contradiction of a stated guarantee.** | The PRD's determinism NFR text names the throttling exception explicitly, citing the same archived decision the code already marks with `wasEverThrottled` |
| 2 | flock/tribe code-internal naming split | aggregate candidate (implicit identity) | Simulation engine | declared-as-found (code-internal drift) | D-03, T-03 | Spans 9 files by prior count (schema, 3 domain files, router, 2 client components, page) — the widest blast radius of any single naming inconsistency found, and it compounds every time someone reads the schema before the types | `rg -i "flock" src/` returns zero hits outside `schema.ts`'s own column/migration names (or the opposite, if "flock" is chosen as the surviving name) |
| 3 | Soft live-edit parameter-range enforcement (general) | policy | Parameter governance | declared | R-12, R-06b, Q-04 | A deliberate design per code comments, but spans all four live-edit mutations uniformly enough that it reads as a real governance gap rather than four independent choices — worth a single explicit decision | A product-owner-confirmed answer to Q-04 either closes this as intentional (update PRD/test-plan to say so) or opens a follow-up to make live edits hard-reject like creation-time checks |
| 4 | Per-user data isolation's single-layer guard | policy | Run lifecycle & ownership | enforced, but single-layer | R-05 | Currently correct everywhere checked, but the hand-duplicated pattern (9 separate procedures, no shared helper) means a future new procedure could forget the check with nothing else catching it | A shared ownership-check helper (or an eslint/ast-grep rule) exists, OR a passing test exists that fails if any new runId-scoped procedure omits the check |

## Questions

| id | question | who can answer | unblocks |
|---|---|---|---|
| Q-02 | Should the determinism NFR (R-04/D-01) be amended now, or left for a future documentation pass? | product owner | #1 ranking item's "done when" |
| Q-04 | Is the soft-only live-edit parameter-range enforcement (R-12/R-06b, all four live-edit mutations) one deliberate, coordinated decision, or four independently-made choices that happen to agree? | product owner / whoever designed live-parameter-adjustment (roadmap S-27) | #3 ranking item; also decides whether D-03's flock/tribe split deserves the same "is this coordinated or accidental" framing |

Closed this pass: **Q-01** ("is tribe a planned-but-unbuilt concept?") — answered yes, built (F-09/F-10 shipped a full per-tribe/predator-tribe system); superseded by the narrower D-03.

## Unknowns and limitations

- **Narrative sample is partial**: roadmap.md was read lines 1-370 of 1138 (frontmatter through Slices S-07); titles/outcomes for all 53 slices were visible via the At-a-glance table, but Slices S-08 onward's own detail sections were not read — any domain nuance specific to those slices' own prose is unconfirmed.
- **Code areas not opened this pass**: `single-run-lifecycle.ts`, `server-run-registry.ts` (code-language agent only grepped, didn't read in full — may hold vocabulary like "watchers"/throttle-multiplier not captured here); `src/server/feedback/*.ts` (feedback-router vocabulary beyond the schema unconfirmed); `schema.ts` DB-level constraints (whether any app-layer guard above is also backed by `NOT NULL`/`CHECK`/unique — not checked); `parameter-ranges.ts`'s own `DEFAULT_PARAMETER_RANGES` definitions (only its consumption was inspected); `isEffectivelyAdmin`'s own implementation (only its call site read; the lapse-check logic is inference from a comment, not verified directly); the predator-mating loop's own crossbreeding check, if structurally separate from the boid loop read at boids.ts:1251-1259.
- **"imbalance" searched, not found**: the literal string does not appear in prd.md, the roadmap pages read, test-plan.md §2, or lessons.md — it is purely a code/schema term (`wasEverFoodImbalanced`, `wasEverPredatorTribeImbalanced`) with no documented business framing; not escalated to a drift row since no document makes a claim this contradicts, but worth a question if the team wants it named in the PRD.
- **Scheduled/async work**: `wasAutoStopped`'s reconciliation-sweep trigger (cron/queue/startup) was not located in the files read this pass — implied to exist (per a code comment referencing `fix-default-start-failure`) but unconfirmed.
- **R-01/R-02/R-03/R-10/R-11 carried forward from the 2026-11-17 report without re-verification this pass** — their underlying code was not re-opened; flagged here rather than silently re-asserted as freshly confirmed.
