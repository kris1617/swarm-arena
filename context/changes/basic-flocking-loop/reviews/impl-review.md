<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Basic flocking loop (S-01)

- **Plan**: context/changes/basic-flocking-loop/plan.md
- **Scope**: Full plan (3 of 3)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 3 warnings, 5 observations

## Note on review method

This plan closed in Nov 2026; its files (`boids.ts`, `simulation.ts`,
`simulation-canvas.tsx`, `page.tsx`) have since been extensively built on by
S-02 (predator-prey) and S-05 (parallel-sim-switching). Comparing *current*
file content against this plan's contract would mostly surface legitimate
later work, not this plan's own quality — so plan-drift was checked against
the diffs of the three commits that actually closed it (`200fd51`,
`362d37a`, `aa5e0cf`), while safety/pattern findings also cross-check
current state where relevant (e.g. whether a since-fixed issue is still
live today).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Summary

All three phases matched their contracts item-for-item in their closing
commits — types, functions, semantics, DB schema, auth/ownership checks, and
UI wiring all verified against the actual diffs. Automated criteria re-run
live today: `npm run typecheck`, `npm run check`, `npx vitest run
src/server/simulation/boids.test.ts` (25/25) all pass. Manual criteria were
already checked `[x]` with SHAs in `## Progress` at the time; not
re-performed now since the live app has moved far past this slice (predators,
parallel runs) and a literal S-01-shaped manual re-test no longer applies.

## Findings

### F1 — Commit aa5e0cf's message claims boids.ts fixes that aren't in any commit of this plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — historical record only; the underlying bugs are
  confirmed fixed in current code, just not by this plan
- **Dimension**: Safety & Quality (process integrity)
- **Location**: commit `aa5e0cf`'s message vs. `src/server/simulation/boids.ts`
- **Detail**: The commit message lists six fixes ("unnormalized
  cohesion/alignment … no overlap floor … no cruise-speed floor … weak
  steering force … duplicate distance computation … boidCount clamp
  mismatch") found during Phase 3's manual verification. Only the last one
  (the client/server clamp mismatch, in `page.tsx`) appears in that commit's
  actual diff. `boids.ts` was not touched by `362d37a` or `aa5e0cf` —
  confirmed via `git log --follow -- src/server/simulation/boids.ts`, which
  shows no commit between `200fd51` (Phase 1) and `210dcf7` (S-02) touches
  the file at all. Checked current `boids.ts`: normalization
  (`alignMag`/`cohMag` division), a `MIN_SPEED` cruise floor, and an overlap
  push-apart mechanism all genuinely exist today — so the five claimed
  domain-logic fixes did eventually land, just as an incidental side effect
  of S-02's full steering-math rewrite, uncredited to this plan.
- **Fix**: None needed on current code (already correct). Noted in
  `context/foundation/lessons.md` as a process reminder: a commit message
  claiming a fix should be checked against its own diff before being
  trusted, especially when "found during manual verification" doesn't name
  which file the fix landed in.
- **Decision**: ACCEPTED-AS-RULE: "Verify a claimed commit-message fix is
  actually in that commit's diff" (added to lessons.md). Also re-verified
  current `boids.ts` line by line (not just grep): normalization
  (`alignMag`/`cohMag` division, with an explicit comment naming the exact
  failure mode this fixes), the `resolveOverlaps()` hard positional
  correction, the `MIN_SPEED` cruise floor, and the single-O(n)-pass
  distance computation (explicit comment confirms it replaced the
  duplicate-pass bug) are all genuinely, correctly present — not just
  superficially matching a grep pattern.

### F2 — `start`'s `maxDurationSeconds` has no server-side upper bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision, fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts` (`start`'s input schema, currently `z.number().int().positive()`)
- **Detail**: A client can request an arbitrarily long run. Combined with no
  reaper for abandoned runs (explicitly out of scope per this plan's own
  "What We're NOT Doing"), this compounds the orphaned-row surface area
  somewhat, though it was never the stated concern of this slice.
- **Fix**: Add a reasonable upper bound, e.g. `.max(600)` (10 minutes),
  matching the spirit of `boidCount`'s existing `.max(500)`.
- **Decision**: FIXED — `.max(600)` added to `maxDurationSeconds`'s zod
  schema, test-first (new test "rejects an unbounded maxDurationSeconds",
  red before, green after). Full suite re-verified green (103/103).

### F3 — `stop`'s `cohesionSamples` array has a lower bound but no upper bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts` (`stop`'s input schema, `z.array(...).min(1)`)
- **Detail**: A client could submit an arbitrarily large array in one `stop`
  call. Low real-world risk (one request, no loop), but cheap to close.
- **Fix**: Add `.max(n)` sized to the longest allowed run's tick count (ties
  naturally to F2's `maxDurationSeconds` cap if that's added).
