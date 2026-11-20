---
research_for: sim-engine-feature-analysis
date: 2026-11-17
researcher: Claude Sonnet 5
branch: master
commit_inspected: e883a77
last_updated: 2026-11-17
last_updated_by: Claude Sonnet 5
last_updated_note: initial research + structural-claims verification pass
---

# Research: sim-engine feature analysis (10xArchitect M4L3 artifact)

## Question

Using `context/map/repo-map.md` (M4L2 artifact) as the input lens, deeply
analyze ONE feature end-to-end. Target chosen: **sim-engine** — the map's
risk-zone #1 (busiest capability: 100 commits/275 changes, a 9-partner
router hub, and the repo's one confirmed architectural boundary break).
Scope: the **server-owned** simulation run lifecycle specifically (start →
tick loop → finish → watch → later analysis) — not the simpler client-staged
path, which is a separate flow.

## Method note (deviation from the lesson's exact prompt)

The lesson's verification step (`m4l3-2-ast-grep-verification.md`) calls for
`ast-grep`. It could not be installed in this sandboxed environment (the
auto-mode permission classifier blocks `npx @ast-grep/cli`/`npx -y ast-grep`
as an unapproved install action). Every structural claim below was instead
verified with precise `rg`/`grep` patterns against exact identifiers and
import paths — the lesson's own stated tradeoff ("ast-grep's AST precision
vs. grep's literal honesty") applies: these patterns are literal-string/regex
matches, not AST-aware, so a claim confirmed this way could in principle miss
an aliased import or a dynamically-constructed call. None of the claims below
depend on anything more exotic than a direct named import or function call,
so the literal-match risk is low, but it is named here rather than silently
substituted.

## 1. Feature overview

### 1.1 The server-owned run lifecycle, step by step

1. **Entry** — `src/app/simulation/page.tsx:538-547`. User clicks "Start on
   server"; `onClick={() => startServerMutation.mutate(buildStartInput())}`
   (line 541). `buildStartInput()` (lines 140-210) clamps all 16 form fields
   against admin-configured ranges.

2. **Router: `startServer`** — `src/server/api/routers/simulation.ts:357-410`.
   - `insertRunningSimulation(ctx.db, userId, input)` (line 364, helper at
     260-341): loads/seeds admin ranges, validates against them, enforces
     `MAX_PARALLEL_RUNS` per-user, generates a seed, and **inserts the row
     into `simulationRuns` with `status: "running"`** (first DB write,
     lines 287-310).
   - `assertWithinConcurrentObjectCeiling` (line 370): rejects and rolls the
     row back to `stopped` if the user's combined concurrent object count
     would exceed the cap (lines 380-384).
   - `startServerRun({ runId, seed, ...input })` (line 387): registers the
     run in-memory. On failure, rolls back to `stopped` (400-403).

3. **Registry: `startServerRun`** — `src/server/simulation/server-run-registry.ts:588-662`.
   - Seeds initial populations via `createInitialPopulation`/
     `createInitialPredators` (`boids.ts`, lines 614-629).
   - Constructs the in-memory `LiveRun` object and starts the real tick
     loop: `setInterval(() => tick(params.runId), TICK_INTERVAL_MS)`
     (line 649; `TICK_INTERVAL_MS = 16`, line 27).
   - `registry.set(params.runId, run)` (line 661) — stored in a
     `Map<number, LiveRun>` cached on `globalThis` so it survives dev HMR.

4. **The tick loop** — `tick(runId)`, `server-run-registry.ts:469-586`,
   fired every 16ms.
   - Computes `isThrottled` from watcher-grace-period state (476-481).
   - Calls `computeSingleRunTick(...)` (483-516).
   - Writes results back onto the in-memory `run` object (543-555).
   - If `result.shouldStop` (557-578): computes the score and calls
     `void finishRun(runId, { score, history })` — **fire-and-forget**,
     terminal DB write.
   - On any thrown error: catches, calls `void finishRun(runId, { score:
     null })` (579-585).

5. **Tick core: `computeSingleRunTick`** — `src/server/simulation/single-run-lifecycle.ts:23-239`.
   Computes clamped `dtSeconds` (scaled by `speedMultiplier` for throttled
   runs), calls `runTick(...)` (`boids.ts`), appends one sample per tick to
   5 sample arrays, classifies the population phase, and determines
   `shouldStop`.

6. **Physics core: `runTick`** — `src/server/simulation/boids.ts:1055-1190`.
   Fixed pipeline: `stepBoids` → `stepPredators` → `applyHunger` →
   `applyPredation` → energy/age bump → `reproducePopulation` (both
   populations).

7. **Terminal write: `finishRun`** — `server-run-registry.ts:406-467`.
   `clearInterval`; `registry.delete(runId)`; then
   `db.update(simulationRuns).set({ status: "stopped", score, stoppedAt,
   history })` (443-451) — the persisted score/history write, wrapped in a
   try/catch that only logs on failure (it runs fire-and-forget from inside
   a synchronous interval callback).

