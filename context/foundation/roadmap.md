---
project: swarm-arena
version: 1
status: draft
created: 2026-11-09
updated: 2026-11-17
prd_version: 5
main_goal: quality
top_blocker: decisions
milestone_id: per-tribe-config-and-predator-expansion
milestone_seq: 10
milestone_status: open
---

# Roadmap: swarm-arena

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-10: Per-tribe configuration and predator expansion** — Status: open

- **Intent:** Fix the reported default-parameter start failure, then extend the simulation's configuration model from "one shared setting per run" to "settings that vary per tribe" — for boid behavior, food, and predators — following the per-tribe pattern already proven in the user's own prior LÖVE2D/Lua boids implementation (`/mnt/Kids/boids_final/game/src/config.lua`), and finally add a second, distinct predator tribe with a configurable prey target (boids only, or boids and predators) — a predation relationship that does not exist in the Lua reference or anywhere in the current codebase.
- **Source materials:** user description (2026-11-17) + reference implementation at `/mnt/Kids/boids_final/game/src/config.lua` and `Predator.lua`, anchors below
- **Done when:** S-39 through S-43 are all `done` (F-09 is this milestone's sole foundation).
- **Scope anchors:**
  - MS-01: Fix the bug where starting a simulation with the form's own default parameter values does not work.
  - MS-02: Boid tribes get their own per-tribe behavior configuration (at minimum separation/alignment/cohesion weight), not one value shared across every tribe in a run — mirroring the Lua reference's per-tribe `config.lua` entries.
  - MS-03: Food gets per-tribe configuration (stock/regen), not one shared pool/rate for the whole run.
  - MS-04: Predators get per-tribe configuration, the same way boids do.
  - MS-05: A second predator tribe can be added to a run with a configurable prey target — boids only, or boids and predators — a mechanic new relative to both the Lua reference (single global predator type, boids-only hunting) and the current codebase.

## Vision recap

A hobbyist wants to tune boids/predator-prey simulations and know, objectively, whether a parameter change actually helped — not just eyeball the animation. The product's wedge (the one trait that, if removed, makes this just another flocking demo) is that every run ends in a deterministic, repeatable score combining survival time, resource management, and genetic diversity, so variants can be compared rather than guessed at. M-1 built the scoring and the per-run analysis view; M-2 made comparison and suggestion literal; M-3 modernized the UI, added a leaderboard and reference pages, and ported a spatial-hash performance optimization; M-4 made the simulation's own spatial scale a first-class, user-controlled dimension and added an area-aware score factor, an in-app feedback channel, and VPS-bound capacity limits. Today, once a run starts, its parameters are frozen until it stops — tuning means stop, reconfigure, restart, and lose the run in progress. M-5 closed that loop for the server-owned execution path: the user can nudge flocking weights, food regen, and the protection threshold while a run is actively ticking, and watch the live view respond on the very next tick. M-6 extended the same idea in the two directions M-5 explicitly parked: client-staged runs got the same live-tuning capability, and the server-owned path's live-adjustable set grew to cover the two population-shape parameters cheap enough to patch without restructuring the population itself (crossbreeding toggle, boid and predator count). M-7 was a smaller, independent move: the analysis view's genetic-diversity factor had only ever shown a single final number, even though every other score factor with a meaningful trajectory (population count, food availability) already gets its own chart — that milestone closed that one specific gap. M-8 turns inward: it validates two already-shipped features (the parameter-suggestion heuristic, FR-015; and the per-run analytics suite built across M-1/M-2/M-4/M-7) against a deliberately varied, reusable corpus of simulation runs, rather than adding new user-facing capability. M-9 closed out the roadmap's own bookkeeping — confirming two already-resolved design questions and deciding a genuinely open one (unwatched-run tick throttling). M-10 turns toward the simulation's configuration model itself: every boid in a run shares one global behavior-weight set regardless of tribe, and every predator shares one global tuning — the user's own prior Lua/LÖVE2D implementation of this same simulation already proved a richer, per-tribe model works (distinct color, speed, force, and per-behavior perception/multipliers per tribe), so this milestone first fixes a reported start-up failure, then brings that per-tribe differentiation to boids, food, and predators, and finally introduces a predation relationship — predator-on-predator — that exists in neither the Lua reference nor the current codebase.

## North star

**S-39: Fix default-parameter simulation start** — the smallest, most load-bearing fix in this milestone: the app is reportedly unusable with its own defaults today, which also blocks verifying every other slice in this milestone end-to-end. Sequenced first per the user's own explicit pick.

> "North star" here means the smallest end-to-end slice whose successful delivery proves the core product hypothesis — placed as early as its Prerequisites allow.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                                              | Prerequisites | PRD refs                                              | Status   |
| ---- | ------------------------------ | ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ | -------- |
| F-01 | gate-product-routes            | (foundation) Logged-in access with admin/member roles gates the app                | —              | FR-001, Access Control                                | done |
| F-02 | deterministic-seed-strategy    | (foundation) One seeded-PRNG approach is chosen and wired as the simulation's randomness source | —              | NFR: deterministic scoring                             | done |
| S-01 | basic-flocking-loop             | User starts a simulation with basic flocking, watches it run and stop, gets a survival-based score | F-01, F-02     | FR-001, FR-002 (partial), FR-003, FR-004 (partial), FR-010 (partial), FR-018, US-01 (partial) | done |
| S-02 | predator-prey-dynamics          | User sees predators hunt flocks, with protected flocks immune to attack, and hunger/death affecting population | S-01           | FR-005 (partial), FR-008, FR-009                       | done |
| S-03 | genetic-inheritance-crossbreeding | User sees population reproduce with inherited genes (including blended color) and can toggle inter-flock crossbreeding | S-02           | FR-005 (full), FR-006, FR-007                          | done |
| S-04 | full-score-save-resume          | User configures the full parameter set, stops/saves/resumes a run with exact fidelity, and gets a complete four-part score | S-03, F-01     | FR-002 (full), FR-010 (full), FR-011, FR-012, FR-019, US-01 (full) | done |
| S-05 | parallel-sim-switching          | User runs several simulations in parallel and switches which one is actively viewed | S-01           | FR-013, FR-014                                         | done |
| F-03 | server-side-simulation-engine   | (foundation) A simulation run can be ticked to completion by a server-owned process, independent of any client connection or browser tab | —              | MS-01, MS-02, US-01, FR-003, FR-013                    | done |
| F-04 | live-simulation-view-channel    | (foundation) The server can push a running simulation's current state to exactly one connected viewer in real time | F-03           | MS-04, FR-004, FR-014                                   | done |
| S-06 | start-server-run-simulation     | User starts a real (non-staging) simulation whose execution is owned by the server and keeps running after the browser tab is closed | F-03           | MS-01, US-01, FR-003, FR-013                            | done |
| S-07 | view-running-server-simulation  | User picks one of their currently-running server simulations and watches it render live in the browser from pushed state | S-06, F-04     | MS-04, FR-004, FR-014                                   | done |
| S-08 | server-run-list-and-switch      | User sees all their currently-running server simulations and switches which one is actively viewed, with the old client-driven switcher retired | S-07           | MS-05, FR-013, FR-014                                   | done |
| S-09 | phase-quality-per-cycle-scoring | User's score correctly rewards every completed lifecycle resilience cycle, not just whether one happened anywhere in the run | —              | MS-06, FR-019, FR-010 (full)                            | done |
| F-05 | persist-run-history             | (foundation) A finished run's tick-level population history (phase history, food-ratio samples, gene snapshots) is persisted instead of discarded | —              | MS-08, FR-019, FR-010 (full)                            | done |
| S-10 | post-login-run-dashboard        | User lands on a dashboard of their own runs right after logging in, with standard status/filter/detail-link conventions | F-01           | MS-07, FR-013, FR-014                                   | done |
| S-11 | run-analysis-view               | User opens a completed run's analysis view (growth-curve comparison, per-cycle phase breakdown, diversity-index trend) to decide what to change next | F-05, S-09, S-10 | MS-08, FR-019, FR-010 (full)                          | done |
| S-12 | compare-runs-side-by-side       | User selects two or more completed runs and compares their scores (and four-factor breakdowns) side by side | F-05, S-11      | FR-016                                                 | done |
| S-13 | parameter-suggestion-heuristic | User sees a heuristic-suggested next parameter change, correlated with improving their final score across past runs | F-05            | FR-015                                                 | done |
| S-14 | run-export                      | User exports a run's parameters/score/history outside the app (JSON and CSV) | F-05            | FR-017                                                 | done |
| F-06 | ui-design-system-foundation     | (foundation) A shared app shell (sidebar nav) and extended design tokens exist, following a shadcn-admin-dashboard structural pattern | —              | FR-032                                                 | done |
| S-15 | branded-login-page              | User sees a properly branded Swarm Arena login page | F-06            | FR-031                                                 | done |
| S-16 | dashboard-restyle               | User sees the post-login dashboard restyled with the new design direction | F-06            | FR-032, FR-033                                         | done |
| S-17 | staging-live-view-restyle       | User sees the simulation staging form and live view restyled with the new design direction | F-06            | FR-032, FR-033                                         | done |
| S-18 | analysis-comparison-restyle     | User sees the run-analysis and run-comparison pages restyled with the new design direction | F-06            | FR-032, FR-033                                         | done |
| S-19 | leaderboard                     | User sees a leaderboard of their own completed runs ranked by score | F-06            | FR-026                                                 | done |
| S-20 | reference-documentation-pages   | User reads reference pages describing the simulation's storyline, its parameters, its population-lifecycle model, and its scoring metrics | F-06            | FR-034                                                 | done |
| S-21 | post-run-optimization-suggestion | User sees a run-specific optimization suggestion on a completed run's analysis view, based on that run's own history | —              | FR-027                                                 | done |
| S-22 | temporary-admin-elevation       | User temporarily elevates their own account to admin to adjust parameter ranges, the object-count cap, or the number of tribes | —              | FR-030                                                 | done |
| S-23 | spatial-hash-performance-optimization | Boid/predator flocking calculations use spatial partitioning instead of a full pairwise scan, speeding up calculation and rendering at higher agent counts | —              | FR-029                                                 | done |
| F-07 | vps-resource-capacity-limits    | (foundation) Concrete max-area/max-object-count/max-concurrent-run ceilings exist, derived from this VPS's actual CPU/RAM/disk | —              | MS-05                                                  | done |
| S-24 | configurable-area-and-camera-view | User sets the simulation's area size (within an admin-set range bounded by F-07) and sees a camera-limited view into it, not the whole area at once | F-07            | MS-01, MS-02                                           | done |
| S-25 | area-aware-population-insight   | User sees, in a completed run's analysis, whether population health held up given the area used for that run | S-24            | MS-03                                                  | done |
| S-26 | in-app-feedback-module          | User reports a new functionality idea or a bug from within the app, persisted for future roadmap consideration | —              | MS-04                                                  | done |
| S-27 | live-parameter-adjustment       | User changes a running server-owned simulation's flocking weights, food regen rate, and protection threshold, with the change taking effect on the next tick | —              | MS-01                                                  | done |
| S-28 | client-staged-live-parameter-parity | User changes a client-staged run's foodRegenRate, protectionThreshold, energyThreshold, mutationChance, and mutationMagnitude while it is actively running | S-31           | MS-01                                                  | done |
| S-29 | live-crossbreeding-toggle       | User toggles crossbreeding on or off for a running simulation (both execution paths) and sees the effect on subsequent reproduction | —              | MS-02                                                  | done |
| S-30 | live-boid-count-adjustment      | User increases or decreases a running server-owned simulation's boid count and predator count while it is actively running | —              | MS-03                                                  | done |
| S-31 | correct-live-parameter-field-set | User's live-adjustment of a running server-owned simulation only exposes fields with a real, verified effect — removes 3 non-functional per-boid-genetic fields, adds 3 genuinely-global ones | —              | MS-01                                                  | done |
| S-32 | genetic-diversity-trend        | User sees, in a completed run's analysis view, how genetic diversity changed over the course of the run — not just the final value | —              | FR-025, MS-01                                          | done |
| F-08 | corpus-generation-harness      | (foundation) A single simulation run can be generated end-to-end through the real app, exported to a fixture file, and cleaned up afterward | —              | MS-01, MS-06                                           | done |
| S-33 | parameter-sweep-corpus-generation | Maintainer generates and persists a ~20-run structured-parameter-sweep corpus (up to 4 runs ticking in parallel, each capped at 60 simulated minutes) to a reusable fixture file | F-08           | MS-01, MS-02, MS-03, MS-06                             | done |
| S-34 | suggestion-quality-corpus-test | Maintainer has an automated test asserting the parameter-suggestion heuristic produces a sensible, correlated suggestion against the persisted corpus | S-33           | MS-04                                                  | done |
| S-35 | analytics-correctness-corpus-tests | Maintainer has automated tests confirming every per-run analytics function handles the corpus's full range of parameter combinations without error | S-33           | MS-05                                                  | done |
| S-36 | unwatched-run-tick-throttling | User runs multiple server-owned simulations and the one they're actively watching stays responsive, because unwatched runs no longer compete equally for CPU | —              | MS-03                                                  | done |
| S-37 | confirm-run-history-retroactive-scope | User (and the team) has a documented confirmation that per-run history applies only to runs completed after it shipped, with older runs showing an accurate "no history" state | —              | MS-01                                                  | done |
| S-38 | confirm-admin-elevation-mechanism-resolved | User (and the team) has a documented confirmation that temporary admin elevation already uses the time-boxed, self-service mechanism decided during S-22's planning | —              | MS-02                                                  | done |
| S-39 | fix-default-start-failure | User starts a simulation using the form's own default values, with no error and no unexplained failure | —              | MS-01                                                  | done |
| F-09 | per-tribe-behavior-weights | (foundation) Full per-tribe boid behavior data (weights, perception radii, multipliers) — Lua-reference parity | —              | MS-02                                                  | ready |
| F-10 | predator-tribe-concept | (foundation) Predators can belong to a tribe with independently-evolving genetics, reusing boids' existing reproduction machinery | —              | MS-04, MS-05                                           | ready |
| S-40 | per-tribe-boid-behavior-config | User configures full per-tribe boid behavior (weights, perception, multipliers) before starting a run, and sees tribes behave visibly differently | S-39, F-09     | MS-02                                                  | proposed |
| S-41 | per-tribe-food-config | User configures food stock and regeneration rate independently per boid tribe, instead of one shared pool/rate for the run | S-39           | MS-03                                                  | ready |
| S-42 | per-tribe-predator-config | User configures a predator tribe's own behavior tuning, with independently-evolving genetics, the way boid tribes already can | S-39, F-10     | MS-04                                                  | proposed |
| S-43 | second-predator-tribe-prey-target | User adds a second predator tribe to a run and chooses its prey target — boids only, or boids and predators — and inter-predator predation factors into scoring | S-42, F-10     | MS-05                                                  | proposed |

## Streams

| Stream | Theme                          | Chain                                   | Note                                                                 |
| ------ | ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| A      | Core simulation loop depth      | `F-01` → `F-02` → `S-01` → `S-02` → `S-03` → `S-04` | Carries the north star and the quality-focused domain work; the spine of this milestone. |
| B      | Multi-run viewing (legacy)       | `S-05`                                   | Joins Stream A at `S-01` — shipped and done; its user-visible capability is re-delivered on the new architecture by Stream C (S-08) and its client-driven switcher UI is then retired. |
| C      | Server-side execution            | `F-03` → `F-04` → `S-06` → `S-07` → `S-08` | 2026-11-14 extension: moves "real" simulation execution off the client and onto a server-owned process, removing the rendering-imposed limit on how many can run; the client-side staging simulation (S-01's single-run path) is explicitly unchanged. |
| D      | Run visibility                   | `F-01` → `S-10`                          | 2026-11-14 (second) extension: a post-login dashboard of the user's own runs. Joins Stream A at `F-01`. |
| E      | Scoring correctness & analysis    | `F-05` → `S-11`                          | Persists per-run history (no prerequisites — purely additive) then builds the analysis view on it; `S-11` also waits on `S-09` (the corrected per-cycle aggregation it displays) and `S-10` (Stream D, the dashboard to navigate from). |
| F      | Insight and comparison (M-2)      | `S-11` → `S-12`, `F-05` → `S-13`, `F-05` → `S-14` | M-2's three items share only the F-05 history data, not each other — `S-12`/`S-13`/`S-14` can all run in parallel. S-12 done; S-13/S-14's Unknowns resolved 2026-11-14, both `ready`. |
| G      | UI modernization (M-3)            | `F-06` → `S-15` → `S-16`, `S-17`, `S-18`, `S-19`, `S-20` | Carries M-3's north star (`S-15`). `S-16`–`S-20` all depend only on `F-06`, not on each other or on `S-15` — they can run in any order/parallel once the foundation lands; `S-15` is sequenced first by main-goal bias (quality: prove the foundation on the smallest page before the larger restyles), not a hard dependency. |
| H      | Post-run insight (M-3)            | `S-21`                                   | Standalone — no foundation prerequisite; functionally independent of the UI restyle work, though sequencing it alongside `S-18` (analysis restyle) avoids touching the analysis page's layout twice. |
| I      | Access flexibility (M-3)          | `S-22`                                   | Standalone — no foundation prerequisite; the elevation mechanism itself is a planning-level decision (PRD Open Question #6), not a roadmap-level blocker. |
| J      | Engine performance (M-3)          | `S-23`                                   | Standalone — no foundation prerequisite; pure backend change to `boids.ts`'s neighbor search, no UI surface. |
| K      | Area & camera (M-4)               | `F-07` → `S-24` → `S-25`                 | Carries M-4's north star (`S-24`). The VPS-capacity foundation is sequenced first by main-goal bias (quality: decide real limits before the feature that needs them) — a hard dependency here, not just a bias, since S-24's area parameter range must respect F-07's ceiling. |
| L      | Feedback channel (M-4)            | `S-26`                                   | Standalone — no foundation prerequisite; fully independent of the area/camera work, can run anytime. |
| M      | Live parameter tuning (M-5)       | `S-27`                                   | Standalone — no foundation prerequisite; baseline confirms the server-owned registry's `LiveRun.params` is already a single mutable field read fresh every tick, so no new Foundation is needed. |
| N      | Extended live tuning (M-6)        | `S-31` → `S-28`, `S-29`, `S-30`          | `S-31` (fix S-27's field set) is a hard prerequisite only for `S-28` (sequencing — plan client-staged parity against the corrected set); `S-29`/`S-30` are independent of `S-31` and of each other, and `S-28` carries M-6's north star once unblocked. |
| O      | Diversity trend (M-7)             | `S-32`                                   | Standalone — no foundation prerequisite; mirrors the already-shipped per-tick sample-array pattern (`populationCountSamples` et al.) exactly, so no new Foundation is needed. |
| P      | Suggestion & analytics validation (M-8) | `F-08` → `S-33` → `S-34`, `S-35` | Carries M-8's north star (`S-33`). `S-34`/`S-35` both depend only on `S-33`'s exported corpus, not on each other — they can run in parallel once it lands. |
| Q      | Roadmap-question resolution (M-9) | `S-36`, `S-37`, `S-38`           | All three are independent, no foundation prerequisite — each closes a different open roadmap question. `S-36` carries M-9's north star despite being `blocked` pending its own Unknown; `S-37`/`S-38` are quick, unblocked confirmations. |
| R      | Per-tribe config & predator expansion (M-10) | `S-39` (done) → `F-09` → `S-40`; `S-39` → `S-41`; `F-10` → `S-42` → `S-43` | `S-39` shipped (north star done). All 4 design Unknowns resolved 2026-11-17 (full Lua parity for S-40, shared-pool for S-41, genetics-evolving for S-42, scored for S-43). `F-09`/`F-10`/`S-41` are all `ready` now and can run in parallel — `F-10` was discovered during sequencing: predators share boids' genetics machinery already but have no tribe/flock concept at all, so S-42/S-43 need it built first. `S-40` waits on `F-09`; `S-42` waits on `F-10`; `S-43` waits on both `S-42` and `F-10`. |

## Baseline

What's already in place in the codebase as of `2026-11-09` (auto-researched + user-confirmed), refreshed `2026-11-14` for the server-side-execution extension (F-03, F-04, S-06–S-08), again `2026-11-14` for M-3 (UI modernization, leaderboard, post-run suggestion, temp-admin, spatial-hash perf), again `2026-11-15` for M-4 (area/camera, feedback module, VPS-bound limits), again `2026-11-15` for M-5 (live parameter adjustment), and again `2026-11-15` for M-6 (client-staged parity, crossbreeding toggle, boid count); no baseline change for M-7 (genetic-diversity trend — purely additive to an existing JSON blob, no new layer touched); no baseline change for M-8 either (test/validation infrastructure reusing the existing server-owned execution engine and analytics endpoints — the new layer is a generation/export script and its tests, not a product layer); no baseline change for M-9 either (S-36 is a pure engine-level change to the already-existing server-owned tick scheduler; S-37/S-38 are documentation/verification-only against already-shipped code, no new layer touched); refreshed again `2026-11-17` for M-10 (per-tribe config, predator expansion) — confirmed `boidCount`/`predatorCount` and `flockId`/`flockCount` already exist (`src/server/simulation/boids.ts`, 33 references), so the tribe *concept* is already present at the boid level, but `separationWeight`/`alignmentWeight`/`cohesionWeight` and all food settings remain single global values shared by every boid in a run regardless of tribe (confirmed via `src/app/simulation/page.tsx`'s single `useState` per parameter and `startInputSchema` in `src/server/api/routers/simulation.ts`); no per-tribe predator concept exists at all, and `Predator:hunt()` in the Lua reference confirms the prior implementation never had one either — no new layer, but a real change to the per-tick flocking-force calculation every boid already runs through.
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Next.js App Router scaffold only (`src/app/page.tsx`, `src/app/layout.tsx`); no swarm-arena-specific UI yet.
- **Backend / API:** partial — tRPC wired (`src/server/api/root.ts`), but only the T3 example `post` router exists; no domain routers.
- **Data:** partial — Drizzle/SQLite configured, but `src/server/db/schema.ts` only has the example `.bootstrap-scaffold_post` table; no simulation/user/score tables.
- **Auth:** absent — no `next-auth` in `package.json` or `src/`, despite `tech-stack.md` planning it.
- **Deploy / infra:** present — live in production at `https://swarmarena.hopto.org` (Docker + Caddy + GitHub Actions auto-deploy, per `infrastructure.md` / `deploy-plan.md`). `tech-stack.md` already names the reason this matters for F-03/F-04: a persistent container (not serverless) is required precisely for "an always-on simulation loop and any WebSocket/SSE push to the live view" — the deploy target was chosen anticipating this extension.
- **Observability:** absent — no logging/error-tracking library found (confirmed again 2026-11-17: no `sentry`/`datadog`/`otel` dependency in `package.json`; the in-app feedback module is user-reported bug intake, not automated error tracking).
- **2026-11-14 refresh — relevant to F-03/F-04 specifically:** simulation execution today is 100% client-side, `requestAnimationFrame`-driven (`src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/multi/_components/multi-simulation-stage.tsx`); no server-owned tick loop exists. `simulationRuns` (`src/server/db/schema.ts`) persists only run configuration and terminal fields (status/score/timestamps) — no live per-tick state. No push/subscription mechanism exists (`src/server/api/routers/simulation.ts` has only `start`/`stop` mutations; no tRPC subscription, SSE route, or WebSocket handler found). The existing `computeMultiRunTick` (`src/server/simulation/multi-run-lifecycle.ts`) already separates "tick every running slot" from "render only the active slot's output" — the closest in-repo precedent for the tick/render split F-03/F-04 need, even though it currently runs client-side only.
- **2026-11-14 refresh (second) — relevant to S-09/F-05/S-10/S-11:** no dashboard or post-login landing page exists — `/simulation` is both the staging form and the only run-related page; there is no route a logged-in user is redirected to. `listRunning`/`listSaved` (`src/server/api/routers/simulation.ts`) already return the caller's own rows filtered by status, so a run-list dashboard is additive UI, not new backend capability. No run-analysis UI or endpoint exists anywhere. Confirmed via code inspection: `computeScore`'s callers (`stop` resolver, `server-run-registry.ts`'s `tick()`/`stopServerRun`) consume `phaseHistory`/`foodRatioSamples`/survivor genes only to compute the final score number — none of those arrays are persisted; `simulationRuns.score` is the only thing written back. An analysis view has nothing to read until F-05 persists them.
- **2026-11-14 refresh (third) — relevant to M-3 (F-06, S-15–S-23):** the app uses shadcn/ui primitives (`Button`, `Input`, `Switch` in `src/components/ui/`) and a design-token system (`src/styles/globals.css`), but no shared app shell/sidebar-nav layout exists — every page (`login`, `dashboard`, `simulation`, `runs/[runId]`, `runs/compare`) is an independent `<main>` with its own ad hoc Tailwind classes, not a common layout. The login page (`src/app/login/page.tsx`) is generic/default-looking, not branded. No leaderboard, post-run-optimization-suggestion, admin-elevation, or reference/documentation page exists anywhere. `src/server/simulation/boids.ts`'s flocking-force calculation does a full pairwise scan (`for (const other of boids)` nested inside a per-boid loop) — confirmed O(N²), the exact pattern the user's prior LÖVE2D/Lua implementation (`/mnt/Kids/boids_final/game/`) replaced with a spatial-hash grid, per that project's own `docs/ARCHITEKTURA.md` ("Siatka Haszu Przestrzennego... Optymalizacja wyszukiwania sąsiadów z O(N²) do O(N)"). `users.role` (schema.ts) already has the `admin`/`member` enum; no elevation/toggle mechanism exists to change it from the app itself today (only direct DB access).
- **2026-11-15 refresh — relevant to M-4 (F-07, S-24–S-26):** the simulation's spatial extent is two hardcoded module-level constants in `src/server/simulation/boids.ts` (`INITIAL_AREA_SIZE = 200` for x/y, `Z_DEPTH_RANGE = 200` for z), not a per-run parameter — every run uses the same fixed toroidal world size today. No camera/viewport concept exists anywhere in the render path; `simulation-canvas.tsx` and the server-run live-view path both render the entire world extent directly, with no pan/zoom/sub-region state. `admin_settings.parameterRanges` (the existing admin-configurable-range mechanism from S-22/S-04) is schema-flexible enough to add a new ranged parameter without a migration shape change, but `src/server/simulation/parameter-ranges.ts`'s `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES` would need a new entry for area. No feedback/bug-report table or route exists anywhere in `schema.ts` or `src/server/api/routers/`. Deploy/infra's VPS is confirmed (2026-11-15, direct SSH inspection): 4 vCPU (AMD EPYC-Milan), 7.7GiB RAM (~6.1GiB available at the time of inspection), 232GB disk (187GB free), and the app's Docker container currently has no memory/CPU limit set (`docker inspect` reports unlimited) — today's `DEFAULT_MAX_OBJECT_COUNT = 500` (`parameter-ranges.ts`) was chosen to match pre-existing hardcoded bounds, not derived from this hardware. S-23's recent finding (spatial-hash grid narrowing effectiveness depends on the world-size-to-radius ratio) is directly relevant here: a configurable, potentially larger area would change that ratio and could make the existing grid optimization meaningfully more effective than it measured at the current fixed 200-unit world — worth revisiting once area becomes variable, not re-litigated now.
- **2026-11-15 refresh — relevant to M-5 (S-27):** live, in-run parameter adjustment is absent on both execution paths today (confirmed by direct code inspection). Server-owned: `server-run-registry.ts`'s `LiveRun.params` is set once at construction (`startServerRun`/`resumeServerRun`) and only ever read inside `tick()` — no mutator exists, and no tRPC mutation (`simulation.ts`'s `start`/`startServer`/`stop`/`savePause`/`resume`/`watch`) updates a running run's params; the admin-settings mutation only writes global range ceilings, not a specific run's live values. The `watch` subscription (`watchServerRun`) is purely server→client push, with no input channel back into the run. Client-staged: `simulation-canvas.tsx`'s tick-loop effect deliberately closes over its parameter props as fixed for the run's lifetime (its own inline comment states this explicitly) — no live-editing form exists, and changing a prop wouldn't reach the running closure anyway since the mount effect doesn't re-run. Because `LiveRun.params` is already a single mutable object field read fresh every 16ms tick, adding a mutator plus a tRPC mutation is additive to the existing registry — no Foundation is needed; S-27 folds this directly into its own vertical slice. The client-staged path would require restructuring the mount effect to read live values instead of closed-over props, a materially larger change — out of scope for M-5 (see Parked).
- **2026-11-15 refresh — relevant to M-6 (S-28, S-29, S-30):** M-5 shipped, so `server-run-registry.ts` now has `applyLiveParams`/`updateRunParams` (a proven mutator + mutation pattern) and `LiveAdjustableParams` (a `Pick<ServerRunParams, ...>` type currently limited to the 5 weight/food/threshold fields). Investigated the three parked population-shape parameters directly: `crossbreedingEnabled` is already read fresh from `run.params` every tick inside the reproduction pass (`boids.ts`'s mating loop) — the exact same way the 5 already-live fields are — so it's excluded from `LiveAdjustableParams` only by the Pick's type-level allowlist, not by any architectural barrier; widening the Pick is the entire change. `boidCount` is only consumed once, at population creation (`createInitialPopulation`) — increasing it live means generating new boids with the same logic and appending them to the live `boids` array (not a `run.params` patch); decreasing it means culling, for which `applyHunger`'s `.filter((boid) => boid.lifespan > 0)` and `applyPredation`'s `.filter((boid) => !captured.has(boid))` are direct, already-tested patterns to copy — real work, but with a clean precedent. `flockCount` is the one NOT included in M-6: every boid's `flockId` is set once at birth (`BoidGenes.flockId`) and never re-derived per tick — changing flockCount mid-run has no patch option, it requires rewriting `flockId` (and recoloring) across the entire live population, much closer to "restart with new params" than a param patch; parked for a future milestone. Client-staged: unchanged from M-5's finding — `simulation-canvas.tsx`'s tick effect still closes over params as immutable-for-the-run; S-28 is the slice that does this restructuring.

## Foundations

### F-01: Gate product routes with login and roles

- **Outcome:** (foundation) A logged-in user (member or admin) can access the app; routes are gated by session; the user's role (member/admin) is available to downstream code.
- **Change ID:** gate-product-routes
- **PRD refs:** FR-001, Access Control section
- **Unlocks:** S-01 (its Given clause requires "a logged-in user"), S-04 (admin sets parameter ranges — needs the role distinction to mean anything)
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Auth is completely absent from the baseline today — building any user-specific flow (including the north star) on top of an unauthenticated app would mean retrofitting session handling into every route later; doing it first is cheaper than doing it twice.
- **Status:** done

### F-02: Choose a deterministic seeded-PRNG strategy

- **Outcome:** (foundation) One seeded pseudo-random-number-generator approach is selected and wired as the single randomness source for simulation state (initial positions/velocities, future mutation rolls), so identical parameters + seed reproduce identical outcomes.
- **Change ID:** deterministic-seed-strategy
- **PRD refs:** Non-Functional Requirements — "Two runs started with identical parameters and the same random seed produce identical scores"
- **Unlocks:** S-01 (the walking-skeleton's movement logic already needs randomness for initial boid placement, and retrofitting determinism after ad-hoc `Math.random()` calls have spread through the codebase is expensive)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is exactly the kind of structural decision the lesson material warns about leaving implicit — get it wrong or skip it at the start, and every slice built afterward (genetics, scoring, comparison) inherits non-reproducible results.
- **Status:** done

### F-03: Server-owned simulation execution engine

- **Outcome:** (foundation) A simulation run can be ticked forward to completion by a server-owned process, independent of any client connection or browser tab — the server, not the browser, is the thing that owns a "real" run's lifecycle.
- **Change ID:** server-side-simulation-engine
- **PRD refs:** MS-01, MS-02 (2026-11-14 extension); US-01, FR-003, FR-013
- **Unlocks:** S-06 (starting a run that survives tab close); reduces a structural precondition for S-04 (save/resume needs a single authoritative owner of live state — today that owner is a browser tab that can vanish)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First time any simulation logic executes outside a browser tick — every other new-scope item depends on this landing correctly, so it's sequenced first. The existing pure tick cores (`computeSingleRunTick`, `computeMultiRunTick`) are already DOM-free, which de-risks this: the move is about *where* they're called from, not rewriting the simulation logic itself.
- **Status:** done

### F-04: Live simulation-view channel

- **Outcome:** (foundation) The server can push a running simulation's current tick state to exactly one connected viewer in real time, without the viewer owning or affecting execution.
- **Change ID:** live-simulation-view-channel
- **PRD refs:** MS-04 (2026-11-14 extension); FR-004, FR-014
- **Unlocks:** S-07 (viewing one running server simulation live)
- **Prerequisites:** F-03
- **Parallel with:** S-06 (both depend only on F-03, not on each other)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Genuinely new infrastructure — no subscription/push mechanism (tRPC subscription, SSE, WebSocket) exists anywhere in the stack today, confirmed absent. Isolated as its own foundation rather than folded into S-07 because the push channel is reusable infrastructure, not view-specific logic.
- **Status:** done

### F-05: Persist per-run population history for analysis

- **Outcome:** (foundation) When a run finishes, its tick-level population history — phase history, food-ratio samples, and genetic-diversity snapshots — is persisted alongside the score instead of being discarded, so a later analysis view has data to read.
- **Change ID:** persist-run-history
- **PRD refs:** MS-08 (2026-11-14 extension); FR-019, FR-010 (full)
- **Unlocks:** S-11 (the analysis view has nothing to render without this)
- **Prerequisites:** — (purely additive persistence of the raw per-tick arrays, which are unaffected by S-09's aggregation-formula fix — `phaseHistory`'s per-tick labels are the same regardless of how `computePhaseQuality` later summarizes them)
- **Parallel with:** S-09, S-10
- **Blockers:** —
- **Unknowns:** — (storage shape — one JSON blob similar to `savedState`, vs. normalized per-tick rows — is implementer's call at `/10x-plan`, bounded by this project's declared small scale per `full-score-save-resume`'s own Performance Considerations precedent)
- **Risk:** The sample arrays already exist in memory at score-time (`run.phaseHistory`, `run.foodRatioSamples`, survivor genes) — this is "stop discarding data already computed," not new computation, which keeps the risk contained to storage-size/schema shape, not simulation logic.
- **Status:** done

### F-06: UI design-system foundation

- **Outcome:** (foundation) A shared app shell (sidebar navigation) and an extended set of design tokens exist, following `next-shadcn-admin-dashboard`'s structural pattern (confirmed via web research as a Next.js App Router + shadcn/ui + Tailwind, MIT-licensed reference — adoptable incrementally since this app already uses shadcn/ui primitives), demonstrated end-to-end on the login page (S-15) before being applied to the rest of the app.
- **Change ID:** ui-design-system-foundation
- **PRD refs:** FR-032
- **Unlocks:** S-15, S-16, S-17, S-18, S-19, S-20 — every page-level restyle or new page in M-3 consumes this shell/tokens instead of inventing its own.
- **Prerequisites:** —
- **Parallel with:** S-21, S-22, S-23
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The main risk is scope creep into "redesign everything at once" — explicitly bounded to establishing the shell + token extensions and proving them on exactly one page (S-15) before any other page adopts them. Must not regress the existing design-token discipline (`AGENTS.md`: no literal colors/arbitrary Tailwind values) — extends `globals.css`'s tokens, doesn't bypass them.
- **Status:** done

### F-07: VPS resource capacity limits

- **Outcome:** (foundation) Concrete, documented ceilings exist for simulation area size, object count, and concurrent run count — derived from this specific VPS's actual CPU/RAM/disk (4 vCPU AMD EPYC-Milan, 7.7GiB RAM, 232GB disk; confirmed 2026-11-15 via direct inspection), not from arbitrary defaults. Does not itself change any code path — it's a capacity *policy* decision that S-24's area-parameter range (and a review of the existing `DEFAULT_MAX_OBJECT_COUNT`) must respect.
- **Change ID:** vps-resource-capacity-limits
- **PRD refs:** MS-05
- **Unlocks:** S-24 — the new area parameter's admin-configurable range has nothing safe to default to without this; also closes the "how big can area get" Unknown below before `/10x-plan` has to guess at it.
- **Prerequisites:** —
- **Parallel with:** S-26
- **Blockers:** —
- **Unknowns:**
  - What safety margin (headroom) to target when deriving a ceiling from available RAM/CPU — e.g., cap simulation memory use at 50% of available RAM, leaving room for the OS, Caddy, and normal request handling? — Owner: user. Block: no — `/10x-plan` can propose a reasonable default margin; the user can tighten or loosen it.
  - Should the app itself enforce a container-level resource limit (currently unset per the Baseline's `docker inspect` finding), or only enforce limits at the simulation-parameter level (area/object-count ranges) and leave the container unbounded? — Owner: user. Block: no — either is implementable; this is a defense-in-depth preference, not a blocker to drafting the parameter-range ceiling itself.
- **Risk:** Low — this is measurement and policy-setting, not new code; the main risk is picking a ceiling that's either too conservative (undersells the box) or too loose (risks an OOM on this specific 7.7GB-RAM machine, which has no swap configured per the Baseline's `free -h` finding — a genuine, not theoretical, failure mode if ignored). Planning (2026-11-15) found the *actual* binding constraint is CPU (single-threaded tick execution), not RAM — see `context/foundation/capacity-limits.md` for the measured tick-cost curve.
- **Status:** done

### F-08: Corpus-generation harness

- **Outcome:** (foundation) A single simulation run can be driven end-to-end through the real app's own execution path (not a bypass of the engine) with explicit parameters, allowed to tick to completion under a simulated-duration cap, have its persisted history/score captured, exported to a fixture-file record, and have its own DB/registry footprint cleaned up afterward — leaving no trace beyond the exported record.
- **Change ID:** corpus-generation-harness
- **PRD refs:** MS-01, MS-06
- **Unlocks:** S-33 (which runs this harness ~20 times, batched up to 4-wide, to build the full corpus); any future slice needing the same single-run generate-and-export capability.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** — (resolved during planning: fake-timer-driven ticking, confirmed against the existing `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync()` precedent; the admin-configured `maxDurationSeconds` range defaults to a max of 600s and must be raised-then-restored around each run's start, generically over whatever fields the caller's params need widened)
- **Risk:** Low — reuses the existing server-owned execution engine and its already-tested `createCaller`-based test pattern; the main risk is ensuring real-time-equivalent behavior (scoring, phase classification) isn't accidentally distorted by however ticks are accelerated.
- **Status:** done

### F-09: Per-tribe boid behavior data model

- **Outcome:** (foundation) A boid tribe's separation/alignment/cohesion weights, per-behavior perception radii, and behavior multipliers (predator-avoidance, food-seeking, burst) can all be configured per flock/tribe at run-start time, instead of one shared value set applied to every flock in the run — full Lua-reference (`config.lua`) parity, per Open Roadmap Question #9's resolution (2026-11-17).
- **Change ID:** per-tribe-behavior-weights
- **PRD refs:** MS-02
- **Unlocks:** S-40
- **Prerequisites:** —
- **Parallel with:** S-39
- **Blockers:** —
- **Unknowns:** — (resolved 2026-11-17: full parity, not just the 3 weights — see Open Roadmap Question #9)
- **Risk:** Medium — broader than originally scoped (full per-behavior data, not just 3 weights); touches the run-start input schema and every per-tick force calculation every boid already goes through every frame; must not regress already-started runs that still use a single shared weight set.
- **Status:** ready

### F-10: Predator tribe concept

- **Outcome:** (foundation) Predators can belong to a tribe (mirroring boids' existing `flockId`), with each predator tribe carrying its own independently-evolving genetics (reusing the already-existing `reproducePopulation`/`PredatorGenes` machinery, which today treats all predators as one undifferentiated population) and its own behavior tuning.
- **Change ID:** predator-tribe-concept
- **PRD refs:** MS-04, MS-05
- **Unlocks:** S-42, S-43
- **Prerequisites:** —
- **Parallel with:** S-39, F-09
- **Blockers:** —
- **Unknowns:** — (discovered 2026-11-17 during roadmap sequencing: predators already share boids' genetics/reproduction system verbatim — `PredatorGenes = BoidGenes`, same `reproducePopulation` call, confirmed in `boids.ts` — but have no `flockId`-equivalent grouping at all; this foundation is "add the grouping," not "build genetics from scratch")
- **Risk:** Medium — the reproduction machinery to reuse already exists and is proven (boids use it today); the net-new work is purely the tribe-assignment/isolation layer on the predator side.
- **Status:** ready

## Slices

### S-01: Basic flocking loop with a survival-based score

- **Outcome:** User starts a simulation with basic boid flocking (one flock, no predators yet), watches it run in real time, stops it, and receives a basic score based on how long the population survived.
- **Change ID:** basic-flocking-loop
- **PRD refs:** FR-001, FR-002 (partial — some parameters settable, full admin/member range split deferred to S-04), FR-003, FR-004 (partial — flock color shown, only one flock exists), FR-010 (partial — survival component only), FR-018, US-01 (partial)
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star — the smallest slice that proves the simulate → render → stop → score pipeline works at all. Sequenced first because every richer slice (predators, genetics, full scoring) is worthless if this pipeline doesn't hold together.
- **Status:** done

### S-02: Predator-prey dynamics with flock protection

- **Outcome:** User sees predators hunt boid flocks in real time, with any flock at or below the configured protection threshold immune to attack, and sees hunger accelerate death alongside natural lifespan.
- **Change ID:** predator-prey-dynamics
- **PRD refs:** FR-005 (partial — death/food mechanics, reproduction deferred to S-03), FR-008, FR-009
- **Prerequisites:** S-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The protection-threshold rule is an explicit PRD acceptance criterion ("a flock at or below the threshold is never attacked") — isolating it in its own slice, right after the skeleton, makes it independently verifiable before genetics complexity stacks on top of population dynamics.
- **Status:** done

### S-03: Genetic inheritance and inter-flock crossbreeding

- **Outcome:** User sees the population reproduce with individually inherited genes (including a blended color when parents differ), and can toggle inter-flock crossbreeding on or off.
- **Change ID:** genetic-inheritance-crossbreeding
- **PRD refs:** FR-005 (full — reproduction to the object-count limit), FR-006, FR-007
- **Prerequisites:** S-02
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The PRD calls out the exact failure mode to guard against — "a run with crossbreeding disabled must never produce a blended-flock-color offspring" — so this logic is isolated in its own slice specifically to make that rule easy to test in isolation, rather than buried inside a larger reproduction-and-scoring slice.
- **Status:** done

### S-04: Full scoring with save and resume

- **Outcome:** User configures the full parameter set within admin-defined ranges, can stop and save a run at any point, resume it later with exact population/resource state, and receives a complete score combining survival, resource management, genetic diversity, and population-lifecycle-phase quality.
- **Change ID:** full-score-save-resume
- **PRD refs:** FR-002 (full), FR-010 (full), FR-011, FR-012, FR-019, US-01 (full)
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** — (scoring formula resolved 2026-11-14 — see PRD Business Logic / Open Questions; exact per-phase quality values and resilience-bonus magnitude are `/10x-plan`-level tuning, not a blocking product unknown)
- **Risk:** Resume-state fidelity is a hard PRD guardrail ("no state loss on save/resume"). The scoring formula's product rule is now fixed (equal product of four factors; phase classifier uses the boom-bust/irruptive-growth model, not logistic growth, because this sim's finite food + starvation + predation can genuinely crash a population) — remaining risk is purely implementation: the phase classifier needs a rolling population/food-trend window that doesn't exist in today's tick state, and must be threaded through save/resume without breaking NFR determinism (same seed + params → same score).
- **Status:** done

### S-05: Parallel simulations with view switching

- **Outcome:** User can run several simulations in parallel and switch which one is actively viewed, without interrupting or slowing the others.
- **Change ID:** parallel-sim-switching
- **PRD refs:** FR-013, FR-014
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The PRD itself flags this as "the most expensive element of the MVP, consciously accepted" — sequenced to depend only on the basic loop (not on predator/genetics richness) so its multi-view UI chrome isn't built against simulation internals that are still changing in S-02–S-04.
- **Status:** done

### S-06: Start a real simulation that keeps running on the server

- **Outcome:** User starts a real (non-staging) simulation whose execution is owned by the server, so it keeps running even if the browser tab is closed or the user navigates away. The existing client-side staging simulation (S-01's single-run path) is unchanged and remains the way to tune parameters interactively.
- **Change ID:** start-server-run-simulation
- **PRD refs:** MS-01 (2026-11-14 extension); US-01, FR-003, FR-013
- **Prerequisites:** F-03
- **Parallel with:** F-04
- **Blockers:** —
- **Unknowns:**
  - Should starting a real server-run simulation share the existing parameter-configuration form/UI with the staging flow, or be a distinct entry point? — Owner: user. Block: no (reasonable default to start from: a distinct "run on server" action alongside the existing staging start; refine at `/10x-plan`).
- **Risk:** First slice to prove the server-execution model end-to-end — the north star of this extension. Sequenced immediately after F-03 since it's the smallest capability that validates the foundation actually works.
- **Status:** done

### S-07: View one running server simulation live

- **Outcome:** User picks one of their currently-running server simulations and watches it render live in the browser, receiving pushed state updates rather than owning execution.
- **Change ID:** view-running-server-simulation
- **PRD refs:** MS-04 (2026-11-14 extension); FR-004, FR-014; NFR "rendering stays usable"
- **Prerequisites:** S-06, F-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Must prove rendering is genuinely decoupled from execution — closing or navigating away from the view must not pause, slow, or kill the server-side run. This is the guarantee the whole extension exists to deliver (removing the rendering-imposed limit), so it's isolated here rather than assumed.
- **Status:** done

### S-08: List and switch between running server simulations

- **Outcome:** User sees all their currently-running server simulations and switches which one is actively viewed, without interrupting the others — the same user-visible capability S-05 already delivered, now backed by server execution instead of a single shared client RAF loop. The old client-driven multi-run switcher UI (`src/app/simulation/multi/`) is retired as part of this slice.
- **Change ID:** server-run-list-and-switch
- **PRD refs:** MS-05 (2026-11-14 extension); FR-013, FR-014
- **Prerequisites:** S-07
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Must not regress S-05's already-verified guarantee ("switching does not interrupt or measurably slow the others") — trivially preserved once the server, not a shared client loop, owns every run. The real risk is in the retirement half of this slice: confirm nothing else depends on `run-slots.ts` / `multi-simulation-stage.tsx` before deleting them.
- **Status:** done

### S-09: Correct the phase-quality score to summarize per completed cycle

- **Outcome:** User's score correctly rewards every full crash→recovery resilience cycle completed during a run, not just whether one happened anywhere in the run — a population that weathers three crashes and recovers each time scores higher than one that barely survives a single cycle.
- **Change ID:** phase-quality-per-cycle-scoring
- **PRD refs:** MS-06 (2026-11-14 extension); FR-019, FR-010 (full)
- **Prerequisites:** — (standalone correction to already-shipped S-04 scoring code; confirmed via code inspection, not a new unknown)
- **Parallel with:** S-10, F-05
- **Blockers:** —
- **Unknowns:** — (the exact per-cycle aggregation formula — e.g. averaging each completed cycle's own quality score vs. a count-weighted resilience bonus — is `/10x-plan`-level tuning, not a blocking product unknown; the gap itself is confirmed, not in question: `computePhaseQuality` in `boids.ts` averages `PHASE_QUALITY_WEIGHTS[phase]` flatly across the *entire* tick history and applies a single yes/no "does at least one crash→recovery pair exist anywhere" resilience bonus, so a run with three full cycles scores identically to one with exactly one)
- **Risk:** This changes the score's actual numeric meaning for every future run — isolated as its own slice, ahead of S-11, so the correctness fix lands and is verifiable independently of any dashboard/analysis UI work. Can run fully in parallel with F-05 (which persists raw per-tick data unaffected by this aggregation-formula fix) and S-10.
- **Status:** done

### S-10: Post-login run dashboard

- **Outcome:** Right after logging in, the user lands on a dashboard listing their own simulation runs — running, saved, and completed — with standard run-dashboard conventions (status, start time, filters, and a link into each run's detail).
- **Change ID:** post-login-run-dashboard
- **PRD refs:** MS-07 (2026-11-14 extension); FR-013, FR-014
- **Prerequisites:** F-01
- **Parallel with:** S-09, F-05
- **Blockers:** —
- **Unknowns:**
  - Exact landing route, and whether this replaces or sits alongside today's `/simulation` staging page as the post-login default — Owner: user. Block: no (reasonable default: a new `/dashboard` route becomes the post-login redirect target; `/simulation` stays reachable from it for staging/starting new runs; refine at `/10x-plan`).
- **Risk:** `listRunning`/`listSaved` and the `simulationRuns` table already hold everything this needs (status, score, timestamps) — additive UI over existing data, not new backend capability, which keeps the slice small and low-risk.
- **Status:** done

### S-11: Run analysis view

- **Outcome:** From a completed run, the user opens an analysis view presenting the run's population dynamics — a logistic-growth-curve comparison against the run's actual population trajectory, a phase/cycle breakdown of time spent in each lifecycle phase (summarized per completed cycle, matching S-09's fix), and a diversity-index-style summary of genetic diversity over time — so they can draw a concrete conclusion about what to change in the next staged run.
- **Change ID:** run-analysis-view
- **PRD refs:** MS-08 (2026-11-14 extension); FR-010 (full), FR-019
- **Prerequisites:** F-05, S-09, S-10
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which adapted-standard-analysis visualizations ship in v1 (growth-curve overlay, phase/cycle timeline, diversity-index trend — all three, or a subset) — Owner: user. Block: no (standard-methods research below grounds the options; `/10x-plan` scopes v1 from them).
- **Risk:** The analysis math itself borrows directly from standard, well-documented population-ecology methods (logistic growth curve as the comparison baseline; Shannon/Simpson-style diversity indices adapted from species-diversity to gene-value diversity; survivorship-curve-style staging adapted to this sim's phase model) — not invented from scratch, which bounds the real risk to UI/visualization scope, not methodology.
- **Status:** done

### S-12: Compare completed runs side by side

- **Outcome:** User selects two or more completed runs and compares their scores and four-factor breakdowns side by side.
- **Change ID:** compare-runs-side-by-side
- **PRD refs:** FR-016
- **Prerequisites:** F-05, S-11
- **Parallel with:** S-13, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — every completed run since F-05 already has a persisted score and history; this is a new read-only view over existing data, not new data collection. Runs that predate F-05 have only a final score (same degrade-gracefully pattern S-11 already established for its own empty state).
- **Status:** done

### S-13: Heuristic parameter-change suggestion

- **Outcome:** User sees a heuristic-suggested next parameter change — the single admin-ranged parameter most correlated with improving their final score across their own past runs — with a one-line rationale and a confidence qualifier.
- **Change ID:** parameter-suggestion-heuristic
- **PRD refs:** FR-015
- **Prerequisites:** F-05
- **Parallel with:** S-12, S-14
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Needs at least 3 of the user's own completed runs with a given parameter varied before it can say anything meaningful for that parameter — degrades to "not enough data yet" otherwise, same degrade-gracefully posture as S-11/S-12's partial-data handling.
- **Status:** done

### S-14: Export a run outside the app

- **Outcome:** User exports a run's parameters, score, and history outside the app, in JSON (full-fidelity, unflattened) and CSV (parameters + score, one row, no nested history fields).
- **Change ID:** run-export
- **PRD refs:** FR-017
- **Prerequisites:** F-05
- **Parallel with:** S-12, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low complexity — F-05 already persists everything a run-level export would need; CSV deliberately drops nested history arrays (phaseHistory, survivorGenes, per-tick samples) rather than awkwardly serializing them into a single cell — a format limitation, not an oversight.
- **Status:** done

### S-15: Branded login page

- **Outcome:** User sees a properly branded Swarm Arena login page, replacing today's generic/default-looking screen.
- **Change ID:** branded-login-page
- **PRD refs:** FR-031
- **Prerequisites:** F-06
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — smallest page in the app, first real use of F-06's shell/tokens; proves the foundation before the larger restyles (S-16–S-18) commit to the same pattern.
- **Status:** done

### S-16: Dashboard restyle

- **Outcome:** User sees the post-login dashboard restyled with the new design direction, with no change to its existing Running/Saved/Completed functionality.
- **Change ID:** dashboard-restyle
- **PRD refs:** FR-032, FR-033
- **Prerequisites:** F-06
- **Parallel with:** S-17, S-18, S-19, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Must not regress existing polling/filter/checkbox-selection behavior (S-10, S-12) while restyling — a pure visual change, no new data or logic.
- **Status:** done

### S-17: Staging and live view restyle

- **Outcome:** User sees the simulation staging form and live view restyled with the new design direction, with no change to existing form state or live-rendering behavior.
- **Change ID:** staging-live-view-restyle
- **PRD refs:** FR-032, FR-033
- **Prerequisites:** F-06
- **Parallel with:** S-16, S-18, S-19, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The largest, most stateful existing page (13 form fields, live canvas, suggestion card from S-13) — restyle carefully to avoid breaking any existing `useState`/query wiring.
- **Status:** done

### S-18: Analysis and comparison restyle

- **Outcome:** User sees the run-analysis and run-comparison pages restyled with the new design direction, with no change to existing chart/table behavior.
- **Change ID:** analysis-comparison-restyle
- **PRD refs:** FR-032, FR-033
- **Prerequisites:** F-06
- **Parallel with:** S-16, S-17, S-19, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — both pages are already narrowly scoped (Recharts + a few stat sections); restyle is additive CSS/layout, not a logic change.
- **Status:** done

### S-19: Leaderboard

- **Outcome:** User sees a leaderboard of their own completed runs, ranked by score, highest first.
- **Change ID:** leaderboard
- **PRD refs:** FR-026
- **Prerequisites:** F-06
- **Parallel with:** S-16, S-17, S-18, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — net-new page, built directly on F-06's shell with no prior page to preserve; reuses the same ownership-scoped query pattern every other run-listing query in this router already follows.
- **Status:** done

### S-20: Reference and documentation pages

- **Outcome:** User reads four reference pages — the simulation's storyline, its parameters, its population-lifecycle model, and its scoring metrics — separated from the functional app pages, not interleaved with them.
- **Change ID:** reference-documentation-pages
- **PRD refs:** FR-034
- **Prerequisites:** F-06
- **Parallel with:** S-16, S-17, S-18, S-19
- **Blockers:** —
- **Unknowns:**
  - Who writes the actual descriptive copy for each of the four pages — the implementer drafting from the PRD's own Business Logic/FR text, or the user reviewing/rewriting afterward? — Owner: user. Block: no — a reasonable first draft is derivable directly from this PRD's existing Business Logic section (population lifecycle, score factors) and FR-002's parameter list; the user can revise content after it ships.
- **Risk:** Low — static content pages, no new data model; shares one simple layout pattern across all four.
- **Status:** done

### S-21: Post-run optimization suggestion

- **Outcome:** User sees a run-specific optimization suggestion on a completed run's analysis view, derived from that single run's own phase/resource history — distinct from S-13's cross-run suggestion.
- **Change ID:** post-run-optimization-suggestion
- **PRD refs:** FR-027
- **Prerequisites:** —
- **Parallel with:** F-06, S-18, S-19, S-20, S-22, S-23
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — reuses the same persisted `history` (phaseHistory, foodRatioSamples) S-11/S-13 already read; the new logic is "reason about one run's own trajectory" rather than "correlate across runs," a narrower, more constrained problem than S-13's. Sequencing alongside S-18 (analysis restyle) avoids touching that page's layout twice, though it is not a hard dependency.
- **Status:** done

### S-22: Temporary admin elevation

- **Outcome:** User temporarily elevates their own account (or another account) to `admin` to adjust parameter ranges, the object-count cap, or the number of tribes, then reverts — the elevation is reversible, not a permanent role change.
- **Change ID:** temporary-admin-elevation
- **PRD refs:** FR-030
- **Prerequisites:** —
- **Parallel with:** F-06, S-18, S-19, S-20, S-21, S-23
- **Blockers:** —
- **Unknowns:** — (resolved at `/10x-plan`: time-boxed auto-expiring grant, any account by email, self always allowed / others require caller already admin)
- **Risk:** `users.role` already has the `admin`/`member` enum (schema.ts) — this is a new UI/mutation path to flip it temporarily, not a new data model.
- **Status:** done

### S-23: Spatial-hash performance optimization

- **Outcome:** Boid/predator flocking-force calculations use spatial partitioning (a grid-based neighbor search) instead of a full pairwise scan, reducing complexity from O(N²) to O(N) per tick — speeding up both calculation time and the resulting render frame rate at higher agent counts.
- **Change ID:** spatial-hash-performance-optimization
- **PRD refs:** FR-029
- **Prerequisites:** —
- **Parallel with:** F-06, S-18, S-19, S-20, S-21, S-22
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Confirmed O(N²) today (`boids.ts`'s nested `for (const other of boids)` scan) — the technique being ported is already proven in this project's own prior LÖVE2D/Lua implementation (`/mnt/Kids/boids_final/game/`, documented in that project's own `docs/ARCHITEKTURA.md`), not an invented approach. Must produce identical scores/behavior to the pre-optimization scan for the same seed/parameters (determinism NFR) — any deviation is a correctness bug, not an accepted tradeoff; verification needs a deliberate before/after comparison on a fixed seed, not just "it still runs."
- **Status:** done

### S-24: Configurable area and camera view

- **Outcome:** User sets the simulation's spatial area size (within an admin-set range, bounded by F-07's capacity ceiling) when staging a run, and the render view becomes a camera over that area — auto-following the population by default, with manual pan/zoom override — rather than always rendering the entire area at once.
- **Change ID:** configurable-area-and-camera-view
- **PRD refs:** MS-01, MS-02
- **Prerequisites:** F-07 (area's admin-range ceiling must be set from real capacity first)
- **Parallel with:** S-26
- **Blockers:** —
- **Unknowns:**
  - ~~What is the camera's actual interaction model?~~ — **Resolved 2026-11-15.** Pan/zoom under user control, combined with auto-follow (the camera tracks the population by default; the user can pan/zoom to override). No longer blocks `/10x-plan`.
  - Does increasing the area change only the toroidal wrap boundary (`INITIAL_AREA_SIZE`/`Z_DEPTH_RANGE` in `boids.ts`), leaving all existing radii (`NEIGHBOR_RADIUS`, `CAPTURE_RADIUS`, etc.) fixed, or should some radii scale with area too? — Owner: user/team. Block: no — the Baseline's S-23 cross-reference suggests leaving radii fixed is the simpler, lower-risk default (and would make the existing spatial-hash grid more effective, not less); `/10x-plan` can propose this without blocking roadmap sequencing.
- **Risk:** Medium — this is the most technically novel work in M-4 (no camera/viewport concept exists anywhere in the render path today, per the Baseline). Changing world size also interacts with every `wrap()`/`wrappedDelta()` call site in `boids.ts` and with S-23's recently-shipped spatial-hash grid (cell-size-to-world-size ratio) — both already proven correct for a *fixed* 200-unit world; a variable area needs the same determinism discipline S-23 applied, not a weaker standard. Auto-follow + manual override also needs a clear handoff rule (e.g., does a manual pan suspend auto-follow until the user re-centers, or does auto-follow immediately resume next tick?) — a `/10x-plan`-level UX detail, not a roadmap blocker.
- **Status:** done

### S-25: Area-aware population insight

- **Outcome:** User sees, in a completed run's analysis view, whether population health held up given the area that run used — e.g., confirming that increasing the area didn't just thin the population out without the scoring/analysis reflecting why.
- **Change ID:** area-aware-population-insight
- **PRD refs:** MS-03
- **Prerequisites:** S-24 (needs a variable area to exist before an area-aware insight means anything)
- **Parallel with:** S-26
- **Blockers:** —
- **Unknowns:**
  - ~~What shape should this insight take?~~ — **Resolved 2026-11-15.** A new, fifth score factor (not a display-only note or chart) — reopens FR-010/FR-019's "four-factor product" formula into a five-factor one. `/10x-plan` must treat this with the same care S-09's prior phase-quality correction required (a scoring-formula change, not a cosmetic addition), including how it interacts with existing score-dependent features (leaderboard ordering, run comparison, the parameter-suggestion heuristic's correlation input). No longer blocks `/10x-plan`.
- **Risk:** Medium — upgraded from Low-medium now that the shape is confirmed as a formula change, not a display addition: a fifth score factor changes every existing scored run's *comparability* against future ones (same concern FR-010/FR-019's prior resolution had to address) and touches the leaderboard (S-19), run comparison (S-12), and parameter-suggestion heuristic (S-13) — all of which read the score as a single comparable number today. Depends entirely on S-24 landing first (needs a variable area to make an area-normalized factor meaningful).
- **Status:** done

### S-26: In-app feedback module

- **Outcome:** User reports a new functionality idea or a bug from within the app itself (not an external tool), and it's persisted somewhere the owner can review it when scoping a future milestone.
- **Change ID:** in-app-feedback-module
- **PRD refs:** MS-04
- **Prerequisites:** —
- **Parallel with:** F-07, S-24, S-25 — fully independent of the area/camera work.
- **Blockers:** —
- **Unknowns:**
  - ~~What's the actual mechanism?~~ — **Resolved 2026-11-15.** GitHub Issues integration — reports get created as real issues in this project's own GitHub repo, specifically so they flow into the existing dev pipeline (the same repo this app's CI/CD already deploys from) rather than into a second, disconnected inbox. No longer blocks `/10x-plan`.
  - Who can see submitted reports — moot given GitHub Issues' own visibility model (repo-level, not app-level) — Owner: user. Block: no.
- **Risk:** Low-medium — still fully additive to the simulation engine, but now carries a real external dependency (GitHub's API, auth for creating issues — likely a personal access token or GitHub App, not yet decided) that a pure DB-table design wouldn't have had; `/10x-plan` needs to settle how the app authenticates to GitHub without leaking a token client-side.
- **Status:** done

### S-27: Live-adjust flocking weights and food/threshold on a running simulation

- **Outcome:** User changes a server-owned run's separation/alignment/cohesion weights, food regen rate, and protection threshold while it is actively running, and sees the effect reflected in the live view within the next tick — not just at start time.
- **Change ID:** live-parameter-adjustment
- **PRD refs:** MS-01
- **Prerequisites:** — (server-owned execution (F-03/F-04), auth (F-01), and admin-configurable ranges (S-04/S-22) are all already `done`)
- **Parallel with:** — (only slice in this milestone)
- **Blockers:** —
- **Unknowns:**
  - Should a live parameter change be validated against the existing admin-configured ranges (`admin_settings.parameterRanges`, the same mechanism `start`/`stop` already enforce) before being applied, or is a runtime tweak to an already-running simulation allowed to exceed those ranges since it isn't a new run's initial configuration? — Owner: user. Block: no.
  - Should a live parameter change be recorded anywhere (e.g., appended to the run's persisted `history`) so a completed run's analysis view can show when/what was changed mid-run, or is it a pure runtime-only tweak with no persisted trace? — Owner: user. Block: no.
  - What's the UI mechanism for making the change — an inline editable panel on the live-view page, or a separate control surface? — Owner: user. Block: no (a planning-level UI decision, not a product blocker).
- **Risk:** The real risk is concurrency correctness, not scope: `tick()` runs on a 16ms `setInterval` per run, so a tRPC mutation writing `run.params` must not race a tick already in flight (a half-written params object read mid-tick could produce an inconsistent step). Kept as the sole slice of its own milestone — rather than folded into an unrelated change — so this correctness concern gets focused implementation and review attention.
- **Status:** done

### S-28: Client-staged parameter-adjustment parity

- **Outcome:** User changes a client-staged run's `foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, and `mutationMagnitude` while it is actively running — parity with S-27's corrected field set (see S-31), not its original, partly-non-functional one. Flocking weights are NOT included here either: they're per-boid genetic traits on the client-staged path too, for the exact same reason S-31 removes them from the server-owned set.
- **Change ID:** client-staged-live-parameter-parity
- **PRD refs:** MS-01
- **Prerequisites:** S-31 (sequencing, not a hard technical dependency — S-28 touches an entirely separate execution path and could technically be built against S-27's original field set, but doing so would replicate the exact same non-functional-weights mistake on a second path; plan S-28 only after S-31's corrected set is settled)
- **Parallel with:** S-29, S-30 — mutually independent, no shared Prerequisites
- **Blockers:** —
- **Unknowns:**
  - `simulation-canvas.tsx`'s tick effect must be restructured to read live values (e.g. via refs) instead of closed-over immutable props — does this risk destabilizing the existing determinism/behavior for the OTHER parameters that stay fixed for the run (boidCount, flockCount, flocking weights, etc.), or can the restructuring be scoped narrowly to only the genuinely-live fields? — Owner: team/plan. Block: no.
  - Unlike S-27's panel (which has to defend against a ~150ms server subscription push overwriting an in-progress edit), the client-staged path has no competing push source — does this mean the dirty-tracking complexity S-27 built is unnecessary here, simplifying the UI? — Owner: team/plan. Block: no (a `/10x-research` or `/10x-plan` question, not a product blocker).
  - Should the UI reuse the exact panel component/pattern from `ServerRunViewer`, or does `simulation-canvas.tsx`'s different rendering shell need its own version? — Owner: user. Block: no.
- **Risk:** This is the milestone's one genuinely new architectural pattern — a tick-loop effect reading live, externally-mutable values instead of treating its inputs as fixed for the run's lifetime. Get the restructuring wrong and it risks the client-staged path's existing correctness (bit-for-bit reproducibility, lifespan/age/energy accumulation), not just the new feature. Sequenced after S-31 specifically so this slice targets the verified-correct field set, not a repeat of S-27's defect.
- **Status:** done

### S-29: Live-adjust crossbreeding toggle on a running simulation

- **Outcome:** User toggles crossbreeding on or off for a running simulation — both server-owned and client-staged (scope expanded from server-owned-only during planning, user's explicit choice) — and sees the effect on subsequent reproduction events (mixed-flock pairs stop or start producing offspring).
- **Change ID:** live-crossbreeding-toggle
- **PRD refs:** MS-02
- **Prerequisites:** — (`crossbreedingEnabled` is already read fresh from `run.params`/the tick closure every tick on both paths — confirmed via direct code inspection; the gap is `LiveAdjustableParams`'s type-level allowlist plus, on the client-staged path, the same ref treatment S-28 gave its 5 numeric fields)
- **Parallel with:** S-28, S-30 — mutually independent, no shared Prerequisites
- **Blockers:** —
- **Unknowns:** — (resolved during planning: reuses the existing numeric live-adjust machinery with a `Switch` control, not a separate boolean-only mechanism)
- **Risk:** Low — confirmed by direct code inspection that `crossbreedingEnabled` is structurally already "live" the same way the 5 fields S-27/S-28 shipped are; the change is closer to widening an allowlist than building new mechanism. The main risk (boolean vs. numeric type friction) was resolved during planning via a generic, isolated coercion at 2 call sites.
- **Status:** done

### S-30: Live-adjust boid and predator count on a running simulation

- **Outcome:** User increases or decreases a running server-owned simulation's boid count AND predator count while it is actively running — both execution paths' object-shape, scope expanded during planning from boid-only, user's explicit choice, since `PredatorState` carries the identical energy/age shape `BoidState` does — and sees the population size change reflected in the live view.
- **Change ID:** live-boid-count-adjustment
- **PRD refs:** MS-03
- **Prerequisites:** — (`createInitialPopulation`/`createInitialPredators`'s generation logic and `applyHunger`/`applyPredation`'s cull-by-filter patterns both already exist as reusable precedents)
- **Parallel with:** S-28, S-29 — mutually independent, no shared Prerequisites
- **Blockers:** —
- **Unknowns:** — (resolved during planning: clustered-near-centroid spawn for growth; lowest-energy-first cull for shrink; soft-warn, not hard-block, against both the per-run `maxObjectCount` and cross-run `maxConcurrentObjectCount` caps, mirroring S-27's soft-range-check precedent)
- **Risk:** Moderate — unlike S-27/S-29 (a `run.params` scalar patch), this mutates the live `boids`/`predators` arrays themselves, a structurally different and riskier operation (array identity, length changes mid-tick-read, interaction with existing per-tick sample arrays sized by population). Has real precedent to build on (`applyHunger`/`applyPredation`'s filter idiom), but deserves the same concurrency-correctness scrutiny S-27's impl-review applied to its own scalar patch.
- **Status:** done

### S-31: Correct S-27's live-adjustable field set

- **Outcome:** A user live-adjusting a running server-owned simulation only sees fields that have a real, verified effect on its behavior — `separationWeight`/`alignmentWeight`/`cohesionWeight` (which turn out to be per-boid genetic traits set once at birth, never read from the live-patched run-level params, so S-27's live-adjustment of them has no observable effect on anything, old boid or new) are removed from the live-adjustable set and replaced with `energyThreshold`, `mutationChance`, and `mutationMagnitude` — genuinely global reproduction-control parameters, read fresh at the moment each new reproduction event is evaluated, so adjusting them correctly affects only future offspring, never retroactively changing an existing individual. `foodRegenRate` and `protectionThreshold` are already correct (confirmed global, read fresh every tick) and are untouched.
- **Change ID:** correct-live-parameter-field-set
- **PRD refs:** MS-01 (M-6 charter note: corrects a verified S-27 defect before M-6 extends the mechanism further)
- **Prerequisites:** — (S-27/`applyLiveParams`/`updateRunParams` mechanism already exists and is reused as-is; only the field *allowlist* and the UI panel's field list change)
- **Parallel with:** S-29, S-30 — independent of both; S-28 should sequence after this one (see S-28's Prerequisites)
- **Blockers:** —
- **Unknowns:**
  - Should the live-view panel's UI simply swap which 5 fields it shows (3 removed, 3 added), or does showing `energyThreshold`/`mutationChance`/`mutationMagnitude` need different framing/copy than the weight fields had, since their effect is "future offspring only" rather than "immediate" (foodRegenRate/protectionThreshold are immediate; these 3 are not)? — Owner: user. Block: no.
  - Manual verification for this slice must observe an actual behavior change (e.g., a visibly different mutation rate in subsequent offspring, or a changed reproduction-eligibility threshold), not just that the mutation accepts the input and the UI reflects the new value — the exact gap that let S-27's defect ship unnoticed. — Owner: team/plan. Block: no.
- **Risk:** Low implementation risk (mirrors S-27's exact mechanism, just a different field set), but this is a correctness fix for shipped, archived, user-facing behavior — worth flagging in the change's own notes that S-27 (now corrected) never worked as advertised for 3 of its 5 fields, so anyone who used it to tune weights mid-run saw no real effect and may not have known why.
- **Status:** done

### S-32: Genetic-diversity trend over time in the analysis view

- **Outcome:** User sees, in a completed run's analysis view, how genetic diversity changed over the course of the run — not just the single final value (FR-025) shown today. Reverses the PRD's own Non-Goal at this scope (`prd.md`'s Non-Goals: "No diversity-index trend over time in the analysis view (v1)"), per the Non-Goal's own "revisit if a future slice needs the same series" clause — the user has now asked for exactly that.
- **Change ID:** genetic-diversity-trend
- **PRD refs:** FR-025, MS-01 (extends FR-025's existing final-value display; overrides the Non-Goal at Non-Goals §3, "No diversity-index trend over time")
- **Prerequisites:** — (`computeGeneticDiversity` (`boids.ts:1266`) already takes exactly the per-tick input shape needed — `boids.map(b => b.genes)` — and the per-tick sample-array pattern this mirrors already exists three times over: `populationCountSamples`/`foodRatioSamples`/`populationDensitySamples`)
- **Parallel with:** — (sole slice this milestone)
- **Blockers:** —
- **Unknowns:** — (resolved during planning: a separate chart below the population chart, not a shared/dual Y-axis)
- **Risk:** Low — mirrors three existing precedents exactly (append-per-tick sample array, schema-less `history` JSON blob needs no migration, optional-field guarded read for backward compatibility with older runs lacking the series — same pattern `populationCountSamples?` already uses at `simulation.ts:811`).
- **Status:** done

### S-33: Generate and persist the parameter-sweep corpus

- **Outcome:** Maintainer generates a ~20-run structured-parameter-sweep corpus (varying flocking weights, food regen rate, and crossbreeding across a few levels each, deliberately targeting healthy-growth/crash/overshoot-recovery phases), with up to 4 runs registered and ticking concurrently at a time, each capped at 60 simulated minutes, using F-08's harness — then exports the full corpus to a reusable fixture file and cleans up every generation-time DB/registry artifact, leaving only the exported file behind.
- **Change ID:** parameter-sweep-corpus-generation
- **PRD refs:** MS-01, MS-02, MS-03, MS-06
- **Prerequisites:** F-08 (the single-run generate-and-export harness this slice calls ~20 times, batched)
- **Parallel with:** — (the only slice building the corpus; S-34/S-35 both wait on this one's output)
- **Blockers:** —
- **Unknowns:**
  - Exact parameter/level matrix for the structured sweep (which specific values of separation/alignment/cohesion weight, food regen rate, and crossbreeding on/off, and how they combine into ~20 runs) — Owner: team/plan. Block: no — `/10x-plan` can propose a concrete matrix grounded in the existing admin-configured ranges and the phase-quality model; the user can adjust.
  - Exact fixture-file format and location (e.g. `context/fixtures/` or a test-only directory, JSON vs. CSV, one file vs. one-per-run) — Owner: team/plan. Block: no.
- **Risk:** Moderate — the first real exercise of F-08's harness at scale (4-way concurrent registration) and the first slice needing an explicit "clean before, clean after, keep only the export" lifecycle discipline; deserves the same care S-27's impl-review gave to concurrency/bounds, now applied to a batch-generation script instead of a single live-adjust mutation.
- **Status:** done

### S-34: Suggestion-quality test against the corpus

- **Outcome:** Maintainer has an automated test that runs the existing parameter-suggestion heuristic (FR-015) against the persisted corpus fixture and asserts it surfaces a sensible, correlated suggestion — turning "xcheck if we can get suggestions on parameters" into a repeatable regression check rather than a one-time manual read of the output.
- **Change ID:** suggestion-quality-corpus-test
- **PRD refs:** MS-04
- **Prerequisites:** S-33 (consumes its exported fixture — never regenerates the corpus itself)
- **Parallel with:** S-35 (both consume S-33's output independently, touch unrelated code paths)
- **Blockers:** —
- **Unknowns:**
  - What exactly counts as "sensible" for the assertion — must the suggested parameter be the single most-correlated one the heuristic itself would rank first (deterministic, since the corpus is fixed), or is a looser bound (e.g. "among the top 3 correlated") more robust to minor heuristic tuning later? — Owner: user. Block: no — `/10x-plan` will propose the stricter exact-match assertion by default, grounded in the corpus being a fixed, deterministic fixture.
- **Risk:** Low — the heuristic itself (FR-015/S-13) is already shipped and tested in isolation; this slice only adds a new input fixture and a correctness assertion against it, no changes to the heuristic's own logic.
- **Status:** done

### S-35: Analytics-correctness tests against the corpus

- **Outcome:** Maintainer has automated tests confirming every per-run analytics function (`getRunAnalysis`'s population/diversity/phase-breakdown/completed-cycles/final-diversity/optimization-suggestion, `getRunsComparison`, `listCompleted`/leaderboard ranking) handles the corpus's full range of parameter combinations — including any scenario that produced a crash, an empty population, or an unusual phase sequence — without throwing or returning a malformed shape.
- **Change ID:** analytics-correctness-corpus-tests
- **PRD refs:** MS-05
- **Prerequisites:** S-33 (consumes its exported fixture)
- **Parallel with:** S-34 (both consume S-33's output independently)
- **Blockers:** —
- **Unknowns:**
  - Should every analytics endpoint get its own dedicated test iterating the full corpus, or one shared parameterized test (`it.each`) per endpoint across all corpus entries — Owner: team/plan. Block: no — the latter matches this project's own `lessons.md` guidance against "redundant copies" of near-identical tests.
- **Risk:** Low — purely additive test coverage against already-shipped, already-tested endpoints; the main value is catching an edge case (e.g. a crashed-to-zero-population run) that the corpus's deliberately varied scenarios might surface but today's narrower test fixtures don't.
- **Status:** done

### S-36: Unwatched-run tick throttling

- **Outcome:** User runs multiple server-owned simulations simultaneously and the one they're actively watching stays responsive, because unwatched runs no longer tick at an equal, real-time-matched cadence and compete for the same single CPU core.
- **Change ID:** unwatched-run-tick-throttling
- **PRD refs:** MS-03
- **Prerequisites:** — (server-owned execution, F-03/F-04, already done)
- **Parallel with:** S-37, S-38
- **Blockers:** —
- **Unknowns:** — (resolved 2026-11-17: a fixed speed multiplier accelerates `dtSeconds` for runs with zero active viewers; any run that ticked unwatched under the multiplier gets a formula/model-version marker, same pattern as S-25's area-aware 5th score factor, so comparability against pre-change runs is explicit rather than silently broken — `/10x-plan` resolves the exact multiplier value and marker schema).
- **Risk:** This changes the core tick-timing/determinism model every existing scored/analyzed/compared run depends on — mitigated by the version-marker decision above; `/10x-plan` must still verify the marker is checked everywhere runs are compared (analysis view, leaderboard, run-comparison), not just written at score time.
- **Status:** done

### S-37: Confirm per-run history scope is forward-only

- **Outcome:** User (and the team) has a documented confirmation that per-run history (F-05) applies only to runs completed after it shipped, with older runs' dashboard/analysis views showing an accurate "no history data" state rather than an error or a misleading empty chart.
- **Change ID:** confirm-run-history-retroactive-scope
- **PRD refs:** MS-01
- **Prerequisites:** — (F-05, S-10, S-11 already done)
- **Parallel with:** S-36, S-38
- **Blockers:** —
- **Unknowns:** — (the forward-only resolution is already the shipped default per F-05/S-11; research confirmed one real empty-state bug — see Risk — and this slice fixes it, then formally closes Open Roadmap Question #4)
- **Risk:** Low — research found the run-analysis page's "Final genetic diversity" scalar has no null-history guard and silently shows `0.000` for an old run (`src/app/runs/[runId]/page.tsx`); a small, low-risk copy/guard fix matching the page's own existing pattern for every other section.
- **Status:** done

### S-38: Confirm admin-elevation mechanism is resolved

- **Outcome:** User (and the team) has a documented confirmation that temporary admin elevation (FR-030) already uses the time-boxed, self-service mechanism decided during S-22's own planning, with no outstanding design decision left open.
- **Change ID:** confirm-admin-elevation-mechanism-resolved
- **PRD refs:** MS-02
- **Prerequisites:** — (S-22 already done, archived)
- **Parallel with:** S-36, S-37
- **Blockers:** —
- **Unknowns:** — (mechanism already implemented and documented in the archived S-22 plan; this slice verifies current behavior still matches and formally closes Open Roadmap Question #6)
- **Risk:** Low — verification-only.
- **Status:** done

### S-39: Fix default-parameter simulation start

- **Outcome:** User can start a simulation using the form's own default values, with no error and no unexplained failure.
- **Change ID:** fix-default-start-failure
- **PRD refs:** MS-01
- **Prerequisites:** —
- **Parallel with:** F-09
- **Blockers:** —
- **Unknowns:**
  - What is the actual failure mode — a server-side rejection, a silent no-op, a client-side crash, or something else? Owner: team (research). Block: no — exactly what `/10x-research` resolves before `/10x-plan`; not a cross-cutting decision.
- **Risk:** Likely low effort once reproduced, but currently zero confirmed repro — a dev-server HMR reload-loop artifact blocked one live-reproduction attempt this session, and a static review of `startInputSchema`/`checkAgainstAdminRanges`/the seeded `admin_settings` row found no rule that should reject the UI's literal default values. Needs a clean research pass before planning.
- **Status:** done

### S-40: Per-tribe boid behavior config

- **Outcome:** User configures separation/alignment/cohesion weight, per-behavior perception radii, and behavior multipliers (predator-avoidance, food-seeking, burst) independently for each boid tribe before starting a run — full Lua-reference (`config.lua`) parity — and sees tribes behave visibly differently from each other.
- **Change ID:** per-tribe-boid-behavior-config
- **PRD refs:** MS-02
- **Prerequisites:** S-39 (done — a working start flow to verify against), F-09
- **Parallel with:** S-41, S-42
- **Blockers:** —
- **Unknowns:** — (resolved 2026-11-17: full Lua-reference parity in scope; genetics-per-tribe is NOT in this slice's scope — mutation/inheritance stays global/cross-tribe as it already is for boids, per Open Roadmap Question #9's resolution)
- **Risk:** Medium-high — the per-tick flocking-force calculation (`boids.ts`) currently reads one shared weight set for every boid; this is a real physics-engine change touching every per-behavior force calculation, not just a new form field. Larger than the original 3-weight scope.
- **Status:** proposed (Unknowns resolved; waiting on F-09, not yet built)

### S-41: Per-tribe food config

- **Outcome:** User configures food stock and regeneration rate independently per boid tribe, instead of one shared food pool/rate for the whole run.
- **Change ID:** per-tribe-food-config
- **PRD refs:** MS-03
- **Prerequisites:** S-39 (done)
- **Parallel with:** S-40, S-42
- **Blockers:** —
- **Unknowns:** — (resolved 2026-11-17: shared pool, per-tribe stock/regen settings — not physically separate pools; matches the Lua reference, where food is also global)
- **Risk:** Low-medium — config-only change against the existing shared food pool, no new spawn/consumption-loop logic.
- **Status:** ready

### S-42: Per-tribe predator config

- **Outcome:** User configures each predator tribe's own behavior tuning (speed, perception, hunt aggressiveness) independently, and predator tribes reproduce with independently-evolving genetics — mirroring boid flocks' existing crossbreeding system, scoped per tribe.
- **Change ID:** per-tribe-predator-config
- **PRD refs:** MS-04
- **Prerequisites:** S-39 (done), F-10
- **Parallel with:** S-40, S-41
- **Blockers:** —
- **Unknowns:** — (resolved 2026-11-17: genetics-evolving, not static — also Open Roadmap Question #9's resolution)
- **Risk:** Medium-high — same category of change as S-40 but on the predator side; genetics-evolving tribes depend on F-10 (predators currently have no tribe/flock concept at all, unlike boids) landing first. Also the direct prerequisite for S-43's second predator tribe.
- **Status:** proposed (Unknown resolved; waiting on F-10, not yet built)

### S-43: Second predator tribe with configurable prey target

- **Outcome:** User adds a second predator tribe to a run and chooses its prey target — boids only, or boids and predators — and sees that tribe hunt accordingly.
- **Change ID:** second-predator-tribe-prey-target
- **PRD refs:** MS-05
- **Prerequisites:** S-42, F-10
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Exact scoring-rule shape for inter-predator predation — a new 6th score factor, or folded into an existing one (e.g. survival)? Owner: user, but scoped to `/10x-plan` as an implementation-design decision now that the direction (factor it in, resolved via Open Roadmap Question #10) is settled. Block: no — `/10x-plan` can propose a concrete design for user approval; doesn't block roadmap sequencing.
- **Risk:** High — the most novel piece in this milestone, with no precedent in the Lua reference or anywhere in the current codebase; now also depends on F-10 (predator tribe concept) existing.
- **Status:** proposed (Unknowns resolved at the roadmap level; waiting on S-42 and F-10, neither built yet)

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                              | Ready for `/10x-plan` | Notes                                                  |
| ---------- | -------------------------------- | --------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| F-01       | gate-product-routes               | Gate product routes behind login with member/admin roles              | yes                     | —                                                        |
| F-02       | deterministic-seed-strategy       | Choose and wire a deterministic seeded-PRNG strategy                  | yes                     | —                                                        |
| S-01       | basic-flocking-loop                | Basic flocking simulation: configure, run, stop, basic score          | no                      | Waiting on F-01, F-02                                   |
| S-02       | predator-prey-dynamics             | Predator-prey dynamics with flock protection threshold                 | no                      | Waiting on S-01                                          |
| S-03       | genetic-inheritance-crossbreeding  | Genetic inheritance and inter-flock crossbreeding toggle               | no                      | Waiting on S-02                                          |
| S-04       | full-score-save-resume             | Full parameter config, save/resume, complete four-part score           | yes                     | Waiting on S-03, F-01 (both done); scoring-formula decision resolved 2026-11-14 |
| S-05       | parallel-sim-switching             | Run and switch between several parallel simulations                    | no                      | Waiting on S-01; can run parallel with S-02–S-04        |
| F-03       | server-side-simulation-engine      | Server-owned execution engine for simulation runs                      | yes                     | No prerequisites; first item of the 2026-11-14 extension |
| F-04       | live-simulation-view-channel       | Server push channel for live single-run viewing                        | no                      | Waiting on F-03; can run parallel with S-06             |
| S-06       | start-server-run-simulation        | Start a real simulation that keeps running on the server                | no                      | Waiting on F-03                                          |
| S-07       | view-running-server-simulation     | View one running server simulation live via pushed state                | no                      | Waiting on S-06, F-04                                    |
| S-08       | server-run-list-and-switch         | List/switch running server simulations; retire old client switcher      | no                      | Waiting on S-07                                          |
| S-09       | phase-quality-per-cycle-scoring    | Correct phase-quality score to summarize per completed cycle            | yes                     | No prerequisites — standalone correction                 |
| F-05       | persist-run-history                 | Persist per-run population history for analysis                        | yes                     | No prerequisites — can run parallel with S-09, S-10       |
| S-10       | post-login-run-dashboard           | Post-login dashboard of the user's own runs                             | yes                     | Waiting on F-01 (done); can run parallel with S-09, F-05  |
| S-11       | run-analysis-view                   | Per-run population-dynamics analysis view                               | no                      | Waiting on F-05, S-09, S-10                               |
| S-12       | compare-runs-side-by-side           | Compare completed runs' scores side by side                             | yes                     | No new unknowns; waiting on F-05, S-11 (both done) — M-2 north star |
| S-13       | parameter-suggestion-heuristic      | Heuristic next-parameter suggestion correlated with final score         | yes                     | Heuristic design resolved 2026-11-14; can run parallel with S-12, S-14 |
| S-14       | run-export                          | Export a run's parameters/score/history outside the app (JSON + CSV)    | yes                     | Export formats resolved 2026-11-14; can run parallel with S-12, S-13 |
| F-06       | ui-design-system-foundation         | Shared app shell + extended design tokens, shadcn-admin-dashboard pattern | yes                   | No prerequisites — M-3 north-star foundation |
| S-15       | branded-login-page                  | Branded Swarm Arena login page                                          | no                      | Waiting on F-06 — M-3 north star |
| S-16       | dashboard-restyle                   | Restyle the post-login dashboard                                        | no                      | Waiting on F-06; can run parallel with S-17–S-20 |
| S-17       | staging-live-view-restyle           | Restyle the simulation staging form and live view                       | no                      | Waiting on F-06; can run parallel with S-16, S-18–S-20 |
| S-18       | analysis-comparison-restyle         | Restyle the run-analysis and run-comparison pages                       | no                      | Waiting on F-06; can run parallel with S-16, S-17, S-19, S-20 |
| S-19       | leaderboard                         | Leaderboard of the user's completed runs ranked by score                | no                      | Waiting on F-06; can run parallel with S-16–S-18, S-20 |
| S-20       | reference-documentation-pages       | Storyline/parameters/population-lifecycle/metrics reference pages       | no                      | Waiting on F-06; can run parallel with S-16–S-19 |
| S-21       | post-run-optimization-suggestion    | Run-specific post-run optimization suggestion on the analysis view      | yes                     | No prerequisites — can run parallel with everything else in M-3 |
| S-22       | temporary-admin-elevation           | Reversible, temporary elevation to admin                                | yes                     | No prerequisites — elevation mechanism deferred to `/10x-plan` |
| S-23       | spatial-hash-performance-optimization | Spatial-partitioning neighbor search for flocking calculations        | yes                     | No prerequisites — ported from the project's own prior Lua implementation |
| F-07       | vps-resource-capacity-limits        | Derive area/object-count/concurrency ceilings from the VPS's real specs | done                   | Archived → `context/archive/2026-11-15-vps-resource-capacity-limits/`; see `context/foundation/capacity-limits.md` |
| S-24       | configurable-area-and-camera-view   | Configurable simulation area + camera-limited render view                | yes                    | F-07 done — run `/10x-plan configurable-area-and-camera-view` |
| S-25       | area-aware-population-insight       | Area-aware population-health insight in run analysis                    | no                     | Unknowns resolved (new 5th score factor); still waiting on S-24 to land first |
| S-26       | in-app-feedback-module               | In-app feedback/bug-report module                                        | yes                    | Unknowns resolved (GitHub Issues integration) — no prerequisites, ready to plan now |
| S-27       | live-parameter-adjustment            | Live-adjust flocking weights, food regen rate, and protection threshold on a running server-owned simulation | yes                    | No prerequisites; all 3 Unknowns are non-blocking planning-level decisions — ready to plan now |
| S-28       | client-staged-live-parameter-parity  | Bring live parameter adjustment to the client-staged execution path (parity with S-27, corrected) | no                     | Waiting on S-31 (sequencing — plan against the corrected field set, not S-27's original) |
| S-29       | live-crossbreeding-toggle            | Live-adjust the crossbreeding toggle on a running server-owned simulation | yes                    | No prerequisites; confirmed already structurally live, just excluded from the allowlist type |
| S-30       | live-boid-count-adjustment           | Live-adjust boid count (increase/decrease) on a running server-owned simulation | yes                    | No prerequisites; real array-mutation work with existing cull/generation patterns to build on |
| S-31       | correct-live-parameter-field-set     | Fix S-27's live-adjustable field set: remove non-functional weights, add functional reproduction params | yes                    | No prerequisites; corrects a verified defect in archived S-27 — recommended next move |
| S-32       | genetic-diversity-trend              | Chart genetic-diversity trend over time in the analysis view, alongside the existing population-count chart | yes                    | No prerequisites; mirrors 3 existing per-tick sample-array precedents — ready to plan now |
| F-08       | corpus-generation-harness            | Single-run generate-and-export harness for simulation test fixtures | yes                    | No prerequisites; reuses the existing server-owned engine + createCaller test pattern — ready to plan now |
| S-33       | parameter-sweep-corpus-generation    | Generate and persist a ~20-run structured-parameter-sweep corpus to a reusable fixture file | no                     | Waiting on F-08 |
| S-34       | suggestion-quality-corpus-test       | Automated test: parameter-suggestion heuristic produces a sensible, correlated suggestion against the corpus | no                     | Waiting on S-33 |
| S-35       | analytics-correctness-corpus-tests   | Automated tests: every per-run analytics function handles the corpus's full range of parameter combinations | no                     | Waiting on S-33; can run parallel with S-34 |
| S-36       | unwatched-run-tick-throttling        | Decide and implement CPU-fair tick throttling for unwatched server-owned runs | yes                     | Run `/10x-plan unwatched-run-tick-throttling` |
| S-37       | confirm-run-history-retroactive-scope | Confirm and close: per-run history is forward-only, not retroactive | yes                     | Run `/10x-plan confirm-run-history-retroactive-scope` |
| S-38       | confirm-admin-elevation-mechanism-resolved | Confirm and close: admin-elevation mechanism already resolved (time-boxed, self-service) | yes                     | Run `/10x-plan confirm-admin-elevation-mechanism-resolved` |
| S-39       | fix-default-start-failure         | Fix: starting a simulation with default parameter values doesn't work | yes (done)              | Archived — `context/archive/2026-11-17-fix-default-start-failure/` |
| F-09       | per-tribe-behavior-weights        | Add full per-tribe boid behavior data model (weights, perception, multipliers) | yes                     | Run `/10x-plan per-tribe-behavior-weights` |
| F-10       | predator-tribe-concept            | Add predator tribe grouping with independently-evolving genetics | yes                     | Run `/10x-plan predator-tribe-concept` |
| S-40       | per-tribe-boid-behavior-config    | User configures full per-tribe boid behavior (weights, perception, multipliers) | no                      | Waiting on F-09 |
| S-41       | per-tribe-food-config             | User configures food stock/regen rate per boid tribe | yes                     | Run `/10x-plan per-tribe-food-config` |
| S-42       | per-tribe-predator-config         | User configures a predator tribe's own behavior tuning, with genetics | no                      | Waiting on F-10 |
| S-43       | second-predator-tribe-prey-target | User adds a second predator tribe with a boids-only or boids-and-predators prey target, scored | no                      | Waiting on S-42, F-10 |

## Open Roadmap Questions

1. ~~What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?~~ — **Resolved 2026-11-14.** Equal product of four factors, now including population-lifecycle-phase quality (FR-019). See PRD Open Questions #1 and Business Logic. No longer blocks S-04.
2. ~~What export format(s) should the export feature (FR-017) support (CSV / JSON / image / other)?~~ — **Resolved 2026-11-14.** Both JSON (full-fidelity) and CSV (parameters + score, no nested history). See PRD Open Questions #2. No longer blocks S-14.
3. ~~Beyond defining parameter ranges and the object-count cap, does `admin` have any other capability — e.g. managing other users' simulations — or is the role split purely about parameter governance?~~ — **Resolved 2026-11-14** (see PRD Open Questions #3) — every FR added since stays within per-user data isolation; not blocking.
4. ~~Should F-05's per-run history persistence apply retroactively to already-archived runs, or only to runs that complete after it ships?~~ — **Resolved 2026-11-17 via `confirm-run-history-retroactive-scope` (M-9's S-37).** Confirmed forward-only (no backfill path exists anywhere, by design). The one real gap found — the run-analysis page's "Final genetic diversity" scalar silently showed `0.000` for a history-less run — is fixed; verified against a real null-history run (shows "No final genetic-diversity value recorded for this run.") and a real history-present run (unaffected).
5. ~~What should the parameter-suggestion heuristic (FR-015) actually optimize toward, and what shape should its suggestion take?~~ — **Resolved 2026-11-14.** Optimizes toward the final combined score, correlating each of the 13 admin-ranged parameters against the user's own past-run scores; suggests the single most-correlated one with a rationale and a confidence qualifier (minimum 3 varied runs). See PRD Open Questions #5. No longer blocks S-13.
6. ~~What exact mechanism should temporary admin elevation (FR-030/S-22) use — a self-service toggle, a time-boxed grant, or something else?~~ — **Resolved 2026-11-17 via `confirm-admin-elevation-mechanism-resolved` (M-9's S-38).** Confirmed the time-boxed, self-service mechanism shipped during S-22's own planning (`context/archive/2026-11-14-temporary-admin-elevation/plan.md`) is still fully live and unmodified — re-verified every component (the `elevatedUntil` column, `isEffectivelyAdmin` helper, both authorization sites, all 5 tRPC procedures, the `ALLOW_SELF_ELEVATION` safety flag, the `/admin/elevation` UI, and full test coverage) against current code. No gap found; no code change needed.
7. **Beyond the `next-shadcn-admin-dashboard` structural reference, which specific pages get restyled first, and in what order?** — Owner: roadmap (this decomposition). Resolved for sequencing purposes: `S-15` (login) first as the north star, then `S-16`–`S-20` in any order/parallel — see Streams row G. Per PRD Open Question #7.
8. **Should unwatched server-owned runs be allowed to tick faster than real time (not throttled to the live-view's 16ms cadence), so background runs don't compete for CPU against the one the user is actively watching?** — Owner: user. Block: yes — **now tracked as M-9's S-36** (`unwatched-run-tick-throttling`, 2026-11-17), blocked on deciding the exact throttling mechanism and its effect on score comparability against pre-existing runs.
9. ~~How far should per-tribe differentiation go — just behavior weights (separation/alignment/cohesion), or also independently-evolving genetics/mutation rates per tribe, extending the existing crossbreeding system?~~ — **Resolved 2026-11-17.** Full Lua-reference parity for boid tribes (S-40: per-tribe perception radii and behavior multipliers, not just the 3 weights) AND independently-evolving genetics per tribe for predators (S-42). No longer blocks S-40; S-42 now depends on F-10 (new — predators have no tribe concept at all today) instead of being blocked on this question.
10. ~~Should inter-predator predation (S-43) affect the existing 5-factor score formula, or remain a purely simulation/visual mechanic with no scoring impact for v1?~~ — **Resolved 2026-11-17.** Yes, factor it into scoring. The exact scoring-rule shape (new factor vs. folded into an existing one) is a `/10x-plan`-level design decision, not a roadmap-level one — tracked as S-43's own Unknown below, no longer blocking at the roadmap level.

## Parked

- **Shared/collaborative simulations across users** — Why parked: explicit PRD Non-Goal — admin/member are access roles, not co-editing roles; a run belongs to the user who started it.
- **Client-driven parallel rendering of multiple simulations at once** — Why parked: explicit PRD Non-Goal (2026-11-14 extension) — retired in favor of server-owned execution; the client renders at most one server-run simulation live at a time.
- **Diversity-index trend over time in the analysis view** — ~~Why parked: explicit PRD Non-Goal (2026-11-14 extension) — only a single final genetic-diversity value is persisted; a trend would need a new per-tick series nothing downstream currently needs.~~ Promoted into M-7's slice S-32 (2026-11-15), per the Non-Goal's own "revisit if a future slice needs the same series" clause.
- **Live, in-run parameter adjustment** — ~~Why parked: explicit PRD Non-Goal (2026-11-14 extension round 3, FR-028) — the live simulation engine has no live-parameter-update path today; materially larger architectural change than the post-run suggestion (S-21), which ships instead.~~ Promoted into M-5's slice S-27 (2026-11-15), per the Non-Goal's own "revisit as its own future milestone" note — scoped to flocking weights + food regen rate + protection threshold on server-owned runs only (see the two narrower items below for what's still excluded).
- **Full UI rewrite onto a new template** — Why parked: explicit PRD Non-Goal (2026-11-14 extension round 3, FR-032) — F-06 adopts a modern design direction incrementally on the existing shadcn/ui layer, not a wholesale replacement.
- **Live parameter adjustment on client-staged runs** — ~~Why parked (M-5, 2026-11-15): `simulation-canvas.tsx`'s tick-loop effect deliberately closes over its parameter props as fixed for the run's lifetime; undoing that is a real structural change, not a small addition.~~ Promoted into M-6's slice S-28 (2026-11-15).
- **Live adjustment of population-shape parameters** — ~~Why parked (M-5, 2026-11-15): these require re-initializing the population/world state, not just patching a value read fresh every tick.~~ Partially promoted into M-6 (2026-11-15): `crossbreedingEnabled` (S-29) and `boidCount` (S-30) were investigated and found cheap enough to live-patch — see the narrower item below for what's still excluded.
- **Live adjustment of `flockCount`** (M-6, 2026-11-15) — Why parked: investigated directly — every boid's `flockId` (and derived color) is set once at birth (`BoidGenes.flockId`) and never re-derived per tick; `createFlockColors`/`splitCountAcrossFlocks` only run at population-creation time. Changing `flockCount` mid-run has no patch option — it requires rewriting `flockId` and recoloring across the entire live population, much closer to "restart with new params" than a param patch. Revisit as its own future milestone if there's demand.

(FR-015, FR-016, and FR-017 — previously parked here as nice-to-have — are promoted into M-2's slices S-13, S-12, and S-14 respectively; see `## Slices`.)

## Milestone History

- **M-1: First working simulation loop** (`first-working-simulation-loop`) — closed 2026-11-14. Delivered the first end-to-end boids/predator simulation loop (configure, run, stop/resume, score) plus server-owned execution, a post-login run dashboard, and a per-run population-dynamics analysis view; all 5 foundations and 11 slices done.
- **M-2: Insight and comparison** (`insight-and-comparison`) — closed 2026-11-14. Delivered the three remaining nice-to-have FRs M-1 deferred: side-by-side run comparison, a score-correlated parameter-change suggestion, and JSON/CSV run export; all 3 slices done. Every FR in the PRD (v4) is now implemented.
- **M-3: Modernization and polish** (`modernization-and-polish`) — closed 2026-11-15. Delivered a shared app shell/design-token foundation and five pages built or restyled on it (branded login, dashboard, staging/live view, analysis/comparison, a new leaderboard, and four new reference/documentation pages), a run-specific post-run optimization suggestion, temporary admin elevation, and a spatial-hash neighbor-search optimization for the flocking engine; F-06 and all 9 slices (S-15–S-23) done. Every FR in the PRD (v5) is now implemented.
- **M-4: Area, camera, and ops limits** (`area-camera-and-ops-limits`) — closed 2026-11-15. Delivered VPS-measured capacity ceilings for area/object-count/concurrency (F-07), a configurable simulation area with a camera-limited render view (S-24), a new area-aware 5th score factor with backward-compatible run comparison and a formula-version marker (S-25), and an in-app GitHub-Issues-backed feedback module with a DB-backed retry queue (S-26); F-07 and all 3 slices (S-24–S-26) done.
- **M-9: Resolve remaining roadmap questions** (`roadmap-question-resolution`) — closed 2026-11-17. Formally closed Open Roadmap Questions #4, #6, and #8: confirmed per-run history is forward-only (S-37, found and fixed a real "0.000" display bug for history-less runs), confirmed temporary admin elevation already uses the resolved time-boxed mechanism with no gap (S-38), and designed/implemented CPU-fair tick throttling for unwatched server-owned runs — a 3x dt multiplier after a 5s grace period, with a sticky wasEverThrottled comparability marker flagged across leaderboard, run comparison, parameter suggestion, and run export (S-36); all 3 slices done.
- **M-5: Live in-run parameter adjustment** (`live-in-run-parameter-adjustment`) — closed 2026-11-15. Delivered live mid-run tuning of a server-owned simulation's flocking weights, food regen rate, and protection threshold (soft-validated against admin ranges, server-side throttled), with a persisted change-log overlaid on the completed run's population chart; S-27 (the milestone's sole slice) done. Scoped to the server-owned execution path only — client-staged parity and population-shape parameter adjustment stay parked for a future milestone.
- **M-6: Extended live tuning** (`extended-live-tuning`) — closed 2026-11-15. Delivered client-staged live-parameter parity (S-28), a live crossbreeding toggle on both execution paths (S-29, scope expanded from server-owned-only during planning), live boid-AND-predator count adjustment on the server-owned path (S-30, scope expanded from boid-only), and a correction to S-27's own live-adjustable field set (S-31); all 4 slices done. `flockCount` live-adjustment stays parked — investigated and found structurally invasive (every boid's `flockId`/color is set once at birth, never re-derived per tick).
- **M-7: Genetic-diversity trend** (`genetic-diversity-trend`) — closed 2026-11-15. Delivered a per-tick genetic-diversity sample series across both execution paths and a new trend chart in the analysis view (S-32, the milestone's sole slice), reversing the PRD's own "No diversity-index trend over time" Non-Goal per its own revisit clause. Plan-review caught 2 critical gaps before implementation — the server-owned pause/resume snapshot path (the exact S-25 lesson bug class) and the client-staged execution path, both missing from the initial draft despite the Overview claiming both paths.
- **M-8: Parameter-suggestion & analytics validation corpus** (`parameter-suggestion-analytics-corpus`) — closed 2026-11-16. Delivered a reusable, persisted structured-parameter-sweep corpus (F-08, S-33) and two regression suites against it: parameter-suggestion-heuristic quality (S-34) and per-run analytics correctness across the corpus's full parameter range (S-35). Every scope anchor (MS-01–MS-06) satisfied.

## Done

- **S-39: User starts a simulation using the form's own default values, with no error and no unexplained failure.** — Archived 2026-11-17 → `context/archive/2026-11-17-fix-default-start-failure/`. Lesson: the reported symptom had two independent causes — the start mutations never surfaced a server rejection at all (silent revert, no error UI), and a process restart (every production deploy) permanently orphans any `running` row with nothing to ever stop it, silently consuming a per-user `MAX_PARALLEL_RUNS` slot. impl-review caught a CRITICAL in the fix itself: the new orphan-sweep's bare `setInterval` had no try/catch, risking a full server crash on any transient DB error — the second occurrence of this exact bug class in this codebase (see `context/foundation/lessons.md`), now a standing rule.
- **S-35: Maintainer has automated tests confirming every per-run analytics function (`getRunAnalysis`'s population/diversity/phase-breakdown/completed-cycles/final-diversity/optimization-suggestion, `getRunsComparison`, `listCompleted`/leaderboard ranking) handles the corpus's full range of parameter combinations — including any scenario that produced a crash, an empty population, or an unusual phase sequence — without throwing or returning a malformed shape.** — Archived 2026-11-16 → `context/archive/2026-11-16-analytics-correctness-corpus-tests/`. Lesson: impl-review caught a CRITICAL cross-file race — the shared DB-insertion fixture's blanket "delete stray prior rows" pass raced against sibling corpus test files under Vitest's default file parallelism, reproducibly wiping another file's still-in-use rows mid-test (`SQLITE_CONSTRAINT_FOREIGNKEY`); the pre-delete was unnecessary (the fresh-UUID-per-call owner email was already collision-proof) and removing it fixed the race outright, no config change needed.
- **F-08: (foundation) A single simulation run can be driven end-to-end through the real app's own execution path (not a bypass of the engine) with explicit parameters, allowed to tick to completion under a simulated-duration cap, have its persisted history/score captured, exported to a fixture-file record, and have its own DB/registry footprint cleaned up afterward — leaving no trace beyond the exported record.** — Archived 2026-11-15 → `context/archive/2026-11-15-corpus-generation-harness/`. Lesson: an impl-review caught two CRITICAL resource-leak bugs — `startCorpusRun` and `collectAndCleanupCorpusRun` left the shared `adminSettings` row widened and the fixture owner row undeleted whenever the wrapped tRPC call threw, leaking into state real traffic also reads — fixed with try/catch/finally before archiving. A third finding (concurrent calls can clobber each other's widened range, no serialization) was accepted as a documented risk for S-33 to design against, since this phase's own plan explicitly scoped the batch loop out.
- **S-32: User sees, in a completed run's analysis view, how genetic diversity changed over the course of the run — not just the single final value.** — Archived 2026-11-15 → `context/archive/2026-11-15-genetic-diversity-trend/`. Lesson: —.
- **S-30: User increases or decreases a running server-owned simulation's boid count AND predator count while it is actively running — both execution paths' object-shape, scope expanded during planning from boid-only, user's explicit choice, since `PredatorState` carries the identical energy/age shape `BoidState` does — and sees the population size change reflected in the live view.** — Archived 2026-11-15 → `context/archive/2026-11-15-live-boid-count-adjustment/`. Lesson: —.
- **S-37: User (and the team) has a documented confirmation that per-run history applies only to runs completed after it shipped, with older runs showing an accurate "no history" state.** — Archived 2026-11-17 → `context/archive/2026-11-17-confirm-run-history-retroactive-scope/`. Lesson: research found the run-analysis page's "Final genetic diversity" scalar had no null-history guard and silently showed `0.000` — fixed; the sibling sections' existing guard pattern already covered every other case.
- **S-38: User (and the team) has a documented confirmation that temporary admin elevation already uses the time-boxed, self-service mechanism decided during S-22's planning, with no outstanding design decision left open.** — Archived 2026-11-17 → `context/archive/2026-11-17-confirm-admin-elevation-mechanism-resolved/`. Lesson: —.
- **S-36: User runs multiple server-owned simulations simultaneously and the one they're actively watching stays responsive, because unwatched runs no longer tick at an equal, real-time-matched cadence and compete for the same single CPU core.** — Archived 2026-11-17 → `context/archive/2026-11-17-unwatched-run-tick-throttling/`. Lesson: a fixed dtSeconds multiplier doesn't reduce per-tick CPU cost — it reduces the real-time duration a background run spends ticking before reaching its stop condition, which is the actual mechanism of CPU relief (measured ~3x fewer real ticks to stop, ~1.0x unchanged per-tick cost); see test-plan.md §6.10.
- **S-29: User toggles crossbreeding on or off for a running simulation (both execution paths) and sees the effect on subsequent reproduction.** — Archived 2026-11-15 → `context/archive/2026-11-15-live-crossbreeding-toggle/`. Lesson: —.
- **S-28: User changes a client-staged run's foodRegenRate, protectionThreshold, energyThreshold, mutationChance, and mutationMagnitude while it is actively running.** — Archived 2026-11-15 → `context/archive/2026-11-15-client-staged-live-parameter-parity/`. Lesson: —.
- **S-31: A user live-adjusting a running server-owned simulation only sees fields that have a real, verified effect on its behavior.** — Archived 2026-11-15 → `context/archive/2026-11-15-correct-live-parameter-field-set/`. Lesson: —.
- **S-27: User changes a server-owned run's separation/alignment/cohesion weights, food regen rate, and protection threshold while it is actively running, and sees the effect reflected in the live view within the next tick — not just at start time.** — Archived 2026-11-15 → `context/archive/2026-11-15-live-parameter-adjustment/`. Lesson: an impl-review caught that the client's own 500ms Apply cooldown was UI-only — a direct tRPC call could push unbounded `parameterChanges` changelog entries into persisted `history` for a run's entire duration, since every other client-supplied sample array in this codebase is bounded (`.max(50_000)`) but this new one wasn't; fixed with a server-side throttle (not just a tighter client-side one) before archiving, matching this session's recurring pattern of UI-only guards needing a server-side backstop.
- **S-25: User sees, in a completed run's analysis view, whether population health held up given the area that run used — e.g., confirming that increasing the area didn't just thin the population out without the scoring/analysis reflecting why.** — Archived 2026-11-15 → `context/archive/2026-11-15-area-aware-population-insight/`. Lesson: an impl-review caught a CRITICAL reliability gap in the backward-compat path for the new per-run sample array — `resumeServerRun` copied a pre-change saved snapshot's missing field straight through as `undefined`, which crashed the resumed run's very next tick and silently finished it with a null score; every *other* backward-compat path in the same change (`getRunsComparison`, `listLeaderboard`) correctly guarded with `Array.isArray(...)`, but the resume path was the one spot that didn't — a reminder to check every read site of a newly-added optional field, not just the ones a plan's own file list happens to enumerate first. A second review finding caught a test using `toBeCloseTo`'s default 2-digit precision on density values around 1e-7, which passed regardless of correctness until tightened to exact equality.
- **S-26: User reports a new functionality idea or a bug from within the app itself (not an external tool), and it's persisted somewhere the owner can review it when scoping a future milestone.** — Archived 2026-11-15 → `context/archive/2026-11-15-in-app-feedback-module/`. Lesson: a review caught two CRITICAL reliability findings in the same code path (send-report.ts's try/catch boundary misclassifying a post-success DB write failure as a send failure — risking duplicate GitHub issues — and the retry worker's bare `void` interval call letting any such exception become an unhandled rejection that could crash the whole server process) — both from drawing a try/catch boundary too wide around two genuinely different failure domains (external API vs. local DB) instead of handling each at its own layer; fixed and regression-tested (the new test confirmed red, an actual unhandled rejection, before the fix) before archiving, not deferred.
- **F-07: (foundation) Concrete, documented ceilings exist for simulation area size, object count, and concurrent run count — derived from this specific VPS's actual CPU/RAM/disk, not arbitrary defaults.** — Archived 2026-11-15 → `context/archive/2026-11-15-vps-resource-capacity-limits/`. Lesson: direct measurement overturned the obvious framing twice in a row this session (same lesson as S-23's, recorded here because it recurred) — "4 vCPUs" didn't mean 4x headroom (single-threaded JS execution), and RAM wasn't the binding constraint at all (CPU was); see `context/foundation/capacity-limits.md` for the actual numbers, kept durable for S-24 to read.
- **S-24: User sets the simulation's spatial area size (within an admin-set range, bounded by F-07's capacity ceiling) when staging a run, and the render view becomes a camera over that area — auto-following the population by default, with manual pan/zoom override — rather than always rendering the entire area at once.** — Archived 2026-11-15 → `context/archive/2026-11-15-configurable-area-and-camera-view/`. Lesson: direct measurement again overturned the obvious assumption (a larger configured world *lowers* per-tick cost at a fixed population, since the fixed-radius neighbor queries cover a smaller fraction of a bigger world) — the third time this session a "should be worse/unknown" framing was disproven by actually benchmarking instead of reasoning from the constant's name alone (same recurring pattern as F-07's and S-23's own lessons above).
- **S-23: Boid/predator flocking-force calculations use spatial partitioning (a grid-based neighbor search) instead of a full pairwise scan.** — Archived 2026-11-15 → `context/archive/2026-11-15-spatial-hash-performance-optimization/`. Lesson: a technique "proven" in a prior implementation doesn't transfer on faith — measure before/after on the actual target codebase's constants. The ported grid is a genuine win for small-radius queries (applyPredation, reproducePopulation) but measurably *slower* than plain pairwise for the one query FR-029 names explicitly (stepBoids' own boid-boid loop), because that radius already covers a large fraction of this world's volume — a geometry fact the roadmap's own risk note didn't anticipate, caught only by direct wall-clock measurement, not by code review or by trusting the prior (differently-sized) reference implementation.
- **S-20: User reads four reference pages — the simulation's storyline, its parameters, its population-lifecycle model, and its scoring metrics — separated from the functional app pages, not interleaved with them.** — Archived 2026-11-15 → `context/archive/2026-11-15-reference-documentation-pages/`. Lesson: —.
- **S-19: User sees a leaderboard of their own completed runs ranked by score, highest first.** — Archived 2026-11-15 → `context/archive/2026-11-14-leaderboard/`. Lesson: —.
- **S-22: User temporarily elevates their own account (or another account) to `admin` to adjust parameter ranges, the object-count cap, or the number of tribes, then reverts — the elevation is reversible, not a permanent role change.** — Archived 2026-11-14 → `context/archive/2026-11-14-temporary-admin-elevation/`. Lesson: NextAuth's database-strategy session round-trips through JSON before any consumer reads it, turning a Date-typed column into an ISO string (or the adapter's own raw number) at runtime — a helper reading a session-sourced timestamp should normalize with `new Date(x).getTime()` rather than trust the Drizzle column's declared type, and this gap went undetected by unit tests because every fabricated session fixture passed a real `Date`.
- **S-21: User sees a run-specific optimization suggestion on a completed run's analysis view, derived from that single run's own phase/resource history — distinct from S-13's cross-run suggestion.** — Archived 2026-11-14 → `context/archive/2026-11-14-post-run-optimization-suggestion/`. Lesson: —.
- **S-18: User sees the run-analysis and run-comparison pages restyled with the new design direction, with no change to existing chart/table behavior.** — Archived 2026-11-14 → `context/archive/2026-11-14-analysis-comparison-restyle/`. Lesson: —.
- **S-17: User sees the simulation staging form and live view restyled with the new design direction, with no change to existing form state or live-rendering behavior.** — Archived 2026-11-14 → `context/archive/2026-11-14-staging-live-view-restyle/`. Lesson: —.
- **S-16: User sees the post-login dashboard restyled with the new design direction, with no change to its existing Running/Saved/Completed functionality.** — Archived 2026-11-14 → `context/archive/2026-11-14-dashboard-restyle/`. Lesson: an `isLoading` state and a `<main>`/landmark fix both shipped cleanly, but impl-review still caught a missing `isError` branch the plan itself had reasoned away as N/A — the 7-state matrix's "error" cell deserves a second look whenever a view's plan dismisses it without checking the underlying query's actual failure mode.
- **S-15: User sees a properly branded Swarm Arena login page — the smallest end-to-end slice that proves the new UI design foundation (F-06) actually works.** — Archived 2026-11-14 → `context/archive/2026-11-14-branded-login-page/`. Lesson: —.
- **F-06: (foundation) A shared app shell (sidebar navigation) and an extended set of design tokens exist, following `next-shadcn-admin-dashboard`'s structural pattern, demonstrated end-to-end on the login page (S-15) before being applied to the rest of the app.** — Archived 2026-11-14 → `context/archive/2026-11-14-ui-design-system-foundation/`. Lesson: —.
- **S-13: User sees a heuristic-suggested next parameter change — the single admin-ranged parameter most correlated with improving their final score across their own past runs — with a one-line rationale and a confidence qualifier.** — Archived 2026-11-14 → `context/archive/2026-11-14-parameter-suggestion-heuristic/`. Lesson: —.
- **S-14: User exports a run's parameters, score, and history outside the app, in JSON (full-fidelity) and CSV (parameters + score, no nested history).** — Archived 2026-11-14 → `context/archive/2026-11-14-run-export/`. Lesson: a formatter's named return type doesn't strip extra fields from a spread object at runtime — a `{...row}` JSON export leaked userId/seed/savedState outside the documented contract until caught in impl-review; build the output from an explicit field list, same discipline the CSV branch already used.
- **S-12: User selects two or more completed runs and compares their scores and four-factor breakdowns side by side.** — Archived 2026-11-14 → `context/archive/2026-11-14-compare-runs-side-by-side/`. Lesson: —.
- **S-11: From a completed run, the user opens an analysis view presenting the run's population dynamics — a logistic-growth-curve comparison against the run's actual population trajectory, a phase/cycle breakdown of time spent in each lifecycle phase (summarized per completed cycle, matching S-09's fix), and a diversity-index-style summary of genetic diversity over time — so they can draw a concrete conclusion about what to change in the next staged run.** — Archived 2026-11-14 → `context/archive/2026-11-14-run-analysis-view/`. Lesson: —.
- **S-10: Right after logging in, the user lands on a dashboard listing their own simulation runs — running, saved, and completed** — Archived 2026-11-14 → `context/archive/2026-11-14-post-login-run-dashboard/`. Lesson: —.
- **F-05: (foundation) A finished run's tick-level population history (phase history, food-ratio samples, gene snapshots) is persisted instead of discarded** — Archived 2026-11-14 → `context/archive/2026-11-14-persist-run-history/`. Lesson: —.
- **S-09: User's score correctly rewards every completed lifecycle resilience cycle, not just whether one happened anywhere in the run** — Archived 2026-11-14 → `context/archive/2026-11-14-phase-quality-per-cycle-scoring/`. Lesson: —.
- **S-04: User configures the full parameter set within admin-defined ranges, can stop and save a run at any point, resume it later with exact population/resource state, and receives a complete score combining survival, resource management, genetic diversity, and population-lifecycle-phase quality.** — Archived 2026-11-14 → `context/archive/2026-11-14-full-score-save-resume/`. Lesson: —.
- **S-08: User sees all their currently-running server simulations and switches which one is actively viewed, without interrupting the others, with the old client-driven switcher UI retired** — Archived 2026-11-14 → `context/archive/2026-11-14-server-run-list-and-switch/`. Lesson: a polled list driving a separately-mounted live view needs its own desync guard — when the thing a view is watching disappears from the list that represents "what's current," the view must close itself, not freeze silently; but the guard needs a "seen at least once" check, or it will race-clear a thing that was just opened before the first poll confirms it.
- **S-07: User picks one of their currently-running server simulations and watches it render live in the browser, receiving pushed state updates rather than owning execution** — Archived 2026-11-14 → `context/archive/2026-11-14-view-running-server-simulation/`. Lesson: a subscription's `onError` handler needs a matching clear in `onData` — auto-reconnecting transports (SSE, WebSocket) can recover silently, and a one-way error flag left set after recovery misleads the user into thinking a working view is still broken. Manual verification of "is this actually live, not frozen" needs two timestamped samples compared against independently-confirmed server state, not a single screenshot.
- **S-06: User starts a real (non-staging) simulation whose execution is owned by the server, so it keeps running even if the browser tab is closed or the user navigates away** — Archived 2026-11-14 → `context/archive/2026-11-14-start-server-run-simulation/`. Lesson: a mid-plan-review "fix" that drops an unused-looking parameter can silently break an existing test's dependency-injection point — caught only by actually running the full suite before committing, not by re-reading the code. Also: any synchronous side-effecting call placed right after a DB insert that marks a resource "active" needs its own try/catch with a compensating rollback, or a thrown error leaves that resource stuck in a state nothing is tracking.
- **F-04: (foundation) The server can push a running simulation's current tick state to exactly one connected viewer in real time, without the viewer owning or affecting execution** — Archived 2026-11-14 → `context/archive/2026-11-14-live-simulation-view-channel/`. Lesson: tRPC's `.subscription(...)` cannot be invoked through `createCaller` (its type resolves to `TypeError<'Not implemented'>` under a caller) — caught in plan-review by reading tRPC's own `.d.cts` files before implementing, not discovered the hard way mid-code. Any future subscription procedure needs its generator logic extracted into a plain, caller-testable function with the tRPC procedure as a thin `tracked()`-wrapping delegate.
- **F-03: (foundation) A simulation run can be ticked to completion by a server-owned process, independent of any client connection or browser tab** — Archived 2026-11-14 → `context/archive/2026-11-14-server-side-simulation-engine/`. Lesson: a fire-and-forget async write (`void finishRun(...)`) that deletes in-memory state before the DB write is awaited can leave a zombie DB row on a transient write failure — caught in impl-review, not plan-review; wrap such writes in try/catch and log loudly before removing the only state that could retry them.
- **F-01: (foundation) Logged-in access with admin/member roles gates the app** — Archived 2026-11-10 → `context/archive/2026-11-10-gate-product-routes/`. Lesson: —.
- **F-02: (foundation) One seeded-PRNG approach is chosen and wired as the simulation's randomness source** — Archived 2026-11-10 → `context/archive/2026-11-10-deterministic-seed-strategy/`. Lesson: —.
- **S-02: User sees predators hunt boid flocks in real time, with any flock at or below the configured protection threshold immune to attack, and sees hunger accelerate death alongside natural lifespan.** — Archived 2026-11-11 → `context/archive/2026-11-11-predator-prey-dynamics/`. Lesson: —.
- **S-05: User can run several simulations in parallel and switch which one is actively viewed, without interrupting or slowing the others.** — Archived 2026-11-11 → `context/archive/2026-11-11-parallel-sim-switching/`. Lesson: —.
- **S-01: User starts a simulation with basic boid flocking (one flock, no predators yet), watches it run in real time, stops it, and receives a basic score based on how long the population survived.** — Archived 2026-11-13 → `context/archive/2026-11-11-basic-flocking-loop/`. Lesson: verify a claimed commit-message fix is actually in that commit's diff before trusting it (see lessons.md).
- **S-03: User sees population reproduce with inherited genes (including blended color) and can toggle inter-flock crossbreeding** — Archived 2026-11-13 → `context/archive/2026-11-13-genetic-inheritance-crossbreeding/`. Lesson: HTML number-input min/step mismatches and color-wheel hue-anchoring bugs only surface in a live manual check, not automated gates; a migration adding NOT NULL columns with no default will break this project's actual production push-based deploy procedure (see lessons.md).
- **S-33: Maintainer generates a ~20-run structured-parameter-sweep corpus (varying flocking weights, food regen rate, and crossbreeding across a few levels each, deliberately targeting healthy-growth/crash/overshoot-recovery phases), with up to 4 runs registered and ticking concurrently at a time, each capped at 60 simulated minutes, using F-08's harness — then exports the full corpus to a reusable fixture file and cleans up every generation-time DB/registry artifact, leaving only the exported file behind.** — Archived 2026-11-15 → `context/archive/2026-11-15-parameter-sweep-corpus-generation/`. Lesson: a long (20+ minute) real run sharing the dev machine with this session's own Stop hook (which runs `npm test` on every turn) starved the run's DB throughput enough to blow even a widened polling ceiling — diagnosed only after isolated short reproductions kept succeeding while every long concurrent run failed identically; also, a fixture compressed by hand after generation (gzip) needs the generation code itself updated to produce that format, or a future re-run silently drifts back to what's committed (see lessons.md candidate).
- **S-34: Maintainer has an automated test asserting the parameter-suggestion heuristic produces a sensible, correlated suggestion against the persisted corpus.** — Archived 2026-11-16 → `context/archive/2026-11-16-suggestion-quality-corpus-test/`. Lesson: a committed `CorpusRunRecord.params` export can be narrower than what a downstream consumer's own type actually needs (5 of 16 fields here) — the sweep's own pure matrix-builder function, re-called at test time, is a safe way to reconstruct the rest without regenerating anything; also, `RANGED_PARAMETER_NAMES` had silently grown to include booleans after the suggestion heuristic shipped on a stale "numeric-only" assumption an archived plan-review had asserted — worth a recurring check whenever a shared constant list like this grows, that every consumer's own documented assumptions about it are re-verified, not just its type.