- **Decision**: FIXED — `.max(50_000)` added to `cohesionSamples`'s zod
  schema (generous relative to the 600s cap even at a high sample rate),
  test-first (new test "rejects an unbounded cohesionSamples array", red
  before, green after). Full suite re-verified green (103/103).

### F4 — `simulation_run` table name breaks this schema's naming convention

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/server/db/schema.ts:92`
- **Detail**: Every other table name is a bare singular word or camelCase
  for multi-word (`post`, `user`, `account`, `session`,
  `verificationToken`); `simulation_run` is the only snake_case name.
  Renaming now would require a real migration against both the local and
  deployed database (not a free rename), for a purely cosmetic gain.
- **Fix**: None recommended — not worth a migration for this alone.
- **Decision**: SKIPPED

### F5 — No stop-on-unmount safety net for an abandoned run

- **Severity**: OBSERVATION (not a WARNING — explicitly disclaimed by this
  plan's own scope)
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: `src/app/simulation/_components/simulation-canvas.tsx` (unmount cleanup only calls `cancelAnimationFrame`, never `stopRun.mutate`)
- **Detail**: If a user navigates away mid-run, the DB row stays `"running"`
  forever. This is exactly what the plan's "What We're NOT Doing" names:
  "Cleanup or visibility for abandoned runs ... no timeout, cleanup job, or
  run-listing feature exists in this slice to surface or reap it." Confirmed
  intentional, not an oversight.
- **Fix**: None in this plan's scope. Worth a roadmap note for whenever
  abandoned-run cleanup becomes a real slice.
- **Decision**: SKIPPED

### F6 — Self-reported score has no server-side plausibility check beyond per-sample/elapsed-time clamps

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — acceptable for this slice's stated scope
- **Dimension**: Architecture
- **Location**: `src/server/api/routers/simulation.ts` (`stop`)
- **Detail**: `score` is computed from client-reported `cohesionSamples`/
  `elapsedTicks`, bounded only by per-sample `[0,1]` and an
  `elapsedTicks` clamp. A client could submit `cohesionSamples: [1]` to
  maximize score for a given elapsed time. The plan itself frames this as a
  deliberate simplification ("the scoring function itself is pure and
  deterministic, so server and client produce the same number from the same
  inputs") — it establishes a "trust client telemetry" pattern worth being
  aware of if a future slice adds competitive/leaderboard stakes, but this
  app has none today.
- **Fix**: None needed now.
- **Decision**: SKIPPED

### F7 — Duplicated stop-sequence code between the auto-stop and manual-stop paths

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/app/simulation/_components/simulation-canvas.tsx` (`stop()` inside the effect, `handleManualStop()` outside it — both still present in current code, now with more params than S-01 originally had)
- **Detail**: Both functions build the same `stopRun.mutate({...})` call
  shape. Still true today; the duplication has grown slightly as later
  slices added predator/food params to both call sites identically.
- **Fix**: Extract a shared `buildStopPayload()`/`stop(reason)` helper. Low
  value given the file is now built on by S-02/S-05/the Phase 4-5 error-
  handling work from the observability-audit change — a refactor here
  carries more regression risk than the DRY gain is worth right now.
- **Decision**: SKIPPED

### F8 — Redundant `if (!userId) throw UNAUTHORIZED` in `start`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `src/server/api/routers/simulation.ts` (`start`, early lines)
- **Detail**: `protectedProcedure` already guarantees `ctx.session.user` is
  non-null before the resolver body runs (`trpc.ts`'s middleware narrows the
  type). This check can never actually fire. Harmless, not misleading.
- **Fix**: None needed — defensive redundancy, not a bug.
- **Decision**: SKIPPED

## Already resolved by later work (not re-flagged as findings)

- `startRun`/`stopRun` having no `onError` logging, which an earlier draft
  of this review would have flagged, is **already fixed** —
  `simulation-canvas.tsx`'s `stopRun.useMutation` now has a logged `onError`
  (added in `fix-production-trpc-error-logging` Phase 4, commit `d3c5414`).
- The O(n²) neighbor-scan pattern in `stepBoids` is an accepted first-slice
  tradeoff at the enforced 500-boid cap; not re-flagged.