8. **Watch (back to client)** — `watchServerRun` async generator,
   `server-run-registry.ts:853-905`, wrapped by the router's `watch`
   subscription (`simulation.ts:597-612`). Reads the DB once for
   ownership/active checks, then loops every `WATCH_INTERVAL_MS` (150ms)
   yielding **in-memory** state via `getLiveRunState` — not the DB. Client:
   `server-run-viewer.tsx:511-533`,
   `api.simulation.watch.useSubscription(...)`.

9. **Later analysis (DB read)** — `getRunAnalysis`, `simulation.ts:808-883`,
   reads the finished row's `history` JSON column and derives chart data.

```mermaid
sequenceDiagram
    participant U as User
    participant Page as page.tsx
    participant Router as simulation.ts (tRPC)
    participant Registry as server-run-registry.ts
    participant Boids as boids.ts / single-run-lifecycle.ts
    participant DB as simulationRuns (SQLite)
    participant Viewer as server-run-viewer.tsx

    U->>Page: click "Start on server"
    Page->>Router: startServer.mutate(buildStartInput())
    Router->>DB: INSERT simulationRuns status="running"
    Router->>Registry: startServerRun(params)
    Registry->>Boids: createInitialPopulation / createInitialPredators
    Registry->>Registry: registry.set(runId, run); setInterval(tick, 16ms)
    Router-->>Page: { runId, seed }

    loop every 16ms
        Registry->>Boids: computeSingleRunTick -> runTick
        Boids-->>Registry: next boids/predators/foodStock/samples
    end

    Viewer->>Router: watch.useSubscription({runId})
    Router->>DB: findFirst (ownership/active check)
    loop every 150ms
        Router->>Registry: getLiveRunState(runId)
        Registry-->>Viewer: tracked SSE snapshot
    end

    Registry->>Registry: tick detects shouldStop
    Registry->>Boids: computeScore(...)
    Registry->>DB: UPDATE status="stopped", score, history, stoppedAt
    Registry->>Registry: clearInterval; registry.delete(runId)

    U->>Router: getRunAnalysis({runId}) (later)
    Router->>DB: SELECT simulationRuns WHERE id=runId
    Router-->>U: score + history + derived cycles/diversity/suggestion
```

### 1.2 The boundary break — confirmed real and load-bearing, not dead code

`boids.ts:5` — `import { BOID_FILL_COLOR, PREDATOR_FILL_COLOR } from
"~/styles/theme-colors";` **[evidence, verified by `rg`]**. Used at line 331
(`createInitialPopulation`) and line 380 (`createInitialPredators`) via
`createFlockColors(flockCount, <COLOR>)`, which spreads flock colors around
the color wheel anchored at the seed color's actual hue.

This is **not** a vestigial/unused import: the resulting colors are written
into every boid's/predator's `genes.color` at spawn, which is then:
- read by `computeGeneticDiversity` (color channels feed the diversity
  score, which is one of the scoring factors persisted as `score`), and
- persisted verbatim into `history.survivorGenes` on every finish, later
  displayed by the run-analysis and run-comparison views.

A server-only simulation-engine module importing from a client-presentation
module (`~/styles/*`) is a genuine layer violation — the dependency should
point the other way, or through a shared, presentation-free constant. It is
load-bearing precisely because it affects a persisted score, which is why it
can't simply be deleted; a fix needs to preserve the color-wheel behavior
while removing the cross-layer import (see Technical debt below).

## 2. Technical debt

### 2.1 Architectural boundary break (confirmed above)

