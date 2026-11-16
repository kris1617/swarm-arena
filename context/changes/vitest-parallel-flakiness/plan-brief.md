# Vitest parallel flakiness — Plan Brief

> Full plan: `context/changes/vitest-parallel-flakiness/plan.md`
> Research: `context/changes/vitest-parallel-flakiness/research.md`

## What & Why

Plain `npm test` is flaky on this machine under Vitest's default file
parallelism (up to 37 concurrent worker processes), while `npx vitest run
--no-file-parallelism` is reliably green — this project has quietly
accepted that gap across several prior changes instead of fixing it. Make
plain `npm test` trustworthy, so neither this project's Stop hook nor CI
has to special-case the serial flag to get a real signal.

## Starting Point

Two independent, confirmed causes, both empirically reproduced during
research: (1) three test files blanket-delete the single-row
`admin_settings` table in their own `afterEach`, racing against any
sibling file reading that row concurrently — caught live mid-research as a
`SQLITE_CONSTRAINT_PRIMARYKEY` crash; a related stray-owner assertion in
`generate-sweep.smoke.test.ts` has the same false-positive shape. (2) up to
37 concurrent workers cause real CPU/IO starvation, producing spurious
`testTimeout`/`hookTimeout` failures on slow-but-correct tests (confirmed:
every affected test passes alone or under `--no-file-parallelism`).

## Desired End State

Plain `npm test` passes reliably under default parallelism — proven by 10
consecutive green runs of the exact file group that was racing, and 5
consecutive green full-suite runs — with zero change to any production
business logic or any test's actual assertions about behavior.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Primary strategy | Root-cause fix (scope the races) + worker cap, not full serialization | Structurally eliminates both confirmed races rather than just reducing their odds, while keeping most of the ~53s-vs-249s wall-clock speed | Plan (user-confirmed) |
| `admin_settings` reset mechanism | Upsert back to known defaults, never delete the row | Removes the TOCTOU absence-window the race depends on; the reset itself is load-bearing for within-file isolation, so it can't just be removed | Research + Plan |
| Unconfirmed `retryPendingReports` hazard | Fix defensively now (scope `retry-worker.test.ts`'s assertions) | Same root-cause discipline as the confirmed fixes, cheap since this bug class is already being touched | Plan (user-confirmed) |
| Worker cap number | `maxWorkers: 8` | Vitest 5.1 removed the old per-pool `poolOptions` cap (confirmed in source); `maxWorkers` is the only surviving lever, and 8 is well below the observed 37 while preserving real speedup | Research + Plan |
| `loadCorpusFixture()` caching | Add module-level memoization | Zero-risk win — called from 9+ places with no caching today, pure I/O waste that feeds contention | Plan |

## Scope

**In scope:**
- `admin_settings` cross-file race (3 files) + its stray-owner-assertion cousin (1 file)
- `retry-worker.test.ts`'s unconfirmed-but-real assertion-scoping hazard
- `loadCorpusFixture()` memoization, a `vitest.config.ts` worker cap, and per-test timeout bumps for the specific tests observed timing out
- Repeated stress-test verification under default parallelism

**Out of scope:**
- `retryPendingReports`'s actual production query behavior (still scans the whole table by design)
- `scripts/corpus/generate-sweep.full.test.ts` (already excluded from the default suite)
- Any Vitest config option this installed version doesn't support (`poolOptions` is gone)
- The unresolved 30000ms-vs-10000ms `hookTimeout` default discrepancy noted in research — side-stepped by raising the two affected hooks' own explicit per-hook timeouts instead of investigating further

## Architecture / Approach

Fix both confirmed data races at the data layer (upsert instead of delete;
diff-scoped instead of global-absolute assertions) so they're structurally
impossible regardless of scheduling, defensively apply the same scoping
discipline to the one unconfirmed hazard, cut avoidable I/O that feeds
contention, add a worker cap as a second line of defense for whatever
contention remains, then prove it with repeated runs under the exact
conditions that broke it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Admin-settings reset helper | Upsert-to-defaults replaces delete in 3 files | Low — direct precedent exists (`updateParameterRanges`) |
| 2. Scope stray-owner assertion | Before/after diff instead of global-zero check | Low — single assertion, single file |
| 3. Scope retry-worker assertions | Filter by own report IDs instead of total count | Low-medium — 3 assertions to adapt correctly |
| 4. Cut contention | Memoize fixture loader + `maxWorkers: 8` + per-test timeout bumps | Low — all additive/config, no logic changes |
| 5. Stress-test verification | 10x + 5x repeated green runs, proof the fix holds | Medium — this is where an incomplete fix would surface |

**Prerequisites:** None — this is a standalone test-infrastructure change.
**Estimated effort:** ~1 session across 5 phases; Phase 5's repeated runs dominate wall-clock time, not implementation effort.

## Open Risks & Assumptions

- The unconfirmed `retryPendingReports` hazard was never empirically reproduced (18 attempts) — Phase 3 fixes it defensively on the strength of code inspection alone, not a reproduced failure.
- `maxWorkers: 8` reduces but doesn't structurally guarantee zero contention-driven timeout flakes for tests outside the 5 explicitly bumped in Phase 4 — Phase 5's repeated runs are the real check on whether this residual risk matters in practice.

## Success Criteria (Summary)

- Plain `npm test` passes 5/5 consecutive runs under default file parallelism.
- The exact file group confirmed racing in research passes 10/10 consecutive runs.
- No change to any production business logic or any test's assertions about actual behavior — only test-isolation mechanics and config.
