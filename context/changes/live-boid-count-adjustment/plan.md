# Live-adjust boid and predator count Implementation Plan

## Overview

Add live-adjust controls for both `boidCount` and `predatorCount` on a running server-owned simulation — step buttons (+10/-10) that mutate `run.boids`/`run.predators` directly, growing the population with new individuals spawned near the existing flock's centroid, or shrinking it by culling the lowest-energy individuals first. Scope expanded from the roadmap's boid-only framing to include predators too (user's explicit choice during planning) — the mechanism is structurally identical since `PredatorState` carries the same `energy`/`age` shape as `BoidState`.

## Current State Analysis

- `createInitialPopulation`/`createInitialPredators` (`src/server/simulation/boids.ts:319-364`, `:368-413`) are pure functions given an injected `rng: () => number` — no `Math.random()` calls. The run's `Rng` instance (`LiveRun.rng`, `server-run-registry.ts:79`) is long-lived and mutable; calling either generator again against the same instance mid-run continues its sequence rather than restarting it, so no new RNG plumbing is needed for growth.
- Both new-individual arrays spawn uniformly random across world bounds (`rng() * worldSize.{x,y,z}`, boids.ts:339-341/boids.ts:389-391) with zero clustering today — the "spawn clustered near existing population" decision requires new logic, not a parameter to an existing one.
- Culling precedent: `stepBoids`'s natural-death cull (`boids.ts:678-680`, `.filter((boid) => boid.lifespan > 0)`), `applyHunger`'s starvation cull (`boids.ts:964`), and `applyPredation`'s capture cull (`boids.ts:1025`, `.filter((boid) => !captured.has(boid))`) are all filter-based and never sort. The "lowest-energy-first" decision needs a new sort-then-slice step; `BoidState`/`PredatorState` both carry `energy: number` (boids.ts:39/62) and `age: number` (boids.ts:40/63) fields, no `birthTick`.
- `run.boids = result.boids` (`server-run-registry.ts:313`, same pattern for `run.predators` at line 314) is a plain mutable-property reassignment on the `LiveRun` object held in the module-level `registry` Map — the file's own documented safety invariant (`server-run-registry.ts:169-173`) is that a synchronous reassignment (no `await` between read and write) cannot interleave with the `tick()` `setInterval` callback in Node's single-threaded event loop. A new population-mutation function must preserve this: all registry reads/writes happen synchronously, with any `await` (e.g. an admin-settings DB fetch) completed beforehand, exactly like `updateRunParams`'s existing ordering (`simulation.ts:924-946` awaits first, `applyLiveParams` at line 947 runs synchronously).
- Per-tick sample arrays (`populationCountSamples`, `populationDensitySamples`, `cohesionSamples`, `foodRatioSamples`, `phaseHistory` — `server-run-registry.ts:83-100`) are one-sample-per-tick histories, not indexed by individual boid — a population-count change needs no resizing of these, only correct future samples (which happens automatically since they're computed fresh from `run.boids.length` each tick).
- `boidCount`/`predatorCount` already exist as fields on `ServerRunParams` (`server-run-registry.ts:36,41`) holding the *start-time* count — not currently kept in sync with the live array length during a run. Mirroring them on every live-adjust keeps `run.params` consistent for any future reader (snapshot/stop scoring already reads `run.boids.length` directly for scoring, not `run.params.boidCount`, so this mirroring is for consistency/display only, not a correctness dependency).
- `ParameterChangeEntry.field` is typed `keyof LiveAdjustableParams` (`server-run-registry.ts:72`) — too narrow for `"boidCount"`/`"predatorCount"`, which are not part of `LiveAdjustableParams`'s `Pick<ServerRunParams, ...>` (that Pick is reserved for scalar `run.params` patches; `boidCount`/`predatorCount` changes mutate arrays, not a `run.params` scalar, so they deliberately stay outside `LiveAdjustableParams`/`applyLiveParams` and get their own function).
- `PARAM_UPDATE_THROTTLE_MS`/`run.lastParamUpdateAt` (`server-run-registry.ts:158,183-191`) already gate `applyLiveParams`. Per this slice's own decision, the new population-mutation function shares this exact same throttle/field — a scalar-field Apply and a population step-button click compete for the same 500ms slot, which is intended, not a bug to fix.
- `boidCount`/`predatorCount` are already in `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES` (`parameter-ranges.ts:6,11,40,45` — `boidCount: {min:1,max:500,default:100}`, `predatorCount: {min:0,max:500,default:5}`), so `checkLiveParamRangesSoft` (`parameter-ranges.ts:80-97`) is already type-compatible with a `{boidCount: newCount}`-shaped patch — no changes needed to that function.
- `checkAgainstAdminRanges` (`simulation.ts:152-176`) is the *hard-block* per-run cap check used only by `start`/`startServer` (`input.boidCount + input.predatorCount > maxObjectCount` throws). Per this slice's decision (soft-warn, not hard-block, for live-adjust consistency with every other live field), this function is reused for its arithmetic shape only — a new soft-check is needed, not a call to this one.
- `assertWithinConcurrentObjectCeiling` (`simulation.ts:120-150`) is the cross-run hard-block check, but it sums *other runs'* counts from the DB's `simulationRuns.boidCount`/`predatorCount` columns, which only reflect each run's start-time count — a run whose population was live-adjusted (this slice, or a future one) would make that DB-sourced sum stale. A live-adjust soft-check for the cross-run cap must instead sum each other actively-ticking run's *live* count via the already-exported `getLiveRunState(runId)` (`server-run-registry.ts:132-151`, returns `{boids, predators, ...}`) for rows where `isServerRunActive(row.id)` is true — composing two already-exported functions, no new registry export needed.
- `server-run-viewer.tsx`'s existing live-edit panel (`LIVE_FIELDS`/`LiveFormValues`/`handleApplyLiveParams`, lines 33-52, 247-278) is a *batched, staged* flow: the user edits several fields, dirty-tracking defers the actual mutation until a shared "Apply" button is clicked. Population step-buttons are a different interaction shape — each click is a complete, self-contained action with no intermediate "typing" state, matching S-29's client-staged Switch precedent ("applies immediately on flip, no separate Apply button") rather than the scalar fields' stage-then-apply pattern.
- The subscription payload (`LiveRunSnapshot`, `server-run-registry.ts:121-130`) already includes the full `boids`/`predators` arrays — `server-run-viewer.tsx`'s `onData` handler (lines 399-417) already receives them every ~150ms. The live current count the UI needs (`boids.length`/`predators.length`) is already present in data the component already receives; no new snapshot field is needed.

## Desired End State

On a running server-owned simulation, the live-edit panel shows the current boid count and predator count, each with a `-10`/`+10` step button. Clicking `+10` generates 10 new individuals (of the clicked kind) clustered near the existing population's centroid, using the run's own continuing RNG and current flock/world parameters; clicking `-10` removes the 10 lowest-energy individuals of that kind. Both changes take effect immediately and are visible in the live view on the next tick (new boids rendered at their spawn position; removed boids disappear). A soft warning displays if the resulting count would exceed the admin's per-run `maxObjectCount` or the user's cross-run `maxConcurrentObjectCount` ceiling — the change still applies either way, mirroring every other live-adjust field's warn-and-apply UX. The population-mutation function shares the existing 500ms server-side throttle with the 6 scalar live-adjust fields.

### Key Discoveries:

- `PredatorState` has the exact same `energy`/`age` shape as `BoidState` (boids.ts:53-65 vs. 30-42), so the growth/cull mechanism is literally parameterizable over "boid" vs. "predator" rather than needing two parallel implementations.
- `getLiveRunState` + `isServerRunActive`, both already exported, are sufficient to build the cross-run live-count soft-check without exposing the module-private `registry` Map itself.
- Because `run.boids`/`run.predators` are read fresh every tick and the sample arrays are computed fresh per tick from their current length, a population-count change needs zero changes to the tick loop itself (`tick()`, `server-run-registry.ts:274-353`) — only to functions that run *outside* it, synchronously, exactly like `applyLiveParams` already does.

## What We're NOT Doing

- Not touching `flockCount` or `flockId` assignment for new individuals beyond the existing even-split-across-flocks logic (`splitCountAcrossFlocks`, boids.ts:307-313) that `createInitialPopulation`/`createInitialPredators` already use — new individuals from a single growth click are split across the run's existing flocks the same way the initial population was.
- Not adding a floor above 0 for a live decrease — the simulation already tolerates population collapse via natural death/predation; this mutation path follows the same rule, per this slice's own decision.
- Not persisting the live-adjusted count to the DB `simulationRuns.boidCount`/`predatorCount` columns mid-run — exactly like the 6 existing scalar live-adjust fields, which only mutate `run.params` in-memory and are never written to DB until `stop`/snapshot. The cross-run soft-check compensates for this by reading live counts via `getLiveRunState`, not the DB columns, for any run that might have been live-adjusted.
- Not giving the population mutation its own throttle constant — it shares `PARAM_UPDATE_THROTTLE_MS` with the 6 scalar fields, per this slice's own decision.
- Not adding a symmetric control for `flockCount` — explicitly parked at the roadmap level (`flockId` is set once at birth and never re-derived per tick; a live change would require rewriting it across the whole population, a different and riskier operation this slice doesn't cover).
- Not adding free-form target-count input — only the fixed ±10 step buttons, per this slice's own decision.

## Implementation Approach

Three phases: (1) the shared growth/cull mechanism in the registry (parameterized over boid vs. predator), (2) the router procedure with both soft-cap checks, (3) the panel UI's step buttons. Each phase is independently testable and committable, mirroring S-27/S-29's own phase shape.

## Phase 1: Shared population-mutation mechanism

### Overview

Add a registry-level function that grows or shrinks `run.boids`/`run.predators` by a signed delta, parameterized over which array it targets, sharing the existing throttle and changelog machinery.

### Changes Required:

#### 1. Widen `ParameterChangeEntry.field`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Let the changelog record a population-count change alongside the 6 existing scalar fields, without touching `LiveAdjustableParams`/`applyLiveParams`'s own types.

**Contract**: Change `ParameterChangeEntry.field` (line 72) from `keyof LiveAdjustableParams` to `keyof LiveAdjustableParams | "boidCount" | "predatorCount"`.

#### 2. `adjustLivePopulation`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The single place that grows or shrinks a run's live `boids` or `predators` array, sharing `applyLiveParams`'s throttle/changelog pattern. Exported so the router procedure can call it and so tests can call it directly (same testable-core pattern as `applyLiveParams`/`watchServerRun`).

**Contract**: `export function adjustLivePopulation(runId: number, kind: "boid" | "predator", delta: number): ApplyLiveParamsResult` (reuse the existing `ApplyLiveParamsResult` union — `{status:"applied"}` / `{status:"not-found"}` / `{status:"throttled"; retryAfterMs:number}` — this function doesn't need to return the new count since the caller already has the live snapshot). Shares `PARAM_UPDATE_THROTTLE_MS`/`run.lastParamUpdateAt` with `applyLiveParams` (same not-found/throttled checks, same `now`/`lastParamUpdateAt` update on success).

Growth (`delta > 0`): derive `maxLifespan`/`flockWeights`/`worldSize` from `run.params` exactly as `startServerRun` does (server-run-registry.ts:365-380), call `createInitialPopulation(delta, run.rng, maxLifespan, run.params.flockCount, flockWeights, worldSize)` (or `createInitialPredators` for `kind === "predator"`) to generate `delta` new individuals, then cluster them: compute the centroid of the *current* array's x/y/z (or world center if the array is currently empty), and for each generated individual, move its position halfway from its generated (uniform-random) position toward that centroid —

```ts
const centroid = current.length > 0
	? {
			x: current.reduce((s, b) => s + b.x, 0) / current.length,
			y: current.reduce((s, b) => s + b.y, 0) / current.length,
			z: current.reduce((s, b) => s + b.z, 0) / current.length,
		}
	: { x: worldSize.x / 2, y: worldSize.y / 2, z: worldSize.z / 2 };
for (const individual of generated) {
	individual.x = (individual.x + centroid.x) / 2;
	individual.y = (individual.y + centroid.y) / 2;
	individual.z = (individual.z + centroid.z) / 2;
}
```

Append `generated` to the target array (`[...current, ...generated]`).

Shrink (`delta < 0`): `removeCount = Math.min(current.length, -delta)`; sort a *copy* of the current array by `energy` ascending, take the first `removeCount` as a `Set` of individuals to remove, then filter the real array — `current.filter((individual) => !toRemove.has(individual))`, the same filter-by-membership idiom `applyPredation` already uses.

Either branch: push one changelog entry (`field: kind === "boid" ? "boidCount" : "predatorCount"`, `oldValue: current.length`, `newValue: <post-mutation length>`, `tick: run.populationCountSamples.length`, matching `applyLiveParams`'s existing tick-sourcing), reassign `run.boids`/`run.predators` to the new array, mirror `run.params.boidCount`/`run.params.predatorCount` to the new length, and update `run.lastParamUpdateAt`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/server-run-registry.test.ts` — add tests confirming: (a) a positive delta appends exactly `delta` new boids (and separately, new predators) to the live array, each with `x`/`y`/`z` closer to the pre-growth centroid than a plain `createInitialPopulation` call would produce; (b) a negative delta removes exactly `|delta|` individuals, and the removed set is the lowest-`energy` individuals (not an arbitrary subset); (c) a changelog entry is appended with `field: "boidCount"`/`"predatorCount"` and correct `oldValue`/`newValue`; (d) `run.params.boidCount`/`predatorCount` is mirrored to the new array length after the call; (e) a second call within `PARAM_UPDATE_THROTTLE_MS` of a prior `applyLiveParams` OR `adjustLivePopulation` call on the same run returns `{status:"throttled"}` (confirms the shared-throttle decision); (f) a delta larger in magnitude than the current array length clamps to removing the whole array (resulting length 0), not a negative length or an exception.
- Full suite passes: `npm test`

#### Manual Verification:

- None for this phase in isolation — `adjustLivePopulation` has no caller yet; manual verification happens in Phase 3 once the full path is wired end-to-end.

## Phase 2: Router procedure & cap checks

### Overview

Add a tRPC mutation that validates ownership/active-run state, soft-checks both the per-run and cross-run object-count caps, and calls `adjustLivePopulation`.

### Changes Required:

#### 1. `adjustLivePopulation` mutation

**File**: `src/server/api/routers/simulation.ts`

**Intent**: The router-level entry point for a population step-button click, mirroring `updateRunParams`'s ownership/active-run check shape exactly.

**Contract**: `adjustLivePopulation: protectedProcedure.input(z.object({ runId: z.number(), field: z.enum(["boidCount", "predatorCount"]), delta: z.number().int() })).mutation(...)`. Body: same ownership check (`run.userId !== ctx.session.user.id` → `FORBIDDEN`) and active-run check (`run.status !== "running" || !isServerRunActive(runId)` → `BAD_REQUEST`) as `updateRunParams` (lines 930-938). Then: read the current live counts via `getLiveRunState(runId)` (already exported), compute `newCount = Math.max(0, current[field === "boidCount" ? "boids" : "predators"].length + input.delta)`, soft-check it against `DEFAULT_PARAMETER_RANGES`/admin-configured ranges via `checkLiveParamRangesSoft({ [input.field]: newCount }, parameterRanges)` (reuses the function unmodified — `boidCount`/`predatorCount` are already `RangedParameterName`s), then call the two new soft-check helpers below, concatenate all warnings, call `adjustLivePopulation(runId, input.field === "boidCount" ? "boid" : "predator", input.delta)`, and handle `not-found`/`throttled` exactly like `updateRunParams` does. Return `{ ok: true, warnings, newCount }`.

#### 2. Per-run cap soft-check

**File**: `src/server/api/routers/simulation.ts`

**Intent**: A soft (warn, don't block) counterpart to `checkAgainstAdminRanges`'s hard per-run cap check, reused for the live-adjust path only.

**Contract**: New function `checkPerRunObjectCapSoft(otherFieldCount: number, newCount: number, maxObjectCount: number): string | null` — returns a warning string (same message shape as `checkAgainstAdminRanges`'s existing one) if `otherFieldCount + newCount > maxObjectCount`, else `null`. Called with `otherFieldCount` being the *other* kind's current live count from the same `getLiveRunState` read (e.g. if adjusting `boidCount`, `otherFieldCount` is the current live `predators.length`).

#### 3. Cross-run cap soft-check

**File**: `src/server/api/routers/simulation.ts`

**Intent**: A soft counterpart to `assertWithinConcurrentObjectCeiling`, sourcing *other* runs' counts from their live registry state (via already-exported `getLiveRunState`/`isServerRunActive`) rather than the DB's start-time columns, so a prior live-adjust on another run doesn't make this check stale.

**Contract**: New async function `checkConcurrentObjectCapSoft(db, userId, thisRunNewTotal, excludeRunId, maxConcurrentObjectCount): Promise<string | null>` — same DB query shape as `assertWithinConcurrentObjectCeiling` (lines 127-139: select `id` for the user's `running` rows), but for each row where `id !== excludeRunId && isServerRunActive(row.id)`, sum `getLiveRunState(row.id)`'s `boids.length + predators.length` (falling back to the DB's `boidCount`/`predatorCount` columns only if `getLiveRunState` returns `undefined`, which shouldn't happen for a row `isServerRunActive` confirmed but guards a race). Returns a warning string (mirroring `assertWithinConcurrentObjectCeiling`'s message, worded as a warning rather than a rejection) if `otherServerTickingTotal + thisRunNewTotal > maxConcurrentObjectCount`, else `null`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/api/routers/simulation.test.ts` — add tests confirming: (a) `adjustLivePopulation` applies a valid delta and returns `{ok:true, warnings:[], newCount}`; (b) a delta pushing the per-run total over `maxObjectCount` still applies and returns a non-empty `warnings` array (soft-warn, not reject); (c) a delta pushing the user's cross-run total over `maxConcurrentObjectCount` (with a second concurrently-ticking run registered) still applies and warns; (d) ownership check rejects another user's run with `FORBIDDEN`; (e) a non-active/non-running run rejects with `BAD_REQUEST`; (f) the throttled case (calling within 500ms of a prior `updateRunParams` or `adjustLivePopulation` call) returns `TOO_MANY_REQUESTS`.
- Full suite passes: `npm test`

#### Manual Verification:

- None for this phase in isolation — manual verification happens in Phase 3 once the UI is wired.

## Phase 3: Server-owned panel UI

### Overview

Add step buttons for boid and predator count to `ServerRunViewer`'s live-edit panel, under the existing "Immediate" section, wired to the new mutation.

### Changes Required:

#### 1. Population step-button controls

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Render a "current: N [-10] [+10]" control for each of boid count and predator count, under the existing "Takes effect immediately" section alongside `foodRegenRate`/`protectionThreshold` — a third immediate-category control, not a new section.

**Contract**: Read the current counts from the existing subscription payload (`lastSnapshotRef.current?.boids.length` / `.predators.length` — already received every ~150ms via `onData`, no new snapshot field needed) into a small piece of state (e.g. `const [liveCounts, setLiveCounts] = useState<{boids:number; predators:number} | null>(null)`, updated in the existing `onData` handler alongside `lastSnapshotRef.current = data`). Render two labeled rows (one per kind), each showing the current count and two `Button`s (`-10`, `+10`) calling a new handler.

#### 2. `handleAdjustPopulation` + mutation wiring

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Each button click is a complete, immediate action (no staging/dirty-tracking, unlike the 6 scalar fields' Apply flow) — mirrors S-29's client-staged Switch precedent.

**Contract**: `const adjustPopulationMutation = api.simulation.adjustLivePopulation.useMutation({ onSuccess: (data) => { setWarnings((current) => [...current.filter(...), ...data.warnings]); /* flash + cooldown, same pattern as updateRunParamsMutation's onSuccess */ }, onError: (error) => setViewError(error.message) })`. `function handleAdjustPopulation(field: "boidCount" | "predatorCount", delta: number) { adjustPopulationMutation.mutate({ runId, field, delta }); }`, called directly from each button's `onClick` — no intermediate state to diff against. Buttons are `disabled` while `adjustPopulationMutation.isPending` or during a short client-side cooldown (reuse the existing `APPLY_COOLDOWN_MS`/flash-duration constants and pattern, in a cooldown state scoped to these two controls specifically — not shared with `applyCooldown`, since these are independent of the batched scalar-field Apply flow). A `-10` click when the current count is below 10 is still sent as-is (`delta: -10`) — the server clamps to 0, per this slice's "allow down to 0" decision; the client doesn't need its own clamping logic.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — add tests confirming: (a) the panel renders a boid-count and predator-count control with the current count and two buttons, under the "Takes effect immediately" section; (b) clicking `+10` calls `adjustLivePopulation.mutate` with `{runId, field:"boidCount", delta:10}`; (c) clicking `-10` calls it with `delta:-10`; (d) a warning returned from the mutation renders in the panel's warning list.
- Full suite passes: `npm test`

#### Manual Verification:

- Start a server-owned run with a visible population; click `+10` on boid count; confirm the live view shows ~10 new boids appear clustered near the existing flock, not scattered across the whole world — the actual behavior change the lesson in `context/foundation/lessons.md` ("UI accepts input is not feature verified") requires, not just that the count field changed.
- Click `-10` on boid count; confirm ~10 boids disappear from the live view and that the ones that vanish are visually among the ones already showing signs of low energy/age if observable, not an arbitrary-looking subset.
- Repeat both checks for predator count.
- Push a run's boid+predator total over the admin's configured `maxObjectCount` via repeated `+10` clicks; confirm a warning displays but the increase still applies (not rejected).

## Performance Considerations

Growth computes a centroid via one pass over the current array (O(n)) and generates `delta` new individuals (O(delta)) — bounded by the same `maxObjectCount`/`maxConcurrentObjectCount` ceilings as every other population-affecting operation. Shrink sorts a copy of the current array (O(n log n)) — same asymptotic cost as the existing `resolveOverlaps` pass already running every tick on a population this size, so no new performance ceiling is introduced.

## Migration Notes

None — no DB schema change. `boidCount`/`predatorCount` on `simulationRuns` remain the start-time columns; this slice's live-adjust mutates only in-memory `run.boids`/`run.predators`/`run.params`, exactly like the 6 existing scalar live-adjust fields.

## References

- Research/precedent: `context/archive/2026-11-15-live-parameter-adjustment/` (S-27), `context/archive/2026-11-15-live-crossbreeding-toggle/` (S-29) — this slice mirrors their registry/router/UI phase split and throttle/changelog pattern, but introduces array mutation (growth/cull) where they patched scalars.
- Registry: `src/server/simulation/server-run-registry.ts`
- Router: `src/server/api/routers/simulation.ts`
- Server-owned panel: `src/app/simulation/_components/server-run-viewer.tsx`
- Boid/predator generation and culling: `src/server/simulation/boids.ts`
- Lesson applied: `context/foundation/lessons.md` — "UI accepts input is not feature verified" (Phase 3's Manual Verification targets the actual live-view population change, not just a displayed count).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared population-mutation mechanism

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — a960308
- [x] 1.2 Linting passes: `npm run check` — a960308
- [x] 1.3 `npx vitest run src/server/simulation/server-run-registry.test.ts` — a960308
- [x] 1.4 Full suite passes: `npm test` — a960308

### Phase 2: Router procedure & cap checks

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — be4bb15
- [x] 2.2 Linting passes: `npm run check` — be4bb15
- [x] 2.3 `npx vitest run src/server/api/routers/simulation.test.ts` — be4bb15
- [x] 2.4 Full suite passes: `npm test` — be4bb15

### Phase 3: Server-owned panel UI

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx`
- [ ] 3.4 Full suite passes: `npm test`

#### Manual

- [x] 3.5 Boid +10 spawns ~10 new boids clustered near the existing flock, visible in the live view
- [x] 3.6 Boid -10 removes ~10 boids from the live view
- [x] 3.7 Predator +10/-10 behaves the same as boid +10/-10
- [x] 3.8 Exceeding maxObjectCount via repeated clicks warns but still applies
