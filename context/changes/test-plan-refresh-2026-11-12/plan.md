# Depth-Rendering Formula Test Coverage Implementation Plan

## Overview

Extract the depth-to-scale projection formula and the back-to-front draw-order
comparator out of `drawScene` into pure, DOM-free functions, unit-test them
against an oracle derived from the formula's own documented contract (not
from current output), and wire `drawScene` to call them. Also adds a new
rollout phase (§3 "Phase 6") and risk row (§2) to `test-plan.md`, closing the
gap a stale (unarchived) prior change left outside the original test-plan
discovery.

## Current State Analysis

- `src/app/simulation/_components/simulation-canvas.tsx:42-47` defines
  `REFERENCE_DEPTH = 100`, `MIN_SCALE = 0.3`, `MAX_SCALE = 2.0`.
- `simulation-canvas.tsx:71-125`'s `drawScene(ctx, boids, predators)` builds a
  merged `DrawEntity[]` (`:80-88`), sorts it `(a, b) => b.z - a.z` (farthest
  first, `:91`), then per entity computes
  `scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + entity.z)))`
  (`:101-104`) and uses it to scale the triangle/diamond half-length/width
  passed to `ctx.moveTo`/`ctx.lineTo`.
- Both the scale formula and the sort comparator are inlined in `drawScene`,
  which takes a live `CanvasRenderingContext2D` — there is no DOM-free way to
  unit-test either today without extraction.
- `boid.z`/`predator.z` are always in `[0, 200)` (`src/server/simulation/boids.ts:35`'s
  `Z_DEPTH_RANGE = 200`, enforced by `wrap()` at every write site — see
  `research.md`). This makes `REFERENCE_DEPTH + entity.z` always lie in
  `[100, 300)` — the division-blow-up scenario is not reachable and is
  intentionally **not** tested (would be a speculative/oracle-problem test;
  see `research.md`'s "Open Questions" / `test-plan.md`'s challenger-pass
  rule).
- `entities` is a freshly merged array (`[...boids.map(...), ...predators.map(...)]`),
  not an alias of the `boids`/`predators` props — `.sort()` mutating it is not
  a caller-visible bug. No fix needed here, just confirming the plan's
  original "sorts a local copy" phrasing was accurate in effect.
- `src/server/simulation/boids.ts` already has a precedent for extracting
  canvas-adjacent pure logic (`runTick`, from `testing-composed-pipeline-correctness`)
  and `src/server/simulation/single-run-lifecycle.ts`/`multi-run-lifecycle.ts`
  (from `testing-render-loop-lifecycle`) establish the same "extract pure
  core, unit-test it, keep the DOM-touching shell thin" pattern this plan
  follows.

### Key Discoveries:

- No existing test references `REFERENCE_DEPTH`/`MIN_SCALE`/`MAX_SCALE`
  (confirmed by grep across every `*.test.*` file in `src/`, `research.md`).
  `simulation-canvas.test.tsx` exists but covers only RAF double-step
  scheduling (`describe("SimulationCanvas RAF scheduling shell")`) — no
  overlap with this phase's scope.
- **This is a retrofit, not new behavior.** The scale formula and sort order
  already execute in production exactly as this plan describes them — nothing
  about extracting them into named functions changes that. `/10x-tdd`'s own
  eligibility gate stops when "the core implementation for the phase is
  already present," which is true here. This phase is implemented via
  `/10x-implement`, the same as rollout Phases 1–4 (all retrofits for the same
  reason). If `/10x-tdd` is invoked on this phase anyway, expect it to
  correctly redirect to `/10x-implement` rather than drive a red-green-refactor
  cycle — that redirect is the gate working as designed, not a tool failure.

## What We're NOT Doing

- Not testing the division-blow-up/sign-flip scenario near `z → -REFERENCE_DEPTH`
  — domain-unreachable per `research.md`, would be a speculative test.
- Not changing the formula's behavior, constants, or visual output — this is
  a test-coverage retrofit, not a rendering change.
- Not adding a canvas/DOM-level visual regression test (pixel diff, snapshot)
  — the risk is the formula/order logic, not pixel-level rendering fidelity;
  a pure-function unit test is the cheapest layer that gives real signal here
  (cost × signal principle).
