# Depth-Rendering Formula Test Coverage — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-11-12/plan.md`
> Research: `context/changes/test-plan-refresh-2026-11-12/research.md`

## What & Why

This is a `/10x-test-plan --refresh` finding: `pseudo-3d-depth-rendering`
shipped (`impl_reviewed`) but was never archived, so the original test-plan
discovery — which only scans `context/archive/` — never saw its risk
surface. The depth-to-scale projection formula and back-to-front draw order
have zero automated tests today, only manual visual checks. This phase adds
that coverage and records the gap as rollout Phase 6 in `test-plan.md`.

## Starting Point

`drawScene` (`simulation-canvas.tsx:71-125`) inlines a scale formula
(`Math.min(MAX_SCALE, Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + z)))`)
and a sort comparator (`(a, b) => b.z - a.z`) directly alongside live
`CanvasRenderingContext2D` calls — neither is independently testable without
extraction. Research confirmed the formula matches its original shipped
contract exactly, the domain's `z` range (`[0, 200)`, enforced by `boids.ts`'s
`wrap()`) makes the one theoretical numeric failure mode (division blow-up)
unreachable, and no existing test touches this code at all.

## Desired End State

Two pure, exported, unit-tested functions (`computeDepthScale`,
`compareByDepth`) that `drawScene` calls instead of inlining the logic —
identical runtime behavior, now protected against a future silent inversion
(swapped clamp direction, flipped sort, swapped constants).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test the division-blow-up scenario? | No | `z` is domain-bounded to `[0, 200)`, making it unreachable — testing it would be a speculative/oracle-problem test | Research (challenger-pass rule) |
| Extraction vs. mock-canvas testing | Extract pure functions first | Matches this project's own established pattern (`runTick`, lifecycle cores) rather than reverse-engineering scale/order from mocked `ctx.*` call args | Plan (precedent-grounded) |
| TDD or implement? | `/10x-implement` | The formula/sort already ship in production — there's no "before the code exists" state for `/10x-tdd`'s red step to lead | Plan (research-confirmed) |
| New test file location | `simulation-canvas.tsx`'s own directory, `.test.ts` not `.tsx` | Pure-function test, zero React/DOM involvement, follows existing co-location convention | Plan |

## Scope

**In scope:**
- Extract `computeDepthScale(z)` and `compareByDepth(a, b)` as named, exported, pure functions
- Oracle-derived unit tests for both (clamp bounds, near/far direction, sort order)
- Wire `drawScene` to call the extracted functions (behavior-identical)
- `test-plan.md` §2 (new risk #6), §3 (new Phase 6, `complete`), §6 (new §6.6 cookbook entry)

**Out of scope:**
- Any change to the formula's constants or visual output
- A canvas/pixel-level visual regression test
- `ui-simulation-tokens` (the other unarchived-but-shipped change this refresh also surfaced — a separate future risk if needed)

## Architecture / Approach

Single phase, one file edited (`simulation-canvas.tsx`) plus one new test
file. No new module boundary needed — the extracted functions live in the
same file, exported for the test to import.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract, test, wire, update test-plan.md | Oracle-tested depth-scale/sort-order functions, test-plan.md updated | Writing an assertion that mirrors the implementation's own arithmetic instead of deriving it from the documented contract (oracle problem) — the plan explicitly flags this for the implementer to avoid |

**Prerequisites:** None beyond what's already shipped.
**Estimated effort:** Single session, single phase.

## Open Risks & Assumptions

- This plan's own arithmetic example for "what z gives scale 1.0" is
  explicitly marked for the implementer to re-derive from the actual formula
  rather than trust at face value — a deliberate guard against the plan
  itself becoming a copied-output oracle problem.
- If `/10x-tdd` is attempted on this phase, expect it to redirect to
  `/10x-implement` via its own eligibility gate (implementation already
  exists) — this is correct, not a sign the plan is wrong.

## Success Criteria (Summary)

- `computeDepthScale`/`compareByDepth` are extracted, exported, and covered
  by oracle-derived unit tests that would fail on a swapped clamp/sort/constant
  regression.
- `drawScene`'s visual output is unchanged (confirmed by manual spot-check).
- `test-plan.md` §2/§3/§6 reflect the new risk, the completed rollout phase,
  and the new cookbook pattern.
