# Functional regression audit on newest shipped slices — Implementation Plan

## Overview

Close the 5 functional-coverage gaps identified in `research.md`: every
live-adjust/toggle feature shipped since S-27 (live-parameter-adjustment) has
thorough write/plumbing-level test coverage but zero automated test that
drives a real tick/reproduction cycle and asserts the mutation's actual
behavioral effect. This is rollout Phase 7 of `context/foundation/test-plan.md`
§3, opened via `/10x-test-plan --refresh`.

## Current State Analysis

- **Live-adjustable fields** (`foodRegenRate`, `protectionThreshold`,
  `energyThreshold`, `mutationChance`, `mutationMagnitude`,
  `crossbreedingEnabled`) all flow through one router procedure,
  `simulation.updateRunParams` (`src/server/api/routers/simulation.ts:987-1048`),
  which calls `applyLiveParams` (`server-run-registry.ts`) and is already
  covered by write/round-trip tests in `simulation.test.ts` and
  `server-run-registry.test.ts` — but no test drives a tick afterward.
- **Server-owned ticks** are driven internally by a private `tick()` function
  (`server-run-registry.ts:439`, not exported) on a real interval; existing
  tests already drive it via `vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync(N)` (e.g. `server-run-registry.test.ts:103-115`).
  This is the established pattern for triggering a server-owned tick in tests.
- **Client-staged ticks** go through `computeSingleRunTick`
  (`single-run-lifecycle.ts:23`), a pure, DOM-free function already called
  directly (not through any component) in `single-run-lifecycle.test.ts` —
  e.g. lines 100, 124-131, 152-159. This means client-staged behavioral tests
  need no React/DOM scaffolding at all.
- **`adjustLivePopulation`** (`server-run-registry.ts:268-357`) reuses
  `createInitialPopulation`/`createInitialPredators` (`boids.ts:322-367`) for
  growth, so new individuals get the exact same shape as initial-population
  members: `energy: INITIAL_ENERGY` (currently a module-private `const
  INITIAL_ENERGY = 20` at `boids.ts:132`, not exported), `age: 0`, and a
  `genes` object containing `flockId` (not a top-level field).
- **`computeGeneticDiversity`** (`boids.ts`, unit-tested at
  `boids.test.ts:1168-1199`) is a pure function of a genes array; no existing
  test feeds a known-variance population through multiple
  `computeSingleRunTick` calls and checks the resulting
  `geneticDiversitySamples` series shape.

### Key Discoveries:

- `updateRunParams`'s single procedure covering all 6 fields means one shared
  test helper can drive every live-param/crossbreeding behavioral test —
  confirmed as the user's chosen approach.
- `computeSingleRunTick` being already directly callable in
  `single-run-lifecycle.test.ts` means the client-staged behavioral tests
  need no new mocking infrastructure — they bypass the React component
  entirely, same as that file already does.
