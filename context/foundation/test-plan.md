# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-11-12 (Phase 6 added via --refresh and complete — depth-rendering formula coverage)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   area Y" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/app`, `src/server`, `src/components`, `src/styles` (30-day scan, 20 commits — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | A future change to the simulation's fixed per-tick step order (boids → predators → hunger → predation), or to its call-site wiring, silently changes simulation outcomes — only each step function is unit-tested in isolation, never the composed order | High | High | interview Q2; `archive/2026-11-11-predator-prey-dynamics/plan.md` ("Critical Implementation Details" names this order load-bearing); hot-spot dir `src/server/simulation` (18 commits/30d) |
| 2 | The full composed simulation pipeline (predator targeting, hunger/food, genetics) stops reproducing identical scores for identical seed+params once more state is layered on top of the RNG primitive — breaking the product's core comparability guarantee | High | Medium | PRD Non-Functional Requirements (determinism); roadmap "Vision recap" (deterministic repeatable score is the product wedge); hot-spot dir `src/server/simulation` |
| 3 | A simulation at or near the configured max object count (FR-018) visibly freezes or drops below a usable frame rate, breaking the "stays usable" guardrail — nothing automated checks the per-tick cost budget today | High | Medium | interview Q1; PRD Non-Functional Requirements ("rendering stays usable... no freezing"); hot-spot dir `src/app/simulation/_components` (6 commits/30d) |
| 4 | The canvas tick-loop/render wiring (stop-on-duration, stop-on-population-wipe, redraw-on-active-run-switch, no double-stepping) regresses — this logic is duplicated across the single-run and multi-run components with zero automated tests in `src/app/` | Medium | High | interview Q3; hot-spot dir `src/app/simulation/_components`; `archive/2026-11-11-parallel-sim-switching/plan.md` (explicit "duplicated, not shared" decision between the two loop implementations) |
| 5 | A user can affect another user's simulation run (e.g. stop it) by supplying its `runId` — the ownership check exists but was verified once, manually, and the one automated router test covers only input validation, not cross-user access | Medium | Medium | PRD Access Control section; `archive/2026-11-10-gate-product-routes/plan.md` Progress items 2.6/2.7 (manual-only verification); hot-spot dir `src/server/api/routers` (7 commits/30d) |
| 6 | A careless future edit to the depth-to-scale formula or draw-order comparator (swapped clamp direction, flipped sort, swapped `MIN_SCALE`/`MAX_SCALE`) silently inverts near/far rendering, caught only by eyeballing the canvas | Medium | Low | `--refresh` discovery that `pseudo-3d-depth-rendering` shipped `impl_reviewed` but was never archived, so the original test-plan scan missed it; `pseudo-3d-depth-rendering/plan.md` Phase 2 success criteria (manual-only, no automated assertion on the formula) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | The documented tick order produces a specific, reproducible outcome for a fixed seed+params, and swapping the order of any two steps measurably changes that outcome — the order itself is asserted, not just each function in isolation | Assuming the existing per-function unit tests already cover this — they test each step independently, never the composed pipeline's order | The exact call site that composes the four step functions per tick. Research (`research.md`, 2026-11-12) confirmed this composition is single-sourced, not duplicated: it lives only in the single-run tick loop; the multi-run tick loop runs a boids-only subset with no predator/hunger/predation calls at all, by design | unit/integration, against the composed tick function | An assertion copied from the pipeline's current output (oracle problem) instead of one derived from the documented invariant — would re-bless a wrong order if copied from current behavior |
| #2 | Running the same seed+params twice through the full composed pipeline for N ticks yields identical derived state (population, positions, score), not just identical RNG draws | Assuming determinism is inherited for free from the RNG primitive being deterministic — array iteration order, tie-breaking in nearest-neighbor lookups, or sort stability can introduce non-determinism unrelated to the RNG | Every place the pipeline iterates over boid/predator collections, and whether any iteration order depends on insertion/mutation order rather than a stable, seed-derived order | unit/integration, against the composed tick function (can share a fixture with #1) | Asserting two runs produce "similar" scores instead of exactly identical — a near-miss here is still a real break of the guardrail |
| #3 | The composed step pipeline's per-tick cost stays within a defined budget at the FR-018 max object count, verified structurally rather than by wall-clock timing | Assuming the existing 500-object cap already guarantees smooth rendering because it was chosen as a guardrail — the cap bounds the input, it does not prove the loop stays within budget. Also assuming "bounded pairwise-comparison count" means an exact magic-number assertion — research (`research.md`, 2026-11-12) found this would itself be an oracle-problem violation (the expected count can only be derived by reading all ~11 distance-math call sites in `boids.ts`, not from the product requirement) | The tick loop's actual per-frame cost profile (confirmed: `O(B²)`-dominated via `resolveOverlaps`/`stepBoids`'s neighbor scan, `B`=boid count, bounded by FR-018's server-enforced cap) — where time is spent across step functions vs. the draw routine | a scaling-shape test on `runTick` (e.g. assert operation count grows within a quadratic-shaped band between two boid-count samples), not an exact-count assertion, not e2e/visual | Asserting on wall-clock time in CI (flaky); asserting an exact operation-count total (oracle-problem violation — the number comes from reading the implementation, not the requirement) instead of a scaling-shape band derived from "must not be worse than quadratic" |
| #4 | The composed loop's lifecycle behaviors (stop-on-duration, stop-on-population-wipe, correct redraw on active-run switch, no double-step) hold, verified without a real browser frame | Assuming unit tests on the pure step functions implicitly cover the loop that calls them — the loop itself is an untested integration point, duplicated across two files that can drift independently | Whether the loop's state-transition logic can be exercised without a real `requestAnimationFrame`/canvas context, or needs a lightweight test double. Research (`research.md`, 2026-11-12) confirmed both loops have a separable, pure lifecycle-decision core (dt computation, stop-condition boolean, active-slot selection) already callable with zero DOM | unit test against an extracted, DOM-free lifecycle function (mirroring Phase 1's `runTick` extraction) — confirmed cheaper than mocking RAF/canvas, since jsdom/happy-dom/testing-library/canvas-mock are absent from this project even transitively and mocking would require adding them | An e2e/Playwright test asserting pixel output when the actual risk is lifecycle/state-transition logic, not visuals; also avoid adding DOM-mocking dependencies when extraction gives the same signal for zero new dependencies |
| #5 | Calling `simulation.stop` for a run owned by a different user throws `FORBIDDEN`, and an unauthenticated call throws `UNAUTHORIZED` — as a regression test, not a one-time manual check | Assuming the manual verification done at implementation time (basic-flocking-loop Progress 2.6/2.7) stays true forever — nothing re-runs that check on future refactors of `trpc.ts` or `simulation.ts`. Also assuming a purely fabricated session with no real DB rows is enough to reach the ownership check — research (`research.md`, 2026-11-12) confirmed `@libsql/client` enforces foreign keys by default, so the `FORBIDDEN` case needs a real `users` row (owner) and a real `simulationRuns` row before `stop`'s resolver ever runs; only the `UNAUTHORIZED` case needs no DB setup | Where the ownership check currently lives (confirmed: resolver body, `simulation.ts:100-102`, not middleware), and how to fabricate two distinct user sessions against the test db given the FK constraint above | integration test via `createCaller` (already the pattern in `simulation.test.ts`) with two fabricated sessions, plus real DB fixture rows for the FORBIDDEN case | Asserting only that *some* error is thrown (vacuous pass) instead of the specific `FORBIDDEN`/`UNAUTHORIZED` code — `simulation.test.ts`'s own existing comment already warns against this exact mistake |
| #6 | The depth-scale/draw-order contract (near=bigger/far=smaller within `[0.3, 2.0]`; farthest-first draw order) holds under future edits, asserted against the documented contract, not a value mirror | Assuming the division-blow-up scenario near `z → -REFERENCE_DEPTH` needs testing — research (`test-plan-refresh-2026-11-12/research.md`, 2026-11-12) confirmed `z` is domain-bounded to `[0, 200)` via `boids.ts`'s `wrap()`, making that scenario unreachable; testing it would be speculative | None further — fully grounded in `test-plan-refresh-2026-11-12/research.md` | unit test on extracted pure functions (`computeDepthScale`, `compareByDepth`), mirroring the `runTick`/lifecycle extraction pattern | Asserting an exact scale value computed the same way the implementation computes it (oracle problem) instead of deriving from the documented clamp bounds and near/far direction |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Composed-pipeline correctness & determinism | Prove the fixed tick order and full-pipeline determinism hold, not just each step function in isolation | #1, #2 | unit + integration | complete | `context/changes/testing-composed-pipeline-correctness/` |
| 2 | Render-loop lifecycle safety net | Catch lifecycle regressions (stop conditions, double-step, redraw-on-switch) in both loop implementations without a browser | #4 | integration | complete | `context/changes/testing-render-loop-lifecycle/` |
| 3 | Authorization regression coverage | Lock in the cross-user ownership boundary on `simulation.stop` that today is only manually verified | #5 | integration | complete | `context/changes/testing-simulation-ownership/` |
| 4 | Perf-budget guard for render usability | Give the "stays usable" guardrail an automated structural floor instead of eyeballing | #3 | unit (perf-budget) | complete | `context/changes/testing-render-perf-budget/` |
| 5 | Quality-gates wiring | Add required lint + typecheck + test as a CI step before the existing auto-deploy-on-merge, which currently has none | cross-cutting | gates | complete | `context/changes/ci-quality-gates/` |
| 6 | Depth-rendering formula coverage | Prove the depth-scale/draw-order contract holds under future edits, not just at ship time | #6 | unit | complete | `context/changes/test-plan-refresh-2026-11-12/` |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs;
no docs or search MCP was available in the current session (noted below).

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | ^5.1.0 | `npm test` (= `vitest run`); existing suite is 5 files, all under `src/server/` |
| API/router testing | tRPC `createCaller` | n/a (project pattern) | Used today in `src/server/api/routers/simulation.test.ts`; fabricates a session object, no HTTP layer needed |
| DB for tests | libsql/SQLite via Drizzle | n/a | `vitest.config.ts` sets `DATABASE_URL=file:./db.sqlite` for the test env — real local file, not an in-memory double |
| e2e | none yet — see Phase 2 | — | Lifecycle risk (#4) is addressed at the integration layer with a mocked RAF/canvas, not e2e; no e2e tool is currently justified by any risk in this plan |
| accessibility | none yet | — | Not raised by any top-5 risk; revisit at `--refresh` if the UI surface grows |
| (optional) AI-native | not proposed | n/a | No risk in §2 needs a layer cheaper tests can't already give |

**Stack grounding tools (current session):**
- Docs: none available in current session — not checked.
- Search: none available in current session — not checked.
- Runtime/browser: none available in current session — not used; checked: 2026-11-12.
- Provider/platform: none available in current session — not used; checked: 2026-11-12.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | `.github/workflows/deploy.yml` `test` job, required via `needs: test` on `deploy` | required | syntactic / type drift |
| unit + integration | `.github/workflows/deploy.yml` `test` job, required via `needs: test` on `deploy` | required | logic regressions |
| e2e on critical flows | not wired, not planned | — | not applicable — no e2e tool justified by current risks (see §4) |
| post-edit hook | not wired, not planned | — | not applicable — no rollout phase proposes one |
| visual diff (deterministic) | not wired, not planned | — | not applicable — risk #3/#4 are addressed structurally, not visually |
| pre-prod smoke | not wired, not planned | optional | environment-specific failures; the VPS deploy (`.github/workflows/deploy.yml`) has no gate at all today |

`.github/workflows/deploy.yml` now gates `deploy` behind a `test` job (build, typecheck, check, migrate, test) via `needs: test` — closing the gap Phase 5 was opened to fix.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test for simulation step/pipeline composition

- Location: `src/server/simulation/pipeline.test.ts`.
- Pattern: compose the per-tick steps via an exported `runTick`-style function
  that is shared between the test and the UI call site (`src/server/simulation/boids.ts`'s
  `runTick`, wired into `simulation-canvas.tsx`'s tick loop) — never re-derive
  the composed order in the test itself. Assert determinism by running the
  same seed+params twice and comparing full derived state (not just RNG
  draws). Pin tie-breaks (e.g. nearest-neighbor ties in predator targeting or
  capture) as explicit contracts using constructed-tie fixtures, rather than
  leaving tie-break behavior implicit. Prove the documented order is
  load-bearing with a swapped-order contrast test that shows a different
  order produces a different outcome from the same fixture.
- Reference test: `runTick > is deterministic end-to-end across the full composed pipeline, not just the RNG primitive` (see `pipeline.test.ts`; also see `hunger-before-predation order is load-bearing` for the swapped-order contrast pattern).
- Run command: `npx vitest run src/server/simulation/pipeline.test.ts`.

### 6.2 Adding an integration test for a render-loop lifecycle

- Location: two layers, not one.
  - Pure lifecycle core: `src/server/simulation/<name>-lifecycle.ts`, with a
    co-located `<name>-lifecycle.test.ts` right beside it (e.g.
    `single-run-lifecycle.ts` / `single-run-lifecycle.test.ts`,
    `multi-run-lifecycle.ts`).
  - Shell-wiring smoke test: `src/app/<component-path>.test.tsx`, co-located
    with the component it exercises (e.g.
    `src/app/simulation/_components/simulation-canvas.test.tsx`,
    `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`).
- Pattern: extract the loop's state-in/state-out decision core first — a
  plain function taking prior state + the new timestamp/props and returning
  next state, DOM-free and requiring zero new dependencies (mirrors Phase
  1's `runTick` extraction). Unit-test that core directly with plain
  Vitest. Only then add a second, minimal smoke test for the thin RAF-
  scheduling shell that calls it — never for visual/pixel output, which
  this layer does not cover and is not meant to. The shell test needs a DOM
  (this project had none; `happy-dom` was added as a new dependency
  specifically for this), and mocks: `// @vitest-environment happy-dom`
  docblock, `vi.mock("~/trpc/react", ...)` for the component's
  `api.simulation.stop.useMutation()` call, a stubbed
  `HTMLCanvasElement.prototype.getContext`, and stubbed
  `requestAnimationFrame`/`cancelAnimationFrame` via `vi.stubGlobal` that
  capture the scheduled callback instead of actually scheduling it, so the
  test can advance ticks manually. Mount with `createRoot` + `act` from
  `"react"`, using the simplest valid props (e.g. an empty `slots` array for
  the multi-run component — no running slot needed to exercise the
  scheduling guarantee itself), and assert the exactly-once-then-exactly-
  twice RAF call-count sequence (mount schedules one frame; processing one
  tick schedules exactly one more — not more, which would mean a
  double-step).
- Reach for the happy-dom shell layer only when the risk is specifically
  the RAF-scheduling/lifecycle wiring itself (stop conditions, double-step,
  redraw-on-switch) — if the risk is purely the decision logic (dt
  computation, stop-condition booleans), the pure-core unit test alone is
  cheaper and sufficient.
- Reference tests: `src/server/simulation/single-run-lifecycle.test.ts`
  (pure core), `src/app/simulation/_components/simulation-canvas.test.tsx`
  (shell smoke test, Phase 2), `src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`
  (shell smoke test, Phase 4).
- Run commands: `npx vitest run src/server/simulation/single-run-lifecycle.test.ts`,
  `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx`,
  `npx vitest run src/app/simulation/multi/_components/multi-simulation-stage.test.tsx`.

### 6.3 Adding an authorization/ownership regression test

- Location: `src/server/api/routers/simulation.test.ts`, extending the
  existing `createCaller` pattern (no new file).
- Pattern: fabricate sessions for the *caller* — a plain
  `{ user: { id, role }, expires }` object, no DB row needed, since
  `protectedProcedure`'s middleware only reads the session shape. Insert
  real `users` + resource (`simulationRuns`) rows only when the checked
  procedure's resolver reads an existing row keyed to that id — required
  here because `@libsql/client` enforces foreign keys by default, so
  `stop`'s ownership check (which does `ctx.db.query.simulationRuns.findFirst`
  before comparing `run.userId`) needs a real owner row and a real run row,
  while a purely-input-validation or no-session case does not. Use a local
  async helper (`insertOwnedRunningRun()`) that inserts both rows and
  returns their ids, track inserted owner ids in a module-level array, and
  clean up in `afterEach` via `db.delete(users).where(eq(users.id, ownerId))`
  — deleting the `users` row cascade-deletes the matching `simulationRuns`
  row through its `onDelete: "cascade"` reference, so no separate run
  cleanup is needed. Always pair a negative case (wrong-user session →
  `FORBIDDEN`) with a contrast positive case (owner's own session → call
  resolves) — a `FORBIDDEN`-only test can pass vacuously if the check were
  broken to reject everyone. Assert the specific `TRPCError.code`, never a
  bare `.rejects.toThrow()`.
- Reference test: `simulationRouter.stop authorization > rejects with
  FORBIDDEN when the caller does not own the run` (see
  `simulation.test.ts`; also see the sibling `allows the owner's own call to
  succeed (contrast case)` and `rejects with UNAUTHORIZED when there is no
  session` tests for the other two legs of this pattern).
- Run command: `npx vitest run src/server/api/routers/simulation.test.ts`.

### 6.4 Adding a scaling-shape perf-budget test

- Location: `src/server/simulation/pipeline-perf.test.ts`.
- Pattern: wrap `vi.spyOn` (no `mockImplementation` — the real computation
  still runs, so the spy only counts calls and never changes which
  conditional branches get taken) around a primitive that every O(n^2)
  distance scan in the pipeline funnels through (here, `Math.hypot`, used by
  `stepBoids`'s neighbor scan, `resolveOverlaps`, `stepPredators`'s
  nearest-boid scan, and `applyPredation`'s nearest-boid scan). Build two
  input samples at a known scale factor (e.g. 40 boids/10 predators vs. 160
  boids/40 predators — same ratio, 4x scale), run the composed pipeline
  once per sample, and assert the resulting call-count ratio falls inside a
  band derived from the expected Big-O shape for that scale factor (4x
  input -> 16x calls under quadratic) — never an exact call count. An exact
  count is an oracle-problem violation: the number comes from reading the
  implementation, not from the product requirement, and would need updating
  every time an unrelated internal refactor changed how many times the
  primitive is called without changing the actual cost shape.
- Known fuzz sources that widen the band past the naive quadratic
  prediction: `applyPredation`'s capture-dependent skip (a predator stops
  scanning once every reachable boid is captured), and `stepBoids`'s
  conditional `alignMag`/`cohMag` terms (only computed when
  `neighborCount > 0`). Set the band wide enough to absorb these but not so
  wide it would admit a cubic regression (a 4x scale predicts ~64x under
  cubic, vs. ~16x under quadratic) — a 10-22 band worked for the boid/
  predator counts above, with a measured ratio of ~15.8.
  Use generous `foodStock`/`foodRegenRate` values (e.g. 1000/10) so
  `applyHunger`'s negative-stock branch never fires mid-test — it would
  remove boids and shrink a sample's population independently of the fixed
  scale factor, skewing the ratio.
- Reference test: `runTick scaling-shape perf budget > grows Math.hypot
  call count quadratically, not cubically or unboundedly, as boid/predator
  count scales 4x at a fixed 4:1 ratio` (see `pipeline-perf.test.ts`).
- Run command: `npx vitest run src/server/simulation/pipeline-perf.test.ts`.

### 6.5 Per-rollout-phase notes

(Filled in after each phase lands with anything surprising it taught.)

**Phase 5 (quality-gates wiring):** `next build` executes server code during
static page-data collection (e.g. `/_not-found`), which eagerly constructs the
app's db client singleton via `env.DATABASE_URL` at module load.
`SKIP_ENV_VALIDATION` only bypasses the T3 env Zod check — it does not supply
a value — so a CI build step needs real (dummy) values for `DATABASE_URL` and
every other required `env.js` field, not just the skip flag. Separately, a
fresh CI checkout's SQLite file has no schema, so any test touching a real DB
row needs a migrate step (`npm run db:migrate`, same dummy env) before
`npm test`. Both gaps were invisible locally (dev always has a real `.env`
and an already-migrated `db.sqlite`) and only surfaced on the first two real
CI runs — exactly the category of gap this plan's own "Open Risks" flagged
in advance as unprovable without a real Actions run.

**Phase 6 (depth-rendering formula coverage, via `--refresh`):** a shipped,
`impl_reviewed` change that is never archived stays invisible to
`/10x-test-plan`'s discovery, which only scans `context/archive/` — it took a
`--refresh` to surface `pseudo-3d-depth-rendering`'s untested formula.
`/10x-tdd` was tried on this phase and correctly redirected to
`/10x-implement` via its own eligibility gate: the formula and sort already
executed in production (just not as named functions), so there was no
"before the code exists" state for a red test to lead. Retrofitting coverage
onto already-shipped, DOM-entangled logic is `/10x-implement` territory, not
`/10x-tdd`'s — true test-first only applies to genuinely new behavior.

### 6.6 Adding a unit test for a canvas-adjacent pure calculation

- Location: co-located with the component, `.test.ts` not `.test.tsx` when
  the test exercises only extracted pure functions with zero React/DOM
  involvement (e.g. `src/app/simulation/_components/depth-render.test.ts`
  beside `simulation-canvas.tsx`).
- Pattern: when a calculation (a formula, a comparator, a derived value) is
  inlined inside a function that also makes `ctx.*`/DOM calls, extract it
  into a named, exported, pure function first — mirrors the `runTick`/
  lifecycle-core extraction pattern (§6.1, §6.2). Then assert against the
  calculation's *documented* contract (clamp bounds, direction, a defined
  reference point), never against a value computed the same way the
  implementation computes it (oracle problem). For a clamp, assert the
  clamp is actually doing something — pick inputs that would exceed the
  bound *without* the clamp, not just inputs that happen to land in range.
- Reference test: `computeDepthScale` / `compareByDepth` in
  `depth-render.test.ts` — clamp-bound tests use inputs (`z = -99`,
  `z = 100_000`) chosen specifically to exceed the documented bounds absent
  the clamp, not arbitrary values.
- Run command: `npx vitest run src/app/simulation/_components/depth-render.test.ts`.

## 7. What We Deliberately Don't Test

No exclusions were agreed. Asked directly (Phase 2 interview Q5) what test
budget should explicitly avoid, the answer was: "I do not want to skip
anything." This is recorded as-is rather than inventing an exclusion the
project owner did not actually choose.

- Re-evaluate at the next `/10x-test-plan --refresh` if an area later proves
  genuinely not worth testing (e.g. a feature gets cut, or a surface turns
  out to be low-stakes enough to deliberately skip).

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-11-12
- Stack versions last verified: 2026-11-12
- AI-native tool references last verified: n/a — none proposed

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
