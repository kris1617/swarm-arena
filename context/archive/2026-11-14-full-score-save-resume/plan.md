# Full Scoring with Save and Resume Implementation Plan

## Overview

Close out roadmap M-1 by building S-04's four previously-deferred pieces:
(1) exposing the PRNG's internal state for exact resume, (2) admin-defined
parameter ranges (FR-002 full, FR-018 full), (3) the real four-factor
scoring formula — survival × resource management × genetic diversity ×
population-lifecycle-phase quality (FR-010, FR-019), including a
correctness fix to the existing mislabeled "genetic diversity" input, and
(4) a new "Save & Pause" / "Resume" flow for server-owned runs with
exact-fidelity state persistence (FR-011, FR-012).

## Current State Analysis

See `context/changes/full-score-save-resume/research.md` for full
file:line evidence. Summary of what's unbuilt or wrong today:

- `adminProcedure` (`src/server/api/trpc.ts:164`) exists, zero usages.
  `start`/`startServer`'s `startInputSchema` hardcodes bounds identically
  for every user.
- `createRng` (`src/server/simulation/rng.ts:9-21`) exposes no internal
  state — resume is impossible as-is.
- `runTick` (`src/server/simulation/boids.ts:965-1066`) computes
  `foodAvailabilityRatio` (lines 1011-1014) but discards it.
- `computeCohesion` (`boids.ts:1095-1122`) — the function currently
  standing in for "genetic diversity" — measures spatial clustering, reads
  zero gene fields. Mislabeled, not just unimplemented.
- `computeScore` (`boids.ts:1124-1135`) is a 2-argument placeholder:
  `elapsedTicks * average(cohesionSamples)`.
- `computeSingleRunTick` (`single-run-lifecycle.ts:18-111`) is the one
  shared tick core feeding both the client-staged and server-owned paths —
  extend it once, here, not in `server-run-registry.ts` separately.
- `simulationRuns` (`src/server/db/schema.ts:92-127`) has no live-state
  persistence column of any kind.

## Desired End State

- An admin can set, for every tunable simulation parameter, a min/max/
  default; `start`/`startServer` validate against those ranges instead of
  hardcoded bounds; members see the admin-configured bounds in the form.
- Every run's score is `survival × resourceManagement × geneticDiversity × phaseQuality`,
  where `geneticDiversity` is a real gene-value-variance metric (not
  spatial clustering) and `phaseQuality` rewards both sustained time in
  healthy population-lifecycle phases and a resilience bonus for
  completing a Crash → Recovery transition.
- A server-owned run can be "Saved & Paused" (persists exact live state,
  no score shown yet) and later "Resumed" (reconstructs that exact state
  — same boid/predator populations, food stock, elapsed time, and PRNG
  sequence — and keeps ticking). The existing "Stop" action is completely
  unchanged.

Verify: resume a saved run and confirm (by snapshotting state right before
save and right after resume) that boid count, positions, genes, food
stock, and the next few PRNG-derived outcomes are bit-identical to what
they would have been had the run never been interrupted.

## What We're NOT Doing

- Not adding "Save & Pause"/"Resume" to the client-staged canvas path —
  scoped to server-owned runs only, consistent with this project's
  established staging-is-ephemeral / server-run-is-the-real-thing split
  (S-06 through S-08).
- Not changing the existing "Stop" action's behavior at all (confirmed
  product decision 2026-11-14) — it stays terminal, scores immediately,
  not resumable.
- Not building "admin can manage other users' runs" — PRD Open Question #3
  is explicitly still open and out of scope here; this phase only builds
  the one resolved admin capability (parameter ranges + object-count cap).
- Not changing `computeCohesion`'s behavior or its use in rendering —
  only removing it as a scoring input.
- Not implementing FR-015 (parameter-change suggestions) or FR-016
  (side-by-side comparison) — both remain Parked/nice-to-have; this phase
  only unblocks FR-016 by giving it a stable formula to compare against.

## Implementation Approach

