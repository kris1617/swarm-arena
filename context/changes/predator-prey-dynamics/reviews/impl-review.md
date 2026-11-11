<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Predator-Prey Dynamics Implementation Plan

- **Plan**: context/changes/predator-prey-dynamics/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated success criteria (re-verified independently, not just taken from the agent's report)

- `npm run typecheck` — PASS
- `npm run check` — PASS
- `npx vitest run` (full suite) — PASS (4 files, 30/30 tests)

## Drift detection summary

All three phases are a clean MATCH against the plan's Intent/Contract for every named change,
including the load-bearing tick-loop ordering in Phase 3 (`stepBoids` → `stepPredators` →
`applyHunger` → `applyPredation`), verified exact. Diff scope matches the plan's file list
exactly — no undocumented files, no scope creep. "What We're NOT Doing" is fully respected
(no reproduction/genetics, no admin ranges/save-resume/3-part score, no spatial food
particles, no predator hunger/cooldown, no per-boid local-neighborhood threshold check).

## Findings

### F1 — New NOT NULL schema columns pushed with no migration file or default

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/db/schema.ts:104-107
- **Detail**: `predatorCount`, `protectionThreshold`, `foodStockInitial`, `foodRegenRate` are
  all `.notNull()` with no `.default(...)`, applied via `drizzle-kit push` directly rather
  than a generated migration (no new file under `drizzle/`). This is harmless for the current
  local dev DB (confirmed empty/reset), but in any environment where `simulation_run` already
  has rows under the old schema, a `push` would either refuse (NOT NULL violation) or require
  an undocumented interactive backfill default. The plan's own "Migration Notes" section
  already states "no real runs have been created against this schema yet" — this finding is
  about whether that assumption is recorded as a forward-looking constraint, not just a
  backward-looking justification.
- **Fix A ⭐ Recommended**: Document the constraint explicitly in `plan.md`'s Migration Notes —
  add one sentence stating that any future schema change to `simulationRuns`, once this
  project has real persisted runs, must go through `npm run db:generate` with an explicit
  backfill default instead of a bare `db:push`.
  - Strength: Matches the project's own stated reality (hobby app, single user, pre-launch of
    this feature) and costs one sentence.
  - Tradeoff: Doesn't harden the process itself — someone still has to remember it for S-03/S-04.
  - Confidence: HIGH — grounded in the plan's own existing justification for this exact choice.
  - Blind spot: Assumes no other developer or environment currently holds old-schema data.
- **Fix B**: Generate a proper Drizzle migration now (`db:generate`) with explicit defaults for
  the 4 new columns, retrofitted against the already-pushed schema.
  - Strength: Establishes the safer process going forward for any future environment with data.
  - Tradeoff: Retrofitting a migration after `db:push` already applied the change is nontrivial
    — risks drifting out of sync with the actually-pushed state if not done carefully.
  - Confidence: MEDIUM — unverified whether `drizzle-kit generate` cleanly diffs against an
    already-pushed state without re-applying anything.
  - Blind spot: Haven't tested the generate-after-push flow in this repo.
- **Decision**: PENDING

### F2 — New food fields skip the form's clamp-before-submit convention

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/page.tsx:101-102
- **Detail**: Every other numeric field in this submit handler clamps before sending
  (`boidCount`/`predatorCount` via `Math.min(Math.max(...), ...)`, `protectionThreshold` via
  `Math.max(0, Math.round(...))`), but `foodStockInitial`/`foodRegenRate` are sent raw. A
  negative `foodStockInitial` round-trips to the server and surfaces as a generic tRPC
  validation error instead of the smooth client-side clamp this form otherwise provides
  everywhere else.
- **Fix**: Clamp `foodStockInitial` to `Math.max(0.1, foodStockInitial)` and `foodRegenRate` to
  `Math.max(0, foodRegenRate)` before `.mutate`, matching the existing fields' style.
- **Decision**: PENDING

### F3 — `onSuccess` reads 3 of the 4 new fields from closure state, not the validated payload

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/page.tsx:38-59
- **Detail**: `boidCount`/`predatorCount` are read from `variables` (the actual clamped payload
  sent to the server) in `onSuccess`, but `protectionThreshold`/`foodStockInitial`/
  `foodRegenRate` are read from raw closure state — so the canvas could technically run with a
  slightly different value than what was validated/persisted if a user edits the form between
  submit and the mutation resolving. Pre-existing fields (`weights`, `maxDurationSeconds`) have
  this same characteristic already, so this isn't new drift, just unaddressed precedent
  extended to 3 more fields.
- **Fix**: Read `protectionThreshold`/`foodStockInitial`/`foodRegenRate` from `variables` in
  `onSuccess`, matching `boidCount`'s pattern.
- **Decision**: PENDING

### F4 — `protectionThreshold` has no upper bound

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:20
- **Detail**: `protectionThreshold: z.number().int().nonnegative()` has no `.max()`, unlike
  `boidCount`/`predatorCount`. Functionally harmless — `applyPredation` just never attacks if
  `boids.length <= protectionThreshold`, no crash for arbitrarily large values — but it's the
  one new numeric field with no ceiling at all.
- **Fix**: None needed — harmless by construction; a cap would be cosmetic.
- **Decision**: PENDING

### F5 — New and existing numeric fields accept `Infinity`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts:14-22
- **Detail**: `z.number()` rejects `NaN` but not `Infinity`/`-Infinity`. `foodStockInitial`
  (`.positive()`) and `foodRegenRate` (`.nonnegative()`) both pass for `+Infinity`, same
  pre-existing gap as `separationWeight`/`alignmentWeight`/`cohesionWeight`. A crafted direct
  API call (not reachable from the clamped UI) could poison a run's math with `Infinity`/`NaN`.
  Low likelihood, not a regression this change introduced.
- **Fix**: Add `.finite()` to the numeric weight/food fields if hardening against direct API
  callers (not just the UI) is a goal — applies equally to the 3 pre-existing weight fields.
- **Decision**: PENDING

### F6 — Plan's own Phase 1 Contract text is internally inconsistent about `applyHunger`'s signature

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/predator-prey-dynamics/plan.md:158-167
- **Detail**: The plan's Phase 1 Contract text states the signature as
  `applyHunger(boids, foodStock, dtSeconds)` but then says in the same paragraph that
  `foodRegenRate` is "a caller-supplied parameter" — internally inconsistent. The actual
  implementation correctly uses the 4-arg form `applyHunger(boids, foodStock, dtSeconds,
  foodRegenRate)`, the only form consistent with Phase 3's own wiring. Not implementation
  drift — the plan resolved its own contradiction the only sensible way — but worth a
  documentation fix so a future reader of the plan isn't confused.
- **Fix**: Update plan.md:158 to state the 4-arg signature explicitly, matching what Phase 3
  already specifies.
- **Decision**: PENDING