- `INITIAL_ENERGY` is not currently exported from `boids.ts`, unlike its
  sibling `ENERGY_MAX`/`ENERGY_GAIN_RATE` (exported "ahead of Phase 2's
  `reproducePopulation`" per the comment at `boids.ts:136-139`) — the same
  rationale (a documented constant a later consumer needs) applies to this
  new test consumer.

## Desired End State

Every one of the 5 gaps has an automated test that applies a mutation (via
the router or directly) and then observes the mutation's effect on a
subsequent tick's output — not just that a value round-tripped through
storage. A future regression of the exact S-27 failure mode (a field that's
written and displayed but never read at decision time) would fail one of
these tests. Verify by: running the new/changed test files and confirming
they fail if the corresponding behavioral wiring is deliberately broken (the
per-phase deliberate-break check).

## What We're NOT Doing

- Not re-testing the write/round-trip layer — that's already covered.
- Not extending S-32's new oracle test to the pause/resume snapshot path —
  that path's crash-safety is already solidly covered (`server-run-registry.test.ts:1111-1151`);
  this plan only adds series-correctness coverage, which research identified
  as the actual gap.
- Not adding a client-staged equivalent for `adjustLivePopulation` (S-30) —
  research confirmed this feature is server-owned only; no client-staged
  code path exists to test.
- Not building a generic "simulation test framework" — the shared helper
  (Phase 1) is scoped narrowly to the live-param/crossbreeding patch-then-tick
  pattern, not a general-purpose testing library.

## Implementation Approach

Server-owned behavioral tests go through the real router (`createCaller`) per
the user's choice, using the existing fake-timer tick-driving pattern.
Client-staged behavioral tests call `computeSingleRunTick` directly, matching
`single-run-lifecycle.test.ts`'s existing style — no new mocking needed. A
shared test helper centralizes the server-owned "patch → tick → read back"
sequence so the 6 new behavioral tests in Phase 1 don't duplicate setup.
Boid-count-growth and diversity-series each get a standalone, narrowly-scoped
test (no shared helper needed — each is structurally different from the
patch-then-tick pattern).

## Phase 1: Shared behavioral-test helper + server-owned live-param/crossbreeding tests

### Overview

Add a reusable test helper for the "patch the live param via the router, then
drive a tick, then observe the effect" sequence, and use it for 6 new
server-owned behavioral tests (5 live-param fields + crossbreeding toggle).

### Changes Required:

#### 1. Shared test helper

**File**: `src/server/api/routers/simulation.test.ts` (new local helper,
colocated — no new file; this suite already owns the `createCaller`/fixture
patterns the helper wraps)

**Intent**: Wrap "call `updateRunParams` via `createCaller`, advance fake
timers by one or more ticks, return the updated run state for assertion"
into one function, so each of the 6 new tests below is a short call plus its
own behavioral assertion.

**Contract**: `async function patchLiveParamsAndTick(caller, runId, patch, tickMs)` —
calls `caller.simulation.updateRunParams({ runId, ...patch })`, then `await
vi.advanceTimersByTimeAsync(tickMs)`, then returns whatever read-back the
caller needs (the implementer determines the exact return shape per call
site — e.g. the live `server-run-registry` internal state via its existing
exported accessors, not a new export).

#### 2. Behavioral test: `foodRegenRate`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Prove that patching `foodRegenRate` upward actually changes the
food-stock delta observed over a subsequent tick, compared to a control run
patched to a lower value — not just that the stored field changed.

**Contract**: New `it(...)` inside the existing `updateRunParams` describe
block (or a new sibling describe block if that reads better) using
`patchLiveParamsAndTick`. Must challenge the assumption that the write-level
tests already prove this (per research.md's Risk Response Guidance).

#### 3. Behavioral test: `protectionThreshold`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Prove that raising `protectionThreshold` above a flock's current
size actually prevents predation of that flock on a subsequent tick (vs. a
control where it stays low and predation can occur).

**Contract**: Uses a fixture population sized to straddle the threshold
before/after the patch, a predator present, and asserts predation
occurred/did not occur based on the threshold.

#### 4. Behavioral test: `energyThreshold`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Automate the plan's own previously-manual-only check (S-31/S-28
Progress 2.6): setting `energyThreshold` far above any boid's energy
prevents further reproduction on a subsequent tick.

**Contract**: Fixture population with known energy levels; patch
`energyThreshold` above all of them; tick; assert population count is
unchanged (no new reproduction) vs. a control where the threshold stays low.

#### 5. Behavioral test: `mutationChance` / `mutationMagnitude`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Automate the plan's own previously-manual-only deterministic
check (S-31/S-28): `mutationMagnitude = 0` produces zero-deviation offspring
genes relative to the parent average; a nonzero `mutationChance` with nonzero
magnitude produces measurable deviation.

**Contract**: Drive reproduction (via a fixture with enough food/energy to
reproduce) after patching each field; compare offspring genes against the
parent-average baseline.

#### 6. Behavioral test: `crossbreedingEnabled`

**File**: `src/server/api/routers/simulation.test.ts`

**Intent**: Prove that toggling `crossbreedingEnabled` on/off via the router
actually changes whether inter-flock reproduction occurs on a subsequent
tick — closing the gap research found (the only existing behavioral test,
`boids.test.ts:838-864`, calls `reproducePopulation` directly, never through
`applyLiveParams` → tick).

**Contract**: Two-flock fixture with mixed-flock mating opportunity; toggle
on vs. off; assert inter-flock offspring appear only when enabled.

### Success Criteria:

#### Automated Verification:

- New/changed tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None — these are all automated behavioral assertions; no UI surface changes.

---

## Phase 2: Client-staged live-param/crossbreeding behavioral tests

### Overview

Mirror Phase 1's 6 behavioral tests for the client-staged execution path,
using `computeSingleRunTick` directly (no router, no component, no mocking)
since all 6 fields apply to both paths per `research.md`.

### Changes Required:

#### 1. Client-staged behavioral tests

**File**: `src/server/simulation/single-run-lifecycle.test.ts`

**Intent**: For each of the 6 fields/toggle, construct a `params` object
(following this file's existing `PARAMS`/override pattern, e.g. lines 24-65),
call `computeSingleRunTick(state, timestamp, params)` one or more times, and
assert the same behavioral effects Phase 1 asserts for the server-owned path
— adapted to this file's existing state/params shape rather than a router
call.

**Contract**: New `it(...)` blocks inside `describe("computeSingleRunTick",
...)` (or sibling describes), one per field/toggle. No new helper needed —
this file's existing override/call pattern (lines 65, 100, 124-131) already
covers the "construct params, call the pure function, inspect the result"
shape; each test differs only in the params patched and the resulting field
inspected.

### Success Criteria:

#### Automated Verification:

- New/changed tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`
- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 3: Boid-count-growth initialization test (S-30)

### Overview

Close the gap where newly-spawned boids/predators from `adjustLivePopulation`
growth are checked for position/length but never for correct
`energy`/`age`/`genes`/`flockId` initialization — a malformed-placeholder
regression would currently pass undetected.

### Changes Required:

#### 1. Export `INITIAL_ENERGY`

**File**: `src/server/simulation/boids.ts`

**Intent**: The new test needs to assert new individuals' energy equals the
documented spawn value exactly (per the user's chosen exact-value-match
strictness), not a magic-number duplicate of `20`.

**Contract**: Change `const INITIAL_ENERGY = 20;` (line 132) to `export const
INITIAL_ENERGY = 20;`, matching the existing export rationale already
documented in this file's comment for `ENERGY_MAX`/`ENERGY_GAIN_RATE`
(lines 136-139: "kept as plain exports... so the name [a later consumer]
imports is already the name declared here").

#### 2. Behavioral/initialization test

**File**: `src/server/simulation/server-run-registry.test.ts`

**Intent**: Extend the existing growth test (around lines 531-580) — or add
a sibling test — to assert, for each newly-added boid and predator, exact
values: `energy === INITIAL_ENERGY`, `age === 0`, and a well-formed `genes`
object (matching the shape `createInitialPopulation` produces at
`boids.ts:349-359`: `color`, `flockId` within `[0, flockCount)`,
`separationWeight`/`alignmentWeight`/`cohesionWeight` matching the run's
current flock weights, `maxSpeed`/`minSpeed`/`maxLifespan`, a finite
`matePreference`).

**Contract**: Exact-value assertions per the user's chosen strictness level
— not range/shape-only checks.

### Success Criteria:

#### Automated Verification:

- New/changed tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 4: Genetic-diversity-trend series oracle test (S-32)

### Overview

Close the gap where the per-tick `geneticDiversitySamples` series is never
checked against a constructed oracle — every existing test either mirrors
the same production function it's checking, or only checks plumbing/forwarding.

### Changes Required:

#### 1. Series-correctness oracle test

**File**: `src/server/simulation/single-run-lifecycle.test.ts`

**Intent**: Construct two fixture populations — one with zero genetic
variance (identical genes across all boids) and one with deliberately
injected mutation/variance across boids — drive each through several
`computeSingleRunTick` calls, and assert the resulting
`geneticDiversitySamples` series is flat/near-zero for the first and
measurably rising (or at least nonzero and non-decreasing in a way tied to
the injected variance) for the second. This must NOT recompute the expected
value using `computeGeneticDiversity` itself (the existing mirror-test
anti-pattern at `single-run-lifecycle.test.ts:143-164`) — the oracle is the
constructed population's known variance, not a second call to the function
under test.

**Contract**: New `it(...)` block(s) in `describe("computeSingleRunTick",
...)` or a sibling describe scoped to diversity-series correctness.

### Success Criteria:

#### Automated Verification:

- New/changed tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`
- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 5: Cookbook update + mark rollout Phase 7 complete

### Overview

Document the new "behavioral-effect test" pattern this plan introduces in
`context/foundation/test-plan.md` §6, and mark rollout Phase 7's §3 row
`complete`.

### Changes Required:

#### 1. New cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Add a `6.7` entry documenting the "patch (or construct state) →
drive a tick → assert the downstream decision output changed" pattern
established across Phases 1-4, so a future live-adjust/toggle feature gets
this coverage from the start rather than repeating the S-27 gap.

**Contract**: New `### 6.7 Adding a behavioral-effect test for a live-adjust/toggle feature`
subsection, following the existing `### 6.N` format (Location, Pattern,
Reference test, Run command) used by `6.1`-`6.6`.

#### 2. Mark Phase 7 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Flip rollout Phase 7's §3 Status cell from `change opened` to
`complete` once this plan's Progress is fully `[x]`.

**Contract**: Edit the `| 7 | Functional regression audit on newest shipped slices | ... |` row's Status cell.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- `context/foundation/test-plan.md` §6.7 reads clearly as a standalone
  pattern description (spot-check by the implementer, not a separate human
  gate).

---

## Testing Strategy

### Unit Tests:

- Phase 2 and Phase 4's tests are pure unit tests against `computeSingleRunTick`.
- Phase 3's test is a unit/integration test against `adjustLivePopulation`.

### Integration Tests:

- Phase 1's 6 tests are integration tests through the real `updateRunParams`
  router procedure via `createCaller`.

### Manual Testing Steps:

None — every success criterion in this plan is automated. This phase is
itself a testing-infrastructure change; there is no new user-facing surface
to manually verify.

## References

- Research: `context/changes/test-plan-refresh-2026-11-16/research.md`
- Originating lesson: `context/foundation/lessons.md` ("UI accepts input is
  not feature verified")
- Rollout phase definition: `context/foundation/test-plan.md` §3, Phase 7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared behavioral-test helper + server-owned live-param/crossbreeding tests

#### Automated

- [x] 1.1 New/changed tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- [x] 1.2 Full suite still passes: `npm test`
- [x] 1.3 Typecheck passes: `npm run typecheck`
- [x] 1.4 Lint passes: `npm run check`

### Phase 2: Client-staged live-param/crossbreeding behavioral tests

#### Automated

- [ ] 2.1 New/changed tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`
- [ ] 2.2 Full suite still passes: `npm test`
- [ ] 2.3 Typecheck passes: `npm run typecheck`
- [ ] 2.4 Lint passes: `npm run check`

### Phase 3: Boid-count-growth initialization test (S-30)

#### Automated

- [ ] 3.1 New/changed tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- [ ] 3.2 Full suite still passes: `npm test`
- [ ] 3.3 Typecheck passes: `npm run typecheck`
- [ ] 3.4 Lint passes: `npm run check`

### Phase 4: Genetic-diversity-trend series oracle test (S-32)

#### Automated

- [ ] 4.1 New/changed tests pass: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`
- [ ] 4.2 Full suite still passes: `npm test`
- [ ] 4.3 Typecheck passes: `npm run typecheck`
- [ ] 4.4 Lint passes: `npm run check`

### Phase 5: Cookbook update + mark rollout Phase 7 complete

#### Automated

- [ ] 5.1 Full suite passes: `npm test`
- [ ] 5.2 Typecheck passes: `npm run typecheck`
- [ ] 5.3 Lint passes: `npm run check`

#### Manual

- [ ] 5.4 `context/foundation/test-plan.md` §6.7 reads clearly as a standalone pattern description
