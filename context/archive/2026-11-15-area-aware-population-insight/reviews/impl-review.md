<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Area-aware population insight (5th score factor)

- **Plan**: context/changes/area-aware-population-insight/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-15
- **Verdict**: REJECTED
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Grounding

13 files changed, matching the plan's file list exactly (`git diff --name-only 7819066^..1039391`). Two parallel sub-agent passes: drift detection (17 planned items checked, 16 MATCH, 1 MISSING) and safety/pattern compliance (6 checked areas, 2 findings, rest clean). All automated gates (typecheck/lint/full suite) ran green at every phase boundary per the commit history; all 6 manual verification items were performed live by the assistant (real production tick core for 1.8/1.9; real seeded dev-DB data + real headless browser for 2.5/2.6/3.5/3.6) with evidence recorded in `## Progress`.

## Findings

### F1 — Resuming a pre-S-25 saved run crashes on its next tick

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/simulation/server-run-registry.ts:422` (`resumeServerRun`)
- **Detail**: A `simulationRuns.savedState` row written by `savePause` before this change shipped has no `populationDensitySamples` key. `resumeServerRun` does an unchecked cast (`run.savedState as ServerRunSnapshot`) and copies `snapshot.populationDensitySamples` (`undefined`) straight onto the new `LiveRun`. On the very first tick, `single-run-lifecycle.ts:137`'s `[...state.populationDensitySamples, rawDensity]` throws on `undefined`. `tick()`'s try/catch swallows it and calls `finishRun(runId, { score: null })` — the resumed run silently terminates with a null score and no history, logged only via `console.error`. Every other backward-compat path in this same change (`getRunsComparison`, `listLeaderboard`) correctly guards with `Array.isArray(...)`; this is the one spot that doesn't.
- **Fix**: In `resumeServerRun`, default the field: `populationDensitySamples: snapshot.populationDensitySamples ?? []` — same guard posture already used for backward compatibility elsewhere in this change.
- **Decision**: FIXED (commit dc0ae4a) — regression test reproduces the exact crash on a missing-key snapshot; deliberate-break check confirmed red before the fix, green after.

### F2 — Plan-called-for test assertion missing from single-run-lifecycle.test.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/server/simulation/single-run-lifecycle.test.ts`
- **Detail**: Phase 1's Success Criteria explicitly called for "a new assertion that `populationDensitySamples` grows by one raw-density value per tick, using the tick's `worldSize`." `buildState()` was updated to default the field to `[]`, but no `it()` block asserts on its growth or computed value — the per-tick raw-density computation (`single-run-lifecycle.ts:134-140`) is only indirectly covered via `server-run-registry.test.ts`/`simulation.test.ts`, not at its own source. Progress row 1.4 is checked off with a SHA even though this specific assertion wasn't added.
- **Fix**: Add a test to `single-run-lifecycle.test.ts` asserting `result.populationDensitySamples` grows by one element per tick and equals `(boids.length + predators.length) / (worldSize.x * worldSize.y * worldSize.z)` for the known fixture state.
- **Decision**: FIXED (commit dc0ae4a) — added with a predator fixture and exact (`toBe`) equality; the first attempt used `toBeCloseTo` and the deliberate-break check caught that its default precision couldn't distinguish values around 1e-7.

### F3 — listLeaderboard fetches full history JSON for up to 50 rows to derive one boolean

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/server/api/routers/simulation.ts:590-623`
- **Detail**: `scoredWithAreaFactor` is derived by selecting the entire `history` column for up to 50 rows, then discarding it. `history` embeds several sample arrays each bounded at 50,000 elements — for long/high-tick runs this is a non-trivial JSON payload pulled from SQLite and serialized through tRPC on every leaderboard view, solely to answer `Array.isArray(...)`. No prior `listLeaderboard` query touched `history`; `.limit(50)` itself is correctly preserved.
- **Fix A ⭐ Recommended**: Accept as documented follow-up, no code change now.
  - Strength: Matches this plan's own deliberate "no migration" posture (schema-less JSON column, no new Drizzle migration) — the plan already traded a small amount of query cost for avoiding schema churn. At SQLite + personal-project scale with a 50-row cap, the actual cost is low.
  - Tradeoff: The inefficiency persists until a future migration touches this table.
  - Confidence: HIGH — consistent with the plan's own stated Migration Notes tradeoff.
  - Blind spot: No measurement of actual payload size at this project's real run-history lengths.
- **Fix B**: Use a raw SQL projection (`sql`json_type(history, '$.populationDensitySamples') is not null`` via Drizzle's `sql` template) to compute the boolean in SQLite without pulling the full blob.
  - Strength: Removes the new cost entirely, no schema migration needed.
  - Tradeoff: Introduces raw SQL/JSON-path syntax not otherwise used in this router — a new pattern for a performance micro-optimization on a 50-row, SQLite-backed query.
  - Confidence: MEDIUM — untested in this codebase; libsql's `json_type`/`json_extract` support needs verification before relying on it.
  - Blind spot: Haven't confirmed Drizzle's `sql` template composes cleanly with this router's existing query-builder chain style.
- **Decision**: ACCEPTED (Fix A) — recorded as a conscious, low-impact tradeoff consistent with this plan's own no-migration posture; no code change made.
