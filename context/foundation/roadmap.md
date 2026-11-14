---
project: swarm-arena
version: 1
status: draft
created: 2026-11-09
updated: 2026-11-14
prd_version: 3
main_goal: learn
top_blocker: decisions
milestone_id: insight-and-comparison
milestone_seq: 2
milestone_status: open
---

# Roadmap: swarm-arena

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Insight and comparison** — Status: open

- **Intent:** Turn individual run scores into actionable insight by letting the user compare completed runs side by side and get heuristic parameter-change suggestions, closing the loop the PRD's Vision describes ("turning trial-and-error tuning into a measurable, resumable experimentation loop"). Main goal for this milestone is to learn/explore — the parameter-suggestion heuristic (FR-015) is the project's most novel, least-specified idea, and this milestone treats getting it right as more valuable than shipping the whole nice-to-have backlog fast.
- **Source materials:** `context/foundation/prd.md` (v3) — the three remaining nice-to-have FRs M-1 did not cover.
- **Done when:** S-12 through S-14 are all `done`. No new foundations — M-2 reuses F-05's persisted history; nothing in its scope needs a new cross-cutting enabler.
- **Scope anchors:** FR-015 (parameter-change suggestion heuristic), FR-016 (side-by-side run comparison), FR-017 (export), US-01/US-03's implied "compare and act on past runs" follow-through, PRD Open Question #2 (export format).

## Vision recap

A hobbyist wants to tune boids/predator-prey simulations and know, objectively, whether a parameter change actually helped — not just eyeball the animation. The product's wedge (the one trait that, if removed, makes this just another flocking demo) is that every run ends in a deterministic, repeatable score combining survival time, resource management, and genetic diversity, so variants can be compared rather than guessed at. M-1 built the scoring and the per-run analysis view; M-2 is where "compared rather than guessed at" becomes literal — comparing runs side by side and, eventually, getting a suggested next parameter change.

## North star

