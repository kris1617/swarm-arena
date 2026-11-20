# Architect report — swarm-arena

Synthesized 2026-11-20 from this repository's own four Module 4 artifacts, all refreshed today against current code (previous versions were 2026-11-17, predating 230+ subsequent commits). Every claim below is grounded in one of those four artifacts — nothing here is invented.

## 1. Opisane projekty (described projects)

One repository: **swarm-arena**, a private-then-public Next.js 16 (App Router) + tRPC + Drizzle/SQLite app, ~16 days old at time of writing, ~963 tracked source files, single developer, 86% of commits AI-co-authored. Appears at all four artifacts (L2–L5) — this is a single-repository, single-project report, not a cross-repo bundle.

## 2. Mapa projektu (z L2)

Source: `context/map/repo-map.md` (refreshed 2026-11-20).

- **What it does**: lets a signed-in user configure and run a 3D boids/predator-prey flocking simulation (client-ticked or server-owned), watch it live, score it, and compare/rank/export results.
- **Risk zone #1 — sim-engine**: the busiest, most structurally central capability (highest-instability hub in the dependency graph), with a confirmed, still-open cross-layer boundary break (`theme-colors.ts` reaching into a server-layer file for color constants).
- **Risk zone #2 — testing-infra**: the fastest-rising capability by commit trend since the last map (1→111→122 commits/week), tracking the project's own in-progress quality-strategy rollout.
- **Risk zone #3 — auth-impl**: low volume (21 commits) but the highest fix-ratio of any capability (33%), including one real confirmed security fix (closed an open-redirect bypass).
- **Key unknown**: the repo's own capability-footprint file doesn't yet attribute sim-engine's tRPC router to the `sim` capability, understating its true blast radius (closed partially by the L3 refresh below).

## 3. Analiza ficzera (z L3)

Source: `context/changes/sim-engine-feature-refresh/research.md`.

**Chosen flow**: starting and running a client-staged simulation — directly tied to Risk Zone #1 above.

**Feature overview**: A form submit sends validated parameters (including per-tribe genetics/behavior config) through a tRPC mutation that inserts one DB row and returns; all subsequent ticking happens entirely in the browser via `requestAnimationFrame`, calling the exact same tick-composition function the server-owned path uses. Each tick draws boids/predators colored from spawn-time genes and renders via a shared camera module.

**Technical debt — top risks**:
1. The cross-layer boundary break **reversed direction** since the last analysis: the server-engine-reaching-into-presentation violation found in 2026-11-17 is fixed; the current, still-open edge is `theme-colors.ts` re-exporting from the server's `seed-colors.ts` — confirmed via `ast-grep` (pattern-matched the exact re-export, zero cross-layer imports remain in the other direction, cross-checked by `grep`).
2. A write-once/retry-on-DB-failure pattern was hand-copied three times across three separate feature changes (confirmed via `git log -S` history — not a deliberate design, organic growth) with zero test coverage for any of the three copies.
3. Two UI-adjacent modules (`camera.ts`, `use-camera.ts`) have zero test files despite being pure, directly-testable logic matching an established cookbook pattern already used for a sibling module.

## 4. Plan refaktoryzacji (z L4)

Source: `context/changes/refactor-opportunities-refresh/` (research.md + plan.md, plan-reviewed SOUND).

**What's being refactored**: the three hand-copied retry-write branches from debt risk #2 above, into one shared helper (`latchOnceWithRetry`) parameterized by column name and success callback.

**What we're deliberately NOT doing**: restructuring the client's bundling of server-engine code into the browser (real, deliberate, larger — no evidence of current harm, parked as a watch item); adding a guard test for the hand-synced tick-composition duplication (a separate, already-documented-as-deliberate pattern); adding the missing `camera.ts`/`use-camera.ts` tests (a coverage gap, not a structure problem — out of this refactor's scope).

**Plan phases** (verification per phase: automated + manual):
1. Characterize current behavior — 3 tests reusing an existing DB-failure-injection fixture (`sabotagingDb`), proving today's behavior before any production change. *Verified by*: tests pass against unchanged code; typecheck/lint clean.
2. Extract and swap — one shared helper, 3 call sites swapped, tests re-verified unchanged, then consolidated into one parameterized test. *Verified by*: tests pass against the new code; full suite green; manual diff confirms no behavior change.

## 5. Domena wg DDD (z L5)

Source: `context/domain/domain-distillation.md`, `02-invariant-aggregate-refactor.md`, `03-anti-corruption-layer.md` (all refreshed/re-verified 2026-11-20).

**Ubiquitous language — key terms and the sharpest drift**: "tribe" (a named group of boids sharing per-group behavior/genetics config) vs. "flock" — the DB/persistence layer still uses `flockId`/`flockCount` while every type, newer mutation, and comment now says "tribe." This is a **code-internal** naming split spanning 9 files, not a docs-vs-code drift — the widest-blast-radius inconsistency found this pass. Separately, "suggestion" names two genuinely distinct concepts (`ParameterSuggestion`, a cross-run correlation heuristic, vs. `RunOptimizationSuggestion`, a single-run diagnosis) — the code already distinguishes them; prose doesn't always.

**Invariant #1 and its aggregate**: the product's determinism guarantee ("identical seed+params produce identical scores," stated twice in the PRD) is **contradicted** by the shipped unwatched-run tick-throttling feature — confirmed still present and unchanged. This was ALREADY addressed with a guardian aggregate: `ScoredRun` (`src/server/simulation/scored-run.ts`, commit `baf3747`), which centralizes score-comparability logic across every consumer (leaderboard, parameter suggestion, run comparison). Re-verified today: the commit and file both still exist and are wired in as designed.

**ACL**: the one real third-party-leak risk found (the `{r,g,b}` color representation) was ALREADY given an Anti-Corruption Layer: a `Color` value object (`src/server/simulation/color.ts`, commit `67df16c`), narrower than originally designed (its `blend()` method was deliberately dropped after discovering the genetics system's mutation-aware blend logic doesn't belong in a pure color type — documented in the commit message). Re-verified today: still present. No other dependency leak was found spanning more than one layer in this codebase.

## 6. Decyzje, które należą do mnie (decisions that are mine)

The scope and sequencing decisions were genuinely mine, not the agent's: choosing to redo all four artifacts in one pass rather than stopping after the map; choosing to re-demonstrate the CI pipeline with a fresh PR rather than relying on stale evidence; and declining the agent's suggestion to also build a new milestone before this detour. Within each artifact, I reviewed and accepted the agent's recommended target (sim-engine as the Deep Focus subject, the three-way-duplicated retry-write branches as the #1 refactor candidate) rather than picking an alternative myself — those technical selections were AI-proposed and I approved them after seeing the evidence (ast-grep-verified structural claims, git-history-confirmed intentionality), not independently re-derived by me. The one place I substantively redirected the agent mid-task was insisting on a fresh, current CI demonstration instead of accepting an outdated one — a real correction, not a rubber stamp.
