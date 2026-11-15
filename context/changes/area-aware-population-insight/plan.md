# Implementation Plan: Area-aware population insight (5th score factor)

## Overview

Every run's score is today a strict product of four factors —
`elapsedTicks * resourceManagement * geneticDiversity * phaseQuality`
(`computeScore`, `src/server/simulation/boids.ts:1425`). S-24 made the
simulation's spatial extent (`xyArea` × `xyArea` × `zDepth`) a per-run
configurable parameter, but nothing in scoring or analysis reflects whether a
run's population actually thrived at the area it was given — a user could
double the area, watch the population thin out accordingly, and the score
would never show that the extra room didn't pay off. This plan adds a 5th
factor — **area population density** — a time-averaged ratio of each tick's
combined population (boids + predators) relative to the run's own starting
density over its full 3D volume, multiplied into the existing formula exactly
like every other factor. It then threads that signal through both execution
paths (server-owned and client-staged), persists it, surfaces it in the
run-comparison breakdown (with explicit `N/A` for runs that predate this
change), and adds a visible marker distinguishing runs scored under the old
4-factor formula from runs scored under the new 5-factor one — because this
is a scoring-formula change, not a cosmetic addition, with the exact
comparability risk the roadmap's own S-25 entry and S-09's prior precedent
both call out.

All product decisions below were resolved via a two-round user interview
(2026-11-15) and are fixed, not open for re-litigation during implementation:

1. **Formula shape**: time-averaged density ratio, same aggregation shape as
   `computeResourceManagement` — average a per-tick value over the whole run.