**S-12: User compares completed runs' scores side by side** — the smallest end-to-end flow that proves M-2's core value: every completed run already has a score and persisted history (from M-1's F-05/S-11), so comparison needs no new data, only a new view — placed first because the suggestion heuristic (S-13) is more valuable once the user has already seen what "comparing runs" looks like.

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
| S-12 | compare-runs-side-by-side       | User selects two or more completed runs and compares their scores (and four-factor breakdowns) side by side | F-05, S-11      | FR-016                                                 | in-progress |
| S-13 | parameter-suggestion-heuristic | User sees a heuristic-suggested next parameter change, based on how past changes affected population stability | F-05            | FR-015                                                 | blocked |
| S-14 | run-export                      | User exports a run's parameters/score/history outside the app | F-05            | FR-017                                                 | blocked |

## Streams

| Stream | Theme                          | Chain                                   | Note                                                                 |
| ------ | ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| A      | Core simulation loop depth      | `F-01` → `F-02` → `S-01` → `S-02` → `S-03` → `S-04` | Carries the north star and the quality-focused domain work; the spine of this milestone. |
| B      | Multi-run viewing (legacy)       | `S-05`                                   | Joins Stream A at `S-01` — shipped and done; its user-visible capability is re-delivered on the new architecture by Stream C (S-08) and its client-driven switcher UI is then retired. |
| C      | Server-side execution            | `F-03` → `F-04` → `S-06` → `S-07` → `S-08` | 2026-11-14 extension: moves "real" simulation execution off the client and onto a server-owned process, removing the rendering-imposed limit on how many can run; the client-side staging simulation (S-01's single-run path) is explicitly unchanged. |
| D      | Run visibility                   | `F-01` → `S-10`                          | 2026-11-14 (second) extension: a post-login dashboard of the user's own runs. Joins Stream A at `F-01`. |
| E      | Scoring correctness & analysis    | `F-05` → `S-11`                          | Persists per-run history (no prerequisites — purely additive) then builds the analysis view on it; `S-11` also waits on `S-09` (the corrected per-cycle aggregation it displays) and `S-10` (Stream D, the dashboard to navigate from). |
| F      | Insight and comparison (M-2)      | `S-11` → `S-12`, `F-05` → `S-13`, `F-05` → `S-14` | M-2's three items share only the F-05 history data, not each other — `S-12`/`S-13`/`S-14` can run in parallel once their own Unknowns (if any) resolve. |

## Baseline

What's already in place in the codebase as of `2026-11-09` (auto-researched + user-confirmed), refreshed `2026-11-14` for the server-side-execution extension (F-03, F-04, S-06–S-08).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Next.js App Router scaffold only (`src/app/page.tsx`, `src/app/layout.tsx`); no swarm-arena-specific UI yet.
- **Backend / API:** partial — tRPC wired (`src/server/api/root.ts`), but only the T3 example `post` router exists; no domain routers.
- **Data:** partial — Drizzle/SQLite configured, but `src/server/db/schema.ts` only has the example `.bootstrap-scaffold_post` table; no simulation/user/score tables.
- **Auth:** absent — no `next-auth` in `package.json` or `src/`, despite `tech-stack.md` planning it.
- **Deploy / infra:** present — live in production at `https://swarmarena.hopto.org` (Docker + Caddy + GitHub Actions auto-deploy, per `infrastructure.md` / `deploy-plan.md`). `tech-stack.md` already names the reason this matters for F-03/F-04: a persistent container (not serverless) is required precisely for "an always-on simulation loop and any WebSocket/SSE push to the live view" — the deploy target was chosen anticipating this extension.
- **Observability:** absent — no logging/error-tracking library found.
- **2026-11-14 refresh — relevant to F-03/F-04 specifically:** simulation execution today is 100% client-side, `requestAnimationFrame`-driven (`src/app/simulation/_components/simulation-canvas.tsx`, `src/app/simulation/multi/_components/multi-simulation-stage.tsx`); no server-owned tick loop exists. `simulationRuns` (`src/server/db/schema.ts`) persists only run configuration and terminal fields (status/score/timestamps) — no live per-tick state. No push/subscription mechanism exists (`src/server/api/routers/simulation.ts` has only `start`/`stop` mutations; no tRPC subscription, SSE route, or WebSocket handler found). The existing `computeMultiRunTick` (`src/server/simulation/multi-run-lifecycle.ts`) already separates "tick every running slot" from "render only the active slot's output" — the closest in-repo precedent for the tick/render split F-03/F-04 need, even though it currently runs client-side only.
- **2026-11-14 refresh (second) — relevant to S-09/F-05/S-10/S-11:** no dashboard or post-login landing page exists — `/simulation` is both the staging form and the only run-related page; there is no route a logged-in user is redirected to. `listRunning`/`listSaved` (`src/server/api/routers/simulation.ts`) already return the caller's own rows filtered by status, so a run-list dashboard is additive UI, not new backend capability. No run-analysis UI or endpoint exists anywhere. Confirmed via code inspection: `computeScore`'s callers (`stop` resolver, `server-run-registry.ts`'s `tick()`/`stopServerRun`) consume `phaseHistory`/`foodRatioSamples`/survivor genes only to compute the final score number — none of those arrays are persisted; `simulationRuns.score` is the only thing written back. An analysis view has nothing to read until F-05 persists them.

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
- **Status:** in-progress

### S-13: Heuristic parameter-change suggestion

- **Outcome:** User sees a heuristic-suggested next parameter change, based on how past parameter changes affected population stability across the user's runs.
- **Change ID:** parameter-suggestion-heuristic
- **PRD refs:** FR-015
- **Prerequisites:** F-05
- **Parallel with:** S-12, S-14
- **Blockers:** —
- **Unknowns:**
  - What exactly counts as "population stability" for the heuristic to optimize toward, and what shape the suggestion takes (a single parameter nudge, a ranked list, a confidence qualifier)? — Owner: user. Block: yes — FR-015's Socratic note already flags per-parameter interaction effects as an open design risk; `/10x-plan` should not invent the heuristic's decision rule.
- **Risk:** This is the PRD's most underspecified must-have-adjacent FR — "heuristic, not full optimization" bounds scope but doesn't define the rule. Sequenced after the north star deliberately: seeing comparison data first (S-12) may sharpen what "a good suggestion" should look like before committing to a heuristic design.
- **Status:** blocked

### S-14: Export a run outside the app

- **Outcome:** User exports a run's parameters, score, and history outside the app.
- **Change ID:** run-export
- **PRD refs:** FR-017
- **Prerequisites:** F-05
- **Parallel with:** S-12, S-13
- **Blockers:** —
- **Unknowns:**
  - What export format(s) (CSV / JSON / image / other)? — Owner: user. Block: yes — this is PRD Open Question #2, still unresolved.
- **Risk:** Low complexity once the format is chosen — F-05 already persists everything a run-level export would need; the only real decision is the format itself.
- **Status:** blocked

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
| S-13       | parameter-suggestion-heuristic      | Heuristic next-parameter suggestion based on past run outcomes          | no                      | Blocked — heuristic design (what it optimizes, suggestion shape) unresolved |
| S-14       | run-export                          | Export a run's parameters/score/history outside the app                 | no                      | Blocked — export format unresolved (Open Roadmap Question #2) |

## Open Roadmap Questions

1. ~~What are the relative weights/formula for the score (cycle length × resource management × genetic diversity)?~~ — **Resolved 2026-11-14.** Equal product of four factors, now including population-lifecycle-phase quality (FR-019). See PRD Open Questions #1 and Business Logic. No longer blocks S-04.
2. **What export format(s) should the export feature (FR-017) support (CSV / JSON / image / other)?** — Owner: user. Block: yes — blocks S-14.
3. ~~Beyond defining parameter ranges and the object-count cap, does `admin` have any other capability — e.g. managing other users' simulations — or is the role split purely about parameter governance?~~ — **Resolved 2026-11-14** (see PRD Open Questions #3) — every FR added since stays within per-user data isolation; not blocking.
4. **Should F-05's per-run history persistence apply retroactively to already-archived runs, or only to runs that complete after it ships?** — Owner: user. Block: — (affects S-11's "no data yet" empty state for old runs, not blocking; resolved by default: forward-only, with old runs showing only their final score in the dashboard).
5. **What should the parameter-suggestion heuristic (FR-015) actually optimize toward, and what shape should its suggestion take?** — Owner: user. Block: yes — blocks S-13.

## Parked

- **Shared/collaborative simulations across users** — Why parked: explicit PRD Non-Goal — admin/member are access roles, not co-editing roles; a run belongs to the user who started it.
- **Client-driven parallel rendering of multiple simulations at once** — Why parked: explicit PRD Non-Goal (2026-11-14 extension) — retired in favor of server-owned execution; the client renders at most one server-run simulation live at a time.
- **Diversity-index trend over time in the analysis view** — Why parked: explicit PRD Non-Goal (2026-11-14 extension) — only a single final genetic-diversity value is persisted; a trend would need a new per-tick series nothing downstream currently needs.

(FR-015, FR-016, and FR-017 — previously parked here as nice-to-have — are promoted into M-2's slices S-13, S-12, and S-14 respectively; see `## Slices`.)

## Milestone History

- **M-1: First working simulation loop** (`first-working-simulation-loop`) — closed 2026-11-14. Delivered the first end-to-end boids/predator simulation loop (configure, run, stop/resume, score) plus server-owned execution, a post-login run dashboard, and a per-run population-dynamics analysis view; all 5 foundations and 11 slices done.

## Done

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
