---
project: swarm-arena
version: 1
status: draft
created: 2026-11-09
updated: 2026-11-15
prd_version: 5
main_goal: quality
top_blocker: decisions
milestone_id: area-camera-and-ops-limits
milestone_seq: 4
milestone_status: open
---

# Roadmap: swarm-arena

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-4: Area, camera, and ops limits** — Status: open

- **Intent:** Make the simulation's spatial area itself a configurable parameter, turn the render view into a camera over that area (rather than always rendering the whole area), add an area-aware population-health insight to run analysis, give the owner a durable in-app channel to capture new feature/bug ideas for future rounds, and ground the app's capacity limits (max area, object count, concurrent runs) in this specific VPS's actual hardware instead of arbitrary defaults. Main goal is quality — this is a single-hobbyist-user app (per the PRD's own `target_scale`/`after_hours_only` framing), so the new area/camera mechanic and the VPS-bound limits both deserve doing right rather than fast; a rushed version risks shipping a feature that can silently overload the box it runs on.
- **Source materials:** user description (2026-11-15, immediately after M-3's close) — no PRD update yet; scope anchors below are distilled from the user's own words, not from `prd.md`.
- **Done when:** F-07 and S-24 through S-26 are all `done`.
- **Scope anchors:**
  - MS-01: User can define the simulation's spatial area as an additional configurable simulation parameter (distinct from today's fixed world-size constants).
  - MS-02: The render view becomes a camera over the simulation area — the user sees only a portion of a (potentially larger) simulation area at a time, not the whole area rendered at once.
  - MS-03: A run's outcome/analysis can show whether population health held up given the area used for that run (an area-aware insight, distinct from today's four score factors).
  - MS-04: A module exists for the user to report new functionality ideas and bugs from within the app, persisted so they can be picked up in future roadmap rounds.
  - MS-05: New non-functional requirements are defined and bound to this specific VPS's actual resource limits (4 vCPU AMD EPYC-Milan, 7.7GiB RAM / ~6.1GiB available, 232GB disk / 187GB free, no container-level resource caps currently set), creating explicit capacity ceilings (max simulation area, max object count, max concurrent runs) grounded in real hardware rather than arbitrary defaults.

## Vision recap

A hobbyist wants to tune boids/predator-prey simulations and know, objectively, whether a parameter change actually helped — not just eyeball the animation. The product's wedge (the one trait that, if removed, makes this just another flocking demo) is that every run ends in a deterministic, repeatable score combining survival time, resource management, and genetic diversity, so variants can be compared rather than guessed at. M-1 built the scoring and the per-run analysis view; M-2 made comparison and suggestion literal; M-3 modernized the UI, added a leaderboard and reference pages, and ported a spatial-hash performance optimization. M-4 makes the simulation's own spatial scale a first-class, user-controlled dimension — a bigger area to roam, a camera to look at part of it, and a check on whether the population still thrives at that scale — while keeping the app's limits honest about the one real machine it runs on, and giving the owner a place to park what comes next.

## North star

**S-24: User configures the simulation's area size and sees a camera-limited view into it** — the smallest end-to-end slice that proves the core new mechanic: a bigger area only matters once there's a way to look at just part of it, and a camera control only matters once there's something larger than the viewport to look at — so these ship together, not as two independently-meaningless halves.

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
| S-25 | area-aware-population-insight   | User sees, in a completed run's analysis, whether population health held up given the area used for that run | S-24            | MS-03                                                  | proposed |
| S-26 | in-app-feedback-module          | User reports a new functionality idea or a bug from within the app, persisted for future roadmap consideration | —              | MS-04                                                  | ready |

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

## Baseline

