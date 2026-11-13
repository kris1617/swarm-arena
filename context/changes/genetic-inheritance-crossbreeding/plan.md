# Plan: Genetic inheritance and inter-flock crossbreeding (S-03)

- **Change ID**: genetic-inheritance-crossbreeding
- **Roadmap item**: S-03 (context/foundation/roadmap.md)
- **PRD refs**: FR-005 (reproduction to the object-count cap), FR-006 (individual
  gene inheritance incl. blended color), FR-007 (crossbreeding on/off toggle)
- **Research**: context/changes/genetic-inheritance-crossbreeding/research.md

## Decisions this plan is built on

Resolved via a 13-question interview (3 rounds) grounded in `research.md`'s
codebase findings and the user's prior Lua/LÖVE2D reference implementation at
`/mnt/Kids/boids_final/game/` (design guidance only — not ported code; this
project stays TypeScript, pure-function, client-authoritative).

| # | Decision | Answer |
|---|---|---|
| 1 | Flock model | User-configurable flock count (2-4), `boidCount` split evenly at spawn, membership fixed for life |
| 2 | Crossbreeding gate (off) | Mating requires both parents to share `flockId`; on = any eligible pair regardless of flock |
| 3 | Reproduction trigger | New per-boid `energy` field (not reusing `lifespan`/`foodStock` directly) |
| 4 | Mate selection | First-match-in-range, uniform rule for boids and predators |
| 5 | Predator reproduction | Identical rules to boids via one shared helper (energy, flock gate, first-match) |
| 6 | Maturity gating | Tick-based maturity delay (new `age` field) before reproduction eligibility |
| 7 | Population-cap enforcement | Silent early-return guard at the reproduction call site, **plus** a visible "population capped" run-stats indicator |
| 8 | `matePreference` gene | Adopted now as a future-proofing gene (inherited/mutated, **not** read by this slice's first-match selection logic) |
| 9 | Lifespan × reproduction | Offspring inherit a blended `maxLifespan` gene; no energy/lifespan cost to parents at birth |
| 10 | UI exposure | New start-form fields: flock count, crossbreeding toggle, energy threshold, mutation chance, mutation magnitude |
| 11 | Persistence | Client-side only — genes live in `BoidState`/`PredatorState` during the live run; no DB snapshot of gene data (S-04's problem if/when needed) |
| 12 | Gender | Fresh random coin-flip per birth, never inherited (matches Lua reference) |
| 13 | Mutation UI | Two separate fields: mutation chance and mutation magnitude (not one combined slider) |

**One decision made by this plan, not the interview** (directly dictated by
PRD text already quoted in `research.md`, not a new open product question):
FR-006 says *"stado definiuje jedynie wartości średnie... od których startują
osobniki"* — the flock's `separationWeight`/`alignmentWeight`/`cohesionWeight`
become the **starting gene values** every individual spawns with; after that,
each boid's steering weights are its own genes (inherited + mutated at birth),
not a population-wide constant read every tick. This is the one change that
touches `stepBoids`'s hot loop, not just bookkeeping — see Phase 1.

## Current state (from research.md — not re-derived here)

- `BoidState`/`PredatorState` are purely kinematic (`x,y,z,vx,vy,vz,lifespan`) —
  zero gene/color/energy/age/gender/ID fields (`src/server/simulation/boids.ts:1-28`).
- Zero reproduction/offspring/birth logic anywhere in `src/server/simulation/`.
- Color is two fixed global constants, not per-entity (`src/styles/theme-colors.ts:12-18`).
- `FlockWeights` is a single population-wide object consumed by `stepBoids`
  (`boids.ts:11-15,184-188`) — there is no per-boid steering variance today.
- `runTick` (`boids.ts:508-545`) has a fixed pipeline: `stepBoids → stepPredators →
  applyHunger → applyPredation`. No rng argument anywhere in this chain.
- RNG is currently a **one-shot, discarded** object: `simulation-canvas.tsx:185`
  creates `const rng = createRng(seed)` inside the per-run `useEffect`, uses it
  only for the two `createInitial*` calls, and never passes it into
  `computeSingleRunTick`/`tick()`. `multi-run-lifecycle.ts` creates an equally
  throwaway `createRng(slot.seed)` inline when a slot's `RunState` is first
  seeded (not stored on `RunState`, never reused on later ticks). Reproduction's
  mutation rolls and gender coin-flips need a **persisted, per-run rng stream**
  — this plan promotes rng from "seed-time only" to "lives for the run" in both
  the single-run and multi-run lifecycles (Phase 3).
- `simulationRuns` DB schema and the `start` router's zod input are both flat,
  run-level scalars only (`schema.ts:92-118`, `simulation.ts:14-34`) — no
  crossbreeding/flock-count/energy/mutation fields exist yet.
- FR-018's object-count cap (`boidCount + predatorCount <= 500`) is enforced
  only at `start`-time today; nothing re-checks it mid-run because nothing
  currently grows the population mid-run.

## What We're NOT Doing

- **S-04's diversity/fitness scoring** or any DB persistence of per-boid gene
  data — explicitly deferred per decision #11. If S-04 later needs a gene
  snapshot at stop-time, that's S-04's own plan to write.
- **Scored mate-selection** (the Lua predator's energy/color/distance-weighted
  variant) — rejected in favor of one uniform first-match rule for both
  species (decision #4/#5).
- **Energy or lifespan cost to parents on reproduction** — rejected per
  decision #9; reproducing is free once eligible.
- **Gender inheritance** — gender stays a fresh per-birth coin-flip, never a
  gene (decision #12).
- **Raising or making configurable the FR-018 object-count cap itself** — the
  existing 500 ceiling (`start`'s `.refine()`) is unchanged; this slice only
  adds *runtime* enforcement of that same ceiling during reproduction.
- **Admin/config UI for maturity age or mate-distance radius** — these stay
  fixed engine constants (like `MIN_SPEED`/`NEIGHBOR_RADIUS` today), not
  exposed in the start form (decision #10 names exactly five new fields;
  maturity age and mate-distance are not among them).
- **Using `matePreference` in mate selection** — the gene is stored and
  inherited/mutated (decision #8) but deliberately not read anywhere in this
  slice's first-match selection logic. A future slice that wants scored
  selection can wire it in without another migration.
- **Extracting a shared form component** between `page.tsx` and
  `multi/page.tsx` — same established boundary as S-05's plan; each form gets
  the new fields independently.

---

## Phase 1: Gene model, per-individual instance state, and genes-drive-steering

**Goal**: `BoidState`/`PredatorState` carry genes, color, energy, age, and
gender; initial population creation seeds genes from the flock's starting
weights; `stepBoids` reads per-boid genes instead of the global `weights` param.

### Changes Required

#### `src/server/simulation/boids.ts`

- Add `BoidGenes` type: `{ color: { r: number; g: number; b: number };
  flockId: number; separationWeight: number; alignmentWeight: number;
  cohesionWeight: number; maxSpeed: number; minSpeed: number; maxLifespan:
  number; matePreference: number }`. Predators get the identical type
  (`PredatorGenes = BoidGenes`, same rationale as the existing
  `PredatorState`/`BoidState` shape-identity comment at `boids.ts:17-19`).
- Extend `BoidState`/`PredatorState`: add `genes: BoidGenes`, `energy: number`,
  `age: number`, `gender: "a" | "b"`.
- New constants (engine-fixed, not user-tunable — same class as `MIN_SPEED`):
  `INITIAL_ENERGY`, `MATURITY_AGE_SECONDS`, `MATE_DISTANCE_RADIUS`,
  `ENERGY_GAIN_RATE`, `ENERGY_MAX`. Document each with the same
  rationale-comment convention as existing constants.
- `createInitialPopulation(count, rng, maxLifespan, flockCount, flockWeights:
  FlockWeights[])`: split `count` evenly across `flockCount` flocks
  (remainder distributed to the first N flocks); each boid's `genes` seeds
  from its flock's `FlockWeights` (`separationWeight`/`alignmentWeight`/
  `cohesionWeight` = that flock's weights, no variance at gen 0 — mutation
  only happens at birth via reproduction, never at initial seeding),
  `maxSpeed`/`minSpeed` = the existing `MAX_SPEED`/`MIN_SPEED` engine
  constants, `maxLifespan` = the run's `maxLifespan` param, `matePreference`
  = `rng()`, `color` = a distinct hue per `flockId` (even spread around the
  color wheel, so N flocks are visually distinguishable — reuse the existing
  `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` as flock 0's color for continuity).
  `energy = INITIAL_ENERGY`, `age = 0`, `gender = rng() < 0.5 ? "a" : "b"`.
- `createInitialPredators`: same treatment, symmetric per decision #5
  (predators get flocks/genes/energy/age/gender too — no "simpler" predator
  path).
- `stepBoids`: **remove** the population-wide `weights: FlockWeights`
  parameter; read `boid.genes.separationWeight`/`alignmentWeight`/
  `cohesionWeight` instead, and clamp cruise speed to `boid.genes.minSpeed`/
  `maxSpeed` instead of the global `MIN_SPEED`/`MAX_SPEED` constants. The
  neighbor-scan loop, flee steering, and overlap resolution are otherwise
  unchanged — this only swaps "one shared weights object" for "each boid's
  own genes" at the three points `weights.separation`/`.alignment`/
  `.cohesion` and the speed-clamp currently appear.
- Add a pure `inheritGenes(parentA: BoidGenes, parentB: BoidGenes, rng: () =>
  number, mutationChance: number, mutationMagnitude: number): BoidGenes`
  helper: per numeric gene (`separationWeight`, `alignmentWeight`,
  `cohesionWeight`, `maxSpeed`, `minSpeed`, `maxLifespan`, `matePreference`),
  arithmetic mean of both parents, then an independent `rng() <
  mutationChance` roll per gene applying a `±mutationMagnitude` multiplicative
  jitter (`gene *= 1 + (rng() * 2 - 1) * mutationMagnitude`). `color`: per-RGB-
  channel mean + independent per-channel mutation roll, clamped to `[0,1]`.
  `flockId`: coin-flip pick of one parent's whole value (never blended) — this
  is the field the crossbreeding gate reads in Phase 2.

### Success Criteria

#### Automated

- [ ] `createInitialPopulation`/`createInitialPredators` split evenly across
      `flockCount` and assign distinct, deterministic (seeded) colors per flock
- [ ] `stepBoids` steering output for a boid now varies with its own genes,
      not a shared `weights` argument (two boids, same position/velocity,
      different gene weights → different post-step velocity)
- [ ] `inheritGenes`: two parents with different numeric genes → child's gene
      ≈ arithmetic mean (within mutation bounds when `mutationChance = 0`)
- [ ] `inheritGenes`: `mutationChance = 1` → every gene differs from the exact
      mean by up to `±mutationMagnitude`, never more
- [ ] `inheritGenes`: `flockId` always equals one parent's value exactly,
      never an interpolated value
- [ ] `inheritGenes`: color channels stay within `[0,1]` even with mutation
      pushing a channel past the boundary
- [ ] Existing `boids.test.ts`/`pipeline.test.ts` determinism tests still pass
      after `stepBoids`'s signature change (update call sites in those tests)
- [ ] `npm run typecheck` passes
- [ ] `npm run check` passes

#### Manual

- [ ] None this phase — no user-visible surface yet (wiring only)

---

## Phase 2: Reproduction step, mate selection, and the crossbreeding gate

**Goal**: A new pure `reproducePopulation` step composes into `runTick`,
implementing the trigger (energy + maturity + population cap), first-match
mate selection, the crossbreeding gate, and symmetric predator reproduction.

### Changes Required

#### `src/server/simulation/boids.ts`

- `reproducePopulation<T extends BoidState | PredatorState>(population: T[],
  rng: () => number, params: { crossbreedingEnabled: boolean; energyThreshold:
  number; mutationChance: number; mutationMagnitude: number; populationCap:
  number; totalOtherPopulationCount: number }): { population: T[]; capped:
  boolean }`: one generic helper used for **both** boids and predators (per
  decision #5 — identical rules, shared code, not two implementations).
  - Eligibility per individual: `energy >= params.energyThreshold && age >=
    MATURITY_AGE_SECONDS`.
  - For each eligible individual (in population order, so results are
    deterministic given the same `rng` stream), scan the rest of the
    population for the first other eligible individual where: `gender !==
    candidate.gender`, distance `<= MATE_DISTANCE_RADIUS` (reuse the existing
    `wrappedDelta`/`Math.hypot` pattern), not already paired this tick, and
    (`params.crossbreedingEnabled || genes.flockId === candidate.genes.flockId`).
  - On a match: if `population.length + pendingBirths + params.
    totalOtherPopulationCount >= params.populationCap`, set `capped = true`
    and skip creating the offspring (silent no-op per decision #7) but still
    mark both parents as paired this tick (no double-mating). Otherwise call
    `inheritGenes` for the gene set, assign fresh `gender = rng() < 0.5 ? "a"
    : "b"`, `energy = INITIAL_ENERGY`, `age = 0`, `lifespan =` the child's
    inherited `maxLifespan` gene, spawn position = the midpoint between
    parents (wrapped), velocity = a small random jitter (reuse `INITIAL_SPEED`
    scale).
  - Returns the population with new offspring appended and `capped` reflecting
    whether *any* eligible pair this tick was blocked by the cap.
- `runTick`: grow `params` with `rng: () => number`, `crossbreedingEnabled`,
  `energyThreshold`, `mutationChance`, `mutationMagnitude`, `populationCap`
  (default 500, matching FR-018). Pipeline order becomes: `stepBoids →
  stepPredators → applyHunger → applyPredation → reproducePopulation(boids) →
  reproducePopulation(predators)` — reproduction runs **last**, after this
  tick's deaths are already removed, so a boid that starved or was captured
  this tick cannot also reproduce. `populationCap` is split between species
  as `populationCap - predators.length` (for boids) and `populationCap -
  boids.length` (for predators) so the combined FR-018 ceiling holds exactly
  as it does at `start`-time.
- Also increment `energy` for every surviving individual each tick inside
  `reproducePopulation` (or a small preceding step): `energy = min(ENERGY_MAX,
  energy + ENERGY_GAIN_RATE * dtSeconds * foodAvailabilityRatio)`, where
  `foodAvailabilityRatio = clamp(foodStock / foodStockInitial, 0, 1)` for
  boids (predators use a fixed `1` — they have no food-stock mechanic per
  the existing `PredatorState` comment at `boids.ts:17-19`). `runTick` needs
  `foodStockInitial` threaded in as a new param for this ratio (boids already
  have access to the live `foodStock`; `foodStockInitial` is new).
- Also bump `age` for every surviving individual by `dtSeconds` each tick.

### Success Criteria

#### Automated

- [ ] Two eligible, opposite-gender, same-flock boids within mate distance →
      population grows by exactly one next tick
- [ ] Same scenario with `crossbreedingEnabled: false` and different
      `flockId`s → no offspring; with `true` → offspring produced (the
      PRD's named guardrail, tested directly: a crossbreeding-disabled run's
      offspring never has a blended-flock color when parents are cross-flock,
      because cross-flock pairs never mate at all when off)
- [ ] An individual below `energyThreshold` or below `MATURITY_AGE_SECONDS`
      never reproduces regardless of a nearby eligible mate
- [ ] At `populationCap`, an otherwise-eligible mated pair produces no
      offspring and `capped` is `true`
- [ ] Predators reproduce under the identical helper (same test shape as
      boids, confirming decision #5's symmetry)
- [ ] `runTick` is deterministic for the same seed/rng stream across two
      independent calls with identical inputs
- [ ] `npm run typecheck` / `npm run check` pass

#### Manual

- [ ] None this phase — not yet reachable from the UI (Phase 3 wires rng
      persistence; Phase 6 wires the new run-level params)

---

## Phase 3: Persist rng across ticks (single-run and multi-run lifecycles)

**Goal**: Promote rng from "seed-time only, then discarded" to a persisted
per-run stream in both lifecycles, so reproduction's mutation/gender rolls are
reachable and still fully deterministic per seed.

### Changes Required

#### `src/server/simulation/single-run-lifecycle.ts`

- `computeSingleRunTick`: add `rng: () => number` to its `params` object;
  forward it into the `runTick` call alongside the new reproduction params
  (`crossbreedingEnabled`, `energyThreshold`, `mutationChance`,
  `mutationMagnitude`, `foodStockInitial`) already added to `runTick` in
  Phase 2. No other signature change — the function stays pure and
  DOM-free.

#### `src/app/simulation/_components/simulation-canvas.tsx`

- Promote the local `const rng = createRng(seed)` (currently line 185) to a
  `useRef<() => number>`, created once in the same `useEffect`, so the exact
  same rng closure is read by `createInitialPopulation`/`createInitialPredators`
  at setup **and** by every subsequent `tick()` call via
  `computeSingleRunTick` — mirroring how `boidsRef`/`predatorsRef` already
  persist mutable state across ticks in this file.
- Pass `rngRef.current` into `computeSingleRunTick`'s params each tick.

#### `src/server/simulation/multi-run-lifecycle.ts`

- `RunState` type: add an `rng: () => number` field.
- Where a slot's `RunState` is first seeded (currently an inline, throwaway
  `createRng(slot.seed)` call), store that same rng instance on the new
  `RunState.rng` field instead of discarding it.
- `computeMultiRunTick`: forward `runState.rng` into the per-slot `stepBoids`/
  `runTick`-equivalent call so later ticks for that slot reuse the same
  persisted stream, never a freshly re-seeded one.

### Success Criteria

#### Automated

- [ ] Two full single-run simulations with the same seed, driven tick-by-tick
      through `computeSingleRunTick` for N ticks (long enough to trigger at
      least one reproduction event), produce bit-for-bit identical boid/
      predator arrays
- [ ] Same determinism property for `computeMultiRunTick` across two slots
      with the same seed
- [ ] Existing single-run/multi-run lifecycle tests still pass
- [ ] `npm run typecheck` / `npm run check` pass

#### Manual

- [ ] Run a single simulation twice with the same seed (via the existing dev
      UI, same seed forced for a manual check) and visually confirm the
      population size and approximate color mix match between runs at the
      same elapsed time

---

## Phase 4: Population-cap indicator

**Goal**: Surface decision #7's "visible run-stats indicator" when
reproduction is actively being suppressed by the population cap.

### Changes Required

#### `src/server/simulation/single-run-lifecycle.ts` / `boids.ts`

- `runTick`'s return type gains `populationCapped: boolean` (from Phase 2's
  `reproducePopulation` `capped` flag, boids OR predators this tick).
  `computeSingleRunTick`'s return type forwards this flag.

#### `src/server/simulation/multi-run-lifecycle.ts`

- Same flag threaded through `RunState`/`computeMultiRunTick`'s per-slot
  result so each slot can independently report it.

#### `src/app/simulation/_components/simulation-canvas.tsx`

- New `useState<boolean>` for the latest tick's `populationCapped`; render a
  small inline stats line ("Population capped — at the object limit") next
  to the Stop button whenever true, following the existing `tickError`/
  `status` conditional-rendering pattern already in this file.

#### `src/app/simulation/multi/_components/multi-simulation-stage.tsx` / `multi/page.tsx`

- Same indicator, scoped per slot, appended to that slot's existing status
  line in the `runSlotsState.slots.map(...)` list (next to "Running"/
  "Stopped").

### Success Criteria

#### Automated

- [ ] `computeSingleRunTick`/`computeMultiRunTick` report `populationCapped:
      true` exactly on a tick where `reproducePopulation` set `capped: true`,
      and `false` otherwise
- [ ] `npm run typecheck` / `npm run check` pass

#### Manual

- [ ] Start a run with a very low `populationCap`-adjacent scenario (small
      boid-count headroom under 500) and confirm the indicator appears once
      the cap is hit, then disappears if population later drops back under
      cap and a reproduction attempt succeeds

---

## Phase 5: Per-entity color rendering

**Goal**: Canvases render each boid/predator's own `genes.color`, not the
fixed global constants — the visible payoff of genetic inheritance.

### Changes Required

#### `src/app/simulation/_components/simulation-canvas.tsx`

- Add a small pure helper `colorToCss({ r, g, b }): string` (e.g.
  `rgb(${r*255}, ${g*255}, ${b*255})`), unit-testable alongside
  `computeDepthScale`/`compareByDepth` already exported from this file.
- `drawScene`: replace `ctx.fillStyle = BOID_FILL_COLOR` / `PREDATOR_FILL_COLOR`
  with `ctx.fillStyle = colorToCss(entity.genes.color)`. `DrawEntity` type
  gains `genes: BoidGenes` (or just the `color` field, whichever is less
  invasive given the existing spread-based construction at lines 97-104).

#### `src/app/simulation/multi/_components/multi-simulation-stage.tsx`

- Same treatment, reusing the same `colorToCss` helper (import from
  `simulation-canvas.tsx` or extract to a small shared module if that import
  direction is awkward — decide at implementation time based on which file
  already imports from the other).

#### `src/styles/theme-colors.ts`

- Keep `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` as-is — they remain flock 0's
  seed color (read by `createInitialPopulation` in Phase 1), just no longer
  read directly by the draw loops.

### Success Criteria

#### Automated

- [ ] `colorToCss({ r: 1, g: 0, b: 0 })` → `"rgb(255, 0, 0)"` (and similar
      boundary cases: 0, fractional values round sensibly)
- [ ] `npm run typecheck` / `npm run check` pass

#### Manual

- [ ] Start a run with `flockCount: 2`, crossbreeding **on** — visually
      confirm two base colors appear and at least one visibly blended
      (intermediate-hue) offspring appears once reproduction occurs
- [ ] Repeat with crossbreeding **off** — confirm only the two original
      per-flock colors ever appear, never a blend (the PRD's named guardrail,
      now manually visible)

---

## Phase 6: Run-level config surface — flock count, crossbreeding toggle, energy threshold, mutation chance/magnitude

**Goal**: The five new run-level parameters (decision #10) are configurable
from both start forms, validated server-side, and persisted alongside the
existing run columns.

### Changes Required

#### `src/server/db/schema.ts`

- Add columns to `simulationRuns`: `flockCount: integer().notNull()`,
  `crossbreedingEnabled: integer({ mode: "boolean" }).notNull()`,
  `energyThreshold: real().notNull()`, `mutationChance: real().notNull()`,
  `mutationMagnitude: real().notNull()`.
- Run `npm run db:generate` then `npm run db:push` (per AGENTS.md's Drizzle
  workflow) to produce and apply the migration.

#### `src/server/api/routers/simulation.ts`

- `start`'s zod input: add `flockCount: z.number().int().min(2).max(4)`,
  `crossbreedingEnabled: z.boolean()`, `energyThreshold: z.number().finite().positive()`,
  `mutationChance: z.number().min(0).max(1)`, `mutationMagnitude:
  z.number().min(0).max(1)`. Insert all five into the `simulationRuns.insert`
  call alongside the existing nine fields.

#### `src/app/simulation/page.tsx`

- Five new form fields following the file's existing `useState` + `<label>` +
  `<Input>` pattern: flock count (number input, min 2 max 4), crossbreeding
  toggle (checkbox or the existing `Button`-styled toggle pattern — reuse
  whatever boolean-input convention exists in `src/components/ui`, add one
  via `npx shadcn@latest add switch` if none exists), energy threshold,
  mutation chance, mutation magnitude (number inputs, same styling as
  `foodStockInitial`/`foodRegenRate`). Thread the five values into
  `startRun.mutate({...})` and into `ActiveRun`/`SimulationCanvas` props.

#### `src/app/simulation/multi/page.tsx`

- Same five fields (flockCount/crossbreeding apply to boids regardless of
  this form's existing "no predators" scope — predator fields stay hardcoded
  off per the file's documented S-05 boundary comment at lines 18-22, but
  flock/crossbreeding/energy/mutation are boid-level, not predator-level, so
  they're in scope here too). Thread into `startRun.mutate({...})` and into
  `RunSlot`/`MultiSimulationStage` props.

#### `src/server/simulation/run-slots.ts`

- `RunSlot` type: add the five new fields so `multi/page.tsx`'s `addSlot`
  call can carry them through to `MultiSimulationStage`.

#### `src/app/simulation/_components/simulation-canvas.tsx` / `multi/_components/multi-simulation-stage.tsx`

- Accept the five new props; forward into `computeSingleRunTick`/
  `computeMultiRunTick` → `runTick` params (already expecting them since
  Phase 2/3).

### Success Criteria

#### Automated

- [ ] `start` rejects `flockCount` outside `[2,4]`, `mutationChance`/
      `mutationMagnitude` outside `[0,1]`
- [ ] `start` persists all five new fields; a round-trip read confirms the
      stored row matches the submitted values (extend `simulation.test.ts`)
- [ ] `npm run typecheck` / `npm run check` pass
- [ ] `npm test` (full suite) passes

#### Manual

- [ ] Submit the single-run form with each new field at a non-default value
      and confirm the run starts and behaves consistently with that value
      (e.g. `crossbreedingEnabled: false` + 2 flocks → no blended-color
      offspring ever appears, confirmed visually per Phase 5's manual check)
- [ ] Repeat the same check on the multi-run form
- [ ] `npm run build` succeeds (confirms the new DB columns/migration don't
      break the production build path)

---

## Progress

### Phase 1: Gene model, per-individual instance state, and genes-drive-steering

#### Automated
- [ ] 1.1 `createInitialPopulation`/`createInitialPredators` flock split + color assignment
- [ ] 1.2 `stepBoids` reads per-boid genes instead of global `weights`
- [ ] 1.3 `inheritGenes` numeric-gene blending + mutation
- [ ] 1.4 `inheritGenes` flockId coin-flip, never blended
- [ ] 1.5 `inheritGenes` color blending clamped to [0,1]
- [ ] 1.6 Existing determinism tests updated for new `stepBoids` signature
- [ ] 1.7 typecheck + lint

#### Manual
(none this phase)

### Phase 2: Reproduction step, mate selection, and the crossbreeding gate

#### Automated
- [ ] 2.1 Eligible same-flock pair reproduces
- [ ] 2.2 Crossbreeding gate on/off behavior (the PRD guardrail)
- [ ] 2.3 Energy/maturity eligibility gating
- [ ] 2.4 Population-cap suppression + `capped` flag
- [ ] 2.5 Predator reproduction symmetry
- [ ] 2.6 `runTick` determinism given rng stream
- [ ] 2.7 typecheck + lint

#### Manual
(none this phase)

### Phase 3: Persist rng across ticks (single-run and multi-run lifecycles)

#### Automated
- [ ] 3.1 Single-run determinism across reproduction events
- [ ] 3.2 Multi-run determinism across reproduction events
- [ ] 3.3 Existing lifecycle tests still pass
- [ ] 3.4 typecheck + lint

#### Manual
- [ ] 3.5 Same-seed visual determinism check

### Phase 4: Population-cap indicator

#### Automated
- [ ] 4.1 `populationCapped` flag correctness

#### Manual
- [ ] 4.2 Indicator appears/disappears correctly in the running UI

### Phase 5: Per-entity color rendering

#### Automated
- [ ] 5.1 `colorToCss` helper correctness

#### Manual
- [ ] 5.2 Visible blended-color offspring with crossbreeding on
- [ ] 5.3 No blended color ever appears with crossbreeding off

### Phase 6: Run-level config surface

#### Automated
- [ ] 6.1 zod validation on the five new fields
- [ ] 6.2 Persistence round-trip
- [ ] 6.3 typecheck + lint + full suite

#### Manual
- [ ] 6.4 Single-run form end-to-end check
- [ ] 6.5 Multi-run form end-to-end check
- [ ] 6.6 Production build succeeds
