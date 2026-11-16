<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Parameter-sweep corpus generation

- **Plan**: context/changes/parameter-sweep-corpus-generation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-16
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING (fixed) |

## Findings

### F1 — Committed fixture is gzip-compressed but the generation code only ever wrote plain JSON

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria / Plan Adherence
- **Location**: scripts/corpus/generate-sweep.ts (`runFileName`, `writeFileSync` call), scripts/corpus/generate-sweep.full.test.ts, scripts/corpus/generate-sweep.smoke.test.ts
- **Detail**: The real 20-row corpus was committed as `run-NN.json.gz` (289MB raw JSON → ~916KB) via a manual post-processing step outside the plan's own code. `generate-sweep.ts` and both test files still wrote/expected plain `.json` — a future `npm run corpus:generate` re-run would silently diverge from what's actually committed.
- **Fix**: `generateCorpus` now writes `.json.gz` directly via `node:zlib`'s `gzipSync`; both test files updated to decompress with `gunzipSync` before asserting. Verified the smoke test passes end-to-end with the new write/read path, and confirmed (since gzip is lossless) the already-committed real corpus's decompressed content is unaffected — no need to regenerate the 60+ minute real run.
- **Decision**: FIXED (commit 8b275ed)

### F2 — Partial-batch failure can leak fixture rows until a future run's defensive cleanup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/corpus/generate-sweep.ts (`runBatch`)
- **Detail**: If one call in the batch's `Promise.all(startCorpusRun...)` rejects, or `pollUntilAllStopped` throws after its ceiling, runs the harness already inserted were never passed to `collectAndCleanupCorpusRun` by that invocation — self-healing (a future `generateCorpus` call's top-of-run defensive cleanup catches them eventually) but leaves stray rows inspectable in between.
- **Fix**: `runBatch` now tracks every run it actually started and, in a new `catch` block, cleans up any not yet collected before re-throwing.
- **Decision**: FIXED (commit 8b275ed)

### Observations (no action needed)

- `plan.md`'s documented `--testTimeout` value (3600000) and literal `.json` filenames were stale relative to what was actually shipped (14400000, `.json.gz`) — updated alongside the F1 fix for consistency, not a separate defect.

## Verification

Both parallel review sub-agents (plan-drift detection, safety/pattern compliance) found full MATCH across all four phases otherwise: mutate-in-place array growth verified safe against both `snapshotServerRun`/`resumeServerRun` consumers with a meaningful new regression test; `ensureAdminRangesAdmitForBatch` confirmed to use the identical widen rule as its non-batch sibling, folding correctly across the running `widened` value; `vitest.corpus.config.ts` confirmed to mirror the main config's env/resolve/server.deps settings exactly; the plan-review-flagged smoke-test/full-test filename collision risk confirmed not to have materialized (exact-string exclude, not a glob). No CRITICAL findings from either agent.

Automated gates re-verified after the F1/F2 fixes: `npm run typecheck` PASS, `npm run check` PASS (1 pre-existing unrelated warning), `npx vitest run scripts/corpus/generate-sweep.smoke.test.ts` PASS (exercises the new gzip write/read path end-to-end), full suite `npx vitest run --no-file-parallelism` 363/363 PASS.