Four ordered phases, matching research's dependency analysis: (1) RNG
state exposure — foundational, zero blast radius by design (see Phase 1);
(2) admin parameter ranges — independent, could run in parallel with (1)
but sequenced after for a cleaner review trail; (3) the scoring rewrite
inside the one shared tick core; (4) save/resume persistence, which needs
both (1)'s RNG state and (3)'s new per-tick sample shapes to know what a
snapshot must contain.

## Phase 1: Expose RNG state without changing any existing call site

### Overview

Make `createRng`'s returned function carry `.getState()`/`.setState()`
alongside its existing callable behavior, so every one of the ~39 existing
call sites that calls `rng()` directly or passes `rng` as a plain
`() => number` keeps compiling and behaving identically — only the few
call sites that need persistence (Phase 4) use the new methods.

### Changes Required:

#### 1. `createRng` returns a callable-with-state

**File**: `src/server/simulation/rng.ts`

**Intent**: Add exact state capture/restore without touching the function's
call-as-`() => number` contract, so `reproducePopulation`,
`createInitialPopulation`, `computeSingleRunTick`, and every test that
currently does `rng()` or passes `createRng(seed)` directly where a
`() => number` is expected needs zero changes.

**Contract**:
```ts
export type Rng = (() => number) & {
	getState: () => number;
	setState: (state: number) => void;
};

export function createRng(seed: number): Rng
```
`next` (the existing mulberry32 body, unchanged) becomes the callable
itself; `getState`/`setState` read/write the same closed-over `state`
variable the algorithm already advances — `setState` must accept exactly
what `getState` returns, round-tripping the internal mulberry32 state
bit-for-bit (not the original seed). Keep the existing `RangeError` guard
on construction; `setState` does not need the same guard (internal state
after advancing is not constrained to the seed's integer-only rule the
same way — confirm against the actual algorithm during implementation,
document if a guard is or isn't needed).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Updated test passes: `npx vitest run src/server/simulation/rng.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- None — this phase changes no user-visible behavior; covered entirely by
  automated round-trip tests.

---

## Phase 2: Admin-defined parameter ranges (FR-002 full, FR-018 full)

### Overview

Add a single admin-editable settings row covering every tunable parameter's
min/max/default plus the global object-count cap; wire `start`/`startServer`
to validate against it; wire the member-facing form to display the
admin-configured bounds instead of hardcoded ones.

### Changes Required:

#### 1. `adminSettings` table

**File**: `src/server/db/schema.ts`

**Intent**: Hold the one global, admin-editable configuration row.

**Contract**: `adminSettings` — singleton row (`id` fixed at a known
constant, e.g. `1`, enforced at the application layer by always
upserting/reading that id rather than a DB-level singleton constraint).
`parameterRanges: text(..., { mode: "json" })` — a JSON object keyed by
every tunable parameter name (`boidCount`, `separationWeight`, ...,
`mutationMagnitude` — the same field set `startInputSchema` already
validates) with `{ min: number; max: number; default: number }` per key.
`maxObjectCount: integer` — the FR-018 global cap, replacing the currently
hardcoded `500` ceiling in `startInputSchema`'s combined-cap `.refine()`.
Seed a first-run default row (matching today's hardcoded bounds exactly,
so nothing changes in practice until an admin edits it) via a migration or
an idempotent "ensure default row exists" read-path check — no interactive
migration prompt, consistent with this project's additive-migration
convention (see `context/foundation/lessons.md`'s NOT NULL/default lesson).

#### 2. Admin settings router + range-aware validation

**File**: `src/server/api/routers/simulation.ts` (or a new
`src/server/api/routers/admin.ts`, implementer's call based on which reads
more naturally — `adminSettings` isn't simulation-specific scope creep
either way since it only governs simulation parameters today)

**Intent**: Let an admin read/update the ranges; let every `start`/
`startServer` call validate against them instead of hardcoded bounds —
this is the first real usage of `adminProcedure` anywhere in the codebase.

**Contract**:
- `getParameterRanges: protectedProcedure.query(...)` — consistent with
  every other procedure in this router (none are `publicProcedure` today);
  `/simulation` already requires login to reach, so nothing is lost by
  keeping this behind the same gate. Returns the current `adminSettings`
  row, seeding the default row on first read if none exists.
- `updateParameterRanges: adminProcedure.input(...).mutation(...)` —
  upserts the singleton row. Validate each range's `min <= default <= max`
  server-side before writing.
- `insertRunningSimulation` (the shared helper both `start`/`startServer`
  call) gains a runtime range check: after the existing static zod
  sanity-type validation, read `adminSettings` **via the `db` parameter
  already threaded through this function** (see `lessons.md`'s ctx.db-
  vs-singleton entry — this function must keep taking `db` explicitly, not
  read the module-level singleton, to preserve `simulation.test.ts`'s
  existing sabotaging-Proxy race test) and reject (`BAD_REQUEST`) any
  input field outside its configured `[min, max]`, and replace the
  hardcoded `500` combined-cap check with `adminSettings.maxObjectCount`.

#### 3. Admin settings page

**File**: `src/app/admin/settings/page.tsx` (new)

**Intent**: Let an admin see and edit the ranges — the first UI consumer
of `adminProcedure`'s gate, so this page itself must redirect/403 a
non-admin member (mirror `protectedProcedure`'s existing redirect pattern
used by `/simulation`, extended with the role check).

**Contract**: One form, one row per tunable parameter (min/max/default
inputs), submitting `updateParameterRanges`. Reuses existing `Input`/
`Button` components and token classes — no new design system work.

#### 4. Member-facing form reads admin-configured bounds

**File**: `src/app/simulation/page.tsx`

**Intent**: Stop hardcoding `MAX_BOID_COUNT = 500` and the other inline
bounds; show the admin's actual configured ranges.

**Contract**: `api.simulation.getParameterRanges.useQuery()` replaces the
hardcoded `MAX_BOID_COUNT` constant and the inline numeric literals in
each `<Input max={...} min={...}>` and in `buildStartInput()`'s clamping —
clamp against the fetched ranges' `min`/`max` (falling back to sane
defaults while the query is loading, so the form isn't broken on first
paint).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- As an admin, change a parameter's max value lower than the current
  default on `/simulation`'s form; confirm the member form's input now
  rejects/clamps to the new bound and `start`/`startServer` reject a
  request exceeding it.
- As a non-admin member, confirm `/admin/settings` redirects/403s.

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Phase 3: Resource management, real genetic diversity, population-lifecycle phases, new `computeScore`

### Overview

Rewrite the scoring pipeline inside the one shared tick core
(`computeSingleRunTick`) to track everything the four-factor formula
needs, fix the genetic-diversity mislabeling, and classify the
population's lifecycle phase tick-by-tick.

### Changes Required:

#### 1. Expose `foodAvailabilityRatio` from `runTick`

**File**: `src/server/simulation/boids.ts`

**Intent**: Stop discarding the one value "resource management" scoring
needs — `runTick` already computes it, just doesn't return it.

**Contract**: Add `foodAvailabilityRatio: number` to `runTick`'s return
object (alongside `boids`/`predators`/`foodStock`/`populationCapped`) —
the exact value already computed at lines 1011-1014, no new computation.

#### 2. Real genetic-diversity metric

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace `computeCohesion` as the scoring input for "genetic
diversity" with a metric that actually reads gene values — correctness
fix, decided 2026-11-14 (see `research.md` Finding 4). `computeCohesion`
itself is unchanged and keeps whatever non-scoring role it has (if any)
elsewhere — confirm during implementation whether anything besides the
old `computeScore` call site used it for scoring purposes, and leave any
other caller untouched.

**Contract**: `export function computeGeneticDiversity(boids: BoidState[]): number`
<!-- impl-review (full-score-save-resume, F3): implemented as
`computeGeneticDiversity(genes: BoidGenes[]): number` instead — diversity
only ever reads `.genes`, and taking genes directly is the minimal payload
shape the client-staged path can send over `stop`'s wire input
(`survivingBoidGenes`), rather than the full `BoidState[]`. Deliberate,
consistently propagated to every call site; recorded here since it
deviates from this section's original contract text. -->
— computes the coefficient of variation (stddev / mean, or an equivalent
bounded normalization — implementer's call on the exact formula, document
whichever is chosen) across each heritable numeric gene field
(`separationWeight`, `alignmentWeight`, `cohesionWeight`, `maxSpeed`,
`minSpeed`, `maxLifespan`, `matePreference`, and the three color channels),
then averages across fields into a single value, clamped to `[0, 1]`.
Returns `0` for an empty population (no survivors — no diversity to speak
of, matching `computeCohesion`'s existing zero-population convention of
returning a neutral extreme rather than `NaN`).

#### 3. Population-lifecycle phase classifier

**File**: `src/server/simulation/boids.ts` (or a new sibling module,
`src/server/simulation/population-phase.ts`, if the implementer judges
`boids.ts` is already large enough that a new cross-cutting concern reads
cleaner split out — either is acceptable, no strong reason to force one)

**Intent**: Classify the boid population's current phase
(establishment/growth/overshoot/crash/recovery) from a short rolling
window of recent population-count and food-availability-ratio samples —
the ecological model resolved in the PRD (boom-bust/irruptive-growth, not
logistic growth) and grounded in `research.md`.

**Contract**:
```ts
export type PopulationPhase = "establishment" | "growth" | "overshoot" | "crash" | "recovery";

export function classifyPopulationPhase(
	history: { populationCount: number; foodAvailabilityRatio: number }[],
	previousPhase: PopulationPhase | null,
): PopulationPhase
```
Implementer's call on the exact window size and thresholds (document
whichever chosen, e.g. a 20-sample window, a ±10% population-trend
threshold, a 0.3 food-ratio overshoot threshold) — the product rule this
must satisfy: fewer than the window's worth of samples (or no prior
samples) → `"establishment"`; rising population with high food ratio →
`"growth"`; elevated/rising population with low food ratio → `"overshoot"`;
sharply falling population with low food ratio → `"crash"`; population
stabilizing/rising again with recovering food ratio AND `previousPhase`
was `"crash"` → `"recovery"` (recovery is only reachable from crash — a
rising population that was never in crash is just `"growth"`).

