# Deduplicate the three wasEverX retry-write branches — Implementation Plan

## Overview

`server-run-registry.ts` has three structurally identical "retry-write-on-next-tick" blocks (`wasEverThrottledWritten`, `wasEverFoodImbalancedWritten`, `wasEverPredatorTribeImbalancedWritten`), copy-paste-propagated across three separate feature changes. None has a test forcing the DB write to fail and verifying the retry actually happens. This plan characterizes current behavior first, then extracts one shared helper, test-first, per `context/changes/refactor-opportunities-refresh/research.md`'s ranked Candidate A.

## Current State Analysis

- Three near-identical blocks at `src/server/simulation/server-run-registry.ts:781-801` (`wasEverThrottled`), `:809-825` (`wasEverFoodImbalanced`), `:835-852` (`wasEverPredatorTribeImbalanced`) — each: guard on a per-tick condition + a write-once flag, fire-and-forget `db.update(...).set({ <column>: true })`, latch the `*Written` flag only on success (`.then`), log-and-swallow on failure (`.catch`) so the next qualifying tick retries.
- `grep -c` for all three names against `server-run-registry.test.ts` returns 0 — none is tested today.
- An existing `sabotagingDb` Proxy pattern (`src/server/api/routers/simulation.test.ts:899-930,1076-1106`) already forces a specific DB write to fail inside a test — the exact fixture shape this plan's Phase 1 needs, confirmed reusable.
- The three columns (`wasEverThrottled`, `wasEverFoodImbalanced`, `wasEverPredatorTribeImbalanced`) are plain boolean columns on `simulationRuns` (`src/server/db/schema.ts`), set via `db.update(simulationRuns).set({ [column]: true })` — no schema change needed, a computed property key works directly with Drizzle's `.set()`.

## Phase 1: Characterize current behavior (tests only, no production change)

### Changes Required:

**`src/server/simulation/server-run-registry.test.ts`**
- **Intent**: Prove the current (still-duplicated) retry-write behavior for all 3 branches before touching production code, per the "add a test before you touch" rule. Each test forces the DB write to fail once via the existing `sabotagingDb` pattern, confirms the `*Written` flag stays `false` after the failure (so the next qualifying tick will retry), then lets the write succeed and confirms the flag latches `true`.
- **Contract**: 3 new test cases, one per branch (`wasEverThrottled`, `wasEverFoodImbalanced`, `wasEverPredatorTribeImbalanced`). Trigger the target condition via `vi.spyOn(singleRunLifecycle, "computeSingleRunTick")` (an established pattern already used repeatedly in this same test file, e.g. lines 276, 402, 2614) mocked to return a result with the relevant `wasXThisTick` flag `true` — simpler and more deterministic than constructing simulation parameters that organically trigger each condition. Combine with a `sabotagingDb` proxy that fails the specific `simulationRuns` update once, matching the existing fixture's shape in `simulation.test.ts:899-930`.

### Success Criteria:

#### Automated Verification:
- New tests pass against **current** (still-duplicated) production code: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:
- Read the 3 new tests and confirm each actually forces a failure on the *correct* column's update (not a different one) — a sabotage fixture targeting the wrong column would pass for the wrong reason

## Phase 2: Extract the shared helper and swap all 3 call sites

### Changes Required:

**`src/server/simulation/server-run-registry.ts`**
- **Intent**: Replace the 3 hand-copied blocks with one shared helper, called 3 times with a different column name and success callback. No behavior change — same fire-and-forget write, same latch-only-on-success, same log-and-swallow-on-failure.
- **Contract**: a module-scoped helper taking the db, runId, the target column name (restricted to the 3 boolean `wasEverX` columns via a union type), and an `onSuccess` callback that mutates the in-memory `run.*Written` flag:
  ```ts
  function latchOnceWithRetry(
  	db: Database,
  	runId: number,
  	column:
  		| "wasEverThrottled"
  		| "wasEverFoodImbalanced"
  		| "wasEverPredatorTribeImbalanced",
  	onSuccess: () => void,
  ): void {
  	void db
  		.update(simulationRuns)
  		.set({ [column]: true })
  		.where(eq(simulationRuns.id, runId))
  		.then(onSuccess)
  		.catch((error: unknown) => {
  			console.error(
  				`server run ${runId}: failed to write ${column}=true:`,
  				error,
  			);
  		});
  }
  ```
  Each of the 3 call sites becomes `latchOnceWithRetry(db, runId, "wasEverThrottled", () => { run.wasEverThrottledWritten = true; })` (and the analogous two), replacing the full `.then().catch()` block inline.

**`src/server/simulation/server-run-registry.test.ts`**
- **Intent**: Once all 3 call sites are proven identical through the shared helper, the 3 near-duplicate characterization tests from Phase 1 become one parameterized test, per the "redundant copies" anti-pattern rule (one parameterized test per property, not near-identical copies).
- **Contract**: collapse the 3 Phase-1 tests into one `it.each`-style parameterized test over the 3 `(condition, column, writtenFlag)` tuples, keeping the same assertions (stays `false` on failure, latches `true` on success).

### Success Criteria:

#### Automated Verification:
- Phase 1's 3 tests (or their Phase 2 parameterized replacement) pass against the **new** helper-based code: `npx vitest run src/server/simulation/server-run-registry.test.ts`
- Full suite still passes: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:
- Diff the 3 old blocks against the 3 new call sites — confirm no behavior changed (same column, same condition, same flag), only the shared shape moved into one helper

## What We're NOT Doing

- Not touching Candidate B (client bundling server simulation code into the browser) — explicitly scoped out this round per `research.md`'s ranking (larger, riskier, no evidence of current harm).
- Not adding a guard test for the hand-synced composed-tick duplication (`boids.ts`'s `runTick` vs. `simulation-canvas.tsx`'s inline sequence) — a real, separate finding from `research.md`, deliberately out of this plan's scope (one safe change at a time).
- Not changing the `simulationRuns` schema or adding a migration — the 3 columns already exist and are unchanged by this refactor.
- Not adding tests for `camera.ts`/`use-camera.ts` or `startServerRun`'s double-registration guard — those are test-coverage gaps, not the code-structure refactor this plan targets; logged separately in `sim-engine-feature-refresh/research.md` §2.2 for a future test-plan rollout phase.

## Progress

### Phase 1: Characterize current behavior (tests only, no production change)

#### Automated

- [ ] 1.1 New tests pass against current (still-duplicated) production code
- [ ] 1.2 Typecheck passes
- [ ] 1.3 Lint passes

#### Manual

- [ ] 1.4 Each test forces a failure on the correct column's update

### Phase 2: Extract the shared helper and swap all 3 call sites

#### Automated

- [ ] 2.1 Tests pass against the new helper-based code
- [ ] 2.2 Full suite still passes
- [ ] 2.3 Typecheck passes
- [ ] 2.4 Lint passes

#### Manual

- [ ] 2.5 Diff confirms no behavior changed across the 3 call sites