- Not re-deriving `entities`'s mutation-safety as a bug to fix — research
  confirmed it's a fresh array, not a caller-visible mutation; no change
  needed to that part.
- Not touching `ui-simulation-tokens` (the other unarchived-but-shipped change
  this refresh also surfaced) — out of scope for this phase; a separate
  future risk if it needs one.

## Implementation Approach

One phase: extract two pure functions into `simulation-canvas.tsx` (or a
sibling module if that reads cleaner against this file's existing structure —
implementer's call, no new file is strictly required), add a focused unit
test file, wire `drawScene` to use the extracted functions, then update
`test-plan.md` §2/§3/§6.

## Phase 1: Extract depth-scale/sort-order functions, test them, wire drawScene, update test-plan.md

### Overview

Pull the scale formula and sort comparator out of `drawScene` into pure,
exported functions; add oracle-derived unit tests; wire `drawScene` to call
the extracted functions instead of inlining the logic; update `test-plan.md`.

### Changes Required:

#### 1. Extract `computeDepthScale` and `compareByDepth`

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Make the depth-scale formula and draw-order comparator
independently callable and unit-testable without a canvas context, while
leaving the rendered output byte-for-byte identical to today.

**Contract**:
- `computeDepthScale(z: number): number` — exported, pure. Behavior:
  `Math.min(MAX_SCALE, Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + z)))`,
  i.e. the exact formula at today's `:101-104`, moved verbatim into a named
  function (do not alter the formula — this phase adds coverage, not a
  behavior change).
- `compareByDepth(a: { z: number }, b: { z: number }): number` — exported,
  pure. Behavior: `b.z - a.z` (farthest-first), the exact comparator at
  today's `:91`, moved verbatim.
- `drawScene` calls `entities.sort(compareByDepth)` instead of the inline
  arrow, and uses `computeDepthScale(entity.z)` instead of the inline
  `Math.min(Math.max(...))` expression. No other change to `drawScene`'s
  behavior, signature, or call sites.

#### 2. Oracle-derived unit tests for both functions

**File**: `src/app/simulation/_components/depth-render.test.ts` (new; `.ts`
not `.tsx` since this test exercises pure functions with zero React/DOM
involvement)

**Intent**: Assert `computeDepthScale`/`compareByDepth` against the
documented contract (near = bigger, far = smaller, clamped to
`[MIN_SCALE, MAX_SCALE]`; farthest-first ordering) — never against a value
copied from the current formula's output (oracle problem).

**Contract**: At minimum, assert:
- `computeDepthScale(REFERENCE_DEPTH)` returns exactly `1` (the formula's own
  defined reference point — `100 / (100 + 100) = 0.5`... **note for
  implementer**: verify this against the actual constant values in the file
  at implementation time rather than trusting this plan's arithmetic; the
  oracle is "the formula produces whatever `REFERENCE_DEPTH / (REFERENCE_DEPTH + z)`
  mathematically yields at `z = 0`, which is where scale should equal `1`" —
  derive the correct `z` for a `1.0` scale from the formula itself, not from
  a guessed value here.
- A smaller `z` (nearer) yields a strictly larger scale than a larger `z`
  (farther), for at least one pair on each side of the clamp boundaries.
- `computeDepthScale` never returns below `MIN_SCALE` or above `MAX_SCALE`
  even for `z` values that would mathematically exceed those bounds (e.g.
  `z = 0` before clamping would exceed `MAX_SCALE`; a very large `z` would
  fall below `MIN_SCALE` absent the clamp) — assert the clamp is actually
  doing something, not just that the unclamped formula happens to fall in
  range.
- `compareByDepth` sorts a small fixture array `[{z: 50}, {z: 150}, {z: 10}]`
  (or similar) into descending-`z` order (farthest first) — assert the
  resulting order, not just that the comparator returns a sign.
- Do NOT assert the exact numeric scale for an arbitrary `z` by computing it
  the same way the implementation does (oracle problem) — every assertion
  above derives from the documented contract (near/far direction, clamp
  bounds, reference-point identity), not from re-running the formula.

#### 3. Update `test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Record the new risk, close the rollout-phase row, and seed the
cookbook pattern this phase establishes for future depth/projection-style
pure-function extractions.

**Contract**:
- §2 Risk Map: add a new row (risk #6) — "A careless future edit to the
  depth-to-scale formula or draw-order comparator (swapped clamp direction,
  flipped sort, swapped MIN_SCALE/MAX_SCALE) silently inverts near/far
  rendering, caught only by eyeballing the canvas" — Impact: Medium, Likelihood:
  Low (rare edit surface), Source: this refresh's discovery that
  `pseudo-3d-depth-rendering` shipped unarchived and was missed by the
  original test-plan scan; `pseudo-3d-depth-rendering/plan.md`'s Phase 2
  success criteria (manual-only).
- §2 Risk Response Guidance: add the matching row (what would prove
  protection: oracle-derived scale/order assertions, not a value mirror; must
  challenge: assuming the division-blow-up scenario needs testing — domain
  bounds rule it out; context needed: none further, already grounded in
  `research.md`; likely cheapest layer: unit test on extracted pure
  functions; anti-pattern to avoid: asserting an exact scale value computed
  the same way the implementation computes it).
- §3 Phased Rollout: add a new row — "Phase 6 | Depth-rendering formula
  coverage | Prove the depth-scale/draw-order contract holds under future
  edits, not just at ship time | #6 | unit | complete | `context/changes/test-plan-refresh-2026-11-12/`".
- §6 Cookbook: add a new subsection "6.6 Adding a unit test for a
  canvas-adjacent pure calculation" documenting the extract-then-test pattern
  this phase used (mirrors 6.1/6.2's structure: location, pattern, reference
  test, run command).
- Bump the "Last updated" banner at the top of `test-plan.md` to today's date
  with a one-line note.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test file passes: `npx vitest run src/app/simulation/_components/depth-render.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- A visual spot-check (run the app, start a simulation) still shows the same
  near-bigger/far-smaller depth effect and correct occlusion as before this
  change — confirms the extraction didn't alter behavior.

**Implementation Note**: This phase is implemented via `/10x-implement`, not
`/10x-tdd` — the formula and sort already ship in production, so there is no
"before the code exists" state for a red test to lead. If `/10x-tdd` is tried
on this phase, expect its eligibility gate to detect the existing
implementation and redirect to `/10x-implement`; that is correct behavior,
not a blocker. After this phase's automated verification passes, pause for
the manual spot-check before committing.

---

## Testing Strategy

### Unit Tests:

- `depth-render.test.ts` covers `computeDepthScale` (clamp bounds, near/far
  direction, reference-point identity) and `compareByDepth` (sort order) —
  see Phase 1, Change 2.

### Integration Tests:

- N/A — no DOM/canvas integration test added; the existing
  `simulation-canvas.test.tsx` RAF-scheduling smoke test is unaffected and
  not extended by this phase.

### Manual Testing Steps:

1. Run `npm run dev`, start a simulation, confirm boids still visibly vary in
   size by depth and occlude correctly — unchanged from before this phase.

## Performance Considerations

None — this phase extracts existing logic into named functions with
identical runtime behavior; no new computation is added.

## Migration Notes

None — no schema, data, or API changes.

## References

- Research: `context/changes/test-plan-refresh-2026-11-12/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 new risk #6; §3 new Phase 6;
  §6 new §6.6)
- Original (unarchived) feature plan: `context/changes/pseudo-3d-depth-rendering/plan.md`
  (Phase 2, lines 107-144 — the shipped contract this phase adds coverage for)
- Precedent for the extraction pattern: `context/changes/testing-composed-pipeline-correctness/plan.md`
  (`runTick`), `context/changes/testing-render-loop-lifecycle/plan.md`
  (`single-run-lifecycle.ts`/`multi-run-lifecycle.ts`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract depth-scale/sort-order functions, test them, wire drawScene, update test-plan.md

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 New test file passes: `npx vitest run src/app/simulation/_components/depth-render.test.ts`
- [x] 1.4 Full suite still passes: `npm test`

#### Manual

- [x] 1.5 Visual spot-check: depth effect and occlusion unchanged after the extraction
