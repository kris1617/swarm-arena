# Parameter-sweep corpus generation — Plan Brief

> Full plan: `context/changes/parameter-sweep-corpus-generation/plan.md`
> Research: `context/changes/parameter-sweep-corpus-generation/research.md`

## What & Why

Generate and export the ~20-run structured parameter-sweep corpus the roadmap (M-8 / S-33) calls for — a reusable fixture the maintainer can use to validate the parameter-suggestion heuristic (S-34) and every per-run analytics function (S-35) without re-running real simulations each time. Uses F-08's single-run harness, batched up to 4 runs at a time, each capped at 60 simulated minutes.

## Starting Point

F-08 already built the single-run primitive (`scripts/corpus/harness.ts`: start a server-owned run, read back its full analysis, clean up). Research surfaced two blockers F-08's own impl-review had explicitly deferred to this slice: a confirmed engine performance bug (a full 3600s run doesn't finish in reasonable time) and a concurrency race on a shared admin-settings row when starting runs in parallel. No fixture-export code exists anywhere yet.

## Desired End State

Running `npm run corpus:generate` once produces 20 JSON files (one per run) plus a CSV index under `context/fixtures/parameter-sweep-corpus/`, committed to the repo. The exported corpus represents all five of the engine's population-health phases (establishment, growth, overshoot, crash, recovery). Re-running `npm test` is unaffected — the generation step is excluded from the default suite.

## Key Decisions Made

| Decision                          | Choice                                                        | Why                                                                                                   | Source   |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| Performance blocker                | Fix the O(n²) array growth first, as Phase 1                   | 225,000-tick runs don't finish in 2 minutes today; working around it risks hours of wall-clock time and leaves the bug for every future long-running feature | Plan (user-confirmed) |
| Export file shape                  | One JSON file per run + a CSV index                            | Satisfies the roadmap's "JSON/CSV" phrasing: full nested history per file for S-34/S-35, plus a human-browsable flat index | Plan (user-confirmed) |
| Sweep matrix                       | `separationWeight` × `foodRegenRate` × `crossbreedingEnabled`, 24 combos trimmed to 20 | Grounded directly in `classifyPopulationPhase`'s actual thresholds; varies exactly the three fields the roadmap names | Research → Plan (user-confirmed) |
| Extinct runs                       | Keep them in the corpus, flagged                               | Extinction IS the crash phase's real terminal state; excluding it would defeat the roadmap's explicit crash-targeting goal | Plan (user-confirmed) |
| Batch concurrency fix               | Widen admin ranges once to the union of the whole batch, not per-call | Reuses the harness's existing generic per-field fold; avoids the exact race F-08's impl-review (F3) identified and deferred here | Research |
| Execution environment              | Vitest (fake timers), not a bare Node script                   | No `tsx`/`ts-node` in this repo, and only Vitest's fake clock avoids true 60-real-minutes-per-run cost | Research |

## Scope

**In scope:** fixing the engine's per-tick array growth; a batch-safe admin-range widen path in the harness; the concrete 20-run sweep matrix; the generation/export script; npm script wiring; running it once for real and verifying the output.

**Out of scope:** S-34's suggestion-quality test, S-35's analytics-correctness tests (both depend on this slice's output but are separately planned); varying any parameter beyond the three the roadmap names; any project-wide array-growth audit beyond the six arrays on this slice's critical path.

## Architecture / Approach

Four phases, strictly ordered by dependency: fix the engine (Phase 1) → make the harness batch-safe (Phase 2) → build the matrix + orchestrator against both (Phase 3) → wire the npm script, run it for real, and verify (Phase 4). Phases 1-3 are each independently testable without running the full 20-row sweep; only Phase 4 pays the full real-world generation cost.

## Phases at a Glance

| Phase                                              | What it delivers                                                             | Key risk                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Fix per-tick array growth                        | O(n²) → O(n) tick cost; mutate-in-place sample arrays                        | Snapshot/resume array-aliasing risk — mitigated with an explicit new test  |
| 2. Batch-safe admin-range widening                  | `ensureAdminRangesAdmitForBatch` + opt-out flag on `startCorpusRun`           | None significant — purely additive, existing callers unaffected           |
| 3. Sweep matrix and batched generation script       | `buildSweepMatrix()` (20 rows) + `generateCorpus()` orchestrator, smoke-tested | Matrix's phase-targeting is a hypothesis, not a guarantee — verified in Phase 4 |
| 4. npm script wiring, real run, and verification    | `npm run corpus:generate`; 20 JSON files + CSV index, committed              | Real generation time is unknown until Phase 1's fix is measured end-to-end |

**Prerequisites:** F-08 (`corpus-generation-harness`, archived and done).
**Estimated effort:** 4 phases; Phase 1 and 2 are independently verifiable without any real corpus generation, Phase 4 is where the real one-time cost is paid.

## Open Risks & Assumptions

- The sweep matrix's phase-targeting (which combinations are predicted to land in which `PopulationPhase`) is a hypothesis grounded in `classifyPopulationPhase`'s thresholds, not a guarantee — Phase 4's manual verification is where this gets checked against reality, and a missing phase is a noted follow-up, not a blocker.
- Real wall-clock time for the full 20-run, 5-batch generation is unknown until Phase 1's fix is measured — the 20-minute per-test timeout in Phase 4 is a generous starting point, not a verified figure.
- The snapshot/resume array-aliasing risk flagged in Phase 1 is believed safe today (interval cleared before the DB write) but gets its own explicit regression test rather than being assumed away.

## Success Criteria (Summary)

- `npm run corpus:generate` produces 20 well-formed JSON files + a CSV index, committed to the repo, with no DB/registry footprint left behind.
- All five population phases appear somewhere across the corpus.
- `npm test` (the default suite) is unaffected in membership or runtime by the new generation test.