#### 4. Thread phase history + food-ratio samples through the shared tick core

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Make both the client-staged and server-owned paths
automatically track what the new scoring factors need, by extending the
one function both already call unmodified.

**Contract**: `computeSingleRunTick`'s `state` parameter and return value
gain `foodRatioSamples: number[]` (append `runTick`'s new
`foodAvailabilityRatio` each tick, same append-only pattern
`cohesionSamples` already uses) and `phaseHistory: PopulationPhase[]`
(append `classifyPopulationPhase(...)`'s result each tick, fed by a
rolling window derived from a parallel `populationCountSamples: number[]`
— implementer's call whether to store raw counts or pre-windowed tuples,
whichever composes more simply with `classifyPopulationPhase`'s contract
above). `classifyPopulationPhase`'s `previousPhase` argument is simply
`phaseHistory.at(-1) ?? null` — no separate field needed; `phaseHistory`
being append-only already carries everything the crash-only-reachable-via-
recovery rule needs. `cohesionSamples` itself is unchanged (still
computed, no longer fed into scoring — see Phase 3 item 2).

#### 5. New four-factor `computeScore`, and threading it across the client/server trust boundary

**File**: `src/server/simulation/boids.ts`

**Intent**: Replace the 2-argument placeholder with the real formula the
PRD now specifies, as three small pure helpers plus a combinator — kept
separate (not one function taking raw arrays) specifically so both the
server-owned path (which has live state locally) and the client-staged
path (which must send its signals over the wire to the `stop` mutation,
same trust boundary `cohesionSamples` already crosses today) can compute
each factor from whatever state they hold, without duplicating logic.

