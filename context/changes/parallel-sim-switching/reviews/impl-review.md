<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Parallel Simulation Switching Implementation Plan

- **Plan**: context/changes/parallel-sim-switching/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated) — manual rows still pending, see below |

## Automated success criteria (re-verified independently)

- `npm run typecheck` — PASS
- `npm run check` — PASS
- `npx vitest run` (full suite) — PASS (4 files, 36/36 tests)

## Manual verification status

Progress rows 2.3, 2.4, 3.4, 3.5, 3.6, 3.7 are still `[ ]` unchecked — no human has done the
manual pass on this change yet (unlike `predator-prey-dynamics`, which was already confirmed).
Not treated as a failure, but flagged: this change should not be considered done until those
are run.

## Drift detection summary

File independence from the concurrent `predator-prey-dynamics` change is confirmed exact —
the diff touches exactly the 7 files the plan names, none of the 6 S-02-owned files. "What
We're NOT Doing" is fully respected (no shared form/draw-routine extraction, no live
thumbnails, no predator/food params, no cross-reload persistence). One minor drift in Phase 2
(F3 below); everything else is a clean MATCH, including beneficial extra test coverage in
Phase 1 beyond the plan's 6 named invariants.

## Findings

### F1 — A failed stop mutation leaves a slot permanently stuck "running"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/multi/_components/multi-simulation-stage.tsx:126-141
- **Detail**: `finishedRunIdsRef` is set before the `stopRun` mutation settles, and the
  stepping loop permanently skips that slot from then on. But `markStopped`/`onFinished` only
  fires in `onSuccess`. If the mutation errors (network blip, expired session, server 500),
  the slot's status never flips to `"stopped"` — the UI shows "Running" forever, the canvas is
  frozen, a manual-stop click stays on "Stopping..." forever, and the slot can never be
  dismissed (`removeSlot` requires `status === "stopped"`). The single-run original
  (`simulation-canvas.tsx`'s `stop()`) calls `setStatus("stopped")` unconditionally before the
  mutation, always reaching a dismissable/retryable terminal state and surfacing
  `stopRun.error` to the user — this is a real regression against that existing guarantee.
- **Fix A ⭐ Recommended**: Add an `onError` handler to `stopSlot`'s `mutate` call that still
  invokes `onFinishedRef.current(slot.runId, <fallback score, e.g. undefined/null>)`, so the
  slot always reaches `"stopped"` and becomes dismissable; also clear
  `manualStopPendingRunId` on error.
  - Strength: Matches the single-run original's unconditional-terminal-state guarantee with a
    small, scoped change — no new state machine needed.
  - Tradeoff: Needs a product decision on what to show as the "score" for an errored run
    (e.g. "—" or "unknown").
  - Confidence: HIGH — directly mirrors an existing, working pattern in this same codebase.
  - Blind spot: None significant.
  - Decision: PENDING
- **Fix B**: Add a retry affordance instead — keep the slot `"running"`, surface a "Stop
  failed, retry" action.
  - Strength: Keeps `"running"` truthful (the server-side run may genuinely still be active).
  - Tradeoff: More UI work, and a slot stuck retrying occupies one of the 4 cap slots
    indefinitely if retries keep failing.
  - Confidence: MEDIUM — untested how often this path would realistically trigger.
  - Blind spot: Haven't verified server-side behavior if `stop` is retried after a prior
    partial failure.
- **Decision**: PENDING

### F2 — The 4-run cap is enforced only client-side, not on the server

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/server/api/routers/simulation.ts (start procedure); src/server/simulation/run-slots.ts:24-25
- **Detail**: `MAX_PARALLEL_RUNS = 4` — the cap the whole single-shared-loop performance design
  is built around — is enforced only in `addSlot` and derived client UI state (`atCap`
  hiding the form). `simulationRouter.start` has no check on how many `"running"` rows already
  exist for the current user. A second browser tab/window, or a direct tRPC call, bypasses the
  cap entirely. The "bounded worst-case total simulated objects" comment in `run-slots.ts` is
  not actually guaranteed server-side.
- **Fix A ⭐ Recommended**: Add a count check in `simulationRouter.start` — count rows where
  `userId = ctx.session.user.id AND status = 'running'`, reject (`BAD_REQUEST`) once it would
  exceed 4.
  - Strength: Closes the actual gap motivating this change's whole performance architecture.
  - Tradeoff: Adds one small indexed query to every `start` call.
  - Confidence: HIGH — straightforward, mirrors the existing FR-018 combined-cap pattern
    already used in the concurrent `predator-prey-dynamics` change for a similar guardrail.
  - Blind spot: None significant.
  - Decision: PENDING
- **Fix B**: Document in `plan.md`'s "Open Risks & Assumptions" that the cap is a client-only
  courtesy limit for this single-user hobby project, not a server-enforced guarantee, and
  accept the risk explicitly.
  - Strength: Zero code change, honest about current reality.
  - Tradeoff: Leaves the PRD's own stated guardrail genuinely unenforced against a determined
    multi-tab user — low real-world risk for a single-user app, but a conscious gap.
  - Confidence: HIGH — this is a straightforward risk-acceptance call, not a technical unknown.
  - Blind spot: None significant.
- **Decision**: PENDING

### F3 — Phase 2's planned `onStopRequested` prop wasn't built; Stop is self-contained instead

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/simulation/multi/_components/multi-simulation-stage.tsx:95-98, 230-256
- **Detail**: The plan's Phase 2 Contract calls for an `onStopRequested` callback prop for
  manual-stopping the active slot. The actual component instead owns a self-contained
  `manualStopRequestRef` + internal Stop `Button`, with no such prop in its signature.
  Functionally equivalent (a working Stop action on the active slot) and doesn't violate any
  "What We're NOT Doing" item or the file-independence constraint — a reasonable architecture
  simplification, not a defect.
- **Fix**: Update `plan.md`'s Phase 2 Contract text to describe the actual built architecture
  (self-contained Stop button, no `onStopRequested` prop) rather than leaving the plan
  describing a shape that was never built.
- **Decision**: PENDING

### F4 — Ref mirroring happens in the render body, not an effect

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/simulation/multi/_components/multi-simulation-stage.tsx:103-105
- **Detail**: `slotsRef.current = slots; activeRunIdRef.current = activeRunId;
  onFinishedRef.current = onFinished;` are assigned directly in the render body rather than
  inside a `useEffect`. Works correctly today (synchronous, idempotent under Strict Mode
  double-render) but is a render-phase side effect, non-idiomatic React.
- **Fix**: Move the three assignments into a `useEffect(() => { ... }, [slots, activeRunId, onFinished])`.
- **Decision**: PENDING
