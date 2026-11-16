<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Parameter-sweep corpus generation Implementation Plan

- **Plan**: context/changes/parameter-sweep-corpus-generation/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: REVISE
- **Findings**: 2 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

7/7 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Phase 4's `--exclude ''` CLI override does not work with the installed Vitest version

- **Severity**: CRITICAL
- **Impact**: LOW — fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 4, item 2 ("The `corpus:generate` script")
- **Detail**: The plan's `package.json` script relies on `vitest run scripts/corpus/generate-sweep.test.ts --exclude ''` to override `vitest.config.ts`'s config-level `exclude` array for this one invocation. Verified against the installed Vitest 5.1.0 source (`node_modules/vitest/dist/chunks/cac.BYbt0aJp.js:2367-2369`, `node_modules/vitest/dist/chunks/index.Di8au7q4.js:9005`): the CLI's `--exclude` value is **pushed onto** (merged with) the config's `exclude` array — it never replaces or clears it. Passing `--exclude ''` only appends an empty string to the list; `scripts/corpus/generate-sweep.test.ts` stays excluded. As written, `npm run corpus:generate` would resolve zero test files and do nothing — Phase 4's automated criterion "4.4 `npm run corpus:generate` completes and produces all 20 JSON files" is unachievable with this mechanism.
- **Fix**: Add a dedicated `vitest.corpus.config.ts` (duplicating the env/resolve settings `vitest.config.ts` already needs, with no `exclude` entry for the generation file — or `include: ["scripts/corpus/generate-sweep.test.ts"]` directly) and change Phase 4's script to `"corpus:generate": "vitest run --config vitest.corpus.config.ts --testTimeout=1200000"`. The shared `vitest.config.ts`'s `exclude` entry for this file still protects the default `npm test` from ever picking it up through normal resolution; the dedicated config is the only path that resolves it.
- **Decision**: FIXED (plan.md Phase 4 now adds `vitest.corpus.config.ts` as item 2, with the `corpus:generate` script pointed at it via `--config`)

### F2 — Phase 3's smoke test and Phase 4's full-generation test claim the same filename, contradicting Phase 4's exclusion of that file

- **Severity**: CRITICAL
- **Impact**: LOW — fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Success Criteria ("`npx vitest run scripts/corpus/generate-sweep.test.ts` (reduced smoke case)") vs. Phase 4, item 3 ("The full-matrix generation test", File: `scripts/corpus/generate-sweep.test.ts`, new, excluded from default suite)
- **Detail**: Phase 3 names `scripts/corpus/generate-sweep.test.ts` as a short, reduced-matrix smoke test meant to run in the default `npm test` suite (its own text: "lives in a separate file... that is NOT excluded, so it still runs in `npm test`"). Phase 4 then adds that exact same path to `vitest.config.ts`'s `exclude` array and repurposes it as the full 20-row generation entry point. Both phases claim the same file for two incompatible roles — if Phase 3 is implemented literally, Phase 4's exclusion would also silently remove the smoke test from `npm test`, defeating Phase 3's own stated purpose.
- **Fix**: Give the two tests distinct filenames — e.g. `scripts/corpus/generate-sweep.smoke.test.ts` (Phase 3's reduced-matrix case, stays in the default `npm test` suite, not excluded) and `scripts/corpus/generate-sweep.full.test.ts` (Phase 4's full 20-row generation, added to the exclude list and run only via the dedicated `corpus:generate` script). Both import the same `generateCorpus`/`buildSweepMatrix` from `scripts/corpus/generate-sweep.ts`/`scripts/corpus/sweep-matrix.ts` — only the test-file split changes, not the production code.
- **Decision**: FIXED (plan.md Phase 3's smoke test renamed to `generate-sweep.smoke.test.ts`; Phase 4's full-generation test renamed to `generate-sweep.full.test.ts`)
