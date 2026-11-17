---
research_for: refactor-opportunities
date: 2026-11-17
researcher: Claude Sonnet 5
branch: master
commit_inspected: 1721ba2
last_updated: 2026-11-17
last_updated_by: Claude Sonnet 5
last_updated_note: initial research — current shape + intentionality + migration feasibility
---

# Research: refactor opportunities (10xArchitect M4L4 artifact)

## Question

`context/changes/sim-engine-feature-analysis/research.md` documents
technical debt and structural risk in sim-engine. This change answers the
question that analysis deliberately left open: WHICH of these problems is
worth fixing, in what target shape, and in what order. No refactor happens
and no decision is made in this document — that's `/10x-plan`'s job, after
reading this ranking.

## Candidates (classification)

Per the lesson's own rule: a CANDIDATE is a problem whose fix would change
code structure. Anything else (a missing test, a stale comment) stays as
feasibility/cost input, not a candidate.

| # | Problem (from prior research.md) | Candidate? |
|---|---|---|
| A | `boids.ts` imports `~/styles/theme-colors` directly (§2.1) | **Yes** |
| B | `computeSingleRunTick`'s two hand-synced callers (§2.2) | **Yes** |
| C | `finishRun`'s `history` literal duplicated at two call sites (§2.3) | **Yes** |
| — | 3 test-coverage gaps (§2.4) | No — missing tests, not a structural change. Kept below as feasibility/cost input per candidate. |

## Candidate A — `boids.ts` imports `~/styles/theme-colors`

### Current shape (evidence)

`boids.ts:5` imports `BOID_FILL_COLOR`/`PREDATOR_FILL_COLOR` from
`~/styles/theme-colors`, used at lines 331/380 via `createFlockColors` to
seed flock 0's color, then hue-spread the rest. `theme-colors.ts:11-18`
documents itself as a "canvas-readable mirror of globals.css... kept in
sync by hand" — explicitly a presentation-layer file, also consumed
client-side for real canvas rendering (`simulation-canvas.tsx:42`). No
server-owned color/constants module exists in `src/server/simulation/` to
relocate to — one of two: a new tiny module, or two duplicated hex
constants, either consistent with the file's existing style (it already
exports local constants like `FLOCK_COLOR_SATURATION`/`FLOCK_COLOR_LIGHTNESS`
at lines 248-249).

### Intentionality (evidence) — **mixed verdict**

- **The color-continuity behavior is deliberate**: commit `687b097`
  (2026-11-13) and `context/archive/2026-11-13-genetic-inheritance-crossbreeding/plan.md:60,143-144`
  explicitly chose to reuse the two existing hex constants as flock 0's
  seed, for maximal hue separation and visual continuity with the
  pre-genetics engine. In-code comments (`boids.ts:193-197,250-257,285-289`)
  restate this reasoning in detail.
- **The cross-layer import itself is accidental**: `theme-colors.ts` was
  created on commit `5d18501` (2026-11-11) purely for canvas rendering,
  two days *before* the genetics code that later imported it from the
  server even existed. No commit message, plan, or review ever discusses
  or decides that a server simulation file should import from `src/styles/*`
  — it's a side effect of the easiest way to reuse two already-existing hex
  strings, not a considered layering choice.

### Migration feasibility (evidence)

- `npm run typecheck`/`npm run check` (Biome) would **not** catch a wrong
  constant value or a bad relocation — both the old and a relocated
  constant typecheck identically as `string`, and this repo's `biome.jsonc`
  has no import-boundary rule configured.
- Tests that **would** catch a behavioral regression: `boids.test.ts:107-150`
  (distinctness/determinism) and `boids.test.ts:164-189` (hue-spread
  anchoring regression test) — both assert on `genes.color` derived from
  `createFlockColors`, but neither pins a literal expected hex/RGB value for
  a fixed seed, so a value-preserving relocation passes either way while a
  value-changing mistake could still slip through a same-shape swap.
- CI (`.github/workflows/deploy.yml:3-5,46`) runs the full test suite only
  on push to `master` (no `pull_request` trigger) — a regression here would
  block deploy, but not block merge/landing on master.
- Blast radius is contained: `grep -rn "theme-colors" src` (excluding tests)
  shows only `boids.ts:5` as a server-side consumer — no other file would
  need updating.
- **First prerequisite step**: add one characterization-test assertion
  pinning today's exact `genes.color` value for a fixed seed+flockCount
  (the existing tests assert distinctness/determinism but not a literal
  value) before moving the constant.

## Candidate B — `computeSingleRunTick`'s two hand-synced callers

### Current shape (evidence)

