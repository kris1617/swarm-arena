# Refactor opportunities — Plan Brief

> Full plan: `context/changes/refactor-opportunities/plan.md`
> Research: `context/changes/refactor-opportunities/research.md`

## What & Why

Two independent, guard-first refactors closing technical debt the
10xArchitect feature-analysis pass surfaced on sim-engine: a duplicated
`history`/score-computation literal at two call sites in
`server-run-registry.ts` (Candidate C, where the "add a field, forget the
other copy" risk has already partially materialized — `schema.ts`'s own
comment lists only 3 of the real 8 fields), and a server-engine file
(`boids.ts`) importing presentation-layer color constants directly
(Candidate A, the repo-map's named #1 risk-zone boundary break).

## Starting Point

Both patterns exist today exactly as found: the `history` object is
hand-built identically at `tick()` and `stopServerRun()`; `boids.ts:5`
imports `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` from the client-presentation
module `~/styles/theme-colors`, used to seed flock colors that feed the
persisted score and history.

## Desired End State

Both completion paths in `server-run-registry.ts` call one shared helper
instead of duplicating 8 fields and a 5-argument call by hand. `boids.ts`
no longer imports from `src/styles/*` — the two seed-color hex values live
in a new server-owned file that `theme-colors.ts` re-exports from for the
client canvas. Both changes are provably behavior-preserving: color values
and persisted history/score are byte-for-byte identical before and after.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Scope | Both Candidate C and A in one plan | Both small, independently reversible, research already sketched both paths fully | Plan (user confirmed) |
| Candidate C helper placement | Local function in `server-run-registry.ts` | Matches this file's own convention (`LiveRun`, `ServerRunSnapshot` are all local to it); nothing else needs it | Plan (user confirmed) |
| Candidate A constant home | New `src/server/simulation/seed-colors.ts`, `theme-colors.ts` re-exports from it | Single source of truth preserves the deliberate color-continuity behavior if the UI color is ever intentionally changed later | Plan (user confirmed) |
| Candidate B (two hand-synced `computeSingleRunTick` callers) | Explicitly out of scope | Deliberate architectural pattern, `typecheck` already guards it, widest blast radius for lowest marginal risk reduction | Research |

## Scope

**In scope:** extracting the duplicated history/score builder (Candidate
C); relocating the two seed-color constants server-side (Candidate A);
one characterization test per phase.

**Out of scope:** Candidate B; adding a `pull_request` CI trigger (a
separate, non-refactor concern); any change to persisted data shape,
migrations, or the public tRPC contract; any other constant in
`theme-colors.ts`.

## Architecture / Approach

Each phase: add a characterization test pinning today's exact output →
confirm it passes against current code → extract/relocate → confirm the
same test plus the full suite stays green. This makes each phase
independently revertible, verified by its own guard test — no phase
depends on the other.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Extract buildFinishHistory/score helper | One shared helper replaces 2 duplicated literals + 2 duplicated computeScore calls | Low — self-contained to one file, guarded by a new characterization test |
| 2. Relocate seed-color constants | boids.ts no longer imports from src/styles/*; new seed-colors.ts is the single source of truth | Low — contained to boids.ts + 2 files, guarded by a literal-value characterization test |

**Prerequisites:** none — both phases work against the current codebase as-is.
**Estimated effort:** 2 phases, each independently verifiable and revertible.

## Open Risks & Assumptions

- `.github/workflows/deploy.yml` has no `pull_request` trigger — both
  phases' safety rests on the characterization tests plus a human
  reviewing the diff before merge, not a CI gate catching a regression
  pre-merge (research.md's own cross-cutting finding, not unique to this
  plan).
- Phase 1's exact coverage of all 8 `history` fields independently on both
  completion paths was flagged as `unknown` in research — this plan's
  characterization test closes that gap as part of Phase 1 itself.

## Success Criteria (Summary)

- `server-run-registry.ts`'s two completion paths call one shared helper; no behavior change.
- `boids.ts` has zero imports from `src/styles/*`; seed colors are byte-for-byte identical to today's values.
- Full test suite, typecheck, and lint all pass after each phase.
