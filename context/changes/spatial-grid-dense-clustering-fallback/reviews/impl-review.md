<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Keep spatial-grid neighbor queries bounded when boids cluster densely

- **Plan**: context/changes/spatial-grid-dense-clustering-fallback/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-16
- **Verdict**: APPROVED (after fix)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING (fixed) |
| Success Criteria | PASS |

## Findings

### F1 — Missing regression test for `hasWarnedDenseClustering` legacy-snapshot fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/server/simulation/server-run-registry.test.ts
- **Detail**: `resumeServerRun` applies `snapshot.hasWarnedDenseClustering ?? false` (server-run-registry.ts) specifically to handle pre-existing DB rows that predate this field. Its three sibling post-hoc fields — `parameterChanges`, `populationDensitySamples`, `geneticDiversitySamples` — each get an explicit "legacy snapshot missing this key" regression test. No equivalent test existed for `hasWarnedDenseClustering`, even though the code's own comment explicitly frames it as following that exact pattern.
- **Fix**: Added a test mirroring the three siblings — builds a snapshot, strips the key entirely (not `undefined`, matching a real pre-change JSON blob), resumes, and asserts the run survives its next tick rather than crashing.
- **Decision**: FIXED (commit 3ef2938)

### Observations (no action needed)

- **Candidate-cap truncation always pays full sort cost** (spatial-grid.ts) — `queryRadius` sorts the entire pre-cap candidate array before truncating to 64; a partial-select would be asymptotically cheaper for a very dense cluster. The file's own comment already documents that sort order is load-bearing for `reproducePopulation`'s ascending-index contract, so this is a reasonable, already-documented trade-off, not an oversight. Not worth fixing without profiling evidence it's hot.
- **Per-tick warn-sink allocation** (boids.ts, `runTick`) — one fresh `{ triggered: false }` object per tick is negligible given `runTick` already allocates full new boid/predator arrays every tick.

## Verification

Both parallel review sub-agents (plan-drift detection, safety/pattern compliance) found full MATCH across all three phases: shared warn-sink confirmed as one genuine object instance (not four separate sinks), `stepPredators` confirmed untouched and correctly out of scope, `hasWarnedDenseClusteringRef` confirmed as a plain `useRef` (not `useState`) mirroring `lastTimestampRef`'s pattern. No drift, no missing items, no scope creep. No CRITICAL findings from either agent.

Automated gates re-verified after the fix: `npm run typecheck` PASS, `npm run check` PASS (1 pre-existing unrelated warning in `sidebar.tsx`), `npx vitest run src/server/simulation/server-run-registry.test.ts` 39/39 PASS, full suite `npx vitest run --no-file-parallelism` 363/363 PASS (confirms the intermittent parallel-worker `adminSettings`-contention failures seen under default parallel `npm test` are pre-existing and unrelated to this change).