**Contract**:
```ts
export function computeResourceManagement(foodRatioSamples: number[]): number
export function computeGeneticDiversity(boids: BoidState[]): number
export function computePhaseQuality(phaseHistory: PopulationPhase[]): number
export function computeScore(
	elapsedTicks: number,
	resourceManagement: number,
	geneticDiversity: number,
	phaseQuality: number,
): number
```
`computeScore` is a plain product of its four arguments (`elapsedTicks *
resourceManagement * geneticDiversity * phaseQuality`) — no array handling
of its own, so it's identically callable from both paths below.
`computeResourceManagement` averages `foodRatioSamples` (empty → `0`).
`computePhaseQuality` is the time-weighted per-phase-quality average ×
resilience bonus described under item 3/4 above (exact weights/bonus
magnitude are the implementer's documented tuning call).

**Call-site wiring (both required, this is where the real risk is):**
- **Server-owned path** (`server-run-registry.ts`'s `finishRun`): already
  holds `foodRatioSamples`, `boids`, `phaseHistory` locally (Phase 3 item
  4) — calls all three `compute*` helpers directly, then `computeScore`,
  entirely server-side. No wire format change needed here.
- **Client-staged path** (`simulation.ts`'s `stop` mutation,
  `simulation-canvas.tsx`'s caller): `stop`'s zod input schema must grow
  — alongside the existing `elapsedTicks`/`cohesionSamples` — with
  `foodRatioSamples: z.array(z.number().min(0).max(1)).min(1).max(50_000)`
  (same bound shape `cohesionSamples` already uses) and
  `phaseHistory: z.array(z.enum([...PopulationPhase values]))`. The client
  (`simulation-canvas.tsx`) must import and call the same
  `computeGeneticDiversity`/`computePhaseQuality` helpers itself (they're
  pure functions in an already-isomorphic module — `boids.ts` is already
  imported client-side today) and send **either** the raw
  `foodRatioSamples`/`phaseHistory` arrays (server re-derives the other two
  factors, matching today's trust posture where the client sends raw
  signals and the server computes the score) **or** the client's own
  already-computed `geneticDiversity`/`phaseQuality` numbers directly —
  implementer's call on which, but pick one and apply it consistently;
  don't mix "client computes some factors, server re-derives others from
  partial raw data" in a way that leaves a gap. `cohesionSamples` itself
  keeps being sent (unused by scoring now, but removing it from the wire
  format is out of scope — not harmful to leave as dead input weight,
  cheaper than touching every existing caller of `stop` a second time for
  a cosmetic trim).

This is a breaking signature change from today's `(cohesionSamples,
elapsedTicks)` — every call site (`simulation.ts`'s `stop` resolver,
`server-run-registry.ts`'s `finishRun`/`stopServerRun`,
`simulation-canvas.tsx`'s `stop()` call) must be updated together.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Updated/new tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/single-run-lifecycle.test.ts src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- Run a simulation to completion (client-staged, to see it easily) with a
  small food stock relative to population, and confirm the score reflects
  a visibly different magnitude than before this phase (proving the new
  factors are actually multiplying in, not silently defaulting to 1).

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Phase 4: "Save & Pause" / "Resume" for server-owned runs

### Overview

Add exact-fidelity state persistence for server-owned runs only, using
Phase 1's RNG state exposure and Phase 3's new sample shapes.

### Changes Required:

#### 1. `saved` status + snapshot column

**File**: `src/server/db/schema.ts`

**Intent**: Give a server-owned run a non-terminal, resumable paused state
distinct from `"stopped"`.

**Contract**: `simulationRuns.status` enum gains `"saved"` alongside
`"running"`/`"stopped"`. New nullable column `savedState: text(..., { mode: "json" })`
holding the full live-state snapshot: `boids`, `predators`, `foodStock`,
`cohesionSamples`, `foodRatioSamples`, `phaseHistory`,
`populationCountSamples` (or whatever Phase 3 item 4 settled on),
`elapsedSeconds`, `lastTimestamp`, `populationCapped`, `rngState`
(`Rng.getState()`'s return value).

#### 2. Registry snapshot/restore primitives

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Let the router pause a live run into a serializable snapshot,
and later reconstruct an identical `LiveRun` from one.

**Contract**:
- `snapshotServerRun(runId: number): <snapshot shape> | undefined` —
  clears the run's interval, removes it from the registry (same cleanup
  `stopServerRun` already does), and returns everything `savedState` needs
  to persist, including `rng.getState()`. `undefined` if `runId` isn't
  registered.
- `resumeServerRun(runId: number, snapshot: <snapshot shape>): void` —
  the `startServerRun` counterpart: builds a `LiveRun` directly from the
  snapshot's arrays/values (no `createInitialPopulation`/
  `createInitialPredators` call — resume reconstructs, never
  re-generates), restores the RNG via `createRng(snapshot.seed)` then
  `rng.setState(snapshot.rngState)`, and registers a fresh `setInterval`
  exactly as `startServerRun` does.

#### 3. `savePause` / `resume` procedures

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Expose the new action pair, ownership-checked the same way
`stop`/`watch` already are.

**Contract**:
- `savePause: protectedProcedure.input(z.object({ runId: z.number() })).mutation(...)` —
  same ownership + `isServerRunActive` checks `watchServerRun` already
  establishes the pattern for, then calls `snapshotServerRun`, writes
  `status: "saved"`, `savedState: <snapshot>` to the row (no `score`, no
  `stoppedAt` — this is explicitly not a terminal state).
- `resume: protectedProcedure.input(z.object({ runId: z.number() })).mutation(...)` —
  ownership check + `status === "saved"` check, calls `resumeServerRun`
  with the row's `savedState`, writes `status: "running"` and clears
  `savedState` back to `null` (the live registry is now the source of
  truth again, same as any other running row).

#### 4. UI: "Save & Pause" / "Resume" actions

**File**: `src/app/simulation/page.tsx`

**Intent**: Expose the new flow without disturbing the existing
list/switch UI (S-08) or the staging canvas (untouched per "What We're NOT
Doing").

**Contract**: Add a "Save & Pause" button next to each row in the
existing running-runs list (from `listRunning`, S-08) calling the new
`savePause` mutation; add a `listSaved` query (mirroring `listRunning` but
filtering `status: "saved"`) and a small "Saved" section listing paused
runs with a "Resume" button each, calling `resume` and then behaving like
any freshly-started server run (addable to the existing `viewingRunId`
flow unchanged).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- Start a server run, let it tick for a few seconds, "Save & Pause" it,
  record its state (boid count, a sample position, food stock) via a DB
  read of `savedState`, "Resume" it, and confirm (via the registry's live
  state or another DB read shortly after) that ticking continued from
  exactly that state — not restarted, not a different population.
- Confirm the existing "Stop" button and the client-staged canvas are
  completely unaffected (same manual-check shape used throughout this
  session's prior slices).

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Testing Strategy

### Unit Tests:

- `rng.test.ts`: `getState`/`setState` round-trip — capture state mid-sequence, advance further, restore, confirm the next N outputs match a fresh `createRng` replayed to the same point.
- `boids.test.ts`: `computeGeneticDiversity` (oracle-derived: a population with identical genes → low/zero diversity; a population with maximally spread genes → high diversity — never mirroring the implementation's own variance formula as the expected value), `classifyPopulationPhase` (one case per phase, plus the crash-only-reachable-via-recovery rule), new `computeScore` signature (each factor's contribution independently verifiable by holding the other three constant).
- `single-run-lifecycle.test.ts`: `foodRatioSamples`/`phaseHistory` threading, updated for the new state/result shape.
- `server-run-registry.test.ts`: `snapshotServerRun`/`resumeServerRun` round-trip (start, tick, snapshot, resume into a fresh registry entry, confirm ticking continues with the same arrays/RNG sequence) — the actual proof of exact-fidelity resume, independent of any UI.
- `simulation.test.ts`: `getParameterRanges`/`updateParameterRanges` (admin-only enforcement, min≤default≤max validation), range-aware rejection in `start`/`startServer`, `savePause`/`resume` ownership + status-guard tests.

### Integration Tests:

- N/A beyond the `createCaller`-based tests above for plain mutations/queries; `watch`-shaped procedures (none added here) would need the `watchServerRun`-style plain-function pattern, but none of this phase's new procedures are subscriptions.

### Manual Testing Steps:

1. See each phase's Manual Verification above.

## Performance Considerations

`phaseHistory`/`foodRatioSamples`/`populationCountSamples` grow one entry
per tick, same unbounded-until-run-ends pattern `cohesionSamples` already
has — bounded in practice by `maxDurationSeconds ≤ 600` at ~60 ticks/sec,
within the same order of magnitude the existing `cohesionSamples` cap
(`stop`'s `.max(50_000)` zod bound) already tolerates. `savedState`'s JSON
blob size scales with population size (≤500 per FR-018) and elapsed
ticks' sample arrays — acceptable for this project's declared small scale;
revisit only if a future phase needs much longer runs or much larger
populations.

## Migration Notes

- `adminSettings`: new table, additive — no existing data affected. Seed a
  default row matching today's hardcoded bounds on first read, not via an
  interactive migration default-value prompt (same NOT NULL/default
  lesson `lessons.md` already records from S-03's migration).
- `simulationRuns.status`: adding `"saved"` to the enum is additive for
  SQLite (Drizzle enums are app-level, not DB-level CHECK constraints
  here — confirm during implementation that no DB-level constraint needs
  a migration beyond the Drizzle schema change itself).
- `simulationRuns.savedState`: new nullable column, additive, safe against
  existing rows (defaults to `null`).

## References

- Research: `context/changes/full-score-save-resume/research.md`
- Roadmap: `context/foundation/roadmap.md` S-04 (full-score-save-resume)
- PRD: `context/foundation/prd.md` v2 — FR-002, FR-010, FR-011, FR-012, FR-018, FR-019, Business Logic
- Shared tick core: `src/server/simulation/single-run-lifecycle.ts:18-111`
- Server-owned execution (F-03): `src/server/simulation/server-run-registry.ts`
- Existing `adminProcedure` (unused until now): `src/server/api/trpc.ts:164`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Expose RNG state without changing any existing call site

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — c3ba775
- [x] 1.2 Linting passes: `npm run check` — c3ba775
- [x] 1.3 Updated test passes: `npx vitest run src/server/simulation/rng.test.ts` — c3ba775
- [x] 1.4 Full suite still passes: `npm test` — c3ba775

### Phase 2: Admin-defined parameter ranges (FR-002 full, FR-018 full)

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 21b1bfd
- [x] 2.2 Linting passes: `npm run check` — 21b1bfd
- [x] 2.3 New/updated tests pass: `npx vitest run src/server/api/routers/simulation.test.ts` — 21b1bfd
- [x] 2.4 Full suite still passes: `npm test` — 21b1bfd

#### Manual

- [x] 2.5 Lowering a range as admin is reflected and enforced on the member form/API — 21b1bfd
- [x] 2.6 Non-admin member is redirected/403'd from `/admin/settings` — 21b1bfd

### Phase 3: Resource management, real genetic diversity, population-lifecycle phases, new computeScore

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 5b58e81
- [x] 3.2 Linting passes: `npm run check` — 5b58e81
- [x] 3.3 Updated/new tests pass: `npx vitest run src/server/simulation/boids.test.ts src/server/simulation/single-run-lifecycle.test.ts src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts` — 5b58e81
- [x] 3.4 Full suite still passes: `npm test` — 5b58e81

#### Manual

- [x] 3.5 Score magnitude visibly reflects the new factors on a real run — 5b58e81 (scarce-food server-run, 80 boids/food stock 5, scored 0.0101 over 20s vs. the old formula's hundreds-magnitude)

### Phase 4: "Save & Pause" / "Resume" for server-owned runs

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck` — ddb8297
- [x] 4.2 Linting passes: `npm run check` — ddb8297
- [x] 4.3 New/updated tests pass: `npx vitest run src/server/simulation/server-run-registry.test.ts src/server/api/routers/simulation.test.ts` — ddb8297
- [x] 4.4 Full suite still passes: `npm test` — ddb8297

#### Manual

- [x] 4.5 Save & Pause then Resume continues from exactly the saved state — ddb8297 (server run saved mid-tick at elapsedSeconds 11.26s/472 boids, resumed, re-saved later at elapsedSeconds 38.06s with the RNG state advanced — continuation, not a reset to the original 20-boid/elapsed-zero start; the unit-level round-trip test additionally proves bit-identical reproduction outcomes across a pause)
- [x] 4.6 Existing Stop action and client-staged canvas are unaffected — ddb8297 (neither `stop`'s resolver nor simulation-canvas.tsx was touched by this phase's diff; all of their existing tests still pass unchanged)
