---
topic: Untested depth-rendering formula (test-plan refresh)
researcher: claude-sonnet-5
change_id: test-plan-refresh-2026-11-12
branch: master
commit: 5295dbf823420e4f879c3d3be1dd08f299f6bce5
date: 2026-11-12
last_updated: 2026-11-12
last_updated_by: claude-sonnet-5
---

## Research Question

`pseudo-3d-depth-rendering` and `ui-simulation-tokens` are both `impl_reviewed`/shipped
but never archived, so `/10x-test-plan`'s original discovery (which only scans
`context/archive/`) never saw them as existing risk surface. Ground a new
test-plan risk: the depth-to-scale projection formula and back-to-front draw
order in `simulation-canvas.tsx` have zero automated tests, only manual visual
verification per `pseudo-3d-depth-rendering/plan.md` Phase 2.

## Summary

The formula and sort are real, currently-untested production code — confirmed by
grep (zero matches for `REFERENCE_DEPTH`/`MIN_SCALE`/`MAX_SCALE` across every
`*.test.*` file in `src/`). The domain's `z` range makes the one plausible
numeric failure mode (division blow-up as the denominator approaches zero)
unreachable in practice — `z` is toroidally wrapped into `[0, 200)`, so the
denominator `REFERENCE_DEPTH + z` (`100 + z`) always sits in `[100, 300)`. The
"local copy" sort claimed by the plan is accurate in effect (a freshly
constructed `DrawEntity[]`, not the original `boids`/`predators` props), so no
caller-visible mutation bug exists either. The formula and sort are **not**
exposed as independently callable pure functions today — they are inlined
inside `drawScene`, which takes a live `CanvasRenderingContext2D` and intermixes
the calculation with draw calls. Confirmed real risk: a regression here (wrong
clamp direction, broken sort comparator, swapped `MIN_SCALE`/`MAX_SCALE`) is
currently only catchable by eyeballing the render — exactly what `test-plan.md`
§7 says the project does not want to leave unguarded ("I do not want to skip
anything").

## Detailed Findings

### The formula, as shipped

`src/app/simulation/_components/simulation-canvas.tsx:42-47` — constants:
```
REFERENCE_DEPTH = 100   // depth at which scale == 1
MIN_SCALE = 0.3
MAX_SCALE = 2.0
```

`simulation-canvas.tsx:89-104` — inside `drawScene`, per entity:
```
sorted = entities.sort((a, b) => b.z - a.z)   // farthest (largest z) first
...
scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + entity.z)))
```
then `BOID_LENGTH * scale` / `BOID_WIDTH * scale` (or the predator equivalents)
are used as the triangle/diamond half-length and half-width passed to
`ctx.moveTo`/`ctx.lineTo` (`simulation-canvas.tsx:106-125`, not fully re-read
beyond line 120 but the pattern is established by line 114-120).

This matches `pseudo-3d-depth-rendering/plan.md:118-121`'s contract exactly
(same formula, same clamp bounds, same constant names) — the implementation
did not drift from the plan.

### `entities` is a fresh array, not an alias of the props

`simulation-canvas.tsx:80-88` builds `entities` via
`[...boids.map(...), ...predators.map(...)]` — a brand-new array distinct from
the `boids`/`predators` function parameters. `.sort()` (`:91`) mutates this new
array in place, which is harmless: nothing downstream re-reads the original
`boids`/`predators` arrays expecting their pre-sort order within this function
call. The plan's phrase "sorts a local copy of boids" (`plan.md:121`) is
imprecise (it's a freshly merged boid+predator array, not literally
`boids.slice()`), but the described *effect* — no caller-visible mutation — is
correct.

### `z`'s real range rules out the division-blow-up scenario

`src/server/simulation/boids.ts:35` defines `Z_DEPTH_RANGE = 200`. Every write
to a boid's or predator's `z` field goes through `wrap(value, Z_DEPTH_RANGE)`
(`boids.ts:90-93`: `value % range`, shifted positive if negative) — confirmed
at the two creation sites (`boids.ts:120`, `:136`, both `rng() * Z_DEPTH_RANGE`,
which is already in `[0, 200)`) and the per-tick update sites (`boids.ts:353`,
`:416`, both `wrap(... , Z_DEPTH_RANGE)`). So `boid.z`/`predator.z` is always in
`[0, 200)`. Therefore `REFERENCE_DEPTH + entity.z` (`100 + z`) is always in
`[100, 300)` — never near zero, never negative. The theoretical "does the
formula blow up or flip sign near the boundary" risk is **not reachable** under
this project's domain constraints; a test asserting protection against it would
be testing a safeguard the domain already makes unnecessary (the challenger
pass in `/10x-test-plan`'s own rules calls this out: "if breaking the risk
would require adding a safeguard first... the risk is speculative").

The real, non-speculative risk is narrower and purely behavioral: the clamp's
**direction and bounds** (nearer = bigger, farther = smaller, within
`[0.3, 2.0]`) and the **sort direction** (farthest drawn first) are exactly the
kind of thing a careless edit (e.g. swapping `Math.min`/`Math.max`, flipping the
sort comparator, or swapping `MIN_SCALE`/`MAX_SCALE`) would silently invert —
and nothing but a human eyeballing the canvas would catch it today.

### Not independently testable without extraction

`drawScene` (`simulation-canvas.tsx:71-76`) takes a live
`CanvasRenderingContext2D` as its first parameter and the formula/sort live
inside its body, interleaved with `ctx.save()`/`ctx.translate()`/`ctx.rotate()`/
`ctx.moveTo()`/`ctx.lineTo()` calls. There is no exported, DOM-free function
today that returns "the scale for this `z`" or "the entities in draw order" —
unlike `boids.ts`'s `runTick` (extracted in the `testing-composed-pipeline-correctness`
rollout phase specifically so step composition could be unit-tested without a
canvas) or `single-run-lifecycle.ts`/`multi-run-lifecycle.ts` (extracted in
`testing-render-loop-lifecycle` for the same reason — see `test-plan.md` §6.1–6.2
for the established extraction pattern in this project). Testing today's
`drawScene` as-is would require a mocked `CanvasRenderingContext2D` and
reverse-engineering the scale/order from `moveTo`/`lineTo` call arguments —
possible (the existing `simulation-canvas.test.tsx` already stubs
`HTMLCanvasElement.prototype.getContext`), but indirect compared to extracting
the formula and sort into plain functions first, consistent with this
project's established cookbook pattern.

**This bears directly on `/10x-tdd` eligibility.** The scale formula and sort
order already execute in production (confirmed above, matching the plan's
shipped contract exactly). `/10x-tdd`'s own eligibility gate stops when "the
core implementation for the phase is already present" — and it is: nothing
about *extracting* already-shipped behavior into a named function changes
whether that behavior already exists. This phase is a retrofit (write tests for
code that already ships), the same category as rollout Phases 1–4 (all of which
used `/10x-implement`, not `/10x-tdd`, for exactly this reason). A later plan
phase should expect `/10x-tdd` to redirect to `/10x-implement` here, not treat
that redirect as a tool malfunction.

### No existing test covers this

```
grep -rln "REFERENCE_DEPTH\|MIN_SCALE\|MAX_SCALE" --include="*.test.*" src/
```
returned no matches (exit code 1). `src/app/simulation/_components/simulation-canvas.test.tsx`
exists (added in `testing-render-loop-lifecycle`) but its one `describe` block
(`"SimulationCanvas RAF scheduling shell"`, line 58) covers only RAF
double-step scheduling, not `drawScene`'s formula or draw order — no overlap
with this risk.

## Code References

- `src/app/simulation/_components/simulation-canvas.tsx:42-47` — `REFERENCE_DEPTH`/`MIN_SCALE`/`MAX_SCALE` constants
- `src/app/simulation/_components/simulation-canvas.tsx:71-125` — `drawScene`: entity merge, sort, scale formula, draw calls
- `src/server/simulation/boids.ts:35` — `Z_DEPTH_RANGE = 200`
- `src/server/simulation/boids.ts:90-93` — `wrap()`, the toroidal-wrap helper that bounds every `z` write
- `src/server/simulation/boids.ts:120,136,353,416` — every site that writes `z`, all routed through `wrap(..., Z_DEPTH_RANGE)` or already in `[0, 200)` at creation
- `context/changes/pseudo-3d-depth-rendering/plan.md:107-144` — Phase 2's original contract (matches shipped code) and its success criteria (automated: typecheck/lint only; manual: four visual-inspection bullets, no automated assertion on the formula itself)
- `src/app/simulation/_components/simulation-canvas.test.tsx:58-` — existing test's scope (RAF scheduling only)

## Architecture Insights

This project has an established pattern (test-plan.md §6.1, §6.2) of extracting
inline, DOM/canvas-entangled logic into plain, exported, unit-testable
functions before testing it (`runTick`, `single-run-lifecycle.ts`,
`multi-run-lifecycle.ts`). The depth-scale formula and draw-order sort are a
clean fit for the same pattern: both are pure (`z` and the clamp constants in,
a number or an ordering out), with zero DOM dependency once separated from the
`ctx.*` calls that currently surround them in `drawScene`.

## Historical Context (from prior changes)

`pseudo-3d-depth-rendering/plan.md`'s own Phase 2 success criteria (`plan.md:126-141`)
list only `npm run typecheck` and `npm run check` as automated checks; every
other success criterion is manual visual inspection. This was a conscious
choice at the time (a 3D rendering feature, reviewed and approved as-is — see
`context/changes/pseudo-3d-depth-rendering/reviews/`), not an oversight this
research is re-litigating — it is simply a gap `test-plan.md`'s original
discovery missed because the change was never archived.

## Related Research

- `context/changes/testing-composed-pipeline-correctness/research.md` — the
  precedent for extracting canvas-adjacent logic into a testable pure function
  (`runTick`)
- `context/changes/testing-render-loop-lifecycle/research.md` — the precedent
  for the same extraction pattern applied to RAF-loop lifecycle decisions

## Open Questions

None — the formula, its domain bounds, the absence of existing coverage, and
the extraction precedent are all directly confirmed above.