What's already in place in the codebase as of `2026-11-09` (auto-researched + user-confirmed), refreshed `2026-11-14` for the server-side-execution extension (F-03, F-04, S-06–S-08), again `2026-11-14` for M-3 (UI modernization, leaderboard, post-run suggestion, temp-admin, spatial-hash perf), and again `2026-11-15` for M-4 (area/camera, feedback module, VPS-bound limits).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Next.js App Router scaffold only (`src/app/page.tsx`, `src/app/layout.tsx`); no swarm-arena-specific UI yet.
- **Backend / API:** partial — tRPC wired (`src/server/api/root.ts`), but only the T3 example `post` router exists; no domain routers.
- **Data:** partial — Drizzle/SQLite configured, but `src/server/db/schema.ts` only has the example `.bootstrap-scaffold_post` table; no simulation/user/score tables.
- **Auth:** absent — no `next-auth` in `package.json` or `src/`, despite `tech-stack.md` planning it.
- **Deploy / infra:** present — live in production at `https://swarmarena.hopto.org` (Docker + Caddy + GitHub Actions auto-deploy, per `infrastructure.md` / `deploy-plan.md`). `tech-stack.md` already names the reason this matters for F-03/F-04: a persistent container (not serverless) is required precisely for "an always-on simulation loop and any WebSocket/SSE push to the live view" — the deploy target was chosen anticipating this extension.
- **Observability:** absent — no logging/error-tracking library found.
- **2026-11-14 refresh — relevant to F-03/F-04 specifically:** simulation execution today is 100% client-side, `requestAnimationFrame`-driven (`src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/multi/_components/multi-simulation-stage.tsx`); no server-owned tick loop exists. `simulationRuns` (`src/server/db/schema.ts`) persists only run configuration and terminal fields (status/score/timestamps) — no live per-tick state. No push/subscription mechanism exists (`src/server/api/routers/simulation.ts` has only `start`/`stop` mutations; no tRPC subscription, SSE route, or WebSocket handler found). The existing `computeMultiRunTick` (`src/server/simulation/multi-run-lifecycle.ts`) already separates "tick every running slot" from "render only the active slot's output" — the closest in-repo precedent for the tick/render split F-03/F-04 need, even though it currently runs client-side only.
- **2026-11-14 refresh (second) — relevant to S-09/F-05/S-10/S-11:** no dashboard or post-login landing page exists — `/simulation` is both the staging form and the only run-related page; there is no route a logged-in user is redirected to. `listRunning`/`listSaved` (`src/server/api/routers/simulation.ts`) already return the caller's own rows filtered by status, so a run-list dashboard is additive UI, not new backend capability. No run-analysis UI or endpoint exists anywhere. Confirmed via code inspection: `computeScore`'s callers (`stop` resolver, `server-run-registry.ts`'s `tick()`/`stopServerRun`) consume `phaseHistory`/`foodRatioSamples`/survivor genes only to compute the final score number — none of those arrays are persisted; `simulationRuns.score` is the only thing written back. An analysis view has nothing to read until F-05 persists them.
- **2026-11-14 refresh (third) — relevant to M-3 (F-06, S-15–S-23):** the app uses shadcn/ui primitives (`Button`, `Input`, `Switch` in `src/components/ui/`) and a design-token system (`src/styles/globals.css`), but no shared app shell/sidebar-nav layout exists — every page (`login`, `dashboard`, `simulation`, `runs/[runId]`, `runs/compare`) is an independent `<main>` with its own ad hoc Tailwind classes, not a common layout. The login page (`src/app/login/page.tsx`) is generic/default-looking, not branded. No leaderboard, post-run-optimization-suggestion, admin-elevation, or reference/documentation page exists anywhere. `src/server/simulation/boids.ts`'s flocking-force calculation does a full pairwise scan (`for (const other of boids)` nested inside a per-boid loop) — confirmed O(N²), the exact pattern the user's prior LÖVE2D/Lua implementation (`/mnt/Kids/boids_final/game/`) replaced with a spatial-hash grid, per that project's own `docs/ARCHITEKTURA.md` ("Siatka Haszu Przestrzennego... Optymalizacja wyszukiwania sąsiadów z O(N²) do O(N)"). `users.role` (schema.ts) already has the `admin`/`member` enum; no elevation/toggle mechanism exists to change it from the app itself today (only direct DB access).
- **2026-11-15 refresh — relevant to M-4 (F-07, S-24–S-26):** the simulation's spatial extent is two hardcoded module-level constants in `src/server/simulation/boids.ts` (`INITIAL_AREA_SIZE = 200` for x/y, `Z_DEPTH_RANGE = 200` for z), not a per-run parameter — every run uses the same fixed toroidal world size today. No camera/viewport concept exists anywhere in the render path; `simulation-canvas.tsx` and the server-run live-view path both render the entire world extent directly, with no pan/zoom/sub-region state. `admin_settings.parameterRanges` (the existing admin-configurable-range mechanism from S-22/S-04) is schema-flexible enough to add a new ranged parameter without a migration shape change, but `src/server/simulation/parameter-ranges.ts`'s `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES` would need a new entry for area. No feedback/bug-report table or route exists anywhere in `schema.ts` or `src/server/api/routers/`. Deploy/infra's VPS is confirmed (2026-11-15, direct SSH inspection): 4 vCPU (AMD EPYC-Milan), 7.7GiB RAM (~6.1GiB available at the time of inspection), 232GB disk (187GB free), and the app's Docker container currently has no memory/CPU limit set (`docker inspect` reports unlimited) — today's `DEFAULT_MAX_OBJECT_COUNT = 500` (`parameter-ranges.ts`) was chosen to match pre-existing hardcoded bounds, not derived from this hardware. S-23's recent finding (spatial-hash grid narrowing effectiveness depends on the world-size-to-radius ratio) is directly relevant here: a configurable, potentially larger area would change that ratio and could make the existing grid optimization meaningfully more effective than it measured at the current fixed 200-unit world — worth revisiting once area becomes variable, not re-litigated now.

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
- **Status:** proposed

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
- **Status:** ready

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

## Open Roadmap Questions

1. ~~What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?~~ — **Resolved 2026-11-14.** Equal product of four factors, now including population-lifecycle-phase quality (FR-019). See PRD Open Questions #1 and Business Logic. No longer blocks S-04.
2. ~~What export format(s) should the export feature (FR-017) support (CSV / JSON / image / other)?~~ — **Resolved 2026-11-14.** Both JSON (full-fidelity) and CSV (parameters + score, no nested history). See PRD Open Questions #2. No longer blocks S-14.
3. ~~Beyond defining parameter ranges and the object-count cap, does `admin` have any other capability — e.g. managing other users' simulations — or is the role split purely about parameter governance?~~ — **Resolved 2026-11-14** (see PRD Open Questions #3) — every FR added since stays within per-user data isolation; not blocking.
4. **Should F-05's per-run history persistence apply retroactively to already-archived runs, or only to runs that complete after it ships?** — Owner: user. Block: — (affects S-11's "no data yet" empty state for old runs, not blocking; resolved by default: forward-only, with old runs showing only their final score in the dashboard).
5. ~~What should the parameter-suggestion heuristic (FR-015) actually optimize toward, and what shape should its suggestion take?~~ — **Resolved 2026-11-14.** Optimizes toward the final combined score, correlating each of the 13 admin-ranged parameters against the user's own past-run scores; suggests the single most-correlated one with a rationale and a confidence qualifier (minimum 3 varied runs). See PRD Open Questions #5. No longer blocks S-13.
6. **What exact mechanism should temporary admin elevation (FR-030/S-22) use — a self-service toggle, a time-boxed grant, or something else?** — Owner: user. Block: — (not blocking; deferred to `/10x-plan` per PRD Open Question #6, product-level requirement already fixed).
7. **Beyond the `next-shadcn-admin-dashboard` structural reference, which specific pages get restyled first, and in what order?** — Owner: roadmap (this decomposition). Resolved for sequencing purposes: `S-15` (login) first as the north star, then `S-16`–`S-20` in any order/parallel — see Streams row G. Per PRD Open Question #7.
8. **Should unwatched server-owned runs be allowed to tick faster than real time (not throttled to the live-view's 16ms cadence), so background runs don't compete for CPU against the one the user is actively watching?** — Owner: user. Block: no (not blocking any current slice). Raised during F-07's planning (2026-11-15) and explicitly deferred out of that change: `computeSingleRunTick`'s `dtSeconds` is derived from real wall-clock gaps today, not a fixed value, so this isn't a scheduling-priority tweak — it would mean deliberately inflating `dt` beyond real elapsed time for unwatched runs, a change to the core tick-timing/determinism model every existing scored/analyzed/compared run depends on. Worth its own roadmap item once someone wants to examine that model's implications directly, not folded into a capacity-measurement foundation.

## Parked

- **Shared/collaborative simulations across users** — Why parked: explicit PRD Non-Goal — admin/member are access roles, not co-editing roles; a run belongs to the user who started it.
- **Client-driven parallel rendering of multiple simulations at once** — Why parked: explicit PRD Non-Goal (2026-11-14 extension) — retired in favor of server-owned execution; the client renders at most one server-run simulation live at a time.
- **Diversity-index trend over time in the analysis view** — Why parked: explicit PRD Non-Goal (2026-11-14 extension) — only a single final genetic-diversity value is persisted; a trend would need a new per-tick series nothing downstream currently needs.
- **Live, in-run parameter adjustment** — Why parked: explicit PRD Non-Goal (2026-11-14 extension round 3, FR-028) — the live simulation engine has no live-parameter-update path today; materially larger architectural change than the post-run suggestion (S-21), which ships instead. Revisit as its own future milestone.
- **Full UI rewrite onto a new template** — Why parked: explicit PRD Non-Goal (2026-11-14 extension round 3, FR-032) — F-06 adopts a modern design direction incrementally on the existing shadcn/ui layer, not a wholesale replacement.

(FR-015, FR-016, and FR-017 — previously parked here as nice-to-have — are promoted into M-2's slices S-13, S-12, and S-14 respectively; see `## Slices`.)

## Milestone History

- **M-1: First working simulation loop** (`first-working-simulation-loop`) — closed 2026-11-14. Delivered the first end-to-end boids/predator simulation loop (configure, run, stop/resume, score) plus server-owned execution, a post-login run dashboard, and a per-run population-dynamics analysis view; all 5 foundations and 11 slices done.
- **M-2: Insight and comparison** (`insight-and-comparison`) — closed 2026-11-14. Delivered the three remaining nice-to-have FRs M-1 deferred: side-by-side run comparison, a score-correlated parameter-change suggestion, and JSON/CSV run export; all 3 slices done. Every FR in the PRD (v4) is now implemented.
- **M-3: Modernization and polish** (`modernization-and-polish`) — closed 2026-11-15. Delivered a shared app shell/design-token foundation and five pages built or restyled on it (branded login, dashboard, staging/live view, analysis/comparison, a new leaderboard, and four new reference/documentation pages), a run-specific post-run optimization suggestion, temporary admin elevation, and a spatial-hash neighbor-search optimization for the flocking engine; F-06 and all 9 slices (S-15–S-23) done. Every FR in the PRD (v5) is now implemented.

## Done

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