`src/server/simulation/boids.ts:5,331,380` imports `~/styles/theme-colors`
— a server-engine file reaching into presentation tokens. **Refactor
opportunity**: move `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` (or copies of
their hex values) into a server-owned constant that `theme-colors.ts`
re-exports from, or duplicate the two hex strings server-side — either
removes the cross-layer dependency without changing the observable color
behavior. **Risk if left as-is**: a future change to `theme-colors.ts` made
purely for UI reasons (e.g. a design-system refresh) could silently change
persisted score behavior (`computeGeneticDiversity`'s color-channel input)
with no obvious reason for a UI-only PR to be reviewed against a scoring
risk.

### 2.2 Two independent, hand-synchronized callers of `computeSingleRunTick`

`computeSingleRunTick` (`single-run-lifecycle.ts:23-239`) has exactly two
production call sites **[evidence, verified by `rg`: only
`server-run-registry.ts:483` and `simulation-canvas.tsx:800` call it; the
only other hit is its own `export function` declaration]**:
- Server-owned: `server-run-registry.ts:483-516`, passes `speedMultiplier`.
- Client-staged: `simulation-canvas.tsx:800-828` (RAF loop), never passes
  `speedMultiplier` (defaults to 1 — no throttle concept client-side, which
  is correct since only server-owned runs compete for CPU across users).

Both construct the full 10-field `state` object by hand, field-by-field,
from different sources (a `LiveRun` object vs. component refs). Any change
to the state/params/result shape requires editing both call sites
correctly — there is no shared construction helper enforcing parity. The
project's own test suite (`simulation-canvas.test.tsx`) is explicitly the
place a missed-sync bug would surface, which is good coverage, but it's
coverage of a contract that exists only by convention, not by a shared type
helper or builder function.

### 2.3 `finishRun`'s history literal is duplicated by hand at two call sites

The `history` object written to `simulationRuns.history` is built twice,
independently: once inline in `tick()` (`server-run-registry.ts:565-577`)
and once in `stopServerRun` (`server-run-registry.ts:684-696`) — the same
8-field shape, not factored into one shared builder function. A field added
to one and forgotten in the other would silently produce incomplete history
on whichever path missed the update (natural-completion tick vs. manual
stop) without any compiler or test forcing the two to agree, beyond whatever
each path's own tests happen to assert.

### 2.4 Test coverage: three real, specific gaps (plus one deliberate, documented non-gap)

The server-owned lifecycle is otherwise unusually well-tested — every
exported registry function has direct tests exercising real failure modes
(the tick error path, population-wipe stop, DB-write-failure logging, the
watcher-count/grace-period throttling boundary and reset behavior, and
extensive snapshot/resume migration-safety fallbacks). Three specific,
real gaps found by directly reading the test file (not inferred from
coverage tooling):

1. **`wasEverThrottledWritten`'s DB-write-failure/retry path is untested**
   (`server-run-registry.ts:530-540`). **[verified: `rg "wasEverThrottled"
   server-run-registry.test.ts` returns exactly one hit, a success-path
   assertion at line 1589 — no test forces the `.catch` here to fire]**.
   This guard was specifically added (per its own code comment) to retry on
   failure rather than get permanently stuck — but nothing proves the retry
   actually happens on a real DB failure.
2. **`startServerRun`'s own double-registration throw is untested directly**
   (`server-run-registry.ts:589-593`). **[verified: the test file's only
   "already registered" test, line 1397, is for `resumeServerRun`, not
   `startServerRun`]** — the analogous guard on the more commonly-hit
   function has no direct test, only indirect/unconfirmed coverage via the
   router's own race-safety test.
3. **The three `*.corpus.test.ts` router files were not confirmed** to
   exercise the live server-owned tick path vs. seeding already-completed
   rows directly — naming and the project's own corpus-fixture pattern
   suggest the latter, but this was not verified by reading those files
   in this pass.

**Deliberate, documented non-gap**: the `simulationRouter.watch` tRPC
procedure wrapper itself has no test — but this is explicitly because
tRPC's `.subscription()` procedures cannot be invoked via `createCaller`
(documented in the code's own comment and in `context/foundation/lessons.md`),
and the project's response was correctly to extract the testable core
(`watchServerRun`) into a plain function with its own thorough test
coverage. This is the right tradeoff, not a gap to close.

### 2.5 Real couplings — re-verified independently against the repo-map's claims

The repo-map (M4L2) claimed two co-change couplings for sim-engine. Both
were re-verified by re-running git history queries directly (not trusting
the map's numbers blind):

- **sim-engine ↔ staging-live-view**: map claimed support=28/54%
  confidence; independent re-count found support≈26/50% confidence (same
  order of magnitude; the ~2-point gap is a measurement-methodology
  difference in co-change windowing, not evidence of staleness). 5
  spot-checked commits confirmed genuine feature/review co-edits, not
  noise.
- **sim-engine ↔ data-model**: map claimed support=10/59%; re-count found
  support≈7/50%. All 7 spot-checked commits confirmed genuine schema+engine
  co-edits.

**Conclusion**: both couplings are real, current, and hand-kept (no shared
contract/type enforces them) — exactly the kind of coupling a refactor
touching `computeSingleRunTick`'s contract needs to budget for across both
the data model (`ServerRunSnapshot`, `simulationRuns.history`/`savedState`
JSON columns) and the client-staged UI, not just the server registry.

## Settled facts for `/10x-plan`

- The theme-colors import is the concrete, well-scoped refactor candidate
  from this analysis: fix by introducing a server-owned color constant,
  preserving the existing color-wheel behavior and persisted score/history
  shape exactly.
- Any plan touching `computeSingleRunTick`'s signature must update both
  call sites (registry + canvas) and both `history`-literal builders
  (tick's inline call + `stopServerRun`), and re-run (not just read) the 6
  test files named in §2.4/§2.2 that directly exercise this contract.
- The 3 real test-coverage gaps (§2.4, items 1-2, and the unconfirmed
  corpus files) are each independently small enough to close without a full
  plan cycle if the user wants that as a quick follow-up, separate from the
  M4L4 refactor-opportunities artifact this research feeds into.

## Open for `/10x-plan` (M4L4) to resolve

- Whether to fix the boundary break by relocating the hex constants,
  duplicating them, or re-exporting through a shared non-presentation
  module — a genuine design choice, not resolved here per this lesson's own
  contract ("ranking is a proposal; the decision is made at planning").
- Whether to factor `computeSingleRunTick`'s two call sites and/or the
  `history`-literal duplication into shared helpers as part of the same
  change, or treat them as separately-scoped follow-ups.
