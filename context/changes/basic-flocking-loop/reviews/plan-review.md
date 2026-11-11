<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Basic flocking loop (S-01) Implementation Plan

- **Plan**: context/changes/basic-flocking-loop/plan.md
- **Mode**: Deep
- **Date**: 2026-11-11
- **Verdict**: REVISE (all findings fixed during triage — see Decisions)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 6/6 paths ✓, 5/5 symbols ✓, brief↔plan ✓ (`docs/reference/contract-surfaces.md` and `context/foundation/lessons.md` absent — both skipped silently).

## Findings

### F1 — FR-018 guardrail claimed but not actually enforced server-side

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — simulation router, `start` procedure
- **Detail**: `start`'s zod schema only required `boidCount` to be a positive integer, no upper bound — the hardcoded max-boid-count guardrail (Phase 3) was only a UI clamp, bypassable via a direct API call, contradicting "Performance Considerations"'s claim that the guardrail is addressed.
- **Fix**: Add `.max(500)` to `boidCount` in `start`'s zod input schema.
- **Decision**: FIXED — applied in plan.md's Phase 2 `start` contract.

### F2 — stop trusts client-reported score inputs with no validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — simulation router, `stop` procedure
- **Detail**: `stop` accepted `elapsedTicks`/`cohesionSamples` with no range or non-emptiness checks — empty samples array produces a `NaN` score, nothing bounded `elapsedTicks` to `maxDurationSeconds`, and `computeCohesion`'s own 0–1 contract wasn't enforced on what `stop` accepted.
- **Fix A ⭐ Recommended**: Validate and clamp at the boundary — zod bounds on the samples array/values, clamp `elapsedTicks` to `maxDurationSeconds` + tolerance before scoring.
  - Strength: Cheap, no new architecture.
  - Tradeoff: Still trusts reported samples reflect the real run, just bounds how wrong they can be.
  - Confidence: HIGH — standard boundary validation.
  - Blind spot: Doesn't stop plausible-but-fake samples within range.
- **Fix B**: Full server-side replay at `stop`, re-deriving cohesion samples independently via Phase 1's `stepBoids`.
  - Strength: Closes the trust gap entirely.
  - Tradeoff: Duplicates the tick loop server-side, uncosted CPU time.
  - Confidence: MED — mechanically simple but uncosted.
  - Blind spot: Performance of a long synchronous replay inside `stop` unverified.
- **Decision**: FIXED via Fix A — applied zod bounds + `elapsedTicks` clamp in plan.md's Phase 2 `stop` contract.

### F3 — FORBIDDEN error path (wrong user calling stop) has no verification step

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2
- **Detail**: `stop`'s contract promised a `FORBIDDEN` throw for a mismatched user, but neither Manual Verification nor Progress rows 2.4-2.6 checked for it.
- **Fix**: Add a Phase 2 manual verification bullet and matching Progress row 2.7.
- **Decision**: FIXED — added to plan.md's Phase 2 Manual Verification and Progress (2.7).

### F4 — Phase 3 contract specifies a call pattern the codebase doesn't use

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3
- **Detail**: Phase 3 said the component calls `api.simulation.stop.mutate({...})` directly; the only existing precedent (`src/app/_components/post.tsx:12,30`) uses the React Query hook pattern (`useMutation()` then `.mutate()`), confirmed by the `createTRPCReact` client which only exposes hook-based procedures.
- **Fix**: Rewrite the contract to `const stopRun = api.simulation.stop.useMutation()` then `stopRun.mutate({...})`.
- **Decision**: FIXED — applied in plan.md's Phase 3 contract.

### F5 — Abandoned runs stay status "running" forever, with no visibility

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Plan-wide ("What We're NOT Doing")
- **Detail**: A browser tab closing mid-run never calls `stop`; the row stays `status: "running"` indefinitely with no timeout, cleanup, or listing feature to surface it. Explicitly acceptable for S-01.
- **Fix**: Add a line to "What We're NOT Doing" naming this gap.
- **Decision**: FIXED — added to plan.md's "What We're NOT Doing".