2. **Population scope**: combined boids + predators feed the density.
3. **Area dimension**: full 3D volume — `xyArea * xyArea * zDepth`.
4. **PRD handling**: amend FR-010 now, add a new FR for the 5th factor
   (mirrors FR-019's treatment of phase quality).
5. **UI scope**: show the factor in the run-comparison breakdown now, in this
   plan — not deferred.
6. **Backward compatibility**: old runs show their other 4 factors normally;
   the 5th factor renders as `N/A`/unavailable, not an all-or-nothing hide.
7. **Comparability**: add a visible marker distinguishing differently-scored
   runs (diverges from S-09's silent-precedent approach, by explicit user
   decision — the roadmap's own risk note flagged this specifically).
8. **Weighting**: strict multiplicative term, same philosophy as every other
   factor — no floor/clamp beyond what the formula already does.

## Current State Analysis

- `computeScore(elapsedTicks, resourceManagement, geneticDiversity, phaseQuality)`
  (`src/server/simulation/boids.ts:1425-1432`) is a plain 4-argument product.
  `computeResourceManagement(foodRatioSamples: number[]): number`
  (`boids.ts:1408-1416`) is the exact aggregation shape to mirror: flat
  average of a per-tick sample array, `0` on empty input.
- Per-tick sample arrays are collected in exactly one shared, DOM-free core —
  `computeSingleRunTick` (`src/server/simulation/single-run-lifecycle.ts:21-154`)
  — called identically by both execution paths:
  - **Client-staged**: `src/app/simulation/_components/simulation-canvas.tsx`.
    Per-tick arrays are `useRef`s (`cohesionSamplesRef` L313,
    `foodRatioSamplesRef` L316, `populationCountSamplesRef` L317,
    `phaseHistoryRef` L318), fed into `computeSingleRunTick`'s state object
    (L516-524) and written back from its result (L544-547) inside `tick()`'s
    try block (L509-559). `worldSize` (`{ x: xyArea, y: xyArea, z: zDepth }`,
    L304) is already in scope and already passed to `computeSingleRunTick`
    (L537). On stop, `buildStopInput()` (L436-460) sends every sample array
    to `simulation.stop`'s mutation input, each with a single-element
    fallback (`[0]` / `["establishment"]`) when empty (L440-459) — the exact
    pattern a new array must follow.
  - **Server-owned**: `src/server/simulation/server-run-registry.ts`. `LiveRun`
    (L55-69) holds the same sample arrays; `tick()` (L162-236) reads them from
    the registry, calls `computeSingleRunTick`, writes results back
    (L200-209), and on `shouldStop` calls `computeScore` (L212-217) and
    `finishRun` with a `history` object (L218-227). `stopServerRun` (L305-328)
    mirrors this for a manual stop. `startServerRun` (L238-297) seeds empty
    arrays; `snapshotServerRun`/`resumeServerRun` (ServerRunSnapshot type,
    L332-345) persist/restore them across pause/resume.
- `src/server/api/routers/simulation.ts`'s `stop` mutation (L334-477) is the
  client-staged path's terminus: its zod input schema (L335-391) accepts the
  same sample arrays raw (not pre-computed factors — "the server computes the
  score, same trust posture `cohesionSamples` already established"), calls
  `computeScore` (L430-435), and writes a `history` JSON blob (L449-459)
  structurally identical to `finishRun`'s server-owned shape.
- `getRunsComparison` (`simulation.ts:742-835`) recomputes a live 4-factor
  `breakdown` from each run's stored `history` JSON, guarded by checking
  `rawHistory.elapsedSeconds` is present (L805) — the one field that phase
  (`compare-runs-side-by-side`) newly added, so it's "the one field guaranteed
  absent on every row that predates this change" (L793). The other 3 factors
  (`resourceManagement`, `geneticDiversity`, `phaseQuality`) only need
  `foodRatioSamples`/`survivorGenes`/`phaseHistory`, which **do** exist on
  every row old enough to predate this plan — only the new 5th factor's input
  will be absent on those rows. This means the existing breakdown computation
  does not need an all-or-nothing rewrite — it needs one new field, computed
  conditionally.
- `src/app/runs/compare/page.tsx` renders `FACTOR_LABELS` (L17-22, currently 4
  keys) as both a table (L182-197) and a `BarChart` (`chartData`, L114-126) —
  both loop over `Object.keys(FACTOR_LABELS)` generically, so a 5th key is a
  small, mechanical addition to both, not a restructure.
- `src/app/leaderboard/page.tsx`'s `listLeaderboard` query
  (`simulation.ts:583-607`) selects `id, startedAt, boidCount, predatorCount,
  score, stoppedAt` — no `history` — so there is currently no way to tell,
  from this query alone, whether a given run was scored with 4 or 5 factors.
- `src/server/db/schema.ts`'s `simulationRuns.history` (L150) is a
  schema-less JSON `TEXT` column — no migration is needed to add a new array
  to it; the existing codebase convention (confirmed at `getRunsComparison`'s
  `elapsedSeconds` presence-check, L793-805, and `getRunAnalysis`'s guarded
  cast, L686-706) is to detect "does this old row have the newer field" by
  presence-checking the parsed JSON, not by a separate schema flag. This plan
  reuses that exact convention for both the backward-compat `N/A` (decision 6)
  and the comparability marker (decision 7) — presence/absence of the new
  `populationDensitySamples` array in stored `history` is the single source
  of truth for "was this run scored under the 5-factor formula," with no new
  DB column.
- `context/foundation/prd.md` FR-010 (v5, line 131) currently reads "iloczyn
  czterech czynników" (product of four factors); FR-019 (line 133) documents
  the phase-quality factor as the template for how a new FR documents one
  factor's own spec. The Business Logic section (line 224) also states "the
  **product of four factors**."
- `src/server/simulation/parameter-suggestion.ts` and `run-optimization-suggestion.ts`
  both consume `score` as a single generic number (confirmed in prior research
  for this change) — neither needs any change.

## What We're NOT Doing

- Not retroactively recomputing any already-scored run's stored `score` —
  forward-only, same precedent as S-09's phase-quality correction and F-05's
  own documented policy (PRD Open Question #4).
- Not changing `parameter-suggestion.ts`'s correlation heuristic or
  `run-optimization-suggestion.ts` — both consume the final `score` generically
  and need no change for a 5th factor to exist.
- Not adding a formula-version column to `simulationRuns` — presence/absence
  of `populationDensitySamples` in stored `history` is the detection
  mechanism (see Current State Analysis), consistent with this codebase's
  existing JSON-presence-check convention.
- Not changing `admin_settings.parameterRanges` or any admin-configurable
  range — area/depth are already configurable per S-24; this plan only adds a
  derived scoring signal from the area the user already chose.
- Not building a dedicated "formula version history" page or changelog — the
  comparability marker (Phase 3) is a small inline indicator, not a new
  surface.
- Not touching `camera.ts`, the minimap, or any rendering/viewport logic —
  this is a scoring and analysis change only.

## Implementation Approach

Mirror `computeResourceManagement`'s exact shape for the new factor, thread
one new per-tick sample array through the one shared tick core the same way
`foodRatioSamples` already is, and reuse this codebase's existing
JSON-presence-check convention for backward compatibility and the
comparability marker — no new abstractions, no schema migration.

### Changes Required:

## Phase 1: Formula, per-tick plumbing, and PRD amendment

### 1. New factor + formula signature

**File**: `src/server/simulation/boids.ts`

**Intent**: Add the 5th factor's aggregation function next to its
`computeResourceManagement`/`computePhaseQuality` siblings, and grow
`computeScore`'s signature.

**Contract**:
- Add, immediately after `computeResourceManagement` (after line 1416):
  ```ts
  export function computeAreaPopulationDensity(densitySamples: number[]): number {
    if (densitySamples.length === 0) {
      return 0;
    }
    const initialDensity = densitySamples[0];
    if (!initialDensity || initialDensity <= 0) {
      return 0;
    }
    const ratios = densitySamples.map((sample) => sample / initialDensity);
    return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  }
  ```
  Takes **raw** per-tick density samples (population ÷ volume, not
  pre-normalized) — normalization against the run's own first sample happens
  inside this function, once, not at every collection site. An empty array or
  a zero/undefined initial density (a run that started with zero combined
  population) returns `0`, matching every sibling `compute*` function's
  empty-input convention.
- Change `computeScore`'s signature (line 1425) to take a 5th parameter and
  multiply it in:
  ```ts
  export function computeScore(
    elapsedTicks: number,
    resourceManagement: number,
    geneticDiversity: number,
    phaseQuality: number,
    areaPopulationDensity: number,
  ): number {
    return (
      elapsedTicks *
      resourceManagement *
      geneticDiversity *
      phaseQuality *
      areaPopulationDensity
    );
  }
  ```

### 2. Per-tick raw density sampling in the shared tick core

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Compute one raw density sample per tick (combined population ÷
full 3D volume) and append it to a new array, exactly where
`foodRatioSamples`/`populationCountSamples` are already appended.

**Contract**: In `computeSingleRunTick`'s state parameter and return type
(lines ~26-33, ~61-67), add `populationDensitySamples: number[]`. Inside the
function body, after `nextPopulationCountSamples` is computed (around line
120-123), add:
```ts
const volume =
  params.worldSize.x * params.worldSize.y * params.worldSize.z;
const rawDensity =
  volume > 0 ? (nextBoids.length + nextPredators.length) / volume : 0;
const nextPopulationDensitySamples = [
  ...state.populationDensitySamples,
  rawDensity,
];
```
Include `populationDensitySamples: nextPopulationDensitySamples` in the
returned object (alongside the other sample arrays, ~line 141-153).

### 3. Thread the new array through the server-owned path

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Mirror every existing `foodRatioSamples` touch point with the new
array — field declaration, per-tick write-back, initial seed, score
computation, persisted history, and snapshot/resume.

**Contract**:
- `LiveRun` type (L55-69): add `populationDensitySamples: number[]`.
- `tick()` (L162-236): pass `run.populationDensitySamples` into
  `computeSingleRunTick`'s state object; write back
  `run.populationDensitySamples = result.populationDensitySamples` alongside
  the other write-backs (near L204-206); pass
  `computeAreaPopulationDensity(run.populationDensitySamples)` as
  `computeScore`'s 5th argument in the `shouldStop` branch (near L212-217);
  include `populationDensitySamples: run.populationDensitySamples` in the
  `history` object passed to `finishRun` (near L218-227).
- `finishRun`'s `outcome.history` type (L109-128): add
  `populationDensitySamples: number[]`.
- `stopServerRun` (L305-328): same `computeScore` 5th-argument addition and
  `history` field addition as `tick()`'s `shouldStop` branch, mirroring
  `foodRatioSamples` exactly.
- `startServerRun` (L238-297): seed `populationDensitySamples: []` in the new
  `LiveRun` object.
- `ServerRunSnapshot` type (L332-345): add `populationDensitySamples: number[]`.
- `snapshotServerRun` (L351-374) / `resumeServerRun` (L380-413): carry
  `populationDensitySamples` through, same as `foodRatioSamples`.

### 4. Thread the new array through the client-staged path

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Add a new `useRef` sample array, feed it into
`computeSingleRunTick`, write it back each tick, and send it on stop —
mirroring `foodRatioSamplesRef` exactly.

**Contract**:
- Add `const populationDensitySamplesRef = useRef<number[]>([]);` alongside
  L313-318.
- In `tick()`'s call to `computeSingleRunTick` (L514-539), add
  `populationDensitySamples: populationDensitySamplesRef.current` to the
  state object; after the call, add
  `populationDensitySamplesRef.current = result.populationDensitySamples;`
  alongside L544-547.
- In `buildStopInput()` (L436-460), add a `populationDensitySamples` field
  using the identical empty-array fallback pattern as `foodRatioSamples`:
  ```ts
  populationDensitySamples:
    populationDensitySamplesRef.current.length > 0
      ? populationDensitySamplesRef.current
      : [0],
  ```

### 5. `stop` mutation: accept, score, and persist the new signal

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The client-staged terminus for the new array — validate it,
feed it into `computeScore`, and persist it in `history` exactly like its
3 siblings.

**Contract**:
- `stop`'s input zod schema (L334-391): add
  `populationDensitySamples: z.array(z.number().min(0)).min(1).max(50_000),`
  immediately after `populationCountSamples` (after L390) — same bound
  posture as every sibling sample-array field.
- `computeScore` call (L430-435): add
  `computeAreaPopulationDensity(input.populationDensitySamples)` as the 5th
  argument (import `computeAreaPopulationDensity` alongside the other
  `~/server/simulation/boids` imports at the top of the file).
- `history` object (L449-459): add
  `populationDensitySamples: input.populationDensitySamples,`.

### 6. PRD amendment

**File**: `context/foundation/prd.md`

**Intent**: Amend FR-010 to describe 5 factors instead of 4; add a new FR
documenting the area-population-density factor's own spec, mirroring how
FR-019 documents phase quality; update the Business Logic section's "product
of four factors" language.

**Contract**:
- FR-010 (line 131): change "jako iloczyn czterech czynników" to "jako
  iloczyn pięciu czynników", and list the 5th factor (gęstość populacji
  względem obszaru / area-relative population density) alongside the
  existing four. Add a `> Socratic:` follow-up note dated 2026-11-15
  referencing roadmap S-25 and the comparability concern, mirroring the
  existing note's style.
- Add a new FR immediately after FR-019 (next available number — FR-035,
  since FR-030-034 already exist from the 2026-11-14 extension round):
  documents that the 5th factor is a time-averaged ratio of each tick's
  combined boid+predator population to the run's own starting density over
  the run's full configured 3D volume (`xyArea * xyArea * zDepth`), rewarding
  runs whose population density held up relative to where it started, not an
  absolute population-size target. Priority: must-have. Include a
  `> Socratic:` note naming the exact scope decisions already resolved
  (combined population, full 3D volume, strict multiplicative term) so a
  future reader doesn't re-litigate them.
- Business Logic section (line 224): change "the **product of four factors**"
  to "the **product of five factors**" and add the new factor to the
  enumerated list.

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/simulation/boids.test.ts` — includes new
      tests for `computeAreaPopulationDensity` (empty array → 0; constant
      density → 1.0 average; declining density → average strictly below 1.0;
      zero/undefined initial sample → 0) and an updated `computeScore` test
      covering the 5-argument signature.
- [ ] `npx vitest run src/server/simulation/single-run-lifecycle.test.ts` —
      includes a new assertion that `populationDensitySamples` grows by one
      raw-density value per tick, using the tick's `worldSize`.
- [ ] `npx vitest run src/server/simulation/server-run-registry.test.ts` —
      updated to cover `populationDensitySamples` surviving a snapshot/resume
      round-trip and appearing in the persisted `history` on both natural
      completion and manual stop.
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — updated
      `stop` tests cover the new input field, its effect on the computed
      score, and its presence in persisted `history`.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Start a client-staged run with a small, fixed area; let it run to
      completion; confirm the score differs from what the pre-change 4-factor
      formula would have produced for the same observed run (sanity check,
      not a regression test — the formula is intentionally different now).
- [ ] Read back the amended FR-010 / new FR / Business Logic paragraph in
      `context/foundation/prd.md` and confirm they read coherently with the
      rest of the document (no dangling "four factors" references left).

## Phase 2: Run-comparison backward-compatible breakdown

### 1. `getRunsComparison`: conditional 5th factor

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Add `areaPopulationDensity` to the comparison breakdown, computed
only when the stored history has the new sample array — `null` otherwise,
which the frontend renders as `N/A`. The other 4 factors are unaffected and
continue to compute from fields that exist on every historical row.

**Contract**: In `getRunsComparison` (L742-835):
- Widen the `breakdown` type (L762-767) to
  `{ survival: number; resourceManagement: number; geneticDiversity: number; phaseQuality: number; areaPopulationDensity: number | null } | null`.
- Widen the `rawHistory` cast (L794-799) to include an optional
  `populationDensitySamples?: number[]`.
- In the `breakdown` construction (L801-816), add:
  ```ts
  areaPopulationDensity: Array.isArray(rawHistory.populationDensitySamples)
    ? computeAreaPopulationDensity(rawHistory.populationDensitySamples)
    : null,
  ```
  The existing `breakdown`-is-`null` guard (requiring `phaseHistory`,
  `survivorGenes`, and `elapsedSeconds`) is unchanged — it already correctly
  gates the other 4 factors; this field is the only one independently gated.

### 2. Run-comparison page: render the 5th factor, N/A for old runs

**File**: `src/app/runs/compare/page.tsx`

**Intent**: Add the new factor to the table and chart exactly like the
existing 4, with an explicit `N/A` (not a blank or a crash) when a run's
breakdown value is `null`.

**Contract**:
- `FACTOR_LABELS` (L17-22): add `areaPopulationDensity: "Area population density",`.
- `OkRow.breakdown` type (L57-62): add `areaPopulationDensity: number | null;`.
- Table body (L182-197): the existing `row.breakdown ? row.breakdown[factor].toFixed(2) : "—"`
  cell needs a second guard — when `row.breakdown` exists but
  `row.breakdown[factor]` is specifically `null` (only possible for
  `areaPopulationDensity`), render `"N/A"` instead of calling `.toFixed(2)` on
  `null`:
  ```tsx
  {row.breakdown
    ? row.breakdown[factor] === null
      ? "N/A"
      : row.breakdown[factor].toFixed(2)
    : "—"}
  ```
- `chartData` construction (L114-126): guard the same way — only set
  `point[`Run #${row.runId}`]` when `row.breakdown[factor]` is not `null`, so
  a missing value doesn't render as a `0`-height bar (which would misread as
  "this run had zero density health" rather than "data unavailable"):
  ```ts
  if (row.breakdown && row.breakdown[factor] !== null) {
    point[`Run #${row.runId}`] = row.breakdown[factor];
  }
  ```

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — new
      `getRunsComparison` tests: a run with `populationDensitySamples`
      present returns a numeric `areaPopulationDensity`; a run predating this
      change (no `populationDensitySamples` in stored `history`) returns
      `areaPopulationDensity: null` while its other 4 factors still compute
      normally.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Compare two completed runs in the browser at `/runs/compare?ids=...`
      where at least one predates this change: confirm the table shows
      `N/A` for that run's "Area population density" row (not a blank cell,
      not a crash) while its other 4 factors render normally, and confirm
      the bar chart omits a bar for that run on that factor rather than
      drawing a zero-height one.
- [ ] Compare two runs that both post-date this change: confirm both show a
      real numeric value for the new factor in both the table and the chart.

## Phase 3: Comparability marker

### 1. Leaderboard: detect and expose formula version

**File**: `src/server/api/routers/simulation.ts`

**Intent**: `listLeaderboard` needs enough information to tell the frontend
whether a given run was scored under the old 4-factor formula or the new
5-factor one — reusing the same presence-check convention as Phase 2, not a
new schema column.

**Contract**: In `listLeaderboard` (L583-607), add `history` to the
`.select(...)` projection, then map the raw rows to derive a boolean and
avoid leaking the raw JSON blob into the response shape:
```ts
const rows = await ctx.db
  .select({
    id: simulationRuns.id,
    startedAt: simulationRuns.startedAt,
    boidCount: simulationRuns.boidCount,
    predatorCount: simulationRuns.predatorCount,
    score: simulationRuns.score,
    stoppedAt: simulationRuns.stoppedAt,
    history: simulationRuns.history,
  })
  .from(simulationRuns)
  .where(/* unchanged */)
  .orderBy(/* unchanged */)
  .limit(50);

return rows.map(({ history, ...row }) => ({
  ...row,
  scoredWithAreaFactor: Array.isArray(
    (history as { populationDensitySamples?: unknown } | null)
      ?.populationDensitySamples,
  ),
}));
```

### 2. Leaderboard page: render the marker

**File**: `src/app/leaderboard/page.tsx`

**Intent**: A small, inline visual distinction for runs scored under the old
4-factor formula — not a redesign, not a separate page.

**Contract**: In the run row rendering (L45-73), when
`!run.scoredWithAreaFactor`, render a small inline tag (reuse this page's
existing `Button`-adjacent inline-pill styling conventions, e.g. a `<span>`
with a muted-background rounded-full badge) reading `"4-factor score"` next
to the score, so a 5-factor run has no badge (the new default, unmarked) and
an old run is visibly flagged as scored under the prior formula. No tooltip
library exists in this codebase yet — a plain `title` attribute on the badge
(native browser tooltip) is sufficient; do not introduce a new tooltip
component for this one marker.

### 3. Run-comparison page: per-row comparability note

**File**: `src/app/runs/compare/page.tsx`

**Intent**: The same marker, reusing Phase 2's already-present
`areaPopulationDensity === null` signal — a run with a `null` 5th factor is,
by construction, a run scored before this change, so no separate flag is
needed here (unlike the leaderboard, which doesn't otherwise fetch
`history`).

**Contract**: Near the existing errored-row notices (L132-136), add one line
per `okRow` whose `breakdown?.areaPopulationDensity === null`:
```tsx
{okRows
  .filter((row) => row.breakdown?.areaPopulationDensity === null)
  .map((row) => (
    <p className="text-foreground/70 text-sm" key={`legacy-${row.runId}`}>
      Run #{row.runId} was scored before the area-population-density factor
      existed — its score and this run's other runs may not be directly
      comparable.
    </p>
  ))}
```

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — new
      `listLeaderboard` tests: a run with `populationDensitySamples` in
      history returns `scoredWithAreaFactor: true`; a run without it (or with
      `history: null`) returns `scoredWithAreaFactor: false`; the raw
      `history` blob itself is not present in the returned shape.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] View the leaderboard in the browser with at least one run scored before
      this change and at least one scored after: confirm the old run shows
      the "4-factor score" badge and the new run does not.
- [ ] View the run-comparison page for a pairing that includes a pre-change
      run: confirm the comparability note renders below the errored-row
      notices (if any) and reads coherently.

## Performance Considerations

One new `number[]` per run, appended to once per tick — identical cost shape
to the existing `foodRatioSamples`/`populationCountSamples` arrays already
tracked per run; no new O(n²) work, no new DB write pattern (same JSON blob
column, one new key). `listLeaderboard` now selects `history` (previously
excluded) for up to 50 rows — a bounded, already-precedented read (the same
column `getRunAnalysis`/`getRunsComparison` already read per-row), not a new
unbounded query.

## Migration Notes

None — `simulationRuns.history` is a schema-less JSON `TEXT` column; no
`drizzle-kit` migration is needed to add a new key to it. Existing rows
simply lack `populationDensitySamples`, which Phase 2/3's presence checks
treat as "scored under the old formula" by design.

## References

- Roadmap: `context/foundation/roadmap.md` S-25 (`area-aware-population-insight`), MS-03; `context/foundation/roadmap.md` S-24 (prerequisite, done)
- PRD: `context/foundation/prd.md` v5 — FR-010, FR-019 (phase-quality precedent for how a new FR documents one factor)
- Precedent for scoring-formula-change care: `context/archive/2026-11-14-phase-quality-per-cycle-scoring/plan.md` (S-09)
- Change notes: `context/changes/area-aware-population-insight/change.md`
- Shared tick core: `src/server/simulation/single-run-lifecycle.ts`
- Call sites: `src/server/simulation/server-run-registry.ts`, `src/server/api/routers/simulation.ts`, `src/app/simulation/_components/simulation-canvas.tsx`, `src/app/runs/compare/page.tsx`, `src/app/leaderboard/page.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Formula, per-tick plumbing, and PRD amendment

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 7819066
- [x] 1.2 Linting passes: `npm run check` — 7819066
- [x] 1.3 `npx vitest run src/server/simulation/boids.test.ts` — 7819066
- [x] 1.4 `npx vitest run src/server/simulation/single-run-lifecycle.test.ts` — 7819066
- [x] 1.5 `npx vitest run src/server/simulation/server-run-registry.test.ts` — 7819066
- [x] 1.6 `npx vitest run src/server/api/routers/simulation.test.ts` — 7819066
- [x] 1.7 Full suite passes: `npm test` — 7819066

#### Manual

- [x] 1.8 Client-staged run score sanity check against the new formula — 7819066
- [x] 1.9 PRD amendment reads coherently (no dangling "four factors") — 7819066

### Phase 2: Run-comparison backward-compatible breakdown

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 2a7312f
- [x] 2.2 Linting passes: `npm run check` — 2a7312f
- [x] 2.3 `npx vitest run src/server/api/routers/simulation.test.ts` — 2a7312f
- [x] 2.4 Full suite passes: `npm test` — 2a7312f

#### Manual

- [x] 2.5 Comparison page shows N/A for a pre-change run's 5th factor — 66b44e8
- [x] 2.6 Comparison page shows real values for two post-change runs — 66b44e8

### Phase 3: Comparability marker

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — 0e137e2
- [x] 3.2 Linting passes: `npm run check` — 0e137e2
- [x] 3.3 `npx vitest run src/server/api/routers/simulation.test.ts` — 0e137e2
- [x] 3.4 Full suite passes: `npm test` — 0e137e2

#### Manual

- [x] 3.5 Leaderboard shows the "4-factor score" badge on the old run only
- [x] 3.6 Comparison page shows the comparability note for a pre-change run
