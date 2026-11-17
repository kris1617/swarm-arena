# Refactor opportunities implementation plan (10xArchitect M4L4 artifact)

## Overview

Two independent, guard-first refactors on sim-engine, each addressing one
candidate ranked in `research.md`: extracting the duplicated
`history`/score-computation logic in `server-run-registry.ts` into shared
helpers (Candidate C), and relocating the two seed-color hex constants out
of the client-presentation module into a server-owned source of truth
(Candidate A). Each phase adds a characterization test *before* touching
production code, so the refactor is provably behavior-preserving, not just
assumed to be.

## Current State Analysis

- `server-run-registry.ts` builds the same 8-field `history` object and the
  same 5-argument `computeScore(...)` call independently at two sites:
  inside `tick()`'s `if (result.shouldStop)` branch (`:557-578`) and inside
  `stopServerRun()` (`:676-696`). No comment ever justified the
  duplication; `research.md`'s history-and-intentionality pass found it was
  the literal implementation instruction in the original `persist-run-history`
  plan, repeated unexamined across 5 later field-addition commits. The risk
  has already partially materialized: `src/server/db/schema.ts:149`'s own
  comment lists only 3 of the real 8 fields.
- `src/server/simulation/boids.ts:5` imports `BOID_FILL_COLOR`/
  `PREDATOR_FILL_COLOR` from `~/styles/theme-colors` — a client-presentation
  module (`theme-colors.ts:1-5`'s own header: "Canvas-readable mirror of
  the color values in globals.css... `<canvas>` drawing can't read a CSS
  custom property"). Used at `boids.ts:331,380` to seed flock 0's color via
  `createFlockColors`. `research.md`'s intentionality pass found the
  color-continuity *behavior* is deliberate (explicit decision in
  `context/archive/2026-11-13-genetic-inheritance-crossbreeding/plan.md`),
  but the cross-layer *import* was never discussed or decided — the module
  simply reused two already-existing hex constants.

### Key Discoveries:

- `finishRun`'s own parameter type (`server-run-registry.ts:408-432`)
  already names the 8-field `history` shape as a type — it just isn't used
  as a constructor at either call site.
- `boids.test.ts:107-162` and `boids.test.ts:164-192` already assert
  determinism and hue-separation distinctness on `genes.color`, but neither
  pins a literal expected `{r,g,b}` value — a same-shape relocation that
  changes the actual value would still pass these tests.
- `boids.ts:248-249` already exports local constants
  (`FLOCK_COLOR_SATURATION`, `FLOCK_COLOR_LIGHTNESS`) in the same file,
  confirming local-constant-by-convention is an established style here.
- `.github/workflows/deploy.yml` runs the full test suite (`npm test`) only
  on push to `master` (no `pull_request` trigger) — both phases' guard
  tests are the only protection before a human reviews the diff, not a
  pre-merge CI gate.

## What We're NOT Doing

- Not touching Candidate B (`computeSingleRunTick`'s two hand-synced
  callers) — `research.md` explicitly ranked it out of this plan: the
  split causing the duplication is itself a deliberate, repeatedly-endorsed
  architectural pattern, `typecheck` already guards the shape, and its
  blast radius is the widest of the three for the lowest marginal risk
  reduction.
- Not adding a `pull_request` CI trigger — `research.md` flagged the
  cross-cutting CI gap, but fixing it is a separate, non-refactor concern
  (CI pipeline authorship), out of scope for this plan.
- Not changing any persisted data shape, migration, or the public tRPC
  contract — both refactors are pure internal restructuring with identical
  external behavior.
- Not touching `theme-colors.ts`'s other constants (`CANVAS_BACKGROUND`,
  the border color) — only `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` move.

## Implementation Approach

Each phase follows the same guard-first shape: add a characterization test
that pins today's exact observable output, confirm it passes against the
*current* code, then extract/relocate, then confirm the same test (plus all
pre-existing tests) still passes unchanged. This makes each phase
independently reversible — a `git revert` of either phase's commit cleanly
restores the prior behavior, verified by its own guard test.

## Phase 1: Extract `buildFinishHistory`/score helper (Candidate C)

### Overview

Removes the duplicated `history` object literal and `computeScore(...)`
call at `server-run-registry.ts`'s two completion paths (`tick()` and
`stopServerRun()`), replacing both with one local helper each.

### Changes Required:

#### 1. Characterization test

**File**: `src/server/simulation/server-run-registry.test.ts`

**Intent**: Pin today's exact `history`/`score` output from both
completion paths (natural tick-triggered stop and manual `stopServerRun`)
before touching production code, so the extraction in step 2 below is
provably behavior-preserving.

**Contract**: Two new assertions (or extend existing natural-completion/
manual-stop tests already in this file) that read back the full persisted
row after each path and assert every one of the 8 `history` fields plus
`score` match a captured expected value — not just "is an array"/"is a
number", matching this file's own existing precedent at the
natural-completion test (`:106-162`, already asserts non-empty sample
arrays and `elapsedSeconds > 0`).

