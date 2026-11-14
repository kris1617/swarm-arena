<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Full scoring with save and resume

- **Plan**: context/changes/full-score-save-resume/plan.md
- **Scope**: Full plan (all 4 phases)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `stop` has no guard against targeting a server-owned run; `finishRun`'s write is unconditional

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts` (`stop`, ~line 255) / `src/server/simulation/server-run-registry.ts` (`finishRun`, ~line 104)
- **Detail**: `stop`'s only precondition is `run.status === "running"` — the same value `startServer` sets for a server-owned run. Nothing distinguishes a client-staged run from a server-owned one with a live registry entry. If `stop` were ever called against a server-owned `runId`, the row flips to `"stopped"` with a client-supplied score, but the registry's `LiveRun`/`setInterval` keep ticking until `maxDurationSeconds` elapses, at which point `finishRun`'s write (`db.update(...).set({status:"stopped", score, ...})`, no status guard — unlike every other write touched in this change) silently overwrites the earlier stop's score. Confirmed currently unreachable from the shipped UI (`simulation-canvas.tsx` only calls `stop` and is only mounted for client-staged runs; server-owned runs use `savePause`/`ServerRunViewer`), but it is a real boundary gap on a tRPC procedure reachable by any authenticated caller.
- **Fix A ⭐ Recommended**: Add an `isServerRunActive(input.runId)` check to `stop`, rejecting with `BAD_REQUEST` if true (server-owned runs must go through `savePause`/let-it-finish, not `stop`).
  - Strength: Closes the gap at the boundary where the ambiguity actually originates; mirrors the check `savePause` already uses.
  - Tradeoff: None significant — one added check, same shape as existing guards in this file.
  - Confidence: HIGH — identical pattern already proven in `savePause`.
  - Blind spot: None significant.
- **Fix B**: Add a status-guarded write to `finishRun` (`eq(status, "running")`), so a server-owned run already stopped by some other path can't be silently re-scored.
  - Strength: Defends the write itself, independent of how a bad state was reached.
  - Tradeoff: Doesn't close the interval-leak half of the gap (the registry would still tick a run the DB already considers stopped).
  - Confidence: MEDIUM — fixes the data-corruption symptom, not the root cause.
  - Blind spot: Interaction with the already-fire-and-forget `void finishRun(...)` call sites not fully traced.
- **Decision**: FIXED (Fix A) — added `isServerRunActive(input.runId)` check to `stop`; new test "rejects with BAD_REQUEST when the run is server-owned" added and passing.

### F2 — `survivingBoidGenes` has no upper bound, unlike its sibling fields in the same input

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts:281-297` (`stop` input schema)
- **Detail**: `cohesionSamples`, `foodRatioSamples`, and `phaseHistory` all carry `.min(1).max(50_000)`, explicitly commented as closing an unbounded-array resource surface. `survivingBoidGenes` (an array of 8-field objects, heavier per-element than a number) has neither bound, and is iterated multiple times in `computeGeneticDiversity` (7 field maps + 3 color maps). Same resource surface the sibling fields were bounded against, missed for this one.
- **Fix**: Add `.max(50_000)` to `survivingBoidGenes`'s array schema, matching the other three fields.
- **Decision**: FIXED — added `.max(50_000)`; new test "rejects an unbounded survivingBoidGenes array" added and passing.

### F3 — `computeGeneticDiversity`'s signature deviates from the plan's written contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/server/simulation/boids.ts:1165` vs. plan.md Phase 3 §3.2/§3.5
- **Detail**: The plan's "Changes Required" text literally specifies `computeGeneticDiversity(boids: BoidState[]): number`, but the implemented signature is `computeGeneticDiversity(genes: BoidGenes[]): number`. This is a deliberate, well-reasoned, and consistently-propagated decision (the code comment explains it lets the client-staged path send just genes over the wire; it's reflected in `stop`'s `survivingBoidGenes` field and `simulation-canvas.tsx`'s `buildStopInput`) — not a functional problem, but an undocumented deviation from the plan's own text.
- **Fix**: Add a short addendum note to `plan.md`'s Phase 3 "Changes Required" section recording the signature change and why, so the plan stays an accurate record.
- **Decision**: FIXED — addendum comment added to plan.md's Phase 3 contract text.

### F4 — `resumeServerRun` creates a seed-derived RNG it then fully discards

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/server/simulation/server-run-registry.ts:336-337`
- **Detail**: `createRng(snapshot.params.seed)` followed immediately by `rng.setState(snapshot.rngState)` is correct (verified: `setState` reassigns the closure's `state` directly, no seed-dependent residue survives) but the seed argument does no real work here — a future reader could mistake it for load-bearing and "simplify" it away, silently reintroducing the exact resume-from-scratch bug this phase's own round-trip test was built to catch.
- **Fix**: Add a one-line comment noting `params.seed` is only needed because `ServerRunSnapshot` carries full `params`; `setState` below fully overrides whatever it produces.
- **Decision**: FIXED — clarifying comment added.

### F5 — `parameter-ranges.ts` is a new file not named in the plan

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/server/simulation/parameter-ranges.ts`
- **Detail**: Phase 2's plan didn't name this file, but it's a straightforward constants extraction (`RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES`/`DEFAULT_MAX_OBJECT_COUNT`) consistent with the plan's intent and left to implementer's judgment on file layout. Benign.
- **Fix**: None needed — no action required.
- **Decision**: SKIPPED (no action warranted)

## Not flagged as findings (reviewed, found adequate)

- Ownership/authz boundary: `watch`, `savePause`, `resume`, `stop` all check `run.userId !== ctx.session.user.id` → `FORBIDDEN` before acting; `getParameterRanges`/`updateParameterRanges` correctly split `protectedProcedure`/`adminProcedure`; `/admin/settings/page.tsx`'s page-level redirect is defense in depth, not a gap.
- Race-safety: traced concurrent `resume`/`resume` and `savePause`/`savePause` races — both fail safe (second call's `resumeServerRun`/`snapshotServerRun` throws/returns `undefined` before any DB write, since registry mutation is synchronous). The guarded `.update().where(and(eq(id,...), eq(status, expected)))` + `.returning()` pattern is present and consistent with `stop`'s existing pattern.
- `resumeServerRun` restores RNG via `setState`, not re-seed-only — confirmed correct (this is what F4 is about the *clarity* of, not the correctness of).
- Schema change (`"saved"` status value, nullable `savedState` column) is additive and safe against existing rows.
- Pattern compliance across all new functions (`rng.ts`, `parameter-ranges.ts`, `boids.ts`'s new exports, `server-run-registry.ts`'s new exports) follows existing file conventions — no substantive mismatches found.
- All other Phase 1-4 "Changes Required" items verified as MATCH against the plan's stated intent; no skipped items; no "What We're NOT Doing" violations (client-staged Save/Resume untouched, `stop`'s terminal behavior untouched for its intended client-staged callers, `computeCohesion`'s rendering use untouched).
- Automated success criteria: `npm run typecheck`, `npm run check`, `npm test` (160/160) all pass as of this review.
