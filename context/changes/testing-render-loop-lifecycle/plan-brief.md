# Render-Loop Lifecycle Safety Net — Plan Brief

> Full plan: `context/changes/testing-render-loop-lifecycle/plan.md`
> Research: `context/changes/testing-render-loop-lifecycle/research.md`

## What & Why

This is rollout Phase 2 of `context/foundation/test-plan.md`: close the gap identified as Risk #4 — both canvas tick loops' lifecycle decisions (stop conditions, active-slot redraw, no double-step) are untested, fused inline inside RAF/canvas closures with zero coverage under `src/app/`. Research confirmed both loops have a separable pure decision core, extractable with zero new dependencies, plus one genuine gap pure extraction alone can't close: whether the RAF-scheduling shell itself calls that core exactly once per tick.

## Starting Point

`simulation-canvas.tsx` and `multi-simulation-stage.tsx` each inline their lifecycle decisions inside a `useEffect`/RAF callback. Phase 1 already extracted the pure simulation math (`runTick`) for the single-run loop, but the surrounding lifecycle logic (dt computation, stop conditions, next-state bookkeeping) is still inline in both files. No DOM-testing infrastructure exists anywhere in this project.

## Desired End State

Two new DOM-free modules (`single-run-lifecycle.ts`, `multi-run-lifecycle.ts`) each hold one component's lifecycle decision core, tested directly. Both components call their respective extracted function. Two new shell-wiring smoke tests (using happy-dom, this project's first DOM-environment dependency) prove the RAF scheduling itself doesn't double-step.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Multi-run state model | Pure `Record<number, RunState>`, caller writes back | Matches `run-slots.ts`'s existing immutable-update convention exactly, rather than keeping the current `Map` mutation | Plan (user-confirmed) |
| Shell-wiring test scope | Yes — add minimal RAF/canvas mocking | Closes the one gap pure-function tests can't reach (the scheduling wiring itself), accepting the cost of a first DOM dependency | Plan (user-confirmed) |
| DOM environment | happy-dom + raw `react-dom/client` (no `@testing-library/react`) | Lighter weight, keeps the new dependency surface to one package for a scheduling-count smoke test | Plan (user-confirmed) |
| Phase granularity | 4 phases — extraction and shell-wiring split per component | Smaller, independently-diagnosable commits; mirrors the risk that the new DOM dependency's first use (Phase 2) could surface issues separately from the second component's extraction (Phase 3) | Plan (user-confirmed) |
| File location | New sibling files (`single-run-lifecycle.ts`, `multi-run-lifecycle.ts`) | Keeps `boids.ts` (pure simulation math) and `run-slots.ts` (slot bookkeeping) each scoped to one responsibility, matching Phase 1's file-location precedent | Plan (user-confirmed) |

## Scope

**In scope:**
- `computeSingleRunTick` / `computeMultiRunTick` extraction + pure unit tests (12 cases total)
- Wiring both components to call their extracted function
- Two shell-wiring smoke tests proving no RAF double-step, using happy-dom + hand-rolled canvas/tRPC stubs
- `test-plan.md` §6.2 cookbook entry

**Out of scope:**
- Unifying the two lifecycle functions into one shared abstraction
- `@testing-library/react` or any canvas-rendering package
- Visual/pixel-output testing of either canvas
- Any change to simulation constants, formulas, or behavior
- Reconciling the single-run (predators+food) vs. multi-run (boids-only) scope asymmetry

## Architecture / Approach

Each component's `useEffect`/RAF closure shrinks to: read refs → call the extracted pure function → write results back into refs → draw → schedule next frame. The pure function is the only thing the new unit tests touch directly; the shell-wiring smoke tests mount the actual component with RAF/canvas/tRPC stubbed, and assert only on call counts, never on canvas output or network behavior.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract single-run lifecycle | `single-run-lifecycle.ts` + 5 tests; `simulation-canvas.tsx` wired | Fixture must correctly distinguish dt-clamp from first-tick-zero-dt — easy to conflate |
| 2. Single-run shell smoke test | happy-dom added; first shell-wiring test | This project's first DOM dependency — stub shape (tRPC + canvas context) must be exactly right or the component silently fails to mount |
| 3. Extract multi-run lifecycle | `multi-run-lifecycle.ts` + 7 tests; `multi-simulation-stage.tsx` wired | Modeling the `Map`→`Record` change correctly, including the `manualStopRequestId` consumption semantics |
| 4. Multi-run shell smoke test + cookbook | Second shell-wiring test; §6.2 written | Reusing Phase 2's stub setup correctly for a component with a different prop shape (slots array vs. single run) |

**Prerequisites:** Phase 1 (runTick) of the test-plan rollout, already shipped.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The shell-wiring smoke tests' exact RAF call-count assertions (once after mount, twice after one manual tick) assume neither component's effect schedules an extra frame anywhere else — if real behavior differs slightly, the assertion count may need a one-line adjustment during implementation; the underlying no-double-step principle stays the same.
- happy-dom's behavior with a hand-stubbed `getContext` is new territory for this project; if happy-dom imposes any unexpected constraint, Phase 2's manual-verification checkpoint exists specifically to catch anything the automated suite can't.

## Success Criteria (Summary)

- A future change to either tick loop's stop conditions, active-slot selection, or RAF scheduling will fail a test if it breaks the documented lifecycle contract.
- This project now has a working, minimal pattern (happy-dom + hand-rolled stubs) for testing RAF/canvas-dependent component wiring, without committing to a heavier testing-library stack.