#### 2. `buildFinishHistory` + score helper

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: One local function builds the `history` object from a `run`-shaped
input; one local function (or the same one, returning both) computes the
score. Both call sites (`tick()`'s `shouldStop` branch, `stopServerRun()`)
call the same functions instead of hand-duplicating the literal/call.

**Contract**: `function buildFinishPayload(run: LiveRun): { score: number;
history: NonNullable<Parameters<typeof finishRun>[1]["history"]> }` (name
and exact signature at the implementer's discretion — the contract is "one
function, same 8-field shape as `finishRun`'s existing type, used by both
call sites"), local to this file per this session's chosen placement
(matches `LiveRun`/`ServerRunSnapshot`'s own local-to-this-file
convention). Both call sites replace their inline `computeScore(...)` +
object-literal `history` with one call to this function.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite passes: `npm test`

#### Manual Verification:

- None — this phase is a pure internal refactor with no user-visible
  surface; the characterization test plus the full suite are sufficient
  verification.

---

## Phase 2: Relocate seed-color constants (Candidate A)

### Overview

Removes `boids.ts`'s cross-layer import of `~/styles/theme-colors`,
replacing it with a server-owned source of truth for the two seed-color
hex values, while preserving the exact color-wheel output.

### Changes Required:

#### 1. Characterization test

**File**: `src/server/simulation/boids.test.ts`

**Intent**: Pin today's exact `genes.color` value for flock 0 at a fixed
seed, before relocating the constant — the existing determinism/distinctness
tests (`:107-192`) don't pin a literal value, so a same-shape relocation
that silently changes it would otherwise pass unnoticed.

**Contract**: One new assertion (alongside the existing
`describe("createInitialPopulation / createInitialPredators flock split")`
block) asserting `boids.find(b => b.genes.flockId === 0)?.genes.color`
equals a literal `{ r, g, b }` object for a fixed `createRng(seed)` —
capture today's actual value by running the test once before relocating
the constant, per this project's own existing pattern at
`boids.test.ts:560` ("produces byte-for-byte identical output to a
captured pre-refactor fixture").

#### 2. New server-owned constants file

**File**: `src/server/simulation/seed-colors.ts` (new)

**Intent**: Single source of truth for the two hex values, owned by the
simulation engine (the primary consumer of the *value*, per `research.md`'s
intentionality finding that this is fundamentally simulation seed data that
also happens to be used for rendering, not UI data that happens to be
reused for simulation).

**Contract**: Exports `BOID_SEED_COLOR = "#38bdf8"` and
`PREDATOR_SEED_COLOR = "#f97316"` (identical hex values to today's
`BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` — this phase changes the import
path, never the color itself), with a short comment explaining why these
live here and not in `theme-colors.ts` (simulation-seed data first,
presentation second).

#### 2. `boids.ts` import swap

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the cross-layer import with the new server-owned one.

**Contract**: Line 5's import changes from `~/styles/theme-colors` to
`~/server/simulation/seed-colors`; usages at lines 331/380 rename to the
new exported identifiers. No other line in this file changes.

#### 3. `theme-colors.ts` re-export

**File**: `src/styles/theme-colors.ts`

**Intent**: Keep `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` available to the
client canvas renderer (`simulation-canvas.tsx:42`) under their existing
names, now re-exported from the new single source of truth instead of
hand-duplicated — turning this file's own documented "kept in sync by
hand" convention into an actual re-export for these two values specifically.

**Contract**: `export { BOID_SEED_COLOR as BOID_FILL_COLOR,
PREDATOR_SEED_COLOR as PREDATOR_FILL_COLOR } from
"~/server/simulation/seed-colors";` (or equivalent re-export syntax),
replacing the two `export const` lines. `CANVAS_BACKGROUND` and every
other constant in this file stay untouched.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite passes: `npm test`

#### Manual Verification:

- None — the color values are provably unchanged by the characterization
  test; no visual/behavioral change exists for a human to check.

---

## Testing Strategy

### Unit Tests:

- Phase 1's characterization test on `buildFinishPayload`'s output,
  exercised via both completion paths (natural stop, manual stop).
- Phase 2's literal-value characterization assertion on flock 0's seeded
  color.

### Manual Testing Steps:

None required for either phase — both are provably behavior-preserving
internal refactors verified by characterization tests plus the full
existing suite.

## Migration Notes

Neither phase touches persisted data shape, schema, or any migration.
Phase 1 is pure code restructuring; Phase 2 changes only an import path,
not a value.

## References

- Research: `context/changes/refactor-opportunities/research.md`
- Prior feature analysis: `context/changes/sim-engine-feature-analysis/research.md`
- Repo map (origin of the Candidate A boundary-break finding): `context/map/repo-map.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract buildFinishHistory/score helper (Candidate C)

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 Full suite passes: `npm test`

### Phase 2: Relocate seed-color constants (Candidate A)

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run check`
- [ ] 2.3 Full suite passes: `npm test`