Exactly two production callers (confirmed by `grep`): `server-run-registry.ts:483`
(server, inside `tick()`) and `simulation-canvas.tsx:800` (client, inside a
RAF loop). Each hand-builds the same 12-field `state` object (not 10 as the
prior research.md said — recounted directly: `boids, predators, foodStock,
cohesionSamples, foodRatioSamples, populationCountSamples,
populationDensitySamples, geneticDiversitySamples, phaseHistory,
elapsedSeconds, lastTimestamp, hasWarnedDenseClustering`) and an overlapping
~10-11-field `params` object, with one intentional divergence
(`speedMultiplier`, server-only, commented as intentional). No named/exported
type exists for either shape — `computeSingleRunTick`'s own signature uses
inline object-literal types. The server side separately has its own
`LiveRun` type that half-overlaps this shape but isn't shared with the
canvas caller.

### Intentionality (evidence) — **deliberate constraint**

The pure-core/thin-shell split (`computeSingleRunTick` as a "DOM-free,
directly-testable decision core... separated from the canvas/RAF/tRPC
shell," `single-run-lifecycle.ts:19-22,29-32`) is a named, repeatedly
reinforced architectural pattern: introduced on `b773de5` to make tick
logic unit-testable, extended to a second caller on `9bf0e66` with an
explicit "the only thing that changes is *who calls it on a timer*... not
the function itself," and endorsed again in a plan-review
(`live-simulation-view-channel/reviews/plan-review.md:34`) as established
project norm. The unwatched-run-tick-throttling change later added
`speedMultiplier` only to the server caller, defaulting to 1 so "every
existing caller/test is unaffected" — caller-specific divergence is
tolerated by design. **However**: no evidence anywhere that the
*hand-built object construction itself* was ever considered as its own
extraction opportunity and rejected — the split-by-design explains why two
callers exist, not why each still assembles its arguments by hand.

### Migration feasibility (evidence)

- `npm run typecheck` **does** catch a parameter-shape mismatch today —
  both call sites pass object literals checked against
  `computeSingleRunTick`'s declared parameter type, so a dropped/misnamed
  field is already a compile error. This is a materially stronger existing
  guard than Candidate A has.
- 6 test files would need re-running on any signature change:
  `single-run-lifecycle.test.ts`, `server-run-registry.test.ts` (spies on
  the function at 4 line numbers), `simulation-canvas.test.tsx` (mocks and
  asserts on the exact options object passed).
- Blast radius extends beyond this file per the prior research.md's §2.5:
  the co-change couplings to `staging-live-view` (~26 support/50%) and
  `data-model` (~7/50%) mean a real signature change also touches
  `ServerRunSnapshot` and the persisted `history`/`savedState` JSON columns
  — wider than Candidates A or C.
- An existing convention in these same files (`ServerRunParams`,
  `ServerRunSnapshot`, `LiveRunSnapshot` — all `export type`) could be
  extended to name `computeSingleRunTick`'s shapes too, but no
  builder/constructor-function pattern exists anywhere in this module to
  reuse — that part would be new.
- **First prerequisite step**: export named `TickState`/`TickParams`/
  `TickResult` types from `single-run-lifecycle.ts` (type-only change,
  zero behavior risk) before considering any shared-construction helper.

## Candidate C — `finishRun`'s `history` literal duplicated at two call sites

### Current shape (evidence)

Two sites in `server-run-registry.ts` (tick's `shouldStop` branch,
~lines 566-576; `stopServerRun`, ~lines 684-694) build the identical 8-field
`history` object by hand, each immediately followed by a `finishRun(runId,
{ score, history })` call. **A second duplication beyond what the prior
research.md flagged**: the 5-argument `computeScore(...)` call immediately
preceding each `history` literal is *also* duplicated verbatim at both
sites — a fix scoped only to `history` would still leave this second
instance in place. `finishRun`'s own parameter type already spells out the
8-field shape as a type — it exists structurally, just isn't used as a
constructor at either call site.

### Intentionality (evidence) — **accidental complexity (clearest case of the three)**

No comment at either site explains the duplication. `context/archive/2026-11-14-persist-run-history/plan.md:94-104`
shows the plan itself wrote the (then 3-field) literal once in prose and
*directed* implementation at both call sites — the duplication was the
literal implementation instruction, not later copy-paste drift. Five
subsequent commits each added one new field to *both* literals in the same
commit, treated each time as "mirror the existing pattern," never as an
extraction opportunity. Damningly: this same codebase already has and
applies a "don't duplicate, extend the shared core" principle
(`full-score-save-resume/research.md:183-188`) — applied to
`computeSingleRunTick` (Candidate B), but never extended to this literal.
**Concrete evidence the risk has already partially materialized**:
`src/server/db/schema.ts:149`'s own comment claims `history`'s shape is
`{ phaseHistory, foodRatioSamples, survivorGenes }` — stale; it's missing
5 of the 8 real fields. The exact "field added, contract/doc not updated"
failure mode this candidate warns about has already happened once, on
documentation (not yet on the code itself, but the near-miss is real).

### Migration feasibility (evidence)

- `npm run typecheck` **does** catch an outright dropped field (the type is
  fully required, no optional fields) — it would **not** catch a field
  populated from the wrong source array (e.g. swapping which sample array
  feeds which key), since both are `number[]`.
- Blast radius is self-contained to `server-run-registry.ts` — not flagged
  elsewhere in the coupling analysis, unlike Candidate B.
- Coverage of the specific 8-field assertions on both the tick-triggered and
  `stopServerRun`-triggered paths independently was not exhaustively
  confirmed in this pass — flagged honestly as **unknown**, a confirmable
  next step rather than a guess.
- **First prerequisite step**: extract a `buildFinishHistory(run)` helper
  (unused by either call site yet), add a characterization test asserting
  its output matches today's two inline literals field-for-field, then
  swap one call site, confirm green, then the other — reversible one site
  at a time. The duplicated `computeScore(...)` call found above is a
  natural second helper to extract in the same pass, since it sits right
  next to the `history` literal at both sites.

## Cross-cutting note (affects all three candidates equally)

`.github/workflows/deploy.yml` triggers only on `push: branches: [master]`
— there is no `pull_request` trigger. CI would catch a regression in any of
these three candidates before *deploy* (the `deploy` job needs `test` to
pass), but not before *merge* (there is no merge gate; this repo pushes
directly to master). This isn't specific to any one candidate, but any
incremental-and-reversible migration for any of them is weaker without a
pre-merge gate than it would otherwise be.

## Refactor opportunities (ranked proposal — decision belongs to `/10x-plan`)

### 1. Candidate C — extract `buildFinishHistory` (and the duplicated `computeScore` call)

- **Current → target shape**: two hand-duplicated 8-field object literals
  (plus a duplicated 5-argument score call) → one `buildFinishHistory(run)`
  helper (and one score-computation helper) in `server-run-registry.ts`,
  called from both `tick()` and `stopServerRun()`.
- **Why it earns this rank**: clearest accidental-complexity verdict of the
  three (no deliberate reason ever recorded), smallest blast radius
  (self-contained to one file), and the risk it protects against has
  *already partially materialized* (the stale `schema.ts` comment proves
  the "add a field, forget the other copy" failure mode is real, not
  hypothetical) — highest debt-cost-vs-change-cost ratio.
- **Blast radius**: `server-run-registry.ts` only; `server-run-registry.test.ts`
  re-run to confirm no behavior change.
- **Incremental path**: extract helper (unused) → characterization test
  pinning today's output → swap call site 1 → swap call site 2, each step
  independently green and revertible.
- **First prerequisite step**: the characterization test, named above.

### 2. Candidate A — relocate the theme-colors constants server-side

- **Current → target shape**: `boids.ts` imports two hex constants from a
  client-presentation module → a server-owned copy of the same two
  constants (duplicated or re-exported), same color-wheel math, same
  persisted values.
- **Why it earns this rank**: the layering violation itself is unambiguously
  accidental (no commit ever decided a server file should import
  `~/styles/*`), fix is small and contained (one file, one import line to
  change), and it's the repo-map's own named #1 risk-zone finding — fixing
  it is a visible, well-scoped demonstration of closing a real
  architectural boundary break. Ranked below Candidate C only because its
  existing test coverage (distinctness/determinism, not a literal-value
  pin) is slightly weaker evidence of safety going in, needing one new
  assertion first.
- **Blast radius**: contained to `boids.ts` + the new/relocated constants
  file; no other server file imports `theme-colors` today.
- **Incremental path**: add a literal-value characterization assertion to
  `boids.test.ts` → introduce the server-side constant(s) → swap the
  import → confirm the new assertion and the existing distinctness tests
  stay green → remove the now-unused server-side import of `theme-colors`.
- **First prerequisite step**: the literal-value characterization
  assertion, named above.

### Considered and not ranked for this plan: Candidate B

`computeSingleRunTick`'s two hand-synced callers is a real candidate, but
ranked below the other two for this specific plan: (1) the split that
causes the duplication is itself a *deliberate, named, repeatedly-endorsed*
architectural pattern — fixing the construction duplication doesn't close
an open risk the project didn't already knowingly accept; (2) `typecheck`
already provides a strong existing guard (a shape mismatch is a compile
error today, unlike Candidates A and C); (3) its blast radius is the
widest of the three (touches `ServerRunSnapshot`, persisted JSON columns,
and 6 test files) for the lowest marginal risk reduction, since nothing
here is currently drifting silently the way Candidate C's stale schema
comment proves C already has. Worth a future pass (exporting named
`TickState`/`TickParams`/`TickResult` types is low-risk and matches the
project's own existing type-export convention) but not this one.
